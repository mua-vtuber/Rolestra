/**
 * Provider type definitions shared between main and renderer.
 *
 * These types define the contract for all AI providers (API, CLI, Local).
 * The renderer uses ProviderInfo (serializable) for display;
 * the main process uses these types plus BaseProvider (non-serializable).
 */

import type { RoleId } from './role-types';
import type { PermissionMode, ProjectKind } from './project-types';
import type { PermissionSet } from './permission-set-types';
import type { AbsolutePath } from './absolute-path';

/**
 * Max length of `providers.display_name` (F2-2, spec
 * `docs/specs/2026-09-29-ai-setup-and-character.md`). Shared by
 * `provider:add`'s zod schema and `member:rename`'s zod schema so both
 * entry points enforce the identical bound — renaming an AI and creating
 * one with a name that is too long fail with the same limit.
 */
export const PROVIDER_DISPLAY_NAME_MAX_LENGTH = 128;

/** Provider capability flags for runtime feature detection. */
export type ProviderCapability =
  | 'streaming'
  | 'resume'
  | 'tools'
  | 'json-mode'
  | 'multimodal'
  | 'code-execution'
  // R11-Task5: 회의록 요약 / 메모 압축에 안정적인 1-shot 응답을 낼 수 있는
  // provider 임을 표시한다. R11-Task9 가 6 provider config 갱신 + meeting
  // -summary-service 의 'streaming' 임시 우회를 'summarize' fallback chain 으로
  // 교체한다.
  | 'summarize';

/** Provider type discriminator. */
export type ProviderType = 'api' | 'cli' | 'local';

/** Runtime provider status. */
export type ProviderStatus =
  | 'ready'
  | 'warming-up'
  | 'busy'
  | 'error'
  | 'not-installed';

/**
 * Discriminated union for provider configuration.
 * The `type` field determines which additional fields are present.
 */
export type ProviderConfig =
  | ApiProviderConfig
  | CliProviderConfig
  | LocalProviderConfig;

export interface ApiProviderConfig {
  type: 'api';
  endpoint: string;
  /** Reference key for safeStorage — never a raw API key. */
  apiKeyRef: string;
  model: string;
}

export interface CliProviderConfig {
  type: 'cli';
  command: string;
  args: string[];
  inputFormat: 'stdin-json' | 'args' | 'pipe';
  outputFormat: 'stream-json' | 'jsonl' | 'raw-stdout';
  sessionStrategy: 'persistent' | 'per-turn';
  hangTimeout: { first: number; subsequent: number };
  model: string;
  /** WSL distro name when the CLI is installed inside WSL (undefined = native). */
  wslDistro?: string;
}

/**
 * Provider types whose models `provider:list-models` lists. Local (Ollama)
 * models come from `provider:detect-local` instead.
 */
export type ModelListType = Exclude<ProviderType, 'local'>;

/** Local server kinds the app has confirmed itself (see `confirmedServer`). */
export type ConfirmedLocalServer = 'ollama';

export interface LocalProviderConfig {
  type: 'local';
  baseUrl: string;
  model: string;
  /**
   * Set only by main, only in `provider:add-local`: at the moment the AI was
   * added, `baseUrl` answered Ollama's own `/api/version` and listed this
   * model in `/api/tags` (spec 2026-10-01-messenger-redesign.md R6). The
   * settings line says "로컬 (Ollama)" only when it is present; without it
   * the line names the address. `provider:add` drops it from a renderer
   * config. It records what was confirmed at add time — a different
   * server started later on the same address is not re-checked.
   */
  confirmedServer?: ConfirmedLocalServer;
}

/** Chat message for provider communication. */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
  /** Speaker name in multi-party conversations. */
  name?: string;
  metadata?: Record<string, unknown>;
}

/** Content block for multimodal messages. */
export interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  data: unknown;
}

