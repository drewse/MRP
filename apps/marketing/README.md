# Quickiter Marketing Site

Marketing website for Quickiter, deployed at `quickiter.com`.

## Development

```bash
# From repo root
pnpm marketing:dev

# Or from this directory
pnpm dev
```

The marketing site runs on port 3002 by default.

## Pages

- `/` - Home page with hero, features, demo section, and CTA
- `/pricing` - Pricing tiers (Starter, Professional, Enterprise)
- `/security` - Security and privacy information

## Deployment

The marketing site is configured for Railway deployment using `nixpacks.toml`.

### Railway Setup

1. Create a new Railway service for the marketing site
2. Point the domain `quickiter.com` to this service
3. Set the root directory to the monorepo root
4. Railway will detect `apps/marketing/nixpacks.toml` and build accordingly

### Environment Variables

No environment variables are required for the marketing site (static content).

## Links

- Login button links to: `https://portal.quickiter.com/login`
- All external links use absolute URLs to ensure proper routing

