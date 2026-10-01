/**
 * CLI spawn argv 스냅샷 — R12-W T12.
 *
 * 여기서 보는 것은 하나다: 사용자가 채널 설정에서 끈 도구가 *실제로 뜨는
 * 프로세스의 argv* 에서 사라지는가. filter 함수 단위 시험
 * (`permission-flag-filter.test.ts`) 은 순수 함수만 보므로, 그 결과가
 * spawn 까지 이어지는지는 여기서만 확인된다.
 *
 * `node:child_process.execFile` 을 mock 해서 실제 CLI 를 띄우지 않고
 * argv 만 관찰한다 — 권한 배선은 프로세스가 실제로 떠야 검증되는 것이
 * 아니라 "무엇을 들려 보냈는가" 로 검증된다.
 *
 * 회의 turn 은 언제나 읽기 전용 모드로 뜨므로 (`_permissionMode` 기본값
 * `'read-only'`) 여기서도 그 경로만 본다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn() };
});

import {
  CliProvider,
  type CliRuntimeConfig,
  type CliProviderInit,
} from '../cli-provider';
import { UnknownCliKindError } from '../cli-channel-permissions';
import { CODEX_CLI_CONFIG } from '../codex-config';
import {
  ClaudePermissionAdapter,
  CodexPermissionAdapter,
  type CliPermissionAdapter,
} from '../permission-adapter';
import type { ChatCliSessionOptions, CompletionOptions } from '../../../../shared/provider-types';
import { ChatCliInstructionsInsideWorkspaceError } from '../../../files/chat-cli-instructions';
import type { PermissionSet } from '../../../../shared/permission-set-types';
import { catalogDefaultFor } from '../../../../shared/permission-set-types';
import { asAbsolutePath, type AbsolutePath } from '../../../../shared/absolute-path';
import { createTmpDir } from '../../../../test-utils/integration-helpers';

// ── fake child process ────────────────────────────────────────────────

interface FakeChild {
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  killed: boolean;
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  on: (event: string, cb: (...args: unknown[]) => void) => FakeChild;
  removeListener: (
    event: string,
    cb: (...args: unknown[]) => void,
  ) => FakeChild;
  _events: EventEmitter;
}

function createFakeChild(): FakeChild {
  const events = new EventEmitter();
  const stdout = new EventEmitter() as FakeChild['stdout'];
  stdout.setEncoding = vi.fn().mockReturnThis();
  const stderr = new EventEmitter() as FakeChild['stderr'];
  stderr.setEncoding = vi.fn().mockReturnThis();
  const stdin = new EventEmitter() as FakeChild['stdin'];
  stdin.write = vi.fn();
  stdin.end = vi.fn();

  const child: FakeChild = {
    stdin,
    stdout,
    stderr,
    killed: false,
    pid: 4242,
    kill: vi.fn().mockImplementation(() => {
      child.killed = true;
      events.emit('exit', 0, null);
      return true;
    }),
    on(event, cb) {
      events.on(event, cb);
      return this;
    },
    removeListener(event, cb) {
      events.removeListener(event, cb);
      return this;
    },
    _events: events,
  };
  return child;
}

function emitAndExit(child: FakeChild, lines: string[]): void {
  setTimeout(() => {
    for (const line of lines) child.stdout.emit('data', line + '\n');
    child.stdout.emit('end');
    child._events.emit('exit', 0, null);
  }, 0);
}

// ── provider harness ──────────────────────────────────────────────────

function makeCliConfig(over: Partial<CliRuntimeConfig> = {}): CliRuntimeConfig {
  return {
    // `node` 를 쓰는 이유: Windows 에서 이름만 있는 명령은 PATH 분류에
    // 실패해 cmd.exe 경유로 argv 가 문자열 하나로 합쳐진다 (windows-command
    // 의 cmd 갈래). 그러면 여기서 보고 싶은 argv 배열 자체가 사라진다.
    // `node` 는 실제 `.exe` 로 분류되어 두 platform 모두 argv 를 그대로
    // 넘긴다. 실제로 실행되지는 않는다 — execFile 이 mock 이다.
    command: 'node',
    args: [],
    inputFormat: 'pipe',
    outputFormat: 'raw-stdout',
    sessionStrategy: 'per-turn',
    hangTimeout: { first: 10_000, subsequent: 5_000 },
    permissionAdapter: new ClaudePermissionAdapter(),
    ...over,
  };
}

function makeProviderInit(cliConfig: CliRuntimeConfig): CliProviderInit {
  return {
    id: 'cli-argv-test',
    displayName: 'CLI argv test',
    type: 'cli',
    model: 'test-model',
    capabilities: ['streaming'],
    config: {
      type: 'cli',
      command: cliConfig.command,
      args: cliConfig.args,
      inputFormat: cliConfig.inputFormat,
      outputFormat: cliConfig.outputFormat,
      sessionStrategy: cliConfig.sessionStrategy,
      hangTimeout: cliConfig.hangTimeout,
      model: 'test-model',
    },
    cliConfig,
  };
}

/**
 * persistent 전략 harness — 하나의 프로세스가 여러 turn 을 이어 받는다.
 * 응답 경계 (`responseBoundary`) 가 없으면 reader 가 stdout 종료까지
 * 기다리므로 turn 이 끝나지 않는다.
 */
