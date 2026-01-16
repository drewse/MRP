// Initialize environment FIRST (before any other imports that might read process.env)
import { initEnv, getEnvDiagnostics, validateRequiredEnv, requireEnvMultiple } from '@mrp/config';

const { repoRoot, envFilePath, loaded, keysLoaded } = initEnv();

// .env file is optional (for local dev); env vars can come from platform (Railway, etc.)
if (!loaded) {
  console.warn(`⚠️  WARNING: .env file not found at: ${envFilePath}`);
  console.warn(`   Continuing with environment variables from process.env (platform-provided)`);
  console.warn(`   Required environment variables will be validated below.`);
}

// Log env loading diagnostics
console.log(`📁 .env file: ${envFilePath}`);
console.log(`✅ .env loaded: ${loaded ? 'yes' : 'no'}`);
if (keysLoaded.length > 0) {
  console.log(`📋 Keys loaded from .env: ${keysLoaded.length} (${keysLoaded.slice(0, 10).join(', ')}${keysLoaded.length > 10 ? '...' : ''})`);
}

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import pino from 'pino';
import { prisma, getOrCreateTenantBySlug } from '@mrp/db';
import { createGitLabClient, type GitLabMergeRequest } from '@mrp/gitlab';
import { initializeQueue, enqueueReviewJob, closeQueue, getQueue } from './queue.js';
import { getRecentActivity } from './activity-buffer.js';
import { QUEUE_NAME, buildReviewJobId, type ReviewMrJobPayload } from '@mrp/core';
import { handleGitLabWebhook } from './gitlab-webhook.js';
import {
  getTenantSettings,
  updateTenantSettings,
  presignUpload,
  completeUpload,
  listUploads,
} from './tenant-routes.js';
import {
  getGitLabConfig,
  updateGitLabConfig,
  testGitLabConfig,
} from './gitlab-config-routes.js';
import { constantTimeCompare } from './webhook.js';
import { login, logout, getMe, bootstrap } from './auth-routes.js';

// Environment validation
const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL',
  'GITLAB_BASE_URL',
  'GITLAB_TOKEN',
  'GITLAB_WEBHOOK_SECRET',
  'APP_PUBLIC_URL',
  'STORAGE_PROVIDER',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

const optionalEnvVars = [
  'LOG_LEVEL',
  'DEFAULT_TENANT_SLUG',
  'AI_ENABLED',
  'OPENAI_API_KEY',
  'STORAGE_ENDPOINT',
  'PORTAL_ADMIN_TOKEN',
] as const;

function validateEnv(): void {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

  logger.info('🔍 API: Environment diagnostics');
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
      const source = key.source ? ` [from ${key.source}]` : '';
      logger.info(`     ${status} ${key.key}${value}${source}`);
    }
  }

  // Log optional keys status
  logger.info('   Optional keys:');
  for (const key of diagnostics.requiredKeys) {
    if (optionalEnvVars.includes(key.key as typeof optionalEnvVars[number])) {
      const status = key.present ? '✅' : '⚪';
      const source = key.source ? ` [from ${key.source}]` : '';
      logger.info(`     ${status} ${key.key}${source}`);
    }
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
    throw new Error('GITLAB_TOKEN environment variable is required');
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

/**
 * Log structured environment diagnostics at startup
 */
function logEnvDiagnostics(): void {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  
  const aiEnabled = process.env.AI_ENABLED === 'true';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiKeyLength = openaiKey.trim().length;
  const openaiKeyPresent = openaiKeyLength > 0;
  
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
  
  const databaseUrlPresent = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
  
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
 * Log AI configuration diagnostics at startup
 */
async function logAiDiagnostics(): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  
  const aiEnabled = process.env.AI_ENABLED === 'true';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  const openaiKeyLength = openaiKey.trim().length;
  
  logger.info(
    {
      event: 'api.ai.diagnostics',
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
        event: 'api.ai.tenant.config',
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
        event: 'api.ai.tenant.config.error',
        error: error instanceof Error ? error.message : String(error),
      },
      '   Could not check tenant AI config (database may not be available)'
    );
  }
}

/**
 * Validate storage configuration
 */
function validateStorageConfig(): void {
  const provider = (process.env.STORAGE_PROVIDER || 's3').toLowerCase();
  const endpoint = process.env.STORAGE_ENDPOINT?.trim();

  // For R2 and minio, endpoint is required
  if ((provider === 'r2' || provider === 'minio') && !endpoint) {
    throw new Error(
      `STORAGE_ENDPOINT is required for provider "${provider}". Please set STORAGE_ENDPOINT in your .env file (e.g., https://<accountId>.r2.cloudflarestorage.com for R2).`
    );
  }

  // Validate endpoint format if provided
  if (endpoint) {
    if (endpoint.includes('...')) {
      throw new Error(
        'STORAGE_ENDPOINT contains invalid placeholder "...". Please set a valid endpoint URL (e.g., https://<accountId>.r2.cloudflarestorage.com)'
      );
    }

    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      throw new Error(
        `STORAGE_ENDPOINT must start with http:// or https://. Got: ${endpoint.substring(0, 50)}${endpoint.length > 50 ? '...' : ''}`
      );
    }

    // Validate it's a parseable URL with valid hostname
    try {
      const url = new URL(endpoint);
      if (!url.hostname || url.hostname === '...' || url.hostname.trim().length === 0) {
        throw new Error(`STORAGE_ENDPOINT has invalid hostname: ${url.hostname}`);
      }
    } catch (error) {
      const err = error as Error;
      throw new Error(`STORAGE_ENDPOINT is not a valid URL: ${err.message}`);
    }
  }
}

