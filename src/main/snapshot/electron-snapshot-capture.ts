/**
 * electron-snapshot-capture — production {@link SnapshotCaptureFn} 어댑터.
 * design-workflow generating_snapshot phase (T16c) 의 PNG 렌더러.
 *
 * 왜 별도 파일인가:
 *   {@link DesignSnapshotService} (`playwright-snapshot.ts`) 는 vitest +
 *   better-sqlite3 Node-only 환경에서도 import 가능해야 한다 — 그래서 module
 *   scope 에서 'electron' 을 import 하지 않는다. 본 어댑터가 production main
 *   bootstrap 에서만 끌려와 BrowserWindow 의존성을 격리한다 (notification-service
 *   와 electron-notifier-adapter 가 따른 정확히 같은 패턴).
 *
 * 동작:
 *   1. show:false BrowserWindow 생성 (off-screen, 크롬 표시 X)
 *   2. data: URL 로 HTML inline load — 외부 자원 / 네트워크 fetch 차단
 *   3. did-finish-load 대기 후 webContents.capturePage()
 *   4. NativeImage.toPNG() → Buffer 반환
 *   5. finally win.destroy() — 메모리 / GPU 자원 회수
 *
 * 보안 / 격리:
 *   - sandbox:true + nodeIntegration:false + contextIsolation:true 기본
 *   - javascript:false — 회의 응답 HTML 안 inline script 의도된 차단 (디자인은
 *     정적 mockup, 동적 스크립트 실행 시 캡처 결과 비결정성). spec §11.18.9d
 *     "정적 HTML/CSS 렌더 가정" 부합.
 *   - data: URL 사용으로 file:// 접근 X — `<img src='file:///...'>` 같은 외부
 *     리소스 접근 시도도 차단 (origin = data:).
 *   - 폰트 / 외부 CSS @import 도 막힘 (network access X) — 직원이 inline CSS
 *     로 작성하도록 prompt 가 강제 (design-workflow.ts contentHintForKind).
 */

import { BrowserWindow } from 'electron';
import type { SnapshotCaptureFn } from './playwright-snapshot';

/**
 * data: URL 변환 — `data:text/html;charset=utf-8;base64,...`. Electron
 * `loadURL` 는 매우 큰 data URL (수백 KB ~ MB) 도 처리 — 일반 디자인 mockup
 * 크기 (수십 KB) 는 안전 범위.
 */
function htmlToDataUrl(html: string): string {
  const b64 = Buffer.from(html, 'utf-8').toString('base64');
  return `data:text/html;charset=utf-8;base64,${b64}`;
}

/**
 * production 어댑터 factory — main bootstrap 가 한 번 호출해 반환된 fn 을
 * `DesignSnapshotService` deps.capture 에 주입.
 *
 * 매 호출마다 새 BrowserWindow 를 만들고 종료한다 — 회의당 2 회 (desktop +
 * mobile) 호출이 전부라 윈도우 풀링 / 재사용은 over-engineering. 두 캡처 사이
 * 에 webContents.session 잔여 캐시가 영향 X (data: URL = 매번 새 origin).
 */
export function createElectronSnapshotCapture(): SnapshotCaptureFn {
  return async ({ html, viewport }) => {
    const win = new BrowserWindow({
      show: false,
      width: viewport.width,
      height: viewport.height,
      // useContentSize 로 BrowserWindow.height 가 chrome 포함이 아닌 content 영역
      // 으로 해석되게 함 — show:false 라 chrome 없지만 viewport 명시 의도.
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        // 디자인은 정적 HTML/CSS — 스크립트 실행 차단 (spec §11.18.9d 부합 +
        // 캡처 결정성 + 보안 격리).
        javascript: false,
        // 외부 리소스 fetch 차단 — webSecurity:true 가 기본이지만 명시.
        webSecurity: true,
      },
    });

    try {
      await win.loadURL(htmlToDataUrl(html));
      const image = await win.webContents.capturePage();
      return image.toPNG();
    } finally {
      if (!win.isDestroyed()) {
        win.destroy();
      }
    }
  };
}