function persistentConfig(): CliRuntimeConfig {
  return makeCliConfig({
    sessionStrategy: 'persistent',
    outputFormat: 'stream-json',
    responseBoundary: (line: string) => line.includes('"type":"result"'),
  });
}

const MESSAGES = [{ role: 'user' as const, content: 'Hello' }];
/** Scoped chat persona; it must reach the CLI only through the instruction file. */
const CHAT_PERSONA = '[Chat Conversation Rules]\nSpeak only as Frozen Alice.';

const ALL_OFF: PermissionSet = {
  fileRead: false,
  fileWrite: false,
  commandExec: false,
  webSearch: false,
  dbRead: false,
};

function projectWorkspace(
  dir: AbsolutePath,
  permissions: PermissionSet | null,
): CompletionOptions {
  return {
    cliWorkspace: {
      scope: 'project',
      cwd: dir,
      consensusPath: dir,
      projectId: 'pr-1',
      projectKind: 'new',
      permissionMode: 'approval',
      permissions,
    },
  };
}

/** argv 에서 `<flag> <value>` 쌍의 값만 뽑는다. 없으면 null. */
function valueOf(argv: string[], flag: string): string | null {
  const idx = argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= argv.length) return null;
  return argv[idx + 1] ?? null;
}

describe('CLI spawn argv — 채널 권한 filter (R12-W T12)', () => {
  let mockExecFile: ReturnType<typeof vi.fn>;
  let spawned: FakeChild[];
  let spawnArgv: string[][];
  let dir: AbsolutePath;
  /** App-managed instruction folder, a sibling of (never inside) the CLI cwd. */
  let instructionsDir: AbsolutePath;
  const chatSession = (scopeKey: string, resumeSessionId: string | null,
    currentStateHint = 'Continue.'): ChatCliSessionOptions =>
    ({ scopeKey, resumeSessionId, currentStateHint, instructionsDir });
  const stdinText = (child: FakeChild | undefined): string =>
    (child?.stdin.write.mock.calls ?? []).map((call) => String(call[0])).join('');

  beforeEach(async () => {
    const cp = await import('node:child_process');
    mockExecFile = cp.execFile as unknown as ReturnType<typeof vi.fn>;
    mockExecFile.mockReset();
    spawned = [];
    spawnArgv = [];
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const child = createFakeChild();
      const last = args[args.length - 1];
      if (typeof last !== 'function') {
        spawned.push(child);
        spawnArgv.push(args[1] as string[]);
      }
      return child as unknown as ChildProcess;
    });
    dir = createTmpDir('rolestra-argv-');
    instructionsDir = createTmpDir('rolestra-instructions-');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(instructionsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** 한 turn 을 끝까지 돌리고 그 spawn 의 argv 를 돌려준다. */
  async function runTurn(
    provider: CliProvider,
    options: CompletionOptions,
    spawnIndex = 0,
    persona = '',
  ): Promise<string[]> {
    const tokens: string[] = [];
    const run = (async () => {
      for await (const t of provider.streamCompletion(
        MESSAGES,
        persona,
        options,
      )) {
        tokens.push(t);
      }
    })();
    await new Promise((r) => setTimeout(r, 10));
    const child = spawned[spawnIndex];
    if (!child) throw new Error(`spawn ${spawnIndex} 이 일어나지 않았다`);
    emitAndExit(child, ['ok']);
    await run;
    const argv = spawnArgv[spawnIndex];
    if (!argv) throw new Error(`spawn ${spawnIndex} 의 argv 를 못 읽었다`);
    return argv;
  }

  /**
   * persistent turn 하나를 끝까지 돌린다. `spawnPersistent` 는 startup
   * timer 500ms 뒤에 resolve 하므로 그만큼 기다린 뒤 응답을 흘려보낸다.
   *
   * @param childIndex 이번 turn 이 쓸 프로세스의 spawn 순번.
   */
  async function runPersistentTurn(
    provider: CliProvider,
    options: CompletionOptions,
    childIndex: number,
    persona = '',
  ): Promise<void> {
    const run = (async () => {
      for await (const _t of provider.streamCompletion(MESSAGES, persona, options)) {
        // 토큰 값 자체는 관심사가 아니다 — argv 만 본다.
      }
    })();
    await new Promise((r) => setTimeout(r, 600));
    const child = spawned[childIndex];
    if (!child) throw new Error(`spawn ${String(childIndex)} 이 일어나지 않았다`);
    child.stdout.emit('data', '{"text":"ok"}\n');
    child.stdout.emit('data', '{"type":"result"}\n');
    await run;
  }

  it('(a) 아이디어 부서 권한 (읽기 + 웹) 이면 base 그대로 — disallow 없음', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig()));
    const argv = await runTurn(
      provider,
      projectWorkspace(dir, catalogDefaultFor('idea')),
    );

    expect(valueOf(argv, '--allowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
    expect(argv).not.toContain('--disallowedTools');
  });

  it('(b) 구현 부서 권한이면 WebSearch/WebFetch 가 argv 에서 빠지고 disallow 로 명시된다', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig()));
    const argv = await runTurn(
      provider,
      projectWorkspace(dir, catalogDefaultFor('implement')),
    );

    expect(valueOf(argv, '--allowedTools')).toBe('Read,Glob,Grep');
    expect(valueOf(argv, '--disallowedTools')).toBe('WebSearch,WebFetch');
  });

  it('(c) 권한을 모두 끄면 --allowedTools 자체가 사라지고 5 도구가 disallow 된다', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig()));
    const argv = await runTurn(provider, projectWorkspace(dir, ALL_OFF));

    expect(argv).not.toContain('--allowedTools');
    expect(valueOf(argv, '--disallowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
    // 권한과 무관한 나머지 플래그는 그대로 남는다.
    expect(valueOf(argv, '--permission-mode')).toBe('default');
    expect(valueOf(argv, '--add-dir')).toBe(dir);
  });

  it('(d) permissions=null 이면 base 를 손대지 않는다', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig()));
    const argv = await runTurn(provider, projectWorkspace(dir, null));

    expect(valueOf(argv, '--allowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
    expect(argv).not.toContain('--disallowedTools');
  });

  it('Codex 는 권한을 모두 꺼도 argv 가 그대로다 (도구 단위 목록 없음)', async () => {
    const provider = new CliProvider(
      makeProviderInit(
        makeCliConfig({ permissionAdapter: new CodexPermissionAdapter() }),
      ),
    );
    const argv = await runTurn(provider, projectWorkspace(dir, ALL_OFF));

    expect(argv).not.toContain('--disallowedTools');
    expect(argv).not.toContain('--allowedTools');
    expect(valueOf(argv, '--sandbox')).toBe('read-only');
    expect(valueOf(argv, '-a')).toBe('never');
  });

  it('알 수 없는 adapter 로 채널 권한을 좁히려 하면 조용히 넘어가지 않고 멈춘다', async () => {
    // filter 를 조용히 건너뛰면 사용자가 끈 도구가 그대로 붙은 채 CLI 가
    // 뜨고, 그 사실이 아무 데도 드러나지 않는다.
    const strangeAdapter: CliPermissionAdapter = {
      buildArgs: () => [],
      buildReadOnlyArgs: () => ['--allowedTools', 'Read'],
    };
    const provider = new CliProvider(
      makeProviderInit(makeCliConfig({ permissionAdapter: strangeAdapter })),
    );

    const gen = provider.streamCompletion(
      MESSAGES,
      '',
      projectWorkspace(dir, ALL_OFF),
    );
    await expect(gen.next()).rejects.toThrow(UnknownCliKindError);
    expect(spawned.length).toBe(0);
  });

  it('persistent 세션은 채널 권한이 바뀌면 kill 후 새 권한으로 다시 뜬다', async () => {
    // R12-W D4 invalidation 이 CLI 프로세스까지 닿는지 — workspaceKey 에
    // 권한이 들어 있지 않으면 이미 떠 있는 프로세스가 옛 argv 로 계속
    // 돌아서, 사용자가 권한을 꺼도 그 회의 동안은 반영되지 않는다.
    const provider = new CliProvider(makeProviderInit(persistentConfig()));

    await runPersistentTurn(provider, projectWorkspace(dir, catalogDefaultFor('idea')), 0);
    const firstChild = spawned[0];
    if (!firstChild) throw new Error('첫 spawn 이 일어나지 않았다');

    await runPersistentTurn(provider, projectWorkspace(dir, ALL_OFF), 1);

    expect(firstChild.kill).toHaveBeenCalled();
    expect(spawned.length).toBe(2);
    const firstArgv = spawnArgv[0] ?? [];
    const secondArgv = spawnArgv[1] ?? [];
    expect(valueOf(firstArgv, '--allowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
    expect(secondArgv).not.toContain('--allowedTools');
    expect(valueOf(secondArgv, '--disallowedTools')).toBe(
      'Read,Glob,Grep,WebSearch,WebFetch',
    );
  });

  it('scoped Claude room restores a saved session with --resume', async () => {
    const provider = new CliProvider(makeProviderInit(persistentConfig()));
    const options: CompletionOptions = {
      ...projectWorkspace(dir, null),
      chatSession: chatSession('room-a:alice', 'saved-session-id', 'Continue this room.'),
    };
    await runPersistentTurn(provider, options, 0, CHAT_PERSONA);
    expect(valueOf(spawnArgv[0] ?? [], '--resume')).toBe('saved-session-id');
    expect(spawnArgv[0]).not.toContain('--session-id');
    expect(spawnArgv[0]).toContain('--safe-mode');
    expect(spawnArgv[0]).toContain('--strict-mcp-config');
    expect(valueOf(spawnArgv[0] ?? [], '--tools')).toBe('');
    expect(valueOf(spawnArgv[0] ?? [], '--system-prompt-file')).not.toBeNull();
  });

  it('scoped Claude chat replaces the default system prompt with the persona file, not input (B2)', async () => {
    const provider = new CliProvider(makeProviderInit(persistentConfig()));
    await runPersistentTurn(provider, {
      ...projectWorkspace(dir, null), chatSession: chatSession('room-a:alice', null),
    }, 0, CHAT_PERSONA);
    const file = valueOf(spawnArgv[0] ?? [], '--system-prompt-file');
    expect(file).not.toBeNull();
    expect(path.dirname(file ?? '')).toBe(instructionsDir);
    expect(readFileSync(file ?? '', 'utf8')).toBe(CHAT_PERSONA);
    expect(stdinText(spawned[0])).not.toContain('Frozen Alice');
    expect(stdinText(spawned[0])).not.toContain('<<INSTRUCTIONS>>');

    // A second turn of the same session reuses the live process and file.
    await runPersistentTurn(provider, {
      ...projectWorkspace(dir, null), chatSession: chatSession('room-a:alice', null),
    }, 0, CHAT_PERSONA);
    expect(spawned).toHaveLength(1);

    await provider.cooldown();
    expect(existsSync(file ?? '')).toBe(false);
  });

  it('keeps the persona in the input for unscoped CLI turns (no instruction file)', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig({ permissionAdapter: new CodexPermissionAdapter() })));
    const argv = await runTurn(provider, projectWorkspace(dir, null), 0, CHAT_PERSONA);
    expect(argv.some((arg) => arg.startsWith('model_instructions_file='))).toBe(false);
    expect(argv).not.toContain('--system-prompt-file');
    expect(stdinText(spawned[0])).toContain('Frozen Alice');
  });

  it('refuses a scoped chat whose instruction folder is inside the CLI working folder', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig({ permissionAdapter: new CodexPermissionAdapter() })));
    const inside = asAbsolutePath(path.join(dir, 'inside'), 'argv test');
    const run = provider.streamCompletion(MESSAGES, CHAT_PERSONA, {
      ...projectWorkspace(dir, null),
      chatSession: { ...chatSession('room-a:alice', null), instructionsDir: inside },
    });
    await expect(run.next()).rejects.toThrow(ChatCliInstructionsInsideWorkspaceError);
    expect(spawned).toHaveLength(0);
    expect(existsSync(inside)).toBe(false);
  });

  it('refuses a scoped chat without persona text instead of sending an empty system prompt', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig({ permissionAdapter: new CodexPermissionAdapter() })));
    const run = provider.streamCompletion(MESSAGES, '  ', {
      ...projectWorkspace(dir, null), chatSession: chatSession('room-a:alice', null),
    });
    await expect(run.next()).rejects.toThrow('Scoped chat CLI requires a nonempty persona');
    expect(spawned).toHaveLength(0);
  });

  it('scoped Codex chat disables local tools and user extensions without changing unscoped turns', async () => {
    const config = makeCliConfig({ permissionAdapter: new CodexPermissionAdapter() });
    const scoped = new CliProvider(makeProviderInit(config));
    const scopedArgs = await runTurn(scoped, {
      ...projectWorkspace(dir, null),
      chatSession: chatSession('room-a:alice', null),
    }, 0, CHAT_PERSONA);
    expect(scopedArgs).toContain('--ignore-user-config');
    expect(scopedArgs).toContain('--ignore-rules');
    expect(scopedArgs).toContain('features.shell_tool=false');
    expect(scopedArgs).toContain('features.unified_exec=false');
    expect(scopedArgs).toContain('features.apps=false');
    expect(scopedArgs).toContain('features.plugins=false');
    expect(scopedArgs).toContain('features.browser_use=false');
    expect(scopedArgs).toContain('features.computer_use=false');
    expect(scopedArgs).toContain('features.multi_agent=false');
    expect(scopedArgs).toContain('web_search="disabled"');
    expect(scopedArgs).toContain('project_doc_max_bytes=0');
    expect(scopedArgs).toContain('project_root_markers=[]');
    expect(scopedArgs).toContain(`projects.${JSON.stringify(dir)}.trust_level="untrusted"`);
    expect(scopedArgs).toContain('features.goals=false');
    // B2: the persona replaces Codex's built-in instructions, and the
    // permission / environment / skills context blocks are switched off.
    const instructionArg = scopedArgs.find((arg) => arg.startsWith('model_instructions_file=')) ?? '';
    const instructionFile = JSON.parse(instructionArg.slice('model_instructions_file='.length)) as string;
    expect(path.dirname(instructionFile)).toBe(instructionsDir);
    expect(readFileSync(instructionFile, 'utf8')).toBe(CHAT_PERSONA);
    expect(scopedArgs).toContain('include_permissions_instructions=false');
    expect(scopedArgs).toContain('include_environment_context=false');
    expect(scopedArgs).toContain('skills.include_instructions=false');
    // Codex drops root-level -c overrides once exec has its own: all of them follow exec.
    expect(scopedArgs.indexOf(instructionArg)).toBeGreaterThan(scopedArgs.indexOf('exec'));
    expect(stdinText(spawned[0])).not.toContain('Frozen Alice');
    expect(stdinText(spawned[0])).not.toContain('INSTRUCTIONS');
    const unscoped = new CliProvider(makeProviderInit(config));
    const ordinary = await runTurn(unscoped, projectWorkspace(dir, null), 1);
    expect(ordinary).not.toContain('--ignore-user-config');
    expect(ordinary).not.toContain('features.shell_tool=false');
    expect(ordinary).not.toContain('include_environment_context=false');
  });

  it('scoped Codex resume retains isolation flags after the resume subcommand', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig({
      permissionAdapter: new CodexPermissionAdapter(),
      buildResumeArgs: CODEX_CLI_CONFIG.buildResumeArgs,
    })));
    const argv = await runTurn(provider, {
      ...projectWorkspace(dir, null),
      chatSession: chatSession('vote:v:a', 'saved-session-id'),
    }, 0, CHAT_PERSONA);
    const exec = argv.indexOf('exec');
    expect(argv.slice(exec, exec + 3)).toEqual(['exec', 'resume', 'saved-session-id']);
    expect(argv).toContain('--ignore-user-config');
    expect(argv).toContain('features.unified_exec=false');
    expect(argv.some((arg) => arg.startsWith('model_instructions_file='))).toBe(true);
    expect(argv).toContain('include_environment_context=false');
    expect(argv).not.toContain('-C');
  });

  it('refuses scoped chat when the CLI adapter is unknown', async () => {
    const provider = new CliProvider(makeProviderInit(makeCliConfig({ permissionAdapter: undefined })));
    const run = provider.streamCompletion(MESSAGES, '', {
      ...projectWorkspace(dir, null),
      chatSession: chatSession('room-a:alice', null, ''),
    });
    await expect(run.next()).rejects.toThrow('Scoped chat CLI requires a permission adapter');
    expect(spawned).toHaveLength(0);
  });

  it('권한이 그대로면 persistent 세션을 다시 띄우지 않는다', async () => {
    // 위 시험의 대조군 — 권한을 키에 넣었다고 해서 같은 권한에서 매 turn
    // 프로세스가 새로 뜨면 회의가 느려지고 대화 맥락도 끊긴다.
    const provider = new CliProvider(makeProviderInit(persistentConfig()));
    const permissions = catalogDefaultFor('idea');

    await runPersistentTurn(provider, projectWorkspace(dir, permissions), 0);
    await runPersistentTurn(provider, projectWorkspace(dir, permissions), 0);

    expect(spawned.length).toBe(1);
    expect(spawned[0]?.kill).not.toHaveBeenCalled();
  });
});
