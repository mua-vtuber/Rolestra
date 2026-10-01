/**
 * R12-C2 T11 — 검사관 실행 엔트리.
 *
 * 사용법:
 *   tsx tools/inspectors/run.ts                 # 전체 (안전 7 + 비안전 5)
 *   tsx tools/inspectors/run.ts --safety        # 안전 7 만
 *   tsx tools/inspectors/run.ts --changed a b c # 주어진 파일만
 *   tsx tools/inspectors/run.ts --phase=2       # 안전 카테고리 판정 (차단은
 *                                               # config.failClosed 가 결정)
 *
 * 산출:
 *   - tools/inspectors/report.json (전체 hit list + count)
 *   - 콘솔 요약 (카테고리별 hit count + 상위 10 hit)
 *
 * Exit code:
 *   - phase 1 (default): 항상 exit 0 (report-only).
 *   - phase 2 + config.failClosed === true: 안전 카테고리 hit > 0 = exit 1.
 *   - phase 2 + config.failClosed === false (현재 기본): 안전 카테고리 hit
 *     목록을 그대로 보여 주되 exit 0. 훅 / CI 가 신호만 받고 작업은 막지
 *     않는다. 전환은 사용자 승인 게이트 — `tools/inspectors/config.ts` 참조.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md §11.20.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import secretsPlaintext from './secrets-plaintext';
import execShellString from './exec-shell-string';
import migNonIdempotent from './mig-non-idempotent';
import migNonForwardOnly from './mig-non-forward-only';
import ipcUntypedInvoke from './ipc-untyped-invoke';
import approvalBypass from './approval-bypass';
import pathGuardBypass from './path-guard-bypass';
import uiStringHardcoded from './ui-string-hardcoded';
import mockFixtureImport from './mock-fixture-import';
import magicNumber from './magic-number';
import duplicateConstant from './duplicate-constant';
import unusedExport from './unused-export';

import type {
  Inspector,
  Hit,
  Category,
  InspectorReport,
  ScannedFile,
} from './types';
import { SAFETY_CATEGORIES } from './types';
import { collectFiles, collectDisableComments } from './walker';
import { resolveFailClosed } from './config';

const ALL_INSPECTORS: readonly Inspector[] = [
  // 안전 7
  secretsPlaintext,
  execShellString,
  migNonIdempotent,
  migNonForwardOnly,
  ipcUntypedInvoke,
  approvalBypass,
  pathGuardBypass,
  // 비안전 5
  uiStringHardcoded,
  mockFixtureImport,
  magicNumber,
  duplicateConstant,
  unusedExport,
];

interface CliOptions {
  safetyOnly: boolean;
  changedFiles: readonly string[];
  phase: 'phase-1' | 'phase-2';
  reportPath: string;
  silent: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const opts: {
    safetyOnly: boolean;
    changedFiles: string[];
    phase: 'phase-1' | 'phase-2';
    reportPath: string;
    silent: boolean;
  } = {
    safetyOnly: false,
    changedFiles: [],
    phase: 'phase-1',
    reportPath: 'tools/inspectors/report.json',
    silent: false,
  };
  let collectingChanged = false;
  for (const arg of argv) {
    if (arg === '--safety') {
      opts.safetyOnly = true;
      collectingChanged = false;
      continue;
    }
    if (arg === '--silent') {
      opts.silent = true;
      collectingChanged = false;
      continue;
    }
    if (arg === '--phase=2') {
      opts.phase = 'phase-2';
      collectingChanged = false;
      continue;
    }
    if (arg === '--phase=1') {
      opts.phase = 'phase-1';
      collectingChanged = false;
      continue;
    }
    if (arg.startsWith('--report=')) {
      opts.reportPath = arg.slice('--report='.length);
      collectingChanged = false;
      continue;
    }
    if (arg === '--changed') {
      collectingChanged = true;
      continue;
    }
    if (collectingChanged) {
      opts.changedFiles.push(arg);
    }
  }
  return opts;
}

function selectInspectors(opts: CliOptions): readonly Inspector[] {
  if (!opts.safetyOnly) return ALL_INSPECTORS;
  return ALL_INSPECTORS.filter((i) => i.scope === 'safety');
}

function applyDisableComments(
  files: readonly ScannedFile[],
  hits: readonly Hit[],
): Hit[] {
  const disableMaps = new Map<string, ReturnType<typeof collectDisableComments>>();
  for (const file of files) {
    disableMaps.set(file.rel, collectDisableComments(file.source));
  }
  return hits.filter((hit) => {
    const map = disableMaps.get(hit.file);
    if (map === undefined) return true;
    const disabledAtLine = map.get(hit.line);
    if (disabledAtLine === undefined) return true;
    return !disabledAtLine.has(hit.category);
  });
}

function runInspectors(
  inspectors: readonly Inspector[],
  files: readonly ScannedFile[],
): Hit[] {
  const allHits: Hit[] = [];
  for (const inspector of inspectors) {
    if (inspector.perFile !== undefined) {
      for (const file of files) {
        const fileHits = inspector.perFile(file);
        for (const hit of fileHits) allHits.push(hit);
      }
    }
    if (inspector.perProject !== undefined) {
      const projectHits = inspector.perProject(files);
      for (const hit of projectHits) allHits.push(hit);
    }
  }
  return allHits;
}

function buildReport(
  opts: CliOptions,
  inspectors: readonly Inspector[],
  files: readonly ScannedFile[],
  hits: readonly Hit[],
): InspectorReport {
  const countByCategory: Record<string, number> = {};
  for (const inspector of inspectors) countByCategory[inspector.category] = 0;
  for (const hit of hits) {
    countByCategory[hit.category] = (countByCategory[hit.category] ?? 0) + 1;
  }

  const safetyHitCount = hits.filter((h) =>
    SAFETY_CATEGORIES.includes(h.category as Category),
  ).length;

  // phase 2 는 안전 위반을 *판정* 하고, config.failClosed 가 그 판정으로
  // 작업을 막을지를 정한다. 둘을 나눠 두면 전환 전에 "지금 켜면 무엇이
  // 막히는가" 를 보고서에서 그대로 읽을 수 있다.
  const failClosed = resolveFailClosed();
  const safetyViolation = opts.phase === 'phase-2' && safetyHitCount > 0;
  const buildShouldFail = safetyViolation && failClosed;

  return {
    generatedAt: new Date().toISOString(),
    phase: opts.phase,
    categories: inspectors.map((i) => i.category),
    scannedFiles: files.length,
    countByCategory,
    hits,
    failClosed,
    safetyHitCount,
    safetyViolation,
    buildShouldFail,
  };
}

function logSummary(report: InspectorReport, opts: CliOptions): void {
  if (opts.silent) return;
  const {
    phase,
    scannedFiles,
    countByCategory,
    hits,
    failClosed,
    safetyHitCount,
    safetyViolation,
    buildShouldFail,
  } = report;
  console.log('────────────────────────────────────────');
  console.log(`inspector run — phase=${phase}, files=${scannedFiles}`);
  console.log('────────────────────────────────────────');
  for (const [cat, count] of Object.entries(countByCategory)) {
    const isSafety = SAFETY_CATEGORIES.includes(cat as Category);
    const tag = isSafety ? '[안전]' : '[비안전]';
    console.log(`  ${tag.padEnd(7)} ${cat.padEnd(28)} ${count}`);
  }
  console.log('────────────────────────────────────────');
  console.log(`total hits: ${hits.length}`);
  if (buildShouldFail) {
    console.log(
      `BUILD FAILED — phase 2 안전 카테고리 hit ${safetyHitCount} 건 ` +
        '(failClosed=true).',
    );
  } else if (safetyViolation) {
    console.log(
      `안전 카테고리 hit ${safetyHitCount} 건 — failClosed=false 라 차단하지 ` +
        '않는다. 켜려면 tools/inspectors/config.ts 참조.',
    );
  } else if (phase === 'phase-2') {
    console.log(
      `안전 카테고리 hit 0 건 — 통과 (failClosed=${failClosed ? 'true' : 'false'}).`,
    );
  } else {
    console.log('report-only — 빌드 차단 X.');
  }
  if (hits.length > 0) {
    const top = hits.slice(0, 10);
    console.log('────────────────────────────────────────');
    console.log('상위 hit 10:');
    for (const hit of top) {
      console.log(`  ${hit.file}:${hit.line}  [${hit.category}] ${hit.message}`);
    }
    if (hits.length > 10) {
      console.log(`  ... ${hits.length - 10} more (전체: report.json)`);
    }
  }
}

/**
 * report 를 쓴다. `--report=` 값은 repo 상대 경로와 절대 경로 둘 다 받는다.
 *
 * R12-C2 T41 — 예전에는 값을 무조건 `join(repoRoot, ...)` 했다. 절대 경로를
 * 주면 `D:/repo/C:/Users/...` 같은 경로가 만들어져 mkdir 이 ENOENT 로 죽거나
 * (Windows), repo 안에 엉뚱한 폴더가 생겼다 (POSIX). `isAbsolute` 로 갈라
 * 절대 경로는 그대로 쓴다.
 */
function writeReport(
  report: InspectorReport,
  repoRoot: string,
  reportPath: string,
): void {
  const abs = isAbsolute(reportPath) ? reportPath : join(repoRoot, reportPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

function main(): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '..', '..');
  process.chdir(repoRoot);

  const opts = parseArgs(process.argv.slice(2));
  const inspectors = selectInspectors(opts);

  const files = collectFiles({
    repoRoot,
    roots: ['src', 'tools', 'e2e'],
    onlyChanged:
      opts.changedFiles.length > 0 ? opts.changedFiles : undefined,
  });

  const rawHits = runInspectors(inspectors, files);
  const filteredHits = applyDisableComments(files, rawHits);

  const report = buildReport(opts, inspectors, files, filteredHits);
  writeReport(report, repoRoot, opts.reportPath);
  logSummary(report, opts);

  return report.buildShouldFail ? 1 : 0;
}

const exitCode = main();
process.exit(exitCode);
