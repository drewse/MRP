/**
 * Deterministic code review checks
 * 
 * Main entry point for running checks with tenant configuration support.
 */

export * from './types.js';
export * from './registry.js';

import type { CheckContext, CheckResult, CheckConfig, CategoryWeights } from './types.js';
import { DEFAULT_CATEGORY_WEIGHTS } from './types.js';
import { ALL_CHECKS } from './registry.js';

/**
 * Run checks with tenant configuration
 */
export function runChecks(
  ctx: CheckContext,
  tenantConfigs?: CheckConfig[]
): CheckResult[] {
  const results: CheckResult[] = [];
  const configMap = new Map<string, CheckConfig>();
  
  // Build config map for quick lookup
  if (tenantConfigs) {
    for (const config of tenantConfigs) {
      configMap.set(config.checkKey, config);
    }
  }
  
  // Run each check
  for (const checkDef of ALL_CHECKS) {
    const config = configMap.get(checkDef.key);
    
    // Skip if disabled
    if (config && !config.enabled) {
      continue;
    }
    
    // Run the check
    const result = checkDef.run(ctx, config?.thresholds);
    
    // Apply severity override if configured
    if (config?.severityOverride) {
      result.status = config.severityOverride;
    }
    
    results.push(result);
  }
  
  return results;
}

/**
 * Calculate score from check results with category weights
 */
export function calculateScore(
  results: CheckResult[],
  categoryWeights: CategoryWeights = DEFAULT_CATEGORY_WEIGHTS
): number {
  if (results.length === 0) return 100;
  
  // Group by category
  const byCategory = new Map<string, CheckResult[]>();
  for (const result of results) {
    if (!byCategory.has(result.category)) {
      byCategory.set(result.category, []);
    }
    byCategory.get(result.category)!.push(result);
  }
  
  // Calculate weighted score per category
  let totalWeightedScore = 0;
  let totalWeight = 0;
  
  for (const [category, categoryResults] of byCategory) {
    const weight = categoryWeights[category as keyof CategoryWeights] || 10;
    const passCount = categoryResults.filter(r => r.status === 'PASS').length;
    const warnCount = categoryResults.filter(r => r.status === 'WARN').length;
    const failCount = categoryResults.filter(r => r.status === 'FAIL').length;
    
    // Score: PASS=10, WARN=5, FAIL=0
    const categoryScore = (passCount * 10 + warnCount * 5 + failCount * 0) / categoryResults.length;
    const weightedScore = categoryScore * weight;
    
    totalWeightedScore += weightedScore;
    totalWeight += weight;
  }
  
  // Normalize to 0-100
  const normalizedScore = totalWeight > 0 
    ? Math.round((totalWeightedScore / totalWeight) * 10)
    : 100;
  
  return Math.max(0, Math.min(100, normalizedScore));
}

/**
 * Format check results for GitLab comment
 */
export function formatCheckResultsForComment(results: CheckResult[]): string {
  // Group by category
  const byCategory = new Map<string, CheckResult[]>();
  for (const result of results) {
    if (!byCategory.has(result.category)) {
      byCategory.set(result.category, []);
    }
    byCategory.get(result.category)!.push(result);
  }
  
  const categoryOrder = ['SECURITY', 'CODE_QUALITY', 'ARCHITECTURE', 'PERFORMANCE', 'TESTING', 'OBSERVABILITY', 'REPO_HYGIENE'];
  const categoryNames: Record<string, string> = {
    SECURITY: '🔒 Security',
    CODE_QUALITY: '✨ Code Quality',
    ARCHITECTURE: '🏗️ Architecture',
    PERFORMANCE: '⚡ Performance',
    TESTING: '🧪 Testing',
    OBSERVABILITY: '📊 Observability',
    REPO_HYGIENE: '🧹 Repo Hygiene',
  };
  
  const sections: string[] = [];
  
  for (const category of categoryOrder) {
    const categoryResults = byCategory.get(category);
    if (!categoryResults || categoryResults.length === 0) continue;
    
    const passCount = categoryResults.filter(r => r.status === 'PASS').length;
    const warnCount = categoryResults.filter(r => r.status === 'WARN').length;
    const failCount = categoryResults.filter(r => r.status === 'FAIL').length;
    
    const categoryHeader = `### ${categoryNames[category]} (${passCount} ✅ / ${warnCount} ⚠️ / ${failCount} ❌)`;
    const items: string[] = [];
    
    for (const result of categoryResults) {
      const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
      const statusLabel = `[${result.status}]`;
      let item = `- ${icon} ${statusLabel} ${result.title}`;
      
      if (result.status !== 'PASS') {
        // Include top 1-2 bullets from details
        const lines = result.details.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 2);
        if (lines.length > 0) {
          item += '\n  ' + lines.join('\n  ');
        }
      }
      
      items.push(item);
    }
    
    sections.push(`${categoryHeader}\n${items.join('\n')}`);
  }
  
  return sections.join('\n\n');
}
