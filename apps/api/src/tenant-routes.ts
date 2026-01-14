/**
 * Tenant settings and upload routes
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma, getOrCreateTenantBySlug } from '@mrp/db';
import { createPresignedPutUrl, createStorageClientFromEnv } from '@mrp/storage';
import { randomUUID } from 'crypto';

/**
 * Resolve tenant from request headers
 */
async function resolveTenantFromRequest(request: FastifyRequest): Promise<{ id: string; slug: string }> {
  const tenantSlugHeader = request.headers['x-mrp-tenant-slug'] as string | undefined;
  const tenantSlug = tenantSlugHeader || process.env.DEFAULT_TENANT_SLUG || 'dev';
  const tenant = await getOrCreateTenantBySlug(tenantSlug);
  return tenant;
}

/**
 * Get or create tenant settings with defaults
 */
async function getOrCreateTenantSettings(tenantId: string) {
  let settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  if (!settings) {
    settings = await prisma.tenantSettings.create({
      data: {
        tenantId,
        allowedExtensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'json'],
        maxFileSizeBytes: 26214400, // 25MB
        allowedMimePrefixes: ['text/', 'application/'],
      },
    });
  }

  return settings;
}

/**
 * Sanitize filename for object key
 */
function sanitizeFileName(fileName: string): string {
  // Remove path separators and dangerous characters
  return fileName
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 255); // Limit length
}

/**
 * Extract file extension from filename
 */
function extractExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.substring(lastDot + 1).toLowerCase();
}

/**
 * Validate extension format (lowercase alphanumeric, no dots)
 */
function validateExtension(ext: string): boolean {
  return /^[a-z0-9]+$/.test(ext);
}

/**
 * Validate file upload request
 */
function validateUploadRequest(
  fileName: string,
  sizeBytes: number,
  mimeType: string,
  settings: { allowedExtensions: string[]; maxFileSizeBytes: number; allowedMimePrefixes: string[] }
): { allowed: boolean; reasonCode?: string } {
  // Validate extension
  const ext = extractExtension(fileName);
  if (!ext) {
    return { allowed: false, reasonCode: 'invalid_request' };
  }

  if (!validateExtension(ext)) {
    return { allowed: false, reasonCode: 'invalid_request' };
  }

  if (!settings.allowedExtensions.includes(ext)) {
    return { allowed: false, reasonCode: 'extension_not_allowed' };
  }

  // Validate size
  if (sizeBytes > settings.maxFileSizeBytes) {
    return { allowed: false, reasonCode: 'file_too_large' };
  }

  // Validate MIME type
  const mimeAllowed = settings.allowedMimePrefixes.some((prefix) => mimeType.startsWith(prefix));
  if (!mimeAllowed) {
    return { allowed: false, reasonCode: 'mime_not_allowed' };
  }

  return { allowed: true };
}

/**
 * GET /tenant/settings
 */
export async function getTenantSettings(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const logger = request.log;
  const tenant = await resolveTenantFromRequest(request);

  const settings = await getOrCreateTenantSettings(tenant.id);

  logger.info(
    {
      event: 'tenant.settings.read',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    },
    'Tenant settings retrieved'
  );

  reply.send({
    allowedExtensions: settings.allowedExtensions,
    maxFileSizeBytes: settings.maxFileSizeBytes,
    allowedMimePrefixes: settings.allowedMimePrefixes,
  });
}

/**
 * PUT /tenant/settings
 */
export async function updateTenantSettings(
  request: FastifyRequest<{
    Body: {
      allowedExtensions?: string[];
      maxFileSizeBytes?: number;
      allowedMimePrefixes?: string[];
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const logger = request.log;
  const tenant = await resolveTenantFromRequest(request);
  const body = request.body;

  // Validate extensions
  if (body.allowedExtensions) {
    for (const ext of body.allowedExtensions) {
      if (!validateExtension(ext)) {
        return reply.code(400).send({
          error: 'Invalid extension format',
          message: `Extension "${ext}" must be lowercase alphanumeric without dots`,
        });
      }
    }
  }

  // Validate max file size (safe bound: <= 200MB)
  if (body.maxFileSizeBytes !== undefined) {
    const maxAllowed = 200 * 1024 * 1024; // 200MB
    if (body.maxFileSizeBytes > maxAllowed) {
      return reply.code(400).send({
        error: 'File size limit too large',
        message: `maxFileSizeBytes must be <= ${maxAllowed} (200MB)`,
      });
    }
    if (body.maxFileSizeBytes <= 0) {
      return reply.code(400).send({
        error: 'Invalid file size',
        message: 'maxFileSizeBytes must be > 0',
      });
    }
  }

  // Validate MIME prefixes
  if (body.allowedMimePrefixes) {
    for (const prefix of body.allowedMimePrefixes) {
      if (!prefix.includes('/') || !prefix.endsWith('/')) {
        return reply.code(400).send({
          error: 'Invalid MIME prefix format',
          message: `MIME prefix "${prefix}" must be in format "type/" (e.g., "text/")`,
        });
      }
    }
  }

  const settings = await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      allowedExtensions: body.allowedExtensions || ['pdf', 'docx', 'txt', 'md', 'csv', 'json'],
      maxFileSizeBytes: body.maxFileSizeBytes ?? 26214400,
      allowedMimePrefixes: body.allowedMimePrefixes || ['text/', 'application/'],
    },
    update: {
      allowedExtensions: body.allowedExtensions,
      maxFileSizeBytes: body.maxFileSizeBytes,
      allowedMimePrefixes: body.allowedMimePrefixes,
    },
  });

  logger.info(
    {
      event: 'tenant.settings.updated',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      allowedExtensionsCount: settings.allowedExtensions.length,
      maxFileSizeBytes: settings.maxFileSizeBytes,
      allowedMimePrefixesCount: settings.allowedMimePrefixes.length,
    },
    'Tenant settings updated'
  );

  reply.send({
    allowedExtensions: settings.allowedExtensions,
    maxFileSizeBytes: settings.maxFileSizeBytes,
    allowedMimePrefixes: settings.allowedMimePrefixes,
  });
}

