# MRP Technical Architecture Summary

**Last Updated:** 2025-01-XX  
**Purpose:** Concise technical overview for engineers

---

## 1. Apps & Packages

### Apps

| App | Purpose | Entry Point | Port |
|-----|---------|-------------|------|
| **api** | Fastify REST API server | `apps/api/src/index.ts` | 3001 (or `PORT` env) |
| **portal** | Next.js frontend (React) | `apps/portal/src/app/page.tsx` | 3000 |
| **worker** | BullMQ job processor | `apps/worker/src/index.ts` | N/A |

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

## 2. Trigger Review Flow

### Entry Point: HTTP Endpoint

**Route:** `POST /merge-requests/:projectId/:mrIid/trigger-review`  
**File:** `apps/api/src/index.ts:1564-1967`  
**Auth:** `portalAuthPreHandler` (requires `X-MRP-Admin-Token` header)

**Request Body:**
```typescript
{ headSha?: string }  // Optional, defaults to MR's current SHA
```

**Flow:**
1. Validates `projectId` (numeric) and `mrIid` (positive integer)
2. Fetches MR details from GitLab API
3. Resolves/creates `Tenant` by slug (from header or `DEFAULT_TENANT_SLUG`)
4. Upserts `Repository` (fetches project info if missing)
5. Upserts `MergeRequest` with fresh GitLab data
6. Creates `ReviewRun` with status `QUEUED`
7. Enqueues job to BullMQ queue

### DB Writes (API Layer)

**Location:** `apps/api/src/index.ts:1833-1844`

1. **ReviewRun.create()** - Creates new ReviewRun:
   - `tenantId`, `mergeRequestId`, `headSha`
   - `status: 'QUEUED'`
   - `score: null`, `summary: null`, `error: null`

2. **Repository.upsert()** - Ensures repository exists (if missing, fetches from GitLab)

3. **MergeRequest.upsert()** - Updates MR with latest GitLab data

### Queue/Worker Trigger

**Enqueue Function:** `apps/api/src/queue.ts:134-299` - `enqueueReviewJob()`

**JobId Format:**
```
${tenantSlug}__${provider}__${projectId}__${mrIid}__${headSha}__${reviewRunId}
```

**Key Points:**
- `reviewRunId` in jobId prevents BullMQ deduplication
- Explicit `jobId` passed to `queue.add()` with `removeOnComplete: true`
- Queue name: `mrp-review` (defined in `packages/core/src/queue.ts`)

**Worker Processing:** `apps/worker/src/index.ts:608-1987`

1. **ReviewRun Lookup** (line 653-719):
   - If `reviewRunId` present: fetch by ID (manual trigger)
   - Else: lookup by MR + headSha (legacy webhook)
   - Verifies tenant match (security check)

2. **Status Update: QUEUED → RUNNING** (line 720-760):
   - **CRITICAL:** Happens immediately after lookup, before any external calls
   - Updates `startedAt` timestamp
   - Always updates (even if already RUNNING) to refresh timestamp

3. **GitLab API Calls** (wrapped with timeouts):
   - `getMergeRequestChanges()` - 30s timeout
   - `getMergeRequest()` - 30s timeout
   - `getMergeRequestApprovals()` - 20s timeout

4. **Deterministic Checks** (line 969-994):
   - Loads tenant `CheckConfig` records
   - Calls `runChecks()` from `@mrp/checks`
   - Persists `ReviewCheckResult` rows

5. **AI Suggestions** (if enabled, line 1200-1500):
   - Loads `TenantAiConfig` (checks `enabled` flag)
   - Selects code snippets via `@mrp/privacy`
   - Finds GOLD precedents via `@mrp/knowledge`
   - Calls `generateSuggestions()` from `@mrp/llm` - **120s timeout**
   - Persists `AiSuggestion` rows

6. **Post Comments to GitLab** (line 1600-1750):
   - Creates/updates summary comment
   - Creates inline comments for check results
   - Persists `PostedComment` rows

7. **Status Update: RUNNING → SUCCEEDED** (line 1808-1810):
   - Updates `finishedAt`, `score`, `summary`
   - Sets `finalStatus = 'SUCCEEDED'`

8. **Error Handling** (line 1811-1935):
   - Catches errors, sanitizes messages (removes tokens)
   - Updates ReviewRun to `FAILED` with error message
   - Sets `finalStatus = 'FAILED'`

