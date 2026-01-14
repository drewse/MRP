/**
 * Security-related checks
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

export const securityChecks: CheckDefinition[] = [
  {
    key: 'secrets',
    title: 'Potential secrets detected',
    category: 'SECURITY',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents accidental commit of API keys, tokens, or passwords.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const secretPattern = /(api_key|secret|token|password|private_key|access_token)\s*[:=]/i;
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          if (secretPattern.test(lines[i])) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'secrets',
          title: 'Potential secrets detected',
          category: 'SECURITY',
          status: 'FAIL',
          details: `Found potential secret patterns:\n${fileList}${more}`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'secrets',
        title: 'No secrets detected',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No obvious secret patterns found.',
      };
    },
  },
  {
    key: 'logging-secrets',
    title: 'Secrets in logger calls',
    category: 'SECURITY',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents logging sensitive data that could be exposed.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const loggerSecretPattern = /logger\.(.*?)\s*\([^)]*(token|secret|password|api_key)/i;
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          if (loggerSecretPattern.test(lines[i])) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'logging-secrets',
          title: 'Secrets in logger calls',
          category: 'SECURITY',
          status: 'FAIL',
          details: `Found potential secrets in logger calls:\n${fileList}${more}\n\nNever log secrets or tokens.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'logging-secrets',
        title: 'No secrets in logs',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No secrets found in logger calls.',
      };
    },
  },
  {
    key: 'hardcoded-credentials',
    title: 'Hardcoded credentials',
    category: 'SECURITY',
    defaultSeverity: 'FAIL',
    rationale: 'Prevents hardcoded usernames, passwords, or API endpoints.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const credentialPatterns = [
        /password\s*=\s*["'][^"']+["']/i,
        /username\s*=\s*["'](admin|root|user|test)["']/i,
        /api[_-]?endpoint\s*=\s*["']https?:\/\//i,
      ];
      const issues: Array<{ file: string; line: number; pattern: string }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          for (const pattern of credentialPatterns) {
            if (pattern.test(lines[i])) {
              issues.push({ file, line: lineNumbers[i], pattern: pattern.source });
              break;
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'hardcoded-credentials',
          title: 'Hardcoded credentials detected',
          category: 'SECURITY',
          status: 'FAIL',
          details: `Found hardcoded credentials:\n${fileList}${more}\n\nUse environment variables or secure config.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'hardcoded-credentials',
        title: 'No hardcoded credentials',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No hardcoded credentials detected.',
      };
    },
  },
  {
    key: 'sql-injection-risk',
    title: 'SQL injection risk',
    category: 'SECURITY',
    defaultSeverity: 'WARN',
    rationale: 'Detects potential SQL injection vulnerabilities from string concatenation.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const sqlPattern = /(query|sql|execute|exec)\s*\([^)]*\+/i;
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        // Only check SQL-related files
        if (!file.match(/\.(sql|ts|js|tsx|jsx)$/)) continue;
        
        for (let i = 0; i < lines.length; i++) {
          if (sqlPattern.test(lines[i]) && lines[i].includes('${') || lines[i].includes('+')) {
            issues.push({ file, line: lineNumbers[i] });
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'sql-injection-risk',
          title: 'Potential SQL injection risk',
          category: 'SECURITY',
          status: 'WARN',
          details: `Found SQL queries with string concatenation:\n${fileList}${more}\n\nUse parameterized queries or ORM methods.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'sql-injection-risk',
        title: 'No SQL injection risks',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No obvious SQL injection risks detected.',
      };
    },
  },
  {
    key: 'xss-risk',
    title: 'XSS risk in user input',
    category: 'SECURITY',
    defaultSeverity: 'WARN',
    rationale: 'Detects unescaped user input that could lead to XSS vulnerabilities.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const xssPatterns = [
        /innerHTML\s*=\s*[^;]+request\.|innerHTML\s*=\s*[^;]+query\.|innerHTML\s*=\s*[^;]+body\./i,
        /dangerouslySetInnerHTML/i,
      ];
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        // Only check frontend files
        if (!file.match(/\.(tsx|jsx|ts|js)$/)) continue;
        
        for (let i = 0; i < lines.length; i++) {
          for (const pattern of xssPatterns) {
            if (pattern.test(lines[i])) {
              issues.push({ file, line: lineNumbers[i] });
              break;
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'xss-risk',
          title: 'Potential XSS risk',
          category: 'SECURITY',
          status: 'WARN',
          details: `Found unescaped user input:\n${fileList}${more}\n\nEnsure user input is properly sanitized.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'xss-risk',
        title: 'No XSS risks',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No obvious XSS risks detected.',
      };
    },
  },
  {
    key: 'insecure-random',
    title: 'Insecure random number generation',
    category: 'SECURITY',
    defaultSeverity: 'WARN',
    rationale: 'Detects use of Math.random() for security-sensitive operations.',
    run: (ctx) => {
      const addedLinesByFile = extractAddedLines(ctx.changes);
      const insecureRandomPattern = /Math\.random\(\)/;
      const issues: Array<{ file: string; line: number }> = [];
      
      for (const [file, { lines, lineNumbers }] of addedLinesByFile) {
        for (let i = 0; i < lines.length; i++) {
          if (insecureRandomPattern.test(lines[i])) {
            // Check if it's used for security (token, id, password, etc.)
            const context = lines.slice(Math.max(0, i - 2), i + 3).join(' ').toLowerCase();
            if (context.includes('token') || context.includes('id') || context.includes('password') || context.includes('secret')) {
              issues.push({ file, line: lineNumbers[i] });
            }
          }
        }
      }
      
      if (issues.length > 0) {
        const fileList = issues.slice(0, 5).map(i => `- \`${i.file}\` (line ${i.line})`).join('\n');
        const more = issues.length > 5 ? `\n- ... and ${issues.length - 5} more` : '';
        return {
          key: 'insecure-random',
          title: 'Insecure random number generation',
          category: 'SECURITY',
          status: 'WARN',
          details: `Found Math.random() used for security-sensitive operations:\n${fileList}${more}\n\nUse crypto.randomBytes() or similar secure methods.`,
          filePath: issues[0].file,
          lineHint: issues[0].line,
        };
      }
      
      return {
        key: 'insecure-random',
        title: 'Secure random generation',
        category: 'SECURITY',
        status: 'PASS',
        details: 'No insecure random number generation detected.',
      };
    },
  },
];

