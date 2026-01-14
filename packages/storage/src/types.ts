/**
 * Types for storage operations
 */

export interface StorageConfig {
  provider: 's3' | 'r2' | 'minio';
  endpoint?: string; // Required for R2/minio, empty for AWS S3
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface PresignedPutUrlOptions {
  bucket: string;
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number; // Default: 3600 (1 hour)
}

export interface PresignedPutUrlResult {
  url: string;
  expiresInSeconds: number;
}