9. **Guaranteed Finalization** (line 1937-1987):
   - Finally block ensures ReviewRun is always `SUCCEEDED` or `FAILED`
   - If status not final, forces `FAILED` with "Unexpected termination" error

### AI Call Details

**Location:** `apps/worker/src/index.ts:1400-1404`

**LLM Client:** `packages/llm/src/client.ts`

**Flow:**
1. Builds prompt with:
   - MR context (title, description, projectId, mrIid, headSha)
   - Failing check results
   - Code snippets (redacted via `@mrp/privacy`)
   - GOLD precedents (if found via `@mrp/knowledge`)
2. Calls OpenAI API with:
   - Model: from `TenantAiConfig.model` (default: `gpt-4o-mini`)
   - Temperature: 0.3
   - Max tokens: 2000
   - Response format: JSON object
3. Validates response with Zod schema
4. Normalizes `suggestedFix` (array → markdown string)
5. Persists `AiSuggestion` rows

**Timeout:** 120 seconds

### Result Persistence

**ReviewCheckResult** (line 997-1020):
- One row per check result
- Fields: `checkKey`, `category`, `status` (PASS/WARN/FAIL), `severity`, `message`, `filePath`, `lineStart`, `lineEnd`, `evidence`, `suggestion`

**AiSuggestion** (line 1500-1550):
- One row per AI suggestion
- Fields: `checkKey`, `severity`, `title`, `rationale`, `suggestedFix`, `files` (JSON array)

**PostedComment** (line 1600-1750):
- One row per comment posted to GitLab
- Fields: `provider`, `providerId`, `type` (SUMMARY/INLINE), `filePath`, `line`, `body`, `aiIncluded`

**ReviewRun** (final update, line 1808-1810):
- Updates: `status: 'SUCCEEDED'`, `finishedAt`, `score`, `summary`

---

## 3. Database Schema

### Repository Model

**Table:** `repositories`  
**File:** `packages/db/prisma/schema.prisma:34-50`

```prisma
model Repository {
  id            String   @id @default(cuid())
  tenantId      String
  provider      String   // "gitlab"
  providerRepoId String  // GitLab project ID
  namespace     String
  name          String
  defaultBranch String   @default("main")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  mergeRequests MergeRequest[]
  
  @@unique([tenantId, provider, providerRepoId])
}
```

### MergeRequest Model

**Table:** `merge_requests`  
**File:** `packages/db/prisma/schema.prisma:52-74`

```prisma
model MergeRequest {
  id            String   @id @default(cuid())
  tenantId      String
  repositoryId  String
  iid           Int      // GitLab MR IID
  title         String
  author        String
  sourceBranch  String
  targetBranch  String
  state         String   // "opened", "merged", "closed"
  webUrl        String
  lastSeenSha   String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  reviewRuns    ReviewRun[]
  
  @@unique([tenantId, repositoryId, iid])
}
```

### ReviewRun Model

**Table:** `review_runs`  
**File:** `packages/db/prisma/schema.prisma:76-95`

```prisma
model ReviewRun {
  id             String   @id @default(cuid())
  tenantId       String
  mergeRequestId String
  headSha        String
  status         String   // QUEUED | RUNNING | SUCCEEDED | FAILED
  score          Int?     // 0-100
  summary        String?  // Markdown summary
  error          String?  // Error message if failed
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime @default(now())
  checkResults   ReviewCheckResult[]
  postedComments PostedComment[]
  aiSuggestions AiSuggestion[]
}
```

### ReviewCheckResult Model

**Table:** `review_check_results`  
**File:** `packages/db/prisma/schema.prisma:97-116`

```prisma
model ReviewCheckResult {
  id            String   @id @default(cuid())
  tenantId      String
  reviewRunId   String
  checkKey      String   // e.g., "large-diff", "todo-fixme"
  category      String   // e.g., "code-quality", "security"
  status        String   // PASS | FAIL | NA
  severity      String   // INFO | WARN | BLOCKER
  message       String
  filePath      String?
  lineStart     Int?
  lineEnd       Int?
  evidence      String?  // Additional context
  suggestion    String?  // Suggested fix
  createdAt     DateTime @default(now())
}
```

### Related Models

