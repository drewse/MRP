/**
 * Performance checks
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

export const performanceChecks: CheckDefinition[] = [
  {
    key: 'n-plus-one-queries',
    title: 'N+1 query risk',
    category: 'PERFORMANCE',
    defaultSeverity: 'WARN',
    rationale: 'Detects patterns that could lead to N+1 query problems.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        if (!file.match(/\.(ts|tsx)$/)) continue;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Look for loops with database calls
          if ((line.includes('for (') || line.includes('.map(') || line.includes('.forEach(')) && 
              (line.includes('.find') || line.includes('.findUnique') || line.includes('.findFirst'))) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'n-plus-one-queries',
          title: 'Potential N+1 query risk',
          category: 'PERFORMANCE',
          status: 'WARN',
          details: `Found loops with database calls:\n${fileList}${more}\n\nConsider using include/select to batch queries.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'n-plus-one-queries',
        title: 'No N+1 query risks',
        category: 'PERFORMANCE',
        status: 'PASS',
        details: 'No obvious N+1 query patterns detected.',
      };
    },
  },
  {
    key: 'missing-indexes',
    title: 'Missing database indexes',
    category: 'PERFORMANCE',
    defaultSeverity: 'WARN',
    rationale: 'Encourages adding indexes for frequently queried fields.',
    run: (ctx) => {
      const schemaChanges = ctx.changes.filter(c => c.path.includes('schema.prisma'));
      if (schemaChanges.length === 0) {
        return {
          key: 'missing-indexes',
          title: 'No schema changes',
          category: 'PERFORMANCE',
          status: 'PASS',
          details: 'No Prisma schema changes to analyze.',
        };
      }
      
      const issues: string[] = [];
      for (const change of schemaChanges) {
        // Look for @id or @unique but no @@index
        const hasIdOrUnique = change.diff.includes('@id') || change.diff.includes('@unique');
        const hasIndex = change.diff.includes('@@index');
        
        if (hasIdOrUnique && !hasIndex) {
          // Check if it's a foreign key or relation field
          const isRelation = change.diff.includes('@relation');
          if (!isRelation) {
            issues.push(change.path);
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(f => `- \`${f}\``).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'missing-indexes',
          title: 'Potential missing indexes',
          category: 'PERFORMANCE',
          status: 'WARN',
          details: `Schema changes without explicit indexes:\n${fileList}${more}\n\nConsider adding @@index for frequently queried fields.`,
          filePath: issues[0],
        };
      }
      
      return {
        key: 'missing-indexes',
        title: 'Indexes present',
        category: 'PERFORMANCE',
        status: 'PASS',
        details: 'No missing indexes detected.',
      };
    },
  },
  {
    key: 'inefficient-loops',
    title: 'Inefficient loops',
    category: 'PERFORMANCE',
    defaultSeverity: 'WARN',
    rationale: 'Detects nested loops and other inefficient iteration patterns.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        let nestedLoopDepth = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.match(/for\s*\(|\.forEach\s*\(|\.map\s*\(/)) {
            nestedLoopDepth++;
            if (nestedLoopDepth > 2) {
              issues.push({ file, line: lineNumbers[i] });
            }
          } else if (line.includes('}') || line.includes(')')) {
            nestedLoopDepth = Math.max(0, nestedLoopDepth - 1);
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'inefficient-loops',
          title: 'Inefficient loops detected',
          category: 'PERFORMANCE',
          status: 'WARN',
          details: `Found deeply nested loops:\n${fileList}${more}\n\nConsider optimizing or using more efficient algorithms.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'inefficient-loops',
        title: 'Loop efficiency acceptable',
        category: 'PERFORMANCE',
        status: 'PASS',
        details: 'No inefficient loop patterns detected.',
      };
    },
  },
  {
    key: 'large-bundle-size',
    title: 'Large bundle size risk',
    category: 'PERFORMANCE',
    defaultSeverity: 'WARN',
    rationale: 'Detects imports that could significantly increase bundle size.',
    run: (ctx) => {
      const largeImports = ['lodash', 'moment', 'rxjs', '@mui/material', 'antd'];
      const issues: Array<{ file: string; import: string }> = [];
      
      for (const change of ctx.changes) {
        if (!change.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
        
        for (const line of change.diff.split('\n')) {
          if (line.startsWith('+') && line.includes('import ')) {
            for (const largeImport of largeImports) {
              if (line.includes(largeImport) && !line.includes(`from '${largeImport}/`)) {
                issues.push({ file: change.path, import: largeImport });
                break;
              }
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\`: ${i.import}`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'large-bundle-size',
          title: 'Large bundle size risk',
          category: 'PERFORMANCE',
          status: 'WARN',
          details: `Found full library imports:\n${fileList}${more}\n\nConsider using tree-shakeable imports (e.g., 'lodash/function' instead of 'lodash').`,
          filePath: issues[0].file,
        };
      }
      
      return {
        key: 'large-bundle-size',
        title: 'Bundle size acceptable',
        category: 'PERFORMANCE',
        status: 'PASS',
        details: 'No large bundle size risks detected.',
      };
    },
  },
];

