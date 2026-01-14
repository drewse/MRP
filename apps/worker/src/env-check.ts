/**
 * Worker environment diagnostics script
 * Run with: pnpm worker:env
 */

import { initEnv, getEnvDiagnostics, validateRequiredEnv } from '@mrp/config';

const requiredEnvVars = ['REDIS_URL'] as const;
const optionalEnvVars = ['DATABASE_URL', 'LOG_LEVEL', 'DEFAULT_TENANT_SLUG', 'GITLAB_BASE_URL', 'GITLAB_TOKEN'] as const;

// Initialize env
const { repoRoot, envFilePath, loaded } = initEnv();

console.log('🔍 Worker: Environment Diagnostics\n');
console.log(`   Node version: ${process.version}`);
console.log(`   Process PID: ${process.pid}`);
console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`   CWD: ${process.cwd()}`);
console.log(`   Repo root: ${repoRoot}`);
console.log(`   .env file: ${envFilePath}`);
console.log(`   .env loaded: ${loaded ? '✅' : '❌'}\n`);

// Get diagnostics
const diagnostics = getEnvDiagnostics([...requiredEnvVars, ...optionalEnvVars]);

// Log required keys status
console.log('   Required keys:');
for (const key of diagnostics.requiredKeys) {
  if (requiredEnvVars.includes(key.key as typeof requiredEnvVars[number])) {
    const status = key.present ? '✅' : '❌';
    const value = key.maskedValue ? ` (${key.maskedValue})` : '';
    console.log(`     ${status} ${key.key}${value}`);
  }
}

// Log optional keys status
console.log('\n   Optional keys:');
for (const key of diagnostics.requiredKeys) {
  if (optionalEnvVars.includes(key.key as typeof optionalEnvVars[number])) {
    const status = key.present ? '✅' : '⚪';
    if (key.present && key.maskedValue) {
      console.log(`     ${status} ${key.key} (${key.maskedValue})`);
    } else {
      console.log(`     ${status} ${key.key}`);
    }
  }
}

// Special warning for DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.log('\n   ⚠️  DATABASE_URL is not set. Database features will be unavailable.');
}

// Log warnings
if (diagnostics.warnings.length > 0) {
  console.log('\n   ⚠️  Warnings:');
  for (const warning of diagnostics.warnings) {
    console.log(`     - ${warning}`);
  }
}

// Validate required vars
const validation = validateRequiredEnv(requiredEnvVars);
if (!validation.valid) {
  console.log('\n❌ Missing required environment variables:');
  for (const envVar of validation.missing) {
    console.log(`   - ${envVar}`);
  }
  console.log('\nPlease check your .env file and ensure all required variables are set.');
  process.exit(1);
}

console.log('\n✅ All required environment variables are present');