**AiSuggestion** (`packages/db/prisma/schema.prisma:190-205`):
- `reviewRunId`, `checkKey`, `severity`, `title`, `rationale`, `suggestedFix`, `files` (JSON)

**PostedComment** (`packages/db/prisma/schema.prisma:118-135`):
- `reviewRunId`, `provider`, `providerId`, `type`, `filePath`, `line`, `body`, `aiIncluded`

**Tenant** (`packages/db/prisma/schema.prisma:13-32`):
- Root entity, all other models cascade delete on tenant deletion

---

## 4. Frontend Routes/Pages

### `/` (Connect Page)

**File:** `apps/portal/src/app/page.tsx`

**Features:**
- Connection configuration form
- Fields: Tenant Slug, Admin Token, API Base URL
- Stores config in `localStorage`
- "Test Connection" button calls `api.getSettings()`

### `/reviews` (Reviews List)

**File:** `apps/portal/src/app/reviews/page.tsx`

**Features:**
- Lists merge requests with latest review status
- Auto-refresh: Polls every 10 seconds
- Manual refresh button
- Displays: Title, Repo, Author, State, Latest Review Status, Score, Updated time
- "View" link to `/reviews/[reviewRunId]`
- Recent Activity panel (polls every 5s)

### `/reviews/[reviewRunId]` (Review Detail)

**File:** `apps/portal/src/app/reviews/[reviewRunId]/page.tsx`

**Features:**
- Displays review run details: status, score, summary, error
- Check results with filtering (all/FAIL/WARN/PASS)
- AI suggestions section
- Posted comments table
- "Trigger Review" button (disabled if latest review is QUEUED/RUNNING)
- Polling: Every 3 seconds when status is QUEUED/RUNNING
- Stuck warning: Shows alert if QUEUED > 30s

### `/settings` (Settings Page)

**File:** `apps/portal/src/app/settings/page.tsx`

**Purpose:** Tenant settings management (upload config, etc.)

### `/uploads` (Uploads Page)

**File:** `apps/portal/src/app/uploads/page.tsx`

**Purpose:** File upload management

---

## 5. Implementation Status

### Review Status

**✅ Fully Implemented**

- **Status States:** QUEUED → RUNNING → SUCCEEDED/FAILED
- **Status Display:** 
  - Reviews list shows latest review status badge
  - Detail page shows status with color-coded badges
  - Status transitions visible via polling
- **Status Updates:**
  - QUEUED: Set when ReviewRun created (API)
  - RUNNING: Set immediately after ReviewRun lookup (worker, before external calls)
  - SUCCEEDED: Set after checks complete (worker)
  - FAILED: Set on error or in finally block (worker)
- **Guaranteed Finalization:** Finally block ensures ReviewRun always ends in SUCCEEDED or FAILED

### Review Detail View

**✅ Fully Implemented**

**Location:** `apps/portal/src/app/reviews/[reviewRunId]/page.tsx`

**Features:**
- Header section: MR title, repo, author, state, status badge, score, timestamps
- Summary display (if available)
- Error display (if FAILED)
- Check results table with filtering (all/FAIL/WARN/PASS)
- AI suggestions section (if available)
- Posted comments table
- "Trigger Review" button
- Polling every 3s when QUEUED/RUNNING
- Stuck warning for QUEUED > 30s
- Race-safe polling with `AbortController` and sequence guards

**API Endpoint:** `GET /review-runs/:reviewRunId`  
**File:** `apps/api/src/index.ts:1350-1417`

Returns:
- ReviewRun with status, score, summary, error
- MergeRequest details
- CheckResults array
- AiSuggestions array
- PostedComments array

### Re-run Logic

**✅ Fully Implemented**

**Manual Trigger:**
- **Frontend:** "Trigger Review" button on detail page (`apps/portal/src/app/reviews/[reviewRunId]/page.tsx:304-349`)
  - Disabled if latest review is QUEUED/RUNNING
  - Confirms before triggering
  - Navigates to new review run after trigger
