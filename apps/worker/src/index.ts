// Initialize environment FIRST (before any other imports that might read process.env)
import { initEnv, getEnvDiagnostics, validateRequiredEnv, requireEnv } from '@mrp/config';

const { repoRoot, envFilePath, loaded, keysLoaded } = initEnv();

// Startup assertion: .env must be loaded
if (!loaded) {
  console.error(`❌ FATAL: Failed to load .env file from: ${envFilePath}`);
  console.error(`Please ensure the .env file exists at: ${envFilePath}`);
  process.exit(1);
}

// Log env loading diagnostics
console.log(`📁 .env file: ${envFilePath}`);
console.log(`✅ .env loaded: ${loaded ? 'yes' : 'no'}`);
if (keysLoaded.length > 0) {
  console.log(`📋 Keys loaded from .env: ${keysLoaded.length} (${keysLoaded.slice(0, 10).join(', ')}${keysLoaded.length > 10 ? '...' : ''})`);
}

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { prisma, getOrCreateTenantBySlug, disconnectPrisma } from '@mrp/db';
import { QUEUE_NAME, type ReviewMrJobPayload } from '@mrp/core';
import { createGitLabClient } from '@mrp/gitlab';
import { runChecks, calculateScore, formatCheckResultsForComment, type Change, type CheckConfig } from '@mrp/checks';
import { promoteToGold, findGoldPrecedents, formatPrecedentReferences, computeFeatureSignature } from '@mrp/knowledge';
import { selectSnippets, type Change as PrivacyChange, type CodeSnippet } from '@mrp/privacy';
import { createLlmClient, type AiSuggestion as LlmAiSuggestion } from '@mrp/llm';
import { createHash } from 'crypto';

// Environment validation for worker
const requiredEnvVars = ['REDIS_URL'] as const;
const optionalEnvVars = ['DATABASE_URL', 'LOG_LEVEL', 'DEFAULT_TENANT_SLUG', 'GITLAB_BASE_URL', 'GITLAB_TOKEN', 'AI_ENABLED', 'OPENAI_API_KEY'] as const;

function validateEnv(): void {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

  logger.info('🔍 Worker: Environment diagnostics');
  logger.info(`   Node version: ${process.version}`);
  logger.info(`   Process PID: ${process.pid}`);
  logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   CWD: ${process.cwd()}`);
  logger.info(`   Repo root: ${repoRoot}`);
  logger.info(`   .env file: ${envFilePath}`);
  logger.info(`   .env loaded: ${loaded ? '✅' : '❌'}`);

  // Get diagnostics
  const diagnostics = getEnvDiagnostics([...requiredEnvVars, ...optionalEnvVars]);

  // Log required keys status
  logger.info('   Required keys:');
  for (const key of diagnostics.requiredKeys) {
    if (requiredEnvVars.includes(key.key as typeof requiredEnvVars[number])) {
      const status = key.present ? '✅' : '❌';
      const value = key.maskedValue ? ` (${key.maskedValue})` : '';
      logger.info(`     ${status} ${key.key}${value}`);
    }
  }

  // Log optional keys status
  logger.info('   Optional keys:');
  for (const key of diagnostics.requiredKeys) {
    if (optionalEnvVars.includes(key.key as typeof optionalEnvVars[number])) {
      const status = key.present ? '✅' : '⚪';
      if (key.present && key.maskedValue) {
        logger.info(`     ${status} ${key.key} (${key.maskedValue})`);
      } else {
        logger.info(`     ${status} ${key.key}`);
      }
    }
  }

  // Special warning for DATABASE_URL
  if (!process.env.DATABASE_URL) {
    logger.warn('   ⚠️  DATABASE_URL is not set. Database features will be unavailable.');
  }

  // Log warnings
  if (diagnostics.warnings.length > 0) {
    logger.warn('   ⚠️  Warnings:');
    for (const warning of diagnostics.warnings) {
      logger.warn(`     - ${warning}`);
    }
  }

  // Validate required vars
  const validation = validateRequiredEnv(requiredEnvVars);
  if (!validation.valid) {
    logger.error('❌ Missing required environment variables:');
    for (const envVar of validation.missing) {
      logger.error(`   - ${envVar}`);
    }
    logger.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }

  logger.info('✅ All required environment variables are present');
}

/**
 * Validate GitLab token by calling /api/v4/user
 */
async function validateGitLabToken(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return; // Skip in tests
  }

  const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';
  const gitlabToken = process.env.GITLAB_TOKEN;

  if (!gitlabToken) {
    // Worker can run without GitLab token if only processing queued jobs
    // But we should warn if it's missing
    const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
    logger.warn('⚠️  GITLAB_TOKEN not set. GitLab API features will be unavailable.');
    return;
  }

  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

  try {
    const client = createGitLabClient({
      baseUrl: gitlabBaseUrl,
      token: gitlabToken,
    });

    const user = await client.getUser();
    
    logger.info(
      {
        event: 'gitlab.auth.ok',
        username: user.username,
        userId: user.id,
      },
      '✅ GitLab token validated successfully'
    );
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string };
    const statusCode = err.statusCode;

    if (statusCode === 401) {
      logger.error(
        {
          event: 'gitlab.auth.invalid',
          statusCode: 401,
        },
        '❌ GitLab token is invalid (401 Unauthorized). Please check GITLAB_TOKEN in .env'
      );
      process.exit(1);
    } else if (statusCode === 403) {
      logger.error(
        {
          event: 'gitlab.auth.forbidden',
          statusCode: 403,
        },
        '❌ GitLab token lacks required permissions (403 Forbidden). Token user may not have access to projects.'
      );
      process.exit(1);
    } else {
      logger.error(
        {
          event: 'gitlab.auth.error',
          statusCode,
          error: err.message,
        },
        `❌ Failed to validate GitLab token: ${err.message}`
      );
      process.exit(1);
    }
  }
}

// Extract Redis host from REDIS_URL for logging (without credentials)
function extractRedisHost(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return `${urlObj.hostname}:${urlObj.port || '6379'}`;
  } catch {
    return 'unknown';
  }
}

// Redact password from Redis URL for logging
function redactRedisUrl(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    if (urlObj.password) {
      urlObj.password = '***';
    }
    return urlObj.toString();
  } catch {
    // If URL parsing fails, try to redact password manually
    return url.replace(/:[^:@]+@/, ':***@');
  }
}

/**
 * Log structured environment diagnostics at startup
 */
function logEnvDiagnostics(): void {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  
  const aiEnabled = process.env.AI_ENABLED === 'true';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiKeyLength = openaiKey.trim().length;
  const openaiKeyPresent = openaiKeyLength > 0;
  const databaseUrlPresent = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
  
  // Fail fast if AI_ENABLED is true but OPENAI_API_KEY is missing
  if (aiEnabled && !openaiKeyPresent) {
    logger.error({
      event: 'env.validation.failed',
      reason: 'AI_ENABLED is true but OPENAI_API_KEY is missing or empty',
      envFilePath,
    });
    throw new Error(
      'AI_ENABLED is set to true, but OPENAI_API_KEY is missing or empty.\n' +
      `Please set OPENAI_API_KEY in your .env file at: ${envFilePath}\n` +
      'Or set AI_ENABLED=false to disable AI features.'
    );
  }
  
  logger.info(
    {
      event: 'env.diagnostics',
      envFilePath,
      envFileExists: loaded,
      keysLoadedCount: keysLoaded.length,
      AI_ENABLED: aiEnabled,
      OPENAI_API_KEY_PRESENT: openaiKeyPresent,
      OPENAI_API_KEY_LENGTH: openaiKeyLength,
      DATABASE_URL_PRESENT: databaseUrlPresent,
    },
    '📋 Environment Diagnostics'
  );
}

/**
 * Run AI connectivity self-test
 */
async function runAiSelfTest(): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  
  logger.info({
    event: 'worker.ai.self_test.start',
  }, 'Running AI connectivity self-test...');
  
  try {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey || openaiApiKey.trim().length === 0) {
      logger.warn({
        event: 'worker.ai.self_test.skip',
        reason: 'OPENAI_API_KEY not set',
      }, 'Skipping AI self-test: OPENAI_API_KEY not set');
      return;
    }
    
    const llmClient = createLlmClient({
      provider: 'OPENAI',
      apiKey: openaiApiKey,
      model: 'gpt-4o-mini',
      timeout: 30000, // 30s for self-test
      maxRetries: 1,
    });
    
    const startTime = Date.now();
    const testResult = await llmClient.generateSuggestions({
      checkResults: [{
        checkKey: 'test',
        category: 'TEST',
        status: 'WARN',
        title: 'Test check',
        evidence: 'This is a connectivity test',
      }],
      mrContext: {
        title: 'AI Self-Test',
        projectId: 'test',
        mrIid: 0,
        headSha: 'test',
      },
      snippets: [],
      redactionReport: {
        filesRedacted: 0,
        totalLinesRemoved: 0,
        patternsMatched: [],
      },
    });
    
    const durationMs = Date.now() - startTime;
    
    logger.info({
      event: 'worker.ai.self_test.success',
      durationMs,
      suggestionsCount: testResult.suggestions.length,
    }, `✅ AI self-test passed (${durationMs}ms)`);
  } catch (error) {
    const err = error as Error;
    logger.error({
      event: 'worker.ai.self_test.fail',
      error: err.message,
    }, `❌ AI self-test failed: ${err.message}`);
    // Don't exit - this is just a test
  }
}

/**
 * Log AI configuration diagnostics at startup
 */
async function logAiDiagnostics(): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  
  const aiEnabled = process.env.AI_ENABLED === 'true';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiKeyLength = openaiKey.trim().length;
  
  logger.info(
    {
      event: 'worker.ai.diagnostics',
      envFilePath,
      aiEnabled,
      openaiApiKeyLength: openaiKeyLength,
      openaiApiKeyPresent: openaiKeyLength > 0,
    },
    '🤖 AI Configuration Diagnostics'
  );
  
  // Check tenant AI config for default tenant
  try {
    const defaultTenantSlug = process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(defaultTenantSlug);
    const aiConfig = await prisma.tenantAiConfig.findUnique({
      where: { tenantId: tenant.id },
    });
    
    logger.info(
      {
        event: 'worker.ai.tenant.config',
        tenantSlug: defaultTenantSlug,
        tenantAiEnabled: aiConfig?.enabled || false,
        tenantAiProvider: aiConfig?.provider || null,
        tenantAiModel: aiConfig?.model || null,
      },
      `   Tenant "${defaultTenantSlug}" AI config: ${aiConfig?.enabled ? '✅ enabled' : '❌ disabled'}`
    );
  } catch (error) {
    logger.warn(
      {
        event: 'worker.ai.tenant.config.error',
        error: error instanceof Error ? error.message : String(error),
      },
      '   Could not check tenant AI config (database may not be available)'
    );
  }
}

let worker: Worker<ReviewMrJobPayload> | null = null;

/**
 * Safely read an integer environment variable with default and validation
 * @param name Environment variable name
 * @param defaultValue Default value if env var is missing or invalid
 * @param options Optional validation options
 * @returns Parsed integer value
 */
function readIntEnv(
  name: string,
  defaultValue: number,
  options?: { min?: number }
): number {
  const value = process.env[name];
  
  if (!value || value.trim().length === 0) {
    return defaultValue;
  }
  
  const parsed = Number.parseInt(value.trim(), 10);
  
  if (Number.isNaN(parsed)) {
    const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
    logger.warn(
      {
        event: 'worker.config.invalid_int',
        envVar: name,
        value,
        defaultValue,
      },
      `⚠️ Invalid integer value for ${name}: "${value}". Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  
  if (options?.min !== undefined && parsed < options.min) {
    const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
    logger.warn(
      {
        event: 'worker.config.invalid_int_range',
        envVar: name,
        value: parsed,
        min: options.min,
        defaultValue,
      },
      `⚠️ Value for ${name} (${parsed}) is below minimum (${options.min}). Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  
  return parsed;
}

/**
 * Helper to wrap promises with a timeout
 * Rejects with TimeoutError if the promise doesn't resolve within ms milliseconds
 */
class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`Timeout: ${label} exceeded ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(label, timeoutMs));
      }, timeoutMs);
    }),
  ]);
}

