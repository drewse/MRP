/**
 * Architecture checks
 */

import type { CheckDefinition } from '../types.js';

export const architectureChecks: CheckDefinition[] = [
  {
    key: 'circular-dependencies',
    title: 'Circular dependencies',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Detects potential circular import dependencies.',
    run: (ctx) => {
      const imports = new Map<string, Set<string>>();
      
      for (const change of ctx.changes) {
        if (!change.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
        
        const fileImports: string[] = [];
        for (const line of change.diff.split('\n')) {
          if (line.startsWith('+') && (line.includes('import ') || line.includes('require('))) {
            const match = line.match(/from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]/);
            if (match) fileImports.push(match[1] || match[2]);
          }
        }
        
        if (fileImports.length > 0) {
          imports.set(change.path, new Set(fileImports));
        }
      }
      
      // Simple circular dependency detection
      const issues: Array<{ file: string; import: string }> = [];
      for (const [file, fileImports] of imports) {
        for (const imp of fileImports) {
          const importedFile = imports.get(imp);
          if (importedFile && importedFile.has(file)) {
            issues.push({ file, import: imp });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` ↔ \`${i.import}\``).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'circular-dependencies',
          title: 'Circular dependencies detected',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: `Found circular dependencies:\n${fileList}${more}\n\nConsider refactoring to break the cycle.`,
          filePath: issues[0].file,
        };
      }
      
      return {
        key: 'circular-dependencies',
        title: 'No circular dependencies',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: 'No circular dependencies detected.',
      };
    },
  },
  {
    key: 'unexpected-paths',
    title: 'Unexpected file paths',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Ensures files are organized in expected directories.',
    run: (ctx) => {
      const unexpected: string[] = [];
      
      for (const change of ctx.changes) {
        const path = change.path;
        if (!path.startsWith('apps/') && !path.startsWith('packages/') && !path.startsWith('infra/') && 
            !path.startsWith('.github/') && !path.startsWith('.vscode/') && !path.startsWith('.') &&
            path !== 'package.json' && path !== 'pnpm-workspace.yaml' && path !== 'tsconfig.base.json') {
          unexpected.push(path);
        }
      }
      
      if (unexpected.length > 0) {
        const fileList = unexpected.slice(0, 5).map(p => `- \`${p}\``).join('\n');
        const more = unexpected.length > 5 ? `\n- ... and ${unexpected.length - 5} more` : '';
        return {
          key: 'unexpected-paths',
          title: 'Unexpected file paths',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: `Files changed outside expected directories:\n${fileList}${more}`,
          filePath: unexpected[0],
        };
      }
      
      return {
        key: 'unexpected-paths',
        title: 'All paths expected',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: 'All changed files are in expected directories.',
      };
    },
  },
  {
    key: 'prisma-schema-without-migration',
    title: 'Prisma schema without migration',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Ensures schema changes include corresponding migrations.',
    run: (ctx) => {
      const schemaChanged = ctx.changes.some(c => c.path.includes('schema.prisma'));
      const migrationAdded = ctx.changes.some(c => c.path.includes('prisma/migrations/'));
      
      if (schemaChanged && !migrationAdded) {
        return {
          key: 'prisma-schema-without-migration',
          title: 'Prisma schema changed without migration',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: '`schema.prisma` was modified but no migration file was added. Remember to run `prisma migrate dev`.',
        };
      }
      
      return {
        key: 'prisma-schema-without-migration',
        title: 'Prisma migrations present',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: schemaChanged ? 'Prisma schema change includes migration.' : 'No Prisma schema changes detected.',
      };
    },
  },
  {
    key: 'large-diff',
    title: 'Large diff',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Encourages smaller, more reviewable changes.',
    run: (ctx, thresholds) => {
      const maxSize = (thresholds?.maxSize as number) || 8000;
      const maxLines = (thresholds?.maxLines as number) || 400;
      const largeFiles: Array<{ file: string; size: number; lines: number }> = [];
      
      for (const change of ctx.changes) {
        const diffSize = change.diff.length;
        const addedLines = (change.diff.match(/^\+/gm) || []).length;
        
        if (diffSize > maxSize || addedLines > maxLines) {
          largeFiles.push({ file: change.path, size: diffSize, lines: addedLines });
        }
      }
      
      if (largeFiles.length > 0) {
        const fileList = largeFiles.map(f => `- \`${f.file}\`: ${f.size} chars, ${f.lines} added lines`).join('\n');
        return {
          key: 'large-diff',
          title: 'Large diff detected',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: `Large changes detected (>${maxSize} chars or >${maxLines} added lines):\n${fileList}\n\nConsider breaking into smaller commits.`,
          filePath: largeFiles[0].file,
        };
      }
      
      return {
        key: 'large-diff',
        title: 'Diff size reasonable',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: 'All file changes are within reasonable size limits.',
      };
    },
  },
  {
    key: 'missing-index-files',
    title: 'Missing index files',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Encourages proper module organization with index files.',
    run: (ctx) => {
      const newDirs = new Set<string>();
      const hasIndex = new Set<string>();
      
      for (const change of ctx.changes) {
        if (change.path.match(/\.(ts|tsx|js|jsx)$/)) {
          const dir = change.path.substring(0, change.path.lastIndexOf('/'));
          if (dir && !change.path.includes('node_modules')) {
            newDirs.add(dir);
            if (change.path.endsWith('/index.ts') || change.path.endsWith('/index.tsx') || 
                change.path.endsWith('/index.js') || change.path.endsWith('/index.jsx')) {
              hasIndex.add(dir);
            }
          }
        }
      }
      
      const missingIndex = Array.from(newDirs).filter(d => !hasIndex.has(d) && d.split('/').length > 2);
      
      if (missingIndex.length > 0) {
        const dirList = missingIndex.slice(0, 5).map(d => `- \`${d}/\``).join('\n');
        const more = missingIndex.length > 5 ? `\n- ... and ${missingIndex.length - 5} more` : '';
        return {
          key: 'missing-index-files',
          title: 'Missing index files',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: `New directories without index files:\n${dirList}${more}\n\nConsider adding index.ts for cleaner imports.`,
        };
      }
      
      return {
        key: 'missing-index-files',
        title: 'Index files present',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: 'No missing index files detected.',
      };
    },
  },
  {
    key: 'direct-db-access',
    title: 'Direct database access',
    category: 'ARCHITECTURE',
    defaultSeverity: 'WARN',
    rationale: 'Encourages using abstraction layers instead of direct DB access.',
    run: (ctx) => {
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const change of ctx.changes) {
        if (!change.path.match(/\.(ts|tsx)$/)) continue;
        
        const lines = change.diff.split('\n');
        let currentLine = 0;
        
        for (const line of lines) {
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            if (line.match(/\.query\(|\.execute\(|\.raw\(/i) && 
                (line.includes('SELECT') || line.includes('INSERT') || line.includes('UPDATE') || line.includes('DELETE'))) {
              issues.push({ file: change.path, line: currentLine });
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
          key: 'direct-db-access',
          title: 'Direct database access detected',
          category: 'ARCHITECTURE',
          status: 'WARN',
          details: `Found direct SQL queries:\n${fileList}${more}\n\nConsider using Prisma or a repository pattern.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'direct-db-access',
        title: 'No direct database access',
        category: 'ARCHITECTURE',
        status: 'PASS',
        details: 'No direct database access detected.',
      };
    },
  },
];