/** Options for completion requests. */
export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  /**
   * Explicit workspace for CLI-backed providers.
   *
   * Every caller of a CLI-backed provider must pass this per call — R12-X T4
   * removed the provider's ambient fallback, so a missing workspace now
   * throws instead of silently spawning in the app's own working folder.
   * Calls that have no project still pass one, built with
   * `consensusOnlyCliWorkspace` (`src/main/providers/cli/cli-workspace.ts`).
   */
  cliWorkspace?: CliWorkspaceContext;
  /** An isolated, persisted room/character CLI conversation. API providers ignore it. */
  chatSession?: ChatCliSessionOptions;
  [key: string]: unknown;
}

export interface ChatCliSessionOptions {
  /** Room and character identity; never shared with meeting sessions. */
  scopeKey: string;
  /** Persisted CLI session, or null for a fresh bounded reconstruction. */
  resumeSessionId: string | null;
  /** Short orientation added to each continuation, without replaying persona. */
  currentStateHint: string;
  /**
   * App-managed folder, outside the CLI working folder, holding the persona
   * file that replaces the CLI's default system prompt
   * (`src/main/files/chat-cli-instructions.ts`).
   */
  instructionsDir: AbsolutePath;
}

/**
 * Spawn and permission context for a single CLI provider request.
 *
 * 두 갈래로 나뉜다 (R12-X T4). 프로젝트가 없는 호출 (DM, 회의록 요약,
 * 메모리 reflection) 은 프로젝트 정책 필드를 *가질 수 없다* — 옛 단일
 * interface 는 그런 호출자에게 `projectKind: 'new'` 같은 값을 지어내도록
 * 강요했고, 그렇게 지어낸 값이 CLI 권한 플래그 계산에 그대로 들어갔다.
 *
 * `scope: 'consensus-only'` 는 읽기 전용 argv 경로 전용이다. worker 모드
 * 플래그는 프로젝트 정책 (`projectKind` + `permissionMode`) 없이는 계산할
 * 수 없으므로 `CliPermissionAdapter.buildArgs` 는 consensus-only workspace
 * 를 받으면 typed error 를 던져야 한다.
 */
export type CliWorkspaceContext =
  | ProjectCliWorkspaceContext
  | ConsensusOnlyCliWorkspaceContext;

/** 프로젝트에 묶인 호출 — 회의 turn. 권한 매트릭스 전체를 쓸 수 있다. */
export interface ProjectCliWorkspaceContext {
  scope: 'project';
  /** Native host cwd passed to child_process. */
  cwd: AbsolutePath;
  /** Native host consensus folder path granted to CLI providers. */
  consensusPath: AbsolutePath;
  /** Project id this request is scoped to. */
  projectId: string;
  /** Project kind used by the CLI permission matrix. */
  projectKind: ProjectKind;
  /** Project permission mode used by worker permission flags. */
  permissionMode: PermissionMode;
  /** User opt-in for dangerous auto-mode aliases. */
  dangerousAutonomyOptIn?: boolean;
  /**
   * R12-W T12 — 이 호출이 속한 채널의 권한 5 axis.
   *
   * `null` 은 "채널 권한으로 좁히지 않는다" 는 뜻이다. 회의 turn 은
   * 반드시 실제 set 을 넘겨야 한다 — 넘기지 않으면 사용자가 채널 설정에서
   * 끈 도구가 그대로 CLI 에 붙는다. 프로젝트 DM 은 채널 row 의 권한을
   * 그대로 넘기고, 회의록 정리 / 메모리 reflection 처럼 채널이 없는
   * 호출만 null 을 쓴다.
   */
  permissions: PermissionSet | null;
}

/**
 * 프로젝트가 없는 호출 — cwd 는 합의 폴더 자신이다. 읽기 전용 argv 만
 * 만들 수 있고, worker 모드 플래그는 만들 수 없다.
 */
export interface ConsensusOnlyCliWorkspaceContext {
  scope: 'consensus-only';
  /** Native host cwd passed to child_process — equals `consensusPath`. */
  cwd: AbsolutePath;
  /** Native host consensus folder path granted to CLI providers. */
  consensusPath: AbsolutePath;
  /** No project backs this request. */
  projectId: null;
}

