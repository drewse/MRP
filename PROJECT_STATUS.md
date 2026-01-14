# MRP Monorepo - Project Status & Context Pack

**Last Updated:** 2025-01-XX  
**Status:** Active Development

---

## TL;DR Status

- ✅ **3 apps**: API (Fastify), Portal (Next.js), Worker (BullMQ)
- ✅ **8 packages**: Core queue logic, DB (Prisma), GitLab client, Checks, Knowledge, LLM, Privacy, Storage
- ✅ **Production domains**: `api.quickiter.com`, `portal.quickiter.com` (via Cloudflare Tunnel - config location UNKNOWN)
- ✅ **Queue system**: BullMQ with Redis, jobId includes `reviewRunId` for dedupe prevention
- ✅ **Worker reliability**: RUNNING status set immediately, timeouts on external calls, guaranteed finalization via finally block
- ⚠️ **Worker config**: Currently `concurrency: 5` (requirements suggested 1 for stability)

---

## Architecture Map

### Apps

| App | Purpose | Entry Point | Dev Command | Port |
|-----|---------|-------------|-------------|------|
| **api** | Fastify REST API server | `apps/api/src/index.ts` | `pnpm api:dev` | 3001 (or `PORT` env) |
| **portal** | Next.js frontend | `apps/portal/src/app/page.tsx` | `pnpm portal:dev` | 3000 |
| **worker** | BullMQ job processor | `apps/worker/src/index.ts` | `pnpm worker:dev` | N/A |

### Packages

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| **@mrp/core** | Queue types, jobId builder | `buildReviewJobId()`, `QUEUE_NAME`, `ReviewMrJobPayload` |
| **@mrp/config** | Centralized env loading | `initEnv()`, `getEnvDiagnostics()` |
| **@mrp/db** | Prisma client, tenant helpers | `prisma`, `getOrCreateTenantBySlug()` |
| **@mrp/gitlab** | GitLab REST API client | `createGitLabClient()` |
| **@mrp/checks** | Deterministic code checks | `runChecks()`, check registry |
| **@mrp/knowledge** | GOLD MR knowledge base | `promoteToGold()`, `findGoldPrecedents()` |
| **@mrp/llm** | OpenAI client wrapper | `createLlmClient()`, `generateSuggestions()` |
| **@mrp/privacy** | Code snippet selection/redaction | `selectSnippets()` |
| **@mrp/storage** | Cloudflare R2/S3 storage | `presignUpload()`, `completeUpload()` |

---

## Running Locally

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
- PostgreSQL (via Docker or local)
- Redis (via Docker or local)

### Setup

1. **Start infrastructure:**
   ```bash
   pnpm docker:up
   ```
   Starts PostgreSQL (port 5432) and Redis (port 6379) via Docker Compose.

2. **Create `.env` at repo root:**
   ```bash
   # Database
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mrp
   
   # Redis
   REDIS_URL=redis://localhost:6379
   
   # GitLab
   GITLAB_BASE_URL=https://gitlab.com
   GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
   GITLAB_WEBHOOK_SECRET=your-webhook-secret
   
   # API
   APP_PUBLIC_URL=http://localhost:3001
   PORT=3001
   HOST=0.0.0.0
   
   # Portal Auth (pilot)
   PORTAL_ADMIN_TOKEN=pilot-admin-token-12345
   
   # Storage (Cloudflare R2 example)
   STORAGE_PROVIDER=r2
   STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com
   STORAGE_REGION=auto
   STORAGE_BUCKET=mrp-uploads-prod
   STORAGE_ACCESS_KEY_ID=your-key
   STORAGE_SECRET_ACCESS_KEY=your-secret
   
   # Optional: AI
   AI_ENABLED=true
   OPENAI_API_KEY=sk-...
   ```

3. **Create `apps/portal/.env.local`:**
   ```bash
   NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
   NEXT_PUBLIC_DEFAULT_TENANT_SLUG=dev
   NEXT_PUBLIC_PORTAL_ADMIN_TOKEN=pilot-admin-token-12345
   ```

4. **Run database migrations:**
   ```bash
   cd packages/db
   pnpm prisma migrate deploy
   # Or for dev:
   pnpm prisma migrate dev
   ```

### Start Services

**Terminal 1 - API:**
```bash
pnpm api:dev
```
Listens on `http://localhost:3001` (or `PORT` env var).

**Terminal 2 - Worker:**
```bash
pnpm worker:dev
```
Processes jobs from BullMQ queue `mrp-review`.

