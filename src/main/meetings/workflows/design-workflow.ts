/**
 * design-workflow — R12-C2 P3 T16 land. spec §5.2 / §11.18.9.
 *
 * 디자인 부서 (channel.role === 'design') 7 단계 흐름. 풀세트 부서 (planning /
 * review / audit) 의 5+2.5 phase loop 를 두 번 거치면서, 그 사이/후로 시스템→
 * 지정 직원 단일 turn 지시 (`assigning_designated_task`) 와 Playwright PNG
 * 생성 (`generating_snapshot`) phase 가 끼워진다.
 *
 *   step 1.  assigning_designated_task (wireframe_drafting)
 *           → UX 직원 단일 turn → 와이어프레임 root opinion 등록
 *   step 2-4. quick_vote → free_discussion → compose_minutes (회의 #1 — 와이어프레임)
 *   step 5.  assigning_designated_task (wireframe_revision)
 *           → UI 직원 단일 turn → 합의 반영 와이어프레임 (회의 #1 종결 후)
 *   step 6.  assigning_designated_task (design_implementation)
 *           → UI 직원 단일 turn → HTML/CSS root opinion 등록
 *   step 7.  quick_vote → free_discussion → compose_minutes (회의 #2 — 디자인)
 *           → generating_snapshot → handoff
 *
 * 본 모듈은 *types + 순수 helper* 위주 — orchestrator-side runtime logic 은
 * T16b 에서 wire (idea-workflow 와 같은 thin extension 설계). T16c 가
 * playwright-snapshot.ts + DesignPreview UI 를 추가.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §4    부서별 회의 매트릭스 (design = 7 단계 + Playwright)
 *  - §5.2  디자인 부서 7 단계 (R12-C2 정식)
 *  - §11.13 SsmBox design variant layout (T18 land)
 *  - §11.18.9 designated-task 직원 응답 schema + generating_snapshot phase (Step6DesignedTaskSchema)
 */

import type {
  DesignedTaskKind,
  Step6DesignedTaskSchemaType,
} from '../../../shared/meeting-flow-types';

// ── 결과 타입 ─────────────────────────────────────────────────────

/**
 * design-workflow 진행 결과 — orchestrator (T16b wire) 가 finalize 단계에서
 * outcome 반환에 활용. idea-workflow (`IdeaWorkflowResult`) 와 같은 패턴.
 */
export interface DesignWorkflowResult {
  meetingId: string;
  outcome: 'committed' | 'aborted';
  /** outcome === 'committed' 일 때 — 생성된 PNG 파일 절대 경로. */
  snapshot?: DesignSnapshotPaths;
  /** outcome === 'aborted' 일 때 — abort 단계 (어느 phase / sub-kind). */
  abortReason?: DesignWorkflowAbortReason;
}

/**
 * Playwright snapshot 결과 — desktop + mobile 두 viewport 절대 경로. ArenaRoot
 * 봉인 안 (PathGuard 검증). file:// URL 변환은 UI (DesignPreview, T16c) 책임.
 *
 * spec §11.18.9d — desktop 1280x720 / mobile 375x812.
 */
export interface DesignSnapshotPaths {
  desktopPath: string;
  mobilePath: string;
  generatedAt: number;
  /** PNG 생성 source — opinion #2 의 HTML/CSS root uuid (audit). */
  sourceOpinionUuid: string;
}

/**
 * design-workflow 중단 사유 — orchestrator stop() / 직원 응답 실패 / 깊이 cap
 * 위반 / snapshot 실패 등 분기.
 */
export type DesignWorkflowAbortReason =
  | { kind: 'aborted' }
  | {
      kind: 'designated_task_failed';
      taskKind: DesignedTaskKind;
      meetingOrdinal: 1 | 2;
      message: string;
    }
  | { kind: 'snapshot_failed'; message: string }
  | { kind: 'replaced'; message: string };

// ── designated-task context ──────────────────────────────────────────

/**
 * `assigning_designated_task` phase 진입 시 orchestrator 가 channel/회의 정보
 * 와 sub-kind / meeting-ordinal 묶어 prompt builder 에 전달하는 컨텍스트.
 *
 * `priorContent` 는 sub-kind 분기:
 *   - wireframe_drafting:    상위 부서 (기획) 인계서 본문 (planning handoff)
 *   - wireframe_revision:    회의 #1 합의 회의록 (compose_minutes 결과)
 *   - design_implementation: 회의 #1 합의 + 회의 #1 종결 후 step 5 의 수정된
 *                            와이어프레임 본문 (UI 직원이 직전 turn 에서 produce
 *                            한 root opinion content)
 *
 * orchestrator (T16b) 가 회의 lifetime 안에서 prior content 를 모아 본 객체로
 * 넘긴다. 본 모듈은 prompt builder 의 입력 컨트랙트만 정의 — 데이터 lookup
 * 자체는 orchestrator 책임.
 */
export interface DesignedTaskContext {
  /** 어느 sub-kind 인지 (3 종 중 하나). */
  kind: DesignedTaskKind;
  /** 어느 회의 ordinal 안의 task 인지. step 1 = 1, step 5/6 = 1→2 사이. */
  meetingOrdinal: 1 | 2;
  /**
   * sub-kind 분기에 따른 prior 콘텐츠. 빈 문자열 허용 (e.g. 기획 인계서 X 시
   * 직접 사용자 발화로 회의 시작된 흐름) — prompt 가 "참고 자료 없음" 표기.
   */
  priorContent: string;
  /** 발화자 이름 (provider displayName) — prompt 안 직원 식별. */
  speakerDisplayName: string;
  /** 발화 ID (예: `gemini_1`) — opinion label 자리. */
  suggestedLabel: string;
}

