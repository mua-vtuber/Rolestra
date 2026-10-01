/**
 * Schema + backfill contract tests for v3 migration 034-character-sheet
 * (F3-1, spec `docs/specs/2026-09-29-ai-setup-and-character.md`).
 *
 * 실제 업그레이드 경로를 재현한다:
 *   1. 033 까지의 chain 만 적용 (034 land 이전 상태의 DB).
 *   2. `member_profiles` / `chat_room_members` 에 옛 3칸 + legacy persona
 *      조합별 row 를 심는다.
 *   3. 전체 chain 을 적용(034 만 pending) → 백필 결과 검사.
 *
 * Coverage:
 * - `character_sheet` 컬럼이 두 테이블에 추가된다.
 * - member_profiles 백필: all-empty / persona-only / role-only /
 *   mixed(3칸+persona 전부) / whitespace-only 취급 조합.
 * - chat_room_members 백필: 자신의 스냅샷 칸만 사용, `effective_persona`
 *   는 절대 바뀌지 않는다.
 * - 옛 칸(role/personality/expertise, providers.persona,
 *   chat_room_members 의 개별 스냅샷 칸)이 지워지지 않고 그대로 남는다.
 * - 두 번 실행해도 결과가 같다(멱등) — migrator 의 skip 뿐 아니라 UPDATE
 *   SQL 자체를 두 번 실행해도 동일.
 * - 034 가 chain 에 기록된다.
 */

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../migrator';
import { migrations } from '../migrations/index';
import {
  MEMBER_PROFILES_BACKFILL_SQL,
  CHAT_ROOM_MEMBERS_BACKFILL_SQL,
} from '../migrations/034-character-sheet';

const MIGRATION_ID = '034-character-sheet';

/** 034 를 뺀 chain — 마이그레이션 land 이전의 DB 상태를 만든다. */
const CHAIN_BEFORE_034 = migrations.slice(
  0,
  migrations.findIndex((m) => m.id === '033-whisper-pairs') + 1,
);

const opened: Database.Database[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

function openDbAtChain(chain: typeof migrations): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  db.pragma('foreign_keys = ON');
  runMigrations(db, chain);
  return db;
}

function seedProvider(
  db: Database.Database,
  id: string,
  persona: string,
): void {
  db.prepare(
    `INSERT INTO providers (id, display_name, kind, config_json, persona, created_at, updated_at)
     VALUES (?, ?, 'api', '{}', ?, 1, 1)`,
  ).run(id, id, persona);
}

function seedProfile(
  db: Database.Database,
  providerId: string,
  role: string,
  personality: string,
  expertise: string,
): void {
  db.prepare(
    `INSERT INTO member_profiles (provider_id, role, personality, expertise, updated_at)
     VALUES (?, ?, ?, ?, 1)`,
  ).run(providerId, role, personality, expertise);
}

interface CharacterSheetRow {
  character_sheet: string;
}

function getProfileSheet(db: Database.Database, providerId: string): string {
  return (
    db
      .prepare('SELECT character_sheet FROM member_profiles WHERE provider_id = ?')
      .get(providerId) as CharacterSheetRow
  ).character_sheet;
}

