/**
 * Code quality checks
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

export const codeQualityChecks: CheckDefinition[] = [
  {
    key: 'todo-fixme',
    title: 'TODO/FIXME comments',
    category: 'CODE_QUALITY',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents leaving temporary comments that should be addressed.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toUpperCase();
          if (line.includes('TODO') || line.includes('FIXME') || line.includes('HACK')) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'todo-fixme',
          title: 'TODO/FIXME comments found',
          category: 'CODE_QUALITY',
          status: 'FAIL',
          details: `Found TODO/FIXME comments:\n${fileList}${more}`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'todo-fixme',
        title: 'No TODO/FIXME comments',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No TODO/FIXME comments found.',
      };
    },
  },
  {
    key: 'debug-logging',
    title: 'Debug logging',
    category: 'CODE_QUALITY',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents committing debug statements that should be removed.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number; type: string }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('console.log') || line.includes('console.debug') || line.includes('console.info')) {
            issues.push({ file, line: lineNumbers[i], type: 'console' });
          } else if (line.includes('debugger')) {
            issues.push({ file, line: lineNumbers[i], type: 'debugger' });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line}): ${i.type}`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'debug-logging',
          title: 'Debug logging found',
          category: 'CODE_QUALITY',
          status: 'FAIL',
          details: `Found debug logging:\n${fileList}${more}`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'debug-logging',
        title: 'No debug logging',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No console.log, console.debug, or debugger statements found.',
      };
    },
  },
  {
    key: 'any-types',
    title: 'Any types in TypeScript',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages type safety by avoiding any types.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        if (!file.match(/\.(ts|tsx)$/)) continue;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes(': any') || line.includes('as any') || line.includes('<any>')) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'any-types',
          title: 'Any types found',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found \`any\` types:\n${fileList}${more}\n\nConsider using more specific types.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'any-types',
        title: 'No any types',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No `any` types found.',
      };
    },
  },
  {
    key: 'missing-try-catch',
    title: 'Missing try-catch for async calls',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages proper error handling for async operations.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.includes('fetch(') || line.includes('axios.') || line.includes('.then(')) {
            // Simple heuristic: check if there's a try block nearby (within 20 lines before)
            const change = ctx.changes.find(c => c.path === file);
            if (change) {
              const diffLines = change.diff.split('\n');
              let foundTry = false;
              let targetLineIdx = -1;
              let currentLine = 0;
              
              for (let j = 0; j < diffLines.length; j++) {
                if (diffLines[j].startsWith('@@')) {
                  const match = diffLines[j].match(/\+(\d+)/);
                  if (match) currentLine = parseInt(match[1], 10);
                }
                if (diffLines[j] === `+${lines[i]}`) {
                  targetLineIdx = j;
                  break;
                }
                if (!diffLines[j].startsWith('-') && !diffLines[j].startsWith('\\')) {
                  currentLine++;
                }
              }
              
              if (targetLineIdx >= 0) {
                for (let j = Math.max(0, targetLineIdx - 20); j < targetLineIdx; j++) {
                  if (diffLines[j].startsWith('+') && diffLines[j].includes('try')) {
                    foundTry = true;
                    break;
                  }
                }
              }
              
              if (!foundTry) {
                issues.push({ file, line: lineNumbers[i] });
              }
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'missing-try-catch',
          title: 'Missing try-catch for async calls',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found async calls without try-catch:\n${fileList}${more}\n\nConsider adding error handling.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'missing-try-catch',
        title: 'Error handling present',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No obvious missing try-catch blocks.',
      };
    },
  },
  {
    key: 'long-functions',
    title: 'Long functions',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages smaller, more maintainable functions.',
    run: (ctx, thresholds) => {
      const maxLines = (thresholds?.maxLines as number) || 100;
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number; length: number }> = [];
      
      for (const [file, { lines }] of addedLinesByFile) {
        // Simple heuristic: count consecutive added lines as function length
        let currentLength = 0;
        let startLine = 0;
        
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().length > 0 && !lines[i].trim().startsWith('//')) {
            currentLength++;
            if (currentLength === 1) startLine = i;
          } else {
            if (currentLength > maxLines) {
              issues.push({ file, line: startLine, length: currentLength });
            }
            currentLength = 0;
          }
        }
        
        if (currentLength > maxLines) {
          issues.push({ file, line: startLine, length: currentLength });
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line}): ${i.length} lines`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'long-functions',
          title: 'Long functions detected',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found functions exceeding ${maxLines} lines:\n${fileList}${more}\n\nConsider breaking into smaller functions.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'long-functions',
        title: 'Function length reasonable',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: `No functions exceed ${maxLines} lines.`,
      };
    },
  },
  {
    key: 'complex-conditionals',
    title: 'Complex conditionals',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Detects overly complex if/while conditions that reduce readability.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.match(/if\s*\([^)]{100,}\)/)) {
            // Condition longer than 100 chars
            issues.push({ file, line: lineNumbers[i] });
          } else if ((line.match(/&&/g) || []).length > 3 || (line.match(/\|\|/g) || []).length > 3) {
            // More than 3 && or || operators
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'complex-conditionals',
          title: 'Complex conditionals found',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found complex conditionals:\n${fileList}${more}\n\nConsider extracting to variables or functions.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'complex-conditionals',
        title: 'Conditionals are readable',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No overly complex conditionals detected.',
      };
    },
  },
  {
    key: 'magic-numbers',
    title: 'Magic numbers',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Encourages using named constants instead of magic numbers.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const magicNumberPattern = /\b([0-9]{3,}|[0-9]+\.[0-9]+)\b/;
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip common patterns (dates, versions, etc.)
          if (line.match(/^\s*\/\/|\/\*|import|export|require|from/)) continue;
          if (line.match(/version|date|timestamp|port|timeout/i)) continue;
          
          if (magicNumberPattern.test(line)) {
            // Check if it's a common number (0, 1, 100, etc.)
            const matches = line.match(/\b([0-9]{3,}|[0-9]+\.[0-9]+)\b/g);
            if (matches && matches.some(m => parseInt(m) > 100 || parseFloat(m) !== parseInt(m))) {
              issues.push({ file, line: lineNumbers[i] });
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'magic-numbers',
          title: 'Magic numbers found',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found magic numbers:\n${fileList}${more}\n\nConsider using named constants.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'magic-numbers',
        title: 'No magic numbers',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No obvious magic numbers detected.',
      };
    },
  },
  {
    key: 'duplicate-code',
    title: 'Duplicate code',
    category: 'CODE_QUALITY',
    defaultSeverity: 'WARN',
    rationale: 'Detects potential code duplication that could be extracted.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const codeBlocks = new Map<string, Array<{ file: string; line: number }>>();
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        // Look for blocks of 5+ identical lines
        for (let i = 0; i < lines.length - 4; i++) {
          const block = lines.slice(i, i + 5).join('\n');
          const normalized = block.trim().toLowerCase();
          
          if (!codeBlocks.has(normalized)) {
            codeBlocks.set(normalized, []);
          }
          codeBlocks.get(normalized)!.push({ file, line: lineNumbers[i] });
        }
      }
      
      const duplicates = Array.from(codeBlocks.entries())
        .filter(([_, locations]) => locations.length > 1)
        .slice(0, 5);
      
      if (duplicates.length > 0) {
        const fileList = duplicates.map(([_, locations]) => 
          `- ${locations.map(l => `\`${l.file}\` (line ${l.line})`).join(', ')}`
        ).join('\n');
        
        return {
          key: 'duplicate-code',
          title: 'Duplicate code detected',
          category: 'CODE_QUALITY',
          status: 'WARN',
          details: `Found duplicate code blocks:\n${fileList}\n\nConsider extracting to a shared function.`,
          filePath: duplicates[0][1][0].file,
          lineHint: duplicates[0][1][0].line,
        };
      }
      
      return {
        key: 'duplicate-code',
        title: 'No duplicate code',
        category: 'CODE_QUALITY',
        status: 'PASS',
        details: 'No obvious code duplication detected.',
      };
    },
  },
];

