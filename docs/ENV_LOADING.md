# Environment Variable Loading

This document explains how environment variables are loaded in the MRP monorepo and how to verify they're working correctly.

## Overview

The MRP monorepo uses a **centralized environment loader** located in `packages/config/src/env.ts`. This ensures:

- ✅ Deterministic `.env` file location (always from repo root)
- ✅ Works from any directory (repo root, apps/, packages/, etc.)
- ✅ Comprehensive diagnostics (no secrets logged)
- ✅ Windows/PowerShell compatibility
- ✅ Early initialization (before any code reads `process.env`)

## How It Works

### 1. Repository Root Detection

The env loader automatically finds the repository root by walking up from the current working directory until it finds:
- `pnpm-workspace.yaml` (preferred)
- `package.json` with `workspaces` field or name `mrp-monorepo`
- `.git` folder (fallback)

### 2. Environment File Location

The `.env` file is loaded from:
- `{repoRoot}/.env` (default)
- Or `ENV_FILE` environment variable (override)

### 3. Initialization

Both API and Worker call `initEnv()` as the **very first line** of their entry files, before any other imports:

```typescript
// apps/api/src/index.ts (first line)
import { initEnv } from '@mrp/config';
const { repoRoot, envFilePath, loaded } = initEnv();
```

This ensures `.env` is loaded before Prisma, Redis, or any other code reads `process.env`.

## Required Environment Variables

### API (`apps/api`)

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `GITLAB_BASE_URL` - GitLab instance URL (default: `https://gitlab.com`)
- `GITLAB_TOKEN` - GitLab API token with `api` scope
- `GITLAB_WEBHOOK_SECRET` - Secret for webhook verification
- `APP_PUBLIC_URL` - Public URL of the API (for webhook callbacks)

**Optional:**
- `LOG_LEVEL` - Logging level (default: `info`)
- `DEFAULT_TENANT_SLUG` - Default tenant slug (default: `default`)
- `PORT` - API server port (default: `3000`)
- `HOST` - API server host (default: `0.0.0.0`)

### Worker (`apps/worker`)

**Required:**
- `REDIS_URL` - Redis connection string

**Optional:**
- `DATABASE_URL` - PostgreSQL connection string (required for DB features)
- `LOG_LEVEL` - Logging level (default: `info`)
- `DEFAULT_TENANT_SLUG` - Default tenant slug (default: `default`)
- `GITLAB_BASE_URL` - GitLab instance URL (default: `https://gitlab.com`)
- `GITLAB_TOKEN` - GitLab API token with `api` scope (required for posting comments)

## GitLab Token Validation

Both API and Worker validate the GitLab token at startup (unless `NODE_ENV=test`):

- ✅ **Valid token**: Logs `gitlab.auth.ok` with username and user ID
- ❌ **Invalid token (401)**: Logs `gitlab.auth.invalid` and exits with code 1
- ❌ **Forbidden (403)**: Logs `gitlab.auth.forbidden` with hint about permissions
- ❌ **Other errors**: Logs `gitlab.auth.error` with details

**Note:** Worker will warn but not exit if `GITLAB_TOKEN` is missing (since it may only process queued jobs). API will exit if token is invalid.

## How to Verify Environment Loading

### Method 1: Check Startup Logs

When you start the API or Worker, you'll see detailed environment diagnostics:

```powershell
# Start API
pnpm api:dev

# Look for this output:
🔍 API: Environment diagnostics
   Node version: v22.x.x
   Process PID: 12345
   Environment: development
   CWD: C:\NB\MRP
   Repo root: C:\NB\MRP
   .env file: C:\NB\MRP\.env
   .env loaded: ✅
   Required keys:
     ✅ DATABASE_URL
     ✅ REDIS_URL
     ✅ GITLAB_BASE_URL
     ✅ GITLAB_TOKEN (glpa...xyz)
     ...
✅ GitLab token validated successfully
   Username: your-username
   User ID: 12345
```

