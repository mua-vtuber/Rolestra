/**
 * R12-C2 T11 — 검사관 파일 walker.
 *
 * 스캔 대상 = `src/`, `tools/` (단 `tools/inspectors/` 자기 자신 제외) +
 * `e2e/` (test 표기). node_modules / out / dist / .git / docs / 모든 dot
 * 폴더 / `tools/inspectors/` 자기 자신 / `tools/cli-smoke/__tests__/` /
 * Playwright 결과는 walk 단계에서 차단.
 *
 * walker 는 *경로 기반 분류* 만 수행 — 룰별 파일 필터링 (예: migration
 * 룰은 migration 파일만 검사) 은 각 inspector 의 `perFile` 안에서.
 */

import { readdirSync, readFileSync, statSync, type Stats } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ScannedFile } from './types';

export interface WalkOptions {
  /** repo root 절대 경로. */
  repoRoot: string;
  /** 스캔할 root 들 (repoRoot 기준 상대). */
  roots: readonly string[];
  /** changed-files 모드 — 주어진 파일만 검사 (POSIX 상대 경로). */
  onlyChanged?: readonly string[];
}

const DEFAULT_ROOTS = ['src', 'tools', 'e2e'] as const;

/** walk 자체에서 차단할 디렉토리 이름 (basename 매칭). */
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'out',
  'dist',
  '.git',
  '.github',
  '.omx',
  '.vscode',
  '.idea',
  'docs',
  'graphify-out',
  'test-results',
  'playwright-report',
  'coverage',
  'inspectors', // tools/inspectors/ 자기 자신은 검사 대상 아님
]);

/** 검사 대상 확장자. */
const SCAN_EXTENSIONS: readonly string[] = ['.ts', '.tsx'];

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function isTestPath(rel: string): boolean {
  return (
    rel.includes('/__tests__/') ||
    rel.endsWith('.test.ts') ||
    rel.endsWith('.test.tsx') ||
    rel.startsWith('e2e/') ||
    rel.includes('/test-utils/')
  );
}

function isMigrationPath(rel: string): boolean {
  return rel.startsWith('src/main/database/migrations/') && /\d{3}-/.test(rel);
}

function classify(rel: string, abs: string, source: string): ScannedFile {
  return {
    rel,
    abs,
    source,
    isTest: isTestPath(rel),
    isMigration: isMigrationPath(rel),
    isMainProcess: rel.startsWith('src/main/'),
    isRenderer: rel.startsWith('src/renderer/'),
    isPreload: rel.startsWith('src/preload/'),
    isShared: rel.startsWith('src/shared/'),
  };
}

function shouldScanFile(rel: string): boolean {
  if (!SCAN_EXTENSIONS.some((ext) => rel.endsWith(ext))) return false;
  // .d.ts 는 선언만 — 검사 대상 X
  if (rel.endsWith('.d.ts')) return false;
  return true;
}

function* walkDir(absDir: string): Generator<string> {
  let entries: readonly string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const abs = join(absDir, entry);
    let stat: Stats;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkDir(abs);
    } else if (stat.isFile()) {
      yield abs;
    }
  }
}

export function collectFiles(options: WalkOptions): ScannedFile[] {
  const { repoRoot, onlyChanged } = options;
  const roots = options.roots.length === 0 ? DEFAULT_ROOTS : options.roots;
  const result: ScannedFile[] = [];

  if (onlyChanged !== undefined && onlyChanged.length > 0) {
    // changed-files 모드 — 주어진 경로만 검사 (root 안에 있을 때 한정)
    const rootSet = new Set(roots);
    for (const rel of onlyChanged) {
      const norm = toPosix(rel);
      const top = norm.split('/')[0];
      if (top === undefined || !rootSet.has(top)) continue;
      if (!shouldScanFile(norm)) continue;
      const abs = join(repoRoot, norm);
      let source: string;
      try {
        source = readFileSync(abs, 'utf8');
      } catch {
        continue; // 삭제된 파일 등
      }
      result.push(classify(norm, abs, source));
    }
    return result;
  }

  for (const root of roots) {
    const absRoot = join(repoRoot, root);
    for (const abs of walkDir(absRoot)) {
      const rel = toPosix(relative(repoRoot, abs));
      if (!shouldScanFile(rel)) continue;
      const source = readFileSync(abs, 'utf8');
      result.push(classify(rel, abs, source));
    }
  }

  return result;
}

/**
 * 한 줄 안 1-based line number 를 source offset 기준으로 계산.
 * 룰 안에서 regex.exec 의 index 를 변환할 때 사용.
 */
export function offsetToLine(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * source 를 라인 단위 iter 화 — 라인 번호 + 텍스트.
 * 라인 단위 패턴 룰에서 사용.
 */
export function* iterLines(
  source: string,
): Generator<{ line: number; text: string }> {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    yield { line: i + 1, text: lines[i] ?? '' };
  }
}

/**
 * `// inspector-disable-next-line <category> <reason>` 회피 주석 처리 —
 * phase 1 에서는 단순 인지만 하고 hit 은 무력화. phase 2 시점에 PR review
 * 게이트가 reason 검증.
 *
 * 반환: 해당 라인 번호의 disable 카테고리 set (해당 라인 다음 줄에 적용).
 */
export function collectDisableComments(
  source: string,
): Map<number, ReadonlySet<string>> {
  const disabled = new Map<number, Set<string>>();
  const pattern = /\/\/\s*inspector-disable-next-line\s+([\w-]+)/g;
  let lineNo = 1;
  let lastIndex = 0;
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) !== 10) continue;
    const lineText = source.slice(lastIndex, i);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lineText)) !== null) {
      const targetLine = lineNo + 1;
      const cat = match[1] ?? '';
      let set = disabled.get(targetLine);
      if (set === undefined) {
        set = new Set<string>();
        disabled.set(targetLine, set);
      }
      set.add(cat);
    }
    lineNo++;
    lastIndex = i + 1;
  }
  return disabled;
}
