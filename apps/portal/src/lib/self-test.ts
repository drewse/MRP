/**
 * Self-test module for portal connection diagnostics
 * Runs a suite of checks against the API and streams results
 */

export type SelfTestStatus = 'RUNNING' | 'PASS' | 'FAIL' | 'SKIP';

export interface SelfTestResult {
  id: string;
  name: string;
  status: SelfTestStatus;
  detail?: string;
  ms?: number;
}

export interface SelfTestArgs {
  apiBaseUrl: string;
  tenantSlug: string;
  adminToken: string;
  signal?: AbortSignal;
}

/**
 * Normalize API base URL by trimming trailing slashes
 */
function normalizeApiBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Fetch with timeout wrapper
 * Creates its own AbortController for timeout, but also respects outer signal
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outerSignal?: AbortSignal
): Promise<Response> {
  // If outer signal already aborted, throw immediately
  if (outerSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort();
  }, timeoutMs);

  // If outer signal aborts, also abort timeout controller
  if (outerSignal) {
    outerSignal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      timeoutController.abort();
    });
  }

  try {
    // Use timeout controller's signal - when it aborts (either from timeout or outer signal), fetch will abort
    const response = await fetch(url, {
      ...init,
      signal: timeoutController.signal,
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      // Check if it was the timeout (not the outer signal)
      // If outer signal aborted, timeoutController will also be aborted, so check outerSignal first
      if (outerSignal?.aborted) {
        // Aborted by outer signal - rethrow as-is
        throw error;
      }
      if (timeoutController.signal.aborted) {
        // Aborted by timeout
        throw new Error(`Timed out after ${timeoutMs}ms`);
      }
      // Otherwise, rethrow as-is
      throw error;
    }
    throw error;
  }
}

/**
 * Run self-tests and yield results as they complete
 */
