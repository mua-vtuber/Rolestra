/**
 * Onboarding fixtures — hardcoded sample data matching docs/Rolestra_sample/06.
 *
 * Per `2026-04-19-theme-alignment-checklist.md` we explicitly DROP the
 * `STAFF_CANDIDATES[].color` visual hint from the source mockup — selection
 * mark color comes from theme tokens (selected=brand, detected=success)
 * instead. Card chrome (panelClip / corner brackets / border radius) flows
 * through the existing 10 form-level discriminators; no new tokens needed.
 *
 * Real provider detection wires up in R12+; until then this module exports
 * static constants so the Onboarding screens can render at design-polish
 * fidelity without an IPC dependency.
 */

export type OBStepStatus = 'pending' | 'current' | 'completed';

export interface OBStep {
  id: number;
  /** i18n key suffix (e.g. `'office'` → `t('onboarding.steps.office')`). */
  key: string;
  status: OBStepStatus;
}

export interface StaffCandidate {
  id: string;
  name: string;
  vendor: string;
  /** One-line personality / strengths (e.g. "사려 깊은 시니어"). */
  tagline: string;
  /** Best-for keyword string (already comma-joined). */
  bestFor: string;
  /** Plan label (e.g. "$20/mo · Pro", "무료"). */
  price: string;
  /** Single-letter avatar fallback. */
  initial: string;
  /** True if Rolestra detected this CLI/runtime locally. */
  detected: boolean;
  /** Initial selection state (user can toggle in OnboardingPage state). */
  selected: boolean;
}

export const ONBOARDING_STEPS: ReadonlyArray<OBStep> = [
  { id: 1, key: 'office', status: 'completed' },
  { id: 2, key: 'staff', status: 'current' },
  { id: 3, key: 'roles', status: 'pending' },
  { id: 4, key: 'permissions', status: 'pending' },
  { id: 5, key: 'firstProject', status: 'pending' },
];

export const STAFF_CANDIDATES: ReadonlyArray<StaffCandidate> = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    tagline: '사려 깊은 시니어 · 설명 장인',
    bestFor: '리팩토링, 아키텍처 리뷰, 문서화',
    price: '$20/mo · Pro',
    initial: 'C',
    detected: true,
    selected: true,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    tagline: '멀티모달 · 빠른 반응',
    bestFor: 'UX 탐색, 이미지 분석, 긴 컨텍스트',
    price: '$20/mo',
    initial: 'G',
    detected: true,
    selected: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    tagline: '꼼꼼한 엔지니어 · 테스트 좋아함',
    bestFor: '백엔드, 알고리즘, 성능 최적화',
    price: '$20/mo · Plus',
    initial: 'O',
    detected: true,
    selected: true,
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    vendor: 'GitHub',
    tagline: 'VS Code와 잘 맞음',
    bestFor: '자동 완성, 간단한 리팩토링',
    price: '$10/mo',
    initial: 'H',
    detected: false,
    selected: false,
  },
  {
    id: 'local',
    name: 'Local (Ollama)',
    vendor: '내 컴퓨터',
    tagline: '느리지만 성실한 인턴',
    bestFor: '문서 요약, 오프라인 작업',
    price: '무료',
    initial: 'L',
    detected: true,
    selected: true,
  },
  {
    id: 'grok',
    name: 'Grok CLI',
    vendor: 'xAI',
    tagline: '실시간 정보 · 장난기',
    bestFor: '리서치, 트렌드 추적',
    price: '$30/mo · Premium+',
    initial: 'X',
    detected: false,
    selected: false,
  },
];

export type DetectionState = 'selected' | 'detected' | 'alt';

export function detectionStateOf(c: StaffCandidate): DetectionState {
  if (c.selected) return 'selected';
  if (c.detected) return 'detected';
  return 'alt';
}
