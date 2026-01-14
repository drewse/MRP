import { Queue } from 'bullmq';
import Redis from 'ioredis';
import pino from 'pino';
import { QUEUE_NAME, buildReviewJobId, type ReviewMrJobPayload } from '@mrp/core';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  },
});

// Extract Redis host from REDIS_URL for logging (without credentials)
function extractRedisHost(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    return `${urlObj.hostname}:${urlObj.port || '6379'}`;
  } catch {
    return 'unknown';
  }
}

// Redact password from Redis URL for logging
function redactRedisUrl(url: string | undefined): string {
  if (!url) return 'unknown';
  try {
    const urlObj = new URL(url);
    if (urlObj.password) {
      urlObj.password = '***';
    }
    return urlObj.toString();
  } catch {
    // If URL parsing fails, try to redact password manually
    return url.replace(/:[^:@]+@/, ':***@');
  }
}

let redisConnection: Redis | null = null;
let reviewQueue: Queue<ReviewMrJobPayload> | null = null;

/**
 * Initialize Redis connection and BullMQ queue
 */
export function initializeQueue(): void {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required');
  }

  const redisHost = extractRedisHost(redisUrl);
  logger.info({ event: 'queue.init.start', redisHost }, 'Initializing queue...');

  try {
    // Create Redis connection
    redisConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
    });

    // Create BullMQ queue
    reviewQueue = new Queue<ReviewMrJobPayload>(QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          count: 100,
        },
        removeOnFail: {
          count: 100,
        },
      },
    });

    // Get Redis connection info for logging
    const redisInfo = redisConnection.options;
    const redisDb = (redisInfo as { db?: number }).db || 0;
    const redisUrlRedacted = redactRedisUrl(redisUrl);
    
    logger.info(
      { 
        event: 'queue.init.success', 
        queueName: QUEUE_NAME, 
        redisHost,
        redisUrl: redisUrlRedacted,
        redisDb,
        queuePrefix: (reviewQueue as any).opts?.prefix || 'bull',
      },
      '✅ Queue initialized successfully'
    );
    
    // Log queue configuration ONCE at startup
    logger.info({
      event: 'queue.config',
      queueName: QUEUE_NAME,
      redisUrl: redisUrlRedacted,
      redisHost,
      redisDb,
      queuePrefix: (reviewQueue as any).opts?.prefix || 'bull',
    }, 'Queue configuration');
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(
      { event: 'queue.init.failure', error: err.message, redisHost },
      '❌ Failed to initialize queue'
    );
    throw err;
  }
}

/**
 * Get the review queue instance
 * Must call initializeQueue() first
 */
export function getQueue(): Queue<ReviewMrJobPayload> {
  if (!reviewQueue) {
    throw new Error('Queue not initialized. Call initializeQueue() first.');
  }
  return reviewQueue;
}

/**
 * Enqueue a review job (idempotent)
 * If a job with the same jobId already exists, returns the existing job ID
 */
