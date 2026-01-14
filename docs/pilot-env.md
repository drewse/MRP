# Pilot Environment Configuration

This guide explains how to configure the API, worker, and portal for local development.

## Overview

- **API**: Production at `https://api.quickiter.com`, local dev on `http://localhost:3001` (port 3001)
- **Portal**: Runs on `http://localhost:3000` (port 3000)
- **Worker**: Runs alongside API (shares same env config)

## Environment Files

### API/Worker Configuration (`.env` at repo root)

The API and worker read from `.env` at the repository root. Optionally, `.env.local` can override values (`.env.local` takes precedence).

**Required variables for API:**

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/mrp

# Redis
REDIS_URL=redis://localhost:6379

# GitLab
GITLAB_BASE_URL=https://gitlab.com
GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
GITLAB_WEBHOOK_SECRET=your-webhook-secret

# App
# Production: Set to https://api.quickiter.com
# Local dev: Set to http://localhost:3001
APP_PUBLIC_URL=https://api.quickiter.com

# Storage (Cloudflare R2 example)
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=mrp-uploads-prod
STORAGE_ACCESS_KEY_ID=your-r2-access-key-id
STORAGE_SECRET_ACCESS_KEY=your-r2-secret-access-key

# Portal Admin Token (pilot only)
PORTAL_ADMIN_TOKEN=pilot-admin-token-12345

# Worker Configuration (optional, defaults shown)
WORKER_CONCURRENCY=1                    # Number of concurrent jobs (default: 1 for stability)
WORKER_LOCK_DURATION_MS=300000         # Job lock duration in ms (default: 300000 = 5 min)
WORKER_STALLED_INTERVAL_MS=30000       # Check for stalled jobs every N ms (default: 30000 = 30s)
WORKER_MAX_STALLED_COUNT=1              # Max stalled detections before failing (default: 1)
```

**Important Notes:**

- `STORAGE_ENDPOINT` must be a **real URL** (e.g., `https://abc123.r2.cloudflarestorage.com`). Do NOT use placeholder values like `https://...` as this will cause upload failures.
- For R2, the endpoint format is: `https://<accountId>.r2.cloudflarestorage.com`
- If using `.env.local`, it will override values from `.env`. Ensure `.env.local` does not contain placeholder `STORAGE_ENDPOINT` values.

### Portal Configuration (`apps/portal/.env.local`)

The portal reads from `apps/portal/.env.local` (Next.js convention). This file should be created in the `apps/portal` directory.

**Required variables for Portal:**

```bash
# API Connection
# Production: Set to https://api.quickiter.com
# Local dev: Set to http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=https://api.quickiter.com
NEXT_PUBLIC_DEFAULT_TENANT_SLUG=dev

# Portal Admin Token (pilot only - must match API's PORTAL_ADMIN_TOKEN)
NEXT_PUBLIC_PORTAL_ADMIN_TOKEN=pilot-admin-token-12345
```

**Note:** The `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` should match the `PORTAL_ADMIN_TOKEN` set in the API's `.env` file.

## Running Locally

### 1. Start API and Worker

```bash
# From repo root
pnpm api:dev
```

This starts the API on port 3001 (or the port specified in `PORT` env var).

### 2. Start Portal

```bash
# From repo root
pnpm portal:dev
```

This starts the portal on port 3000.

### 3. Verify Configuration

Check environment diagnostics:

```bash
pnpm env:diag
```

This will show:
- Which env vars are present
- Which file (`.env` or `.env.local`) provided each variable
- Any warnings or issues

## Common Issues

### Invalid STORAGE_ENDPOINT

**Symptom:** Browser uploads fail with `ERR_NAME_NOT_RESOLVED`, presigned URLs show hostname as `"..."`.

**Solution:** Ensure `STORAGE_ENDPOINT` in `.env` (or `.env.local`) is a real URL, not a placeholder:
- ❌ `STORAGE_ENDPOINT=https://...`
- ✅ `STORAGE_ENDPOINT=https://abc123.r2.cloudflarestorage.com`

### Portal Can't Connect to API

**Symptom:** Portal "Test Connection" fails.

**Solution:**
1. **Production**: Portal defaults to `https://api.quickiter.com`. Verify API is accessible.
2. **Local dev**: Verify API is running on port 3001 (or PORT env var)
3. **Local dev**: Check `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` in `apps/portal/.env.local` (overrides default)
4. Ensure `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` matches `PORTAL_ADMIN_TOKEN` in API's `.env`

### .env.local Override Issues

**Symptom:** Changes to `.env` don't take effect.

**Solution:** Remember that `.env.local` overrides `.env`. If a variable is set in `.env.local`, it will always use that value. Check which file is providing each variable using `pnpm env:diag`.

## Cloudflare R2 Setup

1. Create an R2 bucket in Cloudflare dashboard
2. Generate API tokens (Access Key ID and Secret Access Key)
3. Get your account ID from the R2 dashboard
4. Set `STORAGE_ENDPOINT=https://<accountId>.r2.cloudflarestorage.com`
5. Set `STORAGE_PROVIDER=r2`
6. Set bucket name and credentials

Example:
```bash
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=https://abc123def456.r2.cloudflarestorage.com
STORAGE_REGION=auto
STORAGE_BUCKET=my-bucket-name
STORAGE_ACCESS_KEY_ID=your-access-key-id
STORAGE_SECRET_ACCESS_KEY=your-secret-access-key
```

## GitLab Webhook Configuration

**Production webhook URL:**
```
https://api.quickiter.com/webhooks/gitlab
```

**Local dev webhook URL:**
```
http://localhost:3001/webhooks/gitlab
```

Configure the webhook in your GitLab project settings:
1. Go to Project Settings → Webhooks
2. URL: Use the appropriate URL above based on your environment
3. Secret token: Set to the value of `GITLAB_WEBHOOK_SECRET` from your `.env`
4. Trigger: Select "Merge request events"

## Security Notes

- Never commit `.env` or `.env.local` files to git
- Use strong, unique values for `PORTAL_ADMIN_TOKEN` and `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN`
- Keep R2 credentials secure
- The pilot admin token is temporary - will be replaced with proper authentication later

