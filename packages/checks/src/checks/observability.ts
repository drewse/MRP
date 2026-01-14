/**
 * Observability checks
 */

import type { CheckDefinition, CheckContext } from '../types.js';

function extractAddedLines(changes: CheckContext['changes']) {
  const addedLinesByFile = new Map<string, { lines: string[]; lineNumbers: number[] }>();
  
  for (const change of changes) {
    const addedLines: string[] = [];
    const lineNumbers: number[] = [];
    let currentLine = 0;
    
    for (const line of change.diff.split('\n')) {
      if (line.startsWith('@@')) {
        const match = line.match(/\+(\d+)/);
        if (match) currentLine = parseInt(match[1], 10);
        continue;
      }
      
      if (line.startsWith('+') && !line.startsWith('+++')) {
        addedLines.push(line.substring(1));
        lineNumbers.push(currentLine);
        currentLine++;
      } else if (!line.startsWith('-') && !line.startsWith('\\')) {
        currentLine++;
      }
    }
    
    if (addedLines.length > 0) {
      addedLinesByFile.set(change.path, { lines: addedLines, lineNumbers });
    }
  }
  
  return addedLinesByFile;
}

export const observabilityChecks: CheckDefinition[] = [
  {
    key: 'missing-error-handling',
    title: 'Missing error handling',
    category: 'OBSERVABILITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages proper error handling and logging.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Look for async operations without error handling
          if ((line.includes('await ') || line.includes('.then(')) && 
              !line.includes('catch') && !line.includes('try')) {
            // Check nearby context
            const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)).join(' ');
            if (!context.includes('catch') && !context.includes('try')) {
              issues.push({ file, line: lineNumbers[i] });
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'missing-error-handling',
          title: 'Missing error handling',
          category: 'OBSERVABILITY',
          status: 'WARN',
          details: `Found async operations without error handling:\n${fileList}${more}\n\nAdd try-catch or error callbacks.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'missing-error-handling',
        title: 'Error handling present',
        category: 'OBSERVABILITY',
        status: 'PASS',
        details: 'No missing error handling detected.',
      };
    },
  },
  {
    key: 'missing-logging',
    title: 'Missing logging',
    category: 'OBSERVABILITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages logging for critical operations.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        // Look for critical operations without logging
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hasCriticalOp = line.includes('create') || line.includes('delete') || 
                               line.includes('update') || line.includes('remove') ||
                               line.includes('save') || line.includes('destroy');
          const hasLogging = line.includes('logger') || line.includes('log') || line.includes('console');
          
          if (hasCriticalOp && !hasLogging) {
            // Check nearby context
            const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join(' ');
            if (!context.includes('logger') && !context.includes('log(')) {
              issues.push({ file, line: lineNumbers[i] });
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'missing-logging',
          title: 'Missing logging',
          category: 'OBSERVABILITY',
          status: 'WARN',
          details: `Found critical operations without logging:\n${fileList}${more}\n\nConsider adding logging for observability.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'missing-logging',
        title: 'Logging present',
        category: 'OBSERVABILITY',
        status: 'PASS',
        details: 'No missing logging detected.',
      };
    },
  },
  {
    key: 'unstructured-logging',
    title: 'Unstructured logging',
    category: 'OBSERVABILITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages structured logging for better observability.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Look for console.log with string interpolation instead of structured logging
          if (line.includes('console.log') && line.includes('${') && !line.includes('logger.')) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'unstructured-logging',
          title: 'Unstructured logging',
          category: 'OBSERVABILITY',
          status: 'WARN',
          details: `Found unstructured logging:\n${fileList}${more}\n\nConsider using structured logging (logger.info({ key: value })).`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'unstructured-logging',
        title: 'Structured logging used',
        category: 'OBSERVABILITY',
        status: 'PASS',
        details: 'No unstructured logging detected.',
      };
    },
  },
];