describe('034 character sheet', () => {
  it('adds character_sheet to member_profiles and chat_room_members with the merge-backfill rule', () => {
    const db = openDbAtChain(CHAIN_BEFORE_034);

    // ── member_profiles seed: every combination the spec calls out ────
    seedProvider(db, 'all-empty', '');
    seedProfile(db, 'all-empty', '', '', '');

    seedProvider(db, 'persona-only', 'Legacy persona blob.');
    seedProfile(db, 'persona-only', '', '', '');

    seedProvider(db, 'role-only', '');
    seedProfile(db, 'role-only', 'Engineer', '', '');

    seedProvider(db, 'mixed-all', 'Likes terse answers.');
    seedProfile(db, 'mixed-all', 'Engineer', 'Direct', 'SQLite, FTS5');

    seedProvider(db, 'whitespace-only', '');
    seedProfile(db, 'whitespace-only', '   ', '\t', '');

    seedProvider(db, 'whitespace-persona', '   \n  ');
    seedProfile(db, 'whitespace-persona', '', '', '');

    // ── chat_room_members seed: room snapshot rows, independent of the
    //    member_profiles rows above — a room can freeze a persona the
    //    live profile no longer has.
    db.prepare(
      "INSERT INTO channels (id, project_id, name, kind, created_at) VALUES ('room1', NULL, 'Room', 'user', 1)",
    ).run();
    db.prepare(
      "INSERT INTO chat_rooms (channel_id, created_at) VALUES ('room1', 1)",
    ).run();
    db.prepare(
      `INSERT INTO chat_room_members
         (channel_id, provider_id, sort_order, display_name, persona_source,
          role, personality, expertise, legacy_persona, effective_persona)
       VALUES ('room1', 'mixed-all', 0, 'Mixed All', 'default',
          'Engineer', 'Direct', 'SQLite, FTS5', 'Room snapshot legacy.', 'EFFECTIVE_UNCHANGED_MIXED')`,
    ).run();
    db.prepare(
      `INSERT INTO chat_room_members
         (channel_id, provider_id, sort_order, display_name, persona_source,
          role, personality, expertise, legacy_persona, effective_persona)
       VALUES ('room1', 'all-empty', 1, 'All Empty', 'custom',
          '', '', '', '', 'EFFECTIVE_UNCHANGED_EMPTY')`,
    ).run();
    db.prepare(
      `INSERT INTO chat_room_members
         (channel_id, provider_id, sort_order, display_name, persona_source,
          role, personality, expertise, legacy_persona, effective_persona)
       VALUES ('room1', 'persona-only', 2, 'Custom Room Persona', 'custom',
          '', '', '', 'This room''s own custom persona text.', 'EFFECTIVE_UNCHANGED_CUSTOM')`,
    ).run();

    runMigrations(db, migrations);

    // ── column existence ───────────────────────────────────────────
    const profileCols = (
      db.prepare("SELECT name FROM pragma_table_info('member_profiles')").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(profileCols).toContain('character_sheet');
    expect(profileCols).toEqual(
      expect.arrayContaining(['provider_id', 'role', 'personality', 'expertise', 'avatar_kind', 'avatar_data', 'status_override', 'updated_at']),
    );
    const roomCols = (
      db.prepare("SELECT name FROM pragma_table_info('chat_room_members')").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(roomCols).toContain('character_sheet');
    expect(roomCols).toEqual(
      expect.arrayContaining(['role', 'personality', 'expertise', 'legacy_persona', 'effective_persona']),
    );

    // ── member_profiles backfill combinations ──────────────────────
    expect(getProfileSheet(db, 'all-empty')).toBe('');
    expect(getProfileSheet(db, 'persona-only')).toBe('Legacy persona blob.');
    expect(getProfileSheet(db, 'role-only')).toBe('Role: Engineer');
    expect(getProfileSheet(db, 'mixed-all')).toBe(
      'Role: Engineer\nPersonality: Direct\nExpertise: SQLite, FTS5\n\nLikes terse answers.',
    );
    // Whitespace-only role/personality AND whitespace-only persona both
    // count as empty — the sheet is the empty string, not a bag of blanks.
    expect(getProfileSheet(db, 'whitespace-only')).toBe('');
    expect(getProfileSheet(db, 'whitespace-persona')).toBe('');

    // ── old columns preserved verbatim ─────────────────────────────
    const mixedRow = db
      .prepare('SELECT role, personality, expertise FROM member_profiles WHERE provider_id = ?')
      .get('mixed-all') as { role: string; personality: string; expertise: string };
    expect(mixedRow).toEqual({ role: 'Engineer', personality: 'Direct', expertise: 'SQLite, FTS5' });
    const providerPersona = db
      .prepare('SELECT persona FROM providers WHERE id = ?')
      .get('mixed-all') as { persona: string };
    expect(providerPersona.persona).toBe('Likes terse answers.');

    // ── chat_room_members backfill uses the room's OWN snapshot fields,
    //    independent of the live member_profiles/providers rows ───────
    const roomRows = db
      .prepare(
        'SELECT provider_id, character_sheet, effective_persona, role, personality, expertise, legacy_persona FROM chat_room_members ORDER BY sort_order',
      )
      .all() as Array<{
      provider_id: string;
      character_sheet: string;
      effective_persona: string;
      role: string;
      personality: string;
      expertise: string;
      legacy_persona: string;
    }>;
    expect(roomRows).toEqual([
      {
        provider_id: 'mixed-all',
        character_sheet: 'Role: Engineer\nPersonality: Direct\nExpertise: SQLite, FTS5\n\nRoom snapshot legacy.',
        effective_persona: 'EFFECTIVE_UNCHANGED_MIXED',
        role: 'Engineer', personality: 'Direct', expertise: 'SQLite, FTS5', legacy_persona: 'Room snapshot legacy.',
      },
      {
        provider_id: 'all-empty',
        character_sheet: '',
        effective_persona: 'EFFECTIVE_UNCHANGED_EMPTY',
        role: '', personality: '', expertise: '', legacy_persona: '',
      },
      {
        provider_id: 'persona-only',
        character_sheet: "This room's own custom persona text.",
        effective_persona: 'EFFECTIVE_UNCHANGED_CUSTOM',
        role: '', personality: '', expertise: '', legacy_persona: "This room's own custom persona text.",
      },
    ]);

    // ── idempotency: re-running the raw backfill SQL twice more must not
    //    change any value already computed ────────────────────────────
    const before = db.prepare('SELECT provider_id, character_sheet FROM member_profiles ORDER BY provider_id').all();
    const beforeRooms = db.prepare('SELECT provider_id, character_sheet FROM chat_room_members ORDER BY provider_id').all();
    db.exec(MEMBER_PROFILES_BACKFILL_SQL);
    db.exec(CHAT_ROOM_MEMBERS_BACKFILL_SQL);
    db.exec(MEMBER_PROFILES_BACKFILL_SQL);
    db.exec(CHAT_ROOM_MEMBERS_BACKFILL_SQL);
    expect(db.prepare('SELECT provider_id, character_sheet FROM member_profiles ORDER BY provider_id').all()).toEqual(before);
    expect(db.prepare('SELECT provider_id, character_sheet FROM chat_room_members ORDER BY provider_id').all()).toEqual(beforeRooms);

    // ── running the full migrator chain again is also a no-op ─────────
    runMigrations(db, migrations);
    expect(db.prepare('SELECT provider_id, character_sheet FROM member_profiles ORDER BY provider_id').all()).toEqual(before);

    expect(
      (db.prepare("SELECT count(*) AS n FROM migrations WHERE id = ?").get(MIGRATION_ID) as { n: number }).n,
    ).toBe(1);
  });

  it('a fresh row inserted after 034 has an empty character_sheet by column default', () => {
    const db = openDbAtChain(migrations);
    seedProvider(db, 'fresh', '');
    db.prepare(
      `INSERT INTO member_profiles (provider_id, updated_at) VALUES (?, 1)`,
    ).run('fresh');
    expect(getProfileSheet(db, 'fresh')).toBe('');
  });
});
