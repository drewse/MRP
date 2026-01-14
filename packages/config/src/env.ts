/**
 * Centralized environment variable loader
 * 
 * Locates repo root and loads .env file deterministically.
 * Provides diagnostics and validation without logging secrets.
 */

import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';

export interface EnvDiagnostics {
  cwd: string;
  repoRoot: string;
  envFilePath: string;
  envFileExists: boolean;
  requiredKeys: Array<{ key: string; present: boolean; maskedValue?: string; length?: number; source?: string }>;
  warnings: string[];
  keysLoadedFromEnv: string[];
}

/**
 * Find repository root by walking up from current directory
 */
function findRepoRoot(startPath: string = process.cwd()): string {
  let current = resolve(startPath);
  const root = resolve('/');
  
  while (current !== root) {
    // Check for pnpm-workspace.yaml
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    
    // Check for package.json with workspaces
    const packageJsonPath = join(current, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.workspaces || pkg.name === 'mrp-monorepo') {
          return current;
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    // Check for .git folder
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    
    // Move up one level
    const parent = dirname(current);
    if (parent === current) break; // Reached root
    current = parent;
  }
  
  // Fallback: return start path if nothing found
  return resolve(startPath);
}

/**
 * Mask sensitive values for logging
 */
function maskValue(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
}

/**
 * Check if value contains unprintable characters (common Windows CRLF issues)
 */
function hasUnprintableChars(value: string): boolean {
  // Check for CRLF, null bytes, or other control chars (except newline/tab)
  return /[\r\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(value);
}

/**
 * Check if value has quotes or whitespace that might cause issues
 */
function hasQuotesOrWhitespace(value: string): boolean {
  return /^["'\s]|["'\s]$/.test(value);
}

// Guard to ensure dotenv is only loaded once
let envInitialized = false;
let cachedResult: {
  repoRoot: string;
  envFilePath: string;
  envLocalFilePath: string;
  loaded: boolean;
  localLoaded: boolean;
  keysLoaded: string[];
  keySources: Record<string, string>; // Maps key -> source file ('.env' or '.env.local')
} | null = null;

/**
 * Initialize environment variables
 * Must be called before any code reads process.env
 * 
 * Loads from:
 * 1. <repo-root>/.env (always, if exists)
 * 2. <repo-root>/.env.local (if exists, overrides .env)
 * 
 * Safeguard: If an env var already exists and the .env value is empty/undefined,
 * DO NOT overwrite the existing env var.
 */
export function initEnv(envFileOverride?: string): {
  repoRoot: string;
  envFilePath: string;
  envLocalFilePath: string;
  loaded: boolean;
  localLoaded: boolean;
  keysLoaded: string[];
  keySources: Record<string, string>;
} {
  if (envInitialized && cachedResult) {
    // Already initialized, log and return cached info
    if (process.env.NODE_ENV === 'development') {
      console.log('[env] Already initialized, returning cached result');
    }
    return cachedResult;
  }

  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const envFilePath = envFileOverride || process.env.ENV_FILE || join(repoRoot, '.env');
  const envLocalFilePath = join(repoRoot, '.env.local');
  const resolvedEnvPath = resolve(envFilePath);
  const resolvedEnvLocalPath = resolve(envLocalFilePath);
  const envFileExists = existsSync(resolvedEnvPath);
  const envLocalFileExists = existsSync(resolvedEnvLocalPath);
  
  // Store existing env vars before loading .env
  const existingEnv: Record<string, string> = {};
  for (const key in process.env) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      existingEnv[key] = value;
    }
  }
  
  const allKeysLoaded: string[] = [];
  const keySources: Record<string, string> = {}; // Track which file provided each key
  
  // Load .env file with override: true
  // This ensures .env values override process.env (important on Windows)
  let loaded = false;
  if (envFileExists) {
    const result = config({ path: resolvedEnvPath, override: true });
    const hasParsedValues = !!(result.parsed && Object.keys(result.parsed).length > 0);
    loaded = (result.error === null || result.error === undefined) || hasParsedValues;
    
    if (result.parsed) {
      for (const key in result.parsed) {
        const envValue = result.parsed[key];
        if (envValue && envValue.trim().length > 0) {
          allKeysLoaded.push(key);
          keySources[key] = '.env';
        }
      }
    }
    
    if (!loaded && result.error) {
      console.warn(`[env] Warning: Error loading .env file: ${result.error.message}`);
    }
  } else {
    // Never silently skip - log once if file is missing
    console.warn(`[env] .env file not found at: ${resolvedEnvPath}`);
  }
  
  // Load .env.local if present (overrides .env)
  let localLoaded = false;
  if (envLocalFileExists) {
    const localResult = config({ path: resolvedEnvLocalPath, override: true });
    const hasParsedValues = !!(localResult.parsed && Object.keys(localResult.parsed).length > 0);
    localLoaded = (localResult.error === null || localResult.error === undefined) || hasParsedValues;
    
    if (localResult.parsed) {
      for (const key in localResult.parsed) {
        const envValue = localResult.parsed[key];
        if (envValue && envValue.trim().length > 0) {
          // .env.local overrides .env, so update source
          keySources[key] = '.env.local';
          // Track if this key wasn't already loaded from .env
          if (!allKeysLoaded.includes(key)) {
            allKeysLoaded.push(key);
          }
        }
      }
    }
    
    if (!localLoaded && localResult.error) {
      console.warn(`[env] Warning: Error loading .env.local file: ${localResult.error.message}`);
    }
  }
  
  // Apply safeguard: restore existing non-empty values if .env had empty/undefined
  for (const key in existingEnv) {
    const existingValue = existingEnv[key];
    const currentValue = process.env[key];
    
    // If current value is empty but we had a non-empty value before, restore it
    if ((!currentValue || currentValue.trim().length === 0) && existingValue && existingValue.trim().length > 0) {
      process.env[key] = existingValue;
    }
  }
  
  envInitialized = true;
  
  cachedResult = {
    repoRoot,
    envFilePath: resolvedEnvPath,
    envLocalFilePath: resolvedEnvLocalPath,
    loaded,
    localLoaded,
    keysLoaded: allKeysLoaded,
    keySources,
  };
  
  return cachedResult;
}

/**
 * Get environment diagnostics (safe for logging, no secrets)
 */
export function getEnvDiagnostics(requiredKeys: readonly string[]): EnvDiagnostics {
  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const envFilePath = process.env.ENV_FILE || join(repoRoot, '.env');
  const resolvedEnvPath = resolve(envFilePath);
  const envFileExists = existsSync(resolvedEnvPath);
  
  // Get key sources from cached result if available
  const keySources = cachedResult?.keySources || {};
  
  const requiredKeysStatus = requiredKeys.map((key) => {
    const value = process.env[key];
    const present = !!value && value.trim().length > 0;
    
    let maskedValue: string | undefined;
    let length: number | undefined;
    let source: string | undefined;
    if (present) {
      length = value.trim().length;
      if (key.includes('TOKEN') || key.includes('SECRET') || key.includes('PASSWORD') || key.includes('KEY')) {
        maskedValue = maskValue(value);
      }
      // Get source file if available
      source = keySources[key];
    }
    
    return { key, present, maskedValue, length, source };
  });
  
  const warnings: string[] = [];
  
  // Check if .env file exists
  if (!envFileExists) {
    warnings.push(`.env file not found at: ${resolvedEnvPath}`);
  }
  
  // Check for problematic values
  for (const key of requiredKeys) {
    const value = process.env[key];
    if (value) {
      if (key.includes('TOKEN') && hasQuotesOrWhitespace(value)) {
        warnings.push(`${key} contains quotes or leading/trailing whitespace (may cause issues)`);
      }
      if (hasUnprintableChars(value)) {
        warnings.push(`${key} contains unprintable characters (possible CRLF/encoding issue)`);
      }
    }
  }
  
  // Get keys that were loaded from .env (if initEnv was called)
  const keysLoadedFromEnv: string[] = [];
  // This will be populated by initEnv, but we can't access it here
  // The caller should pass it if needed
  
  return {
    cwd,
    repoRoot,
    envFilePath: resolvedEnvPath,
    envFileExists,
    requiredKeys: requiredKeysStatus,
    warnings,
    keysLoadedFromEnv,
  };
}

/**
 * Validate required environment variables
 */
export function validateRequiredEnv(requiredKeys: readonly string[]): {
  valid: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  
  for (const key of requiredKeys) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Get typed environment config (with validation)
 */
export function getEnv<T extends Record<string, string>>(
  requiredKeys: readonly (keyof T)[]
): T {
  const missing: string[] = [];
  
  const config = {} as T;
  
  for (const key of requiredKeys) {
    const value = process.env[key as string];
    if (!value) {
      missing.push(key as string);
    } else {
      (config as Record<string, string>)[key as string] = value;
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  return config;
}

/**
 * Safe environment variable getter
 * Reads from process.env, trims whitespace, and validates
 * 
 * @param key Environment variable key
 * @returns Trimmed value
 * @throws Error with clear message if missing or empty
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  
  if (!value || value.trim().length === 0) {
    const message = `Missing or empty required environment variable: ${key}\n` +
      `Please check your .env file and ensure ${key} is set with a non-empty value.`;
    throw new Error(message);
  }
  
  const trimmed = value.trim();
  const length = trimmed.length;
  
  // Log key name and length (never the value) for diagnostics
  // This helps debug env loading issues without exposing secrets
  if (process.env.NODE_ENV === 'development') {
    console.log(`[env] ${key}: present (length: ${length})`);
  }
  
  return trimmed;
}

/**
 * Require multiple environment variables and throw a friendly error if any are missing
 * @param keys Array of environment variable keys to check
 * @throws Error with a clear message listing missing keys
 */
export function requireEnvMultiple(keys: readonly string[]): void {
  const missing: string[] = [];
  
  for (const key of keys) {
    const value = process.env[key];
    if (!value || value.trim().length === 0) {
      missing.push(key);
    }
  }
  
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check your .env file and ensure all required variables are set.`;
    throw new Error(message);
  }
}

