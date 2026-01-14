/**
 * Knowledge source ingestion functions
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { prisma } from '@mrp/db';
import { createGitLabClient } from '@mrp/gitlab';
import type { IngestGoldMrOptions, IngestDocsOptions, IngestResult } from './types.js';

/**
 * Compute SHA256 hash of content
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Trim large diff to reasonable size with clear markers
 */
function trimDiff(diff: string, maxSize: number = 50000): string {
  if (diff.length <= maxSize) return diff;
  
  const trimmed = diff.substring(0, maxSize);
  return `${trimmed}\n\n... [DIFF TRUNCATED: ${diff.length - maxSize} more characters] ...`;
}

/**
 * Ingest a Gold Merge Request from GitLab
 */
export async function ingestGoldMergeRequest(
  options: IngestGoldMrOptions,
  gitlabClient: ReturnType<typeof createGitLabClient>
): Promise<IngestResult> {
  const { tenantId, projectId, mrIid } = options;
  
  // Fetch MR details and changes
  const [mr, changes] = await Promise.all([
    gitlabClient.getMergeRequest(projectId, mrIid),
    gitlabClient.getMergeRequestChanges(projectId, mrIid),
  ]);
  
  // Build content text deterministically
  const contentParts: string[] = [];
  
  // MR title
  contentParts.push(`# ${mr.title}\n`);
  
  // MR description
  if (mr.description) {
    contentParts.push(`## Description\n${mr.description}\n`);
  }
  
  // Changed files list
  contentParts.push(`## Changed Files (${changes.changes.length})\n`);
  for (const change of changes.changes) {
    const status = change.new_file ? '[NEW]' : change.deleted_file ? '[DELETED]' : change.renamed_file ? '[RENAMED]' : '[MODIFIED]';
    contentParts.push(`- ${status} ${change.new_path || change.old_path}`);
  }
  contentParts.push('');
  
  // Diffs (trimmed if too large)
  contentParts.push(`## Diffs\n`);
  for (const change of changes.changes) {
    if (change.diff) {
      const trimmedDiff = trimDiff(change.diff);
      contentParts.push(`### ${change.new_path || change.old_path}\n`);
      contentParts.push('```diff');
      contentParts.push(trimmedDiff);
      contentParts.push('```\n');
    }
  }
  
  const contentText = contentParts.join('\n');
  const contentHash = computeHash(contentText);
  const bytes = Buffer.byteLength(contentText, 'utf8');
  
  // Build metadata
  const metadata = {
    projectId,
    mrIid,
    author: mr.author?.name || mr.author?.username || 'unknown',
    mergedAt: mr.merge_commit_sha ? new Date().toISOString() : null,
    filePaths: changes.changes.map(c => c.new_path || c.old_path),
    fileCount: changes.changes.length,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
  };
  
  // Upsert with idempotency
  const providerId = `${projectId}:${mrIid}`;
  
  // Check for existing by contentHash first (idempotency)
  const existingByHash = await prisma.knowledgeSource.findUnique({
    where: {
      tenantId_contentHash: {
        tenantId,
        contentHash,
      },
    },
  });
  
  if (existingByHash) {
    // Content unchanged, return existing
    return {
      id: existingByHash.id,
      contentHash: existingByHash.contentHash,
      bytes: Buffer.byteLength(existingByHash.contentText, 'utf8'),
      created: false,
    };
  }
  
  // Check for existing by providerId
  const existing = await prisma.knowledgeSource.findFirst({
    where: {
      tenantId,
      type: 'GOLD_MR',
      provider: 'GITLAB',
      providerId,
    },
  });
  
  if (existing) {
    // Update existing
    const updated = await prisma.knowledgeSource.update({
      where: { id: existing.id },
      data: {
        title: mr.title,
        sourceUrl: mr.web_url,
        contentText,
        contentHash,
        metadata,
        updatedAt: new Date(),
      },
    });
    
    return {
      id: updated.id,
      contentHash: updated.contentHash,
      bytes,
      created: false,
    };
  }
  
  // Create new
  const knowledgeSource = await prisma.knowledgeSource.create({
    data: {
      tenantId,
      type: 'GOLD_MR',
      provider: 'GITLAB',
      providerId,
      title: mr.title,
      sourceUrl: mr.web_url,
      contentText,
      contentHash,
      metadata,
    },
  });
  
  return {
    id: knowledgeSource.id,
    contentHash: knowledgeSource.contentHash,
    bytes,
    created: !existing,
  };
}