export async function enqueueReviewJob(payload: ReviewMrJobPayload): Promise<string> {
  const queue = getQueue();
  const jobId = buildReviewJobId(payload);

  // Guard: If reviewRunId is present, jobId MUST include it (dev-only assertion)
  if (payload.reviewRunId && process.env.NODE_ENV !== 'production') {
    if (!jobId.includes(payload.reviewRunId)) {
      logger.error(
        {
          event: 'queue.enqueue.jobid_missing_reviewRunId',
          jobId,
          reviewRunId: payload.reviewRunId,
          payload,
        },
        'ERROR: jobId does not include reviewRunId - this will cause deduplication!'
      );
      throw new Error(`jobId must include reviewRunId when present. jobId=${jobId}, reviewRunId=${payload.reviewRunId}`);
    }
  }

  logger.info(
    {
      event: 'queue.enqueue.attempt',
      jobId,
      tenantSlug: payload.tenantSlug,
      provider: payload.provider,
      projectId: payload.projectId,
      mrIid: payload.mrIid,
      headSha: payload.headSha,
      reviewRunId: payload.reviewRunId,
      jobIdIncludesReviewRunId: payload.reviewRunId ? jobId.includes(payload.reviewRunId) : false,
    },
    'Attempting to enqueue review job'
  );

  try {
    // Check if job already exists (idempotency)
    // IMPORTANT: If reviewRunId is present, this is a manual trigger and each ReviewRun must have its own job.
    // Skip idempotency check for manual triggers to ensure every ReviewRun gets processed.
    const isManualTrigger = !!payload.reviewRunId;
    
    if (!isManualTrigger) {
      // Only check for existing jobs for webhook-triggered jobs (legacy behavior)
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const jobState = await existingJob.getState();
        if (jobState === 'completed' || jobState === 'active' || jobState === 'waiting' || jobState === 'delayed') {
          logger.info(
            {
              event: 'queue.enqueue.duplicate',
              queueName: QUEUE_NAME,
              jobId: existingJob.id,
              computedJobId: jobId,
              state: jobState,
              tenantSlug: payload.tenantSlug,
              reviewRunId: payload.reviewRunId,
            },
            'Job already exists in queue, skipping enqueue'
          );
          return existingJob.id!;
        }
        // If job is failed, we can retry it by removing and re-adding
        if (jobState === 'failed') {
          logger.info(
            {
              event: 'queue.enqueue.retry',
              queueName: QUEUE_NAME,
              jobId: existingJob.id,
              computedJobId: jobId,
              tenantSlug: payload.tenantSlug,
              reviewRunId: payload.reviewRunId,
            },
            'Removing failed job and re-enqueueing'
          );
          await existingJob.remove();
        }
      }
    } else {
      // Manual trigger: check if job exists and log as error if it does (shouldn't happen with unique reviewRunId)
      const existingJob = await queue.getJob(jobId);
      if (existingJob) {
        const jobState = await existingJob.getState();
        logger.error(
          {
            event: 'queue.enqueue.duplicate_manual_trigger',
            queueName: QUEUE_NAME,
            jobId: existingJob.id,
            computedJobId: jobId,
            state: jobState,
            tenantSlug: payload.tenantSlug,
            reviewRunId: payload.reviewRunId,
          },
          'ERROR: Job already exists for manual trigger - this should not happen with unique reviewRunId'
        );
        // Still remove and re-enqueue to ensure the new ReviewRun gets processed
        await existingJob.remove();
      }
    }

    // Log computed jobId and payload reviewRunId before enqueue
    logger.info(
      {
        event: 'queue.enqueue.before_add',
        computedJobId: jobId,
        payloadReviewRunId: payload.reviewRunId || null,
        tenantSlug: payload.tenantSlug,
        projectId: payload.projectId,
        mrIid: payload.mrIid,
        headSha: payload.headSha,
      },
      'About to add job to queue'
    );

    // Explicitly set jobId and job options to ensure no deduplication
    const job = await queue.add('review-mr', payload, {
      jobId,
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for debugging
    });

    const actualJobId = job.id!;
    
    // Warn if actual jobId doesn't match computed jobId
    if (actualJobId !== jobId) {
      logger.warn(
        {
          event: 'queue.enqueue.jobid_mismatch',
          computedJobId: jobId,
          actualJobId,
          payloadReviewRunId: payload.reviewRunId || null,
          tenantSlug: payload.tenantSlug,
        },
        '⚠️ WARNING: Actual jobId does not match computed jobId!'
      );
    }

    logger.info(
      {
        event: 'queue.enqueued',
        queueName: QUEUE_NAME,
        jobId: actualJobId,
        computedJobId: jobId,
        jobIdMatches: actualJobId === jobId,
        tenantSlug: payload.tenantSlug,
        reviewRunId: payload.reviewRunId || null,
      },
      '✅ Job enqueued successfully'
    );

    return actualJobId;
  } catch (error: unknown) {
    const err = error as Error;
    logger.error(
      {
        event: 'queue.enqueue.failed',
        jobId,
        error: err.message,
        tenantSlug: payload.tenantSlug,
        projectId: payload.projectId,
        mrIid: payload.mrIid,
      },
      '❌ Failed to enqueue job'
    );
    throw err;
  }
}

/**
 * Close queue and Redis connections gracefully
 */
export async function closeQueue(): Promise<void> {
  logger.info({ event: 'queue.close.start' }, 'Closing queue connections...');

  try {
    if (reviewQueue) {
      await reviewQueue.close();
      reviewQueue = null;
    }
    if (redisConnection) {
      await redisConnection.quit();
      redisConnection = null;
    }
    logger.info({ event: 'queue.close.success' }, '✅ Queue connections closed');
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ event: 'queue.close.failure', error: err.message }, '❌ Error closing queue');
    throw err;
  }
}

