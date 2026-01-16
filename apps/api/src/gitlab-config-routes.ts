/**
 * GitLab configuration routes for tenants
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma, ensureTenantWebhookConfig } from '@mrp/db';
import { createGitLabClient } from '@mrp/gitlab';
import { requireAuth } from './tenant-auth.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * GET /tenant/gitlab-config
 * Get GitLab configuration for current tenant
 */
export async function getGitLabConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Require authentication
  await requireAuth(request, reply);
  if (reply.sent) return;

  const tenantId = (request as any).tenantId;
  if (!tenantId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Tenant ID not found in request',
    });
  }

  try {
    const config = await prisma.tenantGitlabConfig.findUnique({
      where: { tenantId },
    });

    // Ensure webhook config exists (auto-generate if missing)
    const webhookSecret = await ensureTenantWebhookConfig(tenantId, 'gitlab');

    if (!config) {
      return reply.send({
        token: null,
        baseUrl: 'https://gitlab.com',
        enabled: false,
        webhookUrl: `${process.env.APP_PUBLIC_URL || 'http://localhost:3001'}/webhooks/gitlab`,
        webhookSecret: webhookSecret,
      });
    }

    // Never return the actual token - just indicate if it's set
    return reply.send({
      token: config.token ? '***' : null, // Mask token
      baseUrl: config.baseUrl,
      enabled: config.enabled,
      webhookUrl: `${process.env.APP_PUBLIC_URL || 'http://localhost:3001'}/webhooks/gitlab`,
      webhookSecret: webhookSecret,
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'gitlab.config.get.error', tenantId, error: err.message }, 'Failed to get GitLab config');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to get GitLab configuration',
    });
  }
}

/**
 * PUT /tenant/gitlab-config
 * Upsert GitLab configuration for current tenant
 */
export async function updateGitLabConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Require authentication
  await requireAuth(request, reply);
  if (reply.sent) return;

  const tenantId = (request as any).tenantId;
  if (!tenantId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Tenant ID not found in request',
    });
  }

  const body = request.body as {
    token?: string;
    baseUrl?: string;
    enabled?: boolean;
  };

  try {
    // If token is '***' or empty, don't update it (preserve existing)
    const existing = await prisma.tenantGitlabConfig.findUnique({
      where: { tenantId },
    });

    const tokenToSave = body.token && body.token !== '***' ? body.token : existing?.token || null;
    const baseUrl = body.baseUrl || existing?.baseUrl || 'https://gitlab.com';
    const enabled = body.enabled !== undefined ? body.enabled : (existing?.enabled ?? true);

    const config = await prisma.tenantGitlabConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        token: tokenToSave || '',
        baseUrl,
        enabled,
      },
      update: {
        ...(tokenToSave !== null && { token: tokenToSave }),
        baseUrl,
        enabled,
      },
    });

    logger.info({ event: 'gitlab.config.updated', tenantId }, 'GitLab config updated');

    // Ensure webhook config exists
    const webhookSecret = await ensureTenantWebhookConfig(tenantId, 'gitlab');

    // Return config without token
    return reply.send({
      token: config.token ? '***' : null,
      baseUrl: config.baseUrl,
      enabled: config.enabled,
      webhookUrl: `${process.env.APP_PUBLIC_URL || 'http://localhost:3001'}/webhooks/gitlab`,
      webhookSecret: webhookSecret,
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'gitlab.config.update.error', tenantId, error: err.message }, 'Failed to update GitLab config');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to update GitLab configuration',
    });
  }
}

/**
 * POST /tenant/gitlab-config/test
 * Test GitLab connection with current tenant's config
 */
export async function testGitLabConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Require authentication
  await requireAuth(request, reply);
  if (reply.sent) return;

  const tenantId = (request as any).tenantId;
  if (!tenantId) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Tenant ID not found in request',
    });
  }

  try {
    const config = await prisma.tenantGitlabConfig.findUnique({
      where: { tenantId },
    });

    if (!config || !config.token || !config.enabled) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'GitLab configuration not found or not enabled. Please configure and enable GitLab integration first.',
      });
    }

    // Test connection by calling GitLab API
    const client = createGitLabClient({
      baseUrl: config.baseUrl,
      token: config.token,
    });

    try {
      const user = await client.getUser();
      
      logger.info({ event: 'gitlab.config.test.success', tenantId, gitlabUserId: user.id }, 'GitLab connection test successful');

      return reply.send({
        success: true,
        message: `Successfully connected to GitLab as ${user.username}`,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
        },
      });
    } catch (gitlabError) {
      const err = gitlabError as Error;
      logger.warn({ event: 'gitlab.config.test.failed', tenantId, error: err.message }, 'GitLab connection test failed');
      
      return reply.code(400).send({
        success: false,
        message: `Failed to connect to GitLab: ${err.message}`,
      });
    }
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'gitlab.config.test.error', tenantId, error: err.message }, 'Failed to test GitLab config');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to test GitLab configuration',
    });
  }
}

