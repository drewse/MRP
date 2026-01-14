# Environment Variables Setup

This document lists all required and optional environment variables for the MRP monorepo services.

**⚠️ IMPORTANT**: Never commit `.env` files or backup files (`.env.bak`, etc.) to git. They are ignored by `.gitignore`, but if you accidentally commit secrets:

1. Remove the file from git history using `git filter-repo` in a fresh clone
2. Rotate all exposed secrets immediately
3. Review git history for other exposed secrets

---

## API Service (`apps/api`)

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/mrp` |
| `REDIS_URL` | Redis connection string | `redis://host:6379` |
| `GITLAB_TOKEN` | GitLab API token | `glpat-...` |
| `GITLAB_WEBHOOK_SECRET` | Webhook verification secret | `your-secret-here` |
| `APP_PUBLIC_URL` | Public API URL | `https://api.quickiter.com` |
| `PORTAL_ORIGINS` | Allowed CORS origins (comma-separated) | `https://portal.quickiter.com` |
| `PORTAL_ADMIN_TOKEN` | Portal authentication token | `your-admin-token` |
| `STORAGE_PROVIDER` | Storage provider (`r2` or `s3`) | `r2` |
| `STORAGE_ENDPOINT` | Storage endpoint URL | `https://abc123.r2.cloudflarestorage.com` |
| `STORAGE_REGION` | Storage region | `auto` |
| `STORAGE_BUCKET` | Bucket name | `mrp-uploads-prod` |
| `STORAGE_ACCESS_KEY_ID` | Storage access key | `...` |
| `STORAGE_SECRET_ACCESS_KEY` | Storage secret key | `...` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` (Railway sets automatically) |
| `HOST` | Server host | `0.0.0.0` |
| `NODE_ENV` | Environment | `production` |
| `LOG_LEVEL` | Logging level | `info` |
| `DEFAULT_TENANT_SLUG` | Default tenant slug | `dev` |
| `ENABLE_DEBUG_ENDPOINTS` | Enable `/debug/*` endpoints | `false` |
| `AI_ENABLED` | Enable AI features | `false` |
| `OPENAI_API_KEY` | OpenAI API key (if AI enabled) | - |

---

## Worker Service (`apps/worker`)

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | *(same as API)* |
| `REDIS_URL` | Redis connection string | *(same as API)* |
| `GITLAB_TOKEN` | GitLab API token | *(same as API)* |

### Optional Variables

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

---

## Portal Service (`apps/portal`)

### Required Variables (Production)

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | API base URL | `https://api.quickiter.com` |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | Default tenant slug | - |
| `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` | Admin token (if pre-filled) | - |

**Note**: All `NEXT_PUBLIC_*` variables are exposed to the browser. Never put secrets in them.

---

## Local Development

For local development, create a `.env` file in the repo root:

```bash
# Copy from .env.example if it exists, or create manually
cp .env.example .env
```

Then set the required variables. The `@mrp/config` package will automatically load `.env` from the repo root.

---

## Railway Deployment

1. Go to Railway project → Service → Variables
2. Add each required variable
3. For secrets, use Railway's "Secret" toggle to hide values
4. Ensure `PORTAL_ORIGINS` includes your portal domain (comma-separated)

---

## Vercel Deployment (Portal)

1. Go to Vercel project → Settings → Environment Variables
2. Add `NEXT_PUBLIC_API_BASE_URL` (required in production)
3. Add other `NEXT_PUBLIC_*` variables as needed
4. Redeploy after adding variables

---

## Security Best Practices

1. **Never commit `.env` files** - They're in `.gitignore`, but double-check before committing
2. **Never commit backup files** - `.env.bak`, `*.bak` are ignored, but verify
3. **Rotate secrets immediately** if accidentally committed
4. **Use Railway/Vercel secrets** for production deployments
5. **Use different secrets** for dev/staging/production
6. **Review git history** periodically for exposed secrets

---

## If Push Blocked by GitHub Secret Scanning

If GitHub blocks a push due to secrets in git history:

1. **Don't force push** - This won't remove secrets from history
2. **Use `git filter-repo`** in a fresh clone:
   ```bash
   git clone <repo-url> fresh-clone
   cd fresh-clone
   git filter-repo --path .env.bak --invert-paths
   # Or to remove all .env* files from history:
   git filter-repo --path-glob '.env*' --invert-paths
   ```
3. **Rotate all exposed secrets** immediately
4. **Force push the cleaned history** (coordinate with team)
5. **Update `.gitignore`** to prevent future commits

---

**Last Updated**: 2025-01-XX

