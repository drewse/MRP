/**
 * Snippet selection for AI processing
 * 
 * Extracts minimal code snippets around failing checks
 */

import pino from 'pino';
import { redactText, shouldProcessFile } from './redaction.js';

// Create logger for snippet selection
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Local Change type to avoid dependency on @mrp/checks
export interface Change {
  path: string;
  diff: string;
}

export interface CodeSnippet {
  path: string;
  content: string;
  lineStart: number;
  lineEnd: number;
  redacted: boolean;
}

export interface SnippetSelectionResult {
  snippets: CodeSnippet[];
  totalChars: number;
  redactionReport: {
    filesRedacted: number;
    totalLinesRemoved: number;
    patternsMatched: string[];
  };
  skippedFiles?: Array<{
    filePath: string;
    reason: 'denylisted' | 'binary' | 'too_large' | 'no_diff_hunks' | 'not_in_allowlist' | 'parse_failed';
    diffHunksCount?: number;
  }>;
}

/**
 * Extract code snippet around a specific line
 */
function extractSnippetAroundLine(
  diff: string,
  targetLine: number,
  contextLines: number = 10
): { content: string; lineStart: number; lineEnd: number } | null {
  const lines = diff.split('\n');
  let currentLine = 0;
  let snippetStart = -1;
  let snippetEnd = -1;
  
  // Find the target line in the diff
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip diff headers
    if (line.startsWith('@@')) {
      // Extract line number from diff header: @@ -start,count +start,count @@
      const match = line.match(/\+(\d+)/);
      if (match) {
        currentLine = Number.parseInt(match[1], 10);
      }
      continue;
    }
    
    // Count added/modified lines
    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentLine++;
      
      if (currentLine === targetLine) {
        snippetStart = Math.max(0, i - contextLines);
        snippetEnd = Math.min(lines.length, i + contextLines + 1);
        break;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Modified lines (removed)
      // Don't increment currentLine for removed lines
    } else if (!line.startsWith('\\')) {
      // Context lines (unchanged)
      currentLine++;
    }
  }
  
  if (snippetStart === -1) {
    return null;
  }
  
  const snippetLines = lines.slice(snippetStart, snippetEnd);
  const content = snippetLines.join('\n');
  
  // Calculate actual line numbers
  const lineStart = Math.max(1, targetLine - contextLines);
  const lineEnd = targetLine + contextLines;
  
  return { content, lineStart, lineEnd };
}

/**
 * Select minimal code snippets for failing checks
 */
