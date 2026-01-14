# Railway Deployment Guide

This guide covers deploying the MRP monorepo services (API, Worker, Portal) to Railway using pnpm workspaces.

---

## Prerequisites

- Railway account
- Railway CLI installed (optional, for local testing)
- Git repository connected to Railway
- All required environment variables ready (see `docs/ENV_SETUP.md`)

---

## Overview

The MRP monorepo uses **pnpm workspaces** with `workspace:*` protocol. Railway must use **pnpm** (not npm) to install dependencies. This is enforced via:

1. **`package.json`** - `"packageManager": "pnpm@10.26.1"` field
2. **`nixpacks.toml`** - Per-service build configuration using corepack + pnpm
3. **Node.js 22** - Required version

---

## Railway Service Configuration

### Service 1: API

#### Settings

- **Name**: `api` (or `mrp-api`)
- **Root Directory**: `apps/api`
- **Build Command**: *(leave empty - nixpacks.toml handles it)*
- **Start Command**: *(leave empty - nixpacks.toml handles it)*

**OR** if Railway doesn't detect `nixpacks.toml`:

- **Build Command**: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter api build`
- **Start Command**: `cd ../.. && pnpm --filter api start`

#### Environment Variables

See `docs/ENV_SETUP.md` for complete list. Minimum required:

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
GITLAB_TOKEN=glpat-...
GITLAB_WEBHOOK_SECRET=...
APP_PUBLIC_URL=https://api.quickiter.com
PORTAL_ORIGINS=https://portal.quickiter.com
PORTAL_ADMIN_TOKEN=...
STORAGE_PROVIDER=r2
STORAGE_ENDPOINT=...
STORAGE_REGION=auto
STORAGE_BUCKET=...
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
NODE_ENV=production
```

#### Verification

After deployment, verify:

```bash
curl https://api.quickiter.com/health
# Expected: {"ok":true,"timestamp":"..."}
```

---

### Service 2: Worker

#### Settings

- **Name**: `worker` (or `mrp-worker`)
- **Root Directory**: `apps/worker`
- **Build Command**: *(leave empty - nixpacks.toml handles it)*
- **Start Command**: *(leave empty - nixpacks.toml handles it)*

**OR** if Railway doesn't detect `nixpacks.toml`:

- **Build Command**: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter worker build`
- **Start Command**: `cd ../.. && pnpm --filter worker start`

#### Environment Variables

See `docs/ENV_SETUP.md` for complete list. Minimum required:

```
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
GITLAB_TOKEN=glpat-...
NODE_ENV=production
```

#### Verification

Check worker logs in Railway dashboard. You should see:

```
✅ Redis connected: host=..., port=..., db=...
✅ Database connected
✅ Worker started: concurrency=1, queue=mrp-review
```

---

### Service 3: Portal (Optional on Railway)

**Note**: Portal is recommended on **Vercel** (see `docs/DEPLOY_QUICKITER.md`), but can also run on Railway.

#### Settings

- **Name**: `portal` (or `mrp-portal`)
- **Root Directory**: `apps/portal`
- **Build Command**: *(leave empty - nixpacks.toml handles it)*
- **Start Command**: *(leave empty - nixpacks.toml handles it)*

**OR** if Railway doesn't detect `nixpacks.toml`:

- **Build Command**: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter portal build`
- **Start Command**: `cd ../.. && pnpm --filter portal start`

#### Environment Variables

```
NEXT_PUBLIC_API_BASE_URL=https://api.quickiter.com
NODE_ENV=production
```

#### Verification

After deployment, verify:

1. Portal loads at Railway-provided URL
2. Connect page shows API URL input
3. Self-Test passes for Health + Tenant Settings

---

## Railway Build Process

Railway will:

1. **Detect `nixpacks.toml`** in `apps/<service>/` directory
2. **Run setup phase**: Install Node.js 22
3. **Run install phase**: 
   - `cd ../..` (to repo root)
   - `npm install -g pnpm@10.26.1` (install pnpm globally via npm)
   - `export PATH="$(npm bin -g):$PATH"` (ensure pnpm is in PATH)
   - `pnpm -v` (verify pnpm is available)
   - `pnpm install --frozen-lockfile` (install dependencies)
4. **Run build phase**: `pnpm --filter <service> build`
5. **Start service**: `pnpm --filter <service> start`

**Note**: We use `npm install -g pnpm@10.26.1` instead of corepack because corepack signature verification fails on Railway with "Cannot find matching keyid" errors.

---

## Troubleshooting

### Error: "Unsupported URL Type workspace:*"

**Cause**: Railway is using npm instead of pnpm.

**Solution**:
1. Ensure `apps/<service>/nixpacks.toml` exists
2. Verify `package.json` has `"packageManager": "pnpm@10.26.1"`
3. Check Railway build logs for "corepack enable" step
4. If nixpacks.toml isn't detected, manually set build/start commands (see above)

