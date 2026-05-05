/**
 * R12-C2 T11 — 검사관 (inspector) 공통 계약.
 *
 * 6 헌법 (SSoT / SoC / Consistency / Atomicity / Idempotency /
 * NoSilentFallback) 위반 검출 룰의 공통 인터페이스. 각 카테고리 룰은
 * `tools/inspectors/<category>.ts` 한 파일.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md §11.20.
 */

/**
 * 검사관 카테고리 ID — spec §11.20.2 그대로.
 */
export type Category =
  // 안전 경계 7 — phase 2 fail-closed 후보
  | 'secrets-plaintext'
  | 'exec-shell-string'
  | 'mig-non-idempotent'
  | 'mig-non-forward-only'
  | 'ipc-untyped-invoke'
  | 'approval-bypass'
  | 'path-guard-bypass'
  // 비안전 영역 5 — 항상 report-only
  | 'ui-string-hardcoded'
  | 'mock-fixture-import'
  | 'magic-number'
  | 'duplicate-constant'
  | 'unused-export';

export const SAFETY_CATEGORIES: readonly Category[] = [
  'secrets-plaintext',
  'exec-shell-string',
  'mig-non-idempotent',
  'mig-non-forward-only',
  'ipc-untyped-invoke',
  'approval-bypass',
  'path-guard-bypass',
] as const;

export const NON_SAFETY_CATEGORIES: readonly Category[] = [
  'ui-string-hardcoded',
  'mock-fixture-import',
  'magic-number',
  'duplicate-constant',
  'unused-export',
] as const;

export const ALL_CATEGORIES: readonly Category[] = [
  ...SAFETY_CATEGORIES,
  ...NON_SAFETY_CATEGORIES,
] as const;

/**
 * 6 헌법 — CLAUDE.md 절대 위반 금지 규칙의 코드 표현.
 */
export type Constitution =
  | 'SSoT'
  | 'SoC'
  | 'Consistency'
  | 'Atomicity'
  | 'Idempotency'
  | 'NoSilentFallback';

/**
 * 룰 위반 시 severity.
 *
 * - `safety-error` : phase 2 진입 시 빌드 실패 (안전 경계 7 한정)
 * - `report`       : 항상 report-only (phase 1 모든 룰 + phase 2 비안전 5)
 *
 * phase 1 = 모든 카테고리 effective severity = `report` (run.ts 가 강제).
 */
export type Severity = 'safety-error' | 'report';

/**
 * 단일 위반 hit.
 */
export interface Hit {
  category: Category;
  constitution: Constitution;
  /** repo-relative 경로 (POSIX 슬래시 통일). */
  file: string;
  line: number;
  message: string;
  /** 룰 정의가 부여한 severity. phase 1 에서 `safety-error` 도 report 로 처리. */
  severity: Severity;
  /** 위반 라인 텍스트 (trim, 앞 100 자 한정). */
  excerpt?: string;
}

/**
 * walker 가 검사관에 넘겨주는 1 파일 단위 컨텍스트.
 */
export interface ScannedFile {
  /** repo-relative 경로 (POSIX 슬래시 통일). */
  rel: string;
  /** 절대 경로. */
  abs: string;
  /** UTF-8 디코딩된 원본. */
  source: string;
  /** `__tests__/` / `*.test.ts` / `*.test.tsx` 여부. */
  isTest: boolean;
  /** `src/main/database/migrations/` 안 파일 여부. */
  isMigration: boolean;
  /** `src/main/` 하위. */
  isMainProcess: boolean;
  /** `src/renderer/` 하위. */
  isRenderer: boolean;
  /** `src/preload/` 하위. */
  isPreload: boolean;
  /** `src/shared/` 하위. */
  isShared: boolean;
}

/**
 * 검사관 룰 본체 인터페이스.
 *
 * - `perFile`    : 한 파일 단위 검사 (대부분 룰).
 * - `perProject` : 전체 파일 모아 cross-file 검사 (duplicate-constant /
 *                  unused-export 만 사용).
 *
 * 룰 한 개는 `perFile` / `perProject` 중 1 개 이상을 구현.
 */
export interface Inspector {
  category: Category;
  constitution: Constitution;
  scope: 'safety' | 'non-safety';
  /** 룰 의도를 1~2 줄로 (report.json + 콘솔 출력에 표시). */
  description: string;
  perFile?(file: ScannedFile): Hit[];
  perProject?(files: readonly ScannedFile[]): Hit[];
}

/**
 * `tools/inspectors/report.json` 의 root schema.
 */
export interface InspectorReport {
  /** ISO-8601. */
  generatedAt: string;
  /** 'phase-1' = 모두 report. 'phase-2' = 안전 7 fail-closed. */
  phase: 'phase-1' | 'phase-2';
  /** 실행된 카테고리 list. */
  categories: readonly Category[];
  /** 스캔 대상 파일 수. */
  scannedFiles: number;
  /** 카테고리별 hit count. */
  countByCategory: Record<string, number>;
  /** 전체 hit list. */
  hits: readonly Hit[];
  /** phase 1 = false. phase 2 + safety hit > 0 = true. */
  buildShouldFail: boolean;
}
