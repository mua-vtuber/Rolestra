/**
 * HandoffPendingState 단위 테스트 — R12-C2 P6 T28 land.
 *
 * 검증:
 *   - put 정상         — 등록 후 get / hasPending true / listByReceiverChannel 1 건
 *   - put 중복         — 같은 meetingId 두 번 → throw (silent overwrite 금지)
 *   - put meetingId mismatch — pkg.sender.meetingId != meetingId → throw
 *   - put blank meetingId    → throw
 *   - get 미존재       → null
 *   - take 정상        — 반환 후 메모리에서 제거
 *   - take 미존재      → null (no-op)
 *   - hasPending       — put / take 전후 상태
 *   - listByReceiverChannel — 다른 채널의 pending 은 포함 X
 *   - clear            — 모두 비움
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  HandoffPendingState,
  HandoffPendingStateInvariantError,
} from '../handoff-pending-state';
import type { HandoffPackage } from '../../../shared/schema/handoff-package';
import {
  buildMissionCard,
  type FixMissionPayload,
} from '../../../shared/schema/mission-card';

const FIXED_NOW = 1_700_000_000_000;
const MISSION_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function buildPkg(override: Partial<HandoffPackage> = {}): HandoffPackage {
  const fixPayload: FixMissionPayload = {
    kind: 'fix',
    body: '검토 NG — 1 건',
    inputFiles: [],
    expectedOutputs: ['처리 작업 분배', '재기획 회의록'],
    auditMinutesMarkdown: '## [합의]\n- 문제 1 건\n## [제외]\n(없음)\n',
    problemList: [
      { opinionId: 'op-A', title: '하드코딩', content: 'src/foo.ts:42' },
    ],
  };
  const missionCard = buildMissionCard({
    id: MISSION_UUID,
    payload: fixPayload,
    assignedProviderId: 'codex',
    targetChannelId: 'planning-channel-1',
    createdAt: FIXED_NOW,
  });
  return {
    sender: {
      meetingId: 'audit-meeting-1',
      channelId: 'audit-channel-1',
      channelRole: 'audit',
    },
    target: {
      channelId: 'planning-channel-1',
      channelRole: 'planning',
    },
    reason: '검토 NG 판정 — 1 건',
    minutesMeetingId: 'audit-meeting-1',
    nextActions: [],
    missionCard,
    mode: 'check',
    dispatchedAt: FIXED_NOW,
    ...override,
  };
}

describe('HandoffPendingState', () => {
  let state: HandoffPendingState;

  beforeEach(() => {
    state = new HandoffPendingState();
  });

  it('put 정상 + get / hasPending / listByReceiverChannel', () => {
    const pkg = buildPkg();
    state.put('audit-meeting-1', pkg);
    expect(state.get('audit-meeting-1')).toEqual(pkg);
    expect(state.hasPending('audit-meeting-1')).toBe(true);
    expect(state.listByReceiverChannel('planning-channel-1')).toEqual([pkg]);
  });

  it('put 중복 → throw (silent overwrite 금지)', () => {
    const pkg = buildPkg();
    state.put('audit-meeting-1', pkg);
    expect(() => state.put('audit-meeting-1', pkg)).toThrow(
      HandoffPendingStateInvariantError,
    );
  });

  it('put meetingId 와 pkg.sender.meetingId 불일치 → throw', () => {
    const pkg = buildPkg(); // sender.meetingId = 'audit-meeting-1'
    expect(() => state.put('different-meeting', pkg)).toThrow(
      HandoffPendingStateInvariantError,
    );
  });

  it('put blank meetingId → throw', () => {
    const pkg = buildPkg();
    expect(() => state.put('   ', pkg)).toThrow(
      HandoffPendingStateInvariantError,
    );
  });

  it('get 미존재 → null', () => {
    expect(state.get('no-such-meeting')).toBeNull();
  });

  it('take 정상 — 반환 후 메모리에서 제거', () => {
    const pkg = buildPkg();
    state.put('audit-meeting-1', pkg);
    expect(state.take('audit-meeting-1')).toEqual(pkg);
    expect(state.get('audit-meeting-1')).toBeNull();
    expect(state.hasPending('audit-meeting-1')).toBe(false);
  });

  it('take 미존재 → null (no-op)', () => {
    expect(state.take('no-such-meeting')).toBeNull();
  });

  it('listByReceiverChannel — 다른 채널 의뢰서 미포함', () => {
    const pkgA = buildPkg();
    const pkgB = buildPkg({
      sender: {
        meetingId: 'audit-meeting-2',
        channelId: 'audit-channel-1',
        channelRole: 'audit',
      },
      target: { channelId: 'design-channel-1', channelRole: 'design.ui' },
      missionCard: buildMissionCard({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        payload: {
          kind: 'fix',
          body: '검토 NG — 다른 부서',
          inputFiles: [],
          expectedOutputs: ['x'],
          auditMinutesMarkdown: '## [합의]\n- 1 건\n## [제외]\n(없음)\n',
          problemList: [{ opinionId: 'op-X', title: 'x', content: 'x' }],
        },
        assignedProviderId: 'gemini',
        targetChannelId: 'design-channel-1',
        createdAt: FIXED_NOW,
      }),
    });
    state.put('audit-meeting-1', pkgA);
    state.put('audit-meeting-2', pkgB);
    expect(state.listByReceiverChannel('planning-channel-1')).toEqual([pkgA]);
    expect(state.listByReceiverChannel('design-channel-1')).toEqual([pkgB]);
    expect(state.listByReceiverChannel('no-such-channel')).toEqual([]);
  });

  it('clear — 모두 비움', () => {
    state.put('audit-meeting-1', buildPkg());
    expect(state.hasPending('audit-meeting-1')).toBe(true);
    state.clear();
    expect(state.hasPending('audit-meeting-1')).toBe(false);
  });
});
