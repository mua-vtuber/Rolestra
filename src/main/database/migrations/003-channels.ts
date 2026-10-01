/**
 * Migration 003-channels: channels + channel_members.
 *
 * Depends on 002-projects. Copied verbatim from
 * docs/superpowers/specs/2026-04-18-rolestra-design.md §5.2 (003_channels.sql).
 *
 * Includes:
 * - Composite FK (project_id, provider_id) → project_members for subset invariant.
 * - Partial unique index idx_dm_unique_per_provider enforcing one DM per provider.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '003-channels',
  sql: `
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- DM은 NULL
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('system_general','system_approval','system_minutes','user','dm')),
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

-- channel_members: 프로젝트 경계 강제 (CD-3)
-- project_id를 포함하여 project_members와 복합 FK로 subset invariant 보장
CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- DM은 NULL (channel.project_id와 동기화)
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, provider_id),
  -- 복합 FK: project_id가 NOT NULL일 때 (project_id, provider_id)가 project_members에 존재해야 함
  FOREIGN KEY (project_id, provider_id) REFERENCES project_members(project_id, provider_id) ON DELETE CASCADE
);
-- subset invariant: DM(project_id IS NULL)이 아니면 위 FK가 강제. DM은 트리거로 별도 검증.

-- DM 단순화 (CB-4 + codex 덧붙임): v3는 단일 사용자 앱이라 "사용자"를 채널 멤버로 저장할 provider 레코드 없음.
-- → DM 채널은 참여 AI 1명만 channel_members에 저장. 사용자 참여는 암묵적.
-- → 같은 AI와의 DM 중복 방지: partial unique index
CREATE UNIQUE INDEX idx_dm_unique_per_provider
  ON channel_members(provider_id)
  WHERE project_id IS NULL;   -- DM 멤버십은 provider당 1개

CREATE INDEX idx_channels_project ON channels(project_id);
CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_provider ON channel_members(provider_id);
`,
};