export async function* runSelfTests(
  args: SelfTestArgs
): AsyncGenerator<SelfTestResult, SelfTestResult[], void> {
  const { apiBaseUrl, tenantSlug, adminToken, signal } = args;
  const results: SelfTestResult[] = [];

  // Yield start result immediately to prove generator is running
  const startResult: SelfTestResult = {
    id: 'start',
    name: 'Self-Test',
    status: 'RUNNING',
    detail: 'Starting self-test…',
  };
  results.push(startResult);
  yield startResult;

  // Validate baseUrl
  const effectiveBaseUrl = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
  if (!effectiveBaseUrl || effectiveBaseUrl.trim().length === 0) {
    const errorResult: SelfTestResult = {
      id: 'baseurl-validation',
      name: 'Base URL Validation',
      status: 'FAIL',
      detail: 'API base URL is empty or invalid',
    };
    results.push(errorResult);
    yield errorResult;
    return results;
  }

  const baseUrl = normalizeApiBaseUrl(effectiveBaseUrl);

  // Test 1: API Health
  {
    const testId = 'health';
    const testName = 'API Health';
    const startTime = Date.now();
    
    yield { id: testId, name: testName, status: 'RUNNING' };
    
    try {
      const url = `${baseUrl}/health`;
      const response = await fetchWithTimeout(
        url,
        { method: 'GET' },
        5000, // 5s timeout
        signal
      );
      
      const ms = Date.now() - startTime;
      
      if (response.ok) {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'PASS',
          ms,
        };
        results.push(result);
        yield result;
      } else {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'FAIL',
          detail: `HTTP ${response.status}: ${response.statusText}`,
          ms,
        };
        results.push(result);
        yield result;
      }
    } catch (error) {
      const ms = Date.now() - startTime;
      let detail = 'Network error';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError' && signal?.aborted) {
          // Test was aborted by outer signal, yield a result indicating abort
          detail = 'Aborted';
        } else {
          detail = error.message;
        }
      }
      
      const result: SelfTestResult = {
        id: testId,
        name: testName,
        status: 'FAIL',
        detail,
        ms,
      };
      results.push(result);
      yield result;
    }
  }

  // Test 2: Auth + Tenant Settings
  {
    const testId = 'tenant-settings';
    const testName = 'Tenant Settings';
    const startTime = Date.now();
    
    yield { id: testId, name: testName, status: 'RUNNING' };
    
    try {
      const url = `${baseUrl}/tenant/settings`;
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-MRP-Tenant-Slug': tenantSlug,
        'X-MRP-Admin-Token': adminToken,
      });
      
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers,
        },
        8000, // 8s timeout
        signal
      );
      
      const ms = Date.now() - startTime;
      
      if (response.ok) {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'PASS',
          ms,
        };
        results.push(result);
        yield result;
      } else {
        let detail = `HTTP ${response.status}: ${response.statusText}`;
        
        if (response.status === 401 || response.status === 403) {
          detail = 'Auth failed (check admin token)';
        } else if (response.status === 404) {
          detail = 'Endpoint missing (server out of date?)';
        }
        
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'FAIL',
          detail,
          ms,
        };
        results.push(result);
        yield result;
      }
    } catch (error) {
      const ms = Date.now() - startTime;
      let detail = 'Network error';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError' && signal?.aborted) {
          // Test was aborted by outer signal, yield a result indicating abort
          detail = 'Aborted';
        } else {
          // Don't expose adminToken in error messages
          detail = error.message.replace(adminToken, '***');
        }
      }
      
      const result: SelfTestResult = {
        id: testId,
        name: testName,
        status: 'FAIL',
        detail,
        ms,
      };
      results.push(result);
      yield result;
    }
  }

  // Test 3: Queue Inspect (best-effort)
  {
    const testId = 'queue-inspect';
    const testName = 'Queue Inspect';
    const startTime = Date.now();
    
    yield { id: testId, name: testName, status: 'RUNNING' };
    
    try {
      const url = `${baseUrl}/debug/queue/inspect?limit=5`;
      const headers = new Headers({
        'Content-Type': 'application/json',
        'X-MRP-Tenant-Slug': tenantSlug,
        'X-MRP-Admin-Token': adminToken,
      });
      
      const response = await fetchWithTimeout(
        url,
        {
          method: 'GET',
          headers,
        },
        5000, // 5s timeout
        signal
      );
      
      const ms = Date.now() - startTime;
      
      if (response.ok) {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'PASS',
          ms,
        };
        results.push(result);
        yield result;
      } else if (response.status === 404) {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'SKIP',
          detail: 'Not available (likely production)',
          ms,
        };
        results.push(result);
        yield result;
      } else {
        const result: SelfTestResult = {
          id: testId,
          name: testName,
          status: 'FAIL',
          detail: `HTTP ${response.status}: ${response.statusText}`,
          ms,
        };
        results.push(result);
        yield result;
      }
    } catch (error) {
      const ms = Date.now() - startTime;
      let detail = 'Network error';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError' && signal?.aborted) {
          // Test was aborted by outer signal, yield a result indicating abort
          detail = 'Aborted';
        } else {
          // Don't expose adminToken in error messages
          detail = error.message.replace(adminToken, '***');
        }
      }
      
      const result: SelfTestResult = {
        id: testId,
        name: testName,
        status: 'FAIL',
        detail,
        ms,
      };
      results.push(result);
      yield result;
    }
  }

  return results;
}

/**
 * Format self-test results as plain text for clipboard
 */
export function formatSelfTestResults(
  results: SelfTestResult[],
  apiBaseUrl: string,
  tenantSlug: string
): string {
  const lines: string[] = [];
  lines.push(`Self-Test Results (apiBaseUrl=${apiBaseUrl}, tenant=${tenantSlug})`);
  lines.push('');
  
  for (const result of results) {
    const statusBadge = `[${result.status}]`;
    const name = result.name;
    const ms = result.ms !== undefined ? ` (${result.ms}ms)` : '';
    const detail = result.detail ? ` - ${result.detail}` : '';
    lines.push(`${statusBadge} ${name}${ms}${detail}`);
  }
  
  return lines.join('\n');
}

