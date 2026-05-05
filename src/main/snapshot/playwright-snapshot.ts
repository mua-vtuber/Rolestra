/**
 * playwright-snapshot — R12-C2 P3 T16c land. spec §11.18.9d / §5.2 step 7b.
 *
 * design-workflow `generating_snapshot` phase 의 본체. 회의 #2 의 root opinion
 * (kind='root', design_implementation 응답) `content` 필드 = HTML+CSS 를 받아
 * desktop 1280x720 + mobile 375x812 두 viewport PNG 로 렌더 + ArenaRoot 봉인 안
 * `<consensus>/meetings/<meetingId>/design-snapshot-{desktop,mobile}.png` 로
 * atomic 저장.
 *
 * 본 모듈은 *순수* — Electron BrowserWindow import 는 production 어댑터
 * (`electron-snapshot-capture.ts`) 가 격리 주입한다. 이는 vitest + better-sqlite3
 * Node-only 환경에서 모듈을 import 해도 electron binding 을 끌어들이지 않게
 * 하기 위함 (notification-service / electron-notifier-adapter 와 같은 패턴).
 *
 * 파일 이름은 spec 에 "playwright-snapshot.ts" 로 정식화돼 있어 그대로 유지.
 * 실제 구현은 Playwright X — 프로젝트에 playwright 의존성 없음. Electron 의
 * off-screen BrowserWindow + capturePage 로 같은 contract 충족 (PNG 절대 경로
 * 2 개 반환).
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  - §5.2  step 7b — generating_snapshot phase 정의
 *  - §11.18.9d 입력 (HTML+CSS) / 출력 (PNG 2) / 실패 분기 / stream 신호 contract
 */

import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { DesignSnapshotPaths } from '../meetings/workflows/design-workflow';

// ── 상수 — viewport / 파일 이름 ──────────────────────────────────────

/** desktop viewport — spec §11.18.9d 명시. */
export const DESIGN_SNAPSHOT_DESKTOP_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

/** mobile viewport — spec §11.18.9d 명시. */
export const DESIGN_SNAPSHOT_MOBILE_VIEWPORT = {
  width: 375,
  height: 812,
} as const;

/** desktop PNG 파일 이름 — `<consensus>/meetings/<meetingId>/` 안. */
export const DESIGN_SNAPSHOT_DESKTOP_FILENAME = 'design-snapshot-desktop.png';

/** mobile PNG 파일 이름 — `<consensus>/meetings/<meetingId>/` 안. */
export const DESIGN_SNAPSHOT_MOBILE_FILENAME = 'design-snapshot-mobile.png';

/** ArenaRoot 안 회의 디렉토리 (minutes 와 같은 dir 공유). */
const MEETINGS_SUBDIR = 'meetings';

// ── 도메인 에러 ──────────────────────────────────────────────────────

/**
 * resolved snapshot 경로가 ArenaRoot/consensus 봉인을 벗어났을 때 throw.
 * orchestrator 의 통합 catch 가 abortReason='snapshot_failed' 로 매핑.
 *
 * meeting-minutes-service 의 `MinutesPathOutsideConsensusError` 와 같은 패턴
 * (TOCTOU 방어 — path.resolve 후 startsWith 비교).
 */
export class SnapshotPathOutsideConsensusError extends Error {
  readonly resolvedPath: string;
  readonly consensusBase: string;
  constructor(resolvedPath: string, consensusBase: string) {
    super(
      `[DesignSnapshot] resolved path '${resolvedPath}' is outside consensus base '${consensusBase}' — refusing to write`,
    );
    this.name = 'SnapshotPathOutsideConsensusError';
    this.resolvedPath = resolvedPath;
    this.consensusBase = consensusBase;
  }
}

/**
 * Electron BrowserWindow capturePage 가 빈 PNG 를 반환했거나 어댑터가 throw 한
 * 경우. caller (orchestrator) 가 catch 후 abortReason='snapshot_failed' 매핑.
 */
export class SnapshotCaptureError extends Error {
  /** 어느 viewport 캡처 중 실패했는지 (디버그 / 로깅 용도). */
  readonly viewport: 'desktop' | 'mobile';
  constructor(viewport: 'desktop' | 'mobile', message: string) {
    super(`[DesignSnapshot] ${viewport} capture failed: ${message}`);
    this.name = 'SnapshotCaptureError';
    this.viewport = viewport;
  }
}

// ── capture fn contract — electron 어댑터 / test fake 공유 ─────────────

/**
 * 단일 viewport HTML → PNG buffer 캡처 contract. production 어댑터
 * (`electron-snapshot-capture.ts`) 가 BrowserWindow off-screen + capturePage 로
 * 구현, 테스트는 결정적 fake 주입 (e.g. 1x1 PNG buffer).
 */
export interface SnapshotCaptureFn {
  (args: {
    html: string;
    viewport: { width: number; height: number };
  }): Promise<Buffer>;
}

// ── 입력 / 의존성 ───────────────────────────────────────────────────

/**
 * `captureDesignSnapshot` 입력 — orchestrator runGeneratingSnapshotPhase 가
 * 채워서 호출.
 */
export interface DesignSnapshotRequest {
  /** UI 직원 (design.ui) 의 step 6 응답 본문 — HTML + CSS 통째. */
  htmlContent: string;
  /** 회의 ID — `<consensus>/meetings/<meetingId>/` 디렉토리 결정. */
  meetingId: string;
  /** 캡처 대상 root opinion uuid — DesignSnapshotPaths.sourceOpinionUuid 로 전달. */
  sourceOpinionUuid: string;
}

