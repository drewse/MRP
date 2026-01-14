import { PrismaClient } from '@prisma/client';
import pino from 'pino';

// Note: .env loading is handled centrally by @mrp/config
// This package should be imported after initEnv() has been called

// Initialize logger
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

// Extract database host from DATABASE_URL for logging (without credentials)
function extractDbHost(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return `${urlObj.hostname}:${urlObj.port || '5432'}`;
  } catch {
    return 'unknown';
  }
}

// Create singleton Prisma client
let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  const dbHost = extractDbHost(databaseUrl);

  logger.info('🔧 Initializing Prisma client...');
  logger.info(`   Database host: ${dbHost}`);

  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? [{ level: 'query', emit: 'event' }, { level: 'error', emit: 'event' }, { level: 'warn', emit: 'event' }]
      : [{ level: 'error', emit: 'event' }],
  });

  // Log Prisma query events in development
  if (process.env.NODE_ENV === 'development') {
    client.$on('query' as never, (e: { query: string; params: string; duration: number }) => {
      logger.debug({ query: e.query, duration: `${e.duration}ms` }, 'Prisma query');
    });
  }

  // Log Prisma errors
  client.$on('error' as never, (e: { message: string; target?: string }) => {
    logger.error({ error: e.message, target: e.target }, 'Prisma error');
  });

  // Log Prisma warnings
  client.$on('warn' as never, (e: { message: string }) => {
    logger.warn({ warning: e.message }, 'Prisma warning');
  });

  logger.info('✅ Prisma client initialized');

  return client;
}

// Lazy initialization - only create client when first accessed
function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }
  return prismaInstance;
}

// Export singleton instance
// Note: PrismaClient doesn't connect until first query, so this is safe
export const prisma = getPrismaClient();

// Re-export Prisma types for convenience
export type { Prisma } from '@prisma/client';
export { PrismaClient } from '@prisma/client';

// Re-export tenant helpers
export { getOrCreateTenantBySlug, type Tenant } from './tenant.js';

/**
 * Check database connection health
 * Runs a simple SELECT 1 query to verify connectivity
 * @throws Error if connection fails
 */
export async function checkDbConnection(): Promise<void> {
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

  logger.info('🔍 Checking database connection...');
  const dbHost = extractDbHost(process.env.DATABASE_URL);
  logger.info(`   Database host: ${dbHost}`);

  try {
    const startTime = Date.now();
    await getPrismaClient().$queryRaw`SELECT 1`;
    const duration = Date.now() - startTime;

    logger.info(`✅ Database connection successful (${duration}ms)`);
  } catch (error: unknown) {
    const err = error as Error & { code?: string; meta?: unknown };
    
    logger.error({
      error: err.message,
      code: err.code,
      meta: err.meta,
    }, '❌ Database connection failed');

    // Re-throw with more context
    throw new Error(
      `Database connection check failed: ${err.message}${err.code ? ` (code: ${err.code})` : ''}`
    );
  }
}

/**
 * Gracefully disconnect Prisma client
 * Call this before process exit
 */
export async function disconnectPrisma(): Promise<void> {
  logger.info('🔌 Disconnecting Prisma client...');
  try {
    if (prismaInstance) {
      await prismaInstance.$disconnect();
      prismaInstance = null;
      logger.info('✅ Prisma client disconnected');
    } else {
      logger.warn('⚠️  Prisma client was not initialized');
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ error: err.message }, '❌ Error disconnecting Prisma client');
    throw err;
  }
}
