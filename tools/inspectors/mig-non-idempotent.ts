/**
 * mig-non-idempotent — migration chain 의 1 회 실행 보장을 깨는 패턴 검출.
 *
 * 헌법: Idempotency.
 * 절대 위반 금지 규칙 #7 (마이그레이션 forward-only / idempotent / 실패 시
 * 앱 시작 차단) 의 코드 표현.
 *
 * ── R12-C2 T41 정밀화 (룰이 요구하던 것 vs migrator 가 보장하는 것) ──
 *
 * 옛 룰은 `CREATE TABLE` / `CREATE INDEX` 에 `IF NOT EXISTS` 가 없으면
 * 위반으로 셌고 77 건이 나왔다. 그런데 `migrator.ts` 를 읽으면 idempotency
 * 를 만드는 것은 `IF NOT EXISTS` 가 아니다:
 *
 *   1. `ensureMigrationsTable` 이 `migrations` 표를 만든다.
 *   2. `getAppliedMigrations` 가 이미 적용된 id 집합을 읽는다.
 *   3. `pending = migrations.filter((m) => !applied.has(m.id))` — 이미
 *      적용된 migration 의 SQL 은 *아예 실행되지 않는다*.
 *   4. 각 pending migration 은 `database.transaction(() => { exec(sql);
 *      recordMigration(id); })` 안에서 돈다 — SQL 과 기록이 함께 커밋되거나
 *      함께 되돌아간다. 반쯤 적용된 migration 이 기록될 수 없다.
 *
 * 즉 같은 migration 의 SQL 이 같은 DB 에 두 번 닿는 경우는 구조적으로
 * 없고, `IF NOT EXISTS` 가 있든 없든 결과가 같다. 실제로 29 개 migration
 * 중 8 개만 `IF NOT EXISTS` 를 쓰는데 chain 은 문제없이 돈다 — 그 자체가
 * 이 표기가 불변식이 아니었다는 증거다.
 *
 * 룰을 만족시키려면 이미 적용된 migration 파일의 SQL 을 고쳐야 하는데,
 * 그것은 절대 위반 금지 규칙 #7 이 금지하는 바로 그 행동이다. 룰이 규칙과
 * 충돌하면 틀린 쪽은 룰이다.
 *
 * ── 그래서 지금 무엇을 잡는가 ──
 *
 * migrator 가 막아 주지 *못하는* 것만 남긴다: migration SQL 이 실행될 때마다
 * 값이 달라지는 비결정적 표현. 이런 SQL 은 같은 chain 을 돌린 두 대의
 * 기기가 서로 다른 데이터를 갖게 만들고, transaction 도 applied-set 도
 * 이것을 막지 못한다.
 *
 *  - `random()` / `randomblob(` — 행마다 다른 값이 들어간다.
 *  - `datetime('now')` / `date('now')` / `time('now')` / `julianday('now')`
 *    / `strftime(..., 'now')` — *실행 시각* 이 데이터에 그대로 남는다. 컬럼
 *    DEFAULT 로 선언하는 것은 괜찮다 (그 때는 INSERT 시각이라 migration
 *    실행 시각과 무관하다) — 아래 `isColumnDefault` 가 걸러 낸다.
 *
 * `CURRENT_TIMESTAMP` 는 컬럼 DEFAULT 로만 쓰이고 있어 같은 이유로 통과.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

/**
 * migration 을 다시 돌리면 값이 달라지는 SQL 표현.
 *
 * `strftime` 은 첫 인자가 형식 문자열이라 `'now'` 가 뒤에 온다 — 라인
 * 전체에 `'now'` 가 있는지로 함께 판정한다.
 */
const NONDETERMINISTIC_PATTERN =
  /\b(random\s*\(|randomblob\s*\(|(?:datetime|date|time|julianday)\s*\(\s*'now'|strftime\s*\()/i;

/** `strftime(` 은 `'now'` 인자가 있을 때만 비결정적이다. */
const STRFTIME_ONLY = /^strftime\s*\($/i;

/**
 * 컬럼 DEFAULT 절 안인가. `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
 * 같은 선언은 migration 실행 시각이 아니라 *행 INSERT 시각* 을 넣으므로
 * chain 재실행과 무관하다.
 */
function isColumnDefault(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  const lastDefault = before.toUpperCase().lastIndexOf('DEFAULT');
  if (lastDefault === -1) return false;
  // DEFAULT 와 이 표현 사이에 컬럼 구분자가 끼어 있으면 다른 절이다.
  return !/[,)]/.test(before.slice(lastDefault));
}

const inspector: Inspector = {
  category: 'mig-non-idempotent',
  constitution: 'Idempotency',
  scope: 'safety',
  description:
    'migration SQL 안 비결정적 표현 (random / now) — 재실행 시 기기마다 데이터가 갈린다.',
  perFile(file: ScannedFile): Hit[] {
    if (!file.isMigration) return [];
    if (file.rel.endsWith('migrations/index.ts')) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const trimmed = text.trim();
      // 주석 안 설명은 SQL 이 아니다.
      if (trimmed.startsWith('--') || trimmed.startsWith('*') ||
          trimmed.startsWith('//')) {
        continue;
      }

      const match = NONDETERMINISTIC_PATTERN.exec(text);
      if (match === null) continue;

      const token = (match[1] ?? '').trim();
      if (STRFTIME_ONLY.test(token) && !/'now'/i.test(text)) continue;
      if (isColumnDefault(text, match.index)) continue;

      hits.push({
        category: 'mig-non-idempotent',
        constitution: 'Idempotency',
        file: file.rel,
        line,
        severity: 'safety-error',
        message:
          `migration SQL 안 비결정적 표현 (${token}) — 실행할 때마다 값이 ` +
          '달라져 기기마다 데이터가 갈린다.',
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
