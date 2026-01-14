/**
 * Shared queue types and utilities
 */

export interface ReviewMrJobPayload {
  tenantSlug: string;
  provider: 'gitlab';
  projectId: string;
  mrIid: number;
  headSha: string;
  title?: string;
  isMergedCandidate?: boolean; // If true, evaluate for GOLD promotion
  reviewRunId?: string; // If present, included in jobId for uniqueness per run
}

export const QUEUE_NAME = 'mrp-review';
export const JOB_NAME = 'review-mr';

/**
 * Build a unique job ID for a review job
 * Format: ${tenantSlug}__${provider}__${projectId}__${mrIid}__${headSha}__${reviewRunId}
 * If reviewRunId is present, it's appended to guarantee uniqueness per ReviewRun
 * Uses double underscore (__) as separator to avoid BullMQ restrictions on colons
 */
export function buildReviewJobId(payload: ReviewMrJobPayload): string {
  const base = `${payload.tenantSlug}__${payload.provider}__${payload.projectId}__${payload.mrIid}__${payload.headSha}`;
  if (payload.reviewRunId) {
    return `${base}__${payload.reviewRunId}`;
  }
  return base;
}

/**
 * @deprecated Use buildReviewJobId instead
 * Kept for backward compatibility during migration
 */
export function generateJobId(payload: ReviewMrJobPayload): string {
  return buildReviewJobId(payload);
}

