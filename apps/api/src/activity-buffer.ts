/**
 * In-memory activity buffer for webhook events
 * Stores recent webhook-triggered events for debugging
 * 
 * NOTE: This is a prototype feature. For production, use a proper observability stack.
 */

export interface ActivityEvent {
  ts: number; // Unix timestamp in milliseconds
  type: string; // Event type: webhook.received, webhook.reviewrun.created, etc.
  projectId?: string | null;
  mrIid?: number | null;
  headSha?: string | null;
  detail?: string | null;
  reviewRunId?: string | null;
  jobId?: string | null;
}

const MAX_BUFFER_SIZE = 50;
const buffer: ActivityEvent[] = [];

/**
 * Add an event to the activity buffer
 */
export function recordActivity(event: Omit<ActivityEvent, 'ts'>): void {
  const activityEvent: ActivityEvent = {
    ...event,
    ts: Date.now(),
  };

  buffer.push(activityEvent);

  // Keep buffer size under limit (ring buffer behavior)
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.shift(); // Remove oldest item
  }
}

/**
 * Get recent activity events (newest first)
 */
export function getRecentActivity(limit: number = 20): ActivityEvent[] {
  return buffer
    .slice()
    .reverse() // Newest first
    .slice(0, limit);
}

/**
 * Clear the activity buffer (useful for testing)
 */
export function clearActivity(): void {
  buffer.length = 0;
}

