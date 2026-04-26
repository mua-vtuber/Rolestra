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
import type { ProviderInfo } from '../../../shared/provider-types';

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

/**
 * Map a CLI command name (`claude` / `gemini` / `codex`) to a stable
 * snapshot.providerId. The wizard cross-references this id with the
 * STAFF_CANDIDATES fixture so a freshly-detected CLI auto-pre-selects
 * the matching card. Anything not in this map degrades to the raw
 * command name — the renderer treats that as "detected but unknown
 * candidate" and surfaces it in the alt slot.
 */
const CLI_TO_PROVIDER_ID: Record<string, string> = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
};

/**
 * Default capability snapshot for an unconfigured-but-installed CLI.
 * The user has not yet added the provider via `provider:add`, so the
 * registry has nothing to copy — we surface the well-known capability
 * set the matching CLI provider class would advertise once registered
 * (kept in sync with R11-Task9 `factory.ts` cliCapabilities).
 */
const CLI_DEFAULT_CAPABILITIES = ['streaming', 'summarize'] as const;

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
    const providerId = CLI_TO_PROVIDER_ID[cli.command] ?? cli.command;
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