/**
 * POST /uploads/presign
 */
export async function presignUpload(
  request: FastifyRequest<{
    Body: {
      fileName: string;
      sizeBytes: number;
      mimeType: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const logger = request.log;
  const tenant = await resolveTenantFromRequest(request);
  const { fileName, sizeBytes, mimeType } = request.body;

  // Get tenant settings
  const settings = await getOrCreateTenantSettings(tenant.id);

  // Validate upload request
  const validation = validateUploadRequest(fileName, sizeBytes, mimeType, {
    allowedExtensions: settings.allowedExtensions,
    maxFileSizeBytes: settings.maxFileSizeBytes,
    allowedMimePrefixes: settings.allowedMimePrefixes,
  });

  const ext = extractExtension(fileName);

  if (!validation.allowed) {
    logger.info(
      {
        event: 'uploads.presign.requested',
        tenantId: tenant.id,
        mimeType,
        sizeBytes,
        extension: ext,
        allowed: false,
        reasonCode: validation.reasonCode,
      },
      'Upload presign request denied'
    );

    return reply.code(400).send({
      error: 'Upload not allowed',
      reasonCode: validation.reasonCode,
    });
  }

  // Generate object key: tenants/<tenantId>/<yyyy>/<mm>/<uuid>-<sanitizedFileName>
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uuid = randomUUID();
  const sanitizedFileName = sanitizeFileName(fileName);
  const objectKey = `tenants/${tenant.id}/${year}/${month}/${uuid}-${sanitizedFileName}`;

  // Create storage client
  const storageConfig = createStorageClientFromEnv();

  // Create presigned URL
  const presignedResult = await createPresignedPutUrl(storageConfig, {
    bucket: storageConfig.bucket,
    key: objectKey,
    contentType: mimeType,
    contentLength: sizeBytes,
    expiresInSeconds: 3600, // 1 hour
  });

  // Create upload record
  const upload = await prisma.upload.create({
    data: {
      tenantId: tenant.id,
      objectKey,
      originalFileName: fileName,
      sizeBytes,
      mimeType,
      status: 'PRESIGNED',
    },
  });

  logger.info(
    {
      event: 'uploads.presign.requested',
      tenantId: tenant.id,
      mimeType,
      sizeBytes,
      extension: ext,
      allowed: true,
      uploadId: upload.id,
      objectKey,
      // Never log presignedUrl
    },
    'Upload presign request granted'
  );

  reply.send({
    uploadId: upload.id,
    objectKey,
    presignedUrl: presignedResult.url,
    expiresInSeconds: presignedResult.expiresInSeconds,
  });
}

/**
 * POST /uploads/complete
 */
export async function completeUpload(
  request: FastifyRequest<{
    Body: {
      uploadId: string;
    };
  }>,
  reply: FastifyReply
): Promise<void> {
  const logger = request.log;
  const tenant = await resolveTenantFromRequest(request);
  const { uploadId } = request.body;

  // Find upload and verify tenant ownership
  const upload = await prisma.upload.findUnique({
    where: { id: uploadId },
  });

  if (!upload) {
    return reply.code(404).send({
      error: 'Upload not found',
    });
  }

  if (upload.tenantId !== tenant.id) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: 'Upload belongs to a different tenant',
    });
  }

  // Update status
  const updated = await prisma.upload.update({
    where: { id: uploadId },
    data: {
      status: 'UPLOADED',
    },
  });

  logger.info(
    {
      event: 'uploads.complete',
      tenantId: tenant.id,
      uploadId: upload.id,
      objectKey: upload.objectKey,
    },
    'Upload marked as complete'
  );

  reply.send({
    id: updated.id,
    objectKey: updated.objectKey,
    originalFileName: updated.originalFileName,
    sizeBytes: updated.sizeBytes,
    mimeType: updated.mimeType,
    status: updated.status,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}

/**
 * GET /uploads
 */
export async function listUploads(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const logger = request.log;
  const tenant = await resolveTenantFromRequest(request);

  const uploads = await prisma.upload.findMany({
    where: {
      tenantId: tenant.id,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  });

  logger.info(
    {
      event: 'uploads.list',
      tenantId: tenant.id,
      count: uploads.length,
    },
    'Uploads listed'
  );

  reply.send({
    uploads: uploads.map((u) => ({
      id: u.id,
      objectKey: u.objectKey,
      originalFileName: u.originalFileName,
      sizeBytes: u.sizeBytes,
      mimeType: u.mimeType,
      status: u.status,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    })),
  });
}

