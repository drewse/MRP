/**
 * Check registry - all available checks
 */

import type { CheckDefinition } from './types.js';
import { securityChecks } from './checks/security.js';
import { codeQualityChecks } from './checks/code-quality.js';
import { architectureChecks } from './checks/architecture.js';
import { performanceChecks } from './checks/performance.js';
import { testingChecks } from './checks/testing.js';
import { observabilityChecks } from './checks/observability.js';
import { repoHygieneChecks } from './checks/repo-hygiene.js';

/**
 * All available check definitions
 */
export const ALL_CHECKS: CheckDefinition[] = [
  ...securityChecks,
  ...codeQualityChecks,
  ...architectureChecks,
  ...performanceChecks,
  ...testingChecks,
  ...observabilityChecks,
  ...repoHygieneChecks,
];

/**
 * Get check definition by key
 */
export function getCheckDefinition(key: string): CheckDefinition | undefined {
  return ALL_CHECKS.find(check => check.key === key);
}

/**
 * Get checks by category
 */
export function getChecksByCategory(category: string): CheckDefinition[] {
  return ALL_CHECKS.filter(check => check.category === category);
}