### Error: "pnpm: command not found"

**Cause**: pnpm not installed or not in PATH.

**Solution**:
1. Ensure `nixpacks.toml` includes `npm install -g pnpm@10.26.1` and `export PATH="$(npm bin -g):$PATH"`
2. Check Railway build logs to confirm `pnpm -v` shows version 10.26.1
3. Manually add to build command: `npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm -v`

### Error: "Cannot find module '@mrp/...'"

**Cause**: Dependencies not installed from monorepo root.

**Solution**:
1. Ensure build command runs `cd ../..` before `pnpm install`
2. Verify `pnpm install --frozen-lockfile` runs from repo root
3. Check that `pnpm-lock.yaml` exists in repo root

### Build Fails: "TypeScript errors"

**Cause**: Type errors in code.

**Solution**:
1. Run `pnpm typecheck` locally to identify errors
2. Fix TypeScript errors
3. Ensure all workspace dependencies are properly linked

### Worker Not Processing Jobs

**Cause**: Worker not connected to Redis or database.

**Solution**:
1. Check worker logs for connection errors
2. Verify `REDIS_URL` and `DATABASE_URL` are correct
3. Ensure worker service has access to same Redis/DB as API
4. Check worker startup logs for "Worker started" message

---

## Manual Build/Start Commands

If Railway doesn't detect `nixpacks.toml`, use these commands:

### API

**Build**:
```bash
cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter api build
```

**Start**:
```bash
cd ../.. && pnpm --filter api start
```

### Worker

**Build**:
```bash
cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter worker build
```

**Start**:
```bash
cd ../.. && pnpm --filter worker start
```

### Portal

**Build**:
```bash
cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter portal build
```

**Start**:
```bash
cd ../.. && pnpm --filter portal start
```

---

## Node.js and pnpm Versions

- **Node.js**: `22.x` (required)
- **pnpm**: `10.26.1` (enforced via `packageManager` field)

Railway will use Node.js 22 via nixpacks. pnpm version 10.26.1 is installed via `npm install -g pnpm@10.26.1` (not corepack, to avoid signature verification errors).

---

## Database and Redis Setup

### PostgreSQL (Database)

1. In Railway, add a **PostgreSQL** service
2. Copy the `DATABASE_URL` connection string
3. Add `DATABASE_URL` to both API and Worker services

### Redis

1. In Railway, add a **Redis** service
2. Copy the `REDIS_URL` connection string
3. Add `REDIS_URL` to both API and Worker services

---

## Custom Domains

1. In Railway project → Settings → Domains
2. Add custom domain (e.g., `api.quickiter.com`)
3. Railway will provide DNS records
4. Add DNS records to your domain registrar
5. Wait for SSL certificate provisioning

---

## Monitoring

### API Health Check

Set up monitoring for:
```
GET https://api.quickiter.com/health
```

Expected response: `{"ok":true,"timestamp":"..."}`

### Worker Logs

Monitor Railway worker logs for:
- `✅ Worker started` - Worker is running
- `✅ Redis connected` - Redis connection successful
- `✅ Database connected` - Database connection successful
- `job.completed` - Jobs processing successfully
- `job.failed` - Job failures (investigate)

---

## Deployment Checklist

- [ ] All three services created in Railway
- [ ] PostgreSQL service added and `DATABASE_URL` set
- [ ] Redis service added and `REDIS_URL` set
- [ ] All required environment variables set (see `docs/ENV_SETUP.md`)
- [ ] `PORTAL_ORIGINS` includes portal domain
- [ ] API service builds successfully
- [ ] Worker service builds successfully
- [ ] Portal service builds successfully (if using Railway)
- [ ] API health check returns 200
- [ ] Worker logs show successful startup
- [ ] Custom domains configured (if needed)
- [ ] SSL certificates provisioned

---

## Quick Reference

### Railway Build/Start Commands

**API**:
- Build: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter api build`
- Start: `cd ../.. && pnpm --filter api start`

**Worker**:
- Build: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter worker build`
- Start: `cd ../.. && pnpm --filter worker start`

**Portal**:
- Build: `cd ../.. && npm install -g pnpm@10.26.1 && export PATH="$(npm bin -g):$PATH" && pnpm install --frozen-lockfile && pnpm --filter portal build`
- Start: `cd ../.. && pnpm --filter portal start`

### Key Files

- `package.json` - Enforces pnpm via `packageManager` field
- `apps/api/nixpacks.toml` - API build configuration
- `apps/worker/nixpacks.toml` - Worker build configuration
- `apps/portal/nixpacks.toml` - Portal build configuration
- `docs/ENV_SETUP.md` - Environment variables reference

---

**Last Updated**: 2025-01-XX

