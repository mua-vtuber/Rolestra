/**
 * extractNextActions 단위 테스트 — R12-C2 P6 T29 land.
 *
 * 검증:
 *   - 'spec' payload   → expectedOutputs 그대로
 *   - 'fix' payload    → problem 1-line summary + expectedOutputs 병합
 *   - 'fix' blank title → "(제목 없음)" normalize
 *   - 'change-request' → expectedOutputs 그대로 (body 별도)
 *   - 빈 expectedOutputs / 빈 problemList = 1+ (fix invariant) 처리
 */

import { describe, expect, it } from 'vitest';
import { extractNextActions } from '../next-actions';
import type {
  ChangeRequestMissionPayload,
  FixMissionPayload,
  SpecMissionPayload,
} from '../../schema/mission-card';

describe('extractNextActions', () => {
  it("'spec' payload → expectedOutputs 그대로", () => {
    const payload: SpecMissionPayload = {
      kind: 'spec',
      body: 'WebView2 단일 사용 결정 본문',
      inputFiles: [],
      expectedOutputs: [
        'src/main/web-view-bridge.ts new file',
        'test coverage ≥ 80%',
      ],
      rootOpinionId: 'op-root',
      planningMinutesMarkdown:
        '## [합의]\n- 의견 1\n## [제외]\n(없음)\n',
    };
    expect(extractNextActions(payload)).toEqual([
      'src/main/web-view-bridge.ts new file',
      'test coverage ≥ 80%',
    ]);
  });

  it("'fix' payload → problem 1-line summary + expectedOutputs 병합", () => {
    const payload: FixMissionPayload = {
      kind: 'fix',
      body: '검토 NG — 2 건',
      inputFiles: [],
      expectedOutputs: ['처리 작업 분배', '재기획 회의록'],
      auditMinutesMarkdown:
        '## [합의]\n- 문제 2 건\n## [제외]\n(없음)\n',
      problemList: [
        { opinionId: 'op-A', title: '하드코딩 발견', content: 'src/foo.ts:42' },
        { opinionId: 'op-B', title: '메모리 누수', content: 'src/bar.ts:99' },
      ],
    };
    expect(extractNextActions(payload)).toEqual([
      '문제 처리: (op-A) 하드코딩 발견',
      '문제 처리: (op-B) 메모리 누수',
      '산출: 처리 작업 분배',
      '산출: 재기획 회의록',
    ]);
  });

  it("'fix' blank title → '(제목 없음)' normalize", () => {
    const payload: FixMissionPayload = {
      kind: 'fix',
      body: '검토 NG — 1 건',
      inputFiles: [],
      expectedOutputs: ['처리 작업 분배'],
      auditMinutesMarkdown:
        '## [합의]\n- 문제 1 건\n## [제외]\n(없음)\n',
      problemList: [
        { opinionId: 'op-X', title: '   ', content: 'src/baz.ts:1' },
      ],
    };
    expect(extractNextActions(payload)).toEqual([
      '문제 처리: (op-X) (제목 없음)',
      '산출: 처리 작업 분배',
    ]);
  });

  it("'change-request' payload → expectedOutputs 그대로", () => {
    const payload: ChangeRequestMissionPayload = {
      kind: 'change-request',
      body: '사용자 변경 요청 본문',
      inputFiles: ['src/foo.ts'],
      expectedOutputs: ['수정 PR'],
      userMessage: '이 부분 다시 봐주세요',
    };
    expect(extractNextActions(payload)).toEqual(['수정 PR']);
  });

  it("'change-request' empty expectedOutputs → 빈 배열", () => {
    const payload: ChangeRequestMissionPayload = {
      kind: 'change-request',
      body: '사용자 변경 요청 본문',
      inputFiles: [],
      expectedOutputs: [],
      userMessage: '...',
    };
    expect(extractNextActions(payload)).toEqual([]);
  });

  it("'spec' empty expectedOutputs → 빈 배열", () => {
    const payload: SpecMissionPayload = {
      kind: 'spec',
      body: '...',
      inputFiles: [],
      expectedOutputs: [],
      rootOpinionId: 'op-root',
      planningMinutesMarkdown: '## [합의]\n(없음)\n## [제외]\n(없음)\n',
    };
    expect(extractNextActions(payload)).toEqual([]);
  });
});