### Method 2: API Debug Endpoint (Dev Only)

Query the debug endpoint to get environment diagnostics:

```powershell
# PowerShell
Invoke-RestMethod -Uri "http://localhost:3000/debug/env" | ConvertTo-Json -Depth 10

# Or with curl
curl http://localhost:3000/debug/env
```

**Note:** This endpoint is only available in development (`NODE_ENV !== 'production'`).

Response includes:
- `cwd` - Current working directory
- `repoRoot` - Detected repository root
- `envFilePath` - Path to `.env` file used
- `envFileExists` - Whether file exists
- `requiredKeys` - Status of each required key (with masked values for secrets)
- `warnings` - Any warnings (quotes, unprintable chars, etc.)

### Method 3: Health Check Endpoint

Check if the API is running and healthy:

```powershell
# PowerShell
Invoke-RestMethod -Uri "http://localhost:3000/health"

# Response:
# {
#   "ok": true,
#   "timestamp": "2025-12-30T12:00:00.000Z"
# }
```

### Method 4: Worker Env Command

Run the worker's environment check script:

```powershell
pnpm worker:env
```

This prints the same diagnostics as startup logs and exits.

## Windows PowerShell Setup

### 1. Create `.env` File

Create `.env` in the repository root (`C:\NB\MRP\.env`):

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/mrp

# Redis
REDIS_URL=redis://localhost:6379

# GitLab
GITLAB_BASE_URL=https://gitlab.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_WEBHOOK_SECRET=your-webhook-secret-here

# API
APP_PUBLIC_URL=http://localhost:3000
PORT=3000
HOST=0.0.0.0

# Optional
LOG_LEVEL=info
DEFAULT_TENANT_SLUG=default
```

**Important:** 
- Do NOT wrap values in quotes (e.g., `GITLAB_TOKEN="glpat-..."` ❌)
- Do NOT include leading/trailing whitespace
- Use LF line endings (not CRLF) to avoid unprintable character warnings

### 2. Start Services

```powershell
# Terminal 1: Start API
cd C:\NB\MRP
pnpm api:dev

# Terminal 2: Start Worker
cd C:\NB\MRP
pnpm worker:dev
```

### 3. Verify Environment

**Option A: Check Startup Logs**
- ✅ `.env loaded: ✅`
- ✅ All required keys show `✅`
- ✅ `GitLab token validated successfully`
- ⚠️ No warnings about quotes, whitespace, or unprintable chars

**Option B: Use Debug Endpoint**
```powershell
# Check environment status
Invoke-RestMethod -Uri "http://localhost:3000/debug/env" | ConvertTo-Json -Depth 10

# Check health
Invoke-RestMethod -Uri "http://localhost:3000/health"
```

### 4. Temporarily Set Environment Variables (PowerShell)

If you need to override an env var for a single session:

```powershell
# Set GITLAB_TOKEN temporarily (current session only)
$env:GITLAB_TOKEN = "glpat-your-token-here"

# Verify it's set
$env:GITLAB_TOKEN

# Start API with temporary token
pnpm api:dev

