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
    
    // Ensure TenantAiConfig exists (idempotent - safe to run multiple times)
    await ensureTenantAiConfig(tenant.id);
    
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

  // Auto-provision TenantAiConfig for new tenant (enabled by default)
  await ensureTenantAiConfig(tenant.id);

  return tenant;
}

/**
 * Ensure TenantAiConfig exists for a tenant (idempotent)
 * Creates with enabled=true, model="gpt-4o-mini" if missing
 * Safe to call multiple times - uses upsert
 * @param tenantId - Tenant ID (CUID)
 */
async function ensureTenantAiConfig(tenantId: string): Promise<void> {
  try {
    // Check if config already exists
    const existing = await prisma.tenantAiConfig.findUnique({
      where: { tenantId },
    });

    if (existing) {
      // Already exists, no action needed (idempotent)
      return;
    }

    // Create with defaults: enabled=true, model="gpt-4o-mini"
    await prisma.tenantAiConfig.create({
      data: {
        tenantId,
        enabled: true,
        model: 'gpt-4o-mini',
        provider: 'OPENAI',
        maxSuggestions: 5,
        maxPromptChars: 6000,
        maxTotalDiffBytes: 40000,
      },
    });

    logger.info(
      { event: 'tenant.ai_config.auto_provisioned', tenantId },
      'Auto-provisioned TenantAiConfig with enabled=true, model=gpt-4o-mini'
    );
  } catch (error) {
    // Log error but don't throw - tenant lookup should still succeed
    const err = error as Error;
    logger.warn(
      { event: 'tenant.ai_config.auto_provision_failed', tenantId, error: err.message },
      'Failed to auto-provision TenantAiConfig (non-fatal)'
    );
  }
}

