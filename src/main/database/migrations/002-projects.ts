/**
 * Migration 002-projects: projects + project_members.
 *
 * Depends on 001-core (providers). Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (002_projects.sql).
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '002-projects',
  sql: `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                          -- UUID v4, DB 참조 전용
  slug TEXT NOT NULL UNIQUE,                    -- URL-safe 폴더명 (파일시스템 유일 키)
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('new','external','imported')),
  external_link TEXT DEFAULT NULL,              -- kind=external: spawn 직전 realpathSync 재검증 대상
  permission_mode TEXT NOT NULL CHECK(permission_mode IN ('auto','hybrid','approval')),
  autonomy_mode TEXT NOT NULL DEFAULT 'manual' CHECK(autonomy_mode IN ('manual','auto_toggle','queue')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','folder_missing','archived')),
  created_at INTEGER NOT NULL,
  archived_at INTEGER DEFAULT NULL
);
-- 파일시스템 경로 결정: resolveProjectPaths(project)만 사용
--   regular:  <ArenaRoot>/projects/<slug>
--   external: <ArenaRoot>/projects/<slug>/link → realpathSync → external_link와 일치 필수

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  role_at_project TEXT DEFAULT NULL,    -- 프로젝트별 역할 오버라이드 (NULL = member_profiles.role 사용)
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, provider_id)
);
`,
};
