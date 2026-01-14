# Railway Build Order for pnpm Workspace Monorepo

This document explains the correct build order for Railway deployments to ensure workspace packages are built before apps compile.

## Problem

In a pnpm workspace monorepo, apps depend on workspace packages (e.g., `@mrp/core`, `@mrp/db`). These packages must be built **before** the apps that depend on them, otherwise TypeScript compilation will fail with "Cannot find module" errors.

## Solution

Railway build commands must build packages first, then apps.

### API Service Build Command

```bash
pnpm -C /app -r --filter "./packages/**" build && pnpm -C /app --filter "./apps/api" build
```

**Explanation**:
- `pnpm -C /app` - Run from Railway's app directory (monorepo root)
- `-r --filter "./packages/**"` - Recursively build all packages
- `&&` - Then build the API app

### Worker Service Build Command

```bash
pnpm -C /app -r --filter "./packages/**" build && pnpm -C /app --filter "./apps/worker" build
```

**Explanation**:
- Same pattern as API, but filters for `./apps/worker`

### Portal Service Build Command

```bash
pnpm -C /app -r --filter "./packages/**" build && pnpm -C /app --filter "./apps/portal" build
```

**Explanation**:
- Same pattern, but filters for `./apps/portal`

## Alternative: Using nixpacks.toml

If using `nixpacks.toml`, update the build phase:

```toml
[phases.build]
cmds = [
  "cd ../.. && PNPM_BIN=\"$(npm bin -g)/pnpm\" && \"$PNPM_BIN\" -r --filter \"./packages/**\" build && \"$PNPM_BIN\" --filter \"./apps/api\" build"
]
```

## Verification

After deployment, check Railway build logs for:
1. Packages building first (e.g., `@mrp/core`, `@mrp/db`)
2. Then app building (e.g., `api`, `worker`, `portal`)
3. No "Cannot find module '@mrp/...'" errors

---

**Last Updated**: 2025-01-XX

