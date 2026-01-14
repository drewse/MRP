/**
 * S3-compatible storage client
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import pino from 'pino';
import type { StorageConfig, PresignedPutUrlOptions, PresignedPutUrlResult } from './types.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Validate endpoint URL format
 */
function validateEndpoint(endpoint: string): void {
  if (!endpoint || endpoint.trim().length === 0) {
    throw new Error('STORAGE_ENDPOINT is required but is empty or missing');
  }

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

  // Validate it's a parseable URL
  try {
    const url = new URL(endpoint);
    if (!url.hostname || url.hostname === '...') {
      throw new Error(`STORAGE_ENDPOINT has invalid hostname: ${url.hostname}`);
    }
  } catch (error) {
    const err = error as Error;
    throw new Error(`STORAGE_ENDPOINT is not a valid URL: ${err.message}`);
  }
}

/**
 * Extract hostname from endpoint URL for logging (safe, no secrets)
 */
function extractEndpointHost(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return url.hostname;
  } catch {
    return 'invalid';
  }
}

/**
 * Create S3 client from config
 */
function createS3Client(config: StorageConfig): S3Client {
  const clientConfig: {
    region: string;
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
    };
    endpoint?: string;
    forcePathStyle?: boolean;
  } = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };

  // For R2 and minio, endpoint is required
  if (config.provider === 'r2' || config.provider === 'minio') {
    if (!config.endpoint) {
      throw new Error(
        `STORAGE_ENDPOINT is required for provider "${config.provider}". Please set STORAGE_ENDPOINT in your .env file.`
      );
    }
    validateEndpoint(config.endpoint);
    clientConfig.endpoint = config.endpoint;
    // R2 and minio typically require path-style addressing
    clientConfig.forcePathStyle = true;
  } else if (config.endpoint) {
    // For S3, endpoint is optional but if provided, validate it
    validateEndpoint(config.endpoint);
    clientConfig.endpoint = config.endpoint;
  }

  return new S3Client(clientConfig);
}

/**
 * Create presigned PUT URL for uploading a file
 */
export async function createPresignedPutUrl(
  config: StorageConfig,
  options: PresignedPutUrlOptions
): Promise<PresignedPutUrlResult> {
  const expiresInSeconds = options.expiresInSeconds || 3600; // Default: 1 hour

  const s3Client = createS3Client(config);

  const command = new PutObjectCommand({
    Bucket: options.bucket,
    Key: options.key,
    ContentType: options.contentType,
    ContentLength: options.contentLength,
  });

  try {
    const url = await getSignedUrl(s3Client, command, {
      expiresIn: expiresInSeconds,
    });

    // Validate presigned URL has a valid hostname
    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname || urlObj.hostname === '...' || urlObj.hostname.trim().length === 0) {
        throw new Error(
          `Generated presigned URL has invalid hostname: "${urlObj.hostname}". Check STORAGE_ENDPOINT configuration.`
        );
      }
    } catch (urlError) {
      const err = urlError as Error;
      logger.error({
        event: 'storage.presigned.invalid_url',
        bucket: options.bucket,
        key: options.key,
        error: err.message,
      }, 'Presigned URL validation failed');
      throw new Error(`Invalid presigned URL generated: ${err.message}`);
    }

    // Log safe debug info (endpoint host and bucket, never the URL or keys)
    const endpointHost = config.endpoint ? extractEndpointHost(config.endpoint) : 'aws-s3';
    logger.debug({
      event: 'storage.presigned.created',
      bucket: options.bucket,
      endpointHost,
      key: options.key,
      contentType: options.contentType,
      contentLength: options.contentLength,
      expiresInSeconds,
      // Never log the actual URL, access keys, or presigned URL
    }, 'Presigned PUT URL created');

    return {
      url,
      expiresInSeconds,
    };
  } catch (error) {
    const err = error as Error;
    logger.error({
      event: 'storage.presigned.failed',
      bucket: options.bucket,
      key: options.key,
      error: err.message,
    }, 'Failed to create presigned URL');

    throw new Error(`Failed to create presigned URL: ${err.message}`);
  }
}

/**
 * Create storage client from environment variables
 */
export function createStorageClientFromEnv(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 's3').toLowerCase();
  
  if (provider !== 's3' && provider !== 'r2' && provider !== 'minio') {
    throw new Error(
      `Unsupported storage provider: ${provider}. Supported providers: s3, r2, minio`
    );
  }

  const endpoint = process.env.STORAGE_ENDPOINT?.trim();

  // For R2 and minio, endpoint is required
  if ((provider === 'r2' || provider === 'minio') && !endpoint) {
    throw new Error(
      `STORAGE_ENDPOINT is required for provider "${provider}". Please set STORAGE_ENDPOINT in your .env file (e.g., https://<accountId>.r2.cloudflarestorage.com for R2).`
    );
  }

  // Validate endpoint if provided
  if (endpoint) {
    validateEndpoint(endpoint);
  }

  return {
    provider: provider as 's3' | 'r2' | 'minio',
    endpoint: endpoint || undefined,
    region: process.env.STORAGE_REGION!,
    bucket: process.env.STORAGE_BUCKET!,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
  };
}

