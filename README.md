# MRP Monorepo

Merge Request Review (MRP) - Automated code review system for GitLab merge requests.

## Architecture

This is a monorepo containing three main services:

- **API** (`apps/api`) - Fastify REST API server
- **Worker** (`apps/worker`) - BullMQ worker for processing review jobs
- **Portal** (`apps/portal`) - Next.js frontend dashboard

See [ARCHITECTURE_SUMMARY.md](./ARCHITECTURE_SUMMARY.md) for detailed technical documentation.

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10.26.1+
- PostgreSQL (for database)
- Redis (for queue)

### Local Development

1. **Clone and install dependencies:**

```bash
git clone <repo-url>
cd MRP
pnpm install
```

2. **Set up environment variables:**

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

See [Environment Variables](#environment-variables) section below for required variables.

3. **Start infrastructure (PostgreSQL + Redis):**

```bash
pnpm docker:up
```

4. **Run database migrations:**

```bash
cd packages/db
pnpm prisma migrate dev
```

5. **Start all services:**

```bash
pnpm dev
```

Or start services individually:

```bash
pnpm api:dev      # API on http://localhost:3001
pnpm worker:dev   # Worker (no HTTP server)
pnpm portal:dev   # Portal on http://localhost:3000
```

## Environment Variables

### Overview

All environment variables are defined in `.env.example` at the repo root. The `@mrp/config` package automatically loads `.env` from the repo root for all services.

**⚠️ IMPORTANT**: Never commit `.env` files. They are ignored by `.gitignore`.

### Required Variables by Service

#### API Service (`apps/api`)

| Variable | Description | Railway Service |
|----------|-------------|-----------------|
| `DATABASE_URL` | PostgreSQL connection string | `api` |
| `REDIS_URL` | Redis connection string (for BullMQ) | `api` |
| `GITLAB_BASE_URL` | GitLab instance URL | `api` |
| `GITLAB_TOKEN` | GitLab API token | `api` |
| `GITLAB_WEBHOOK_SECRET` | Webhook verification secret | `api` |
| `APP_PUBLIC_URL` | Public API URL (for webhooks) | `api` |
| `STORAGE_PROVIDER` | Storage provider (`s3` or `r2`) | `api` |
| `STORAGE_REGION` | Storage region | `api` |
| `STORAGE_BUCKET` | Storage bucket name | `api` |
| `STORAGE_ACCESS_KEY_ID` | Storage access key | `api` |
| `STORAGE_SECRET_ACCESS_KEY` | Storage secret key | `api` |

**Optional:**
- `PORT` (default: `3000`, Railway sets automatically)
- `HOST` (default: `0.0.0.0`)
- `LOG_LEVEL` (default: `info`)
- `DEFAULT_TENANT_SLUG` (default: `dev`)
- `PORTAL_ADMIN_TOKEN` (for portal authentication)
- `PORTAL_ORIGINS` / `PORTAL_ORIGIN` (CORS allowed origins)
- `STORAGE_ENDPOINT` (for custom S3 endpoints like R2)
- `AI_ENABLED` (default: `false`)
- `OPENAI_API_KEY` (required if `AI_ENABLED=true`)
- `ENABLE_DEBUG_ENDPOINTS` (development only)

#### Worker Service (`apps/worker`)

| Variable | Description | Railway Service |
|----------|-------------|-----------------|
| `REDIS_URL` | Redis connection string (for BullMQ) | `worker` |

**Optional (but recommended):**
- `DATABASE_URL` (same as API, for persisting results)
- `GITLAB_BASE_URL` (inherited from job payload if not set)
- `GITLAB_TOKEN` (inherited from job payload if not set)
- `LOG_LEVEL` (default: `info`)
- `DEFAULT_TENANT_SLUG` (default: `dev`)
- `AI_ENABLED` (default: `false`)
- `OPENAI_API_KEY` (required if `AI_ENABLED=true`)

#### Portal Service (`apps/portal`)

| Variable | Description | Railway Service |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_API_BASE_URL` | API base URL (required in production) | `portal` |

**Optional:**
- `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` (can be overridden in UI)
- `NEXT_PUBLIC_PORTAL_ADMIN_TOKEN` (can be set in UI)

**Note**: All `NEXT_PUBLIC_*` variables are exposed to the browser. Never put secrets in them.

### Demo / Minimal Configuration

For a minimal local development setup:

```bash
# Shared
NODE_ENV=development
LOG_LEVEL=info
DEFAULT_TENANT_SLUG=dev

# API
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mrp
REDIS_URL=redis://localhost:6379/0
GITLAB_BASE_URL=https://gitlab.com
GITLAB_TOKEN=glpat-your-token-here
GITLAB_WEBHOOK_SECRET=dev-secret
APP_PUBLIC_URL=http://localhost:3001
STORAGE_PROVIDER=s3
STORAGE_REGION=us-east-1
STORAGE_BUCKET=dev-bucket
STORAGE_ACCESS_KEY_ID=minioadmin
STORAGE_SECRET_ACCESS_KEY=minioadmin
PORTAL_ADMIN_TOKEN=dev-token

# Worker (shares DATABASE_URL and REDIS_URL with API)
# REDIS_URL=redis://localhost:6379/0

# Portal
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

### Railway Deployment

For production on Railway, set environment variables in each service's settings:

1. **API Service** → Variables → Add all required API variables
2. **Worker Service** → Variables → Add `REDIS_URL` (and optionally `DATABASE_URL`, `GITLAB_TOKEN`)
3. **Portal Service** → Variables → Add `NEXT_PUBLIC_API_BASE_URL`

See [docs/DEPLOY_RAILWAY.md](./docs/DEPLOY_RAILWAY.md) for detailed Railway deployment instructions.

### Startup Validation

All services validate required environment variables on startup using `@mrp/config`:

- **API**: Validates all required variables and exits with clear error messages if any are missing
- **Worker**: Validates `REDIS_URL` and exits if missing
- **Portal**: Next.js build will fail if `NEXT_PUBLIC_API_BASE_URL` is not set in production

Missing variables will cause services to exit immediately with helpful error messages.

## Development

### Project Structure

```
.
├── apps/
│   ├── api/          # Fastify REST API
│   ├── worker/        # BullMQ worker
│   └── portal/        # Next.js frontend
├── packages/
│   ├── config/        # Environment variable loading
│   ├── db/            # Prisma ORM + database schema
│   ├── core/          # Shared queue types
│   ├── gitlab/        # GitLab API client
│   ├── checks/        # Deterministic code checks
│   ├── knowledge/     # Knowledge base (gold standards)
│   ├── llm/           # LLM client wrapper
│   ├── privacy/       # Privacy-aware code analysis
│   └── storage/       # S3-compatible storage client
└── docs/              # Documentation
```

### Scripts

```bash
# Development
pnpm dev              # Start all services
pnpm api:dev          # Start API only
pnpm worker:dev       # Start worker only
pnpm portal:dev       # Start portal only

# Build
pnpm build            # Build all packages and apps

# Linting & Formatting
pnpm lint             # Lint all packages
pnpm format           # Format all code
pnpm format:check     # Check formatting
pnpm typecheck        # Type check all packages

# Infrastructure
pnpm docker:up        # Start PostgreSQL + Redis
pnpm docker:down      # Stop infrastructure
pnpm docker:logs     # View infrastructure logs

# Environment
pnpm env:diag         # Print environment diagnostics
```

### Database

```bash
# Run migrations
cd packages/db
pnpm prisma migrate dev

# Generate Prisma client
pnpm prisma generate

# Open Prisma Studio
pnpm prisma studio
```

## Documentation

- [ARCHITECTURE_SUMMARY.md](./ARCHITECTURE_SUMMARY.md) - Technical architecture overview
- [docs/DEPLOY_RAILWAY.md](./docs/DEPLOY_RAILWAY.md) - Railway deployment guide
- [docs/ENV_SETUP.md](./docs/ENV_SETUP.md) - Detailed environment variable documentation
- [docs/ENV_LOADING.md](./docs/ENV_LOADING.md) - How environment loading works

## License

Private / Proprietary