async function startServer(): Promise<void> {
  // Startup assertions
  validateEnv();
  
  // Log structured env diagnostics
  logEnvDiagnostics();
  
  // Assert critical vars are non-empty (fail fast with clear error message)
  try {
    requireEnvMultiple([
      'DATABASE_URL',
      'REDIS_URL',
      'GITLAB_TOKEN',
      'GITLAB_WEBHOOK_SECRET',
      'APP_PUBLIC_URL',
      'STORAGE_PROVIDER',
      'STORAGE_REGION',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ]);
    
    // Validate storage configuration
    validateStorageConfig();
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

  // Validate GitLab token at startup
  await validateGitLabToken();
  
  // Log AI diagnostics
  await logAiDiagnostics();

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

  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  // Initialize queue
  initializeQueue();

  const fastify = Fastify({
    logger,
  });

  // Register CORS early (before routes)
  // Configure CORS to allow portal requests with custom auth headers
  // Origins can be configured via PORTAL_ORIGINS (comma-separated) or PORTAL_ORIGIN (single)
  const portalOriginsEnv = process.env.PORTAL_ORIGINS || process.env.PORTAL_ORIGIN;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Build allowed origins list
  let allowedOrigins: string[] = [];
  
  if (portalOriginsEnv) {
    // Parse comma-separated origins or single origin
    allowedOrigins = portalOriginsEnv.split(',').map(o => o.trim()).filter(o => o.length > 0);
  } else if (!isProduction) {
    // In non-production, use defaults for local dev
    allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ];
  }
  
  // In production, fail loudly if no origins configured
  if (isProduction && allowedOrigins.length === 0) {
    logger.error({
      event: 'cors.config.failed',
      reason: 'PORTAL_ORIGINS or PORTAL_ORIGIN must be set in production',
    });
    throw new Error(
      'CORS configuration error: PORTAL_ORIGINS or PORTAL_ORIGIN must be set in production.\n' +
      'Set PORTAL_ORIGINS=https://portal.quickiter.com (or comma-separated list)'
    );
  }
  
  logger.info({
    event: 'cors.config',
    allowedOrigins: allowedOrigins.length,
    origins: allowedOrigins,
    isProduction,
  }, 'CORS configured');
  
  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (e.g., mobile apps, Postman, server-to-server)
      if (!origin) {
        return cb(null, true);
      }
      
      if (allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      
      // Reject unknown origins
      logger.warn({
        event: 'cors.rejected',
        origin,
        allowedOrigins,
      }, 'CORS request rejected');
      return cb(new Error('Not allowed by CORS'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-MRP-Admin-Token',
      'X-MRP-Tenant-Slug',
      'x-mrp-admin-token',
      'x-mrp-tenant-slug',
      'content-type',
    ],
    exposedHeaders: ['Content-Length'],
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // Portal admin token auth preHandler
  // NOTE: Must be defined before any routes that use it to avoid temporal dead zone errors
  const portalAuthPreHandler = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
    const expectedToken = process.env.PORTAL_ADMIN_TOKEN;

    // In non-dev, token is required
    if (!isDev && !expectedToken) {
      logger.warn({
        event: 'portal.auth.failed',
        reason: 'PORTAL_ADMIN_TOKEN not configured in non-dev environment',
      });
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Portal admin token not configured',
      });
    }

    // In dev, if token is not set, allow (optional)
    if (isDev && !expectedToken) {
      return; // Allow request
    }

    // If token is set (dev or non-dev), require it
    if (expectedToken) {
      const providedToken = request.headers['x-mrp-admin-token'] as string | undefined;

      if (!providedToken) {
        logger.info({
          event: 'portal.auth.failed',
          reason: 'Missing X-MRP-Admin-Token header',
        });
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing X-MRP-Admin-Token header',
        });
      }

      if (!constantTimeCompare(providedToken, expectedToken)) {
        logger.info({
          event: 'portal.auth.failed',
          reason: 'Token mismatch',
        });
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Invalid admin token',
        });
      }
    }

    // Also read tenant slug header (optional, defaults to DEFAULT_TENANT_SLUG or 'dev')
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    // Store in request for later use (we don't validate it here, just read it)
    (request as any).tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
  };

  // Health check endpoint
  fastify.get('/health', async () => {
    return { ok: true, timestamp: new Date().toISOString() };
  });

  // Auth endpoints (public)
  fastify.post('/auth/login', async (request, reply) => {
    return login(request, reply);
  });

  fastify.post('/auth/logout', async (request, reply) => {
    return logout(request, reply);
  });

  fastify.get('/auth/me', async (request, reply) => {
    return getMe(request, reply);
  });

  fastify.get('/auth/bootstrap', async (request, reply) => {
    return bootstrap(request, reply);
  });

  // Debug endpoint for environment diagnostics (dev only or if explicitly enabled)
  fastify.get('/debug/env', async (_request, reply) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const debugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
    
    if (isProduction && !debugEnabled) {
      return reply.code(403).send({ error: 'Debug endpoints disabled in production' });
    }
    
    const diagnostics = getEnvDiagnostics([...requiredEnvVars, ...optionalEnvVars]);
    return {
      cwd: diagnostics.cwd,
      repoRoot: diagnostics.repoRoot,
      envFilePath: diagnostics.envFilePath,
      envFileExists: diagnostics.envFileExists,
      requiredKeys: diagnostics.requiredKeys.map(k => ({
        key: k.key,
        present: k.present,
        maskedValue: k.maskedValue,
        source: k.source,
      })),
      warnings: diagnostics.warnings,
      timestamp: new Date().toISOString(),
    };
  });

  // Debug endpoint to peek at queue jobs (dev only or if explicitly enabled)
  fastify.get<{
    Querystring: {
      limit?: string;
    };
  }>('/debug/queue/peek', async (request, reply) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const debugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
    
    if (isProduction && !debugEnabled) {
      return reply.code(403).send({ error: 'Debug endpoints disabled in production' });
    }

    const limit = Math.min(Number.parseInt(request.query.limit || '10', 10), 50);
    const queue = getQueue();

    try {
      // Get waiting, active, delayed, completed, and failed jobs
      const [waiting, active, delayed, completed, failed] = await Promise.all([
        queue.getWaiting(0, limit - 1),
        queue.getActive(0, limit - 1),
        queue.getDelayed(0, limit - 1),
        queue.getCompleted(0, limit - 1),
        queue.getFailed(0, limit - 1),
      ]);

      // Combine all jobs and sort by timestamp (newest first)
      const allJobs = [...waiting, ...active, ...delayed, ...completed, ...failed];
      allJobs.sort((a, b) => {
        const aTime = a.timestamp || 0;
        const bTime = b.timestamp || 0;
        return bTime - aTime; // Newest first
      });

      const jobs = await Promise.all(
        allJobs.slice(0, limit).map(async (job) => {
          const state = await job.getState();
          const computedJobId = buildReviewJobId(job.data);
          const timestamp = job.timestamp || null;
          const failedReason = job.failedReason || null;
          
          return {
            id: job.id,
            name: job.name,
            state, // Always include state
            computedJobId,
            jobIdMatches: job.id === computedJobId,
            timestamp: timestamp ? new Date(timestamp).toISOString() : null,
            attemptsMade: job.attemptsMade,
            processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
            finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            failedReason,
            data: {
              tenantSlug: job.data.tenantSlug,
              provider: job.data.provider,
              projectId: job.data.projectId,
              mrIid: job.data.mrIid,
              headSha: job.data.headSha,
              reviewRunId: job.data.reviewRunId || null, // Always include, even if null
              isMergedCandidate: job.data.isMergedCandidate || false,
            },
          };
        })
      );

      return {
        jobs,
        total: jobs.length,
        limit,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return reply.code(500).send({
        error: 'Failed to peek queue',
        message: err.message,
      });
    }
  });

  // Debug endpoint to inspect queue details (dev only)
  fastify.get<{
    Querystring: {
      limit?: string;
    };
  }>('/debug/queue/inspect', async (request, reply) => {
    const isProduction = process.env.NODE_ENV === 'production';
    const debugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
    
    if (isProduction && !debugEnabled) {
      return reply.code(403).send({ error: 'Debug endpoints disabled in production' });
    }

    const limit = Math.min(Number.parseInt(request.query.limit || '20', 10), 100);
    const queue = getQueue();

    try {
      // Get queue connection info
      const queueOptions = (queue as any).opts || {};
      const redisUrl = process.env.REDIS_URL || 'unknown';
      
      // Extract Redis connection details
      let redisInfo: {
        host?: string;
        port?: number;
        db?: number;
        url?: string;
      } = {};
      
      try {
        const urlObj = new URL(redisUrl);
        redisInfo.host = urlObj.hostname;
        redisInfo.port = Number.parseInt(urlObj.port || '6379', 10);
        const dbMatch = urlObj.pathname?.match(/^\/(\d+)/);
        redisInfo.db = dbMatch ? Number.parseInt(dbMatch[1], 10) : 0;
        // Redact password
        if (urlObj.password) {
          urlObj.password = '***';
        }
        redisInfo.url = urlObj.toString();
      } catch {
        redisInfo.url = redisUrl.replace(/:[^:@]+@/, ':***@');
      }

      const queueName = QUEUE_NAME;
      const queuePrefix = queueOptions.prefix || 'bull';

      // Get counts
      const [waiting, active, delayed, completed, failed] = await Promise.all([
        queue.getWaiting(0, limit - 1),
        queue.getActive(0, limit - 1),
        queue.getDelayed(0, limit - 1),
        queue.getCompleted(0, limit - 1),
        queue.getFailed(0, limit - 1),
      ]);

      // Get counts (approximate from the arrays we fetched)
      const counts = {
        waiting: waiting.length,
        active: active.length,
        delayed: delayed.length,
        completed: completed.length,
        failed: failed.length,
      };

      // Helper to format job data
      const formatJob = async (job: any) => {
        const state = await job.getState();
        return {
          id: job.id,
          name: job.name,
          state,
          timestamp: job.timestamp ? new Date(job.timestamp).toISOString() : null,
          processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
          finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
          attemptsMade: job.attemptsMade,
          data: {
            reviewRunId: job.data.reviewRunId || null,
            headSha: job.data.headSha || null,
            tenantSlug: job.data.tenantSlug || null,
            projectId: job.data.projectId || null,
            mrIid: job.data.mrIid || null,
          },
        };
      };

      // Format jobs by state
      const jobsByState = {
        waiting: await Promise.all(waiting.slice(0, limit).map(formatJob)),
        active: await Promise.all(active.slice(0, limit).map(formatJob)),
        delayed: await Promise.all(delayed.slice(0, limit).map(formatJob)),
        completed: await Promise.all(completed.slice(0, limit).map(formatJob)),
        failed: await Promise.all(failed.slice(0, limit).map(formatJob)),
      };

      return {
        queueName,
        queuePrefix,
        redis: redisInfo,
        counts,
        jobsByState,
        limit,
      };
    } catch (error: unknown) {
      const err = error as Error;
      return reply.code(500).send({
        error: 'Failed to inspect queue',
        message: err.message,
      });
    }
  });

  // Activity endpoint (portal-protected, but also check debug flag in production)
  fastify.get<{
    Querystring: {
      limit?: string;
    };
  }>(
    '/debug/activity',
    {
      preHandler: async (request, reply) => {
        const isProduction = process.env.NODE_ENV === 'production';
        const debugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
        
        if (isProduction && !debugEnabled) {
          return reply.code(403).send({ error: 'Debug endpoints disabled in production' });
        }
        
        // Require portal auth
        await portalAuthPreHandler(request, reply);
      },
    },
    async (request, reply) => {
      const limit = Number.parseInt((request.query as { limit?: string }).limit || '20', 10);
      const activities = getRecentActivity(Math.min(limit, 50)); // Cap at 50
      return reply.send({ activities });
    }
  );

  // Debug endpoint to enqueue review jobs (dev only or if explicitly enabled)
  fastify.post<{
    Body: {
      tenantSlug?: string;
      projectId: string;
      mrIid: number;
      headSha: string;
      title?: string;
    };
  }>(
    '/debug/enqueue',
    {
      preHandler: async (request, reply) => {
        const isProduction = process.env.NODE_ENV === 'production';
        const debugEnabled = process.env.ENABLE_DEBUG_ENDPOINTS === 'true';
        
        if (isProduction && !debugEnabled) {
          return reply.code(403).send({ error: 'Debug endpoints disabled in production' });
        }
        
        // Also require portal auth even if debug is enabled
        await portalAuthPreHandler(request, reply);
      },
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'mrIid', 'headSha'],
          properties: {
            tenantSlug: { type: 'string' },
            projectId: { type: 'string' },
            mrIid: { type: 'number' },
            headSha: { type: 'string' },
            title: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const logger = request.log;
      const body = request.body;

    logger.info(
      {
        event: 'debug.enqueue.received',
        projectId: body.projectId,
        mrIid: body.mrIid,
        headSha: body.headSha,
        tenantSlug: body.tenantSlug,
      },
      'Debug enqueue request received'
    );

    try {
      // Resolve tenant
      const tenantSlug = body.tenantSlug || process.env.DEFAULT_TENANT_SLUG || 'dev';
      const tenant = await getOrCreateTenantBySlug(tenantSlug);

      logger.info(
        {
          event: 'tenant.resolved',
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
        },
        'Tenant resolved'
      );

      // Upsert Repository
      const repository = await prisma.repository.upsert({
        where: {
          tenantId_provider_providerRepoId: {
            tenantId: tenant.id,
            provider: 'gitlab',
            providerRepoId: body.projectId,
          },
        },
        create: {
          tenantId: tenant.id,
          provider: 'gitlab',
          providerRepoId: body.projectId,
          namespace: 'unknown',
          name: 'unknown',
          defaultBranch: 'main',
        },
        update: {},
      });

      logger.info(
        {
          event: 'db.upsert.complete',
          repositoryId: repository.id,
          action: 'repository',
        },
        'Repository upserted'
      );

      // Upsert MergeRequest
      const mergeRequest = await prisma.mergeRequest.upsert({
        where: {
          tenantId_repositoryId_iid: {
            tenantId: tenant.id,
            repositoryId: repository.id,
            iid: body.mrIid,
          },
        },
        create: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          iid: body.mrIid,
          title: body.title || 'Untitled MR',
          author: 'unknown',
          sourceBranch: 'unknown',
          targetBranch: 'main',
          state: 'opened',
          webUrl: `https://gitlab.com/project/${body.projectId}/merge_requests/${body.mrIid}`,
        },
        update: {
          title: body.title || undefined,
          lastSeenSha: body.headSha,
        },
      });

      logger.info(
        {
          event: 'db.upsert.complete',
          mergeRequestId: mergeRequest.id,
          action: 'mergeRequest',
        },
        'MergeRequest upserted'
      );

      // Create ReviewRun
      const reviewRun = await prisma.reviewRun.create({
        data: {
          tenantId: tenant.id,
          mergeRequestId: mergeRequest.id,
          headSha: body.headSha,
          status: 'QUEUED',
        },
      });

      logger.info(
        {
          event: 'db.upsert.complete',
          reviewRunId: reviewRun.id,
          action: 'reviewRun',
        },
        'ReviewRun created'
      );

      // Enqueue job with reviewRunId for uniqueness
      const jobPayload: ReviewMrJobPayload = {
        tenantSlug: tenant.slug,
        provider: 'gitlab',
        projectId: body.projectId,
        mrIid: body.mrIid,
        headSha: body.headSha,
        title: body.title,
        reviewRunId: reviewRun.id, // CRITICAL: Must be included for unique jobId
      };

      const jobId = await enqueueReviewJob(jobPayload);

      return {
        ok: true,
        tenantId: tenant.id,
        reviewRunId: reviewRun.id,
        jobId,
      };
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(
        {
          event: 'debug.enqueue.failure',
          error: err.message,
        },
        'Failed to enqueue job'
      );
      return reply.code(500).send({
        error: 'Failed to enqueue job',
        message: err.message,
      });
    }
  });

  // Tenant settings endpoints (protected by portal auth)
  fastify.get('/tenant/settings', {
    preHandler: portalAuthPreHandler,
  }, getTenantSettings);
  fastify.put<{
    Body: {
      allowedExtensions?: string[];
      maxFileSizeBytes?: number;
      allowedMimePrefixes?: string[];
    };
  }>('/tenant/settings', {
    preHandler: portalAuthPreHandler,
    schema: {
      body: {
        type: 'object',
        properties: {
          allowedExtensions: {
            type: 'array',
            items: { type: 'string' },
          },
          maxFileSizeBytes: { type: 'number' },
          allowedMimePrefixes: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  }, updateTenantSettings);

  // Upload endpoints (protected by portal auth)
  fastify.post<{
    Body: {
      fileName: string;
      sizeBytes: number;
      mimeType: string;
    };
  }>('/uploads/presign', {
    preHandler: portalAuthPreHandler,
    schema: {
      body: {
        type: 'object',
        required: ['fileName', 'sizeBytes', 'mimeType'],
        properties: {
          fileName: { type: 'string' },
          sizeBytes: { type: 'number' },
          mimeType: { type: 'string' },
        },
      },
    },
  }, presignUpload);

  fastify.post<{
    Body: {
      uploadId: string;
    };
  }>('/uploads/complete', {
    preHandler: portalAuthPreHandler,
    schema: {
      body: {
        type: 'object',
        required: ['uploadId'],
        properties: {
          uploadId: { type: 'string' },
        },
      },
    },
  }, completeUpload);

  fastify.get('/uploads', {
    preHandler: portalAuthPreHandler,
  }, listUploads);

  // GitLab configuration endpoints (require JWT auth)
  fastify.get('/tenant/gitlab-config', {
    preHandler: async (request, reply) => {
      // Allow both JWT and header-based auth for backward compatibility
      await portalAuthPreHandler(request, reply);
    },
  }, async (request, reply) => {
    return getGitLabConfig(request, reply);
  });

  fastify.put<{
    Body: {
      token?: string;
      baseUrl?: string;
      enabled?: boolean;
    };
  }>('/tenant/gitlab-config', {
    preHandler: async (request, reply) => {
      // Allow both JWT and header-based auth for backward compatibility
      await portalAuthPreHandler(request, reply);
    },
    schema: {
      body: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          baseUrl: { type: 'string' },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    return updateGitLabConfig(request, reply);
  });

  fastify.post('/tenant/gitlab-config/test', {
    preHandler: async (request, reply) => {
      // Allow both JWT and header-based auth for backward compatibility
      await portalAuthPreHandler(request, reply);
    },
  }, async (request, reply) => {
    return testGitLabConfig(request, reply);
  });

  // Review runs endpoint (protected by portal auth)
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
    };
  }>('/review-runs', {
    preHandler: portalAuthPreHandler,
  }, async (request) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);

    const limit = Math.min(Number.parseInt(request.query.limit || '20', 10), 100);
    const offset = Math.max(Number.parseInt(request.query.offset || '0', 10), 0);

    logger.info(
      {
        event: 'review_runs.list',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        limit,
        offset,
      },
      'Listing review runs'
    );

    const [reviewRuns, total] = await Promise.all([
      prisma.reviewRun.findMany({
        where: {
          tenantId: tenant.id,
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
        take: limit,
        skip: offset,
      }),
      prisma.reviewRun.count({
        where: {
          tenantId: tenant.id,
        },
      }),
    ]);

    const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';

    const runs = reviewRuns.map((run) => {
      const repo = run.mergeRequest.repository;
      const repoWebUrl = repo
        ? `${gitlabBaseUrl}/${repo.namespace}/${repo.name}`
        : null;

      return {
        id: run.id,
        status: run.status,
        score: run.score,
        summary: run.summary,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() || null,
        finishedAt: run.finishedAt?.toISOString() || null,
        mergeRequest: {
          iid: run.mergeRequest.iid,
          title: run.mergeRequest.title,
          webUrl: run.mergeRequest.webUrl,
          projectId: repo?.providerRepoId || null,
          headSha: run.headSha,
        },
        repository: repo
          ? {
              name: repo.name,
              namespace: repo.namespace,
              webUrl: repoWebUrl,
            }
          : null,
      };
    });

    return {
      runs,
      total,
      limit,
      offset,
    };
  });

  // Merge requests endpoint (protected by portal auth)
  fastify.get<{
    Querystring: {
      limit?: string;
      offset?: string;
      repositoryId?: string;
    };
  }>('/merge-requests', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);

    // Validate and parse query params
    const limitParam = request.query.limit;
    const offsetParam = request.query.offset;
    const repositoryIdParam = request.query.repositoryId;

    let limit = 50;
    let offset = 0;

    if (limitParam) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
        return reply.code(400).send({
          error: 'Invalid limit',
          message: 'limit must be a positive integer',
        });
      }
      limit = Math.min(parsedLimit, 100);
    }

    if (offsetParam) {
      const parsedOffset = Number.parseInt(offsetParam, 10);
      if (Number.isNaN(parsedOffset) || parsedOffset < 0) {
        return reply.code(400).send({
          error: 'Invalid offset',
          message: 'offset must be a non-negative integer',
        });
      }
      offset = parsedOffset;
    }

    // Build where clause
    const whereClause: {
      tenantId: string;
      repositoryId?: string;
    } = {
      tenantId: tenant.id,
    };

    if (repositoryIdParam) {
      // Verify repository exists and belongs to tenant
      const repository = await prisma.repository.findFirst({
        where: {
          id: repositoryIdParam,
          tenantId: tenant.id,
        },
      });

      if (!repository) {
        // Return empty list if repository not found (as per requirements)
        return {
          mergeRequests: [],
          total: 0,
        };
      }

      whereClause.repositoryId = repositoryIdParam;
    }

    logger.info(
      {
        event: 'merge_requests.list',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        limit,
        offset,
        repositoryId: repositoryIdParam,
      },
      'Listing merge requests'
    );

    // Fetch merge requests with repository
    const [mergeRequests, total] = await Promise.all([
      prisma.mergeRequest.findMany({
        where: whereClause,
        include: {
          repository: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
        take: limit,
        skip: offset,
      }),
      prisma.mergeRequest.count({
        where: whereClause,
      }),
    ]);

    // Fetch latest review run for each MR
    const mrIds = mergeRequests.map((mr) => mr.id);
    const allReviewRuns = await prisma.reviewRun.findMany({
      where: {
        tenantId: tenant.id,
        mergeRequestId: {
          in: mrIds,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group by mergeRequestId and take the latest (first) one for each MR
    const reviewRunMap = new Map<string, typeof allReviewRuns[0]>();
    for (const reviewRun of allReviewRuns) {
      if (!reviewRunMap.has(reviewRun.mergeRequestId)) {
        reviewRunMap.set(reviewRun.mergeRequestId, reviewRun);
      }
    }

    // Map to response format
    const mergeRequestsResponse = mergeRequests.map((mr) => {
      const latestReview = reviewRunMap.get(mr.id) || null;

      return {
        id: mr.id,
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        webUrl: mr.webUrl,
        authorName: mr.author || null,
        createdAt: mr.createdAt.toISOString(),
        updatedAt: mr.updatedAt.toISOString(),
        repository: {
          id: mr.repository.id,
          name: mr.repository.name,
          namespace: mr.repository.namespace,
          projectId: mr.repository.providerRepoId || null,
        },
        latestReview: latestReview
          ? {
              id: latestReview.id,
              status: latestReview.status,
              score: latestReview.score,
              createdAt: latestReview.createdAt.toISOString(),
              finishedAt: latestReview.finishedAt?.toISOString() || null,
            }
          : null,
      };
    });

    return {
      mergeRequests: mergeRequestsResponse,
      total,
    };
  });

  // Review run detail endpoint (protected by portal auth)
  fastify.get<{
    Params: {
      reviewRunId: string;
    };
  }>('/review-runs/:reviewRunId', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    const reviewRunId = request.params.reviewRunId;

    logger.info(
      {
        event: 'review_run.get',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        reviewRunId,
      },
      'Fetching review run detail'
    );

    // Fetch review run with all relations
    const reviewRun = await prisma.reviewRun.findFirst({
      where: {
        id: reviewRunId,
        tenantId: tenant.id,
      },
      include: {
        mergeRequest: {
          include: {
            repository: true,
          },
        },
        checkResults: {
          orderBy: [
            { category: 'asc' },
            { checkKey: 'asc' },
            { filePath: 'asc' },
            { lineStart: 'asc' },
          ],
        },
        aiSuggestions: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        postedComments: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!reviewRun) {
      return reply.code(404).send({
        error: 'Review run not found',
        message: `Review run with id ${reviewRunId} not found for tenant ${tenant.slug}`,
      });
    }

    // Map check results
    const checkResults = reviewRun.checkResults.map((result) => ({
      id: result.id,
      checkKey: result.checkKey,
      category: result.category,
      status: result.status,
      severity: result.severity,
      message: result.message || null,
      filePath: result.filePath || null,
      startLine: result.lineStart || null,
      endLine: result.lineEnd || null,
    }));

    // Map AI suggestions
    const aiSuggestions = reviewRun.aiSuggestions.map((suggestion) => {
      // Extract first file from files JSON array
      let filePath: string | null = null;
      let startLine: number | null = null;
      let endLine: number | null = null;

      if (suggestion.files && Array.isArray(suggestion.files) && suggestion.files.length > 0) {
        const firstFile = suggestion.files[0] as { path?: string; lineStart?: number; lineEnd?: number };
        filePath = firstFile.path || null;
        startLine = firstFile.lineStart || null;
        endLine = firstFile.lineEnd || null;
      }

      return {
        id: suggestion.id,
        checkKey: suggestion.checkKey || null,
        title: suggestion.title,
        rationale: suggestion.rationale || null,
        suggestedFix: suggestion.suggestedFix || null,
        filePath,
        startLine,
        endLine,
      };
    });

    // Map posted comments
    const postedComments = reviewRun.postedComments.map((comment) => ({
      id: comment.id,
      provider: comment.provider,
      externalId: comment.providerId || null,
      url: null, // URL construction not available from current schema
      createdAt: comment.createdAt.toISOString(),
    }));

    return {
      id: reviewRun.id,
      status: reviewRun.status,
      phase: reviewRun.phase,
      progressMessage: reviewRun.progressMessage,
      score: reviewRun.score,
      summary: reviewRun.summary,
      error: reviewRun.error,
      createdAt: reviewRun.createdAt.toISOString(),
      startedAt: reviewRun.startedAt?.toISOString() || null,
      finishedAt: reviewRun.finishedAt?.toISOString() || null,
      mergeRequest: {
        id: reviewRun.mergeRequest.id,
        iid: reviewRun.mergeRequest.iid,
        title: reviewRun.mergeRequest.title,
        state: reviewRun.mergeRequest.state,
        webUrl: reviewRun.mergeRequest.webUrl || null,
        authorName: reviewRun.mergeRequest.author || null,
        repository: {
          id: reviewRun.mergeRequest.repository.id,
          name: reviewRun.mergeRequest.repository.name,
          namespace: reviewRun.mergeRequest.repository.namespace,
          projectId: reviewRun.mergeRequest.repository.providerRepoId || null,
        },
      },
      checkResults,
      aiSuggestions,
      postedComments,
    };
  });

  // Get single merge request with latest review (protected by portal auth)
  fastify.get<{
    Params: {
      projectId: string;
      mrIid: string;
    };
  }>('/merge-requests/:projectId/:mrIid', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    const projectId = request.params.projectId;
    const mrIidParam = request.params.mrIid;

    // Validate projectId and mrIid
    if (!projectId || !/^\d+$/.test(projectId)) {
      return reply.code(400).send({
        error: 'Invalid projectId',
        message: 'projectId must be a numeric string',
      });
    }

    const mrIid = Number.parseInt(mrIidParam, 10);
    if (Number.isNaN(mrIid) || mrIid < 1) {
      return reply.code(400).send({
        error: 'Invalid mrIid',
        message: 'mrIid must be a positive integer',
      });
    }

    logger.info(
      {
        event: 'merge_request.get',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        projectId,
        mrIid,
      },
      'Fetching merge request with latest review'
    );

    try {
      // Find repository by projectId
      const repository = await prisma.repository.findFirst({
        where: {
          tenantId: tenant.id,
          provider: 'gitlab',
          providerRepoId: projectId,
        },
      });

      if (!repository) {
        return reply.code(404).send({
          error: 'Repository not found',
          message: `Repository with projectId ${projectId} not found for tenant ${tenant.slug}`,
        });
      }

      // Find merge request
      const mergeRequest = await prisma.mergeRequest.findFirst({
        where: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          iid: mrIid,
        },
        include: {
          repository: true,
        },
      });

      if (!mergeRequest) {
        return reply.code(404).send({
          error: 'Merge request not found',
          message: `Merge request ${mrIid} not found in project ${projectId}`,
        });
      }

      // Find latest review run
      const latestReviewRun = await prisma.reviewRun.findFirst({
        where: {
          tenantId: tenant.id,
          mergeRequestId: mergeRequest.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          status: true,
          score: true,
          createdAt: true,
          finishedAt: true,
          headSha: true,
        },
      });

      return {
        mergeRequest: {
          id: mergeRequest.id,
          iid: mergeRequest.iid,
          title: mergeRequest.title,
          state: mergeRequest.state,
          webUrl: mergeRequest.webUrl,
          authorName: mergeRequest.author || null,
          createdAt: mergeRequest.createdAt.toISOString(),
          updatedAt: mergeRequest.updatedAt.toISOString(),
          repository: {
            id: mergeRequest.repository.id,
            name: mergeRequest.repository.name,
            namespace: mergeRequest.repository.namespace,
            projectId: mergeRequest.repository.providerRepoId || null,
          },
          latestReview: latestReviewRun
            ? {
                id: latestReviewRun.id,
                status: latestReviewRun.status,
                score: latestReviewRun.score,
                createdAt: latestReviewRun.createdAt.toISOString(),
                finishedAt: latestReviewRun.finishedAt?.toISOString() || null,
                headSha: latestReviewRun.headSha,
              }
            : null,
        },
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error(
        {
          event: 'merge_request.get.error',
          error: err.message,
          projectId,
          mrIid,
        },
        'Error fetching merge request'
      );
      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to fetch merge request',
      });
    }
  });

  // Retry failed review run endpoint (protected by portal auth)
  fastify.post<{
    Params: {
      reviewRunId: string;
    };
  }>('/review-runs/:reviewRunId/retry', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    const reviewRunId = request.params.reviewRunId;

    logger.info(
      {
        event: 'review_run.retry.start',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        reviewRunId,
      },
      'Retry review run request'
    );

    try {
      // Fetch review run with merge request and repository
      const reviewRun = await prisma.reviewRun.findFirst({
        where: {
          id: reviewRunId,
          tenantId: tenant.id,
        },
        include: {
          mergeRequest: {
            include: {
              repository: true,
            },
          },
        },
      });

      if (!reviewRun) {
        return reply.code(404).send({
          error: 'Review run not found',
          message: `Review run with id ${reviewRunId} not found for tenant ${tenant.slug}`,
        });
      }

      // Only allow retry if status is FAILED
      if (reviewRun.status !== 'FAILED') {
        return reply.code(400).send({
          error: 'Invalid status',
          message: `Cannot retry review run with status ${reviewRun.status}. Only FAILED review runs can be retried.`,
        });
      }

      // Get repository provider info
      const repository = reviewRun.mergeRequest.repository;
      if (repository.provider !== 'gitlab') {
        return reply.code(400).send({
          error: 'Unsupported provider',
          message: `Retry is only supported for GitLab repositories`,
        });
      }

      const projectId = repository.providerRepoId;
      if (!projectId) {
        return reply.code(400).send({
          error: 'Missing project ID',
          message: 'Repository does not have a provider project ID',
        });
      }

      // Reset review run to QUEUED and clear error/results
      const updatedReviewRun = await prisma.reviewRun.update({
        where: { id: reviewRunId },
        data: {
          status: 'QUEUED',
          error: null,
          startedAt: null,
          finishedAt: null,
          score: null,
          summary: null,
          phase: null,
          progressMessage: null,
        },
      });

      logger.info(
        {
          event: 'review_run.retry.reset',
          reviewRunId: updatedReviewRun.id,
          oldStatus: 'FAILED',
          newStatus: 'QUEUED',
        },
        'Review run reset to QUEUED for retry'
      );

      // Enqueue job with the same reviewRunId
      const jobPayload: ReviewMrJobPayload = {
        tenantSlug: tenant.slug,
        provider: 'gitlab',
        projectId,
        mrIid: reviewRun.mergeRequest.iid,
        headSha: reviewRun.headSha,
        isMergedCandidate: false,
        reviewRunId: reviewRun.id, // CRITICAL: Use same reviewRunId for retry
      };

      const jobId = await enqueueReviewJob(jobPayload);

      logger.info(
        {
          event: 'review_run.retry.enqueued',
          reviewRunId: reviewRun.id,
          jobId,
        },
        'Review run retry job enqueued'
      );

      return {
        ok: true,
        reviewRunId: reviewRun.id,
        jobId,
        status: 'QUEUED',
      };
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      logger.error(
        {
          event: 'review_run.retry.error',
          error: err.message,
          statusCode: err.statusCode,
          reviewRunId,
        },
        'Error retrying review run'
      );

      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to retry review run',
      });
    }
  });

  // Manual trigger review endpoint (protected by portal auth)
  fastify.post<{
    Params: {
      projectId: string;
      mrIid: string;
    };
    Body: {
      headSha?: string;
    };
  }>('/merge-requests/:projectId/:mrIid/trigger-review', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    const projectId = request.params.projectId;
    const mrIidParam = request.params.mrIid;
    const bodyHeadSha = request.body?.headSha;

    // Validate projectId and mrIid
    if (!projectId || !/^\d+$/.test(projectId)) {
      return reply.code(400).send({
        error: 'Invalid projectId',
        message: 'projectId must be a numeric string',
      });
    }

    const mrIid = Number.parseInt(mrIidParam, 10);
    if (Number.isNaN(mrIid) || mrIid < 1) {
      return reply.code(400).send({
        error: 'Invalid mrIid',
        message: 'mrIid must be a positive integer',
      });
    }

    logger.info(
      {
        event: 'trigger_review.start',
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        projectId,
        mrIid,
        headSha: bodyHeadSha,
      },
      'Manual trigger review request'
    );

    try {
      // Create GitLab client
      const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';
      const gitlabToken = process.env.GITLAB_TOKEN;
      
      if (!gitlabToken) {
        return reply.code(500).send({
          error: 'GitLab configuration error',
          message: 'GITLAB_TOKEN not configured',
        });
      }

      const gitlabClient = createGitLabClient({
        baseUrl: gitlabBaseUrl,
        token: gitlabToken,
      });

      // Fetch MR details from GitLab
      let mr: GitLabMergeRequest;
      try {
        mr = await gitlabClient.getMergeRequest(projectId, mrIid);
      } catch (error: unknown) {
        const err = error as { statusCode?: number; message?: string };
        if (err.statusCode === 404) {
          return reply.code(404).send({
            error: 'Merge request not found',
            message: `Merge request ${mrIid} not found in project ${projectId}`,
          });
        }
        if (err.statusCode === 401 || err.statusCode === 403) {
          logger.error(
            {
              event: 'trigger_review.gitlab_auth_failed',
              statusCode: err.statusCode,
              projectId,
              mrIid,
            },
            'GitLab authentication failed'
          );
          return reply.code(502).send({
            error: 'GitLab authentication failed',
            message: 'Unable to authenticate with GitLab API',
          });
        }
        throw error;
      }

      // Determine headSha
      let headSha: string;
      if (bodyHeadSha) {
        headSha = bodyHeadSha;
      } else {
        // Use MR sha (this is the head SHA)
        headSha = mr.sha;
      }

      // Fetch project info if repository is missing or incomplete
      let repository = await prisma.repository.findFirst({
        where: {
          tenantId: tenant.id,
          provider: 'gitlab',
          providerRepoId: projectId,
        },
      });

      if (!repository || !repository.name || repository.name === 'unknown' || !repository.namespace || repository.namespace === 'unknown') {
        // Fetch project info from GitLab
        try {
          const projectUrl = `${gitlabBaseUrl}/api/v4/projects/${encodeURIComponent(projectId)}`;
          const projectResponse = await fetch(projectUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${gitlabToken}`,
            },
          });

          if (!projectResponse.ok) {
            logger.warn(
              {
                event: 'trigger_review.project_fetch_failed',
                status: projectResponse.status,
                projectId,
              },
              'Failed to fetch project info, using defaults'
            );
          } else {
            const projectData = await projectResponse.json() as {
              path_with_namespace?: string;
              path?: string;
              namespace?: { name?: string; path?: string };
              default_branch?: string;
            };

            // Extract namespace and name
            let namespace = 'unknown';
            let name = 'unknown';

            if (projectData.path_with_namespace) {
              const parts = projectData.path_with_namespace.split('/');
              name = parts.pop() || 'unknown';
              namespace = parts.join('/') || 'unknown';
            } else if (projectData.path && projectData.namespace?.name) {
              namespace = projectData.namespace.name;
              name = projectData.path;
            } else if (projectData.path) {
              name = projectData.path;
            }

            // Upsert repository with fetched info
            repository = await prisma.repository.upsert({
              where: {
                tenantId_provider_providerRepoId: {
                  tenantId: tenant.id,
                  provider: 'gitlab',
                  providerRepoId: projectId,
                },
              },
              create: {
                tenantId: tenant.id,
                provider: 'gitlab',
                providerRepoId: projectId,
                namespace,
                name,
                defaultBranch: projectData.default_branch || 'main',
              },
              update: {
                namespace,
                name,
                defaultBranch: projectData.default_branch || undefined,
              },
            });

            logger.info(
              {
                event: 'trigger_review.repository_updated',
                repositoryId: repository.id,
                namespace,
                name,
              },
              'Repository updated with GitLab project info'
            );
          }
        } catch (projectError) {
          logger.warn(
            {
              event: 'trigger_review.project_fetch_error',
              error: projectError instanceof Error ? projectError.message : String(projectError),
              projectId,
            },
            'Error fetching project info, continuing with existing repository'
          );
        }
      }

      // Ensure repository exists (create with defaults if fetch failed)
      if (!repository) {
        repository = await prisma.repository.upsert({
          where: {
            tenantId_provider_providerRepoId: {
              tenantId: tenant.id,
              provider: 'gitlab',
              providerRepoId: projectId,
            },
          },
          create: {
            tenantId: tenant.id,
            provider: 'gitlab',
            providerRepoId: projectId,
            namespace: 'unknown',
            name: 'unknown',
            defaultBranch: 'main',
          },
          update: {},
        });
      }

      // Extract author name
      const authorName = mr.author?.username || mr.author?.name || 'unknown';

      // Upsert MergeRequest with fresh data from GitLab
      const mergeRequest = await prisma.mergeRequest.upsert({
        where: {
          tenantId_repositoryId_iid: {
            tenantId: tenant.id,
            repositoryId: repository.id,
            iid: mrIid,
          },
        },
        create: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          iid: mrIid,
          title: mr.title || 'Untitled MR',
          author: authorName,
          sourceBranch: mr.source_branch || 'unknown',
          targetBranch: mr.target_branch || 'main',
          state: mr.state || 'opened',
          webUrl: mr.web_url || '',
          lastSeenSha: headSha,
        },
        update: {
          title: mr.title || undefined,
          author: authorName,
          sourceBranch: mr.source_branch || undefined,
          targetBranch: mr.target_branch || undefined,
          state: mr.state || undefined,
          webUrl: mr.web_url || undefined,
          lastSeenSha: headSha,
        },
      });

      logger.info(
        {
          event: 'trigger_review.merge_request_updated',
          mergeRequestId: mergeRequest.id,
          title: mergeRequest.title,
          author: mergeRequest.author,
          webUrl: mergeRequest.webUrl,
        },
        'MergeRequest upserted with GitLab data'
      );

      // Create ReviewRun
      const reviewRun = await prisma.reviewRun.create({
        data: {
          tenantId: tenant.id,
          mergeRequestId: mergeRequest.id,
          headSha,
          status: 'QUEUED',
          score: null,
          summary: null,
          error: null,
        },
      });

      logger.info(
        {
          event: 'trigger_review.review_run_created',
          reviewRunId: reviewRun.id,
          headSha,
        },
        'ReviewRun created'
      );

      // Enqueue job with reviewRunId for uniqueness
      const jobPayload: ReviewMrJobPayload = {
        tenantSlug: tenant.slug,
        provider: 'gitlab',
        projectId,
        mrIid,
        headSha,
        isMergedCandidate: false,
        reviewRunId: reviewRun.id, // CRITICAL: Must be included for unique jobId
      };

      // Compute expected jobId for logging and verification
      const computedJobId = buildReviewJobId(jobPayload);

      logger.info(
        {
          event: 'trigger_review.job_payload',
          reviewRunId: reviewRun.id,
          computedJobId,
          payload: {
            tenantSlug: jobPayload.tenantSlug,
            provider: jobPayload.provider,
            projectId: jobPayload.projectId,
            mrIid: jobPayload.mrIid,
            headSha: jobPayload.headSha,
            reviewRunId: jobPayload.reviewRunId,
            isMergedCandidate: jobPayload.isMergedCandidate,
          },
        },
        'Job payload prepared for enqueue'
      );

      // Verify reviewRunId is in payload before enqueueing
      if (!jobPayload.reviewRunId) {
        logger.error(
          {
            event: 'trigger_review.missing_reviewRunId',
            reviewRunId: reviewRun.id,
          },
          'ERROR: reviewRunId missing from job payload - jobId will not be unique!'
        );
        throw new Error('reviewRunId must be included in job payload for manual triggers');
      }

      const actualEnqueuedJobId = await enqueueReviewJob(jobPayload);

      // Verify the returned jobId matches our computed one
      if (actualEnqueuedJobId !== computedJobId) {
        logger.error(
          {
            event: 'trigger_review.jobid_mismatch',
            computedJobId,
            actualEnqueuedJobId,
            reviewRunId: reviewRun.id,
          },
          'ERROR: Enqueued jobId does not match computed jobId!'
        );
      }

      logger.info(
        {
          event: 'trigger_review.job_enqueued',
          jobId: actualEnqueuedJobId,
          computedJobId,
          reviewRunId: reviewRun.id,
          jobIdMatches: actualEnqueuedJobId === computedJobId,
          jobIdIncludesReviewRunId: actualEnqueuedJobId.includes(reviewRun.id),
        },
        'Review job enqueued'
      );

      return {
        ok: true,
        tenantId: tenant.id,
        repositoryId: repository.id,
        mergeRequestId: mergeRequest.id,
        reviewRunId: reviewRun.id,
        jobId: actualEnqueuedJobId,
        headSha,
      };
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      logger.error(
        {
          event: 'trigger_review.error',
          error: err.message,
          statusCode: err.statusCode,
          projectId,
          mrIid,
        },
        'Error triggering review'
      );

      if (err.statusCode === 404) {
        return reply.code(404).send({
          error: 'Merge request not found',
          message: err.message || `Merge request ${mrIid} not found in project ${projectId}`,
        });
      }

      if (err.statusCode === 401 || err.statusCode === 403) {
        return reply.code(502).send({
          error: 'GitLab authentication failed',
          message: 'Unable to authenticate with GitLab API',
        });
      }

      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to trigger review',
      });
    }
  });

  // GitLab project resolver endpoint (protected by portal auth)
  fastify.get<{
    Querystring: {
      path: string;
    };
  }>('/gitlab/resolve-project', {
    preHandler: portalAuthPreHandler,
  }, async (request, reply) => {
    const logger = request.log;
    const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
    const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
    const projectPath = request.query.path;

    if (!projectPath) {
      return reply.code(400).send({
        error: 'Missing path parameter',
        message: 'path query parameter is required',
      });
    }

    logger.info(
      {
        event: 'gitlab.resolve_project.start',
        tenantSlug,
        projectPath,
      },
      'Resolving GitLab project path to projectId'
    );

    try {
      const gitlabBaseUrl = process.env.GITLAB_BASE_URL || 'https://gitlab.com';
      const gitlabToken = process.env.GITLAB_TOKEN;
      
      if (!gitlabToken) {
        return reply.code(500).send({
          error: 'GitLab configuration error',
          message: 'GITLAB_TOKEN not configured',
        });
      }

      const gitlabClient = createGitLabClient({
        baseUrl: gitlabBaseUrl,
        token: gitlabToken,
      });

      const project = await gitlabClient.getProject(projectPath);

      logger.info(
        {
          event: 'gitlab.resolve_project.success',
          projectPath,
          projectId: project.id,
          projectName: project.name,
        },
        'Project resolved successfully'
      );

      return {
        projectId: String(project.id),
        name: project.name,
        path: project.path,
        pathWithNamespace: project.path_with_namespace,
        namespace: project.namespace.name,
      };
    } catch (error: unknown) {
      const err = error as { statusCode?: number; message?: string };
      logger.error(
        {
          event: 'gitlab.resolve_project.error',
          error: err.message,
          statusCode: err.statusCode,
          projectPath,
        },
        'Error resolving GitLab project'
      );

      if (err.statusCode === 404) {
        return reply.code(404).send({
          error: 'Project not found',
          message: `Project "${projectPath}" not found in GitLab`,
        });
      }

      if (err.statusCode === 401 || err.statusCode === 403) {
        return reply.code(502).send({
          error: 'GitLab authentication failed',
          message: 'Unable to authenticate with GitLab API',
        });
      }

      return reply.code(500).send({
        error: 'Internal server error',
        message: 'Failed to resolve project',
      });
    }
  });

  // GitLab webhook endpoint (public, authenticated via secret)
  fastify.post('/webhooks/gitlab', async (request, reply) => {
    return handleGitLabWebhook(request, reply);
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    try {
      await fastify.close();
      await closeQueue();
      process.exit(0);
    } catch (err) {
      logger.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await fastify.listen({ port, host });
    logger.info(`🚀 API server started successfully`);
    logger.info(`   Listening on http://${host}:${port}`);
    logger.info(`   Health check: http://${host}:${port}/health`);
    logger.info(`   Debug enqueue: http://${host}:${port}/debug/enqueue`);
    logger.info(`   Debug env: http://${host}:${port}/debug/env`);
    logger.info(`   Debug queue peek: http://${host}:${port}/debug/queue/peek`);
    logger.info(`   Debug queue inspect: http://${host}:${port}/debug/queue/inspect`);
    logger.info(`   GitLab webhook: http://${host}:${port}/webhooks/gitlab`);
    logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  } catch (err) {
    logger.error(err, 'Failed to start server');
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});