export function selectSnippets(
  changes: Change[],
  failingResults: Array<{
    checkKey: string;
    filePath?: string;
    lineHint?: number;
    evidence?: string;
  }>,
  maxTotalChars: number = 6000,
  maxLinesPerFile: number = 40
): SnippetSelectionResult {
  const snippets: CodeSnippet[] = [];
  let totalChars = 0;
  const redactionReports: Array<{ linesRemoved: number; patternsMatched: string[] }> = [];
  const skippedFiles: Array<{
    filePath: string;
    reason: 'denylisted' | 'binary' | 'too_large' | 'no_diff_hunks' | 'not_in_allowlist' | 'parse_failed';
    diffHunksCount?: number;
  }> = [];
  const isDebug = logger.level === 'debug' || process.env.LOG_LEVEL === 'debug';
  
  // Group failing results by file
  const byFile = new Map<string, Array<{ checkKey: string; lineHint?: number; evidence?: string }>>();
  
  for (const result of failingResults) {
    if (!result.filePath) continue;
    
    // Check if file should be processed
    if (!shouldProcessFile(result.filePath)) {
      // Determine skip reason
      const path = result.filePath.toLowerCase();
      let reason: 'denylisted' | 'not_in_allowlist' = 'not_in_allowlist';
      
      // Check if it's explicitly denylisted
      const denylistPatterns = [
        '.env', '.pem', '.key', '.p12', '.pfx',
        'secrets/', 'credentials/', 'id_rsa', '.ssh/',
        'node_modules/', 'dist/', 'build/', 'coverage/',
      ];
      
      for (const pattern of denylistPatterns) {
        if (path.includes(pattern) || path.endsWith(pattern.replace('*', ''))) {
          reason = 'denylisted';
          break;
        }
      }
      
      if (isDebug) {
        logger.debug({
          event: 'snippet.selection.skip',
          filePath: result.filePath,
          reason,
        }, `Skipping file: ${reason}`);
      }
      
      skippedFiles.push({ filePath: result.filePath, reason });
      continue;
    }
    
    if (!byFile.has(result.filePath)) {
      byFile.set(result.filePath, []);
    }
    byFile.get(result.filePath)!.push({
      checkKey: result.checkKey,
      lineHint: result.lineHint,
      evidence: result.evidence,
    });
  }
  
  // Find corresponding change for each file
  const changeMap = new Map<string, Change>();
  for (const change of changes) {
    changeMap.set(change.path, change);
  }
  
  // Extract snippets for each file
  for (const [filePath, results] of byFile) {
    const change = changeMap.get(filePath);
    if (!change) {
      if (isDebug) {
        logger.debug({
          event: 'snippet.selection.skip',
          filePath,
          reason: 'no_diff_hunks',
        }, 'Skipping file: no change found');
      }
      skippedFiles.push({ filePath, reason: 'no_diff_hunks' });
      continue;
    }
    
    if (!change.diff || change.diff.trim().length === 0) {
      if (isDebug) {
        logger.debug({
          event: 'snippet.selection.skip',
          filePath,
          reason: 'no_diff_hunks',
        }, 'Skipping file: empty diff');
      }
      skippedFiles.push({ filePath, reason: 'no_diff_hunks' });
      continue;
    }
    
    // Count diff hunks
    const diffHunksCount = (change.diff.match(/^@@/gm) || []).length;
    
    // Check if file is too large
    if (change.diff.length > 100000) { // 100KB limit
      if (isDebug) {
        logger.debug({
          event: 'snippet.selection.skip',
          filePath,
          reason: 'too_large',
          diffHunksCount,
        }, 'Skipping file: too large');
      }
      skippedFiles.push({ filePath, reason: 'too_large', diffHunksCount });
      continue;
    }
    
    // Extract snippets for each failing check in this file
    for (const result of results) {
      if (totalChars >= maxTotalChars) break;
      
      let snippet: { content: string; lineStart: number; lineEnd: number } | null = null;
      
      if (result.lineHint) {
        // Extract around specific line
        snippet = extractSnippetAroundLine(change.diff, result.lineHint, 10);
      } else {
        // Extract first 40 lines of added content
        const lines = change.diff.split('\n');
        const addedLines: string[] = [];
        let lineCount = 0;
        
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            addedLines.push(line);
            lineCount++;
            if (lineCount >= maxLinesPerFile) break;
          }
        }
        
        if (addedLines.length > 0) {
          snippet = {
            content: addedLines.join('\n'),
            lineStart: 1,
            lineEnd: addedLines.length,
          };
        }
      }
      
      if (!snippet) continue;
      
      // Check if snippet would exceed limits
      const snippetChars = snippet.content.length;
      if (totalChars + snippetChars > maxTotalChars) {
        // Truncate if needed
        const remainingChars = maxTotalChars - totalChars;
        snippet.content = snippet.content.substring(0, remainingChars);
      }
      
      // Redact snippet
      const { redactedText, report } = redactText(snippet.content);
      redactionReports.push(report);
      
      snippets.push({
        path: filePath,
        content: redactedText,
        lineStart: snippet.lineStart,
        lineEnd: snippet.lineEnd,
        redacted: report.linesRemoved > 0 || report.patternsMatched.length > 0,
      });
      
      totalChars += redactedText.length;
      
      if (totalChars >= maxTotalChars) break;
    }
    
    if (totalChars >= maxTotalChars) break;
  }
  
  // Aggregate redaction report
  const totalLinesRemoved = redactionReports.reduce((sum, r) => sum + r.linesRemoved, 0);
  const allPatterns = new Set<string>();
  for (const report of redactionReports) {
    for (const pattern of report.patternsMatched) {
      allPatterns.add(pattern);
    }
  }
  
  const filesRedacted = snippets.filter(s => s.redacted).length;
  
  const result: SnippetSelectionResult = {
    snippets,
    totalChars,
    redactionReport: {
      filesRedacted,
      totalLinesRemoved,
      patternsMatched: Array.from(allPatterns),
    },
  };
  
  // Include skipped files in debug mode
  if (isDebug && skippedFiles.length > 0) {
    result.skippedFiles = skippedFiles;
  }
  
  return result;
}

