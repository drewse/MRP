# Local Dev: Environment + AI Troubleshooting

This guide helps you diagnose and fix common issues with environment variable loading and AI features.

## Quick Diagnostics

### Check Environment Loading

Run the environment diagnostics script:

```bash
pnpm env:diag
```

This will show:
- Resolved `.env` file path
- Whether `.env` and `.env.local` exist
- Which keys were loaded
- Status of critical variables (AI_ENABLED, OPENAI_API_KEY, DATABASE_URL, etc.)
- Key lengths (never the actual values)

### Check API/Worker Startup

When starting the API or Worker, look for the structured `env.diagnostics` log event:

```json
{
  "event": "env.diagnostics",
  "envFilePath": "C:\\NB\\MRP\\.env",
  "envFileExists": true,
  "keysLoadedCount": 15,
  "AI_ENABLED": true,
  "OPENAI_API_KEY_PRESENT": true,
  "OPENAI_API_KEY_LENGTH": 163,
  "DATABASE_URL_PRESENT": true
}
```

## Common Issues

### Issue: OPENAI_API_KEY appears empty in new terminals

**Symptoms:**
- Worker logs show `OPENAI_API_KEY_PRESENT: false`
- AI suggestions are skipped with reason `ai.disabled.missing_key`

**Solution:**
1. Ensure `.env` file exists at repo root: `<repo>/.env`
2. Verify the key is set: `OPENAI_API_KEY=sk-...`
3. Run `pnpm env:diag` to verify loading
4. Restart the worker: `pnpm worker:dev`

**Why this happens:**
- Windows process.env may contain empty values
- Our env loader uses `override: true` to ensure `.env` values override process.env
- If `.env` is missing or key is empty, it won't load

### Issue: AI suggestions timeout or return 0 snippets

**Symptoms:**
- Logs show `worker.ai.snippets.selected snippetsCount: 0`
- `worker.ai.suggestions.failed` with timeout error

**Solution:**

1. **Check snippet selection:**
   - Set `LOG_LEVEL=debug` to see per-file skip reasons
   - Look for `snippet.selection.skip` events with reasons:
     - `denylisted` - File is in denylist (secrets, .env, etc.)
     - `not_in_allowlist` - File doesn't match allowlist patterns
     - `no_diff_hunks` - No diff content found
     - `too_large` - File exceeds size limit

