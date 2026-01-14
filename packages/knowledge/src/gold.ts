/**
 * Auto-GOLD evaluation and promotion logic
 */

import { prisma } from '@mrp/db';
import type { GitLabMergeRequest, GitLabMergeRequestChanges } from '@mrp/gitlab';
import { computeFeatureSignature } from './features.js';
import { createHash } from 'crypto';

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
import type { Change } from '@mrp/checks';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface GoldEvaluationResult {
  qualifies: boolean;
  reason?: string;
  score: number;
  hasSecurityFail: boolean;
  approvalsCount?: number;
  approvalsUnknown?: boolean;
}

export interface GoldPromotionInput {
  tenantId: string;
  projectId: string;
  mrIid: number;
  mr: GitLabMergeRequest;
  mrChanges: GitLabMergeRequestChanges;
  reviewRunId: string;
  score: number;
  checkResults: Array<{
    category: string;
    status: string;
  }>;
  approvalsCount?: number;
  mergedBy?: string;
  mergeCommitSha?: string;
  mergedAt?: Date;
}

/**
 * Evaluate if an MR qualifies for GOLD promotion
 */
export function evaluateGoldQualification(
  score: number,
  checkResults: Array<{ category: string; status: string }>,
  approvalsCount?: number,
  mergedBy?: string
): GoldEvaluationResult {
  const goldScoreThreshold = Number.parseInt(
    process.env.GOLD_SCORE_THRESHOLD || '85',
    10
  );
  
  // Check for SECURITY category FAIL
  const hasSecurityFail = checkResults.some(
    r => r.category === 'SECURITY' && r.status === 'FAIL'
  );
  
  if (hasSecurityFail) {
    return {
      qualifies: false,
      reason: 'SECURITY category has FAIL checks',
      score,
      hasSecurityFail: true,
      approvalsUnknown: false,
    };
  }
  
  if (score < goldScoreThreshold) {
    return {
      qualifies: false,
      reason: `Score ${score} below threshold ${goldScoreThreshold}`,
      score,
      hasSecurityFail: false,
      approvalsUnknown: false,
    };
  }
  
  // Check approvals (best-effort)
  const hasApproval = approvalsCount !== undefined
    ? approvalsCount >= 1
    : !!mergedBy; // Fallback: if merged_by is present, assume approved
  
  if (!hasApproval && approvalsCount === undefined) {
    // If we can't determine approvals, allow but mark as unknown
    return {
      qualifies: true,
      reason: 'Qualifies (approvals unknown)',
      score,
      hasSecurityFail: false,
      approvalsUnknown: true,
    };
  }
  
  if (!hasApproval) {
    return {
      qualifies: false,
      reason: 'No approvals found',
      score,
      hasSecurityFail: false,
      approvalsCount,
      approvalsUnknown: false,
    };
  }
  
  return {
    qualifies: true,
    reason: 'Meets all GOLD criteria',
    score,
    hasSecurityFail: false,
    approvalsCount,
    approvalsUnknown: false,
  };
}

/**
 * Build content text for GOLD MR (deterministic)
 */
function buildGoldContentText(
  mr: GitLabMergeRequest,
  mrChanges: GitLabMergeRequestChanges,
  score: number,
  summary: string
): string {
  const parts: string[] = [];
  
  // MR title
  parts.push(`# ${mr.title}\n`);
  
  // MR description
  if (mr.description) {
    parts.push(`## Description\n${mr.description}\n`);
  }
  
  // Score summary
  parts.push(`## Review Score\n${score}/100 - ${summary}\n`);
  
  // Changed files list
  parts.push(`## Changed Files (${mrChanges.changes.length})\n`);
  for (const change of mrChanges.changes) {
    const path = change.new_path || change.old_path;
    const status = change.new_file
      ? '[NEW]'
      : change.deleted_file
      ? '[DELETED]'
      : change.renamed_file
      ? '[RENAMED]'
      : '[MODIFIED]';
    parts.push(`- ${status} ${path}`);
  }
  
  // Trimmed diffs
  parts.push(`\n## Diffs\n`);
  for (const change of mrChanges.changes) {
    if (change.diff) {
      const path = change.new_path || change.old_path;
      parts.push(`### ${path}\n`);
      parts.push('```diff');
      parts.push(trimDiff(change.diff, 10000)); // Trim to 10KB per file
      parts.push('```\n');
    }
  }
  
  return parts.join('\n');
}

/**
 * Promote MR to GOLD (idempotent)
 */
