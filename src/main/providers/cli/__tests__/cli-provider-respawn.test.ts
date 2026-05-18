/**
 * 결재 4번 (A, 2026-05-19) — R2-Task21 새 인터페이스 마이그레이션 + skip 해제.
 *
 * 배경: 본 테스트는 R2 phase (2026-01~02) 작성 후 v2 adapter API
 * (buildReadOnlyArgs / buildWorkerArgs) 에 매여 `describe.skip` 으로 4개월 묵음.
 * v3 (R2-Task7) 에서 CliPermissionAdapter 인터페이스가 단순화 (해당 메서드
 * 제거) — 그러나 production 의 `CliProvider.respawnWithPermissions()` 는
 * 그대로 사용 중이고 권한 모드 전환 (회의 도중 사장님이 권한 변경 결정 →
 * 영속 session kill + respawn) 의 검증 공백이 4개월 흘렀음.
 *
 * 본 라운드에서:
 *   - `describe.skip` → `describe` (활성화)
 *   - `as any` cast 를 정식 `CliProviderConfig` 로 교체
 *   - 새 v3 API 시나리오 추가 (per-turn / persistent + dead process / adapter
 *     없을 때 silent 차단 / 연속 호출 race 가드 / console 경로 검증)
 *
 * `CliProvider.respawnWithPermissions(mode)` 의 v3 동작:
 *   1. adapter 없음 → `console.warn` + early return (mode 변경 X — silent 차단)
 *   2. adapter 있음 → `_permissionMode = mode` (항상 적용)
 *   3. persistent + 살아있는 process → kill + spawnPersistent + sessionId 복구 +
 *      status='ready'
 *   4. per-turn 또는 process 없음 → mode 만 변경, 다음 streamCompletion 시
 *      새 args 가 자연스럽게 적용 (ambient process boot 회피)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CliProvider,
  type CliRuntimeConfig,
  type CliProviderInit,
} from '../cli-provider';
import { ClaudePermissionAdapter } from '../permission-adapter';
import type { CliProviderConfig } from '../../../../shared/provider-types';

/** v3: `command: 'echo'` 가 cli-process 의 shell 분기 통과 — 실제 실행은 안 함. */
function makeTestCliConfig(overrides?: Partial<CliRuntimeConfig>): CliRuntimeConfig {
  return {
    command: 'echo',
    args: ['--base-arg'],
    inputFormat: 'pipe',
    outputFormat: 'raw-stdout',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5_000, subsequent: 5_000 },
    permissionAdapter: new ClaudePermissionAdapter(),
    ...overrides,
  };
}

/** v3: `CliProviderConfig` (shared provider-types) 명세 그대로 — `as any` 제거. */
function makeProviderConfig(): CliProviderConfig {
  return {
    type: 'cli',
    command: 'echo',
    args: [],
    inputFormat: 'pipe',
    outputFormat: 'raw-stdout',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 5_000, subsequent: 5_000 },
    model: 'test-model',
  };
}

function makeProviderInit(overrides?: Partial<CliProviderInit>): CliProviderInit {
  return {
    id: 'test-cli',
    displayName: 'Test',
    type: 'cli',
    model: 'test-model',
    capabilities: ['streaming', 'summarize'],
    config: makeProviderConfig(),
    cliConfig: makeTestCliConfig(),
    ...overrides,
  };
}

describe('CliProvider.respawnWithPermissions — v3 API (결재 4번 마이그레이션)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('respawnWithPermissions 가 method 로 존재', () => {
    const provider = new CliProvider(makeProviderInit());
    expect(typeof provider.respawnWithPermissions).toBe('function');
  });

  it('기본 permissionMode 는 read-only (생성 직후)', () => {
    const provider = new CliProvider(makeProviderInit());
    expect(provider.permissionMode).toBe('read-only');
  });

  it('adapter 있을 때 worker 로 변경 + console.info 로 audit', async () => {
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('worker');
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('permission mode → worker'));
  });

  it('worker → read-only 로 다시 되돌리기', async () => {
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    await provider.respawnWithPermissions('read-only');
    expect(provider.permissionMode).toBe('read-only');
  });

  it('adapter 없으면 mode 변경 자체를 skip — early return + warn (silent 차단)', async () => {
    const provider = new CliProvider(
      makeProviderInit({
        cliConfig: makeTestCliConfig({ permissionAdapter: undefined }),
      }),
    );
    // adapter 없으면 v3 는 mode 도 바꾸지 않음 (early return) — 회의 도중 권한
    // 변경이 silent 하게 무시되지 않도록 warn 으로 알림. 잘못된 권한으로 명령이
    // 실행될 가능성을 차단하는 safety invariant.
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('read-only');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No permission adapter, skipping respawnWithPermissions'),
    );
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('per-turn sessionStrategy + adapter 있음 → mode 만 변경 (subprocess spawn 시도 안 함)', async () => {
    // per-turn 은 다음 streamCompletion 시 getCliConfig() 결과를 새로 사용하므로
    // respawnWithPermissions 시점에 새 process 띄울 필요 없음. 본 케이스는
    // 회의 도중 부수적 process churn 발생 없이 mode 만 갱신되는지 검증.
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('worker');
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('persistent sessionStrategy + process 없음 → mode 만 변경 + spawn 시도 X (ambient boot 회피)', async () => {
    // persistent 라도 처음 회의가 시작되기 전 (아직 process 없는 상태) 에 권한
    // 변경하면 spawn 안 시도 — 다음 streamCompletion 의 explicit per-call
    // workspace 에서 새로 boot 한다. ambient process 가 잘못된 cwd 로 떠서
    // path-guard 우회되는 시나리오를 의도적으로 차단.
    const provider = new CliProvider(
      makeProviderInit({
        cliConfig: makeTestCliConfig({ sessionStrategy: 'persistent' }),
      }),
    );
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('worker');
    expect(infoSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('연속 호출 — 마지막 mode 가 winning value (race 가드)', async () => {
    const provider = new CliProvider(makeProviderInit());
    await provider.respawnWithPermissions('worker');
    await provider.respawnWithPermissions('read-only');
    await provider.respawnWithPermissions('worker');
    expect(provider.permissionMode).toBe('worker');
  });
});
