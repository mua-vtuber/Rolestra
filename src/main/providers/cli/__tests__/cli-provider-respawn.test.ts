import { describe, it, expect } from 'vitest';
import { CliProvider, type CliRuntimeConfig, type CliProviderInit } from '../cli-provider';
import { ClaudePermissionAdapter } from '../permission-adapter';

// TODO R2-Task21: migrate to v3 adapter API — this suite uses the v2 shape.

// Minimal mock config for testing
function makeTestConfig(overrides?: Partial<CliRuntimeConfig>): CliRuntimeConfig {
  return {
    command: 'echo',
    args: ['--base-arg'],
    inputFormat: 'pipe',
    outputFormat: 'raw-stdout',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5000, subsequent: 5000 },
    permissionAdapter: new ClaudePermissionAdapter(),
    ...overrides,
  };
}

function makeProviderInit(overrides?: Partial<CliProviderInit>): CliProviderInit {
  return {
    id: 'test-cli',
    displayName: 'Test',
    type: 'cli',
    model: 'test-model',
    capabilities: ['streaming'],
    config: { type: 'cli', command: 'echo' } as any,
    cliConfig: makeTestConfig(),
    ...overrides,
  };
}

// TODO R2-Task21: migrate to v3 adapter API
describe.skip('CliProvider.respawnWithPermissions', () => {
  it('exists as a method', () => {
    const provider = new CliProvider(makeProviderInit());
    expect(typeof provider.respawnWithPermissions).toBe('function');
  });

  it('changes permission mode to worker', async () => {
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('worker');
  });

  it('changes permission mode to read-only', async () => {
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    await provider.respawnWithPermissions('read-only');
    expect(provider.permissionMode).toBe('read-only');
  });

  it('defaults to read-only permission mode', () => {
    const provider = new CliProvider(makeProviderInit());
    expect(provider.permissionMode).toBe('read-only');
  });

  it('skips respawn when no permission adapter', async () => {
    const provider = new CliProvider(
      makeProviderInit({ cliConfig: makeTestConfig({ permissionAdapter: undefined }) }),
    );
    // Should not throw, just skip
    await provider.respawnWithPermissions('worker');
    // Mode stays at default read-only when no adapter
    expect(provider.permissionMode).toBe('read-only');
  });
});
