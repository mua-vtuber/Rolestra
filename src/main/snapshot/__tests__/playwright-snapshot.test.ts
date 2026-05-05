/**
 * playwright-snapshot 단위 테스트 — R12-C2 T16c land.
 *
 * 검증:
 *   - 정상 흐름: desktop + mobile 두 viewport capture fn 호출 + atomic write +
 *     DesignSnapshotPaths 반환 (paths / generatedAt / sourceOpinionUuid)
 *   - PathGuard: meetingId 안 escape 시퀀스 ('..') 차단 →
 *     SnapshotPathOutsideConsensusError throw
 *   - capture fn throw: viewport 분기 wrap → SnapshotCaptureError(viewport, msg)
 *   - 빈 PNG buffer: SnapshotCaptureError(viewport, 'received empty PNG buffer')
 *   - desktop 실패 시 mobile 시도 X (early throw)
 *   - atomic write 패턴: tmp 파일 → rename (writeFile + rename 호출 횟수)
 *
 * 본 테스트는 Electron BrowserWindow 의존성 *없음* — fake capture fn / fake fs
 * 주입으로 결정적 검증. production wire 는 electron-snapshot-capture.ts 가 별도.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DesignSnapshotService,
  DESIGN_SNAPSHOT_DESKTOP_FILENAME,
  DESIGN_SNAPSHOT_DESKTOP_VIEWPORT,
  DESIGN_SNAPSHOT_MOBILE_FILENAME,
  DESIGN_SNAPSHOT_MOBILE_VIEWPORT,
  SnapshotCaptureError,
  SnapshotPathOutsideConsensusError,
  type SnapshotCaptureFn,
} from '../playwright-snapshot';

const FAKE_CONSENSUS = '/fake/arena/consensus';

interface FsMock {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  randomSuffix: ReturnType<typeof vi.fn>;
}

function buildFsMock(suffixes: string[] = ['suf1', 'suf2']): FsMock {
  let i = 0;
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    randomSuffix: vi.fn(() => suffixes[i++ % suffixes.length] ?? 'suf'),
  };
}

function buildService(opts: {
  capture: SnapshotCaptureFn;
  fs?: FsMock;
  now?: () => number;
}): {
  service: DesignSnapshotService;
  fs: FsMock;
  capture: ReturnType<typeof vi.fn>;
} {
  const fs = opts.fs ?? buildFsMock();
  const captureMock = opts.capture as unknown as ReturnType<typeof vi.fn>;
  const service = new DesignSnapshotService({
    arenaRoot: { consensusPath: () => FAKE_CONSENSUS },
    capture: opts.capture,
    fs: {
      mkdir: fs.mkdir as (
        p: string,
        opts: { recursive: true },
      ) => Promise<unknown>,
      writeFile: fs.writeFile as (
        p: string,
        data: Uint8Array,
      ) => Promise<void>,
      rename: fs.rename as (from: string, to: string) => Promise<void>,
      randomSuffix: fs.randomSuffix as () => string,
    },
    now: opts.now ?? (() => 1_700_000_000_000),
  });
  return { service, fs, capture: captureMock };
}

describe('DesignSnapshotService — captureDesignSnapshot', () => {
  it('writes desktop + mobile PNG and returns DesignSnapshotPaths', async () => {
    const captureFn = vi.fn(
      async (args: { html: string; viewport: { width: number; height: number } }) =>
        Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          args.viewport.width,
          args.viewport.height,
        ]),
    );
    const { service, fs } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
      now: () => 1_700_000_001_234,
    });

    const result = await service.captureDesignSnapshot({
      htmlContent: '<html><body>hello</body></html>',
      meetingId: 'meeting-abc',
      sourceOpinionUuid: 'op-xyz',
    });

    // capture fn 두 viewport 호출 (desktop 먼저, mobile 다음).
    expect(captureFn).toHaveBeenCalledTimes(2);
    expect(captureFn.mock.calls[0]?.[0].viewport).toEqual(
      DESIGN_SNAPSHOT_DESKTOP_VIEWPORT,
    );
    expect(captureFn.mock.calls[1]?.[0].viewport).toEqual(
      DESIGN_SNAPSHOT_MOBILE_VIEWPORT,
    );
    // HTML content 두 호출 모두 동일 전달.
    expect(captureFn.mock.calls[0]?.[0].html).toBe(
      '<html><body>hello</body></html>',
    );

    // mkdir 회의 디렉토리 1 회.
    expect(fs.mkdir).toHaveBeenCalledTimes(1);
    expect(fs.mkdir.mock.calls[0]?.[0]).toBe(
      `${FAKE_CONSENSUS}/meetings/meeting-abc`,
    );

    // writeFile + rename 두 viewport × 2 = 4 호출 (atomic).
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(fs.rename).toHaveBeenCalledTimes(2);

    // 결과 paths 검증.
    expect(result.desktopPath).toBe(
      `${FAKE_CONSENSUS}/meetings/meeting-abc/${DESIGN_SNAPSHOT_DESKTOP_FILENAME}`,
    );
    expect(result.mobilePath).toBe(
      `${FAKE_CONSENSUS}/meetings/meeting-abc/${DESIGN_SNAPSHOT_MOBILE_FILENAME}`,
    );
    expect(result.generatedAt).toBe(1_700_000_001_234);
    expect(result.sourceOpinionUuid).toBe('op-xyz');
  });

  it('rejects meetingId that escapes ArenaRoot via "..": throws SnapshotPathOutsideConsensusError', async () => {
    const captureFn = vi.fn(async () => Buffer.from([0x89, 0x50]));
    const { service, fs } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
    });

    await expect(
      service.captureDesignSnapshot({
        htmlContent: '<html></html>',
        meetingId: '../../../escape',
        sourceOpinionUuid: 'op-1',
      }),
    ).rejects.toBeInstanceOf(SnapshotPathOutsideConsensusError);

    // capture / mkdir / writeFile 모두 호출 X — early throw.
    expect(captureFn).not.toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('wraps capture-fn throw as SnapshotCaptureError(desktop) and skips mobile', async () => {
    const captureFn = vi.fn(async () => {
      throw new Error('chromium crashed');
    });
    const { service, fs } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
    });

    const failure = await service
      .captureDesignSnapshot({
        htmlContent: '<html></html>',
        meetingId: 'm-1',
        sourceOpinionUuid: 'op',
      })
      .catch((err) => err);

    expect(failure).toBeInstanceOf(SnapshotCaptureError);
    expect((failure as SnapshotCaptureError).viewport).toBe('desktop');
    expect((failure as SnapshotCaptureError).message).toContain(
      'chromium crashed',
    );
    // desktop 실패 시 mobile capture 호출 X — early throw.
    expect(captureFn).toHaveBeenCalledTimes(1);
    // 또한 desktop tmp 파일은 write 시도 X (capture 가 throw 이므로).
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('treats empty PNG buffer as failure', async () => {
    const captureFn = vi.fn(async () => Buffer.alloc(0));
    const { service } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
    });

    const failure = await service
      .captureDesignSnapshot({
        htmlContent: '<html></html>',
        meetingId: 'm-1',
        sourceOpinionUuid: 'op',
      })
      .catch((err) => err);

    expect(failure).toBeInstanceOf(SnapshotCaptureError);
    expect((failure as SnapshotCaptureError).viewport).toBe('desktop');
    expect((failure as SnapshotCaptureError).message).toContain(
      'received empty PNG buffer',
    );
  });

  it('treats mobile-only failure as SnapshotCaptureError(mobile)', async () => {
    let call = 0;
    const captureFn = vi.fn(async () => {
      call += 1;
      if (call === 1) return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      throw new Error('mobile renderer hung');
    });
    const { service, fs } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
    });

    const failure = await service
      .captureDesignSnapshot({
        htmlContent: '<html></html>',
        meetingId: 'm-2',
        sourceOpinionUuid: 'op-2',
      })
      .catch((err) => err);

    expect(failure).toBeInstanceOf(SnapshotCaptureError);
    expect((failure as SnapshotCaptureError).viewport).toBe('mobile');
    // desktop 은 이미 디스크에 land — mobile 실패 후에도 desktop tmp/rename 1 회.
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.rename).toHaveBeenCalledTimes(1);
  });

  it('atomic write — writeFile to tmp first then rename to final', async () => {
    const captureFn = vi.fn(async () => Buffer.from([0x89, 0x50]));
    const { service, fs } = buildService({
      capture: captureFn as unknown as SnapshotCaptureFn,
      fs: buildFsMock(['rnd1', 'rnd2']),
    });

    await service.captureDesignSnapshot({
      htmlContent: '<html></html>',
      meetingId: 'mtg-9',
      sourceOpinionUuid: 'op-9',
    });

    // 첫 write: desktop tmp.
    const firstWrite = fs.writeFile.mock.calls[0]?.[0] as string;
    expect(firstWrite).toBe(
      `${FAKE_CONSENSUS}/meetings/mtg-9/${DESIGN_SNAPSHOT_DESKTOP_FILENAME}.rnd1.tmp`,
    );
    // 첫 rename: tmp → final.
    expect(fs.rename.mock.calls[0]?.[0]).toBe(firstWrite);
    expect(fs.rename.mock.calls[0]?.[1]).toBe(
      `${FAKE_CONSENSUS}/meetings/mtg-9/${DESIGN_SNAPSHOT_DESKTOP_FILENAME}`,
    );
    // 두 번째 write: mobile tmp.
    const secondWrite = fs.writeFile.mock.calls[1]?.[0] as string;
    expect(secondWrite).toBe(
      `${FAKE_CONSENSUS}/meetings/mtg-9/${DESIGN_SNAPSHOT_MOBILE_FILENAME}.rnd2.tmp`,
    );
    expect(fs.rename.mock.calls[1]?.[1]).toBe(
      `${FAKE_CONSENSUS}/meetings/mtg-9/${DESIGN_SNAPSHOT_MOBILE_FILENAME}`,
    );
  });
});
