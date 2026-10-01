/**
 * Secret masking utility for structured log entries.
 *
 * Replaces common secret patterns (API keys, tokens, passwords, etc.)
 * with a fixed placeholder before log data reaches the buffer or output.
 */

/** Placeholder that replaces matched secrets. */
const MASK = '***REDACTED***';

/**
 * Patterns that match common secret formats.
 *
 * Each pattern is designed to catch real credentials while minimising
 * false positives on normal prose.  Order does not matter because
 * every pattern is applied independently.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // OpenAI-style keys: sk-<base62>, sk-proj-<base62>
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,

  // Anthropic keys: sk-ant-<base62>
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,

  // Generic "key-" prefixed tokens (e.g. key-abcdef1234567890abcd)
  /\bkey-[A-Za-z0-9_-]{20,}\b/g,

  // Bearer tokens in stringified headers
  /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi,

  // JSON-embedded password/secret/token/apiKey values:
  //   "password":"value"  or  "api_key": "value"
  /(?<="(?:password|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret)"\s*:\s*")[^"]+/gi,

  // AWS-style access keys: AKIA followed by 16 uppercase alphanumeric
  /\bAKIA[A-Z0-9]{16}\b/g,

  // Generic long hex tokens (64+ hex chars, e.g. SHA-256 tokens)
  /\b[0-9a-f]{64,}\b/gi,

  // Google API keys: AIza followed by 35 chars
  /\bAIza[A-Za-z0-9_-]{35}\b/g,

  // GitHub personal access tokens: ghp_, gho_, ghs_, ghr_
  /\bgh[pors]_[A-Za-z0-9_]{36,}\b/g,
];

/**
 * Replace secret patterns in a string with a redaction placeholder.
 *
 * This function is intentionally pure and synchronous so it can be
 * called on every log emit without measurable overhead for typical
 * log message lengths.
 */
export function maskSecrets(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex for global regexps reused across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, MASK);
  }
  return result;
}