export async function promoteToGold(
  input: GoldPromotionInput
): Promise<{ id: string; created: boolean }> {
  const {
    tenantId,
    projectId,
    mrIid,
    mr,
    mrChanges,
    reviewRunId,
    score,
    checkResults,
    approvalsCount,
    mergedBy,
    mergeCommitSha,
    mergedAt,
  } = input;
  
  logger.info(
    {
      event: 'knowledge.gold.evaluate.start',
      tenantId,
      projectId,
      mrIid,
      reviewRunId,
      score,
    },
    'Evaluating GOLD promotion'
  );
  
  // Evaluate qualification
  const evaluation = evaluateGoldQualification(
    score,
    checkResults,
    approvalsCount,
    mergedBy
  );
  
  if (!evaluation.qualifies) {
    logger.info(
      {
        event: 'knowledge.gold.evaluate.skip',
        tenantId,
        projectId,
        mrIid,
        reason: evaluation.reason,
        score,
      },
      'MR does not qualify for GOLD'
    );
    throw new Error(`MR does not qualify for GOLD: ${evaluation.reason}`);
  }
  
  // Build content text
  const summary = `${checkResults.length} checks: ${
    checkResults.filter(r => r.status === 'PASS').length
  } PASS / ${
    checkResults.filter(r => r.status === 'WARN').length
  } WARN / ${
    checkResults.filter(r => r.status === 'FAIL').length
  } FAIL`;
  
  const contentText = buildGoldContentText(mr, mrChanges, score, summary);
  const contentHash = computeHash(contentText);
  
  // Compute feature signature
  const changes: Change[] = mrChanges.changes.map(c => ({
    path: c.new_path || c.old_path,
    diff: c.diff || '',
  }));
  
  const featureSignature = computeFeatureSignature({
    title: mr.title,
    description: mr.description || undefined,
    changes,
  });
  
  // Build metadata
  const categoryBreakdown: Record<string, { pass: number; warn: number; fail: number }> = {};
  for (const result of checkResults) {
    if (!categoryBreakdown[result.category]) {
      categoryBreakdown[result.category] = { pass: 0, warn: 0, fail: 0 };
    }
    if (result.status === 'PASS') categoryBreakdown[result.category].pass++;
    else if (result.status === 'WARN') categoryBreakdown[result.category].warn++;
    else if (result.status === 'FAIL') categoryBreakdown[result.category].fail++;
  }
  
  const metadata = {
    projectId,
    mrIid,
    headSha: mr.sha,
    mergeCommitSha: mergeCommitSha || mr.merge_commit_sha || null,
    mergedAt: mergedAt?.toISOString() || mr.updated_at,
    mergedBy: mergedBy || null,
    approvalsCount: approvalsCount ?? null,
    approvalsUnknown: evaluation.approvalsUnknown || false,
    score,
    categoryBreakdown,
    featureSignature: featureSignature.tokens,
    featureHash: featureSignature.hash,
    reviewRunId,
    featureTags: [] as string[], // Reserved for future use
  };
  
  const providerId = `${projectId}:${mrIid}:${mergeCommitSha || mr.sha}`;
  
  // Check for existing by contentHash (idempotency)
  const existingByHash = await prisma.knowledgeSource.findUnique({
    where: {
      tenantId_contentHash: {
        tenantId,
        contentHash,
      },
    },
  });
  
  if (existingByHash) {
    logger.info(
      {
        event: 'knowledge.gold.evaluate.success',
        tenantId,
        projectId,
        mrIid,
        knowledgeSourceId: existingByHash.id,
        created: false,
      },
      'GOLD MR already exists (by contentHash)'
    );
    return { id: existingByHash.id, created: false };
  }
  
  // Check for existing by providerId (update if exists)
  const existingByProviderId = await prisma.knowledgeSource.findFirst({
    where: {
      tenantId,
      type: 'GOLD_MR',
      provider: 'GITLAB',
      providerId,
    },
  });
  
  if (existingByProviderId) {
    // Update if score improved or more info available
    const existingScore = (existingByProviderId.metadata as { score?: number } | null)?.score ?? 0;
    const shouldUpdate = score > existingScore;
    
    if (shouldUpdate) {
      await prisma.knowledgeSource.update({
        where: { id: existingByProviderId.id },
        data: {
          title: mr.title,
          sourceUrl: mr.web_url,
          contentText,
          contentHash,
          metadata,
          updatedAt: new Date(),
        },
      });
      
      logger.info(
        {
          event: 'knowledge.gold.evaluate.success',
          tenantId,
          projectId,
          mrIid,
          knowledgeSourceId: existingByProviderId.id,
          created: false,
          updated: true,
        },
        'GOLD MR updated (score improved)'
      );
      return { id: existingByProviderId.id, created: false };
    } else {
      logger.info(
        {
          event: 'knowledge.gold.evaluate.success',
          tenantId,
          projectId,
          mrIid,
          knowledgeSourceId: existingByProviderId.id,
          created: false,
        },
        'GOLD MR already exists (no update needed)'
      );
      return { id: existingByProviderId.id, created: false };
    }
  }
  
  // Create new GOLD MR
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
  
  logger.info(
    {
      event: 'knowledge.gold.evaluate.success',
      tenantId,
      projectId,
      mrIid,
      knowledgeSourceId: knowledgeSource.id,
      created: true,
      score,
    },
    'GOLD MR created successfully'
  );
  
  return { id: knowledgeSource.id, created: true };
}

