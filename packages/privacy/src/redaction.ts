/**
 * Privacy redaction utilities
 * 
 * Removes sensitive information from text before sending to LLMs
 */

export interface RedactionReport {
  linesRemoved: number;
  patternsMatched: string[];
  totalCharsRemoved: number;
}

/**
 * Patterns that indicate sensitive content
 */
const SENSITIVE_PATTERNS = [
  // API keys and tokens
  /\bglpat-[a-zA-Z0-9_-]{20,}\b/gi,
  /\bsk-[a-zA-Z0-9_-]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bPRIVATE-TOKEN\s*[:=]\s*[^\s]+/gi,
  /\bBearer\s+[a-zA-Z0-9_-]{20,}\b/gi,
  /\bapi[_-]?key\s*[:=]\s*[^\s]+/gi,
  /\bsecret[_-]?key\s*[:=]\s*[^\s]+/gi,
  /\baccess[_-]?token\s*[:=]\s*[^\s]+/gi,
  
  // Private keys
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
  /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/gi,
  /-----BEGIN\s+DSA\s+PRIVATE\s+KEY-----/gi,
  
  // Passwords
  /\bpassword\s*[:=]\s*[^\s]+/gi,
  /\bpasswd\s*[:=]\s*[^\s]+/gi,
  /\bpwd\s*[:=]\s*[^\s]+/gi,
  
  // JWTs
  /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
  
  // Common secret patterns
  /\bsecret\s*[:=]\s*[^\s]+/gi,
  /\btoken\s*[:=]\s*[^\s]+/gi,
  /\bauth[_-]?token\s*[:=]\s*[^\s]+/gi,
];

/**
 * Email pattern (basic)
 */
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

/**
 * Phone number pattern (basic)
 */
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;

/**
 * Redact sensitive information from text
 */
export function redactText(text: string): { redactedText: string; report: RedactionReport } {
  let redactedText = text;
  const patternsMatched: string[] = [];
  let totalCharsRemoved = 0;
  let linesRemoved = 0;
  
  const originalLines = text.split('\n');
  const redactedLines: string[] = [];
  
  for (const line of originalLines) {
    let lineRedacted = line;
    let lineModified = false;
    
    // Check for sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(line)) {
        // Remove entire line if it contains sensitive patterns
        lineModified = true;
        patternsMatched.push(pattern.source);
        break;
      }
    }
    
    if (lineModified) {
      linesRemoved++;
      totalCharsRemoved += line.length;
      continue; // Skip this line entirely
    }
    
    // Redact remaining sensitive patterns in the line
    for (const pattern of SENSITIVE_PATTERNS) {
      const matches = lineRedacted.match(pattern);
      if (matches) {
        patternsMatched.push(pattern.source);
        lineRedacted = lineRedacted.replace(pattern, '[REDACTED]');
        totalCharsRemoved += matches.reduce((sum, m) => sum + m.length, 0);
      }
    }
    
    // Redact emails
    if (EMAIL_PATTERN.test(lineRedacted)) {
      lineRedacted = lineRedacted.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');
      patternsMatched.push('email');
    }
    
    // Redact phone numbers
    if (PHONE_PATTERN.test(lineRedacted)) {
      lineRedacted = lineRedacted.replace(PHONE_PATTERN, '[PHONE_REDACTED]');
      patternsMatched.push('phone');
    }
    
    redactedLines.push(lineRedacted);
  }
  
  redactedText = redactedLines.join('\n');
  
  return {
    redactedText,
    report: {
      linesRemoved,
      patternsMatched: [...new Set(patternsMatched)],
      totalCharsRemoved,
    },
  };
}

/**
 * Check if a file path should be excluded from AI processing
 */
export function isFileExcluded(filePath: string): boolean {
  const path = filePath.toLowerCase();
  
  // Denylist patterns - strong protection for secrets
  const denylist = [
    '.env',
    '.env.local',
    '.env.production',
    '.pem',
    '.key',
    '.p12',
    '.pfx',
    'secrets/',
    'credentials/',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519',
    '.ssh/',
    'config/secrets',
    'private/',
    '.secret',
    '*.secret',
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
  ];
  
  for (const pattern of denylist) {
    if (path.includes(pattern) || path.endsWith(pattern.replace('*', ''))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a file path is in the allowlist
 */
export function isFileAllowed(filePath: string): boolean {
  const path = filePath.toLowerCase();
  
  // Allowlist patterns - common repo files and folders
  const allowlistPatterns = [
    // Folders
    'apps/',
    'packages/',
    'infra/',
    'scripts/',
    'prisma/',
    // File extensions
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.sql',
    '.prisma',
    '.sh',
    '.ps1',
  ];
  
  // Check folder patterns
  for (const pattern of allowlistPatterns) {
    if (pattern.endsWith('/')) {
      if (path.startsWith(pattern)) {
        return true;
      }
    } else {
      // File extension pattern
      if (path.endsWith(pattern)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Check if a file should be processed by AI
 */
export function shouldProcessFile(filePath: string): boolean {
  // Exclude if in denylist
  if (isFileExcluded(filePath)) {
    return false;
  }
  
  // Include if in allowlist
  if (isFileAllowed(filePath)) {
    return true;
  }
  
  // Default: exclude files outside allowlist
  return false;
}

