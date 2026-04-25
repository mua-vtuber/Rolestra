/**
 * PermissionFlagBuilder 매트릭스 입력/출력 타입 — R10-Task1, R10-Task5 확장.
 *
 * spec §7.6 의 3 모드(auto/hybrid/approval) × 3 CLI(Claude/Codex/Gemini)
 * × 3 project kind(new/external/imported) 매트릭스를 단일 builder 로 통합한다.
 * 기존에는 각 cli-runner(`src/main/providers/cli/*-runner.ts`) 가 inline 으로
 * 플래그를 구성했지만 R10-Task5 에서 builder 로 이전한다. 이 shared 타입은
 * preload 경유 IPC `permission:dry-run-flags`(설정 UI 의 "내 CLI 는 지금
 * 어떤 플래그로 돌아가나?" 섹션) + 내부 main-side 직접 호출 양쪽에서
 * 동일한 입력 스키마를 쓰도록 한다.
 */
import type { PermissionMode, ProjectKind as ProjectKindAlias } from './project-types';

/** Re-export so renderer/IPC consumers don't need a second import. */
export type ProjectKind = ProjectKindAlias;

/**
 * Wire-level provider id used by `permission:dry-run-flags` zod schema.
 * Mirrors `providerTypeSchema` in `ipc-schemas.ts` (R10-Task1) — extended
 * here as a public type so renderer can build the request without
 * re-deriving the union from zod. spec §7.6 의 builder 는 `*_cli` suffix
 * 만 처리하며 `*_api` / `mock` 은 `blockedReason='unknown_provider_type'`
 * 으로 차단된다.
 */
export type PermissionFlagProviderType =
  | 'claude_api'
  | 'claude_cli'
  | 'codex_api'
  | 'codex_cli'
  | 'gemini_api'
  | 'gemini_cli'
  | 'openai_api'
  | 'mock';

/** CLI 플래그 빌더 입력. zod 에서 external + auto 는 reject(spec §7.3 CA-1). */
export interface PermissionFlagInput {
  providerType: PermissionFlagProviderType;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  /**
   * spec §7.6.5 opt-in — SettingsTabs 의 "보안" 탭 스위치. false 가
   * 기본값(첫 부팅 포함). true 인 경우에도 external + auto 조합은
   * zod 에서 여전히 reject(opt-in 은 hybrid 안의 위험 플래그 허용만).
   */
  dangerousAutonomyOptIn: boolean;
}

/**
 * 빌더 출력 — CLI 실제 spawn 에 붙을 argv 조각 + 설명 메타.
 *
 * `flags` 는 `execFile` 인수로 그대로 사용 가능한 string[] 이며, shell 해석
 * 없이 전달된다(CLAUDE.md 절대 금지 규칙 #4 — 셸 문자열 실행 금지).
 * `rationale` 은 설정 UI 에서 "왜 이 플래그가 붙는가" 를 보여주기 위한
 * i18n 키 배열(실제 사용자 표시 문자열은 renderer 의 t() 로 해석).
 */
export interface PermissionFlagOutput {
  flags: string[];
  /** i18n 키 — 예: ['permission.flag.reason.approval', 'permission.flag.reason.external']. */
  rationale: string[];
  /**
   * 개발 모드 diagnostic — 빌더가 "이 조합은 불가" 로 판단했으면 throw
   * 하지 않고 flags=[] + blocked=true 를 반환. IPC 경로는 여전히 성공이지만
   * renderer 가 "이 조합은 spec 상 금지입니다" 배너를 보여주도록 한다.
   */
  blocked: boolean;
  /**
   * `blocked=true` 인 경우 구체 사유. 예: 'external_auto_forbidden' (CA-1),
   * 'cli_not_installed'. `blocked=false` 이면 null.
   */
  blockedReason:
    | 'external_auto_forbidden'
    | 'imported_auto_without_opt_in'
    | 'unknown_provider_type'
    | null;
}
