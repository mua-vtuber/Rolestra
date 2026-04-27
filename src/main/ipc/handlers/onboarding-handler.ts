/**
 * onboarding-handler — R11-Task6.
 *
 * Wires the three `onboarding:*` IPC channels declared in
 * `src/shared/ipc-types.ts` (R11-Task5 land) to the
 * {@link OnboardingService} singleton. The handler also owns the
 * `provider:detect` channel because the auto-detection surface only
 * shows up inside the wizard and shares the same first-boot semantics
 * (run once on mount, no streaming).
 *
 * Service injection follows the lazy-accessor pattern used everywhere
 * else in the IPC layer (see `provider-handler.ts` /
 * `notification-handler.ts`): `setOnboardingServiceAccessor` is called
 * once during boot in `main/index.ts`, the handlers then resolve via
 * `getService()` so unit tests can swap a stub without re-wiring the
 * router. Throwing 'service not initialized' on a missing accessor is
 * the convention; the catch in `router.ts#handle` translates it into a
 * `VALIDATION_ERROR` IPC envelope so the renderer fails fast.
 */

import type {
  OnboardingState,
  ProviderDetectionSnapshot,
} from '../../../shared/onboarding-types';
import type { OnboardingService } from '../../onboarding/onboarding-service';
import type {
  CliProviderConfig,
  ProviderInfo,
} from '../../../shared/provider-types';
import type { OnboardingApplySkip } from '../../../shared/ipc-types';
import { providerRegistry } from '../../providers/registry';
import {
  CLI_DEFAULT_CAPABILITIES,
  createProvider,
  normalizeCliCommand,
} from '../../providers/factory';
import { saveProvider } from '../../providers/provider-repository';

// ── Service accessor ───────────────────────────────────────────────

let onboardingServiceAccessor: (() => OnboardingService) | null = null;

export function setOnboardingServiceAccessor(
  accessor: (() => OnboardingService) | null,
): void {
  onboardingServiceAccessor = accessor;
}

function getService(): OnboardingService {
  if (!onboardingServiceAccessor) {
    throw new Error('onboarding handler: service not initialized');
  }
  return onboardingServiceAccessor();
}

// ── Provider detection accessor ────────────────────────────────────
//
// `provider:detect` needs read-only access to the registry + a CLI
// scanner. We isolate both behind accessor injections so unit tests
// can stub them — the production wire in `main/index.ts` plugs in the
// `providerRegistry` singleton + the existing
// `handleProviderDetectCli` from `cli-detect-handler.ts`.

interface CliScanResult {
  command: string;
  displayName: string;
  version?: string;
  path: string;
  wslDistro?: string;
}

interface DetectionDeps {
  listProviders: () => ProviderInfo[];
  scanCli: () => Promise<{ detected: CliScanResult[] }>;
}

let detectionDeps: DetectionDeps | null = null;

export function setProviderDetectionDeps(deps: DetectionDeps | null): void {
  detectionDeps = deps;
}

function requireDetectionDeps(): DetectionDeps {
  if (!detectionDeps) {
    throw new Error('onboarding handler: detection deps not initialized');
  }
  return detectionDeps;
}

// ── Onboarding handlers ────────────────────────────────────────────

export function handleOnboardingGetState(): { state: OnboardingState } {
  return { state: getService().getState() };
}

export function handleOnboardingSetState(input: {
  partial: Partial<OnboardingState>;
}): { state: OnboardingState } {
  return { state: getService().applyPartial(input.partial) };
}

export function handleOnboardingComplete(): { success: true } {
  getService().complete();
  return { success: true };
}

// ── Provider detection ─────────────────────────────────────────────

export async function handleProviderDetect(): Promise<{
  snapshots: ProviderDetectionSnapshot[];
}> {
  const deps = requireDetectionDeps();
  const registered = deps.listProviders();

  // Phase 1 — every persisted provider is by definition "available"
  // (the boot path already ran `provider:validate` style checks). We
  // surface the registered capabilities verbatim so the wizard can
  // decide which cards to pre-tick (capabilities.includes('summarize')
  // is the criterion the renderer uses).
  const snapshots: ProviderDetectionSnapshot[] = registered.map((p) => ({
    providerId: p.id,
    kind: p.type,
    available: true,
    capabilities: [...p.capabilities],
  }));

  const seenProviderIds = new Set(snapshots.map((s) => s.providerId));

  // Phase 2 — CLI binary probe. We add a snapshot for any installed CLI
  // whose canonical providerId is not yet in the registry so the wizard
  // can prompt the user to add it. Snapshot.available=true marks "the
  // tool exists on PATH"; the user still has to click through
  // `provider:add` to get capabilities they can rely on.
  let scanned: { detected: CliScanResult[] };
  try {
    scanned = await deps.scanCli();
  } catch {
    // CLI scan is best-effort. A failure (Windows lacking `where`,
    // sandbox blocking child_process) MUST NOT take down the whole
    // detection — the wizard still has the registry-derived list.
    scanned = { detected: [] };
  }

  for (const cli of scanned.detected) {
    const providerId = normalizeCliCommand(cli.command);
    if (seenProviderIds.has(providerId)) continue;
    seenProviderIds.add(providerId);
    snapshots.push({
      providerId,
      kind: 'cli',
      available: true,
      capabilities: [...CLI_DEFAULT_CAPABILITIES],
    });
  }

  return { snapshots };
}

// ── Apply staff selection (F1: register selected CLI providers) ───

