/**
 * Repository hygiene checks
 */

import type { CheckDefinition } from '../types.js';

export const repoHygieneChecks: CheckDefinition[] = [
  {
    key: 'merge-conflict-markers',
    title: 'Merge conflict markers',
    category: 'REPO_HYGIENE',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents committing unresolved merge conflicts.',
    run: (ctx) => {
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const change of ctx.changes) {
        const lines = change.diff.split('\n');
        let currentLine = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            if (line.includes('<<<<<<<') || line.includes('=======') || line.includes('>>>>>>>')) {
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
          key: 'merge-conflict-markers',
          title: 'Merge conflict markers found',
          category: 'REPO_HYGIENE',
          status: 'FAIL',
          details: `Found merge conflict markers:\n${fileList}${more}\n\nResolve conflicts before committing.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'merge-conflict-markers',
        title: 'No merge conflict markers',
        category: 'REPO_HYGIENE',
        status: 'PASS',
        details: 'No merge conflict markers detected.',
      };
    },
  },
  {
    key: 'large-files',
    title: 'Large files',
    category: 'REPO_HYGIENE',
    defaultSeverity: 'WARN',
    rationale: 'Prevents committing large files that bloat the repository.',
    run: (ctx, thresholds) => {
      const maxSize = (thresholds?.maxFileSize as number) || 100000; // 100KB default
      const largeFiles: Array<{ file: string; size: number }> = [];
      
      for (const change of ctx.changes) {
        const size = change.diff.length;
        if (size > maxSize) {
          largeFiles.push({ file: change.path, size });
        }
      }
      
      if (largeFiles.length > 0) {
        const fileList = largeFiles.map(f => `- \`${f.file}\`: ${Math.round(f.size / 1024)}KB`).join('\n');
        return {
          key: 'large-files',
          title: 'Large files detected',
          category: 'REPO_HYGIENE',
          status: 'WARN',
          details: `Found large files (>${Math.round(maxSize / 1024)}KB):\n${fileList}\n\nConsider using Git LFS or external storage.`,
          filePath: largeFiles[0].file,
        };
      }
      
      return {
        key: 'large-files',
        title: 'File sizes acceptable',
        category: 'REPO_HYGIENE',
        status: 'PASS',
        details: 'No large files detected.',
      };
    },
  },
  {
    key: 'binary-files',
    title: 'Binary files',
    category: 'REPO_HYGIENE',
    defaultSeverity: 'WARN',
    rationale: 'Detects binary files that should use Git LFS.',
    run: (ctx) => {
      const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.exe', '.dll', '.so', '.dylib'];
      const issues: string[] = [];
      
      for (const change of ctx.changes) {
        const ext = change.path.substring(change.path.lastIndexOf('.')).toLowerCase();
        if (binaryExtensions.includes(ext)) {
          issues.push(change.path);
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(f => `- \`${f}\``).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'binary-files',
          title: 'Binary files detected',
          category: 'REPO_HYGIENE',
          status: 'WARN',
          details: `Found binary files:\n${fileList}${more}\n\nConsider using Git LFS for large binaries.`,
          filePath: issues[0],
        };
      }
      
      return {
        key: 'binary-files',
        title: 'No binary files',
        category: 'REPO_HYGIENE',
        status: 'PASS',
        details: 'No binary files detected.',
      };
    },
  },
  {
    key: 'sensitive-files',
    title: 'Sensitive files',
    category: 'REPO_HYGIENE',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents committing sensitive configuration or credential files.',
    run: (ctx) => {
      const sensitivePatterns = [
        /\.env$/,
        /\.pem$/,
        /\.key$/,
        /\.p12$/,
        /\.pfx$/,
        /id_rsa/,
        /id_dsa/,
        /\.secret$/,
        /credentials/,
        /\.config\.local/,
      ];
      
      const issues: string[] = [];
      
      for (const change of ctx.changes) {
        for (const pattern of sensitivePatterns) {
          if (pattern.test(change.path.toLowerCase())) {
            issues.push(change.path);
            break;
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.map(f => `- \`${f}\``).join('\n');
        return {
          key: 'sensitive-files',
          title: 'Sensitive files detected',
          category: 'REPO_HYGIENE',
          status: 'FAIL',
          details: `Found potentially sensitive files:\n${fileList}\n\nRemove sensitive files and ensure they're in .gitignore.`,
          filePath: issues[0],
        };
      }
      
      return {
        key: 'sensitive-files',
        title: 'No sensitive files',
        category: 'REPO_HYGIENE',
        status: 'PASS',
        details: 'No sensitive files detected.',
      };
    },
  },
  {
    key: 'trailing-whitespace',
    title: 'Trailing whitespace',
    category: 'REPO_HYGIENE',
    defaultSeverity: 'WARN',
    rationale: 'Maintains consistent code formatting.',
    run: (ctx) => {
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const change of ctx.changes) {
        const lines = change.diff.split('\n');
        let currentLine = 0;
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('@@')) {
            const match = line.match(/\+(\d+)/);
            if (match) currentLine = parseInt(match[1], 10);
            continue;
          }
          
          if (line.startsWith('+') && !line.startsWith('+++')) {
            if (line.match(/[ \t]+$/)) {
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
          key: 'trailing-whitespace',
          title: 'Trailing whitespace found',
          category: 'REPO_HYGIENE',
          status: 'WARN',
          details: `Found trailing whitespace:\n${fileList}${more}\n\nRemove trailing whitespace for consistency.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'trailing-whitespace',
        title: 'No trailing whitespace',
        category: 'REPO_HYGIENE',
        status: 'PASS',
        details: 'No trailing whitespace detected.',
      };
    },
  },
];

