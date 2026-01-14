/**
 * Environment diagnostics script
 * 
 * Usage: pnpm env:diag
 * 
 * Prints environment loading diagnostics without starting the full app
 * Fully standalone - no external dependencies beyond @mrp/config
 */

import { initEnv, getEnvDiagnostics } from '@mrp/config';

// Initialize env first
const { repoRoot, envFilePath, envLocalFilePath, loaded, localLoaded, keysLoaded, keySources } = initEnv();

// Human-readable output
console.log('🔍 Environment Diagnostics');
console.log(`   Repo root: ${repoRoot}`);
console.log(`   .env file: ${envFilePath}`);
console.log(`   .env exists: ${loaded ? '✅' : '❌'}`);
console.log(`   .env.local file: ${envLocalFilePath}`);
console.log(`   .env.local exists: ${localLoaded ? '✅' : '❌'}`);
console.log(`   Keys loaded from .env: ${keysLoaded.length}`);

if (keysLoaded.length > 0) {
  console.log(`   Loaded keys: ${keysLoaded.slice(0, 20).join(', ')}${keysLoaded.length > 20 ? '...' : ''}`);
}

// Get detailed diagnostics
const diagnostics = getEnvDiagnostics([
  'DATABASE_URL',
  'REDIS_URL',
  'GITLAB_TOKEN',
  'GITLAB_WEBHOOK_SECRET',
  'APP_PUBLIC_URL',
  'STORAGE_PROVIDER',
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'PORTAL_ADMIN_TOKEN',
  'AI_ENABLED',
  'OPENAI_API_KEY',
]);

console.log('\n📋 Environment Variables Status:');
for (const key of diagnostics.requiredKeys) {
  const status = key.present ? '✅' : '❌';
  const length = key.length ? ` (length: ${key.length})` : '';
  const masked = key.maskedValue ? ` (${key.maskedValue})` : '';
  const source = key.source ? ` [from ${key.source}]` : '';
  console.log(`   ${status} ${key.key}${length}${masked}${source}`);
}

// Structured JSON output (for machine parsing)
const structuredOutput = {
  event: 'env.diagnostics',
  envFilePath,
  envFileExists: loaded,
  envLocalFilePath,
  envLocalFileExists: localLoaded,
  keysLoadedCount: keysLoaded.length,
  AI_ENABLED: process.env.AI_ENABLED === 'true',
  OPENAI_API_KEY_PRESENT: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0),
  OPENAI_API_KEY_LENGTH: (process.env.OPENAI_API_KEY || '').trim().length,
  DATABASE_URL_PRESENT: !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0),
  variables: diagnostics.requiredKeys.map(k => ({
    key: k.key,
    present: k.present,
    length: k.length,
    maskedValue: k.maskedValue,
    source: k.source,
  })),
  warnings: diagnostics.warnings,
};

console.log('\n📊 Structured Output (JSON):');
console.log(JSON.stringify(structuredOutput, null, 2));

if (diagnostics.warnings.length > 0) {
  console.log('\n⚠️  Warnings:');
  for (const warning of diagnostics.warnings) {
    console.log(`   - ${warning}`);
  }
}