/**
 * F1 (mock/fallback cleanup): wizard 가 step 5 finish 시 호출하는 진짜 등록
 * 흐름. 사용자가 step 2 에서 토글한 staff provider id 배열을 받아 main 측
 * 에서 (i) detect-cli 를 다시 한 번 실행해 binary path / wslDistro 를 도출
 * 하고 (Step 2 detection 시점과 finish 시점 사이 PATH 변동에 견고하게),
 * (ii) 매칭되는 detection 결과가 있는 id 에 대해 createProvider + register +
 * saveProvider + warmup 의 진짜 등록 흐름을 돌린다.
 *
 * 등록 가능 = CLI 한정. API / Local provider 는 wizard 입력 폼이 없어
 * (apiKey / endpoint 등 미수집) 자동 등록 불가능 — `not-detected` 로
 * skip 후 호출자 (App.tsx) 가 사용자에게 Settings 진입을 권한다 (F3+ 토스트).
 * 이 결정은 본 plan 의 F1-Task4 acceptance 와 정합 ("Local/API 는 plan 대로
 * 별도 안내").
 *
 * 본 핸들러는 도메인 책임이 onboarding (wizard) 와 provider (register) 의
 * 교차점이라 onboarding-handler 에 둔다. provider-handler 의
 * `handleProviderAdd` 와 비슷하지만 (i) id 를 detection 의 providerId 로 강제
 * 해 wizard 의 selections.staff 와 MemberProfile / 메신저 사이드바가 같은
 * id 로 매칭되도록 하고 (handleProviderAdd 는 randomUUID), (ii) detection
 * snapshot 이 없는 id 는 무음 fail 대신 skip 사유 포함 응답으로 명시한다.
 */
export interface ApplyStaffSelectionDeps {
  /**
   * detect-cli 결과를 다시 한 번 가져온다. production 은
   * `requireDetectionDeps().scanCli()` 를 위임하지만 unit test 는 임의의
   * scan 결과를 주입한다.
   */
  detectScan: () => Promise<{ detected: CliScanResult[] }>;
  /** 이미 registry 에 등록된 id 인지 검사 (production 은 providerRegistry.has). */
  isRegistered: (id: string) => boolean;
  /**
   * 등록 흐름 자체. production 은 createProvider + registry.register +
   * saveProvider + warmup 의 4 단계 default 구현을 사용. test 는 단순한
   * fake 로 대체.
   */
  registerCli: (id: string, cli: CliScanResult) => Promise<ProviderInfo>;
}

let applyStaffSelectionDeps: ApplyStaffSelectionDeps | null = null;

export function setApplyStaffSelectionDeps(
  deps: ApplyStaffSelectionDeps | null,
): void {
  applyStaffSelectionDeps = deps;
}

function buildCliConfig(cli: CliScanResult): CliProviderConfig {
  // factory.ts:getRuntimeCliConfig 가 command basename (claude / gemini /
  // codex) 으로 default args / inputFormat / outputFormat / hangTimeout 을
  // 채워주므로 본 placeholder 필드는 알려진 CLI 에서 모두 override 된다.
  // 알려지지 않은 CLI 는 placeholder 가 그대로 사용된다 (model='unknown'
  // — 사용자가 Settings 에서 fine tune 영역).
  return {
    type: 'cli',
    command: cli.path,
    args: [],
    inputFormat: 'stdin-json',
    outputFormat: 'stream-json',
    sessionStrategy: 'persistent',
    hangTimeout: { first: 30_000, subsequent: 30_000 },
    model: 'unknown',
    wslDistro: cli.wslDistro,
  };
}

async function defaultRegisterCli(
  id: string,
  cli: CliScanResult,
): Promise<ProviderInfo> {
  const config = buildCliConfig(cli);
  const provider = createProvider({
    id,
    displayName: cli.displayName,
    config,
  });
  providerRegistry.register(provider);
  saveProvider(
    provider.id,
    provider.type,
    provider.displayName,
    provider.persona,
    config,
  );
  void provider.warmup();
  return provider.toInfo();
}

function resolveApplyDeps(): ApplyStaffSelectionDeps {
  if (applyStaffSelectionDeps) return applyStaffSelectionDeps;
  return {
    detectScan: () => requireDetectionDeps().scanCli(),
    isRegistered: (id) => providerRegistry.has(id),
    registerCli: defaultRegisterCli,
  };
}

export async function handleOnboardingApplyStaffSelection(input: {
  providerIds: string[];
}): Promise<{
  added: ProviderInfo[];
  skipped: OnboardingApplySkip[];
}> {
  const deps = resolveApplyDeps();
  const scanned = await deps.detectScan();

  const cliMap = new Map<string, CliScanResult>();
  for (const cli of scanned.detected) {
    const providerId = normalizeCliCommand(cli.command);
    if (cliMap.has(providerId)) continue;
    cliMap.set(providerId, cli);
  }

  const added: ProviderInfo[] = [];
  const skipped: OnboardingApplySkip[] = [];

  for (const providerId of input.providerIds) {
    if (deps.isRegistered(providerId)) {
      skipped.push({ providerId, reason: 'already-registered' });
      continue;
    }
    const cli = cliMap.get(providerId);
    if (!cli) {
      skipped.push({ providerId, reason: 'not-detected' });
      continue;
    }
    try {
      const info = await deps.registerCli(providerId, cli);
      added.push(info);
    } catch (reason) {
      skipped.push({
        providerId,
        reason: 'create-failed',
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return { added, skipped };
}
