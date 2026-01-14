/**
 * Types for deterministic code review checks
 */

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

export type CheckCategory = 
  | 'SECURITY'
  | 'CODE_QUALITY'
  | 'ARCHITECTURE'
  | 'PERFORMANCE'
  | 'TESTING'
  | 'OBSERVABILITY'
  | 'REPO_HYGIENE';

export interface Change {
  path: string;
  diff: string;
}

export interface CheckContext {
  changes: Change[];
  mr?: {
    title?: string;
    description?: string;
  };
}

export interface CheckDefinition {
  key: string;
  title: string;
  category: CheckCategory;
  defaultSeverity: CheckStatus;
  rationale: string;
  run: (ctx: CheckContext, thresholds?: Record<string, unknown>) => CheckResult;
}

export interface CheckResult {
  key: string;
  title: string;
  category: CheckCategory;
  status: CheckStatus;
  details: string;
  filePath?: string;
  lineHint?: number;
}

export interface CheckConfig {
  checkKey: string;
  enabled: boolean;
  severityOverride?: CheckStatus;
  thresholds?: Record<string, unknown>;
}

export interface CategoryWeights {
  SECURITY: number;
  CODE_QUALITY: number;
  ARCHITECTURE: number;
  PERFORMANCE: number;
  TESTING: number;
  OBSERVABILITY: number;
  REPO_HYGIENE: number;
}

export const DEFAULT_CATEGORY_WEIGHTS: CategoryWeights = {
  SECURITY: 20,
  CODE_QUALITY: 15,
  ARCHITECTURE: 15,
  PERFORMANCE: 10,
  TESTING: 15,
  OBSERVABILITY: 10,
  REPO_HYGIENE: 5,
};

