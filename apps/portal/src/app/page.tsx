'use client';

import { useState, useEffect, useRef } from 'react';
import { api, getStoredConfig, storeConfig, type ConnectionConfig } from '@/lib/api-client';
import { runSelfTests, formatSelfTestResults, type SelfTestResult } from '@/lib/self-test';

export default function ConnectPage() {
  const [tenantSlug, setTenantSlug] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selfTestResults, setSelfTestResults] = useState<SelfTestResult[]>([]);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestClickCount, setSelfTestClickCount] = useState(0);
  const [selfTestLastClickedAt, setSelfTestLastClickedAt] = useState<Date | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    const stored = getStoredConfig();
    if (stored) {
      setTenantSlug(stored.tenantSlug);
      setAdminToken(stored.adminToken);
      setApiBaseUrl(stored.apiBaseUrl || '');
    } else {
      // Set defaults from env
      // In production, NEXT_PUBLIC_API_BASE_URL should be set
      const isProduction = process.env.NODE_ENV === 'production';
      const defaultApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 
        (isProduction ? '' : 'http://localhost:3001');
      
      setApiBaseUrl(defaultApiUrl);
      setTenantSlug(process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG || '');
      setAdminToken(process.env.NEXT_PUBLIC_PORTAL_ADMIN_TOKEN || '');
    }

    return () => {
      isMountedRef.current = false;
      // Abort any in-flight self-tests on unmount
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleTestConnection = async () => {
    if (!tenantSlug || !adminToken) {
      setMessage({ type: 'error', text: 'Please enter tenant slug and admin token' });
      return;
    }

    setTesting(true);
    setMessage(null);

    try {
      // Store config first
      const config: ConnectionConfig = {
        tenantSlug,
        adminToken,
        apiBaseUrl: apiBaseUrl || undefined,
      };
      storeConfig(config);

      // Test connection
      await api.getSettings();
      setMessage({ type: 'success', text: 'Connection successful!' });
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Connection failed. Please check your settings.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRunSelfTest = async () => {
    // Increment click counter and set timestamp immediately (dev debugging)
    setSelfTestClickCount((prev) => prev + 1);
    setSelfTestLastClickedAt(new Date());

    // Early return if already running (before setting any state)
    if (selfTestRunning) {
      return;
    }

    // Set running state and clear results immediately
    setSelfTestRunning(true);
    setSelfTestResults([]);
    setMessage(null);

    // Capture current state values (avoid closure issues)
    const currentTenantSlug = (tenantSlug || '').trim();
    const currentAdminToken = (adminToken || '').trim();
    const currentApiBaseUrl = (apiBaseUrl || '').trim();

    // Dev-only: log that handler was called
    if (process.env.NODE_ENV === 'development') {
      console.debug('[Self-Test] handleRunSelfTest called', {
        tenantSlug: currentTenantSlug ? `${currentTenantSlug.length} chars` : 'missing',
        adminToken: currentAdminToken ? `${currentAdminToken.length} chars` : 'missing',
        apiBaseUrl: currentApiBaseUrl || 'default',
      });
    }

    // Abort any existing self-test
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Precheck: validate inputs
      if (!currentTenantSlug || !currentAdminToken) {
        setSelfTestResults([
          {
            id: 'precheck',
            name: 'Precheck',
            status: 'FAIL',
            detail: 'Missing tenant slug or admin token',
          },
        ]);
        return; // Allowed because we already emitted a result
      }

      // IMPORTANT: the generator must be iterated unconditionally here
      const effectiveApiBaseUrl = currentApiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
      
      // Dev-only: log that we're starting the generator
      if (process.env.NODE_ENV === 'development') {
        console.debug('[Self-Test] Starting generator', {
          effectiveApiBaseUrl,
          tenantSlug: currentTenantSlug ? `${currentTenantSlug.length} chars` : 'missing',
          adminToken: currentAdminToken ? `${currentAdminToken.length} chars` : 'missing',
        });
      }

      const gen = runSelfTests({
        apiBaseUrl: effectiveApiBaseUrl,
        tenantSlug: currentTenantSlug,
        adminToken: currentAdminToken,
        signal: controller.signal,
      });

      // Iterate generator unconditionally
      for await (const result of gen) {
        if (!isMountedRef.current) {
          break;
        }
        // Append result (don't try to update existing, just append)
        setSelfTestResults((prev) => [...prev, result]);
      }
    } catch (error) {
      // Always add exception result to show what went wrong
      const exceptionResult: SelfTestResult = {
        id: 'exception',
        name: 'Self-Test Runner',
        status: 'FAIL',
        detail: error instanceof Error ? error.message : 'Unknown error occurred',
      };
      
      setSelfTestResults((prev) => {
        // Check if exception result already exists
        const existing = prev.find((r) => r.id === 'exception');
        if (existing) {
          return prev.map((r) => (r.id === 'exception' ? exceptionResult : r));
        } else {
          return [...prev, exceptionResult];
        }
      });

      // Also show error message
      if (isMountedRef.current) {
        if (error instanceof Error && error.name === 'AbortError') {
          // Test was aborted, silently ignore
        } else {
          setMessage({
            type: 'error',
            text: `Self-test error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }
    } finally {
      // ALWAYS reset running state
      if (isMountedRef.current) {
        setSelfTestRunning(false);
      }
      abortControllerRef.current = null;
    }
  };

  const handleCopyResults = async () => {
    if (selfTestResults.length === 0) {
      return;
    }

    const effectiveApiBaseUrl = apiBaseUrl || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';
    const text = formatSelfTestResults(selfTestResults, effectiveApiBaseUrl, tenantSlug);

    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: 'success', text: 'Results copied to clipboard!' });
      // Clear success message after 2 seconds
      setTimeout(() => {
        if (isMountedRef.current) {
          setMessage(null);
        }
      }, 2000);
    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Failed to copy results to clipboard',
      });
    }
  };

  return (
    <div>
      <h1>Connect</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleTestConnection();
        }}
      >
        <div className="form-group">
          <label htmlFor="tenantSlug">Tenant Slug *</label>
          <input
            id="tenantSlug"
            type="text"
            value={tenantSlug}
            onChange={(e) => setTenantSlug(e.target.value)}
            placeholder="dev"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="adminToken">Admin Token *</label>
          <input
            id="adminToken"
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="Enter admin token"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="apiBaseUrl">API Base URL</label>
          <input
            id="apiBaseUrl"
            type="text"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="http://localhost:3001"
          />
          <small style={{ display: 'block', marginTop: '0.5rem', color: '#666' }}>
            {!process.env.NEXT_PUBLIC_API_BASE_URL ? (
              <span style={{ color: '#d32f2f', fontWeight: '500' }}>
                ⚠️ NEXT_PUBLIC_API_BASE_URL should be set in production
              </span>
            ) : (
              `Optional. Defaults to ${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'}`
            )}
          </small>
        </div>

        {message && (
          <div className={`alert ${message.type}`}>{message.text}</div>
        )}

        <button type="submit" disabled={testing}>
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
      </form>

      {/* Self-Test Section */}
      <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #ddd' }}>
        <h2 style={{ marginBottom: '1rem' }}>Self-Test</h2>
        <p style={{ marginBottom: '1rem', color: '#666', fontSize: '0.9rem' }}>
          Run diagnostic checks to verify API connectivity and configuration.
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={handleRunSelfTest}
            disabled={selfTestRunning}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '1rem',
              cursor: selfTestRunning || !tenantSlug || !adminToken ? 'not-allowed' : 'pointer',
              opacity: selfTestRunning || !tenantSlug || !adminToken ? 0.6 : 1,
            }}
          >
            {selfTestRunning ? 'Running...' : 'Run Self-Test'}
          </button>

          {selfTestResults.length > 0 && (
            <button
              type="button"
              onClick={handleCopyResults}
              style={{
                marginLeft: '0.5rem',
                padding: '0.5rem 1rem',
                fontSize: '1rem',
                cursor: 'pointer',
              }}
            >
              Copy Results
            </button>
          )}
        </div>

        {/* Dev-only debug info */}
        {process.env.NODE_ENV === 'development' && (
          <div style={{ marginBottom: '1rem', padding: '0.5rem', background: '#f0f0f0', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace' }}>
            Self-test clicks: {selfTestClickCount} | Last click: {selfTestLastClickedAt ? selfTestLastClickedAt.toLocaleTimeString() : 'never'} | Results: {selfTestResults.length} | Running: {selfTestRunning ? 'true' : 'false'}
          </div>
        )}

        {!tenantSlug || !adminToken ? (
          <div style={{ padding: '0.75rem', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', color: '#856404' }}>
            Please enter tenant slug and admin token to run self-test.
          </div>
        ) : null}

        {selfTestResults.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.9rem',
              }}
            >
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Test</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Duration</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {selfTestResults.map((result) => (
                  <tr key={result.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem', fontWeight: '500' }}>{result.name}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          fontWeight: '500',
                          background:
                            result.status === 'PASS'
                              ? '#d4edda'
                              : result.status === 'FAIL'
                              ? '#f8d7da'
                              : result.status === 'SKIP'
                              ? '#fff3cd'
                              : '#e2e3e5',
                          color:
                            result.status === 'PASS'
                              ? '#155724'
                              : result.status === 'FAIL'
                              ? '#721c24'
                              : result.status === 'SKIP'
                              ? '#856404'
                              : '#383d41',
                        }}
                      >
                        {result.status}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', color: '#666' }}>
                      {result.ms !== undefined ? `${result.ms}ms` : '-'}
                    </td>
                    <td style={{ padding: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
                      {result.detail || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

