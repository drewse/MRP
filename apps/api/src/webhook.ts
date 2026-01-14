import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  try {
    const aBuffer = Buffer.from(a, 'utf8');
    const bBuffer = Buffer.from(b, 'utf8');
    return timingSafeEqual(aBuffer, bBuffer);
  } catch {
    return false;
  }
}