# Note: After closing the terminal, the variable is lost
# For permanent changes, edit .env file and restart terminal
```

**Important:** 
- Changes to `.env` file require restarting the terminal/process
- Temporary env vars (via `$env:VAR`) only last for the current PowerShell session
- Always restart services after editing `.env` file

## Troubleshooting

### Issue: `.env file not found`

**Symptoms:**
- Logs show `.env loaded: ❌`
- `envFileExists: false` in diagnostics

**Solutions:**
1. Verify `.env` exists at repo root: `Test-Path C:\NB\MRP\.env`
2. Check repo root detection: Look at `repoRoot` in diagnostics
3. Override path: Set `ENV_FILE` environment variable

### Issue: Missing Required Variables

**Symptoms:**
- Logs show `❌ Missing required environment variables`
- Some keys show `❌` in diagnostics

**Solutions:**
1. Check `.env` file has all required keys
2. Verify no typos in variable names
3. Ensure no quotes around values: `GITLAB_TOKEN=glpat-...` (not `GITLAB_TOKEN="glpat-..."`)

### Issue: Token Has Quotes or Whitespace

**Symptoms:**
- Warning: `GITLAB_TOKEN contains quotes or leading/trailing whitespace`

**Solutions:**
1. Remove quotes from `.env`: `GITLAB_TOKEN=glpat-...` (not `GITLAB_TOKEN="glpat-..."`)
2. Remove leading/trailing spaces
3. Check for hidden characters in your editor

### Issue: Unprintable Characters

**Symptoms:**
- Warning: `{KEY} contains unprintable characters (possible CRLF/encoding issue)`

**Solutions:**
1. Convert `.env` file to LF line endings (not CRLF)
2. In VS Code: Click "CRLF" in status bar → "LF"
3. Or use: `Get-Content .env | Set-Content -Encoding utf8 .env` (PowerShell)

### Issue: Running from Wrong Directory

**Symptoms:**
- Wrong `repoRoot` detected
- `.env` file not found

**Solutions:**
- Always run commands from repo root: `cd C:\NB\MRP`
- Or ensure you're in a subdirectory (env loader walks up automatically)

### Issue: Environment Variables Not Loading

**Symptoms:**
- Diagnostics show keys as `❌` even though `.env` has them
- `$env:GITLAB_TOKEN` is empty in PowerShell even though `.env` has it

**Solutions:**
1. Check `.env` file encoding (should be UTF-8)
2. Verify no syntax errors (missing `=`, etc.)
3. Check for duplicate keys (last one wins)
4. **Restart the terminal/process** after editing `.env` (env is loaded once at startup)
5. Verify via `/debug/env` endpoint that the API sees the values
6. If using PowerShell, ensure you're not relying on `$env:VAR` - use `.env` file instead

### Issue: GitLab Token Validation Fails

**Symptoms:**
- `gitlab.auth.invalid` (401) or `gitlab.auth.forbidden` (403) in logs
- API/Worker exits with code 1

**Solutions:**
1. Verify `GITLAB_TOKEN` in `.env` is correct (no quotes, no whitespace)
2. Check token has `api` scope in GitLab
3. For 403: Ensure token user has access to the projects you're trying to access
4. Test token manually: `curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" https://gitlab.com/api/v4/user`
5. Restart terminal after editing `.env` file

### Issue: ReviewRun "Not Found" Errors

**Symptoms:**
- Worker logs: `ReviewRun not found for job {id}`
- Jobs fail with "ReviewRun not found"

**Solutions:**
- This has been fixed! The worker now:
  - Looks up ReviewRun by `tenantId + provider + projectId + mrIid + headSha` (any status)
  - Only retries on transient errors (429, 5xx, timeouts)
  - Stops retrying on auth errors (401/403/404)
  - Logs `worker.reviewrun.missing` with all identifiers if not found
- If you still see this, check that the ReviewRun was created before the job was enqueued

## Security Notes

- **Never log raw tokens/secrets**: The diagnostics mask sensitive values (first 4 + last 4 chars)
- **Never commit `.env`**: Ensure `.env` is in `.gitignore`
- **Use environment-specific files**: Consider `.env.local`, `.env.development`, etc. (not yet supported, but planned)

## Advanced: Override Env File Path

To use a different `.env` file:

```powershell
# PowerShell
$env:ENV_FILE = "C:\path\to\custom\.env"
pnpm api:dev
```

Or in code:
```typescript
import { initEnv } from '@mrp/config';
initEnv('/custom/path/to/.env');
```

## Next Steps

- [ ] Support `.env.local`, `.env.development`, `.env.production` (priority order)
- [ ] Add validation for specific env var formats (URLs, tokens, etc.)
- [ ] Add schema validation with Zod or similar
- [ ] Support env var expansion (`${VAR}` syntax)