**Terminal 3 - Portal:**
```bash
pnpm portal:dev
```
Runs Next.js dev server on `http://localhost:3000`.

### Verify Setup

```bash
# Check environment loading
pnpm env:diag

# Health check
curl http://localhost:3001/health

# Check queue (dev only)
curl http://localhost:3001/debug/queue/inspect?limit=5
```

---

## Environment Variables

### API/Worker (`.env` at repo root)

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `DATABASE_URL` | ✅ | PostgreSQL connection | `postgresql://user:pass@localhost:5432/mrp` |
| `REDIS_URL` | ✅ | Redis connection | `redis://localhost:6379` |
| `GITLAB_TOKEN` | ✅ | GitLab API token | `glpat-...` |
| `GITLAB_WEBHOOK_SECRET` | ✅ | Webhook verification | `secret-123` |
| `APP_PUBLIC_URL` | ✅ | Public API URL | `https://api.quickiter.com` or `http://localhost:3001` |
| `PORT` | ❌ | API port (default: 3000) | `3001` |
| `HOST` | ❌ | API host (default: 0.0.0.0) | `0.0.0.0` |
| `PORTAL_ADMIN_TOKEN` | ⚠️ | Portal auth token (required in non-dev) | `pilot-admin-token-12345` |
| `STORAGE_PROVIDER` | ✅ | `r2` or `s3` | `r2` |
| `STORAGE_ENDPOINT` | ✅ | Storage endpoint URL | `https://abc123.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | ✅ | Storage region | `auto` |
| `STORAGE_BUCKET` | ✅ | Bucket name | `mrp-uploads-prod` |
| `STORAGE_ACCESS_KEY_ID` | ✅ | Access key | `...` |
| `STORAGE_SECRET_ACCESS_KEY` | ✅ | Secret key | `...` |
| `AI_ENABLED` | ❌ | Enable AI features | `true` |
| `OPENAI_API_KEY` | ⚠️ | Required if `AI_ENABLED=true` | `sk-...` |
| `LOG_LEVEL` | ❌ | Logging level | `info`, `debug` |
| `WORKER_CONCURRENCY` | ❌ | Worker concurrent jobs (default: 1) | `1` |
| `WORKER_LOCK_DURATION_MS` | ❌ | Job lock duration in ms (default: 300000) | `300000` |
| `WORKER_STALLED_INTERVAL_MS` | ❌ | Stalled check interval in ms (default: 30000) | `30000` |
| `WORKER_MAX_STALLED_COUNT` | ❌ | Max stalled detections (default: 1) | `1` |

### Portal (`apps/portal/.env.local`)

| Variable | Required | Purpose | Example |
|----------|----------|---------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | ❌ | API URL (default: `https://api.quickiter.com`) | `http://localhost:3001` |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | ❌ | Default tenant | `dev` |
| `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` | ⚠️ | Must match API's `PORTAL_ADMIN_TOKEN` | `pilot-admin-token-12345` |

**Note:** Portal also stores config in `localStorage` (tenant slug, admin token, API base URL) via Connect page.

---

## API Surface

### Public Endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/health` | None | Health check |
| `POST` | `/webhooks/gitlab` | Webhook secret | GitLab webhook handler |

### Portal-Protected Endpoints (require `X-MRP-Admin-Token` + `X-MRP-Tenant-Slug`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/tenant/settings` | `portalAuthPreHandler` | Get tenant settings |
| `PUT` | `/tenant/settings` | `portalAuthPreHandler` | Update tenant settings |
| `POST` | `/uploads/presign` | `portalAuthPreHandler` | Get presigned upload URL |
| `POST` | `/uploads/complete` | `portalAuthPreHandler` | Complete upload |
| `GET` | `/uploads` | `portalAuthPreHandler` | List uploads |
| `GET` | `/uploads/:uploadId` | `portalAuthPreHandler` | Get upload details |
| `GET` | `/merge-requests` | `portalAuthPreHandler` | List MRs (query: `limit`, `offset`, `repositoryId`) |
| `GET` | `/merge-requests/:projectId/:mrIid` | `portalAuthPreHandler` | Get MR with latest review |
| `POST` | `/merge-requests/:projectId/:mrIid/trigger-review` | `portalAuthPreHandler` | Trigger review (body: `{ headSha?: string }`) |
| `GET` | `/review-runs/:reviewRunId` | `portalAuthPreHandler` | Get review run detail |

