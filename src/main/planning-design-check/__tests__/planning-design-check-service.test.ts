import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesignCheckpointRepository } from '../../design-checkpoints/design-checkpoint-repository';
import { DesignCheckpointService } from '../../design-checkpoints/design-checkpoint-service';
import { PlanningDesignCheckRepository } from '../planning-design-check-repository';
import { PlanningDesignCheckService } from '../planning-design-check-service';

let db: Database.Database;
let checkpointService: DesignCheckpointService;
let service: PlanningDesignCheckService;
let now = 1_700_000_000_000;

function createSchema(): void {
  db.exec(`
    CREATE TABLE design_checkpoint (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
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
      wireframe_auto_skip INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE planning_design_check (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_design_meeting_id TEXT NOT NULL,
      design_channel_id TEXT NOT NULL,
      design_channel_role TEXT NOT NULL,
      planning_channel_id TEXT NOT NULL,
      implementation_channel_id TEXT,
      request_title TEXT NOT NULL,
      request_body TEXT NOT NULL,
      final_design_minutes_path TEXT NOT NULL,
      final_design_minutes_body TEXT NOT NULL,
      snapshot_desktop_path TEXT,
      snapshot_mobile_path TEXT,
      wireframe_checkpoints_json TEXT NOT NULL,
      wireframe_user_notes_json TEXT NOT NULL,
      work_bundle_key TEXT,
      original_planning_minutes_id TEXT,
      original_planning_minutes_path TEXT,
      original_planning_minutes_body TEXT,
      original_planning_minutes_missing_reason TEXT,
      return_count INTEGER NOT NULL DEFAULT 0,
      verdict TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      revision_direction TEXT,
      implementation_dispatch_id TEXT,
      design_return_dispatch_id TEXT,
      user_decision TEXT,
      user_decision_note TEXT,
      user_decision_dispatch_id TEXT,
      payload_json TEXT,
      created_at INTEGER NOT NULL,
      decided_at INTEGER
    );
  `);
}

