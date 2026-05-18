/**
 * Provider capability resolver — endpoint / CLI command 별 실제 능력 매핑.
 *
 * 결재 3번 (A) — 능력표 채우기 (2026-05-19).
 *
 * 배경: R11-Task9 까지는 모든 provider 가 `['streaming', 'summarize']` 두
 * literal 만 advertise. 그러나 실제 코드는 다음 능력을 실제로 지원:
 *   - CLI provider (Claude / Codex / Gemini) → `resume` (persistent session
 *     ID 로 대화 이어가기), `tools` (CLI 내장 도구 호출), `code-execution`
 *     (Bash/Code 도구 — Claude/Codex 한정)
 *   - Anthropic API → `tools` (Messages API tool_use), `multimodal` (image
 *     input)
 *   - OpenAI API → `tools` (function calling), `multimodal` (vision),
 *     `json-mode` (response_format)
 *   - Google AI API → `tools` (function calling), `multimodal` (vision/audio)
 *   - OpenRouter → `tools` (모델별 가용 — 광고만)
 *
 * 이 매트릭스를 capability snapshot 에 정직하게 노출해 향후 capability-aware
 * 회의 라우팅 / 모더레이터 자동 분배 의 토대를 마련한다. 라벨이 실제와 같아야
 * 모더레이터가 "이 능력 가진 직원이 누구냐" 를 잘못 판단하지 않는다.
 *
 * 본 파일은 lookup matrix + helper 만 제공. provider class 의 capabilities
 * 필드는 factory.ts / api-provider.ts / local-provider.ts 가 본 helper 의
 * 결과를 그대로 사용한다.
 */

import type { ProviderCapability } from '../../shared/provider-types';

/** 모든 provider 공통 기본 능력 (스트리밍 + 1-shot 요약). */
const COMMON_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  'streaming',
  'summarize',
];

/** Anthropic Messages API endpoint capability. */
const ANTHROPIC_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'tools',
  'multimodal',
];

/** OpenAI Chat Completions API endpoint capability (response_format + vision). */
const OPENAI_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'tools',
  'multimodal',
  'json-mode',
];

/** Google Generative Language API capability (function calling + vision/audio). */
const GOOGLE_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'tools',
  'multimodal',
];

/** OpenRouter (OpenAI-compatible 멀티-provider proxy) capability — tools advertised. */
const OPENROUTER_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'tools',
];

/** Claude Code CLI capability (persistent session + Bash/Read/Write 도구 + code 실행). */
const CLAUDE_CLI_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'resume',
  'tools',
  'code-execution',
];

/** Codex CLI capability (persistent session + 코드 도구 + 코드 실행). */
const CODEX_CLI_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'resume',
  'tools',
  'code-execution',
];

/** Gemini CLI capability (persistent session + 도구). */
const GEMINI_CLI_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
  'resume',
  'tools',
];

/** Ollama 로컬 모델 capability — 모델 다양해 보수적 (streaming + summarize 만). */
const LOCAL_CAPABILITIES: ReadonlyArray<ProviderCapability> = [
  ...COMMON_CAPABILITIES,
];

/**
 * API endpoint URL 의 host 부분을 보고 능력 집합을 반환.
 *
 * 매칭 우선순위: 가장 구체적인 host 부터. Anthropic → OpenAI → Google →
 * OpenRouter → 기타 OpenAI-compatible (COMMON_CAPABILITIES 만).
 *
 * @param endpoint - API endpoint URL (예: `https://api.anthropic.com/v1/messages`)
 * @returns 해당 endpoint 의 실제 능력 집합 — 새 array (immutable view)
 */
export function resolveApiCapabilities(endpoint: string): ProviderCapability[] {
  const lower = endpoint.toLowerCase();

  if (lower.includes('anthropic.com')) {
    return [...ANTHROPIC_CAPABILITIES];
  }
  if (lower.includes('api.openai.com')) {
    return [...OPENAI_CAPABILITIES];
  }
  if (lower.includes('generativelanguage.googleapis.com')) {
    return [...GOOGLE_CAPABILITIES];
  }
  if (lower.includes('openrouter.ai')) {
    return [...OPENROUTER_CAPABILITIES];
  }

  // 알 수 없는 OpenAI-compatible endpoint — 보수적으로 공통 능력만.
  return [...COMMON_CAPABILITIES];
}

/**
 * CLI 명령 키 (normalized — 'claude' / 'codex' / 'gemini' / 기타) 로 능력 반환.
 *
 * commandKey 는 `factory.normalizeCliCommand()` 결과 와 동일한 lowercase 정규화
 * 형식이라고 가정한다.
 *
 * @param commandKey - normalized CLI command (예: 'claude' / 'codex' / 'gemini')
 * @returns 해당 CLI 의 실제 능력 집합 — 새 array
 */
export function resolveCliCapabilities(commandKey: string): ProviderCapability[] {
  switch (commandKey) {
    case 'claude':
      return [...CLAUDE_CLI_CAPABILITIES];
    case 'codex':
      return [...CODEX_CLI_CAPABILITIES];
    case 'gemini':
      return [...GEMINI_CLI_CAPABILITIES];
    default:
      // 알 수 없는 CLI — 공통 능력만 (raw stdout 으로 단순 응답만).
      return [...COMMON_CAPABILITIES];
  }
}

/** Ollama 로컬 provider 능력 — 모델 별 차이 광고하지 않고 공통 능력만 노출. */
export function resolveLocalCapabilities(): ProviderCapability[] {
  return [...LOCAL_CAPABILITIES];
}
