/**
 * Feature fingerprinting for deterministic matching of MRs
 * 
 * Extracts tokens from MR changes, title, and description to create
 * a feature signature that can be used to match similar MRs.
 */

import { createHash } from 'crypto';
import type { Change } from '@mrp/checks';

/**
 * Common stopwords to filter out
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'up', 'about', 'into', 'through', 'during', 'including', 'until', 'against',
  'among', 'throughout', 'despite', 'towards', 'upon', 'concerning', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'can', 'cannot', 'shall', 'ought',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'what', 'which', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now',
]);

/**
 * Extract tokens from text
 */
function extractTokens(text: string): string[] {
  // Normalize: lowercase, split on non-alphanumeric, filter empty
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 2) // Minimum 3 chars
    .filter(token => !STOPWORDS.has(token))
    .filter(token => !/^\d+$/.test(token)); // Filter pure numbers
}

/**
 * Extract tokens from file path
 */
function extractPathTokens(path: string): string[] {
  // Split path into components and extract meaningful tokens
  const parts = path.split(/[/\\]/);
  const tokens: string[] = [];
  
  for (const part of parts) {
    // Remove extension
    const nameWithoutExt = part.replace(/\.[^.]+$/, '');
    // Split camelCase, snake_case, kebab-case
    const subTokens = nameWithoutExt
      .split(/[-_]/)
      .flatMap(t => t.split(/(?=[A-Z])/))
      .map(t => t.toLowerCase())
      .filter(t => t.length > 2 && !STOPWORDS.has(t));
    tokens.push(...subTokens);
  }
  
  return tokens;
}

/**
 * Extract tokens from diff (added lines only)
 */
function extractDiffTokens(diff: string): string[] {
  const tokens: string[] = [];
  const lines = diff.split('\n');
  
  for (const line of lines) {
    // Only process added lines (start with +)
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const content = line.substring(1).trim();
      // Skip very short lines and pure whitespace
      if (content.length < 3) continue;
      // Extract tokens from the line
      tokens.push(...extractTokens(content));
    }
  }
  
  return tokens;
}

/**
 * Compute feature signature from MR data
 */
export interface FeatureSignature {
  tokens: string[];
  hash: string;
}

export interface FeatureSignatureInput {
  title?: string;
  description?: string;
  changes: Change[];
}

/**
 * Compute feature signature from MR changes, title, and description
 */
export function computeFeatureSignature(input: FeatureSignatureInput): FeatureSignature {
  const allTokens: string[] = [];
  
  // Extract from title
  if (input.title) {
    allTokens.push(...extractTokens(input.title));
  }
  
  // Extract from description
  if (input.description) {
    allTokens.push(...extractTokens(input.description));
  }
  
  // Extract from file paths
  for (const change of input.changes) {
    allTokens.push(...extractPathTokens(change.path));
  }
  
  // Extract from diffs (added lines only)
  for (const change of input.changes) {
    allTokens.push(...extractDiffTokens(change.diff));
  }
  
  // Count token frequencies
  const tokenCounts = new Map<string, number>();
  for (const token of allTokens) {
    tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }
  
  // Sort by frequency and take top 30
  const sortedTokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1]) // Descending by frequency
    .slice(0, 30)
    .map(([token]) => token)
    .sort(); // Alphabetical for consistency
  
  // Compute hash
  const hash = createHash('sha256')
    .update(sortedTokens.join('|'), 'utf8')
    .digest('hex');
  
  return {
    tokens: sortedTokens,
    hash,
  };
}

/**
 * Calculate Jaccard similarity between two token sets
 */
export function jaccardSimilarity(tokens1: string[], tokens2: string[]): number {
  if (tokens1.length === 0 && tokens2.length === 0) return 1.0;
  if (tokens1.length === 0 || tokens2.length === 0) return 0.0;
  
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Calculate overlap count between two token sets
 */
export function overlapCount(tokens1: string[], tokens2: string[]): number {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  return [...set1].filter(x => set2.has(x)).length;
}

