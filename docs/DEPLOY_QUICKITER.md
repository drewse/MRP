# Deployment Guide: quickiter.com

This guide covers deploying the MRP prototype to production:
- **Portal**: https://portal.quickiter.com (Vercel)
- **API**: https://api.quickiter.com (Railway)
- **Worker**: Railway service (no public URL)

---

## Prerequisites

- Vercel account with access to quickiter.com domain
- Railway account
- GitLab repository with webhook access
- DNS access to quickiter.com domain

---

## 1. DNS Configuration

Add the following DNS records to your quickiter.com domain:

### Portal (Vercel)
```
Type: CNAME
Name: portal
Value: cname.vercel-dns.com
```

### API (Railway)
```
Type: CNAME
Name: api
Value: <your-railway-domain>.railway.app
```
*(Get the Railway domain from your Railway project settings)*

**Note**: DNS propagation can take a few minutes to hours. Verify with:
```bash
dig portal.quickiter.com
dig api.quickiter.com
```

---

## 2. Vercel Deployment (Portal)

### 2.1 Connect Repository

1. Go to Vercel Dashboard → Add New Project
2. Import your GitLab repository
3. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: `apps/portal`
   - **Build Command**: `cd ../.. && pnpm --filter portal build`
   - **Output Directory**: `.next` (default)

### 2.2 Environment Variables

Add the following environment variables in Vercel:

