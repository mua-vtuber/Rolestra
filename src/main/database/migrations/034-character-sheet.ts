/**
 * Migration 034-character-sheet — F3 캐릭터 설정 자유 글 칸.
 *
 * spec `docs/specs/2026-09-29-ai-setup-and-character.md` §F3-1.
 *
 * `member_profiles` 와 `chat_room_members` 에 `character_sheet` 컬럼을
 * 추가하고, 기존 row 를 다음 규칙으로 채운다 (persona-builder 의
 * `buildIdentity` 가 만들던 identity 줄과 같은 형식이므로, 옮긴 뒤에도
 * 모델이 받는 문장이 크게 바뀌지 않는다):
 *
 *   1. `role` / `personality` / `expertise` 중 비어 있지 않은 값만
 *      `Role: …` / `Personality: …` / `Expertise: …` 줄로 만들고, 존재하는
 *      줄만 개행(`\n`)으로 잇는다 (identity part). 공백만 있는 값은
 *      비어 있는 것으로 본다(trim 비교).
 *   2. legacy persona — `member_profiles` 는 `providers.persona` 를 JOIN,
 *      `chat_room_members` 는 자신의 `legacy_persona` 스냅샷 — 이 비어
 *      있지 않으면:
 *      - identity part 가 있으면 빈 줄(`\n\n`) 뒤에 persona 를 붙인다.
 *      - identity part 가 비어 있으면 persona 만 그대로 쓴다(선행 빈 줄
 *        없음 — 그렇지 않으면 사용자가 보는 칸이 빈 줄로 시작한다).
 *   3. identity part 와 persona 가 모두 비어 있으면 `character_sheet` 는
 *      빈 문자열이다.
 *
 * `chat_room_members` 는 각 row 자신의 스냅샷 필드(role / personality /
 * expertise / legacy_persona)로 채운다 — 방 생성 시점에 얼어붙은 값이므로
 * 이 백필이 `effective_persona` 를 건드리지 않는다(§F3-1 "기존 방의
 * effectivePersona 는 바꾸지 않는다").
 *
 * 옛 칸(role/personality/expertise, providers.persona, chat_room_members
 * 의 개별 스냅샷 칸)은 전부 남긴다 — 지우지 않는다.
 *
 * 멱등성: `character_sheet` 는 새 컬럼이라 처음엔 모든 row 가 빈 문자열
 * (컬럼 DEFAULT)이다. UPDATE 의 우변은 소스 컬럼(role/personality/
 * expertise/persona/legacy_persona)만 읽어 계산하므로, 두 번째 실행에서도
 * 같은 입력 → 같은 출력이라 재실행이 안전하다(migrator 자체도 이미 적용된
 * migration 을 건너뛰지만, SQL 자체도 독립적으로 idempotent — 두 UPDATE
 * 문을 손으로 두 번 실행해도 결과가 같음을 `034-character-sheet.test.ts` 가
 * 확인한다).
 *
 * sqlite 표준 `LATERAL` 은 better-sqlite3 번들 sqlite 에서 지원하지 않으므로,
 * 각 UPDATE 는 대상 테이블 자신을 가리키는 상관 서브쿼리(自己 self-join)로
 * identity/persona 두 값을 한 번에 계산한 뒤 바깥 CASE 로 조합한다.
 *
 * "비어 있음" 판정은 `buildIdentity`(persona-builder.ts) 가 쓰는 JS
 * `String.prototype.trim()` 과 같은 결과를 내야 한다 — sqlite 내장
 * `trim(x)` 은 기본적으로 space(0x20) 만 제거하고 tab/개행은 남기므로,
 * 두 함수를 그대로 대응시키면 tab-only 값이 sqlite 쪽에서는 "비어 있지
 * 않음"으로 잘못 분류된다. 아래 SQL 은 항상 `trim(x, char(32,9,10,13))`
 * (space/tab/LF/CR 4종) 형태로 호출해 이 차이를 없앤다.
 *
 * Forward-only — 과거 migration 파일은 고치지 않는다.
 */

import type { Migration } from '../migrator';

/** JS `.trim()` 과 같은 공백 집합(space/tab/LF/CR)으로 좁힌 sqlite trim 호출. */
const TRIM_WS = "char(32,9,10,13)";

/**
 * `member_profiles.character_sheet` 백필 UPDATE. `providers` 를 상관
 * 서브쿼리로 읽어 legacy persona 를 가져온다.
 */
const MEMBER_PROFILES_BACKFILL_SQL = `
UPDATE member_profiles
   SET character_sheet = (
     SELECT
       CASE
         WHEN identity <> '' AND persona <> '' THEN identity || char(10) || char(10) || persona
         WHEN identity <> '' THEN identity
         WHEN persona <> '' THEN persona
         ELSE ''
       END
     FROM (
       SELECT
         coalesce((
           SELECT group_concat(line, char(10)) FROM (
             SELECT 'Role: ' || mp2.role AS line
             WHERE trim(mp2.role, ${TRIM_WS}) <> ''
             UNION ALL
             SELECT 'Personality: ' || mp2.personality
             WHERE trim(mp2.personality, ${TRIM_WS}) <> ''
             UNION ALL
             SELECT 'Expertise: ' || mp2.expertise
             WHERE trim(mp2.expertise, ${TRIM_WS}) <> ''
           )
         ), '') AS identity,
         trim(coalesce(
           (SELECT p.persona FROM providers p WHERE p.id = mp2.provider_id),
           ''
         ), ${TRIM_WS}) AS persona
       FROM member_profiles mp2
       WHERE mp2.provider_id = member_profiles.provider_id
     )
   );
`;

/**
 * `chat_room_members.character_sheet` 백필 UPDATE. 자신의 스냅샷 칸만
 * 읽는다 — 다른 테이블 참조 없음.
 */
const CHAT_ROOM_MEMBERS_BACKFILL_SQL = `
UPDATE chat_room_members
   SET character_sheet = (
     SELECT
       CASE
         WHEN identity <> '' AND persona <> '' THEN identity || char(10) || char(10) || persona
         WHEN identity <> '' THEN identity
         WHEN persona <> '' THEN persona
         ELSE ''
       END
     FROM (
       SELECT
         coalesce((
           SELECT group_concat(line, char(10)) FROM (
             SELECT 'Role: ' || crm2.role AS line
             WHERE trim(crm2.role, ${TRIM_WS}) <> ''
             UNION ALL
             SELECT 'Personality: ' || crm2.personality
             WHERE trim(crm2.personality, ${TRIM_WS}) <> ''
             UNION ALL
             SELECT 'Expertise: ' || crm2.expertise
             WHERE trim(crm2.expertise, ${TRIM_WS}) <> ''
           )
         ), '') AS identity,
         trim(crm2.legacy_persona, ${TRIM_WS}) AS persona
       FROM chat_room_members crm2
       WHERE crm2.channel_id = chat_room_members.channel_id
         AND crm2.provider_id = chat_room_members.provider_id
     )
   );
`;

export const migration: Migration = {
  id: '034-character-sheet',
  sql: `
ALTER TABLE member_profiles ADD COLUMN character_sheet TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_room_members ADD COLUMN character_sheet TEXT NOT NULL DEFAULT '';

${MEMBER_PROFILES_BACKFILL_SQL}

${CHAT_ROOM_MEMBERS_BACKFILL_SQL}
`,
};

// Exported for the migration's own sanity test (mirrors the 023/028 pattern
// of exporting the raw SQL fragments for a standalone re-run assertion).
export { MEMBER_PROFILES_BACKFILL_SQL, CHAT_ROOM_MEMBERS_BACKFILL_SQL };
