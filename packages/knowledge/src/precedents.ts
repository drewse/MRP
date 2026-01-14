/**
 * GOLD precedent lookup and matching
 */

import { prisma } from '@mrp/db';
import { jaccardSimilarity, overlapCount, type FeatureSignature } from './features.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface GoldPrecedent {
  id: string;
  title: string;
  sourceUrl: string | null;
  score: number;
  mergedAt: string | null;
  featureSignature: string[];
  matchedTokens: string[];
  similarity: number;
  overlap: number;
}

export interface PrecedentMatchResult {
  matches: GoldPrecedent[];
  totalFound: number;
}

/**
 * Find matching GOLD precedents for a feature signature
 */
export async function findGoldPrecedents(
  tenantId: string,
  currentSignature: FeatureSignature
): Promise<PrecedentMatchResult> {
  const minOverlap = Number.parseInt(process.env.GOLD_MIN_OVERLAP || '5', 10);
  const maxReferences = Number.parseInt(process.env.GOLD_MAX_REFERENCES || '3', 10);
  
  logger.info(
    {
      event: 'knowledge.gold.match.start',
      tenantId,
      tokensCount: currentSignature.tokens.length,
      topTokens: currentSignature.tokens.slice(0, 5),
    },
    'Looking up GOLD precedents'
  );
  
  // Fetch all GOLD MRs for this tenant
  const goldSources = await prisma.knowledgeSource.findMany({
    where: {
      tenantId,
      type: 'GOLD_MR',
      provider: 'GITLAB',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  
  if (goldSources.length === 0) {
    logger.info(
      {
        event: 'knowledge.gold.match.success',
        tenantId,
        matchesCount: 0,
        totalFound: 0,
      },
      'No GOLD precedents found'
    );
    return { matches: [], totalFound: 0 };
  }
  
  // Compute similarity for each GOLD MR
  const candidates: Array<GoldPrecedent & { jaccard: number }> = [];
  
  for (const source of goldSources) {
    const metadata = source.metadata as {
      featureSignature?: string[];
      score?: number;
      mergedAt?: string;
    } | null;
    
    if (!metadata?.featureSignature || !Array.isArray(metadata.featureSignature)) {
      continue; // Skip if no feature signature
    }
    
    const precedentSignature = metadata.featureSignature;
    const overlap = overlapCount(currentSignature.tokens, precedentSignature);
    const jaccard = jaccardSimilarity(currentSignature.tokens, precedentSignature);
    
    // Match if overlap >= minOverlap OR jaccard >= 0.15
    if (overlap >= minOverlap || jaccard >= 0.15) {
      // Find matched tokens
      const currentSet = new Set(currentSignature.tokens);
      const matchedTokens = precedentSignature.filter(t => currentSet.has(t));
      
      candidates.push({
        id: source.id,
        title: source.title,
        sourceUrl: source.sourceUrl,
        score: metadata.score || 0,
        mergedAt: metadata.mergedAt || null,
        featureSignature: precedentSignature,
        matchedTokens,
        similarity: jaccard,
        overlap,
        jaccard,
      });
    }
  }
  
  // Sort by: similarity desc, then score desc, then recency (mergedAt desc)
  candidates.sort((a, b) => {
    // First by similarity
    if (Math.abs(a.jaccard - b.jaccard) > 0.001) {
      return b.jaccard - a.jaccard;
    }
    // Then by score
    if (a.score !== b.score) {
      return b.score - a.score;
    }
    // Then by recency
    if (a.mergedAt && b.mergedAt) {
      return b.mergedAt.localeCompare(a.mergedAt);
    }
    if (a.mergedAt) return -1;
    if (b.mergedAt) return 1;
    return 0;
  });
  
  // Take top N
  const matches = candidates.slice(0, maxReferences).map(c => ({
    id: c.id,
    title: c.title,
    sourceUrl: c.sourceUrl,
    score: c.score,
    mergedAt: c.mergedAt,
    featureSignature: c.featureSignature,
    matchedTokens: c.matchedTokens,
    similarity: c.similarity,
    overlap: c.overlap,
  }));
  
  logger.info(
    {
      event: 'knowledge.gold.match.success',
      tenantId,
      matchesCount: matches.length,
      totalFound: candidates.length,
      topSimilarity: matches[0]?.similarity || 0,
    },
    'GOLD precedents matched'
  );
  
  return {
    matches,
    totalFound: candidates.length,
  };
}

/**
 * Format precedent references for GitLab comment
 */
export function formatPrecedentReferences(precedents: GoldPrecedent[]): string {
  if (precedents.length === 0) {
    return '';
  }
  
  const lines: string[] = [];
  lines.push('## 📚 Similar GOLD MRs Found');
  lines.push('');
  
  for (let i = 0; i < precedents.length; i++) {
    const p = precedents[i];
    const matchedTokensDisplay = p.matchedTokens.slice(0, 8).join(', ');
    const moreTokens = p.matchedTokens.length > 8 ? ` (+${p.matchedTokens.length - 8} more)` : '';
    
    lines.push(`### ${i + 1}. [${p.title}](${p.sourceUrl || '#'})`);
    lines.push(`- **Score:** ${p.score}/100`);
    lines.push(`- **Merged:** ${p.mergedAt ? new Date(p.mergedAt).toLocaleDateString() : 'Unknown'}`);
    lines.push(`- **Similarity:** ${(p.similarity * 100).toFixed(1)}% (${p.overlap} tokens overlap)`);
    lines.push(`- **Matched tokens:** ${matchedTokensDisplay}${moreTokens}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

