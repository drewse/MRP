import { prisma } from './index.js';
import pino from 'pino';

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

export interface Tenant {
  id: string;
  slug: string;
  name: string;
}

/**
 * Get or create a tenant by slug
 * Creates tenant if missing with name = slug
 * @param slug - Tenant slug identifier
 * @returns Tenant object with id, slug, and name
 */
export async function getOrCreateTenantBySlug(slug: string): Promise<Tenant> {
  logger.info({ event: 'tenant.lookup', slug }, 'Looking up tenant by slug');

  // Try to find existing tenant
  let tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });

  if (tenant) {
    logger.info(
      { event: 'tenant.resolved', tenantId: tenant.id, slug: tenant.slug, action: 'reused' },
      'Tenant found (reused existing)'
    );
    return tenant;
  }

  // Create new tenant if not found
  logger.info({ event: 'tenant.create', slug }, 'Tenant not found, creating new tenant');
  
  tenant = await prisma.tenant.create({
    data: {
      slug,
      name: slug, // Use slug as name by default
    },
    select: { id: true, slug: true, name: true },
  });

  logger.info(
    { event: 'tenant.resolved', tenantId: tenant.id, slug: tenant.slug, action: 'created' },
    'Tenant created successfully'
  );

  return tenant;
}

