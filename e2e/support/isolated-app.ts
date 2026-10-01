/**
 * Isolated Electron app for the E2E specs: a fresh temporary root holds
 * ArenaRoot, userData, settings and secrets for one test and its restarts,
 * and the app is driven only through its window and the preload bridge.
 * The chat CLI working folder is always `<ArenaRoot>/consensus`, so the
 * `ROLESTRA_ARENA_ROOT` override isolates it too.
 *
 * `OLLAMA_HOST` is always set to an address the test owns (the fake
 * server), through the same env path a user would use, so local AI
 * detection never reaches a real Ollama on the machine running the tests.
 */
import { _electron as electron, expect, type Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  IpcChannel,
  IpcRequest,
  IpcResponse,
} from '../../src/shared/ipc-types';

export interface TestArenaBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    data: IpcRequest<C>,
  ): Promise<IpcResponse<C>>;
}

export interface IsolatedApp {
  app: Awaited<ReturnType<typeof electron.launch>>;
  tempRoot: string;
  userData: string;
  bootstrapPath: string;
  arenaRoot: string;
  ollamaHost: string;
}

export interface IsolatedAppOptions {
  /** Address local AI detection uses (`OLLAMA_HOST`) — the test's fake server. */
  ollamaHost: string;
}

function appEnv(arenaRoot: string, ollamaHost: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    ROLESTRA_ARENA_ROOT: arenaRoot,
    OLLAMA_HOST: ollamaHost,
    NODE_ENV: 'test',
    ELECTRON_RENDERER_URL: '',
  };
}

export async function launchIsolatedApp(options: IsolatedAppOptions): Promise<IsolatedApp> {
  const tempRoot = await mkdtemp(join(tmpdir(), 'rolestra-chat-first-e2e-'));
  const userData = join(tempRoot, 'userData');
  const arenaRoot = join(tempRoot, 'arena');
  const bootstrapPath = join(tempRoot, 'bootstrap.cjs');
  const mainEntry = resolve(__dirname, '../../out/main/index.js');

  await Promise.all([
    mkdir(userData, { recursive: true }),
    mkdir(arenaRoot, { recursive: true }),
  ]);
  await writeFile(
    bootstrapPath,
    [
      "const { app } = require('electron');",
      "app.setName('Rolestra');",
      `app.setPath('userData', ${JSON.stringify(userData)});`,
      `require(${JSON.stringify(mainEntry)});`,
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const app = await electron.launch({
      args: [bootstrapPath],
      env: appEnv(arenaRoot, options.ollamaHost),
    });
    return { app, tempRoot, userData, bootstrapPath, arenaRoot, ollamaHost: options.ollamaHost };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function restartIsolatedApp(isolated: IsolatedApp): Promise<Page> {
  await isolated.app.close();
  isolated.app = await electron.launch({
    args: [isolated.bootstrapPath],
    env: appEnv(isolated.arenaRoot, isolated.ollamaHost),
  });
  const window = await isolated.app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return window;
}

export async function invokeInApp<C extends IpcChannel>(
  page: Page,
  channel: C,
  data: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const result = await page.evaluate(
    async ({ channelName, payload }) => {
      const arena = (globalThis as typeof globalThis & {
        arena?: TestArenaBridge;
      }).arena;
      if (!arena) throw new Error('window.arena bridge is missing');
      // Playwright serializes the function argument and widens the bridge's
      // conditional generic. The call still goes through preload typedInvoke;
      // the outer helper keeps each caller's channel/request/response typed.
      const invoke = arena.invoke as unknown as (
        name: string,
        request: unknown,
      ) => Promise<unknown>;
      return invoke(channelName, payload);
    },
    { channelName: channel, payload: data },
  );
  return result as IpcResponse<C>;
}

export async function sendMessage(
  page: Page,
  content: string,
): Promise<void> {
  const textarea = page.getByTestId('composer-textarea');
  await expect(textarea).toBeVisible();
  await textarea.fill(content);
  await textarea.press('Enter');
}