function createRequest() {
  return service.createRequest({
    projectId: 'project-1',
    sourceDesignMeetingId: 'design-meeting-1',
    designChannelId: 'design-channel',
    designChannelRole: 'design.ui',
    planningChannelId: 'planning-channel',
    implementationChannelId: 'implement-channel',
    finalDesignMinutesPath: '/arena/consensus/design-meeting-1/minutes-2.md',
    finalDesignMinutesBody: '# final design',
    workBundleKey: 'planning-minutes:planning-meeting-1',
    originalPlanningMinutesId: 'planning-meeting-1',
    originalPlanningMinutesPath:
      '/arena/consensus/planning-meeting-1/minutes.md',
    originalPlanningMinutesBody: '# original planning\n업무 도구 밀도 유지',
    snapshotDesktopPath: '/arena/snapshots/desktop.png',
    snapshotMobilePath: '/arena/snapshots/mobile.png',
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  createSchema();
  now = 1_700_000_000_000;
  checkpointService = new DesignCheckpointService(
    new DesignCheckpointRepository(db),
    () => now,
  );
  service = new PlanningDesignCheckService(
    new PlanningDesignCheckRepository(db),
    checkpointService,
    () => now,
  );
});

afterEach(() => {
  db.close();
});

describe('PlanningDesignCheckService', () => {
  it('디자인 검수 요청서를 생성하고 snapshot과 최종 회의록을 저장한다', () => {
    const record = createRequest();

    expect(record.requestTitle).toBe('디자인 검수 요청서');
    expect(record.status).toBe('request_created');
    expect(record.finalDesignMinutesBody).toContain('final design');
    expect(record.originalPlanningMinutesBody).toContain('업무 도구 밀도');
    expect(record.requestBody).toContain('## 원래 기획 회의록');
    expect(record.requestBody).toContain('/arena/consensus/planning-meeting-1');
    expect(record.snapshotDesktopPath).toContain('desktop.png');
    expect(record.snapshotMobilePath).toContain('mobile.png');
    expect(record.returnCount).toBe(0);
  });

  it('wireframe checkpoint의 revision_requested userNote를 포함한다', () => {
    const { checkpoint } = checkpointService.createWireframeCheckpoint({
      projectId: 'project-1',
      meetingId: 'design-meeting-1',
      channelId: 'design-channel',
      title: '와이어프레임 확인',
      documentPath: '/arena/wireframe.md',
      documentBodySnapshot: '# wireframe',
    });
    now += 10;
    checkpointService.decide({
      id: checkpoint.id,
      decision: 'request_revision',
      note: '목록 밀도를 높여줘.',
    });

    const record = createRequest();
    const notes = JSON.parse(record.wireframeUserNotesJson) as Array<{
      userNote: string;
    }>;

    expect(notes).toEqual([
      expect.objectContaining({ userNote: '목록 밀도를 높여줘.' }),
    ]);
    expect(record.requestBody).toContain('목록 밀도를 높여줘.');
  });

  it('aligned 결과를 저장한다', () => {
    const request = createRequest();
    now += 10;

    const aligned = service.recordAligned({
      id: request.id,
      reason: '기획 의도와 화면 밀도가 일치함',
    });

    expect(aligned.status).toBe('aligned');
    expect(aligned.verdict).toBe('aligned');
    expect(aligned.reason).toBe('기획 의도와 화면 밀도가 일치함');
    expect(aligned.decidedAt).toBe(now);
  });

  it('사용자 판단 필요로 전환해도 이미 나온 aligned 판단은 보존한다', () => {
    const request = createRequest();
    const aligned = service.recordAligned({
      id: request.id,
      reason: '기획 의도와 화면 밀도가 일치함',
    });
    now += 10;

    const needsUser = service.recordNeedsUserDecision({
      id: aligned.id,
      reason: '구현 부서 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
    });

    expect(needsUser.status).toBe('needs_user_decision');
    expect(needsUser.verdict).toBe('aligned');
    expect(needsUser.reason).toBe(
      '구현 부서 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
    );
  });

  it('첫 misaligned 결과는 디자인 되돌림으로 저장하고 returnCount를 1로 올린다', () => {
    const request = createRequest();
    now += 10;

    const result = service.recordMisaligned({
      id: request.id,
      reason: '소개 페이지처럼 보여 업무 도구 의도와 다름',
      revisionDirection: '대시보드 밀도를 높이고 장식 요소를 줄이기',
    });

    expect(result.action).toBe('return_to_design');
    expect(result.record.status).toBe('returned_to_design');
    expect(result.record.verdict).toBe('misaligned');
    expect(result.record.returnCount).toBe(1);
    expect(result.record.revisionDirection).toContain('대시보드');
  });

  it('두 번째 misaligned 결과는 자동 되돌림 없이 사용자 판단 필요로 저장한다', () => {
    const first = createRequest();
    service.recordMisaligned({
      id: first.id,
      reason: '첫 불일치',
      revisionDirection: '다시 디자인',
    });
    const second = createRequest();
    now += 10;

    const result = service.recordMisaligned({
      id: second.id,
      reason: '재작업 후에도 의도와 다름',
      revisionDirection: '사용자 판단 필요',
    });

    expect(second.returnCount).toBe(1);
    expect(result.action).toBe('needs_user_decision');
    expect(result.record.status).toBe('needs_user_decision');
    expect(result.record.verdict).toBe('misaligned');
    expect(result.record.returnCount).toBe(1);
  });

  it('사용자 개입 기록이 없어도 요청서 생성에 성공한다', () => {
    const record = createRequest();

    expect(record.wireframeCheckpointsJson).toBe('[]');
    expect(record.wireframeUserNotesJson).toBe('[]');
    expect(record.requestBody).toContain('(기록 없음)');
  });

  it('원래 기획 회의록을 찾지 못한 사유를 요청서에 명확히 남긴다', () => {
    const record = service.createRequest({
      projectId: 'project-1',
      sourceDesignMeetingId: 'design-meeting-missing-planning',
      designChannelId: 'design-channel',
      designChannelRole: 'design.ui',
      planningChannelId: 'planning-channel',
      implementationChannelId: 'implement-channel',
      finalDesignMinutesPath:
        '/arena/consensus/design-meeting-missing-planning/minutes-2.md',
      finalDesignMinutesBody: '# final design',
      workBundleKey: 'source-handoff:missing',
      originalPlanningMinutesMissingReason:
        '기획 인계서에 회의록 본문이 없습니다.',
    });

    expect(record.originalPlanningMinutesBody).toBeNull();
    expect(record.requestBody).toContain('원래 기획 회의록');
    expect(record.requestBody).toContain('기획 인계서에 회의록 본문이 없습니다.');
  });

  it('다른 작업 묶음은 이전 디자인 되돌림 기록 때문에 막히지 않는다', () => {
    const first = createRequest();
    service.recordMisaligned({
      id: first.id,
      reason: '첫 묶음 불일치',
      revisionDirection: '다시 디자인',
    });

    const other = service.createRequest({
      projectId: 'project-1',
      sourceDesignMeetingId: 'design-meeting-2',
      designChannelId: 'design-channel',
      designChannelRole: 'design.ui',
      planningChannelId: 'planning-channel',
      implementationChannelId: 'implement-channel',
      finalDesignMinutesPath: '/arena/consensus/design-meeting-2/minutes-2.md',
      finalDesignMinutesBody: '# final design 2',
      workBundleKey: 'planning-minutes:planning-meeting-2',
      originalPlanningMinutesId: 'planning-meeting-2',
      originalPlanningMinutesPath:
        '/arena/consensus/planning-meeting-2/minutes.md',
      originalPlanningMinutesBody: '# other planning',
    });

    expect(other.returnCount).toBe(0);
    const result = service.recordMisaligned({
      id: other.id,
      reason: '다른 묶음 첫 불일치',
      revisionDirection: '다른 묶음은 한 번 되돌림 가능',
    });
    expect(result.action).toBe('return_to_design');
  });

  it('사용자 판단 결과를 각각 저장한다', () => {
    const implementation = service.recordNeedsUserDecision({
      id: createRequest().id,
      reason: '두 번째 불일치',
    });
    const sent = service.recordUserDecision({
      id: implementation.id,
      decision: 'send_to_implementation',
      dispatchId: 'dispatch-implement',
    });
    expect(sent.userDecision).toBe('send_to_implementation');
    expect(sent.userDecisionDispatchId).toBe('dispatch-implement');

    const designRevision = service.recordNeedsUserDecision({
      id: service.createRequest({
        ...baseCreateInput(),
        sourceDesignMeetingId: 'design-meeting-3',
        workBundleKey: 'planning-minutes:planning-meeting-3',
        originalPlanningMinutesId: 'planning-meeting-3',
      }).id,
      reason: '사용자 판단',
    });
    const revised = service.recordUserDecision({
      id: designRevision.id,
      decision: 'request_design_revision',
      userNote: 'CTA 밀도를 낮춰줘.',
      dispatchId: 'dispatch-design',
    });
    expect(revised.userDecision).toBe('request_design_revision');
    expect(revised.userDecisionNote).toBe('CTA 밀도를 낮춰줘.');

    const stop = service.recordNeedsUserDecision({
      id: service.createRequest({
        ...baseCreateInput(),
        sourceDesignMeetingId: 'design-meeting-4',
        workBundleKey: 'planning-minutes:planning-meeting-4',
        originalPlanningMinutesId: 'planning-meeting-4',
      }).id,
      reason: '사용자 판단',
    });
    const stopped = service.recordUserDecision({
      id: stop.id,
      decision: 'stop',
    });
    expect(stopped.userDecision).toBe('stop');
    expect(stopped.userDecisionDispatchId).toBeNull();
  });
});

function baseCreateInput() {
  return {
    projectId: 'project-1',
    sourceDesignMeetingId: 'design-meeting-base',
    designChannelId: 'design-channel',
    designChannelRole: 'design.ui' as const,
    planningChannelId: 'planning-channel',
    implementationChannelId: 'implement-channel',
    finalDesignMinutesPath: '/arena/consensus/design-meeting-base/minutes-2.md',
    finalDesignMinutesBody: '# final design',
    workBundleKey: 'planning-minutes:planning-meeting-base',
    originalPlanningMinutesId: 'planning-meeting-base',
    originalPlanningMinutesPath:
      '/arena/consensus/planning-meeting-base/minutes.md',
    originalPlanningMinutesBody: '# original planning',
  };
}
