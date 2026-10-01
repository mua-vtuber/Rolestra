/**
 * mig-non-forward-only — migration 안 revert / column drop / rename 검출.
 *
 * 헌법: SSoT / Atomicity.
 * 절대 위반 금지 규칙 #7 (마이그레이션 forward-only) 의 코드 표현.
 *
 * 차단 패턴 (migration 파일 한정):
 *  - DROP TABLE / DROP INDEX / DROP VIEW
 *  - ALTER TABLE ... DROP COLUMN / DROP CONSTRAINT
 *  - ALTER TABLE ... RENAME COLUMN (이전 이름 사라짐 = SSoT 깨짐)
 *
 * 데이터 마이그레이션 (UPDATE / DELETE 행 정리) 은 forward-only 의 일부 →
 * 차단 X. 컬럼 / 테이블 schema 자체의 폐기만 차단.
 *
 * ── R12-C2 T41 정밀화: SQLite 표 재구성 패턴 ──
 *
 * SQLite 는 `ALTER TABLE ... ALTER COLUMN` 도 `DROP CONSTRAINT` 도 없다.
 * CHECK 목록을 넓히는 (예: 새 알림 종류 / 새 승인 kind 추가) 유일한 방법은
 * 공식 문서가 권하는 표 재구성 4 단계다:
 *
 *   1. CREATE TABLE <new>      넓힌 제약으로 새 표
 *   2. INSERT INTO <new> SELECT ... FROM <old>   행을 값 그대로 옮김
 *   3. DROP TABLE <old>
 *   4. ALTER TABLE <new> RENAME TO <old>
 *
 * 이 흐름은 데이터도 컬럼도 잃지 않는다 — 앞으로만 간다. 옛 룰은 3 단계의
 * `DROP TABLE` 만 보고 위반으로 셌고, 015 / 021 / 029 세 migration 이
 * 정확히 이 패턴이라 4 건이 나왔다.
 *
 * 룰이 요구하는 대로 고치려면 이미 적용된 migration 의 SQL 을 손대야 하고
 * 그것은 규칙 #7 이 금지한다. 그래서 룰 쪽을 고친다: 같은 migration 안에서
 * 4 단계가 모두 갖춰졌고 DROP 대상이 RENAME 목적지와 같은 이름이면 재구성
 * 으로 인정하고 통과시킨다.
 *
 * 인정 조건을 좁게 잡은 이유 — RENAME 이 없는 맨 `DROP TABLE` 은 표가
 * 그냥 사라지는 것이라 여전히 위반이고, RENAME 목적지가 다른 이름이면
 * 재구성이 아니라 별개의 표 삭제다. 두 경우 모두 계속 잡힌다.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const DROP_PATTERN =
  /\b(DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE\s+\w+\s+(?:DROP\s+(?:COLUMN|CONSTRAINT)|RENAME\s+COLUMN))/i;

/** `DROP TABLE [IF EXISTS] <name>` 의 대상 이름. */
const DROP_TABLE_TARGET = /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/i;

/** `ALTER TABLE <src> RENAME TO <dest>` 의 (원본, 목적지). */
const RENAME_TO = /\bALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi;

/** `CREATE TABLE [IF NOT EXISTS] <name>` 의 이름. */
const CREATE_TABLE_NAME =
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;

/** `DROP INDEX [IF EXISTS] <name>` 의 대상 이름. */
const DROP_INDEX_TARGET = /\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(\w+)/i;

/** `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name>` 의 이름 (한 줄 단위). */
const CREATE_INDEX_NAME =
  /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i;

/** `INSERT INTO <name>` 의 대상 이름. */
const INSERT_INTO_NAME = /\bINSERT\s+INTO\s+(\w+)/gi;

/** `DROP TRIGGER [IF EXISTS] <name>` 의 대상 이름. */
const DROP_TRIGGER_TARGET = /\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)/i;

/** `CREATE TRIGGER [IF NOT EXISTS] <name>` 의 이름 (한 줄 단위). */
const CREATE_TRIGGER_NAME = /\bCREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i;

function collectAll(source: string, pattern: RegExp, group: number): Set<string> {
  const found = new Set<string>();
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    const name = m[group];
    if (name !== undefined) found.add(name);
  }
  return found;
}

/**
 * 이 파일 안에서 표 재구성으로 인정되는 표 이름들.
 *
 * `DROP TABLE x` 가 재구성으로 인정되려면 같은 파일 안에
 * `ALTER TABLE y RENAME TO x` 가 있고, `y` 가 이 파일에서 CREATE 되고
 * INSERT 로 채워졌어야 한다. 네 단계가 모두 맞아야만 통과다.
 */
function collectRebuiltTables(source: string): Set<string> {
  const created = collectAll(source, CREATE_TABLE_NAME, 1);
  const inserted = collectAll(source, INSERT_INTO_NAME, 1);

  const rebuilt = new Set<string>();
  RENAME_TO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RENAME_TO.exec(source)) !== null) {
    const from = m[1];
    const to = m[2];
    if (from === undefined || to === undefined) continue;
    if (created.has(from) && inserted.has(from)) rebuilt.add(to);
  }
  return rebuilt;
}

interface CodeLine {
  line: number;
  /** The line as written (for the hit excerpt). */
  text: string;
  /** The line with every comment part removed: what SQLite / TypeScript would read. */
  code: string;
}