### Debug Endpoints (dev only, `NODE_ENV !== 'production'`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| `GET` | `/debug/env` | None | Environment diagnostics |
| `GET` | `/debug/queue/peek?limit=10` | None | Peek at queue jobs (newest first, includes state + reviewRunId) |
| `GET` | `/debug/queue/inspect?limit=20` | None | Detailed queue inspection (counts, jobs by state, Redis info) |
| `POST` | `/debug/enqueue` | None | Manually enqueue test job |

### Auth Model

**PreHandler:** `portalAuthPreHandler` (defined in `apps/api/src/index.ts:811`)

- Checks `X-MRP-Admin-Token` header against `PORTAL_ADMIN_TOKEN` env var
- Uses `constantTimeCompare()` for timing-safe comparison
- In dev: token optional if `PORTAL_ADMIN_TOKEN` not set
- In non-dev: token required
- Also reads `X-MRP-Tenant-Slug` header (defaults to `DEFAULT_TENANT_SLUG` or `'dev'`)

### CORS Configuration

**File:** `apps/api/src/index.ts:386-421`

- **Allowed Origins:**
  - `https://api.quickiter.com`
  - `https://portal.quickiter.com`
  - `http://localhost:3000`
  - `http://127.0.0.1:3000`
  - Requests with no origin (mobile apps, Postman)

- **Allowed Methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`

- **Allowed Headers:**
  - `Content-Type`
  - `Authorization`
  - `X-MRP-Admin-Token`
  - `X-MRP-Tenant-Slug`
  - (case-insensitive variants)

- **Registration Order:** CORS registered early (line 384), before routes

---

## Worker + Queue

### Queue Configuration

- **Queue Name:** `mrp-review` (defined in `packages/core/src/queue.ts:16`)
- **Queue Prefix:** `bull` (default, no explicit prefix set)
- **Redis Connection:** From `REDIS_URL` env var
- **Job Name:** `review-mr`

### JobId Strategy

**Function:** `buildReviewJobId()` in `packages/core/src/queue.ts:25`

**Format:**
```
${tenantSlug}__${provider}__${projectId}__${mrIid}__${headSha}__${reviewRunId}
```

**Dedupe Prevention:**
- If `reviewRunId` is present in payload, it's appended to jobId
- This ensures each ReviewRun gets a unique job, preventing BullMQ deduplication
- Manual triggers (portal) always include `reviewRunId`
- Webhook triggers also include `reviewRunId` (added in recent fix)

**Enqueue Site:** `apps/api/src/queue.ts:97` - `enqueueReviewJob()`
- Computes jobId using `buildReviewJobId(payload)`
- Explicitly passes `{ jobId, removeOnComplete: true, removeOnFail: false }` to `queue.add()`
- Logs computed vs actual jobId, warns on mismatch

### ReviewRun State Transitions

**File:** `apps/worker/src/index.ts`

**Flow:**
1. **QUEUED** → Set when ReviewRun created (API)
2. **RUNNING** → Set immediately after ReviewRun lookup (before any external calls)
   - Location: `apps/worker/src/index.ts:578-601`
   - Always updates (even if already RUNNING) to refresh `startedAt`
3. **SUCCEEDED** → Set after checks complete successfully
   - Location: `apps/worker/src/index.ts:928-937`
   - Includes `finishedAt`, `score`, `summary`
4. **FAILED** → Set on error or in finally block
   - Location: Multiple catch blocks + finally block (line 1831)
   - Includes `finishedAt`, `error` (sanitized)

**Guaranteed Finalization:**
- Finally block (line 1831) ensures ReviewRun is always SUCCEEDED or FAILED
- If status is not final, forces FAILED with "Unexpected termination" error

### Timeouts

**Helper:** `withTimeout()` in `apps/worker/src/index.ts:372`

**Applied To:**
- GitLab API calls: 20-30s
  - `getMergeRequestChanges()`: 30s
  - `getMergeRequest()`: 30s
  - `getMergeRequestApprovals()`: 20s
  - `createMergeRequestNote()`: 30s
  - `updateMergeRequestNote()`: 30s
- LLM calls: 120s
  - `generateSuggestions()`: 120s

**Error Handling:**
- Timeouts throw `TimeoutError` with label
- Errors sanitized via `safeErrorMessage()` (removes tokens/passwords)

### Worker Configuration

**File:** `apps/worker/src/index.ts:1990-1996`

**Environment Variables:**
- `WORKER_CONCURRENCY` (default: 1) - Number of concurrent jobs
- `WORKER_LOCK_DURATION_MS` (default: 300000 = 5 min) - Job lock duration
- `WORKER_STALLED_INTERVAL_MS` (default: 30000 = 30s) - Check for stalled jobs interval
- `WORKER_MAX_STALLED_COUNT` (default: 1) - Max stalled detections before failing

**Current Settings:**
- `concurrency`: From `WORKER_CONCURRENCY` env var (default: 1)
- `lockDuration`: From `WORKER_LOCK_DURATION_MS` env var (default: 300000ms = 5 min)
- `stalledInterval`: From `WORKER_STALLED_INTERVAL_MS` env var (default: 30000ms = 30s)
- `maxStalledCount`: From `WORKER_MAX_STALLED_COUNT` env var (default: 1)
- `connection`: `redisConnection`

**Helper Function:**
- `readIntEnv()` in `apps/worker/src/index.ts:367-408` - Safely parses int env vars with defaults and validation

**Event Handlers:**
- `active` - logs job.id + reviewRunId
- `completed` - logs job.id + reviewRunId + duration
- `failed` - logs job.id + reviewRunId + safe error message
- `stalled` - warns when job stalls

**Startup Logging:**
- Redis URL (redacted), host, port, DB
- Database URL (redacted), host, port, database name
- Queue name, prefix
- Logged once at startup for comparison with API

---

## Portal Pages

### `/` (Connect Page)

**File:** `apps/portal/src/app/page.tsx`

**Features:**
- Connection configuration form
- Fields: Tenant Slug, Admin Token, API Base URL (optional)
- Stores config in `localStorage` (keys: `mrp_portal_tenant_slug`, `mrp_portal_admin_token`, `mrp_portal_api_base_url`)
- "Test Connection" button calls `api.getSettings()`
- Defaults from env: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN`

