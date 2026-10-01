import { app, BrowserWindow, session } from 'electron';
import { initializeFoundation } from './bootstrap/foundation';
import { createChatStreamBridge, wireChatMessageFlows } from './bootstrap/chat-event-bridges';
import { wireChatAccessors } from './bootstrap/chat-ipc-accessors';
import { createChatServices } from './bootstrap/chat-services';
import { closeDatabase } from './database/connection';
import { registerIpcHandlers } from './ipc/router';
import { configureApplicationMenu } from './ui/app-menu';
import { applyDevUserDataOverride } from './config/dev-userdata-override';
import { providerRegistry } from './providers/registry';
import { createWindow } from './window/create-window';

// F4-2: applied FIRST, before anything (including app.setName below, whose
// own doc comment explains why userData must not be read before this
// point) can call app.getPath('userData'). No-op in a packaged build or
// when ROLESTRA_DEV_USER_DATA is unset — see dev-userdata-override.ts.
// `npm run dev:fresh` (tools/dev-fresh.ts) is the only thing that sets it.
applyDevUserDataOverride(app);

// R12-C round 2 (2026-05-03): app.setName 은 app.whenReady 전에 호출해야
// app.getPath('userData') 가 올바른 폴더 (`%APPDATA%\Rolestra` 등) 를
// 반환한다. package.json 의 npm 식별자도 productName 과 일치한다.
app.setName('Rolestra');

let chatResponder: ReturnType<typeof wireChatMessageFlows> | null = null;
let chatVoteService: ReturnType<typeof createChatServices>['chatVoteService'] | null = null;
let shutdownStarted = false;
let shutdownComplete = false;

app.whenReady().then(async () => {
  try {
    const { arenaRoot, logger, chatCliInstructionsDir } = await initializeFoundation(app);

    // Block all hardware permission requests (camera, mic, geolocation, etc.)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    const services = createChatServices(arenaRoot, chatCliInstructionsDir);
    chatVoteService = services.chatVoteService;
    const responder = wireChatMessageFlows(services);
    chatResponder = responder;
    const streamBridge = createChatStreamBridge(services, responder);
    wireChatAccessors(services, logger, streamBridge, responder);

    // Register handlers after their chat accessors, before opening a window.
    registerIpcHandlers(services.channelService, services.opinionRepository, services.chatRoomService);
    configureApplicationMenu();

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err) {
    // Fatal bootstrap failure (ArenaRoot ensure, migration, or any registration
    // above). Abort startup rather than letting the app run in a broken state.
    // Mirrors the "migration failure blocks startup" rule from CLAUDE.md §7.
    console.error('[bootstrap] Fatal startup error:', err);
    app.exit(1);
  }
});

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void (async () => {
    try {
      await Promise.allSettled([chatResponder?.shutdown(), chatVoteService?.shutdown()]);
      await providerRegistry.shutdownAll();
    } catch (error) {
      console.error('[shutdown] Provider cleanup failed', error);
    } finally {
      closeDatabase();
      shutdownComplete = true;
      app.quit();
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
