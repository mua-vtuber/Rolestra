/**
 * arena-root:open-folder (spec 2026-10-01-messenger-redesign.md R5-3): main
 * opens the folder it already knows — the ArenaRoot (conversation-log
 * folder) — and never takes a path from the renderer. Electron's
 * `shell.openPath` reports failure as a non-empty string, which must reach
 * the caller as an error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openPath: vi.fn<(path: string) => Promise<string>>() }));

vi.mock('electron', () => ({ shell: { openPath: mocks.openPath } }));

import { handleArenaRootGet, handleArenaRootOpenFolder, setArenaRootServiceAccessor } from '../arena-root-handler';
import { v3ChannelSchemas } from '../../../../shared/ipc-schemas';
import type { ArenaRootService } from '../../../arena/arena-root-service';

const ARENA = 'D:/Users/me/Documents/Rolestra';

beforeEach(() => {
  mocks.openPath.mockReset();
  setArenaRootServiceAccessor(() => ({ getPath: () => ARENA }) as unknown as ArenaRootService);
});

describe('arena-root:open-folder', () => {
  it('opens the ArenaRoot path main resolved', async () => {
    mocks.openPath.mockResolvedValue('');

    await expect(handleArenaRootOpenFolder()).resolves.toEqual({ success: true });
    expect(mocks.openPath).toHaveBeenCalledWith(ARENA);
    expect(handleArenaRootGet()).toEqual({ path: ARENA });
  });

  it('turns an openPath error string into a thrown error naming the folder and cause', async () => {
    mocks.openPath.mockResolvedValue('Failed to open path');

    await expect(handleArenaRootOpenFolder()).rejects.toThrow(
      `Could not open the conversation-log folder ${ARENA}: Failed to open path`,
    );
  });

  it('accepts no request payload — a renderer cannot pass a path', () => {
    const schema = v3ChannelSchemas['arena-root:open-folder'];
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse({ path: 'C:/Windows' }).success).toBe(false);
    expect(schema.safeParse('C:/Windows').success).toBe(false);
  });
});