/**
 * 파일의 각 줄에서 주석을 걷어 낸 "코드만 남은" 줄들.
 *
 * - 블록 주석 `/* ... *\/` 은 한 줄 안의 짧은 주석이든 여러 줄에 걸친 주석이든
 *   지운다 (줄을 넘어가며 "블록 주석 안" 상태를 이어 간다). 닫힌 뒤의 글은 코드다:
 *   `/* cleanup *\/ DROP TABLE users;` 의 DROP 은 진짜 DROP 이다.
 * - `--` 부터 줄 끝까지는 SQL 주석이다.
 * - `//` 로 시작하는 줄은 TypeScript 주석이다 (줄 중간의 `//` 는 문자열 안의
 *   URL 일 수 있어 건드리지 않는다).
 * - 작은따옴표 문자열 안의 `--` / `/*` 는 주석 시작이 아니다 (문자열은 한 줄 안에서만
 *   따진다).
 *
 * DROP 검사와 재생성 인정이 모두 이 같은 줄을 읽는다. 그래서 주석 안의 DROP 은
 * 잡지 않고, 주석 안의 CREATE 는 다시 만든 것으로 치지 않는다.
 */
function codeLines(source: string): CodeLine[] {
  const result: CodeLine[] = [];
  let inBlock = false;
  for (const { line, text } of iterLines(source)) {
    if (!inBlock && text.trim().startsWith('//')) {
      result.push({ line, text, code: '' });
      continue;
    }
    let code = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      if (inBlock) {
        if (text.startsWith('*/', index)) {
          inBlock = false;
          index += 1;
          code += ' ';
        }
        continue;
      }
      const char = text.charAt(index);
      if (char === "'") quoted = !quoted;
      if (!quoted && text.startsWith('/*', index)) {
        inBlock = true;
        index += 1;
        continue;
      }
      if (!quoted && text.startsWith('--', index)) break;
      code += char;
    }
    result.push({ line, text, code });
  }
  return result;
}

/**
 * 이름 → 그 이름을 만드는 코드 줄 번호들 (주석 부분 제외). `pattern` 은 한 줄에서
 * 이름을 뽑는 정규식이다 (`CREATE INDEX` / `CREATE TRIGGER`).
 *
 * SQLite 에는 `CREATE OR REPLACE TRIGGER` 도 index 변경 구문도 없어서, 정의를
 * 바꾸려면 같은 이름으로 DROP 한 뒤 다시 CREATE 하는 수밖에 없다 (033 이
 * index 를, 035 가 032 의 `messages_whisper_insert_check` trigger 를 이렇게
 * 바꾼다: 옛 trigger 는 귓속말 스레드의 3번째 행을 거부하므로 새 trigger 옆에
 * 남겨 둘 수 없다). 같은 파일 안에서 DROP *뒤에*, 주석이 아닌 코드에서 정확히
 * 같은 이름으로 다시 만들어질 때만 사라진 것이 없다고 본다.
 */
function collectCreateLines(lines: readonly CodeLine[], pattern: RegExp): Map<string, number[]> {
  const found = new Map<string, number[]>();
  for (const { line, code } of lines) {
    const name = pattern.exec(code)?.[1];
    if (name === undefined) continue;
    found.set(name, [...(found.get(name) ?? []), line]);
  }
  return found;
}

/** `name` 이 `dropLine` 보다 뒤의 SQL 줄에서 다시 만들어지는가. */
function recreatedAfter(creates: Map<string, number[]>, name: string | undefined, dropLine: number): boolean {
  return name !== undefined && (creates.get(name) ?? []).some((created) => created > dropLine);
}

const inspector: Inspector = {
  category: 'mig-non-forward-only',
  constitution: 'SSoT',
  scope: 'safety',
  description:
    'migration 안 DROP / RENAME 검출 — forward-only chain 위반 (SQLite 표 재구성은 제외).',
  perFile(file: ScannedFile): Hit[] {
    if (!file.isMigration) return [];
    if (file.rel.endsWith('migrations/index.ts')) return [];

    // 주석 (테이블 명 설명, 주석 처리된 SQL 등) 을 걷어 낸 코드만 읽는다.
    const lines = codeLines(file.source);
    const rebuilt = collectRebuiltTables(lines.map((entry) => entry.code).join('\n'));
    // 같은 migration 안에서 DROP 뒤에 다시 만들어지는 index / trigger —
    // 표 재구성 뒤 index 를 되살리거나 정의를 바꾸는 흐름이라 잃는 것이 없다.
    const indexCreateLines = collectCreateLines(lines, CREATE_INDEX_NAME);
    const triggerCreateLines = collectCreateLines(lines, CREATE_TRIGGER_NAME);

    const hits: Hit[] = [];
    for (const { line, text, code } of lines) {
      const match = DROP_PATTERN.exec(code);
      if (match === null) continue;
      const trimmed = text.trim();

      // 표 재구성 4 단계의 DROP TABLE 은 앞으로만 가는 흐름이다.
      const dropTarget = DROP_TABLE_TARGET.exec(code)?.[1];
      if (dropTarget !== undefined && rebuilt.has(dropTarget)) continue;

      // 같은 migration 이 DROP 뒤에 같은 이름으로 다시 만드는 index / trigger 는
      // 사라진 것이 없다.
      if (recreatedAfter(indexCreateLines, DROP_INDEX_TARGET.exec(code)?.[1], line)) continue;
      if (recreatedAfter(triggerCreateLines, DROP_TRIGGER_TARGET.exec(code)?.[1], line)) continue;

      hits.push({
        category: 'mig-non-forward-only',
        constitution: 'SSoT',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `migration 안 ${match[1]?.toUpperCase() ?? ''} — forward-only chain 위반.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
