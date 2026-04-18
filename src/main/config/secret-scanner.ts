/**
 * API key leak prevention scanner.
 *
 * Detects known secret patterns (OpenAI, Anthropic, Google, generic tokens)
 * in text and provides masking functionality. Used to prevent accidental
 * exposure of API keys in logs, UI output, or exported data.
 */

import type { SecretPattern, SecretScanResult } from '../../shared/config-types';

/**
 * Known secret patterns for popular AI providers and generic tokens.
 *
 * Each pattern includes the provider name, one or more regex patterns,
 * and a replacement string for masking detected secrets.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'OpenAI',
    patterns: [
      // Standard OpenAI keys: sk-<48+ chars>
      /sk-[A-Za-z0-9]{20,}/g,
    ],
    replacement: 'sk-***REDACTED***',
  },
  {
    name: 'Anthropic',
    patterns: [
      // Anthropic keys: sk-ant-<base64-like>
      /sk-ant-[A-Za-z0-9_-]{20,}/g,
    ],
    replacement: 'sk-ant-***REDACTED***',
  },
  {
    name: 'Google AI',
    patterns: [
      // Google API keys: AIza<35 chars>
      /AIza[A-Za-z0-9_-]{30,}/g,
    ],
    replacement: 'AIza***REDACTED***',
  },
  {
    name: 'Generic Token',
    patterns: [
      // Generic long hex/base64 tokens (40+ chars of alphanumeric)
      // Anchored to word boundaries to reduce false positives
      /\b[A-Za-z0-9_-]{40,}\b/g,
    ],
    replacement: '***REDACTED_TOKEN***',
  },
];

/**
 * Creates fresh copies of patterns with reset lastIndex.
 * RegExp with /g flag is stateful; we must create fresh instances per scan.
 */
function freshPatterns(): SecretPattern[] {
  return SECRET_PATTERNS.map((sp) => ({
    ...sp,
    patterns: sp.patterns.map((p) => new RegExp(p.source, p.flags)),
  }));
}

/**
 * Scans text for potential secret/API key leaks.
 *
 * Checks against known provider patterns (OpenAI, Anthropic, Google)
 * and generic long token patterns. Returns a result indicating whether
 * secrets were detected, a masked version of the text, and warnings.
 *
 * @param text - The text to scan for secrets.
 * @returns Scan result with detection status, masked text, and warnings.
 */
export function scanForSecrets(text: string): SecretScanResult {
  const warnings: string[] = [];
  let masked = text;
  let detected = false;

  // Process patterns in order: specific providers first, generic last.
  // More specific patterns (Anthropic sk-ant-) must match before less
  // specific ones (OpenAI sk-) to avoid partial replacements.
  const patterns = freshPatterns();

  for (const secretPattern of patterns) {
    for (const regex of secretPattern.patterns) {
      const matches = masked.match(regex);

      if (matches !== null && matches.length > 0) {
        detected = true;

        for (const match of matches) {
          warnings.push(
            `Potential ${secretPattern.name} key detected: ${match.slice(0, 8)}...`,
          );
        }

        masked = masked.replace(regex, secretPattern.replacement);
      }
    }
  }

  return { detected, masked, warnings };
}

/**
 * Replaces detected secrets in text with masked versions.
 *
 * Convenience wrapper around scanForSecrets that returns only the masked text.
 *
 * @param text - The text to mask.
 * @returns The text with all detected secrets replaced.
 */
export function maskSecrets(text: string): string {
  return scanForSecrets(text).masked;
}