### `/reviews` (Reviews List)

**File:** `apps/portal/src/app/reviews/page.tsx`

**Features:**
- Lists merge requests with latest review status
- Auto-refresh: Polls every 10 seconds
- Manual refresh button
- Race-safe: Uses `AbortController` to cancel in-flight requests
- Mount guard: `isMountedRef` prevents state updates after unmount
- Displays: Title, Repo, Author, State, Latest Review Status, Score, Updated time
- "View" link to `/reviews/[reviewRunId]`

**Polling Behavior:**
- Initial load on mount
- Interval: 10 seconds
- Aborts previous request before starting new one
- Cleans up on unmount

### `/reviews/[reviewRunId]` (Review Detail)

**File:** `apps/portal/src/app/reviews/[reviewRunId]/page.tsx`

**Features:**
- Displays review run details: status, score, summary, error
- Check results with filtering (all/FAIL/WARN/PASS)
- AI suggestions
- Posted comments
- "Trigger Review" button (disabled if latest review is QUEUED/RUNNING)
- Polling: Every 3 seconds when status is QUEUED/RUNNING
- Stuck warning: Shows alert if QUEUED > 30s with link to `/debug/queue/peek`

**Polling Behavior:**
- Polls every 3s when status is QUEUED or RUNNING
- Stops when status is SUCCEEDED or FAILED
- Race-safe: Uses `requestSeqRef` to ignore stale responses
- Abort-safe: Uses `AbortController` for cleanup
- Non-blocking errors: Shows small error message, doesn't replace UI

**Trigger Button:**
- Confirms before triggering
- Stops polling immediately
- Navigates to new review run after trigger
- Shows success message for 3s

**Dev-Only Logging:**
- `console.debug('[Poll] Review Run Status', ...)` in development mode
- Logs URL, reviewRunId, status, response status, sequence number

### API Base URL Resolution

**File:** `apps/portal/src/lib/api-client.ts:46-52`

**Priority:**
1. `localStorage.getItem('mrp_portal_api_base_url')` (if set)
2. `process.env.NEXT_PUBLIC_API_BASE_URL` (build-time env var)
3. Fallback: `'https://api.quickiter.com'`

**Note:** Portal stores API base URL in localStorage via Connect page, allowing per-user override.

---

## Recent Changes Summary

### Queue Dedupe Fix (2025-01-XX)

**Problem:** Triggering review twice would dedupe jobs, leaving second ReviewRun stuck in QUEUED.

**Changes:**
1. **Webhook handler** (`apps/api/src/gitlab-webhook.ts:461`): Added `reviewRunId: reviewRun.id` to job payload
2. **Trigger endpoint** (`apps/api/src/index.ts:1775`): Already had `reviewRunId` in payload
3. **Enqueue function** (`apps/api/src/queue.ts:197-201`): Explicitly passes `jobId` to `queue.add()`
4. **Guard** (`apps/api/src/queue.ts:102-115`): Dev-only assertion that jobId includes reviewRunId when present