// ── prompt builder — sub-kind 분기 ───────────────────────────────────

/**
 * `assigning_designated_task` phase 의 직원 prompt body 작성. sub-kind 별
 * 다른 미션 + 같은 응답 JSON schema (Step6 = Step1 alias) 안내.
 *
 * 응답 형식은 buildGatherPromptBody (turn-executor) 와 정합 — orchestrator
 * 가 같은 OpinionGather pipeline 으로 root opinion 등록.
 */
export function buildDesignedTaskPromptBody(ctx: DesignedTaskContext): string {
  const lines: string[] = [];

  lines.push(`[현재 단계: 디자인 부서 — ${headerForKind(ctx.kind)}]`);
  lines.push('');

  // sub-kind 별 미션 본문
  lines.push(missionForKind(ctx.kind));
  lines.push('');

  // 참고 자료 — priorContent
  lines.push('[참고 자료]');
  lines.push(ctx.priorContent.trim() || '(없음 — 회의 진입 발화만 참고)');
  lines.push('');

  // 응답 형식 안내 (Step1 = Step6 schema)
  lines.push(
    '응답은 *JSON 한 객체만* — markdown code fence 사용 금지, JSON 외 본문 금지.',
  );
  lines.push('');
  lines.push('```json (스키마 — 그대로 따르기)');
  lines.push('{');
  lines.push(`  "name": "${escapeForPrompt(ctx.speakerDisplayName)}",`);
  lines.push(`  "label": "${escapeForPrompt(ctx.suggestedLabel)}",`);
  lines.push('  "opinions": [');
  lines.push('    {');
  lines.push(`      "title": "${titleHintForKind(ctx.kind)}",`);
  lines.push(`      "content": "${contentHintForKind(ctx.kind)}",`);
  lines.push('      "rationale": "<선택 근거 / 디자인 의도>"');
  lines.push('    }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    '`opinions` 배열 길이 = 1 권장 (단일 root 의견). 본문 / 근거 통째 보존 — 요약 / 축약 금지.',
  );
  return lines.join('\n');
}

function headerForKind(kind: DesignedTaskKind): string {
  switch (kind) {
    case 'wireframe_drafting':
      return 'step 1 — UX 와이어프레임 작성';
    case 'wireframe_revision':
      return 'step 5 — 와이어프레임 수정 (회의 #1 합의 반영)';
    case 'design_implementation':
      return 'step 6 — UI 디자인 (HTML/CSS) 작성';
  }
}

function missionForKind(kind: DesignedTaskKind): string {
  switch (kind) {
    case 'wireframe_drafting':
      return [
        '[미션]',
        '아래 [참고 자료] 의 기획 인계서를 읽고, 그에 부합하는 *와이어프레임*을',
        '작성하세요. 와이어프레임은 화면 구조 + 컴포넌트 배치 + 사용자 흐름을',
        '텍스트로 표현 (ASCII tree / 구조 outline / 화면별 영역 description).',
        '시각 mockup 은 다음 단계 (UI 직원, step 6) 가 담당합니다.',
      ].join('\n');
    case 'wireframe_revision':
      return [
        '[미션]',
        '아래 [참고 자료] 의 *와이어프레임 회의 합의 회의록* 을 읽고, 그 합의 결과를',
        '반영해 *수정된 와이어프레임* 을 작성하세요. 합의된 변경 사항을 모두',
        '반영하되, 합의되지 않은 부분은 직전 와이어프레임 그대로 유지.',
      ].join('\n');
    case 'design_implementation':
      return [
        '[미션]',
        '아래 [참고 자료] 의 *수정된 와이어프레임* 을 읽고, 그에 부합하는 실제',
        '*HTML/CSS* 를 작성하세요. content 필드 안에 HTML + CSS 통째 포함 (style',
        '태그 또는 inline). 이 결과는 Playwright 가 desktop (1280x720) 과',
        'mobile (375x812) PNG 로 렌더링합니다 — 두 viewport 모두 적절히',
        '동작하도록 responsive 처리 권장.',
      ].join('\n');
  }
}

function titleHintForKind(kind: DesignedTaskKind): string {
  switch (kind) {
    case 'wireframe_drafting':
      return '<와이어프레임 제목>';
    case 'wireframe_revision':
      return '<수정된 와이어프레임 제목>';
    case 'design_implementation':
      return '<UI 디자인 제목>';
  }
}

function contentHintForKind(kind: DesignedTaskKind): string {
  switch (kind) {
    case 'wireframe_drafting':
    case 'wireframe_revision':
      return '<와이어프레임 본문 — 통째 / truncate 금지>';
    case 'design_implementation':
      return '<HTML + CSS 통째 — truncate 금지>';
  }
}

function escapeForPrompt(value: string): string {
  // \ → \\ + " → \" 만 — JSON literal 안 안전 noun.
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── opinion 추출 — Step6 response → OpinionGather 입력 ──────────────

/**
 * 직원이 `Step6DesignedTaskSchema` 응답을 보냈을 때 첫 번째 opinion 만 추출.
 * (designated-task 는 single root opinion 권장 — 직원이 여러 opinion 보낸
 * 경우 첫 1 건만 사용 + 나머지 silent drop. 이건 prompt 가 강하게 "= 1" 요구
 * 하므로 거의 발생 X.)
 *
 * 빈 opinions 배열 → null 반환 — caller 가 직원 거부로 처리 + 1 회 재요청.
 */
export function extractDesignedTaskOpinion(
  payload: Step6DesignedTaskSchemaType,
): { title: string; content: string; rationale: string } | null {
  const first = payload.opinions[0];
  if (!first) return null;
  return {
    title: first.title,
    content: first.content,
    rationale: first.rationale,
  };
}
