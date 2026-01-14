/**
 * Types for knowledge source ingestion
 */

export interface IngestGoldMrOptions {
  tenantId: string;
  projectId: string;
  mrIid: number;
}

export interface IngestDocsOptions {
  tenantId: string;
  rootPath: string;
}

export interface IngestResult {
  id: string;
  contentHash: string;
  bytes: number;
  created: boolean;
}

// Export empty object to ensure this file generates a .js file
// (TypeScript doesn't emit .js files for type-only files)
export {};