/**
 * 테스트가 주입할 수 있는 fs / time / capture / random 분리. production 은
 * 모두 default. captureDesktop / captureMobile 두 분기 분리 — 단일 impl 로 해도
 * 테스트가 viewport별 결과를 분리해서 검증 가능 (orchestrator-side 통합).
 */
export interface DesignSnapshotServiceDeps {
  arenaRoot: { consensusPath: () => string };
  /** 기본 = `electron-snapshot-capture.createElectronSnapshotCapture()` 주입. */
  capture: SnapshotCaptureFn;
  /** 기본 = `Date.now`. */
  now?: () => number;
  /** 기본 = fs.promises (mkdir / writeFile bytes / rename) + randomSuffix. */
  fs?: {
    mkdir: (p: string, opts: { recursive: true }) => Promise<unknown>;
    writeFile: (p: string, data: Uint8Array) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    randomSuffix: () => string;
  };
}

// ── 서비스 ──────────────────────────────────────────────────────────

/**
 * `DesignSnapshotService` — design-workflow step 7b 본체. 단일 메서드
 * `captureDesignSnapshot` 만 노출. orchestrator 가 stream emit + abort 매핑은
 * 직접 처리 (서비스는 disk + capture 계층만 담당).
 */
export class DesignSnapshotService {
  private readonly arenaRoot: { consensusPath: () => string };
  private readonly capture: SnapshotCaptureFn;
  private readonly nowFn: () => number;
  private readonly fs: NonNullable<DesignSnapshotServiceDeps['fs']>;

  constructor(deps: DesignSnapshotServiceDeps) {
    this.arenaRoot = deps.arenaRoot;
    this.capture = deps.capture;
    this.nowFn = deps.now ?? Date.now;
    this.fs = deps.fs ?? {
      mkdir: (p, opts) => fsp.mkdir(p, opts),
      writeFile: (p, data) => fsp.writeFile(p, data),
      rename: (from, to) => fsp.rename(from, to),
      randomSuffix: () => randomBytes(8).toString('hex'),
    };
  }

  /**
   * 회의 #2 의 design_implementation root opinion HTML/CSS 를 두 viewport PNG
   * 로 렌더 + atomic 저장. 결과 paths 반환.
   *
   * 실패 분기:
   *   - capture fn throw → SnapshotCaptureError (viewport 별 분리 wrap)
   *   - resolved 경로 봉인 위반 → SnapshotPathOutsideConsensusError
   *   - 빈 PNG buffer → SnapshotCaptureError (viewport 별)
   *
   * caller (orchestrator) 가 try/catch 후 abortReason='snapshot_failed' 로 매핑.
   * 본 함수 자체는 desktop 실패 → mobile 시도 X (early throw 로 일관성 유지 —
   * 부분 PNG 저장 방지).
   */
  async captureDesignSnapshot(
    req: DesignSnapshotRequest,
  ): Promise<DesignSnapshotPaths> {
    // 1. resolve target dir + PathGuard 봉인 검증 (TOCTOU 안전).
    const consensusBase = path.resolve(this.arenaRoot.consensusPath());
    const targetDir = path.resolve(
      consensusBase,
      MEETINGS_SUBDIR,
      req.meetingId,
    );

    const baseWithSep = consensusBase + path.sep;
    if (targetDir !== consensusBase && !targetDir.startsWith(baseWithSep)) {
      throw new SnapshotPathOutsideConsensusError(targetDir, consensusBase);
    }

    await this.fs.mkdir(targetDir, { recursive: true });

    // 2. desktop 캡처 + 봉인 검증.
    const desktopPath = path.join(
      targetDir,
      DESIGN_SNAPSHOT_DESKTOP_FILENAME,
    );
    const desktopPng = await this.captureViewport(
      'desktop',
      req.htmlContent,
      DESIGN_SNAPSHOT_DESKTOP_VIEWPORT,
    );
    await this.atomicWritePng(desktopPath, desktopPng);

    // 3. mobile 캡처 + 봉인 검증.
    const mobilePath = path.join(
      targetDir,
      DESIGN_SNAPSHOT_MOBILE_FILENAME,
    );
    const mobilePng = await this.captureViewport(
      'mobile',
      req.htmlContent,
      DESIGN_SNAPSHOT_MOBILE_VIEWPORT,
    );
    await this.atomicWritePng(mobilePath, mobilePng);

    return {
      desktopPath,
      mobilePath,
      generatedAt: this.nowFn(),
      sourceOpinionUuid: req.sourceOpinionUuid,
    };
  }

  /**
   * 단일 viewport 캡처 + 빈 buffer 가드. capture fn 의 throw 는 분기별로
   * SnapshotCaptureError 로 wrap — orchestrator 가 viewport 정보를 활용
   * (stream + 회의록 audit 메시지).
   */
  private async captureViewport(
    viewport: 'desktop' | 'mobile',
    html: string,
    viewportSize: { width: number; height: number },
  ): Promise<Buffer> {
    let png: Buffer;
    try {
      png = await this.capture({ html, viewport: viewportSize });
    } catch (err) {
      throw new SnapshotCaptureError(
        viewport,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (png.length === 0) {
      throw new SnapshotCaptureError(viewport, 'received empty PNG buffer');
    }
    return png;
  }

  /**
   * tmp 파일 (`<target>.<rand>.tmp`) 에 먼저 쓰고 rename — POSIX/Windows 모두
   * 같은 디렉토리 안 rename 은 atomic. meeting-minutes-service 와 동일 전략.
   */
  private async atomicWritePng(
    targetFile: string,
    data: Buffer,
  ): Promise<void> {
    const tmpFile = `${targetFile}.${this.fs.randomSuffix()}.tmp`;
    await this.fs.writeFile(tmpFile, data);
    await this.fs.rename(tmpFile, targetFile);
  }
}
