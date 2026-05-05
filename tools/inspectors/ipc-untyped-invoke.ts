/**
 * ipc-untyped-invoke — typedInvoke 우회 + 문자열 IPC 채널 검출.
 *
 * 헌법: SoC / Consistency.
 * 절대 위반 금지 규칙 #2 (문자열 IPC 직접 호출 금지) 의 코드 표현.
 *
 * 차단 패턴:
 *  - ipcRenderer.invoke(...) — typedInvoke 래퍼만 허용
 *  - ipcMain.handle(...)     — IPC router 만 허용
 *  - ipcMain.on(...)          — IPC router 만 허용
 *
 * Allowlist (typed wiring 본체):
 *  - src/preload/                          (typedInvoke / contextBridge 정의)
 *  - src/main/ipc/router.ts, registry.ts, channel*.ts (디스패처)
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const IPC_PATTERN =
  /\b(?:ipcRenderer|ipcMain)\.(invoke|handle|on|send|sendSync|emit)\s*\(/;

const ALLOWLIST_PREFIXES: readonly string[] = [
  'src/preload/',
  'src/main/ipc/router',
  'src/main/ipc/handler-registry',
  'src/main/ipc/channel-map',
  'src/main/ipc/typed-invoke',
  'src/main/ipc/typed',
];

function isAllowed(rel: string): boolean {
  return ALLOWLIST_PREFIXES.some((p) => rel.startsWith(p));
}

const inspector: Inspector = {
  category: 'ipc-untyped-invoke',
  constitution: 'SoC',
  scope: 'safety',
  description:
    'typedInvoke 우회 — ipcRenderer.invoke / ipcMain.handle 직접 호출 검출.',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.rel.startsWith('src/')) return [];
    if (isAllowed(file.rel)) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = IPC_PATTERN.exec(text);
      if (match === null) continue;
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      hits.push({
        category: 'ipc-untyped-invoke',
        constitution: 'SoC',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `ipcRenderer/ipcMain.${match[1] ?? ''} 직접 호출 — typedInvoke 래퍼 / IPC router 경유 필요.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
