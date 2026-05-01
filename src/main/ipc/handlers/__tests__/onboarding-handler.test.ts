/**
 * Unit tests for the onboarding-handler module (R11-Task6).
 *
 * Coverage:
 *   1. handleOnboardingGetState delegates to OnboardingService.getState.
 *   2. handleOnboardingSetState forwards the partial verbatim.
 *   3. handleOnboardingComplete delegates to OnboardingService.complete +
 *      returns success=true.
 *   4. Each handler throws "service not initialized" when the accessor
 *      is null.
 *   5. handleProviderDetect:
 *      a. registry-only path → snapshot per registered provider.
 *      b. CLI scanner path → unregistered CLI surfaces a synthetic
 *         snapshot with the well-known capability set.
 *      c. CLI scanner failure does NOT take down the whole detection.
 *      d. throws when detection deps are not initialized.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleOnboardingGetState,
  handleOnboardingSetState,
  handleOnboardingComplete,
  handleOnboardingApplyStaffSelection,
  handleProviderDetect,
  setApplyStaffSelectionDeps,
  setOnboardingServiceAccessor,
  setProviderDetectionDeps,
} from '../onboarding-handler';
import type { OnboardingService } from '../../../onboarding/onboarding-service';
import type { ProviderInfo } from '../../../../shared/provider-types';
import type { OnboardingState } from '../../../../shared/onboarding-types';

interface ServiceMock {
  getState: ReturnType<typeof vi.fn>;
  applyPartial: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
}

const baseState: OnboardingState = {
  completed: false,
  currentStep: 1,
  selections: {},
  updatedAt: 100,
};

function buildService(): ServiceMock {
  return {
    getState: vi.fn(() => ({ ...baseState })),
    applyPartial: vi.fn((patch: Partial<OnboardingState>) => ({
      ...baseState,
      ...patch,
      currentStep: patch.currentStep ?? baseState.currentStep,
    })),
    complete: vi.fn(),
    reset: vi.fn(() => ({ ...baseState })),
  };
}

afterEach(() => {
  setOnboardingServiceAccessor(null);
  setProviderDetectionDeps(null);
  setApplyStaffSelectionDeps(null);
});

describe('onboarding-handler — state channels', () => {
  let service: ServiceMock;

  beforeEach(() => {
    service = buildService();
    setOnboardingServiceAccessor(() => service as unknown as OnboardingService);
  });

  it('handleOnboardingGetState delegates to service.getState', () => {
    const out = handleOnboardingGetState();
    expect(service.getState).toHaveBeenCalledOnce();
    expect(out.state).toEqual(baseState);
  });

  it('handleOnboardingSetState forwards the partial verbatim', () => {
    const patch = { currentStep: 3 as const };
    const out = handleOnboardingSetState({ partial: patch });
    expect(service.applyPartial).toHaveBeenCalledExactlyOnceWith(patch);
    expect(out.state.currentStep).toBe(3);
  });

  it('handleOnboardingComplete delegates and returns success=true', () => {
    const out = handleOnboardingComplete();
    expect(service.complete).toHaveBeenCalledOnce();
    expect(out).toEqual({ success: true });
  });

  it('throws when accessor is null (defence against missing wire)', () => {
    setOnboardingServiceAccessor(null);
    expect(() => handleOnboardingGetState()).toThrow(/not initialized/);
    expect(() => handleOnboardingSetState({ partial: {} })).toThrow(
      /not initialized/,
    );
    expect(() => handleOnboardingComplete()).toThrow(/not initialized/);
  });
});

describe('onboarding-handler — provider:detect', () => {
  function makeProviderInfo(
    overrides: Partial<ProviderInfo>,
  ): ProviderInfo {
    return {
      id: 'fixture',
      type: 'cli',
      displayName: 'fixture',
      model: 'fixture-model',
      capabilities: ['streaming', 'summarize'],
      status: 'ready',
      config: {
        type: 'cli',
        command: 'fixture',
        args: [],
        inputFormat: 'stdin-json',
        outputFormat: 'stream-json',
        sessionStrategy: 'persistent',
        hangTimeout: { first: 30_000, subsequent: 60_000 },
        model: 'fixture-model',
      },
      roles: [],
      skill_overrides: null,
      ...overrides,
    };
  }

  it('returns one snapshot per registered provider with capabilities verbatim', async () => {
    setProviderDetectionDeps({
      listProviders: () => [
        makeProviderInfo({
          id: 'claude',
          type: 'cli',
          capabilities: ['streaming', 'summarize'],
        }),
        makeProviderInfo({
          id: 'gpt-anth',
          type: 'api',
          capabilities: ['streaming'],
        }),
      ],
      scanCli: async () => ({ detected: [] }),
    });

    const { snapshots } = await handleProviderDetect();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual({
      providerId: 'claude',
      kind: 'cli',
      available: true,
      capabilities: ['streaming', 'summarize'],
    });
    expect(snapshots[1].providerId).toBe('gpt-anth');
    expect(snapshots[1].capabilities).toEqual(['streaming']);
  });

  it('augments with CLI scan results for unregistered binaries', async () => {
    setProviderDetectionDeps({
      listProviders: () => [],
      scanCli: async () => ({
        detected: [
          {
            command: 'gemini',
            displayName: 'Gemini CLI',
            path: '/usr/bin/gemini',
          },
          {
            command: 'codex',
            displayName: 'Codex CLI',
            path: '/usr/bin/codex',
          },
        ],
      }),
    });

    const { snapshots } = await handleProviderDetect();
    const ids = snapshots.map((s) => s.providerId);
    expect(ids).toEqual(['gemini', 'codex']);
    expect(snapshots[0].available).toBe(true);
    expect(snapshots[0].capabilities).toEqual(['streaming', 'summarize']);
  });

  it('does not duplicate a CLI snapshot when the provider is already registered', async () => {
    setProviderDetectionDeps({
      listProviders: () => [
        makeProviderInfo({
          id: 'claude',
          type: 'cli',
          capabilities: ['streaming', 'summarize'],
        }),
      ],
      scanCli: async () => ({
        detected: [
          {
            command: 'claude',
            displayName: 'Claude Code',
            path: '/usr/bin/claude',
          },
        ],
      }),
    });

    const { snapshots } = await handleProviderDetect();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].providerId).toBe('claude');
  });

  it('falls back to an empty CLI list when the scanner throws', async () => {
    setProviderDetectionDeps({
      listProviders: () => [
        makeProviderInfo({ id: 'claude', type: 'cli' }),
      ],
      scanCli: async () => {
        throw new Error('scan failed');
      },
    });

    const { snapshots } = await handleProviderDetect();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].providerId).toBe('claude');
  });

  it('throws when detection deps are not initialized', async () => {
    setProviderDetectionDeps(null);
    await expect(handleProviderDetect()).rejects.toThrow(
      /detection deps not initialized/,
    );
  });
});

describe('onboarding-handler — apply-staff-selection (F1)', () => {
  function makeProviderInfo(
    overrides: Partial<ProviderInfo>,
  ): ProviderInfo {
    return {
      id: 'fixture',
      type: 'cli',
      displayName: 'fixture',
      model: 'fixture-model',
      capabilities: ['streaming', 'summarize'],
      status: 'ready',
      config: {
        type: 'cli',
        command: 'fixture',
        args: [],
        inputFormat: 'stdin-json',
        outputFormat: 'stream-json',
        sessionStrategy: 'persistent',
        hangTimeout: { first: 30_000, subsequent: 60_000 },
        model: 'fixture-model',
      },
      roles: [],
      skill_overrides: null,
      ...overrides,
    };
  }

  it('registers each requested CLI provider via registerCli and reports added', async () => {
    const registered: string[] = [];
    setApplyStaffSelectionDeps({
      detectScan: async () => ({
        detected: [
          { command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' },
          { command: 'gemini', displayName: 'Gemini CLI', path: '/usr/bin/gemini' },
        ],
      }),
      isRegistered: () => false,
      registerCli: async (id, cli) => {
        registered.push(id);
        return makeProviderInfo({ id, displayName: cli.displayName });
      },
    });

    const out = await handleOnboardingApplyStaffSelection({
      providerIds: ['claude', 'gemini'],
    });

    expect(registered).toEqual(['claude', 'gemini']);
    expect(out.added.map((p) => p.id)).toEqual(['claude', 'gemini']);
    expect(out.skipped).toEqual([]);
  });

  it('skips providers already in the registry without calling registerCli', async () => {
    const registerSpy = vi.fn();
    setApplyStaffSelectionDeps({
      detectScan: async () => ({
        detected: [
          { command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' },
        ],
      }),
      isRegistered: (id) => id === 'claude',
      registerCli: registerSpy,
    });

    const out = await handleOnboardingApplyStaffSelection({
      providerIds: ['claude'],
    });

    expect(registerSpy).not.toHaveBeenCalled();
    expect(out.added).toEqual([]);
    expect(out.skipped).toEqual([
      { providerId: 'claude', reason: 'already-registered' },
    ]);
  });

  it('reports not-detected for ids absent from the rescan', async () => {
    setApplyStaffSelectionDeps({
      detectScan: async () => ({ detected: [] }),
      isRegistered: () => false,
      registerCli: async () => {
        throw new Error('should not be invoked');
      },
    });

    const out = await handleOnboardingApplyStaffSelection({
      providerIds: ['copilot'],
    });

    expect(out.added).toEqual([]);
    expect(out.skipped).toEqual([
      { providerId: 'copilot', reason: 'not-detected' },
    ]);
  });

  it('reports create-failed with detail when registerCli throws', async () => {
    setApplyStaffSelectionDeps({
      detectScan: async () => ({
        detected: [
          { command: 'claude', displayName: 'Claude Code', path: '/usr/bin/claude' },
        ],
      }),
      isRegistered: () => false,
      registerCli: async () => {
        throw new Error('boom');
      },
    });

    const out = await handleOnboardingApplyStaffSelection({
      providerIds: ['claude'],
    });

    expect(out.added).toEqual([]);
    expect(out.skipped).toEqual([
      { providerId: 'claude', reason: 'create-failed', detail: 'boom' },
    ]);
  });

  it('normalises CLI command name (claude.exe → claude) when matching detection', async () => {
    setApplyStaffSelectionDeps({
      detectScan: async () => ({
        detected: [
          { command: 'claude.exe', displayName: 'Claude Code', path: 'C:\\bin\\claude.exe' },
        ],
      }),
      isRegistered: () => false,
      registerCli: async (id) => makeProviderInfo({ id }),
    });

    const out = await handleOnboardingApplyStaffSelection({
      providerIds: ['claude'],
    });

    expect(out.added.map((p) => p.id)).toEqual(['claude']);
    expect(out.skipped).toEqual([]);
  });
});