- **Backend:** `POST /merge-requests/:projectId/:mrIid/trigger-review` (`apps/api/src/index.ts:1564-1967`)
  - Creates new ReviewRun (always creates new, doesn't reuse)
  - Enqueues job with unique `reviewRunId` in jobId
  - Returns `reviewRunId` for navigation

**Webhook Retry:**
- **Location:** `apps/api/src/gitlab-webhook.ts:477-496`
- If ReviewRun exists with FAILED status and same headSha:
  - Updates existing ReviewRun to QUEUED
  - Enqueues new job with same `reviewRunId`
  - Allows retry of failed reviews

**Job Deduplication Prevention:**
- `reviewRunId` included in jobId format
- Each ReviewRun gets unique job, preventing BullMQ deduplication
- Manual triggers always include `reviewRunId`
- Webhook triggers also include `reviewRunId`

---

## 6. Known TODOs / Unfinished Areas

### Code Comments / TODOs

**Found in:** `packages/checks/src/checks/code-quality.ts:41-53`
- Check for TODO/FIXME comments exists (deterministic check)
- Not a TODO item, but a feature that flags TODOs in code

### Known Issues (from PROJECT_STATUS.md)

1. **Cloudflare Tunnel Config Location:** Unknown
   - Docs mention `api.quickiter.com` and `portal.quickiter.com`
   - Config file not found in repo
   - May be external/managed

2. **Portal API Base URL Default:**
   - Connect page defaults to `http://localhost:3000` but should be `http://localhost:3001` (API port)
   - **File:** `apps/portal/src/app/page.tsx:21`
   - Uses `process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'`
   - Should default to 3001

### Potential Unfinished Areas

1. **Activity Buffer:**
   - **File:** `apps/api/src/activity-buffer.ts:5`
   - Comment: "NOTE: This is a prototype feature. For production, use a proper observability stack."
   - In-memory activity buffer for debugging
   - Not persisted to database

2. **Worker Concurrency:**
   - Currently configurable via `WORKER_CONCURRENCY` env var (default: 1)
   - Requirements suggested 1 for stability
   - May need tuning based on load

3. **Error Recovery:**
   - Worker has guaranteed finalization (finally block)
   - But no automatic retry mechanism for transient failures
   - Manual retry via webhook or portal trigger

4. **AI Suggestions:**
   - Fully implemented but marked as "Preview" in UI
   - May need refinement based on feedback

5. **Knowledge Base (GOLD MRs):**
   - Promotion logic exists (`@mrp/knowledge`)
   - Precedent matching implemented
   - But no UI for managing GOLD MRs or viewing knowledge base

6. **Check Configuration:**
   - Tenant-level check configs exist (`CheckConfig` model)
   - But no UI for configuring checks per tenant
   - Only seed scripts exist (`packages/db/src/seed-check-configs.ts`)

7. **Upload Feature:**
   - Upload endpoints exist (`/uploads/*`)
   - Upload page exists (`/uploads`)
   - But unclear how uploads integrate with review flow

8. **Settings Page:**
   - Settings page exists (`/settings`)
   - But implementation details not fully explored

---

## Key Technical Details

### Queue Configuration

- **Queue Name:** `mrp-review`
- **Redis Connection:** From `REDIS_URL` env var
- **Job Options:** `removeOnComplete: true`, `removeOnFail: false`
- **Worker Config:**
  - Concurrency: `WORKER_CONCURRENCY` (default: 1)
  - Lock Duration: `WORKER_LOCK_DURATION_MS` (default: 300000ms = 5min)
  - Stalled Interval: `WORKER_STALLED_INTERVAL_MS` (default: 30000ms = 30s)
  - Max Stalled Count: `WORKER_MAX_STALLED_COUNT` (default: 1)

### Timeouts

- **GitLab API:** 20-30s per call
- **LLM API:** 120s for `generateSuggestions()`
- **Helper:** `withTimeout()` in `apps/worker/src/index.ts:372`

### Auth Model

- **Portal Endpoints:** Require `X-MRP-Admin-Token` header (matches `PORTAL_ADMIN_TOKEN` env)
- **Tenant Resolution:** `X-MRP-Tenant-Slug` header (defaults to `DEFAULT_TENANT_SLUG` or `'dev'`)
- **PreHandler:** `portalAuthPreHandler` in `apps/api/src/index.ts:811`
- **Dev Mode:** Token optional if `PORTAL_ADMIN_TOKEN` not set

### CORS

- **Allowed Origins:** `api.quickiter.com`, `portal.quickiter.com`, `localhost:3000`, `127.0.0.1:3000`
- **Allowed Headers:** `Content-Type`, `X-MRP-Admin-Token`, `X-MRP-Tenant-Slug`

---

**End of Summary**