### Worker Reliability Fix (2025-01-XX)

**Problem:** Jobs active in queue but ReviewRuns stuck in QUEUED forever.

**Changes:**
1. **RUNNING update** (`apps/worker/src/index.ts:578-601`): Moved to happen immediately after ReviewRun lookup, before any external calls
2. **Timeouts** (`apps/worker/src/index.ts:372-390`): Added `withTimeout()` helper, wrapped all GitLab/LLM calls
3. **Guaranteed finalization** (`apps/worker/src/index.ts:1831-1909`): Added finally block that forces FAILED if status not final
4. **Error sanitization** (`apps/worker/src/index.ts:392-408`): Added `safeErrorMessage()` to remove secrets
5. **Worker config** (`apps/worker/src/index.ts:1990-1996`): Made configurable via env vars (concurrency defaults to 1, added lockDuration/stalledInterval/maxStalledCount)

### Worker Configuration Hardening (2025-01-XX)

**Problem:** Hardcoded concurrency and missing BullMQ reliability settings.

**Changes:**
1. **Env-driven concurrency** (`apps/worker/src/index.ts:367-408`): Added `readIntEnv()` helper, `WORKER_CONCURRENCY` env var (default: 1)
2. **BullMQ reliability settings** (`apps/worker/src/index.ts:1990-1996`): Added `lockDuration`, `stalledInterval`, `maxStalledCount` via env vars with safe defaults
3. **Startup logging** (`apps/worker/src/index.ts:505-530`): Logs effective worker config values (concurrency, lockDuration, etc.) without secrets
4. **Documentation** (`docs/pilot-env.md`, `docs/LOCAL_DEV_TROUBLESHOOTING.md`): Added env var documentation

### Debug Endpoints (2025-01-XX)

**Added:**
1. `/debug/queue/peek` (`apps/api/src/index.ts:451-516`): Lists jobs newest-first, includes state + reviewRunId
2. `/debug/queue/inspect` (`apps/api/src/index.ts:528-635`): Detailed queue info (counts, jobs by state, Redis/queue config)

**Enhanced:**
- Startup logging for queue config (Redis URL, queue name, prefix)
- Worker startup logging for DB connection info

---

## Known Issues / Next Steps

### Known Issues

1. **Cloudflare Tunnel Config:** Location unknown. Docs mention `api.quickiter.com` and `portal.quickiter.com` but no config file found in repo. **Status:** UNKNOWN - may be external/managed.

2. **Portal API Base URL Default:** Connect page defaults to `http://localhost:3000` but should be `http://localhost:3001` (API port). **File:** `apps/portal/src/app/page.tsx:21` - uses `process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'` but should default to 3001.

### Next Steps

1. **Fix Portal Default:** Update Connect page default API URL to `http://localhost:3001`.

3. **Document Cloudflare Tunnel:** If tunnel config is external, document where it lives and how to update ingress mappings.

4. **Test End-to-End:** Run acceptance tests from requirements:
   - Trigger twice, verify both jobs enqueued with different IDs
   - Verify ReviewRun transitions QUEUED → RUNNING within 1-2s
   - Verify finalization (SUCCEEDED/FAILED) always happens

5. **Monitor Worker Logs:** Watch for:
   - `reviewrun.status.updated` events (should happen immediately)
   - `worker.reviewrun.force_finalize` warnings (indicates missing finalization)
   - Timeout errors from `withTimeout()`

---

## Context Pack for New ChatGPT

**Paste this into a new ChatGPT thread:**

