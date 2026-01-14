/**
 * Types for LLM suggestions
 */

export interface AiSuggestion {
  checkKey: string;
  title: string;
  severity: 'WARN' | 'FAIL';
  files: Array<{ path: string; lineStart?: number; lineEnd?: number }>;
  rationale: string;
  suggestedFix: string | string[]; // Can be string or array (normalized to string in worker)
  precedentRefs?: Array<{
    knowledgeSourceId: string;
    title: string;
    sourceUrl: string;
  }>;
}

export interface GenerateSuggestionsInput {
  checkResults: Array<{
    checkKey: string;
    category: string;
    status: string;
    title: string;
    evidence?: string;
    filePath?: string;
    lineHint?: number;
  }>;
  precedents?: Array<{
    id: string;
    title: string;
    sourceUrl: string | null;
    matchedTokens: string[];
  }>;
  mrContext: {
    title: string;
    description?: string;
    projectId: string;
    mrIid: number;
    headSha: string;
  };
  snippets: Array<{
    path: string;
    content: string;
    lineStart: number;
    lineEnd: number;
  }>;
  redactionReport: {
    filesRedacted: number;
    totalLinesRemoved: number;
    patternsMatched: string[];
  };
}

export interface GenerateSuggestionsOutput {
  suggestions: AiSuggestion[];
}

export interface LlmClientConfig {
  provider: 'OPENAI';
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface LlmClient {
  generateSuggestions(input: GenerateSuggestionsInput): Promise<GenerateSuggestionsOutput>;
}