/**
 * Safely extract error message without exposing secrets
 */
function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    let msg = err.message;
    // Remove potential secrets (tokens, passwords, etc.)
    msg = msg.replace(/token[=:]\s*[\w-]+/gi, 'token=***');
    msg = msg.replace(/password[=:]\s*[^\s]+/gi, 'password=***');
    msg = msg.replace(/api[_-]?key[=:]\s*[\w-]+/gi, 'api_key=***');
    // Limit length
    if (msg.length > 500) {
      msg = msg.substring(0, 500) + '...';
    }
    return msg;
  }
  return String(err);
}

async function startWorker(): Promise<void> {
  // Startup assertions
  validateEnv();
  
  // Log structured env diagnostics
  logEnvDiagnostics();
  
  // Assert critical vars are non-empty
  try {
    requireEnv('REDIS_URL');
    // DATABASE_URL is optional for worker (only needed for DB features)
    // GITLAB_TOKEN is optional (only needed for posting comments)
  } catch (error) {
    const err = error as Error;
    const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
    logger.error({
      event: 'env.validation.failed',
      error: err.message,
      envFilePath,
    });
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }

  // Validate GitLab token at startup if present
  await validateGitLabToken();
  
  // Log AI diagnostics
  await logAiDiagnostics();
  
  // AI connectivity self-test (if enabled)
  if (process.env.AI_SELF_TEST === 'true') {
    await runAiSelfTest();
  }

  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  });

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const redisHost = extractRedisHost(redisUrl);
  const redisUrlRedacted = redactRedisUrl(redisUrl);

  // Extract Redis connection details
  let redisInfo: {
    host?: string;
    port?: number;
    db?: number;
  } = {};
  
  try {
    const urlObj = new URL(redisUrl);
    redisInfo.host = urlObj.hostname;
    redisInfo.port = Number.parseInt(urlObj.port || '6379', 10);
    const dbMatch = urlObj.pathname?.match(/^\/(\d+)/);
    redisInfo.db = dbMatch ? Number.parseInt(dbMatch[1], 10) : 0;
  } catch {
    // Ignore parsing errors
  }

  // Extract DB connection info for logging
  const databaseUrl = process.env.DATABASE_URL;
  let dbInfo: {
    host?: string;
    port?: number;
    database?: string;
    url?: string;
  } = {};
  
  if (databaseUrl) {
    try {
      const urlObj = new URL(databaseUrl);
      dbInfo.host = urlObj.hostname;
      dbInfo.port = Number.parseInt(urlObj.port || '5432', 10);
      // Extract database name from path (remove leading /)
      dbInfo.database = urlObj.pathname?.replace(/^\//, '') || 'unknown';
      // Redact password
      if (urlObj.password) {
        urlObj.password = '***';
      }
      dbInfo.url = urlObj.toString();
    } catch {
      // Ignore parsing errors
      dbInfo.url = databaseUrl.replace(/:[^:@]+@/, ':***@');
    }
  }

  // Read worker configuration from environment
  const workerConcurrency = readIntEnv('WORKER_CONCURRENCY', 1, { min: 1 });
  const workerLockDuration = readIntEnv('WORKER_LOCK_DURATION_MS', 300000, { min: 1000 }); // 5 min default
  const workerStalledInterval = readIntEnv('WORKER_STALLED_INTERVAL_MS', 30000, { min: 1000 }); // 30s default
  const workerMaxStalledCount = readIntEnv('WORKER_MAX_STALLED_COUNT', 1, { min: 1 });

  logger.info('🚀 Worker starting...');
  logger.info(`   Node version: ${process.version}`);
  logger.info(`   Process PID: ${process.pid}`);
  logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   Queue name: ${QUEUE_NAME}`);
  logger.info(`   Redis URL: ${redisUrlRedacted}`);
  logger.info(`   Redis host: ${redisHost}`);
  if (redisInfo.db !== undefined) {
    logger.info(`   Redis DB: ${redisInfo.db}`);
  }
  if (dbInfo.host) {
    logger.info(`   Database URL: ${dbInfo.url || 'unknown'}`);
    logger.info(`   Database host: ${dbInfo.host}:${dbInfo.port || 5432}`);
    logger.info(`   Database name: ${dbInfo.database || 'unknown'}`);
  } else {
    logger.warn('   Database: DATABASE_URL not set (optional for worker)');
  }

  // Log worker configuration (effective values)
  logger.info({
    event: 'worker.config',
    concurrency: workerConcurrency,
    lockDuration: workerLockDuration,
    stalledInterval: workerStalledInterval,
    maxStalledCount: workerMaxStalledCount,
    queueName: QUEUE_NAME,
    queuePrefix: 'bull', // Default BullMQ prefix
    redisHost,
    redisDb: redisInfo.db || 0,
  }, 'Worker configuration');
  
  logger.info(`   Worker concurrency: ${workerConcurrency}`);
  logger.info(`   Worker lock duration: ${workerLockDuration}ms (${Math.round(workerLockDuration / 1000)}s)`);
  logger.info(`   Worker stalled interval: ${workerStalledInterval}ms (${Math.round(workerStalledInterval / 1000)}s)`);
  logger.info(`   Worker max stalled count: ${workerMaxStalledCount}`);

  try {
    // Create Redis connection for BullMQ worker
    const redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    // Create BullMQ worker
    worker = new Worker<ReviewMrJobPayload>(
      QUEUE_NAME,
      async (job) => {
        const jobLogger = pino({
          level: process.env.LOG_LEVEL || 'info',
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          },
        });

        const startTime = Date.now();
        const { tenantSlug, projectId, mrIid, headSha, isMergedCandidate } = job.data;
        const reviewRunId = job.data.reviewRunId || null;

        // Log job start immediately
        jobLogger.info(
          {
            event: 'job.start',
            jobId: job.id,
            reviewRunId,
            tenantSlug,
            projectId,
            mrIid,
            headSha,
            attemptsMade: job.attemptsMade,
            lookupPath: reviewRunId ? 'by_reviewRunId' : 'by_mr_headSha',
          },
          'Processing review job'
        );

        // Track ReviewRun for finalization
        let reviewRun: { id: string; status: string; tenantId: string } | null = null;
        let finalStatus: 'SUCCEEDED' | 'FAILED' | null = null;

        try {
          // Resolve tenant
          const tenant = await getOrCreateTenantBySlug(tenantSlug);

          // Find the ReviewRun
          // CRITICAL: If reviewRunId is present, use it EXCLUSIVELY (no fallback).
          // This ensures manual triggers always process the exact ReviewRun that was created.
          let foundReviewRun;
          if (job.data.reviewRunId) {
            // Manual trigger: fetch by reviewRunId only
            foundReviewRun = await prisma.reviewRun.findUnique({
              where: {
                id: job.data.reviewRunId,
              },
              include: {
                mergeRequest: {
                  include: {
                    repository: true,
                  },
                },
              },
            });

            // Verify tenant matches (security check)
            if (foundReviewRun && foundReviewRun.tenantId !== tenant.id) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.tenant_mismatch',
                  jobId: job.id,
                  tenantId: tenant.id,
                  reviewRunTenantId: foundReviewRun.tenantId,
                  reviewRunId: job.data.reviewRunId,
                },
                'ReviewRun belongs to different tenant - stopping retries'
              );
              throw new Error(`ReviewRun ${job.data.reviewRunId} does not belong to tenant ${tenant.id}`);
            }

            if (!foundReviewRun) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.missing_by_id',
                  jobId: job.id,
                  tenantId: tenant.id,
                  reviewRunId: job.data.reviewRunId,
                },
                'ReviewRun not found by reviewRunId - stopping retries'
              );
              throw new Error(`ReviewRun not found for reviewRunId=${job.data.reviewRunId}, tenantId=${tenant.id}`);
            }
          } else {
            // Legacy webhook-triggered: lookup by MR + headSha
            foundReviewRun = await prisma.reviewRun.findFirst({
              where: {
                tenantId: tenant.id,
                mergeRequest: {
                  repository: {
                    provider: 'gitlab',
                    providerRepoId: projectId,
                  },
                  iid: mrIid,
                },
                headSha,
              },
              include: {
                mergeRequest: {
                  include: {
                    repository: true,
                  },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            });

            if (!foundReviewRun) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.missing',
                  jobId: job.id,
                  tenantId: tenant.id,
                  provider: 'gitlab',
                  projectId,
                  mrIid,
                  headSha,
                },
                'ReviewRun not found - stopping retries'
              );
              // Don't retry if ReviewRun doesn't exist - this is a permanent error
              throw new Error(`ReviewRun not found for tenantId=${tenant.id}, provider=gitlab, projectId=${projectId}, mrIid=${mrIid}, headSha=${headSha}`);
            }
          }

          // Assign to outer scope for finally block
          reviewRun = foundReviewRun;

          // CRITICAL: Mark as RUNNING IMMEDIATELY after finding ReviewRun
          // This ensures the portal sees progress right away, before any heavy work
          // Always update (even if already RUNNING) to refresh startedAt timestamp
          const oldStatus = reviewRun.status;
          await prisma.reviewRun.update({
            where: { id: reviewRun.id },
            data: {
              status: 'RUNNING',
              startedAt: new Date(),
              error: null, // Clear previous error on retry
            },
          });

          // Refresh reviewRun object with updated status
          reviewRun = await prisma.reviewRun.findUnique({
            where: { id: reviewRun.id },
            include: {
              mergeRequest: {
                include: {
                  repository: true,
                },
              },
            },
          });

          if (!reviewRun) {
            throw new Error(`ReviewRun ${reviewRun.id} not found after status update`);
          }

          jobLogger.info(
            {
              event: 'reviewrun.status.updated',
              jobId: job.id,
              reviewRunId: reviewRun.id,
              lookupPath: job.data.reviewRunId ? 'by_reviewRunId' : 'by_mr_headSha',
              oldStatus,
              newStatus: 'RUNNING',
            },
            'ReviewRun status updated to RUNNING (immediate)'
          );

          // If ReviewRun is already SUCCEEDED, skip processing
          if (reviewRun.status === 'SUCCEEDED') {
            jobLogger.info(
              {
                event: 'duplicate_headSha_skip',
                jobId: job.id,
                existingReviewRunId: reviewRun.id,
                headSha,
              },
              'Skipping: ReviewRun already exists with SUCCEEDED status for this headSha'
            );
            return { skipped: true, reason: 'duplicate_headSha' };
          }

          // If ReviewRun is FAILED and this is a retry, check if we should retry
          if (reviewRun.status === 'FAILED' && job.attemptsMade > 0) {
            // Only retry if the previous error was transient (429, 5xx, timeout)
            // For auth errors (401/403/404), don't retry
            const previousError = reviewRun.error || '';
            const isTransientError = 
              previousError.includes('429') ||
              previousError.includes('5') ||
              previousError.includes('timeout') ||
              previousError.includes('network');
            
            if (!isTransientError) {
              jobLogger.info(
                {
                  event: 'worker.reviewrun.skip_retry',
                  jobId: job.id,
                  reviewRunId: reviewRun.id,
                  previousError,
                  attemptsMade: job.attemptsMade,
                },
                'Skipping retry: ReviewRun failed with non-transient error'
              );
              return { skipped: true, reason: 'non_transient_error' };
            }
          }

          // Check idempotency: look for existing ReviewCheckResult
          const existingResults = await prisma.reviewCheckResult.findFirst({
            where: {
              tenantId: tenant.id,
              reviewRunId: reviewRun.id,
            },
          });

          if (existingResults) {
            jobLogger.info(
              {
                event: 'worker.checks.skip.exists',
                reviewRunId: reviewRun.id,
                existingResultId: existingResults.id,
              },
              'ReviewCheckResult already exists, skipping checks run'
            );

            // Update ReviewRun to SUCCEEDED if not already
            if (reviewRun.status !== 'SUCCEEDED') {
              // Recompute score from existing results
              const allResults = await prisma.reviewCheckResult.findMany({
                where: {
                  tenantId: tenant.id,
                  reviewRunId: reviewRun.id,
                },
              });

              const passCount = allResults.filter(r => r.status === 'PASS').length;
              const warnCount = allResults.filter(r => r.status === 'WARN').length;
              const failCount = allResults.filter(r => r.status === 'FAIL').length;
              const score = Math.round(
                (passCount * 10 + warnCount * 5 + failCount * 0) / allResults.length * 10
              );

              await prisma.reviewRun.update({
                where: { id: reviewRun.id },
                data: {
                  status: 'SUCCEEDED',
                  finishedAt: new Date(),
                  score,
                  summary: `${allResults.length} checks: ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL`,
                },
              });

              jobLogger.info(
                {
                  event: 'worker.reviewrun.updated',
                  reviewRunId: reviewRun.id,
                  oldStatus: reviewRun.status,
                  newStatus: 'SUCCEEDED',
                },
                'ReviewRun status updated to SUCCEEDED (idempotent skip)'
              );
            }
          } else {
            // Fetch MR changes and run checks
            try {
              // Create GitLab client
              const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';
              const gitlabToken = process.env.GITLAB_TOKEN;
              
              if (!gitlabToken) {
                throw new Error('GITLAB_TOKEN environment variable is required');
              }

              const gitlabClient = createGitLabClient({
                baseUrl: gitlabBaseUrl,
                token: gitlabToken,
              });

              // Fetch MR changes
              jobLogger.info(
                {
                  event: 'worker.diff.fetch.start',
                  reviewRunId: reviewRun.id,
                  projectId,
                  mrIid,
                },
                'Fetching MR changes from GitLab'
              );

              // Fetch MR changes with timeout
              const mrChanges = await withTimeout(
                gitlabClient.getMergeRequestChanges(projectId, mrIid),
                30000, // 30s timeout
                `GitLab getMergeRequestChanges(${projectId}, ${mrIid})`
              );

              // Normalize changes array
              const changes: Change[] = mrChanges.changes.map((change) => ({
                path: change.new_path || change.old_path,
                diff: change.diff || '',
              }));

              const totalDiffBytes = changes.reduce((sum, c) => sum + c.diff.length, 0);

              jobLogger.info(
                {
                  event: 'worker.diff.fetch.success',
                  reviewRunId: reviewRun.id,
                  filesChangedCount: changes.length,
                  totalDiffBytes,
                },
                'MR changes fetched successfully'
              );

              // Load tenant check configs
              const tenantCheckConfigs = await prisma.checkConfig.findMany({
                where: { tenantId: tenant.id },
              });

              const checkConfigs: CheckConfig[] = tenantCheckConfigs.map(c => ({
                checkKey: c.checkKey,
                enabled: c.enabled,
                severityOverride: c.severityOverride as 'PASS' | 'WARN' | 'FAIL' | undefined,
                thresholds: c.thresholds as Record<string, unknown> | undefined,
              }));

              const enabledCount = checkConfigs.filter(c => c.enabled).length;
              const disabledCount = checkConfigs.filter(c => !c.enabled).length;
              const overriddenCount = checkConfigs.filter(c => c.severityOverride).length;

              jobLogger.info(
                {
                  event: 'worker.checks.config.loaded',
                  reviewRunId: reviewRun.id,
                  totalConfigs: checkConfigs.length,
                  enabledCount,
                  disabledCount,
                  overriddenCount,
                },
                'Tenant check configs loaded'
              );

              // Run checks
              jobLogger.info(
                {
                  event: 'worker.checks.run.start',
                  reviewRunId: reviewRun.id,
                  changesCount: changes.length,
                  enabledChecks: enabledCount,
                },
                'Running deterministic checks'
              );

              const checkResults = runChecks(
                {
                  changes,
                  mr: {
                    title: mrChanges.title,
                    description: mrChanges.description || undefined,
                  },
                },
                checkConfigs.length > 0 ? checkConfigs : undefined
              );

              const passCount = checkResults.filter(r => r.status === 'PASS').length;
              const warnCount = checkResults.filter(r => r.status === 'WARN').length;
              const failCount = checkResults.filter(r => r.status === 'FAIL').length;

              jobLogger.info(
                {
                  event: 'worker.checks.run.end',
                  reviewRunId: reviewRun.id,
                  passCount,
                  warnCount,
                  failCount,
                  totalChecks: checkResults.length,
                },
                'Checks completed'
              );

              // Persist ReviewCheckResult rows
              const persistedResults = await Promise.all(
                checkResults.map((result) =>
                  prisma.reviewCheckResult.create({
                    data: {
                      tenantId: tenant.id,
                      reviewRunId: reviewRun.id,
                      checkKey: result.key,
                      category: result.category,
                      status: result.status,
                      severity: result.status === 'FAIL' ? 'BLOCKER' : result.status === 'WARN' ? 'WARN' : 'INFO',
                      message: result.title,
                      filePath: result.filePath || null,
                      lineStart: result.lineHint || null,
                      evidence: result.details,
                    },
                  })
                )
              );

              jobLogger.info(
                {
                  event: 'worker.db.results.persisted',
                  reviewRunId: reviewRun.id,
                  count: persistedResults.length,
                },
                'ReviewCheckResult rows persisted'
              );

              // Compute score with category weights
              const score = calculateScore(checkResults);

              // Handle GOLD promotion for merged MRs
              let goldPromoted = false;
              if (isMergedCandidate) {
                try {
                  // Fetch MR details to confirm merged state
                  const mr = await withTimeout(
                    gitlabClient.getMergeRequest(projectId, mrIid),
                    30000, // 30s timeout
                    `GitLab getMergeRequest(${projectId}, ${mrIid})`
                  );
                  
                  if (mr.state === 'merged' || mr.merged_at) {
                    // Fetch approvals (graceful degradation if unavailable)
                    const approvals = await withTimeout(
                      gitlabClient.getMergeRequestApprovals(projectId, mrIid).catch(() => null),
                      20000, // 20s timeout
                      `GitLab getMergeRequestApprovals(${projectId}, ${mrIid})`
                    );
                    const approvalsCount = approvals?.approved_by?.length;
                    
                    // Prepare check results for GOLD evaluation
                    const checkResultsForGold = checkResults.map(r => ({
                      category: r.category,
                      status: r.status,
                    }));
                    
                    try {
                      const goldResult = await promoteToGold({
                        tenantId: tenant.id,
                        projectId,
                        mrIid,
                        mr,
                        mrChanges,
                        reviewRunId: reviewRun.id,
                        score,
                        checkResults: checkResultsForGold,
                        approvalsCount,
                        mergedBy: mr.merged_by?.username,
                        mergeCommitSha: mr.merge_commit_sha || undefined,
                        mergedAt: mr.merged_at ? new Date(mr.merged_at) : undefined,
                      });
                      
                      goldPromoted = goldResult.created;
                      
                      jobLogger.info(
                        {
                          event: 'knowledge.gold.promoted',
                          tenantId: tenant.id,
                          projectId,
                          mrIid,
                          knowledgeSourceId: goldResult.id,
                          created: goldResult.created,
                        },
                        goldResult.created ? '✅ MR promoted to GOLD' : 'GOLD MR already exists'
                      );
                    } catch (goldError: unknown) {
                      const err = goldError as Error;
                      jobLogger.info(
                        {
                          event: 'knowledge.gold.evaluate.fail',
                          tenantId: tenant.id,
                          projectId,
                          mrIid,
                          error: err.message,
                        },
                        `MR does not qualify for GOLD: ${err.message}`
                      );
                    }
                  }
                } catch (goldError: unknown) {
                  const err = goldError as Error;
                  jobLogger.error(
                    {
                      event: 'knowledge.gold.promotion.error',
                      tenantId: tenant.id,
                      projectId,
                      mrIid,
                      error: err.message,
                    },
                    `Failed to promote MR to GOLD: ${err.message}`
                  );
                  // Don't fail the job if GOLD promotion fails
                }
              }

              // Lookup GOLD precedents for non-merged MRs
              let precedentReferences = '';
              if (!isMergedCandidate) {
                try {
                  const featureSignature = computeFeatureSignature({
                    title: mrChanges.title,
                    description: mrChanges.description || undefined,
                    changes,
                  });
                  
                  jobLogger.info(
                    {
                      event: 'feature.signature.computed',
                      reviewRunId: reviewRun.id,
                      tokensCount: featureSignature.tokens.length,
                      topTokens: featureSignature.tokens.slice(0, 5),
                    },
                    'Feature signature computed'
                  );
                  
                  const precedents = await findGoldPrecedents(tenant.id, featureSignature);
                  
                  if (precedents.matches.length > 0) {
                    precedentReferences = formatPrecedentReferences(precedents.matches);
                    jobLogger.info(
                      {
                        event: 'knowledge.gold.precedents.found',
                        reviewRunId: reviewRun.id,
                        count: precedents.matches.length,
                      },
                      `Found ${precedents.matches.length} GOLD precedents`
                    );
                  }
                } catch (precedentError: unknown) {
                  const err = precedentError as Error;
                  jobLogger.error(
                    {
                      event: 'knowledge.gold.precedents.error',
                      reviewRunId: reviewRun.id,
                      error: err.message,
                    },
                    `Failed to lookup GOLD precedents: ${err.message}`
                  );
                  // Don't fail the job if precedent lookup fails
                }
              }

              // Update ReviewRun
              await prisma.reviewRun.update({
                where: { id: reviewRun.id },
                data: {
                  status: 'SUCCEEDED',
                  finishedAt: new Date(),
                  score,
                  summary: `${checkResults.length} checks: ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL`,
                },
              });

              jobLogger.info(
                {
                  event: 'worker.reviewrun.updated',
                  reviewRunId: reviewRun.id,
                  oldStatus: 'RUNNING',
                  newStatus: 'SUCCEEDED',
                  score,
                },
                'ReviewRun updated with check results'
              );

              // Generate AI suggestions if enabled
              let aiSuggestionsSection = '';
              let aiSummaryHash: string | null = null;
              const aiEnabled = process.env.AI_ENABLED === 'true';
              
              if (!aiEnabled) {
                jobLogger.info(
                  {
                    event: 'worker.ai.suggestions.skip',
                    reviewRunId: reviewRun.id,
                    reason: 'ai.disabled.env',
                    aiEnabled: false,
                  },
                  'Skipping AI suggestions: AI_ENABLED not true'
                );
              } else {
                try {
                  // Load tenant AI config
                  const aiConfig = await prisma.tenantAiConfig.findUnique({
                    where: { tenantId: tenant.id },
                  });
                  
                  if (!aiConfig?.enabled) {
                    jobLogger.info(
                      {
                        event: 'worker.ai.suggestions.skip',
                        reviewRunId: reviewRun.id,
                        reason: 'ai.disabled.tenant',
                        tenantId: tenant.id,
                      },
                      'Skipping AI suggestions: tenant AI config disabled'
                    );
                  } else {
                    // Check total diff size
                    const totalDiffBytes = changes.reduce((sum, c) => sum + c.diff.length, 0);
                    
                    if (totalDiffBytes > aiConfig.maxTotalDiffBytes) {
                      jobLogger.info(
                        {
                          event: 'worker.ai.suggestions.skip',
                          reviewRunId: reviewRun.id,
                          reason: 'totalDiffBytes exceeds threshold',
                          totalDiffBytes,
                          maxTotalDiffBytes: aiConfig.maxTotalDiffBytes,
                        },
                        'Skipping AI suggestions: diff too large'
                      );
                    } else {
                      // Get failing check results (WARN/FAIL only)
                      const failingResults = checkResults
                        .filter(r => r.status === 'WARN' || r.status === 'FAIL')
                        .sort((a, b) => {
                          // Prioritize SECURITY, then CODE_QUALITY, then others
                          const categoryOrder: Record<string, number> = {
                            SECURITY: 0,
                            CODE_QUALITY: 1,
                            ARCHITECTURE: 2,
                            PERFORMANCE: 3,
                            TESTING: 4,
                            OBSERVABILITY: 5,
                            REPO_HYGIENE: 6,
                          };
                          const aOrder = categoryOrder[a.category] ?? 99;
                          const bOrder = categoryOrder[b.category] ?? 99;
                          if (aOrder !== bOrder) return aOrder - bOrder;
                          // Then by severity (FAIL before WARN)
                          if (a.status !== b.status) {
                            return a.status === 'FAIL' ? -1 : 1;
                          }
                          return 0;
                        })
                        .slice(0, aiConfig.maxSuggestions);
                      
                      if (failingResults.length > 0) {
                        jobLogger.info(
                          {
                            event: 'worker.ai.suggestions.start',
                            reviewRunId: reviewRun.id,
                            failingChecksCount: failingResults.length,
                            totalDiffBytes,
                          },
                          'Generating AI suggestions'
                        );
                        
                        // Select snippets with privacy controls
                        const privacyChanges: PrivacyChange[] = changes.map(c => ({
                          path: c.path,
                          diff: c.diff,
                        }));
                        
                        const snippetResult = selectSnippets(
                          privacyChanges,
                          failingResults.map(r => ({
                            checkKey: r.key,
                            filePath: r.filePath,
                            lineHint: r.lineHint,
                            evidence: r.details,
                          })),
                          aiConfig.maxPromptChars,
                          40
                        );
                        
                        jobLogger.info(
                          {
                            event: 'worker.ai.snippets.selected',
                            reviewRunId: reviewRun.id,
                            snippetsCount: snippetResult.snippets.length,
                            totalChars: snippetResult.totalChars,
                            filesRedacted: snippetResult.redactionReport.filesRedacted,
                            skippedFilesCount: snippetResult.skippedFiles?.length || 0,
                          },
                          'Code snippets selected for AI'
                        );
                        
                        // Check if we have no snippets - use fallback
                        const useFallback = snippetResult.snippets.length === 0;
                        
                        if (useFallback) {
                          jobLogger.info(
                            {
                              event: 'worker.ai.fallback.no_snippets',
                              reviewRunId: reviewRun.id,
                              reason: 'no_snippets_selected',
                              skippedFilesCount: snippetResult.skippedFiles?.length || 0,
                            },
                            'No snippets selected, using fallback prompt (check-only mode)'
                          );
                        }
                        
                        // Get precedents for context (if available)
                        let precedentsForAi: Array<{
                          id: string;
                          title: string;
                          sourceUrl: string | null;
                          matchedTokens: string[];
                        }> = [];
                        
                        if (!isMergedCandidate && precedentReferences) {
                          // Reuse precedents from earlier lookup
                          try {
                            const featureSignature = computeFeatureSignature({
                              title: mrChanges.title,
                              description: mrChanges.description || undefined,
                              changes,
                            });
                            const precedents = await findGoldPrecedents(tenant.id, featureSignature);
                            precedentsForAi = precedents.matches.map(m => ({
                              id: m.id,
                              title: m.title,
                              sourceUrl: m.sourceUrl,
                              matchedTokens: m.matchedTokens,
                            }));
                          } catch {
                            // Ignore errors, proceed without precedents
                          }
                        }
                        
                        // Create LLM client
                        const openaiApiKey = process.env.OPENAI_API_KEY;
                        if (!openaiApiKey || openaiApiKey.length === 0) {
                          jobLogger.info(
                            {
                              event: 'worker.ai.suggestions.skip',
                              reviewRunId: reviewRun.id,
                              reason: 'ai.disabled.missing_key',
                            },
                            'Skipping AI suggestions: OPENAI_API_KEY missing or empty'
                          );
                        } else {
                          const llmClient = createLlmClient({
                          provider: 'OPENAI',
                          apiKey: openaiApiKey,
                          model: aiConfig.model,
                          timeout: 120000, // 120s default
                          maxRetries: 3,
                        });
                        
                        // Build input - use fallback if no snippets
                        const llmInput: Parameters<typeof llmClient.generateSuggestions>[0] = {
                          checkResults: failingResults.map(r => ({
                            checkKey: r.key,
                            category: r.category,
                            status: r.status,
                            title: r.title,
                            evidence: r.details,
                            filePath: r.filePath,
                            lineHint: r.lineHint,
                          })),
                          precedents: precedentsForAi.length > 0 ? precedentsForAi : undefined,
                          mrContext: {
                            title: mrChanges.title,
                            description: mrChanges.description || undefined,
                            projectId,
                            mrIid,
                            headSha,
                          },
                          snippets: useFallback ? [] : snippetResult.snippets.map((s: CodeSnippet) => ({
                            path: s.path,
                            content: s.content,
                            lineStart: s.lineStart,
                            lineEnd: s.lineEnd,
                          })),
                          redactionReport: snippetResult.redactionReport,
                        };
                        
                        // Add file paths list for fallback
                        if (useFallback) {
                          // Include file paths changed in the prompt context
                          const filePathsChanged = changes.map(c => c.path).filter((path, idx, arr) => arr.indexOf(path) === idx);
                          jobLogger.debug({
                            event: 'worker.ai.fallback.context',
                            reviewRunId: reviewRun.id,
                            filePathsCount: filePathsChanged.length,
                            filePaths: filePathsChanged.slice(0, 10), // Log first 10
                          }, 'Fallback mode: including file paths in context');
                        }
                        
                        // Generate suggestions
                        const llmOutput = await withTimeout(
                          llmClient.generateSuggestions(llmInput),
                          120000, // 120s timeout for LLM
                          `LLM generateSuggestions for reviewRunId=${reviewRun.id}`
                        );
                        
                        // Normalize suggestedFix: convert arrays to markdown strings
                        // This ensures we always have strings for database storage and comment rendering
                        const normalizedSuggestions = llmOutput.suggestions.map((suggestion: LlmAiSuggestion) => {
                          let normalizedFix: string;
                          
                          if (Array.isArray(suggestion.suggestedFix)) {
                            // Handle empty array
                            if (suggestion.suggestedFix.length === 0) {
                              normalizedFix = 'No fix suggestion provided.';
                            } else {
                              // Join array items with \n- and prefix first line with -
                              const trimmed = suggestion.suggestedFix.filter(item => item.trim().length > 0);
                              if (trimmed.length === 0) {
                                normalizedFix = 'No fix suggestion provided.';
                              } else {
                                normalizedFix = trimmed.map((item, idx) => {
                                  const trimmedItem = item.trim();
                                  // If first item doesn't start with bullet, add it
                                  if (idx === 0 && !trimmedItem.startsWith('-') && !trimmedItem.startsWith('*')) {
                                    return `- ${trimmedItem}`;
                                  }
                                  // For subsequent items, ensure they have bullets
                                  if (idx > 0 && !trimmedItem.startsWith('-') && !trimmedItem.startsWith('*')) {
                                    return `- ${trimmedItem}`;
                                  }
                                  return trimmedItem;
                                }).join('\n');
                              }
                            }
                            
                            // Log normalization
                            jobLogger.info({
                              event: 'worker.ai.suggestions.normalized',
                              reviewRunId: reviewRun.id,
                              checkKey: suggestion.checkKey,
                              originalType: 'array',
                              arrayLength: suggestion.suggestedFix.length,
                              normalizedLength: normalizedFix.length,
                            }, `Normalized suggestedFix from array to string for ${suggestion.checkKey}`);
                          } else {
                            normalizedFix = suggestion.suggestedFix;
                          }
                          
                          return {
                            ...suggestion,
                            suggestedFix: normalizedFix,
                          };
                        });
                        
                        // Persist AI suggestions (now all with normalized string suggestedFix)
                        const persistedSuggestions = await Promise.all(
                          normalizedSuggestions.map((suggestion) =>
                            prisma.aiSuggestion.create({
                              data: {
                                tenantId: tenant.id,
                                reviewRunId: reviewRun.id,
                                checkKey: suggestion.checkKey,
                                severity: suggestion.severity,
                                title: suggestion.title,
                                rationale: suggestion.rationale,
                                suggestedFix: suggestion.suggestedFix, // Now guaranteed to be string
                                files: suggestion.files,
                              },
                            })
                          )
                        );
                        
                        jobLogger.info(
                          {
                            event: 'worker.ai.suggestions.success',
                            reviewRunId: reviewRun.id,
                            suggestionsCount: persistedSuggestions.length,
                          },
                          'AI suggestions generated and persisted'
                        );
                        
                        // Build AI suggestions section
                        const aiLines: string[] = [];
                        aiLines.push('### 🤖 AI Fix Suggestions (Preview)');
                        aiLines.push('');
                        
                        for (const suggestion of normalizedSuggestions) {
                          aiLines.push(`#### **[${suggestion.severity}] ${suggestion.title}** (${suggestion.checkKey})`);
                          aiLines.push('');
                          aiLines.push(`**Why it matters:** ${suggestion.rationale}`);
                          aiLines.push('');
                          aiLines.push('**Suggested fix:**');
                          const fixBullets = suggestion.suggestedFix
                            .split('\n')
                            .filter((line: string) => line.trim())
                            .map((line: string) => line.trim().startsWith('-') || line.trim().startsWith('*') ? line.trim() : `- ${line.trim()}`);
                          aiLines.push(...fixBullets);
                          
                          if (suggestion.files.length > 0) {
                            aiLines.push('');
                            aiLines.push('**Files:**');
                            for (const file of suggestion.files) {
                              const lineInfo = file.lineStart && file.lineEnd
                                ? ` (lines ${file.lineStart}-${file.lineEnd})`
                                : '';
                              aiLines.push(`- \`${file.path}\`${lineInfo}`);
                            }
                          }
                          
                          if (suggestion.precedentRefs && suggestion.precedentRefs.length > 0) {
                            aiLines.push('');
                            aiLines.push('**Referenced precedents:**');
                            for (const ref of suggestion.precedentRefs) {
                              aiLines.push(`- [${ref.title}](${ref.sourceUrl})`);
                            }
                          }
                          
                          aiLines.push('');
                        }
                        
                          aiSuggestionsSection = aiLines.join('\n');
                          
                          // Compute hash of AI section for idempotency
                          aiSummaryHash = createHash('sha256')
                            .update(aiSuggestionsSection, 'utf8')
                            .digest('hex');
                        }
                      } else {
                        jobLogger.info(
                          {
                            event: 'worker.ai.suggestions.skip',
                            reviewRunId: reviewRun.id,
                            reason: 'no failing checks',
                          },
                          'Skipping AI suggestions: no failing checks'
                        );
                      }
                    }
                  }
                } catch (aiError: unknown) {
                  const err = aiError as Error;
                  
                  // Determine error reason code
                  let errorReason: 'timeout' | 'network' | 'auth' | 'rate_limit' | 'unknown' = 'unknown';
                  if (err.message.includes('timeout')) {
                    errorReason = 'timeout';
                  } else if (err.message.includes('network') || err.message.includes('fetch') || err.message.includes('ECONNREFUSED')) {
                    errorReason = 'network';
                  } else if (err.message.includes('auth') || err.message.includes('401') || err.message.includes('403')) {
                    errorReason = 'auth';
                  } else if (err.message.includes('429') || err.message.includes('rate')) {
                    errorReason = 'rate_limit';
                  }
                  
                  jobLogger.error(
                    {
                      event: 'worker.ai.suggestions.failed',
                      reviewRunId: reviewRun.id,
                      error: err.message,
                      errorReason: `ai.error.${errorReason}`,
                    },
                    `Failed to generate AI suggestions: ${err.message}`
                  );
                  // Don't fail the job if AI fails - continue with deterministic comment only
                }
              }

              // Update or create GitLab comment
              const existingComment = await prisma.postedComment.findFirst({
                where: {
                  tenantId: tenant.id,
                  reviewRunId: reviewRun.id,
                  type: 'SUMMARY',
                },
              });

              // Build comment body with categorized checklist results
              const checklistSections = formatCheckResultsForComment(checkResults);
              
              let commentBody = `## 🤖 Automated Review (Deterministic Checks)
**Score:** ${score}/100 — ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL
**Head SHA:** \`${headSha}\`
**Run ID:** \`${reviewRun.id}\`

${checklistSections}`;

              // Add GOLD promotion notice if promoted
              if (goldPromoted) {
                commentBody += `\n\n✅ **Promoted to GOLD precedent**`;
              }
              
              // Add precedent references if found
              if (precedentReferences) {
                commentBody += `\n\n${precedentReferences}`;
              }
              
              // Add AI suggestions section if available
              if (aiSuggestionsSection) {
                commentBody += `\n\n${aiSuggestionsSection}`;
              }

              if (existingComment) {
                // Check if AI section changed (idempotency)
                const aiIncluded = !!aiSuggestionsSection;
                const shouldUpdate = 
                  existingComment.body !== commentBody ||
                  existingComment.aiIncluded !== aiIncluded ||
                  existingComment.aiSummaryHash !== aiSummaryHash;
                
                if (!shouldUpdate) {
                  jobLogger.info(
                    {
                      event: 'worker.gitlab.note.skip',
                      reviewRunId: reviewRun.id,
                      postedCommentId: existingComment.id,
                    },
                    'Comment unchanged, skipping update'
                  );
                } else {
                  // Update existing note
                  jobLogger.info(
                    {
                      event: 'worker.gitlab.note.update.start',
                      reviewRunId: reviewRun.id,
                      postedCommentId: existingComment.id,
                      noteId: existingComment.providerId,
                      aiIncluded,
                    },
                    'Updating existing GitLab note'
                  );

                  try {
                    await withTimeout(
                      gitlabClient.updateMergeRequestNote(
                        projectId,
                        mrIid,
                        existingComment.providerId,
                        commentBody
                      ),
                      30000, // 30s timeout
                      `GitLab updateMergeRequestNote(${projectId}, ${mrIid}, ${existingComment.providerId})`
                    );

                    // Update PostedComment body
                    await prisma.postedComment.update({
                      where: { id: existingComment.id },
                      data: {
                        body: commentBody,
                        aiIncluded,
                        aiSummaryHash,
                      },
                    });

                    jobLogger.info(
                      {
                        event: 'worker.gitlab.note.update.success',
                        reviewRunId: reviewRun.id,
                        postedCommentId: existingComment.id,
                      },
                      'GitLab note updated successfully'
                    );
                  } catch (updateError: unknown) {
                    const err = updateError as Error;
                    jobLogger.error(
                      {
                        event: 'worker.gitlab.note.update.fail',
                        reviewRunId: reviewRun.id,
                        postedCommentId: existingComment.id,
                        error: err.message,
                        stack: err.stack,
                      },
                      'Failed to update GitLab note'
                    );
                    // Don't fail the job if note update fails
                  }
                }
              } else {
                // Create new note
                jobLogger.info(
                  {
                    event: 'worker.gitlab.comment.start',
                    reviewRunId: reviewRun.id,
                    projectId,
                    mrIid,
                  },
                  'Creating new GitLab comment'
                );

                const note = await withTimeout(
                  gitlabClient.createMergeRequestNote(
                    projectId,
                    mrIid,
                    commentBody
                  ),
                  30000, // 30s timeout
                  `GitLab createMergeRequestNote(${projectId}, ${mrIid})`
                );

                jobLogger.info(
                  {
                    event: 'worker.gitlab.comment.posted',
                    reviewRunId: reviewRun.id,
                    projectId,
                    mrIid,
                    noteId: note.id,
                  },
                  'GitLab comment posted successfully'
                );

                // Persist PostedComment
                const postedComment = await prisma.postedComment.create({
                  data: {
                    tenantId: tenant.id,
                    reviewRunId: reviewRun.id,
                    provider: 'gitlab',
                    providerId: String(note.id),
                    type: 'SUMMARY',
                    body: commentBody,
                    aiIncluded: !!aiSuggestionsSection,
                    aiSummaryHash,
                  },
                });

                jobLogger.info(
                  {
                    event: 'worker.gitlab.comment.persisted',
                    reviewRunId: reviewRun.id,
                    postedCommentId: postedComment.id,
                  },
                  'PostedComment persisted to database'
                );
              }
            } catch (error: unknown) {
              const err = error as Error & { statusCode?: number };
              
              // Check if this is a GitLab API error (401/403/404) - these are non-retryable
              const isAuthError = err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404;
              const errorMessage = isAuthError 
                ? `GitLab API error (${err.statusCode}): ${err.message}`
                : `Failed to process review: ${err.message}`;
              
              jobLogger.error(
                {
                  event: 'worker.processing.failed',
                  reviewRunId: reviewRun.id,
                  projectId,
                  mrIid,
                  error: err.message,
                  statusCode: err.statusCode,
                  isAuthError,
                  stack: err.stack,
                },
                'Failed to process review (fetch changes, run checks, or update comment)'
              );

              // Update ReviewRun to FAILED
              await prisma.reviewRun.update({
                where: { id: reviewRun.id },
                data: {
                  status: 'FAILED',
                  finishedAt: new Date(),
                  error: errorMessage,
                },
              });

              jobLogger.info(
                {
                  event: 'worker.reviewrun.updated',
                  reviewRunId: reviewRun.id,
                  oldStatus: 'RUNNING',
                  newStatus: 'FAILED',
                  isAuthError,
                },
                'ReviewRun status updated to FAILED'
              );

              // Mark job as non-retryable for auth errors by setting attempts to max
              if (isAuthError) {
                // This will prevent further retries
                jobLogger.warn(
                  {
                    event: 'worker.job.non_retryable',
                    reviewRunId: reviewRun.id,
                    statusCode: err.statusCode,
                  },
                  'Job marked as non-retryable due to GitLab auth error'
                );
              }

              // Re-throw to trigger worker error handling
              throw err;
            }
          }

          const duration = Date.now() - startTime;

          jobLogger.info(
            {
              event: 'job.completed',
              jobId: job.id,
              reviewRunId: reviewRun.id,
              duration: `${duration}ms`,
              attemptsMade: job.attemptsMade,
            },
            '✅ Job completed successfully'
          );

          // Mark as succeeded
          finalStatus = 'SUCCEEDED';
          return { success: true, reviewRunId: reviewRun.id };
        } catch (error: unknown) {
          const err = error as Error;
          const duration = Date.now() - startTime;

          jobLogger.error(
            {
              event: 'job.failure',
              jobId: job.id,
              reviewRunId: reviewRun?.id || null,
              error: safeErrorMessage(err),
              duration: `${duration}ms`,
              attemptsMade: job.attemptsMade,
            },
            '❌ Job failed'
          );

          // Mark as failed
          finalStatus = 'FAILED';

          // Try to update ReviewRun to FAILED if we have it
          if (reviewRun) {
            try {
              const errWithStatus = err as Error & { statusCode?: number };
              const isAuthError = errWithStatus.statusCode === 401 || errWithStatus.statusCode === 403 || errWithStatus.statusCode === 404;
              const errorMessage = safeErrorMessage(errWithStatus);
              const finalErrorMessage = isAuthError 
                ? `GitLab API error (${errWithStatus.statusCode}): ${errorMessage}`
                : errorMessage;

              await prisma.reviewRun.update({
                where: { id: reviewRun.id },
                data: {
                  status: 'FAILED',
                  finishedAt: new Date(),
                  error: finalErrorMessage,
                },
              });

              jobLogger.info(
                {
                  event: 'db.status.transition',
                  reviewRunId: reviewRun.id,
                  newStatus: 'FAILED',
                  isAuthError,
                },
                'ReviewRun status updated to FAILED'
              );
            } catch (updateError) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.update.failed',
                  reviewRunId: reviewRun.id,
                  error: safeErrorMessage(updateError),
                },
                'Failed to update ReviewRun status to FAILED'
              );
            }
          } else {
            // Try to find ReviewRun by lookup
            try {
              const tenant = await getOrCreateTenantBySlug(tenantSlug);
              const foundRun = reviewRunId
                ? await prisma.reviewRun.findUnique({ where: { id: reviewRunId } })
                : await prisma.reviewRun.findFirst({
                    where: {
                      tenantId: tenant.id,
                      mergeRequest: {
                        repository: {
                          provider: 'gitlab',
                          providerRepoId: projectId,
                        },
                        iid: mrIid,
                      },
                      headSha,
                    },
                    orderBy: { createdAt: 'desc' },
                  });

              if (foundRun) {
                reviewRun = foundRun;
                const errWithStatus = err as Error & { statusCode?: number };
                const errorMessage = safeErrorMessage(err);

                await prisma.reviewRun.update({
                  where: { id: foundRun.id },
                  data: {
                    status: 'FAILED',
                    finishedAt: new Date(),
                    error: errorMessage,
                  },
                });

                jobLogger.info(
                  {
                    event: 'db.status.transition.fallback',
                    reviewRunId: foundRun.id,
                    newStatus: 'FAILED',
                  },
                  'ReviewRun status updated to FAILED (fallback lookup)'
                );
              } else {
                jobLogger.error(
                  {
                    event: 'worker.reviewrun.missing',
                    jobId: job.id,
                    tenantId: tenant.id,
                    provider: 'gitlab',
                    projectId,
                    mrIid,
                    headSha,
                    reviewRunId,
                  },
                  'ReviewRun not found when updating to FAILED'
                );
              }
            } catch (lookupError) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.lookup.failed',
                  error: safeErrorMessage(lookupError),
                },
                'Failed to lookup ReviewRun for FAILED update'
              );
            }
          }

          throw err;
        } finally {
          // GUARANTEED FINALIZATION: Ensure ReviewRun is always SUCCEEDED or FAILED
          if (reviewRun && finalStatus !== 'SUCCEEDED' && finalStatus !== 'FAILED') {
            try {
              // Re-fetch to get current status
              const currentRun = await prisma.reviewRun.findUnique({
                where: { id: reviewRun.id },
                select: { id: true, status: true },
              });

              if (currentRun && currentRun.status !== 'SUCCEEDED' && currentRun.status !== 'FAILED') {
                jobLogger.warn(
                  {
                    event: 'worker.reviewrun.force_finalize',
                    jobId: job.id,
                    reviewRunId: reviewRun.id,
                    currentStatus: currentRun.status,
                  },
                  '⚠️ ReviewRun not finalized, forcing FAILED status'
                );

                await prisma.reviewRun.update({
                  where: { id: reviewRun.id },
                  data: {
                    status: 'FAILED',
                    finishedAt: new Date(),
                    error: 'Unexpected termination: job completed without setting final status',
                  },
                });

                jobLogger.info(
                  {
                    event: 'worker.reviewrun.force_finalized',
                    reviewRunId: reviewRun.id,
                    forcedStatus: 'FAILED',
                  },
                  'ReviewRun forced to FAILED in finally block'
                );
              }
            } catch (finalizeError) {
              jobLogger.error(
                {
                  event: 'worker.reviewrun.finalize.failed',
                  reviewRunId: reviewRun.id,
                  error: safeErrorMessage(finalizeError),
                },
                '❌ CRITICAL: Failed to finalize ReviewRun in finally block'
              );
            }
          }
        }
      },
      {
        connection: redisConnection,
        concurrency: workerConcurrency,
        lockDuration: workerLockDuration,
        stalledInterval: workerStalledInterval,
        maxStalledCount: workerMaxStalledCount,
      }
    );

    // Worker event handlers
    worker.on('active', (job) => {
      logger.info(
        {
          event: 'worker.job.active',
          jobId: job.id,
          reviewRunId: job.data.reviewRunId || null,
        },
        'Job became active'
      );
    });

    worker.on('completed', (job) => {
      logger.info(
        {
          event: 'worker.job.completed',
          jobId: job.id,
          reviewRunId: job.data.reviewRunId || null,
          duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
        },
        'Job completed'
      );
    });

    worker.on('failed', (job, err) => {
      logger.error(
        {
          event: 'worker.job.failed',
          jobId: job?.id,
          reviewRunId: job?.data?.reviewRunId || null,
          error: safeErrorMessage(err),
          attemptsMade: job?.attemptsMade,
        },
        'Job failed'
      );
    });

    worker.on('stalled', (jobId) => {
      logger.warn(
        {
          event: 'worker.job.stalled',
          jobId,
        },
        '⚠️ Job stalled (taking too long)'
      );
    });

    // Get worker options for logging
    const workerOptions = (worker as any).opts || {};
    const queuePrefix = workerOptions.prefix || 'bull';
    
    // Log final worker configuration (includes effective BullMQ settings)
    logger.info({
      event: 'worker.started',
      queueName: QUEUE_NAME,
      queuePrefix,
      redisUrl: redisUrlRedacted,
      redisHost,
      redisDb: redisInfo.db || 0,
      concurrency: workerConcurrency,
      lockDuration: workerLockDuration,
      stalledInterval: workerStalledInterval,
      maxStalledCount: workerMaxStalledCount,
    }, 'Worker started successfully');
    
    logger.info('✅ Worker started successfully');
    logger.info(`   Listening for jobs on queue: ${QUEUE_NAME}`);
    logger.info(`   Queue prefix: ${queuePrefix}`);
  } catch (err) {
    logger.error(err, 'Failed to start worker');
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async () => {
  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  });

  logger.info('Shutting down worker gracefully...');
  try {
    if (worker) {
      await worker.close();
    }
    await disconnectPrisma();
    process.exit(0);
  } catch (err) {
    logger.error(err, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startWorker().catch((err) => {
  console.error('Fatal error starting worker:', err);
  process.exit(1);
});