```
MRP Monorepo - Quick Context

APPS:
- api (Fastify): Port 3001, entry: apps/api/src/index.ts, dev: pnpm api:dev
- portal (Next.js): Port 3000, entry: apps/portal/src/app/page.tsx, dev: pnpm portal:dev  
- worker (BullMQ): Entry: apps/worker/src/index.ts, dev: pnpm worker:dev

PACKAGES:
- @mrp/core: Queue types, buildReviewJobId() for jobId generation
- @mrp/config: Centralized .env loading (initEnv() at repo root)
- @mrp/db: Prisma client, getOrCreateTenantBySlug()
- @mrp/gitlab: GitLab REST API client with retries/timeouts
- @mrp/checks: Deterministic code checks
- @mrp/knowledge: GOLD MR knowledge base
- @mrp/llm: OpenAI wrapper
- @mrp/privacy: Code snippet selection/redaction
- @mrp/storage: R2/S3 storage

QUEUE:
- Name: mrp-review, Redis from REDIS_URL
- JobId format: ${tenantSlug}__${provider}__${projectId}__${mrIid}__${headSha}__${reviewRunId}
- reviewRunId in jobId prevents dedupe (critical for manual triggers)
- Enqueue: apps/api/src/queue.ts:enqueueReviewJob()
- Worker: apps/worker/src/index.ts (BullMQ Worker)

REVIEWRUN STATES:
- QUEUED (created) → RUNNING (immediate after lookup) → SUCCEEDED/FAILED (always via finally block)
- Worker sets RUNNING before any external calls (GitLab/LLM)
- All external calls wrapped with timeouts (20-30s GitLab, 120s LLM)
- Finally block guarantees finalization (forces FAILED if not SUCCEEDED/FAILED)

API AUTH:
- Portal endpoints require X-MRP-Admin-Token header (matches PORTAL_ADMIN_TOKEN env)
- Also reads X-MRP-Tenant-Slug header (defaults to DEFAULT_TENANT_SLUG or 'dev')
- PreHandler: portalAuthPreHandler in apps/api/src/index.ts:811

CORS:
- Allowed origins: api.quickiter.com, portal.quickiter.com, localhost:3000, 127.0.0.1:3000
- Allowed headers: Content-Type, X-MRP-Admin-Token, X-MRP-Tenant-Slug

PORTAL:
- API base URL: localStorage → NEXT_PUBLIC_API_BASE_URL → 'https://api.quickiter.com'
- Reviews list: Auto-refresh every 10s, race-safe with AbortController
- Review detail: Polls every 3s when QUEUED/RUNNING, shows stuck warning if QUEUED > 30s

ENV:
- .env at repo root (API/Worker)
- apps/portal/.env.local (Portal, Next.js convention)
- Centralized loader: @mrp/config (initEnv() called first in each app)

DEBUG ENDPOINTS (dev only):
- GET /debug/env - Environment diagnostics
- GET /debug/queue/peek?limit=10 - Queue jobs (newest first)
- GET /debug/queue/inspect?limit=20 - Detailed queue info

KNOWN ISSUES:
- Cloudflare tunnel config location: UNKNOWN
- Portal default API URL: localhost:3000 (should be 3001)

WORKER CONFIG (env vars):
- WORKER_CONCURRENCY (default 1)
- WORKER_LOCK_DURATION_MS (default 300000)
- WORKER_STALLED_INTERVAL_MS (default 30000)
- WORKER_MAX_STALLED_COUNT (default 1)
```

---

## Verification Commands

### List Merge Requests

```bash
curl.exe -X GET "http://localhost:3001/merge-requests?limit=10" `
  -H "Content-Type: application/json" `
  -H "X-MRP-Tenant-Slug: dev" `
  -H "X-MRP-Admin-Token: pilot-admin-token-12345"
```

### View Review Run

```bash
curl.exe -X GET "http://localhost:3001/review-runs/<reviewRunId>" `
  -H "Content-Type: application/json" `
  -H "X-MRP-Tenant-Slug: dev" `
  -H "X-MRP-Admin-Token: pilot-admin-token-12345"
```

### Trigger Review

```bash
curl.exe -X POST "http://localhost:3001/merge-requests/77381939/2/trigger-review" `
  -H "Content-Type: application/json" `
  -H "X-MRP-Tenant-Slug: dev" `
  -H "X-MRP-Admin-Token: pilot-admin-token-12345" `
  -d "{}"
```

**Expected Response:**
```json
{
  "ok": true,
  "tenantId": "...",
  "repositoryId": "...",
  "mergeRequestId": "...",
  "reviewRunId": "...",
  "jobId": "dev__gitlab__77381939__2__<headSha>__<reviewRunId>",
  "headSha": "..."
}
```

**Verify:**
- `reviewRunId` is unique for each trigger
- `jobId` ends with `__<reviewRunId>`
- Immediately check `/review-runs/<reviewRunId>` - should show RUNNING within 1-2s

### Inspect Queue

```bash
# Peek at jobs
curl.exe "http://localhost:3001/debug/queue/peek?limit=10"

# Detailed inspection
curl.exe "http://localhost:3001/debug/queue/inspect?limit=10"
```

**Expected:**
- `waiting` or `active` includes both new jobIds
- Each job has `data.reviewRunId` populated
- `counts.waiting` or `counts.active` reflects new jobs

---

**End of Document**

