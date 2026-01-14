/**
 * LLM client for generating fix suggestions
 */

import { z } from 'zod';
import pino from 'pino';
import type {
  LlmClient,
  LlmClientConfig,
  GenerateSuggestionsInput,
  GenerateSuggestionsOutput,
} from './types.js';

// Create logger for LLM client
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Zod schema for LLM response validation
const FileSchema = z.object({
  path: z.string(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
});

const PrecedentRefSchema = z.object({
  knowledgeSourceId: z.string(),
  title: z.string(),
  sourceUrl: z.string(),
});

const SuggestionSchema = z.object({
  checkKey: z.string(),
  title: z.string(),
  severity: z.enum(['WARN', 'FAIL']),
  files: z.array(FileSchema),
  rationale: z.string(),
  suggestedFix: z.union([z.string(), z.array(z.string())]), // Allow string or array
  precedentRefs: z.array(PrecedentRefSchema).optional(),
});

const ResponseSchema = z.object({
  suggestions: z.array(SuggestionSchema),
});

/**
 * Create LLM client
 */
export function createLlmClient(config: LlmClientConfig): LlmClient {
  const {
    provider,
    apiKey,
    baseUrl = 'https://api.openai.com/v1',
    model = 'gpt-4o-mini',
    timeout = 120000, // Default 120s
    maxRetries = 3,
  } = config;

  if (provider !== 'OPENAI') {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  // Check for proxy support
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const proxyUrl = httpsProxy || httpProxy;
  const proxyEnabled = !!proxyUrl;

  if (proxyEnabled) {
    logger.info({
      event: 'llm.proxy.enabled',
      proxyUrl: proxyUrl ? `${proxyUrl.substring(0, 20)}...` : undefined,
    }, 'Using proxy for OpenAI requests');
  } else {
    logger.info({
      event: 'llm.proxy.enabled',
      proxyEnabled: false,
    }, 'No proxy configured for OpenAI requests');
  }

  /**
   * Create fetch with optional proxy support
   */
  async function createFetch(): Promise<typeof fetch> {
    if (!proxyEnabled) {
      return fetch;
    }

    // Use undici ProxyAgent if available, otherwise fall back to regular fetch
    try {
      const { ProxyAgent } = await import('undici');
      const agent = new ProxyAgent(proxyUrl!);
      return async (url: string | URL | Request, init?: RequestInit) => {
        const request = new Request(url, init);
        // @ts-ignore - undici agent type compatibility
        return fetch(request, {
          dispatcher: agent,
        });
      };
    } catch {
      // Fallback to regular fetch if undici not available
      logger.warn({
        event: 'llm.proxy.fallback',
      }, 'ProxyAgent not available, using regular fetch (proxy may not work)');
      return fetch;
    }
  }

  /**
   * Make HTTP request with retry logic and structured logging
   */
  async function request<T>(path: string, body: unknown): Promise<T> {
    const url = `${baseUrl}${path}`;
    const startTime = Date.now();
    let lastError: Error | null = null;
    let lastStatusCode: number | undefined;
    let errorType: string | undefined;

    logger.info({
      event: 'llm.request.start',
      model,
      timeoutMs: timeout,
      path,
    }, 'Starting LLM API request');

    const fetchFn = await createFetch();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetchFn(url, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          lastStatusCode = response.status;

          // Handle rate limiting (429)
          if (response.status === 429) {
            errorType = 'rate_limit';
            if (attempt < maxRetries) {
              const retryAfter = response.headers.get('Retry-After');
              const waitMs = retryAfter
                ? Number.parseInt(retryAfter, 10) * 1000
                : Math.min(1000 * Math.pow(2, attempt), 10000);
              
              logger.info({
                event: 'llm.request.retry',
                attempt: attempt + 1,
                reason: 'rate_limit',
                waitMs,
                statusCode: 429,
              }, `Rate limited, retrying in ${waitMs}ms`);
              
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
          }

          // Handle 5xx errors with retry
          if (response.status >= 500 && response.status < 600) {
            errorType = 'server_error';
            if (attempt < maxRetries) {
              const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000);
              
              logger.info({
                event: 'llm.request.retry',
                attempt: attempt + 1,
                reason: 'server_error',
                waitMs,
                statusCode: response.status,
              }, `Server error, retrying in ${waitMs}ms`);
              
              await new Promise(resolve => setTimeout(resolve, waitMs));
              continue;
            }
          }

          // Handle 401/403 (auth errors - don't retry)
          if (response.status === 401 || response.status === 403) {
            errorType = 'auth';
            await response.text().catch(() => ''); // Consume response
            throw new Error(`LLM API authentication error: ${response.status} ${response.statusText}`);
          }

          if (!response.ok) {
            errorType = 'api_error';
            await response.text().catch(() => ''); // Consume response
            throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json();
          const successDurationMs = Date.now() - startTime;
          
          // Try to extract token usage if available
          const usage = (data as { usage?: { total_tokens?: number } }).usage;
          const tokens = usage?.total_tokens;

          logger.info({
            event: 'llm.request.success',
            durationMs: successDurationMs,
            attempt: attempt + 1,
            tokens,
          }, 'LLM API request succeeded');

          return data as T;
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);

          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            errorType = 'timeout';
            const timeoutDurationMs = Date.now() - startTime;
            
            if (attempt < maxRetries) {
              logger.info({
                event: 'llm.request.retry',
                attempt: attempt + 1,
                reason: 'timeout',
                durationMs: timeoutDurationMs,
              }, `Request timeout, retrying`);
              continue;
            }
            
            logger.error({
              event: 'llm.request.fail',
              durationMs: timeoutDurationMs,
              errorType: 'timeout',
              attempt: attempt + 1,
            }, 'LLM API request timeout after retries');
            
            throw new Error('LLM API request timeout');
          }

          throw fetchError;
        }
      } catch (error: unknown) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          const failDurationMs = Date.now() - startTime;
          // Determine error type
          if (!errorType) {
            if (lastError.message.includes('timeout')) {
              errorType = 'timeout';
            } else if (lastError.message.includes('network') || lastError.message.includes('fetch')) {
              errorType = 'network';
            } else if (lastStatusCode === 401 || lastStatusCode === 403) {
              errorType = 'auth';
            } else if (lastStatusCode === 429) {
              errorType = 'rate_limit';
            } else {
              errorType = 'unknown';
            }
          }
          
          logger.error({
            event: 'llm.request.fail',
            durationMs: failDurationMs,
            errorType,
            statusCode: lastStatusCode,
            attempt: attempt + 1,
            error: lastError.message,
          }, 'LLM API request failed after retries');
          
          throw lastError;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  return {
    async generateSuggestions(input: GenerateSuggestionsInput): Promise<GenerateSuggestionsOutput> {
      // Build prompt
      const prompt = buildPrompt(input);

      // Call OpenAI API
      const response = await request<{
        choices: Array<{
          message: {
            content: string;
          };
        }>;
      }>('/chat/completions', {
        model,
        messages: [
          {
            role: 'system',
            content: `You are a code review assistant. Generate concise, actionable fix suggestions for code review findings. 
Focus on practical solutions. Reference precedents when relevant. Keep suggestions brief (2-3 sentences max per suggestion).`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 2000,
      });

      // Parse and validate response
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
      } catch {
        throw new Error('Invalid JSON response from LLM');
      }

      const validated = ResponseSchema.parse(parsed);
      
      // Return validated response (normalization happens in worker)
      // Schema accepts string | array, but worker will normalize to string before storing
      return validated;
    },
  };
}

/**
 * Build prompt for LLM
 */
function buildPrompt(input: GenerateSuggestionsInput): string {
  const { checkResults, precedents, mrContext, snippets, redactionReport } = input;

  const parts: string[] = [];

  parts.push(`## Merge Request Context
Title: ${mrContext.title}
Project ID: ${mrContext.projectId}
MR IID: ${mrContext.mrIid}
Head SHA: ${mrContext.headSha}
${mrContext.description ? `Description: ${mrContext.description.substring(0, 200)}` : ''}`);

  parts.push(`\n## Failing Checks
${checkResults.map(r => `- [${r.status}] ${r.checkKey}: ${r.title}${r.evidence ? ` (${r.evidence.substring(0, 100)})` : ''}`).join('\n')}`);

  if (snippets.length > 0) {
    parts.push(`\n## Code Snippets (Redacted)`);
    for (const snippet of snippets) {
      parts.push(`\n### ${snippet.path} (lines ${snippet.lineStart}-${snippet.lineEnd})`);
      parts.push('```');
      parts.push(snippet.content.substring(0, 500)); // Limit snippet size
      parts.push('```');
    }
  }

  if (precedents && precedents.length > 0) {
    parts.push(`\n## Similar GOLD Precedents`);
    for (const precedent of precedents) {
      parts.push(`- [${precedent.title}](${precedent.sourceUrl || '#'}) - Matched tokens: ${precedent.matchedTokens.slice(0, 5).join(', ')}`);
    }
  }

  if (redactionReport.filesRedacted > 0) {
    parts.push(`\nNote: ${redactionReport.filesRedacted} file(s) were redacted for privacy.`);
  }

  parts.push(`\n## Task
Generate fix suggestions for the failing checks above. For each suggestion:
1. Provide a concise title
2. Explain why it matters (1-2 sentences)
3. Suggest a specific fix (2-3 bullet points)
4. Reference precedents if relevant

Return JSON in this format:
{
  "suggestions": [
    {
      "checkKey": "check_key",
      "title": "Brief title",
      "severity": "WARN" or "FAIL",
      "files": [{"path": "file/path", "lineStart": 10, "lineEnd": 15}],
      "rationale": "Why this matters",
      "suggestedFix": "Specific fix steps",
      "precedentRefs": [{"knowledgeSourceId": "id", "title": "title", "sourceUrl": "url"}]
    }
  ]
}`);

  return parts.join('\n');
}

