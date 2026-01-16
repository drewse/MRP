/**
 * Authentication routes
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma, getOrCreateTenantBySlug } from '@mrp/db';
import { createHash } from 'crypto';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Simple JWT secret (in production, use a secure random secret)
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Hash password using SHA-256 (simple, but for production use bcrypt/argon2)
 * TODO: Replace with bcrypt in production
 */
function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

/**
 * Generate JWT token (simplified - in production use jsonwebtoken library)
 * Format: base64(userId:tenantId:expiry:signature)
 */
function generateToken(userId: string, tenantId: string): string {
  const expiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const payload = `${userId}:${tenantId}:${expiry}`;
  const signature = createHash('sha256').update(payload + JWT_SECRET).digest('hex').substring(0, 16);
  const token = Buffer.from(`${payload}:${signature}`).toString('base64url');
  return token;
}

/**
 * Verify and decode JWT token
 */
function verifyToken(token: string): { userId: string; tenantId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [payload, signature] = decoded.split(':');
    if (!payload || !signature) return null;
    
    const [userId, tenantId, expiryStr] = payload.split(':');
    if (!userId || !tenantId || !expiryStr) return null;
    
    const expiry = parseInt(expiryStr, 10);
    if (Date.now() > expiry) return null; // Expired
    
    // Verify signature
    const expectedSignature = createHash('sha256').update(payload + JWT_SECRET).digest('hex').substring(0, 16);
    if (signature !== expectedSignature) return null;
    
    return { userId, tenantId };
  } catch {
    return null;
  }
}

/**
 * POST /auth/login
 */
export async function login(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as { email?: string; password?: string };
  
  if (!body.email || !body.password) {
    return reply.code(400).send({
      error: 'Bad Request',
      message: 'Email and password are required',
    });
  }

  try {
    // Find user by email (search across all tenants for now)
    // TODO: In production, consider email uniqueness across tenants or tenant-specific login
    const user = await prisma.user.findFirst({
      where: { email: body.email.toLowerCase().trim() },
      include: { tenant: true },
    });

    if (!user) {
      logger.info({ event: 'auth.login.failed', email: body.email, reason: 'user_not_found' });
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Verify password
    // For seeded users, password is stored as hash directly (no salt)
    // For new users, we'll use a salt
    const passwordHash = user.passwordHash;
    const passwordMatch = passwordHash === hashPassword(body.password, '') || 
                         passwordHash === createHash('sha256').update(body.password).digest('hex');

    if (!passwordMatch) {
      logger.info({ event: 'auth.login.failed', email: body.email, userId: user.id, reason: 'invalid_password' });
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    // Generate JWT token
    const token = generateToken(user.id, user.tenantId);

    logger.info({ event: 'auth.login.success', userId: user.id, tenantId: user.tenantId, email: user.email });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'auth.login.error', error: err.message }, 'Login error');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An error occurred during login',
    });
  }
}

/**
 * POST /auth/logout (client-side token removal, but we log it)
 */
export async function logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      logger.info({ event: 'auth.logout', userId: decoded.userId, tenantId: decoded.tenantId });
    }
  }

  return reply.send({ ok: true });
}

/**
 * GET /auth/me - Get current user info
 */
export async function getMe(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Missing authorization token',
    });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { tenant: true },
    });

    if (!user || user.tenantId !== decoded.tenantId) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'User not found',
      });
    }

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        tenantSlug: user.tenant.slug,
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'auth.me.error', error: err.message }, 'Get me error');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'An error occurred',
    });
  }
}

/**
 * GET /auth/bootstrap - One-time bootstrap endpoint to create admin user
 * Only enabled when ALLOW_BOOTSTRAP=true
 */
export async function bootstrap(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Check if bootstrap is enabled
  if (process.env.ALLOW_BOOTSTRAP !== 'true') {
    logger.info({ event: 'auth.bootstrap.denied', reason: 'ALLOW_BOOTSTRAP not set to true' });
    return reply.code(404).send({
      error: 'Not Found',
      message: 'Endpoint not found',
    });
  }

  const email = 'admin@quickiter.com';
  const password = 'admin123';
  const tenantSlug = 'dev';

  try {
    logger.info({ event: 'auth.bootstrap.start', email, tenantSlug }, 'Bootstrap endpoint called');

    // Ensure tenant "dev" exists
    const tenant = await getOrCreateTenantBySlug(tenantSlug);
    logger.info({ event: 'auth.bootstrap.tenant', tenantId: tenant.id, tenantSlug }, 'Tenant ensured');

    // Hash password using same logic as login (no salt for seeded users)
    const passwordHash = createHash('sha256').update(password).digest('hex');

    // Upsert admin user
    const user = await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: email.toLowerCase().trim(),
        },
      },
      create: {
        email: email.toLowerCase().trim(),
        passwordHash,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
      update: {
        passwordHash,
        role: 'ADMIN',
      },
      include: {
        tenant: true,
      },
    });

    logger.info(
      { event: 'auth.bootstrap.success', userId: user.id, email, tenantSlug, tenantId: tenant.id },
      'Admin user bootstrapped successfully'
    );

    return reply.send({
      ok: true,
      email: user.email,
      tenantSlug: user.tenant.slug,
    });
  } catch (error) {
    const err = error as Error;
    logger.error({ event: 'auth.bootstrap.error', error: err.message, stack: err.stack }, 'Bootstrap error');
    return reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to bootstrap admin user',
    });
  }
}

/**
 * Middleware to extract user/tenant from JWT token
 * Sets request.userId and request.tenantId if valid token present
 */
export function extractAuthFromRequest(request: FastifyRequest): { userId: string; tenantId: string } | null {
  const authHeader = request.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return null;
  }

  const decoded = verifyToken(token);
  if (decoded) {
    (request as any).userId = decoded.userId;
    (request as any).tenantId = decoded.tenantId;
  }

  return decoded;
}