2. **Verify allowlist:**
   - Files must match: `apps/**`, `packages/**`, `scripts/**`, `prisma/**`
   - Or have extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.md`, `.yml`, `.yaml`, `.sql`, `.prisma`, `.sh`, `.ps1`

3. **Fallback mode:**
   - If no snippets are selected, AI will use "check-only" mode
   - Look for `worker.ai.fallback.no_snippets=true` in logs
   - This still generates suggestions based on check names and file paths

### Issue: OpenAI requests timeout

**Symptoms:**
- `llm.request.fail` with `errorType: "timeout"`
- Requests take ~40s then fail

**Solution:**

1. **Check timeout settings:**
   - Default timeout is 120s (2 minutes)
   - Can be configured in tenant AI config

2. **Check network/proxy:**
   - Look for `llm.proxy.enabled` in logs
   - If behind corporate proxy, set `HTTPS_PROXY` or `HTTP_PROXY` env vars
   - Proxy support uses `undici` ProxyAgent

3. **Check retries:**
   - Default is 3 retries with exponential backoff
   - Look for `llm.request.retry` events

4. **Run connectivity test:**
   ```bash
   AI_SELF_TEST=true pnpm worker:dev
   ```
   This will test OpenAI connectivity at startup

### Issue: AI suggestions fail with auth error

**Symptoms:**
- `worker.ai.suggestions.failed` with `errorReason: "ai.error.auth"`
- `llm.request.fail` with `errorType: "auth"`

**Solution:**
1. Verify `OPENAI_API_KEY` is valid and not expired
2. Check key length: should be > 0 (run `pnpm env:diag`)
3. Ensure key starts with `sk-` (OpenAI format)
4. Check for whitespace or quotes around the key in `.env`

## Environment Variable Loading

### How It Works

1. **Centralized Loading:**
   - Both API and Worker call `initEnv()` from `@mrp/config` as the first line
   - This ensures `.env` is loaded before any other code reads `process.env`

2. **Loading Order:**
   - First: `<repo-root>/.env` (always, if exists)
   - Then: `<repo-root>/.env.local` (if exists, overrides `.env`)
   - Uses `override: true` to ensure `.env` values override process.env

3. **Safeguards:**
   - If process.env has a non-empty value and `.env` has empty/undefined, the existing value is preserved
   - This prevents Windows empty env vars from overwriting good values

4. **Idempotency:**
   - `initEnv()` can be called multiple times safely
   - Subsequent calls return cached result

### Required Variables

**API:**
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `GITLAB_TOKEN` - GitLab API token
- `GITLAB_WEBHOOK_SECRET` - Webhook verification
- `APP_PUBLIC_URL` - Public API URL

**Worker:**
- `REDIS_URL` - Redis connection
- `DATABASE_URL` - Optional (only for DB features)
- `GITLAB_TOKEN` - Optional (only for posting comments)
- `WORKER_CONCURRENCY` - Optional (default: 1) - Number of concurrent jobs
- `WORKER_LOCK_DURATION_MS` - Optional (default: 300000) - Job lock duration in milliseconds
- `WORKER_STALLED_INTERVAL_MS` - Optional (default: 30000) - Check for stalled jobs interval in milliseconds
- `WORKER_MAX_STALLED_COUNT` - Optional (default: 1) - Max stalled detections before failing

**AI Features (optional):**
- `AI_ENABLED=true` - Enable AI globally
- `OPENAI_API_KEY` - OpenAI API key (required if AI_ENABLED=true)

## Debugging Commands

```bash
# Check environment loading
pnpm env:diag

# Start API with debug logging
LOG_LEVEL=debug pnpm api:dev

# Start Worker with debug logging and AI self-test
LOG_LEVEL=debug AI_SELF_TEST=true pnpm worker:dev

# Check specific env var
# (PowerShell)
$env:OPENAI_API_KEY.Length

# (Bash)
echo ${#OPENAI_API_KEY}
```

## Structured Log Events

### Environment
- `env.diagnostics` - Environment loading diagnostics
- `env.validation.failed` - Critical env validation failed

### AI Snippet Selection
- `snippet.selection.skip` - File skipped (debug level)
- `worker.ai.snippets.selected` - Snippets selected
- `worker.ai.fallback.no_snippets` - Fallback mode activated

### LLM Requests
- `llm.request.start` - Request started
- `llm.request.retry` - Retry attempt
- `llm.request.success` - Request succeeded
- `llm.request.fail` - Request failed
- `llm.proxy.enabled` - Proxy configuration

### AI Suggestions
- `worker.ai.suggestions.start` - Starting generation
- `worker.ai.suggestions.success` - Generation succeeded
- `worker.ai.suggestions.skip` - Skipped (with reason)
- `worker.ai.suggestions.failed` - Generation failed (with errorReason)

## Error Reason Codes

When AI suggestions fail, check the `errorReason` field:

- `ai.error.timeout` - Request timed out
- `ai.error.network` - Network error (connection refused, etc.)
- `ai.error.auth` - Authentication failed (401/403)
- `ai.error.rate_limit` - Rate limited (429)
- `ai.error.unknown` - Unknown error

## Still Having Issues?

1. **Check logs:**
   - Look for structured log events (JSON format)
   - Set `LOG_LEVEL=debug` for detailed per-file skip reasons

2. **Verify .env file:**
   - Run `pnpm env:diag`
   - Check that `envFileExists: true`
   - Verify `keysLoadedCount > 0`

3. **Test connectivity:**
   - Run `AI_SELF_TEST=true pnpm worker:dev`
   - Check for `worker.ai.self_test.success` or `worker.ai.self_test.fail`

4. **Check file allowlist:**
   - Ensure changed files match allowlist patterns
   - Check debug logs for `snippet.selection.skip` events