| Variable | Value | Required |
|----------|-------|----------|
| `NEXT_PUBLIC_API_BASE_URL` | `https://api.quickiter.com` | ✅ Yes |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | `dev` (or your tenant) | ❌ Optional |
| `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` | *(match API's PORTAL_ADMIN_TOKEN)* | ⚠️ If using |

**Important**: 
- `NEXT_PUBLIC_API_BASE_URL` is **required** in production
- All `NEXT_PUBLIC_*` variables are exposed to the browser

### 2.3 Custom Domain

1. In Vercel project settings → Domains
2. Add `portal.quickiter.com`
3. Follow Vercel's DNS verification steps
4. Wait for SSL certificate provisioning

### 2.4 Deploy

1. Push to your main branch (or trigger manual deploy)
2. Verify deployment at https://portal.quickiter.com
3. Test the Connect page loads correctly

---

## 3. Railway Deployment (API)

### 3.1 Why pnpm is Required

**⚠️ IMPORTANT**: This monorepo uses **pnpm workspaces** with `workspace:*` protocol for internal package dependencies. 

- **npm cannot install `workspace:*` dependencies** - it will fail with: `npm error Unsupported URL Type "workspace:" workspace:*`
- **Only pnpm supports workspace protocol** - Railway must use pnpm, not npm
- The repo enforces pnpm via:
  - `package.json` → `"packageManager": "pnpm@10.26.1"`
  - `nixpacks.toml` → Installs pnpm via `npm install -g pnpm@10.26.1` (avoids corepack keyid errors on Railway)
  - `pnpm-lock.yaml` → Only pnpm lockfile (no `package-lock.json`)

Railway will automatically detect and use pnpm if:
1. `package.json` has `"packageManager": "pnpm@..."` field
2. `nixpacks.toml` exists with pnpm installation via npm (not corepack)
3. `pnpm-lock.yaml` exists in repo root

**Note**: We use `npm install -g pnpm@10.26.1` instead of corepack because corepack signature verification fails on Railway with "Cannot find matching keyid" errors.

If Railway still uses npm, check that `apps/api/nixpacks.toml` exists and Railway is using Nixpacks builder (not Dockerfile).

### 3.2 Create API Service

1. Go to Railway Dashboard → New Project
2. Add Service → GitHub/GitLab Repository
3. Select your repository
4. Configure:
   - **Root Directory**: `apps/api`
   - **Build Command**: *(leave empty - nixpacks.toml handles it)*
   - **Start Command**: *(leave empty - nixpacks.toml handles it)*

**OR** if Railway doesn't detect `nixpacks.toml`:

   - **Build Command**: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter api build`
   - **Start Command**: `cd ../.. && pnpm --filter api start`

### 3.2 Environment Variables

Add the following environment variables in Railway:

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/mrp` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `GITLAB_TOKEN` | GitLab API token | `glpat-...` |
| `GITLAB_WEBHOOK_SECRET` | Webhook verification secret | `your-secret-here` |
| `APP_PUBLIC_URL` | Public API URL | `https://api.quickiter.com` |
| `PORTAL_ORIGINS` | Allowed CORS origins (comma-separated) | `https://portal.quickiter.com` |
| `PORTAL_ADMIN_TOKEN` | Portal authentication token | `your-admin-token` |
| `STORAGE_PROVIDER` | `r2` or `s3` | `r2` |
| `STORAGE_ENDPOINT` | Storage endpoint URL | `https://abc123.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | Storage region | `auto` |
| `STORAGE_BUCKET` | Bucket name | `mrp-uploads-prod` |
| `STORAGE_ACCESS_KEY_ID` | Storage access key | `...` |
| `STORAGE_SECRET_ACCESS_KEY` | Storage secret key | `...` |

#### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` (Railway sets this automatically) |
| `HOST` | Server host | `0.0.0.0` |
| `NODE_ENV` | Environment | `production` |
| `LOG_LEVEL` | Logging level | `info` |
| `DEFAULT_TENANT_SLUG` | Default tenant | `dev` |
| `ENABLE_DEBUG_ENDPOINTS` | Enable `/debug/*` endpoints | `false` |
| `AI_ENABLED` | Enable AI features | `false` |
| `OPENAI_API_KEY` | OpenAI API key (if AI enabled) | - |

**Important**:
- Railway automatically sets `PORT` - don't override it
- `PORTAL_ORIGINS` must include `https://portal.quickiter.com`
- `APP_PUBLIC_URL` must match your Railway domain or custom domain

### 3.3 Custom Domain

1. In Railway project → Settings → Domains
2. Add custom domain: `api.quickiter.com`
3. Railway will provide DNS records to add
4. Wait for SSL certificate provisioning

### 3.4 Deploy

1. Railway auto-deploys on push to main branch
2. Check deployment logs for errors
3. Verify API is accessible at https://api.quickiter.com/health

---

## 4. Railway Deployment (Worker)

### 4.1 Create Worker Service

1. In the same Railway project, add another service
2. Select the same repository
3. Configure:
   - **Root Directory**: `apps/worker`
   - **Build Command**: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter worker build`
   - **Start Command**: `cd ../.. && pnpm --filter worker start`

### 4.2 Environment Variables

The worker shares most environment variables with the API. Add:

#### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *(same as API)* |
| `REDIS_URL` | Redis connection string | *(same as API)* |
| `GITLAB_TOKEN` | GitLab API token | *(same as API)* |

#### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Logging level | `info` |
| `DEFAULT_TENANT_SLUG` | Default tenant | `dev` |
| `WORKER_CONCURRENCY` | Concurrent jobs | `1` |
| `WORKER_LOCK_DURATION_MS` | Job lock duration | `300000` (5 min) |
| `WORKER_STALLED_INTERVAL_MS` | Stalled check interval | `30000` (30s) |
| `WORKER_MAX_STALLED_COUNT` | Max stalled count | `1` |
| `AI_ENABLED` | Enable AI features | `false` |
| `OPENAI_API_KEY` | OpenAI API key (if AI enabled) | - |

**Note**: Worker doesn't need `PORT`, `HOST`, `APP_PUBLIC_URL`, or CORS-related vars.

### 4.3 Deploy

1. Railway auto-deploys on push
2. Check worker logs to verify it's processing jobs
3. Look for startup logs showing Redis/DB connection and worker config

---

## 5. GitLab Webhook Configuration

### 5.1 Get Webhook URL

Your webhook URL is:
```
https://api.quickiter.com/webhooks/gitlab
```

### 5.2 Configure in GitLab

1. Go to your GitLab project → Settings → Webhooks
2. Add webhook:
   - **URL**: `https://api.quickiter.com/webhooks/gitlab`
   - **Secret token**: *(value of `GITLAB_WEBHOOK_SECRET` from Railway)*
   - **Trigger**: Select "Merge request events"
3. Click "Add webhook"
4. Test the webhook (GitLab will send a test event)

### 5.3 Verify Webhook

1. Create or update a merge request in GitLab
2. Check Railway API logs for `webhook.received` events
3. Check Portal Recent Activity panel for webhook events

---

## 6. Verification Steps

### 6.0 Verify pnpm is Used in Builds

**How to confirm Railway is using pnpm**:

1. Check Railway build logs for:
   - `npm install -g pnpm@10.26.1` (should appear in install phase)
   - `pnpm -v` output showing `10.26.1` (verification step)
   - `pnpm install --frozen-lockfile` (not `npm install`)
   - `pnpm --filter <service> build` (build command)

2. **If logs show `npm install` instead of `pnpm install`**:
   - Railway is not detecting `nixpacks.toml`
   - Check service root directory is set correctly (e.g., `apps/api`)
   - Verify `apps/<service>/nixpacks.toml` exists in the repo
   - Clear Railway build cache and redeploy
   - Manually set build command in Railway settings (see troubleshooting)

3. **If logs show corepack errors**:
   - Remove corepack from nixpacks.toml
   - Use `npm install -g pnpm@10.26.1` instead
   - Ensure PATH export is included: `export PATH="$(npm bin -g):$PATH"`

## 6. Verification Steps (API/Worker/Portal)

### 6.1 API Health Check

```bash
curl -i https://api.quickiter.com/health
```

**Expected**: HTTP 200 with `{"ok":true,"timestamp":"..."}`

### 6.2 Portal Self-Test

1. Go to https://portal.quickiter.com
2. Navigate to Connect page
3. Enter tenant slug and admin token
4. Click "Run Self-Test"
5. **Expected**: 
   - ✅ API Health: PASS
   - ✅ Tenant Settings: PASS
   - ✅ Queue Inspect: SKIP (not available in production unless enabled)

### 6.3 Debug Endpoints (Should Be Blocked)

```bash
# Without auth - should fail
curl -i https://api.quickiter.com/debug/env

# With auth - should still fail in production (unless ENABLE_DEBUG_ENDPOINTS=true)
curl -i "https://api.quickiter.com/debug/env" \
  -H "X-MRP-Tenant-Slug: dev" \
  -H "X-MRP-Admin-Token: your-token"
```

**Expected**: HTTP 403 with `{"error":"Debug endpoints disabled in production"}`

### 6.4 CORS Verification

1. Open https://portal.quickiter.com in browser
2. Open browser DevTools → Network tab
3. Navigate to Reviews page
4. **Expected**: No CORS errors in console
5. API requests should succeed with 200/401/403 (not CORS errors)

### 6.5 Webhook Flow

1. Create a merge request in GitLab
2. Push a commit to the MR
3. **Expected**:
   - Portal Recent Activity shows `webhook.received` and `webhook.reviewrun.created`
   - Reviews page shows new review run
   - Review run transitions: QUEUED → RUNNING → SUCCEEDED/FAILED

---

## 7. Troubleshooting

### Build Fails: "npm error Unsupported URL Type 'workspace:'"

**Symptom**: Railway build fails with `npm error Unsupported URL Type "workspace:" workspace:*`.

**Cause**: Railway is using npm instead of pnpm. npm cannot install `workspace:*` dependencies.

**Solution**:
1. Verify `package.json` has `"packageManager": "pnpm@10.26.1"` field
2. Verify `apps/api/nixpacks.toml` (or `apps/worker/nixpacks.toml`) exists
3. Check Railway service settings → ensure "Nixpacks" builder is selected (not Dockerfile)
4. If nixpacks.toml isn't detected, manually set build command:
   ```
   cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter api build
   ```
5. Verify `pnpm-lock.yaml` exists in repo root (not `package-lock.json`)
6. Ensure no `package-lock.json` files exist in the repo (they can confuse Railway)

### Build Fails: "pnpm: command not found"

**Symptom**: Railway build fails with `pnpm: command not found` or `command not found: pnpm`.

**Cause**: pnpm is not in PATH after global installation, or nixpacks.toml isn't being used.

**Solution**:
1. Verify `apps/<service>/nixpacks.toml` exists and includes `export PATH="$(npm bin -g):$PATH"` after `npm install -g pnpm@10.26.1`
2. Check Railway build logs - you should see `pnpm -v` output showing version 10.26.1
3. If nixpacks.toml isn't detected, manually add PATH export to build command:
   ```
   cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm -v && pnpm install --frozen-lockfile && pnpm --filter api build
   ```
4. Clear Railway build cache and redeploy

### Build Fails: "Cannot find matching keyid" (Corepack Error)

**Symptom**: Railway build fails with corepack error: `Cannot find matching keyid ... corepack.cjs ...`.

**Cause**: Corepack signature verification is failing on Railway.

**Solution**:
1. **Do not use corepack** - ensure nixpacks.toml uses `npm install -g pnpm@10.26.1` instead
2. Remove any `corepack enable` or `corepack prepare` commands from nixpacks.toml
3. Verify install phase uses: `npm install -g pnpm@10.26.1` followed by `export PATH="$(npm bin -g):$PATH"`
4. Redeploy after fixing nixpacks.toml

### CORS Errors

**Symptom**: Browser console shows CORS errors when portal tries to call API.

**Solution**:
1. Verify `PORTAL_ORIGINS` in Railway includes `https://portal.quickiter.com`
2. Check API logs for `cors.rejected` events
3. Ensure no trailing slashes in `PORTAL_ORIGINS`
4. Clear browser cache and retry

### API Not Accessible

**Symptom**: `curl https://api.quickiter.com/health` fails.

**Solution**:
1. Check Railway deployment status
2. Verify custom domain is configured in Railway
3. Check DNS propagation: `dig api.quickiter.com`
4. Verify Railway service is running (not crashed)

### Worker Not Processing Jobs

**Symptom**: ReviewRuns stuck in QUEUED status.

**Solution**:
1. Check Railway worker logs for errors
2. Verify `REDIS_URL` is correct and accessible
3. Verify `DATABASE_URL` is correct
4. Check worker startup logs for Redis/DB connection
5. Verify worker config shows correct concurrency/lockDuration

### Portal Shows "API base URL not configured"

**Symptom**: Portal Connect page shows warning about missing API URL.

**Solution**:
1. Verify `NEXT_PUBLIC_API_BASE_URL` is set in Vercel
2. Redeploy portal after adding env var
3. Clear browser localStorage (may have old cached value)

### Debug Endpoints Accessible in Production

**Symptom**: `/debug/*` endpoints work without `ENABLE_DEBUG_ENDPOINTS=true`.

**Solution**:
1. Verify `NODE_ENV=production` is set in Railway
2. Check API logs for debug endpoint access
3. Ensure code changes are deployed (may need to rebuild)

---

## 8. Security Checklist

- [ ] `PORTAL_ADMIN_TOKEN` is set and strong (random string)
- [ ] `GITLAB_WEBHOOK_SECRET` is set and matches GitLab webhook config
- [ ] `ENABLE_DEBUG_ENDPOINTS` is `false` (or not set) in production
- [ ] `PORTAL_ORIGINS` only includes trusted domains
- [ ] Database and Redis credentials are secure
- [ ] Storage credentials (R2/S3) are secure
- [ ] No secrets are logged (check logs for tokens/passwords)
- [ ] SSL certificates are valid (check browser padlock icon)

---

## 9. Monitoring

### Railway Logs

- API logs: Railway project → API service → Logs
- Worker logs: Railway project → Worker service → Logs

### Portal Activity

- Use Portal Recent Activity panel to monitor webhook events
- Check for `webhook.ignored` events (may indicate configuration issues)

### Health Checks

- Set up monitoring for `https://api.quickiter.com/health`
- Alert if health check fails

---

## 10. Rollback Procedure

### Portal (Vercel)

1. Go to Vercel Dashboard → Project → Deployments
2. Find previous working deployment
3. Click "..." → "Promote to Production"

### API/Worker (Railway)

1. Go to Railway Dashboard → Project → Deployments
2. Find previous working deployment
3. Click "Redeploy"

---

## Quick Reference

### Environment Variables Summary

**Vercel (Portal)**:
- `NEXT_PUBLIC_API_BASE_URL=https://api.quickiter.com` ✅ Required

**Railway (API)**:
- `PORTAL_ORIGINS=https://portal.quickiter.com` ✅ Required
- `APP_PUBLIC_URL=https://api.quickiter.com` ✅ Required
- `PORTAL_ADMIN_TOKEN=...` ✅ Required
- `ENABLE_DEBUG_ENDPOINTS=false` (or unset) ✅ Required for security

**Railway (Worker)**:
- Same as API (minus PORTAL_ORIGINS, APP_PUBLIC_URL)

### URLs

- Portal: https://portal.quickiter.com
- API: https://api.quickiter.com
- API Health: https://api.quickiter.com/health
- GitLab Webhook: https://api.quickiter.com/webhooks/gitlab

---

**Last Updated**: 2025-01-XX

