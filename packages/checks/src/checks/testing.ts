/**
 * Testing checks
 */

import type { CheckDefinition } from '../types.js';

export const testingChecks: CheckDefinition[] = [
  {
    key: 'test-coverage-heuristic',
    title: 'Test coverage',
    category: 'TESTING',
    defaultSeverity: 'WARN',
    rationale: 'Encourages adding tests alongside code changes.',
    run: (ctx) => {
      const codeFiles = ctx.changes.filter(c => {
        const path = c.path;
        return (path.startsWith('apps/') || path.startsWith('packages/')) &&
               !path.includes('.test.') && !path.includes('__tests__') && !path.includes('.spec.') &&
               path.match(/\.(ts|tsx|js|jsx)$/);
      });
      
      const testFiles = ctx.changes.filter(c => {
        const path = c.path;
        return path.includes('.test.') || path.includes('__tests__') || path.includes('.spec.');
      });
      
      if (codeFiles.length > 0 && testFiles.length === 0) {
        const fileList = codeFiles.slice(0, 5).map(c => `- \`${c.path}\``).join('\n');
        const more = codeFiles.length > 5 ? `\n- ... and ${codeFiles.length - 5} more` : '';
        return {
          key: 'test-coverage-heuristic',
          title: 'No test files changed',
          category: 'TESTING',
          status: 'WARN',
          details: `Code files changed but no test files detected:\n${fileList}${more}\n\nConsider adding or updating tests.`,
          filePath: codeFiles[0].path,
        };
      }
      
      return {
        key: 'test-coverage-heuristic',
        title: 'Test coverage present',
        category: 'TESTING',
        status: 'PASS',
        details: codeFiles.length === 0 ? 'No code files changed.' : 'Test files included with code changes.',
      };
    },
  },
  {
    key: 'missing-test-descriptions',
    title: 'Missing test descriptions',
    category: 'TESTING',
    defaultSeverity: 'WARN',
    rationale: 'Encourages descriptive test names for better maintainability.',
    run: (ctx) => {
      const testFiles = ctx.changes.filter(c => 
        c.path.includes('.test.') || c.path.includes('__tests__') || c.path.includes('.spec.')
      );
      
      if (testFiles.length === 0) {
        return {
          key: 'missing-test-descriptions',
          title: 'No test files changed',
          category: 'TESTING',
          status: 'PASS',
          details: 'No test files to analyze.',
        };
      }
      
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const testFile of testFiles) {
        const lines = testFile.diff.split('\n');
        let currentLine = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            // Look for test/it/describe without description
            if (line.match(/^\s*(test|it|describe)\s*\(['"]\s*['"]/)) {
              issues.push({ file: testFile.path, line: currentLine });
            }
            currentLine++;
          } else if (!line.startsWith('-') && !line.startsWith('\\')) {
            currentLine++;
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'missing-test-descriptions',
          title: 'Missing test descriptions',
          category: 'TESTING',
          status: 'WARN',
          details: `Found tests without descriptions:\n${fileList}${more}\n\nAdd descriptive test names.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'missing-test-descriptions',
        title: 'Test descriptions present',
        category: 'TESTING',
        status: 'PASS',
        details: 'All tests have descriptions.',
      };
    },
  },
  {
    key: 'async-tests-without-await',
    title: 'Async tests without await',
    category: 'TESTING',
    defaultSeverity: 'WARN',
    rationale: 'Prevents flaky tests from missing await statements.',
    run: (ctx) => {
      const testFiles = ctx.changes.filter(c => 
        c.path.includes('.test.') || c.path.includes('__tests__') || c.path.includes('.spec.')
      );
      
      if (testFiles.length === 0) {
        return {
          key: 'async-tests-without-await',
          title: 'No test files changed',
          category: 'TESTING',
          status: 'PASS',
          details: 'No test files to analyze.',
        };
      }
      
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const testFile of testFiles) {
        const lines = testFile.diff.split('\n');
        let currentLine = 0;
        let inAsyncTest = false;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            if (line.match(/async\s+(test|it|describe)\s*\(/)) {
              inAsyncTest = true;
            } else if (inAsyncTest && (line.includes('expect(') || line.includes('assert('))) {
              // Check if there's an await in the last few lines
              const recentLines = lines.slice(Math.max(0, i - 5), i).join(' ');
              if (!recentLines.includes('await') && line.includes('Promise')) {
                issues.push({ file: testFile.path, line: currentLine });
              }
            } else if (line.includes('}') || line.includes(');')) {
              inAsyncTest = false;
            }
            currentLine++;
          } else if (!line.startsWith('-') && !line.startsWith('\\')) {
            currentLine++;
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'async-tests-without-await',
          title: 'Async tests without await',
          category: 'TESTING',
          status: 'WARN',
          details: `Found async test operations without await:\n${fileList}${more}\n\nAdd await to prevent flaky tests.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'async-tests-without-await',
        title: 'Async tests properly awaited',
        category: 'TESTING',
        status: 'PASS',
        details: 'No missing await statements in async tests.',
      };
    },
  },
  {
    key: 'test-only-code',
    title: 'Test-only code in production',
    category: 'TESTING',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents test utilities from leaking into production code.',
    run: (ctx) => {
      const prodFiles = ctx.changes.filter(c => 
        !c.path.includes('.test.') && !c.path.includes('__tests__') && !c.path.includes('.spec.')
      );
      
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const file of prodFiles) {
        const lines = file.diff.split('\n');
        let currentLine = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            if (line.includes('jest.') || line.includes('vitest.') || line.includes('describe(') || 
                line.includes('it(') || line.includes('test(') || line.includes('expect(')) {
              issues.push({ file: file.path, line: currentLine });
            }
            currentLine++;
          } else if (!line.startsWith('-') && !line.startsWith('\\')) {
            currentLine++;
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'test-only-code',
          title: 'Test-only code in production',
          category: 'TESTING',
          status: 'FAIL',
          details: `Found test code in production files:\n${fileList}${more}\n\nRemove test utilities from production code.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'test-only-code',
        title: 'No test code in production',
        category: 'TESTING',
        status: 'PASS',
        details: 'No test-only code detected in production files.',
      };
    },
  },
];

