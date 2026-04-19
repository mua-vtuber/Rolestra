/**
 * Migration 001-core: providers + member_profiles.
 *
 * v3 schema root. No FK dependencies. Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (001_core.sql).
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '001-core',
  sql: `
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('api','cli','local')),
  config_json TEXT NOT NULL,
  persona TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE member_profiles (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  role TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  expertise TEXT DEFAULT '',
  avatar_kind TEXT DEFAULT 'default',
  avatar_data TEXT DEFAULT NULL,
  status_override TEXT DEFAULT NULL,
  updated_at INTEGER NOT NULL
);
`,
};
