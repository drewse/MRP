import { prisma, getTenantByWebhookSecret } from '@mrp/db';
import { enqueueReviewJob } from './queue.js';
import { recordActivity } from './activity-buffer.js';
import type { ReviewMrJobPayload } from '@mrp/core';
import type { FastifyRequest, FastifyReply } from 'fastify';

// GitLab webhook payload types (minimal, only what we need)
interface GitLabWebhookPayload {
  object_kind?: string;
  object_attributes?: {
    id?: number;
    iid?: number;
    title?: string;
    description?: string;
    state?: string;
    action?: string;
    source_branch?: string;
    target_branch?: string;
    url?: string;
    web_url?: string;
    last_commit?: {
      id?: string;
      sha?: string;
      author?: {
        name?: string;
        email?: string;
      };
    };
    target_project_id?: number;
    source_project_id?: number;
  };
  project?: {
    id?: number;
    name?: string;
    path?: string;
    path_with_namespace?: string;
    namespace?: {
      name?: string;
      path?: string;
    };
  };
  user?: {
    username?: string;
    name?: string;
    email?: string;
  };
}

/**
 * Extract repository namespace and name from GitLab project data
 */
function extractRepoInfo(project: GitLabWebhookPayload['project']): {
  namespace: string;
  name: string;
} {
  if (!project) {
    return { namespace: 'unknown', name: 'unknown' };
  }

  // Prefer path_with_namespace (e.g., "group/subgroup/repo")
  if (project.path_with_namespace) {
    const parts = project.path_with_namespace.split('/');
    const name = parts.pop() || 'unknown';
    const namespace = parts.join('/') || 'unknown';
    return { namespace, name };
  }

  // Fallback: use path + namespace.name
  if (project.path && project.namespace?.name) {
    return { namespace: project.namespace.name, name: project.path };
  }

  // Fallback: use path only
  if (project.path) {
    return { namespace: 'unknown', name: project.path };
  }

  return { namespace: 'unknown', name: 'unknown' };
}

/**
 * Extract MR fields defensively from GitLab webhook payload
 */
function extractMrFields(payload: GitLabWebhookPayload): {
  projectId: string | null;
  mrIid: number | null;
  headSha: string | null;
  title: string | null;
  description: string | null;
  webUrl: string | null;
  author: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  state: string | null;
  action: string | null;
} {
  const attrs = payload.object_attributes || {};

  // projectId: prefer project.id, fallback to target_project_id or source_project_id
  const projectId =
    payload.project?.id?.toString() ||
    attrs.target_project_id?.toString() ||
    attrs.source_project_id?.toString() ||
    null;

  // mrIid
  const mrIid = attrs.iid || null;

  // headSha: prefer last_commit.id, fallback to last_commit.sha
  const headSha = attrs.last_commit?.id || attrs.last_commit?.sha || null;

  // title
  const title = attrs.title || null;

  // description
  const description = attrs.description || null;

  // webUrl: prefer url, fallback to web_url
  const webUrl = attrs.url || attrs.web_url || null;

  // author: prefer user.username, fallback to last_commit.author.name
  const author =
    payload.user?.username ||
    attrs.last_commit?.author?.name ||
    'unknown';

  // sourceBranch
  const sourceBranch = attrs.source_branch || 'unknown';

  // targetBranch
  const targetBranch = attrs.target_branch || 'main';

  // state
  const state = attrs.state || 'unknown';

  // action
  const action = attrs.action || null;

  return {
    projectId,
    mrIid,
    headSha,
    title,
    description,
    webUrl,
    author,
    sourceBranch,
    targetBranch,
    state,
    action,
  };
}

/**
 * Handle GitLab Merge Request webhook
 */
