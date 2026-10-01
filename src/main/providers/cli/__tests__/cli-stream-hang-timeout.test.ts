/**
 * CliStreamer hang timeout 전환 시점 검증.
 *
 * 회귀 대상: CLI 가 `{"type":"init"}` 같은 meta 이벤트만 내보낸
 * 직후부터 짧은 `subsequent` 예산(30초)이 적용되어, 모델이 아직 생각 중인데
 * `CLI response hang timeout (... 30000ms)` 로 끊기던 문제. 전환은 소비자에게
 * 실제 text 토큰이 전달된 뒤에만 일어나야 한다.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CliOutputParser } from '../cli-output-parser';
import { CliSessionState } from '../cli-session-state';
import { CliStreamer } from '../cli-stream';
import type { CliRuntimeConfig } from '../cli-provider';

const FIRST_MS = 60_000;
const SUBSEQUENT_MS = 30_000;

const CONFIG: CliRuntimeConfig = {
  command: 'codex',
  args: [],
  inputFormat: 'pipe',
  outputFormat: 'stream-json',
  sessionStrategy: 'per-turn',
  hangTimeout: { first: FIRST_MS, subsequent: SUBSEQUENT_MS },
};

interface FakeChild {
  proc: ChildProcess;
  stdout: PassThrough;
}

function makeChild(): FakeChild {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  const stdout = new PassThrough();
  Object.defineProperty(emitter, 'stdout', { value: stdout });
  Object.defineProperty(emitter, 'stdin', { value: null });
  return { proc: emitter, stdout };
}

function makeStreamer(): CliStreamer {
  return new CliStreamer(
    new CliOutputParser(),
    new CliSessionState(),
  );
}

/**
 * 생성기를 백그라운드에서 돌리며 수집한 토큰과 종료 사유를 노출한다.
 * `settled` 는 생성기가 끝나거나 throw 한 뒤에만 채워진다.
 */
function drain(gen: AsyncGenerator<string>): {
  tokens: string[];
  settled: () => { ok: boolean; error: Error | null } | null;
} {
  const tokens: string[] = [];
  let settled: { ok: boolean; error: Error | null } | null = null;
  void (async () => {
    try {
      for await (const token of gen) tokens.push(token);
      settled = { ok: true, error: null };
    } catch (err) {
      settled = { ok: false, error: err as Error };
    }
  })();
  return { tokens, settled: () => settled };
}

/** 대기 중인 microtask 를 비운다 (fake timer 와 병행). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('CliStreamer hang timeout — first/subsequent 전환 시점', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['claude', 'codex'])('%s raw text passes through unchanged', async (command) => {
    const { proc, stdout } = makeChild();
    const config: CliRuntimeConfig = { ...CONFIG, command, outputFormat: 'raw-stdout' };
    const run = drain(makeStreamer().readStdout(proc, config));
    await flush();
    const text = 'answer [[[START_OF_RESPONSE]]] with markers';
    stdout.emit('data', text);
    proc.emit('exit', 0, null);
    await flush();
    expect(run.tokens).toEqual([text]);
    expect(run.settled()).toEqual({ ok: true, error: null });
  });

  it('meta 이벤트만 온 뒤의 침묵은 subsequent 를 넘겨도 타임아웃되지 않는다', async () => {
    const { proc, stdout } = makeChild();
    const run = drain(makeStreamer().readStdout(proc, CONFIG));
    await flush();

    // init 은 text 토큰이 아니므로 소비자에게 아무것도 전달되지 않는다.
    stdout.emit('data', '{"type":"init","session_id":"s-1"}\n');
    await flush();
    expect(run.tokens).toEqual([]);

    // subsequent 예산을 넘겨도 아직 first 예산 안이므로 살아 있어야 한다.
    await vi.advanceTimersByTimeAsync(SUBSEQUENT_MS + 1_000);
    await flush();
    expect(run.settled()).toBeNull();

    // first 예산을 넘기면 그때 비로소 타임아웃.
    await vi.advanceTimersByTimeAsync(FIRST_MS);
    await flush();
    const settled = run.settled();
    expect(settled?.ok).toBe(false);
    expect(settled?.error?.message).toContain('hang timeout');
    expect(settled?.error?.message).toContain(`${FIRST_MS}ms`);
  });

  it('wakes an idle persistent reader immediately when its room closes', async () => {
    const { proc } = makeChild();
    const controller = new AbortController();
    const run = drain(makeStreamer().readPersistentResponse(proc, CONFIG, controller.signal));
    await flush();
    controller.abort();
    await flush();
    expect(run.settled()).toEqual({ ok: true, error: null });
  });

  it('does not treat an error result boundary as a successful answer', async () => {
    const { proc, stdout } = makeChild();
    const run = drain(makeStreamer().readPersistentResponse(proc, {
      ...CONFIG, responseBoundary: (line) => line.includes('"type":"result"'),
    }));
    await flush();
    stdout.emit('data', '{"type":"result","subtype":"error_during_execution"}\n');
    await flush();
    expect(run.settled()?.ok).toBe(false);
    expect(run.settled()?.error?.message).toContain('error_during_execution');
  });

  it('첫 text 토큰이 전달된 뒤에는 subsequent 예산이 적용된다', async () => {
    const { proc, stdout } = makeChild();
    const run = drain(makeStreamer().readStdout(proc, CONFIG));
    await flush();

    stdout.emit('data', '{"type":"init","session_id":"s-2"}\n');
    stdout.emit('data', '{"type":"text","text":"안녕"}\n');
    await flush();
    expect(run.tokens).toEqual(['안녕']);

    // 전환 뒤에는 subsequent 를 넘긴 침묵에서 타임아웃.
    await vi.advanceTimersByTimeAsync(SUBSEQUENT_MS + 1_000);
    await flush();
    const settled = run.settled();
    expect(settled?.ok).toBe(false);
    expect(settled?.error?.message).toContain(`${SUBSEQUENT_MS}ms`);
  });
});
