/**
 * Tenant resolution with JWT and header-based auth support
 */

import type { FastifyRequest } from 'fastify';
import { prisma } from '@mrp/db';
import { extractAuthFromRequest } from './auth-routes.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface ResolvedTenant {
  id: string;
  slug: string;
  userId?: string; // Present if resolved from JWT
}

/**
 * Resolve tenant from request (JWT token or header)
 * Priority: JWT token > X-MRP-Tenant-Slug header > DEFAULT_TENANT_SLUG env > 'dev'
 */
export async function resolveTenantFromRequest(request: FastifyRequest): Promise<ResolvedTenant> {
  // Try JWT token first (for authenticated users)
  const authResult = extractAuthFromRequest(request);
  if (authResult) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: authResult.tenantId },
      select: { id: true, slug: true },
    });

    if (tenant) {
      logger.debug({ event: 'tenant.resolved.jwt', tenantId: tenant.id, userId: authResult.userId });
      return {
        id: tenant.id,
        slug: tenant.slug,
        userId: authResult.userId,
      };
    }

    // If tenant from JWT doesn't exist, fall through to header-based
    logger.warn({ event: 'tenant.not_found.jwt', tenantId: authResult.tenantId }, 'Tenant from JWT not found, falling back to header');
  }

  // Fall back to header-based auth (backward compatibility)
  const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
  const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
  
  const { getOrCreateTenantBySlug } = await import('@mrp/db');
  const tenant = await getOrCreateTenantBySlug(tenantSlug);
  
  logger.debug({ event: 'tenant.resolved.header', tenantId: tenant.id, slug: tenant.slug });
  return {
    id: tenant.id,
    slug: tenant.slug,
  };
}

/**
 * Middleware to require authentication (JWT token)
 * Returns 401 if no valid token
 */
export async function requireAuth(request: FastifyRequest, reply: any): Promise<void> {
  const authResult = extractAuthFromRequest(request);
  
  if (!authResult) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Authentication required. Please provide a valid JWT token.',
    });
  }

  // Verify user still exists
  const user = await prisma.user.findUnique({
    where: { id: authResult.userId },
  });

  if (!user || user.tenantId !== authResult.tenantId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'User not found or tenant mismatch',
    });
  }

  // Set on request for handlers
  (request as any).userId = authResult.userId;
  (request as any).tenantId = authResult.tenantId;
}