/** Tool definition for tool-capable providers. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Serializable provider info for IPC transport.
 * Unlike BaseProvider, this contains no methods — safe for contextBridge.
 */
export interface ProviderInfo {
  id: string;
  type: ProviderType;
  displayName: string;
  model: string;
  capabilities: ProviderCapability[];
  status: ProviderStatus;
  config: ProviderConfig;
  /** R12-S: 직원에게 부여된 능력 (다중 가능, 빈 배열 = 어떤 부서도 못 들어감). */
  roles: RoleId[];
  /** R12-S: 능력별 사용자 customize prompt — null = 카탈로그 default.
   *  Partial — 일부 role 만 override 한 경우 나머지는 카탈로그 default. */
  skill_overrides: Partial<Record<RoleId, string>> | null;
  /** R12-C2 T36: 능력별 부서장 핀. 없는 key = 그 부서의 부서장이 아님.
   *  designated-worker-resolver 가 지목 대상을 고를 때 가장 먼저 본다. */
  isDepartmentHead: Partial<Record<RoleId, boolean>>;
}

/**
 * F1-6 (spec `docs/specs/2026-09-29-ai-setup-and-character.md`) — reason
 * code for why `provider:list-models` could not return a live model list.
 * main stores this code, never a sentence; the renderer maps it to
 * translated text (`providerConnect.modelListError.<code>`).
 *
 * Distinguishes three failure classes the model registry already
 * discriminates internally (`ModelRegistryAuthError` / `*NetworkError` /
 * `*ParseError` in `src/main/providers/model-registry.ts`) so the UI can
 * tell the user "wrong key" apart from "service unreachable" apart from
 * "got a response but couldn't read it" — never collapse them into one
 * generic failure or an empty list (§코딩-규칙 no-silent-fallback rule).
 */
export type ModelListFailureReason = 'auth' | 'network' | 'parse';

/**
 * What happened to an API key ref after its AI was deleted or switched to a
 * new key (spec 2026-10-01-messenger-redesign.md R5-6). The key text never
 * crosses IPC — only this outcome does.
 *   - `deleted`     — no remaining AI uses the ref, so its secret was removed.
 *   - `kept-shared` — another registered AI still uses the ref; kept.
 *   - `failed`      — the delete (or the check before it) failed; `message`
 *                     says why. The AI change itself already succeeded.
 */
export type ApiKeyCleanup =
  | { status: 'deleted' }
  | { status: 'kept-shared' }
  | { status: 'failed'; message: string };

/**
 * B1 — reason code for why a stored CLI provider row is inactive (never
 * restored into the live registry). main stores this code, never a
 * sentence; the renderer maps it to translated text
 * (`settings.ai.inactive.reason.*`, settings AI tab).
 *
 * B8 — 'corrupt-config' marks a row whose `configJson` failed to parse.
 * Such a row is surfaced, not silently dropped (CLAUDE.md no-silent-
 * fallback rule): a corrupt row is still real data the user needs to see
 * and act on (remove it or re-register the CLI).
 */
export type InactiveCliReason = 'unsupported-command' | 'corrupt-config';

/**
 * Serializable view of a `providers` row whose CLI command is not one of
 * the supported chat CLIs (see `isSupportedChatCliCommand`), OR whose
 * stored config could not be parsed at all. The row is kept in the DB
 * (never deleted or executed) so the user does not lose their prior
 * persona/roles configuration silently — the settings UI shows it as
 * inactive instead of making it vanish without explanation (B1).
 */
export interface InactiveCliProviderInfo {
  id: string;
  displayName: string;
  /**
   * The stored CLI command — shown so the user can identify the row.
   * `null` for a `corrupt-config` row: the config JSON could not be
   * parsed, so there is no real command value to show (B8 — never
   * substitute a placeholder string like 'unknown', that would be fake
   * data presented as real).
   */
  command: string | null;
  reason: InactiveCliReason;
}
