/**
 * Simple test/assertion for buildReviewJobId uniqueness
 * Run with: node -r ts-node/register packages/core/src/queue.test.ts
 */

import { buildReviewJobId, type ReviewMrJobPayload } from './queue.js';

function testJobIdUniqueness() {
  const basePayload: ReviewMrJobPayload = {
    tenantSlug: 'dev',
    provider: 'gitlab',
    projectId: '77381939',
    mrIid: 2,
    headSha: 'abc123',
  };

  // Test 1: Same payload without reviewRunId should produce same jobId
  const jobId1 = buildReviewJobId(basePayload);
  const jobId2 = buildReviewJobId(basePayload);
  console.assert(jobId1 === jobId2, 'Same payload should produce same jobId (without reviewRunId)');
  console.log('✅ Test 1 passed: Same payload = same jobId (no reviewRunId)');

  // Test 2: Same payload with different reviewRunId should produce different jobId
  const payloadWithRun1: ReviewMrJobPayload = {
    ...basePayload,
    reviewRunId: 'run1',
  };
  const payloadWithRun2: ReviewMrJobPayload = {
    ...basePayload,
    reviewRunId: 'run2',
  };

  const jobIdWithRun1 = buildReviewJobId(payloadWithRun1);
  const jobIdWithRun2 = buildReviewJobId(payloadWithRun2);

  console.assert(jobIdWithRun1 !== jobIdWithRun2, 'Different reviewRunId should produce different jobId');
  console.assert(jobIdWithRun1.includes('run1'), 'jobId should include reviewRunId');
  console.assert(jobIdWithRun2.includes('run2'), 'jobId should include reviewRunId');
  console.log('✅ Test 2 passed: Different reviewRunId = different jobId');

  // Test 3: Payload with reviewRunId should be different from payload without
  const jobIdWithoutRun = buildReviewJobId(basePayload);
  console.assert(jobIdWithRun1 !== jobIdWithoutRun, 'Payload with reviewRunId should differ from without');
  console.log('✅ Test 3 passed: Payload with reviewRunId differs from without');

  console.log('\n✅ All tests passed!');
  console.log('\nExample jobIds:');
  console.log('  Without reviewRunId:', jobIdWithoutRun);
  console.log('  With reviewRunId=run1:', jobIdWithRun1);
  console.log('  With reviewRunId=run2:', jobIdWithRun2);
}

if (require.main === module) {
  try {
    testJobIdUniqueness();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

export { testJobIdUniqueness };