export async function handleGitLabWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const payload = request.body as GitLabWebhookPayload;
  const logger = request.log;
  const headers = request.headers;

  // Extract headers
  const gitlabToken = headers['x-gitlab-token'] as string | undefined;
  const gitlabEvent = headers['x-gitlab-event'] as string | undefined;

  // Extract fields early for logging
  const fields = extractMrFields(payload);
  const action = fields.action;
  const projectId = fields.projectId;
  const mrIid = fields.mrIid;
  const headSha = fields.headSha;

  // Log webhook received with all relevant details
  logger.info(
    {
      event: 'webhook.received',
      eventHeader: gitlabEvent,
      action,
      projectId,
      mrIid,
      headSha,
    },
    'GitLab webhook received'
  );

  // Record in activity buffer
  recordActivity({
    type: 'webhook.received',
    projectId,
    mrIid,
    headSha,
    detail: action ? `Action: ${action}` : null,
  });

  // Resolve tenant by webhook secret
  // GitLab sends secret in X-Gitlab-Token header, or we can check query param as fallback
  const webhookSecret = gitlabToken || (request.query as { secret?: string }).secret;
  
  if (!webhookSecret) {
    logger.error({
      event: 'webhook.auth.failed',
      reason: 'Missing webhook secret',
      hint: 'Configure GitLab webhook to send X-Gitlab-Token header with your tenant webhook secret',
    });
    return reply.code(401).send({ 
      ok: false, 
      error: 'Missing webhook secret',
      hint: 'Configure GitLab webhook to send X-Gitlab-Token header with your tenant webhook secret',
    });
  }

  // Look up tenant by secret
  const tenantId = await getTenantByWebhookSecret(webhookSecret, 'gitlab');
  
  if (!tenantId) {
    logger.error({
      event: 'webhook.auth.failed',
      reason: 'Invalid webhook secret',
      hint: 'Webhook secret does not match any tenant configuration. Check your webhook secret in the portal settings.',
    });
    return reply.code(401).send({ 
      ok: false, 
      error: 'Invalid webhook secret',
      hint: 'Webhook secret does not match any tenant configuration. Check your webhook secret in the portal settings.',
    });
  }

  // Get tenant to use in processing
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true },
  });

  if (!tenant) {
    logger.error({
      event: 'webhook.auth.failed',
      reason: 'Tenant not found',
      tenantId,
    });
    return reply.code(401).send({ 
      ok: false, 
      error: 'Tenant not found',
    });
  }

  logger.info(
    {
      event: 'webhook.auth.success',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
    },
    'Webhook authenticated via tenant secret'
  );

  // Only handle Merge Request Hook events
  if (gitlabEvent !== 'Merge Request Hook' && gitlabEvent !== 'merge_request') {
    const reason = `Event type '${gitlabEvent}' not supported, only 'Merge Request Hook'`;
    logger.info({ event: 'webhook.ignored', reason, eventType: gitlabEvent });
    recordActivity({
      type: 'webhook.ignored',
      projectId,
      mrIid,
      detail: reason,
    });
    return reply.code(202).send({ ok: true, ignored: true, reason });
  }

  // Handle MR events: focus on open, update, reopen
  // Ignore: close, merge (unless commit SHA changed - handled below)
  const triggerActions = ['open', 'update', 'reopen'];
  const isMerged = fields.state === 'merged' || fields.state === 'closed';
  const isMergeAction = fields.action === 'merge';
  const isCloseAction = fields.action === 'close';
  
  // Ignore close action (MR closed without merge)
  if (isCloseAction) {
    const reason = `Action 'close' ignored - MR closed without merge`;
    logger.info({ event: 'webhook.ignored', reason, action: fields.action, projectId, mrIid });
    recordActivity({
      type: 'webhook.ignored',
      projectId,
      mrIid,
      headSha,
      detail: reason,
    });
    return reply.code(202).send({ ok: true, ignored: true, reason });
  }

  // For merge action, only trigger if SHA changed (new commits before merge)
  // Otherwise ignore merge-only events
  if (isMergeAction && !fields.headSha) {
    const reason = `Action 'merge' ignored - no headSha (merge-only event, no new commits)`;
    logger.info({ event: 'webhook.ignored', reason, action: fields.action, projectId, mrIid });
    recordActivity({
      type: 'webhook.ignored',
      projectId,
      mrIid,
      detail: reason,
    });
    return reply.code(202).send({ ok: true, ignored: true, reason });
  }

  // Ignore other actions not in trigger set
  if (fields.action && !triggerActions.includes(fields.action) && !isMergeAction) {
    const reason = `Action '${fields.action}' not in trigger set: ${triggerActions.join(', ')}`;
    logger.info({ event: 'webhook.ignored', reason, action: fields.action, projectId, mrIid });
    recordActivity({
      type: 'webhook.ignored',
      projectId,
      mrIid,
      headSha,
      detail: reason,
    });
    return reply.code(202).send({ ok: true, ignored: true, reason });
  }

  // Validate required fields
  if (!fields.projectId || !fields.mrIid || !fields.headSha) {
    const reason = `Missing required fields: projectId=${!!fields.projectId}, mrIid=${!!fields.mrIid}, headSha=${!!fields.headSha}`;
    logger.warn({ event: 'webhook.ignored', reason });
    recordActivity({
      type: 'webhook.ignored',
      projectId,
      mrIid,
      headSha,
      detail: reason,
    });
    return reply.code(202).send({ ok: true, ignored: true, reason });
  }

  try {
    // Tenant already resolved from webhook secret above
    // Use that tenant for processing

    // Extract repo info
    const repoInfo = extractRepoInfo(payload.project);

    // Upsert Repository
    const repository = await prisma.repository.upsert({
      where: {
        tenantId_provider_providerRepoId: {
          tenantId: tenant.id,
          provider: 'gitlab',
          providerRepoId: fields.projectId,
        },
      },
      create: {
        tenantId: tenant.id,
        provider: 'gitlab',
        providerRepoId: fields.projectId,
        namespace: repoInfo.namespace,
        name: repoInfo.name,
        defaultBranch: fields.targetBranch || 'main',
      },
      update: {
        namespace: repoInfo.namespace,
        name: repoInfo.name,
        defaultBranch: fields.targetBranch || undefined,
      },
    });

    logger.info(
      {
        event: 'db.upsert.complete',
        repositoryId: repository.id,
        action: 'repository',
      },
      'Repository upserted'
    );

    // Check existing MR to see if headSha changed (before upsert updates it)
    const existingMr = await prisma.mergeRequest.findUnique({
      where: {
        tenantId_repositoryId_iid: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          iid: fields.mrIid!,
        },
      },
      select: {
        id: true,
        lastSeenSha: true,
      },
    });

    // Dedupe strategy: Check if headSha changed from MR's lastSeenSha
    // If headSha is different, create a new ReviewRun (new commits)
    // If headSha is same, check for existing ReviewRun to avoid duplicates
    const headShaChanged = existingMr?.lastSeenSha !== fields.headSha;

    // Upsert MergeRequest
    const mergeRequest = await prisma.mergeRequest.upsert({
      where: {
        tenantId_repositoryId_iid: {
          tenantId: tenant.id,
          repositoryId: repository.id,
          iid: fields.mrIid!,
        },
      },
      create: {
        tenantId: tenant.id,
        repositoryId: repository.id,
        iid: fields.mrIid!,
        title: fields.title || 'Untitled MR',
        author: fields.author || 'unknown',
        sourceBranch: fields.sourceBranch || 'unknown',
        targetBranch: fields.targetBranch || 'main',
        state: fields.state || 'opened',
        webUrl: fields.webUrl || `https://gitlab.com/project/${fields.projectId}/merge_requests/${fields.mrIid}`,
        lastSeenSha: fields.headSha || null,
      },
      update: {
        title: fields.title || undefined,
        author: fields.author || undefined,
        sourceBranch: fields.sourceBranch || undefined,
        targetBranch: fields.targetBranch || undefined,
        state: fields.state || undefined,
        webUrl: fields.webUrl || undefined,
        lastSeenSha: fields.headSha || undefined,
      },
    });

    logger.info(
      {
        event: 'db.upsert.complete',
        mergeRequestId: mergeRequest.id,
        action: 'mergeRequest',
        previousLastSeenSha: existingMr?.lastSeenSha || null,
        newLastSeenSha: fields.headSha,
        headShaChanged,
      },
      'MergeRequest upserted'
    );
    
    if (!headShaChanged) {
      // Same SHA - check for existing ReviewRun to avoid duplicates
      const existingRun = await prisma.reviewRun.findFirst({
        where: {
          tenantId: tenant.id,
          mergeRequestId: mergeRequest.id,
          headSha: fields.headSha,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Idempotency checks for same SHA
      if (existingRun) {
        if (existingRun.status === 'SUCCEEDED') {
          const reason = `ReviewRun already exists with SUCCEEDED status for headSha ${fields.headSha}`;
          logger.info({ event: 'webhook.ignored', reason, reviewRunId: existingRun.id, headSha: fields.headSha });
          recordActivity({
            type: 'webhook.ignored',
            projectId: fields.projectId,
            mrIid: fields.mrIid,
            headSha: fields.headSha,
            reviewRunId: existingRun.id,
            detail: reason,
          });
          return reply.code(200).send({ ok: true, ignored: true, reason, reviewRunId: existingRun.id });
        }

        if (existingRun.status === 'QUEUED' || existingRun.status === 'RUNNING') {
          const reason = `ReviewRun already exists with status ${existingRun.status} for headSha ${fields.headSha}`;
          logger.info({ event: 'webhook.ignored', reason, reviewRunId: existingRun.id, headSha: fields.headSha });
          recordActivity({
            type: 'webhook.ignored',
            projectId: fields.projectId,
            mrIid: fields.mrIid,
            headSha: fields.headSha,
            reviewRunId: existingRun.id,
            detail: reason,
          });
          return reply.code(200).send({ ok: true, ignored: true, reason, reviewRunId: existingRun.id });
        }

        // If ReviewRun is FAILED, we can retry it
        if (existingRun.status === 'FAILED') {
          logger.info(
            {
              event: 'webhook.reviewrun.retry',
              reviewRunId: existingRun.id,
              previousError: existingRun.error,
              headSha: fields.headSha,
            },
            'ReviewRun exists with FAILED status, will retry'
          );
          // Update existing ReviewRun to QUEUED for retry
          const reviewRun = await prisma.reviewRun.update({
            where: { id: existingRun.id },
            data: {
              status: 'QUEUED',
              error: null,
              finishedAt: null,
            },
          });
          
          // Check if MR is merged (for GOLD promotion)
          const isMergedCandidate = isMerged && (isMergeAction || fields.action === 'update');
          
          // Enqueue job with reviewRunId for uniqueness
          const jobPayload: ReviewMrJobPayload = {
            tenantSlug: tenant.slug,
            provider: 'gitlab',
            projectId: fields.projectId,
            mrIid: fields.mrIid,
            headSha: fields.headSha,
            title: fields.title || undefined,
            isMergedCandidate,
            reviewRunId: reviewRun.id, // CRITICAL: Must be included for unique jobId
          };

          try {
            const jobId = await enqueueReviewJob(jobPayload);
            logger.info(
              {
                event: 'webhook.reviewrun.created',
                reviewRunId: reviewRun.id,
                jobId,
                headSha: fields.headSha,
                retry: true,
              },
              'ReviewRun retry enqueued'
            );
            recordActivity({
              type: 'webhook.reviewrun.created',
              projectId: fields.projectId,
              mrIid: fields.mrIid,
              headSha: fields.headSha,
              reviewRunId: reviewRun.id,
              jobId,
              detail: 'Retry',
            });
            return reply.code(200).send({
              ok: true,
              tenantId: tenant.id,
              reviewRunId: reviewRun.id,
              jobId,
              retry: true,
            });
          } catch (enqueueError: unknown) {
            const err = enqueueError as Error;
            logger.error({ event: 'queue.enqueue.failed', error: err.message, reviewRunId: reviewRun.id });
            return reply.code(500).send({ ok: false, error: 'Failed to enqueue job', message: err.message });
          }
        }
      }
    } else {
      // headSha changed - this is a new commit, always create a new ReviewRun
      logger.info(
        {
          event: 'webhook.headsha.changed',
          mergeRequestId: mergeRequest.id,
          oldHeadSha: existingMr?.lastSeenSha || null,
          newHeadSha: fields.headSha,
        },
        'Head SHA changed, will create new ReviewRun'
      );
      recordActivity({
        type: 'webhook.headsha.changed',
        projectId: fields.projectId,
        mrIid: fields.mrIid,
        headSha: fields.headSha,
        detail: `SHA changed: ${existingMr?.lastSeenSha || 'none'} → ${fields.headSha}`,
      });
    }

    // Create ReviewRun
    const reviewRun = await prisma.reviewRun.create({
      data: {
        tenantId: tenant.id,
        mergeRequestId: mergeRequest.id,
        headSha: fields.headSha,
        status: 'QUEUED',
      },
    });

    logger.info(
      {
        event: 'db.upsert.complete',
        reviewRunId: reviewRun.id,
        action: 'reviewRun',
        headSha: fields.headSha,
      },
      'ReviewRun created'
    );

    // Check if MR is merged (for GOLD promotion)
    const isMergedCandidate = isMerged && (isMergeAction || fields.action === 'update');
    
    // Enqueue job with reviewRunId for uniqueness
    // This ensures each ReviewRun gets its own job, preventing deduplication
    const jobPayload: ReviewMrJobPayload = {
      tenantSlug: tenant.slug,
      provider: 'gitlab',
      projectId: fields.projectId,
      mrIid: fields.mrIid,
      headSha: fields.headSha,
      title: fields.title || undefined,
      isMergedCandidate,
      reviewRunId: reviewRun.id, // CRITICAL: Must be included for unique jobId
    };

    try {
      const jobId = await enqueueReviewJob(jobPayload);
      logger.info(
        {
          event: 'webhook.reviewrun.created',
          reviewRunId: reviewRun.id,
          jobId,
          headSha: fields.headSha,
          projectId: fields.projectId,
          mrIid: fields.mrIid,
        },
        'ReviewRun created and enqueued'
      );
      recordActivity({
        type: 'webhook.reviewrun.created',
        projectId: fields.projectId,
        mrIid: fields.mrIid,
        headSha: fields.headSha,
        reviewRunId: reviewRun.id,
        jobId,
      });
      return reply.code(200).send({
        ok: true,
        tenantId: tenant.id,
        reviewRunId: reviewRun.id,
        jobId,
      });
    } catch (error: unknown) {
      // Check if it's a duplicate job error from BullMQ
      const err = error as Error;
      if (err.message.includes('duplicate') || err.message.includes('already exists')) {
        logger.info({ event: 'queue.deduped', reviewRunId: reviewRun.id, reason: err.message });
        return reply.code(200).send({
          ok: true,
          tenantId: tenant.id,
          reviewRunId: reviewRun.id,
          deduped: true,
          reason: 'Job already exists in queue',
        });
      }
      throw error;
    }
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(
      {
        event: 'webhook.error',
        error: err.message,
        stack: err.stack,
      },
      'Error processing webhook'
    );
    return reply.code(500).send({ ok: false, error: 'Internal server error' });
  }
}

