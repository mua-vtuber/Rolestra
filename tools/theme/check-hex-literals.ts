/**
 * check-hex-literals — R10 Task 7 hex literal guard.
 *
 * Recursively walks `src/renderer/components/` and `src/renderer/features/`
 * looking for hex colour literals (`#xxx` / `#xxxxxx`). Exits non-zero on
 * any unauthorised match — every UI surface must source colour from theme
 * tokens (Tailwind theme-mapped utility OR `var(--color-…)`).
 *
 * Allow-list: a small set of files document an intentional exception in
 * their header comment (palette identity, not theme styling). Those are
 * skipped entirely. Test files (`__tests__/`, `*.test.tsx`) are also
 * skipped — fixture hex strings are common and harmless.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const SCAN_ROOTS = [
  'src/renderer/components',
  'src/renderer/features',
] as const;

/** Files exempted from the hex-literal scan (palette identity etc). */
const ALLOW_LIST: ReadonlySet<string> = new Set([
  // Documents the catalogue palette in its file header — see Avatar.tsx.
  'src/renderer/components/members/Avatar.tsx',
]);

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function isTestPath(rel: string): boolean {
  return (
    rel.includes('/__tests__/') ||
    rel.endsWith('.test.tsx') ||
    rel.endsWith('.test.ts')
  );
}

function shouldScan(rel: string): boolean {
  if (!rel.endsWith('.tsx') && !rel.endsWith('.ts')) return false;
  if (isTestPath(rel)) return false;
  if (ALLOW_LIST.has(rel)) return false;
  return true;
}

function* walk(absDir: string): Generator<string> {
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      yield* walk(abs);
    } else if (stat.isFile()) {
      yield abs;
    }
  }
}

function scanFile(absPath: string, rel: string): Hit[] {
  const source = readFileSync(absPath, 'utf8');
  const hits: Hit[] = [];
  source.split('\n').forEach((line, idx) => {
    const match = HEX_PATTERN.exec(line);
    if (match === null) return;
    hits.push({ file: rel, line: idx + 1, text: line.trim() });
  });
  return hits;
}

function main(): void {
  const allHits: Hit[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(repoRoot, root);
    for (const file of walk(abs)) {
      const rel = relative(repoRoot, file).replace(/\\/g, '/');
      if (!shouldScan(rel)) continue;
      allHits.push(...scanFile(file, rel));
    }
  }
  if (allHits.length === 0) {
    console.log('theme:check — hex literal guard exit 0 (no unauthorised hex literals)');
    return;
  }
  console.error('theme:check — hex literal guard FAILED:');
  for (const hit of allHits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.text}`);
  }
  process.exit(1);
}

main();