/**
 * Ingest documentation files from local filesystem
 */
export async function ingestDocsFromRepo(
  options: IngestDocsOptions
): Promise<IngestResult[]> {
  const { tenantId, rootPath } = options;
  const resolvedPath = resolve(rootPath);
  const results: IngestResult[] = [];
  
  // Find all markdown files
  const docPatterns = [
    /^README/i,
    /\.md$/i,
  ];
  
  const docPaths: string[] = [];
  
  function scanDirectory(dir: string, baseDir: string): void {
    if (!existsSync(dir)) return;
    
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(baseDir, fullPath);
      
      // Skip node_modules, .git, dist, etc.
      if (entry.name.startsWith('.') || 
          entry.name === 'node_modules' || 
          entry.name === 'dist' ||
          entry.name === 'build') {
        continue;
      }
      
      if (entry.isDirectory()) {
        // Check if it's a docs directory
        if (entry.name === 'docs' || relPath.startsWith('docs/')) {
          scanDirectory(fullPath, baseDir);
        }
      } else if (entry.isFile()) {
        // Check if it matches doc patterns
        const matches = docPatterns.some(pattern => pattern.test(entry.name));
        if (matches) {
          docPaths.push(fullPath);
        }
      }
    }
  }
  
  // Scan for docs
  scanDirectory(resolvedPath, resolvedPath);
  
  // Also check root for README files
  if (existsSync(resolvedPath)) {
    const rootEntries = readdirSync(resolvedPath, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && /^README/i.test(entry.name)) {
        const fullPath = join(resolvedPath, entry.name);
        if (!docPaths.includes(fullPath)) {
          docPaths.push(fullPath);
        }
      }
    }
  }
  
  // Ingest each doc file
  for (const docPath of docPaths) {
    try {
      const content = readFileSync(docPath, 'utf8');
      const contentHash = computeHash(content);
      const bytes = Buffer.byteLength(content, 'utf8');
      const relPath = relative(resolvedPath, docPath);
      
      // Build metadata
      const stats = statSync(docPath);
      const metadata = {
        filePath: relPath,
        absolutePath: docPath,
        fileSize: bytes,
        modifiedAt: stats.mtime.toISOString(),
      };
      
      // Upsert with idempotency
      const providerId = relPath;
      
      // Check for existing by contentHash first (idempotency)
      const existingByHash = await prisma.knowledgeSource.findUnique({
        where: {
          tenantId_contentHash: {
            tenantId,
            contentHash,
          },
        },
      });
      
      if (existingByHash) {
        // Content unchanged
        results.push({
          id: existingByHash.id,
          contentHash: existingByHash.contentHash,
          bytes: Buffer.byteLength(existingByHash.contentText, 'utf8'),
          created: false,
        });
        continue;
      }
      
      // Check for existing by providerId
      const existing = await prisma.knowledgeSource.findFirst({
        where: {
          tenantId,
          type: 'DOC',
          provider: 'LOCAL',
          providerId,
        },
      });
      
      // Extract filename for title
      const fileName = relPath.split('/').pop() || relPath;
      
      let knowledgeSource;
      if (existing) {
        // Update existing
        knowledgeSource = await prisma.knowledgeSource.update({
          where: { id: existing.id },
          data: {
            title: fileName,
            contentText: content,
            contentHash,
            metadata,
            updatedAt: new Date(),
          },
        });
      } else {
        // Create new
        knowledgeSource = await prisma.knowledgeSource.create({
          data: {
            tenantId,
            type: 'DOC',
            provider: 'LOCAL',
            providerId,
            title: fileName,
            sourceUrl: null,
            contentText: content,
            contentHash,
            metadata,
          },
        });
      }
      
      results.push({
        id: knowledgeSource.id,
        contentHash: knowledgeSource.contentHash,
        bytes,
        created: !existing,
      });
    } catch (error) {
      // Log error but continue with other files
      console.error(`Failed to ingest ${docPath}:`, error);
    }
  }
  
  return results;
}

