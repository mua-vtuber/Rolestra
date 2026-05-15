import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignCheckpointRepository } from '../design-checkpoint-repository';
import {
  DesignCheckpointNotPendingError,
  DesignCheckpointService,
} from '../design-checkpoint-service';

let db: Database.Database;
let service: DesignCheckpointService;
let now = 1_700_000_000_000;

function createSchema(): void {
  db.exec(`
    CREATE TABLE design_checkpoint (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('wireframe')),
      status TEXT NOT NULL CHECK(status IN ('pending', 'continued', 'revision_requested', 'auto_skipped')),
      title TEXT NOT NULL,
      document_path TEXT NOT NULL,
      document_body_snapshot TEXT NOT NULL,
      user_note TEXT,
      payload_json TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
    CREATE TABLE design_checkpoint_preference (
      project_id TEXT PRIMARY KEY,
      wireframe_auto_skip INTEGER NOT NULL DEFAULT 0 CHECK(wireframe_auto_skip IN (0, 1)),
      updated_at INTEGER NOT NULL
    );
  `);
}

function createWireframeCheckpoint() {
  return service.createWireframeCheckpoint({
    projectId: 'project-1',
    meetingId: 'meeting-1',
    channelId: 'channel-design',
    title: '와이어프레임 확인',
    documentPath: '/project/consensus/meetings/meeting-1/minutes-1.md',
    documentBodySnapshot: '# wireframe minutes',
    payloadJson: JSON.stringify({
      source: 'design_wireframe_minutes',
      meetingOrdinal: 1,
    }),
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  createSchema();
  now = 1_700_000_000_000;
  service = new DesignCheckpointService(
    new DesignCheckpointRepository(db),
    () => now,
  );
});

afterEach(() => {
  db.close();
});

describe('DesignCheckpointService', () => {
  it('와이어프레임 checkpoint를 pending 상태로 생성한다', () => {
    const result = createWireframeCheckpoint();

    expect(result.shouldShowNotice).toBe(true);
    expect(result.checkpoint).toMatchObject({
      projectId: 'project-1',
      meetingId: 'meeting-1',
      channelId: 'channel-design',
      kind: 'wireframe',
      status: 'pending',
      title: '와이어프레임 확인',
      documentBodySnapshot: '# wireframe minutes',
      userNote: null,
      createdAt: now,
      decidedAt: null,
    });
    expect(service.listForDesignCheckRequest({
      projectId: 'project-1',
      meetingId: 'meeting-1',
    })).toHaveLength(1);
  });

  it('이대로 계속 결정을 저장한다', () => {
    const { checkpoint } = createWireframeCheckpoint();
    now += 10;

    const updated = service.decide({
      id: checkpoint.id,
      decision: 'continue',
    });

    expect(updated.status).toBe('continued');
    expect(updated.userNote).toBeNull();
    expect(updated.decidedAt).toBe(now);
  });

  it('수정 지시하기 note를 trim해서 저장한다', () => {
    const { checkpoint } = createWireframeCheckpoint();
    now += 10;

    const updated = service.decide({
      id: checkpoint.id,
      decision: 'request_revision',
      note: '  CTA를 화면 아래쪽으로 내려줘.  ',
    });

    expect(updated.status).toBe('revision_requested');
    expect(updated.userNote).toBe('CTA를 화면 아래쪽으로 내려줘.');
    expect(updated.decidedAt).toBe(now);
  });

  it('이미 처리된 checkpoint의 중복 결정을 막는다', () => {
    const { checkpoint } = createWireframeCheckpoint();
    service.decide({ id: checkpoint.id, decision: 'continue' });

    expect(() =>
      service.decide({
        id: checkpoint.id,
        decision: 'request_revision',
        note: '다시 저장하면 안 됨',
      }),
    ).toThrow(DesignCheckpointNotPendingError);
  });

  it('나중부터 자동 진행 선택을 프로젝트 선호로 저장하고 다음 checkpoint를 자동 skip한다', () => {
    const { checkpoint } = createWireframeCheckpoint();
    now += 10;

    const updated = service.decide({
      id: checkpoint.id,
      decision: 'auto_skip',
    });

    expect(updated.status).toBe('auto_skipped');
    expect(service.isWireframeAutoSkipEnabled('project-1')).toBe(true);

    now += 10;
    const next = createWireframeCheckpoint();
    expect(next.shouldShowNotice).toBe(false);
    expect(next.checkpoint.status).toBe('auto_skipped');
    expect(next.checkpoint.decidedAt).toBe(now);
  });
});
