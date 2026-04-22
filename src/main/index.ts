import { app, BrowserWindow, session } from 'electron';
import { join } from 'path';
import { runMigrations } from './database/migrator';
import { closeDatabase, initDatabaseRoot } from './database/connection';
import { registerIpcHandlers } from './ipc/router';
import { providerRegistry } from './providers/registry';
import { setMainWindow } from './ipc/handlers/chat-handler';
import { setExecutionWebContents } from './ipc/handlers/execution-handler';
import { setPermissionWebContents, setPermissionServiceAccessor } from './ipc/handlers/permission-handler';
import { setLoggerAccessor } from './ipc/handlers/log-handler';
import { configureApplicationMenu } from './ui/app-menu';
import { restoreProvidersFromDb } from './providers/provider-restore';
import { createLogger } from './log/structured-logger';
import { permissionService, consensusFolderService } from './ipc/handlers/workspace-handler';
import { getConfigService } from './config/instance';
import { ArenaRootService } from './arena/arena-root-service';
import { getDatabase } from './database/connection';
import { ProjectRepository } from './projects/project-repository';
import { MeetingRepository } from './meetings/meeting-repository';
import { ApprovalRepository } from './approvals/approval-repository';
import { DashboardService } from './dashboard/dashboard-service';
import { setDashboardServiceAccessor } from './ipc/handlers/dashboard-handler';
import { MessageRepository } from './channels/message-repository';
import { MessageService } from './channels/message-service';
import { MeetingService } from './meetings/meeting-service';
import { setMessageServiceAccessor } from './ipc/handlers/message-handler';
import { setMeetingAbortServiceAccessor } from './ipc/handlers/meeting-handler';
import { ChannelRepository } from './channels/channel-repository';
import { ChannelService } from './channels/channel-service';
import { ProjectService } from './projects/project-service';
import { setProjectServiceAccessor } from './ipc/handlers/project-handler';
import {
  setChannelServiceAccessor,
  setMeetingServiceAccessor,
} from './ipc/handlers/channel-handler';
import { StreamBridge } from './streams/stream-bridge';
import { setStreamBridgeInstance } from './streams/stream-bridge-accessor';
import { ApprovalService } from './approvals/approval-service';
import { ApprovalSystemMessageInjector } from './approvals/approval-system-message-injector';
import { setApprovalServiceAccessor } from './ipc/handlers/approval-handler';
import { NotificationRepository } from './notifications/notification-repository';
import { NotificationService } from './notifications/notification-service';
import { ElectronNotifierAdapter } from './notifications/electron-notifier-adapter';
import { CircuitBreaker } from './queue/circuit-breaker';
import { setMeetingOrchestratorFactory } from './ipc/handlers/channel-handler';

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  setMainWindow(mainWindow);
  setExecutionWebContents(mainWindow.webContents);
  setPermissionWebContents(mainWindow.webContents);

  mainWindow.on('closed', () => {
    setMainWindow(null);
  });

  // Block navigation to external URLs (prevents open redirect / phishing)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) {
      return; // Allow HMR navigation in dev mode
    }
    event.preventDefault();
  });

  // Block all popup windows
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

app.whenReady().then(async () => {
  try {
    // Initialize ArenaRoot before anything that touches the DB or logs.
    // ConfigService is required because the root path is read from settings.
    const config = getConfigService();
    const arenaRoot = new ArenaRootService(config);
    await arenaRoot.ensure();
    initDatabaseRoot(arenaRoot);

    // Run database migrations before anything else.
    // Throws on failure, blocking app startup with inconsistent schema.
    runMigrations();

    // Restore persisted providers from DB into in-memory registry.
    // Must run after migrations (DB schema ready) and before IPC handlers (renderer may query).
    restoreProvidersFromDb();

    // Block all hardware permission requests (camera, mic, geolocation, etc.)
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    // Register typed IPC handlers before creating windows.
    // Handlers must be ready before any renderer can invoke them.
    registerIpcHandlers();
    configureApplicationMenu();

    // Wire lazy accessors for cross-module dependencies (C1, I2)
    const logger = createLogger();
    setLoggerAccessor(() => logger);
    setPermissionServiceAccessor(() => permissionService);

    // R4 dashboard aggregator — repositories are owned by the singleton
    // DB handle so the three repos are cheap to construct here. The
    // service itself holds no DB handle; it only delegates to the
    // repos' indexed COUNT queries.
    const db = getDatabase();
    const projectRepo = new ProjectRepository(db);
    const meetingRepo = new MeetingRepository(db);
    const dashboardService = new DashboardService({
      projectRepo,
      meetingRepo,
      approvalRepo: new ApprovalRepository(db),
    });
    setDashboardServiceAccessor(() => dashboardService);

    // R4-Task7 wires `meeting:list-active` + `message:list-recent` —
    // the widget-facing channels need MessageService / MeetingService
    // accessors. We instantiate the services here so the repo handles
    // stay co-located with dashboardService (all three R4 domains come
    // off the same `db` handle).
    const meetingService = new MeetingService(meetingRepo);
    const messageService = new MessageService(new MessageRepository(db));
    setMeetingAbortServiceAccessor(() => meetingService);
    setMessageServiceAccessor(() => messageService);

    // R5-Task11 wires the full channel + project service graph so the
    // renderer's channel:* / project:* IPC calls land on a live service.
    // Projects get the auto-provision hook that materialises the three
    // system channels (#일반 / #승인-대기 / #회의록) inside the same
    // create flow — keeps `onProjectCreated` additive and leaves DB/FS
    // rollback untouched (system channels are DB-only, no FS side).
    const channelRepo = new ChannelRepository(db);
    const channelService = new ChannelService(channelRepo, projectRepo);
    const projectService = new ProjectService(projectRepo, arenaRoot, {
      onProjectCreated: (project) => {
        channelService.createSystemChannels(project.id);
      },
    });
    setProjectServiceAccessor(() => projectService);
    setChannelServiceAccessor(() => channelService);
    setMeetingServiceAccessor(() => meetingService);

    // R7-Task2: ApprovalService must be instantiated BEFORE StreamBridge
    // so `streamBridge.connect({ approvals })` can subscribe to the
    // service's EventEmitter (spec §6 stream:approval-*). This also
    // unblocks `approval:list` / `approval:decide` IPC — without the
    // accessor the handlers throw at invoke time.
    const approvalService = new ApprovalService(new ApprovalRepository(db));
    setApprovalServiceAccessor(() => approvalService);

    // R7-Task3: ApprovalCliAdapter — single shared instance. Stateless
    // per call, bridges CLI permission prompts onto the ApprovalService
    // lifecycle (replaces the v2 pending-map cli-permission-handler).
    const { ApprovalCliAdapter } = await import(
      './approvals/approval-cli-adapter'
    );
    const approvalCliAdapter = new ApprovalCliAdapter(approvalService);

    // R7-Task6: ApprovalSystemMessageInjector — wire ApprovalService
    // 'decided' → MessageService.append(kind='system') for reject/
    // conditional comments so spec §7.7 "다음 턴 시스템 메시지로 주입" lands.
    // Disposer is retained; on app teardown the listener detaches. The
    // injector does not re-wire on renderer reload (main-process lifetime).
    const approvalSystemMessageInjector = new ApprovalSystemMessageInjector({
      approvalService,
      messageService,
    });
    approvalSystemMessageInjector.wire();

    // R6-Task1 + R7-Task2: StreamBridge — central Main → Renderer v3 push hub.
    // `onOutbound` is wired to every browser window's webContents; v3
    // events land on the renderer as `ipcRenderer.on(event.type, payload)`
    // matching preload's `typedOnStream`. `connect({ approvals })` wires
    // ApprovalService 'created'/'decided' EventEmitter events to the
    // `stream:approval-*` push channels — renderer hooks drop polling.
    const streamBridge = new StreamBridge();
    streamBridge.connect({
      messages: messageService,
      approvals: approvalService,
      // queue connect in R9.
    });
    streamBridge.onOutbound((event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send(event.type, event.payload);
        }
      }
    });
    // Exported for MeetingOrchestrator DI (R6-Task4).
    // For now the bridge is reachable via `getStreamBridge()` accessor.
    setStreamBridgeInstance(streamBridge);

    // R6-Task4: MeetingOrchestrator support services.
    // NotificationService lands here (not its own handler block) because
    // the R6 side-effect wiring needs it BEFORE channel:start-meeting
    // fires. R7-Task11 wires ApprovalService 'created' → NotificationService
    // approval_pending trigger; R9 splits this out further.
    const notificationService = new NotificationService(
      new NotificationRepository(db),
      new ElectronNotifierAdapter(),
    );
    const circuitBreaker = new CircuitBreaker();

    // Meeting orchestrator factory — channel-handler calls this on
    // `channel:start-meeting` after MeetingService.start() has created
    // the DB row. The factory owns the session + turn-executor + per-
    // meeting side-effect wiring lifecycle (disposer on DONE/FAILED).
    setMeetingOrchestratorFactory({
      createAndRun: async ({ meeting, projectId, participants, topic, ssmCtx }) => {
        const { MeetingSession } = await import(
          './meetings/engine/meeting-session'
        );
        const { MeetingTurnExecutor } = await import(
          './meetings/engine/meeting-turn-executor'
        );
        const { MeetingOrchestrator } = await import(
          './meetings/engine/meeting-orchestrator'
        );
        const {
          registerOrchestrator,
          unregisterOrchestrator,
        } = await import('./meetings/engine/meeting-orchestrator-registry');

        const session = new MeetingSession({
          meetingId: meeting.id,
          channelId: meeting.channelId,
          projectId,
          topic,
          participants,
          ssmCtx,
        });

        const personaPrimedParticipants = new Set<string>();
        const turnExecutor = new MeetingTurnExecutor({
          session,
          streamBridge,
          messageService,
          arenaRootService: arenaRoot,
          providerRegistry,
          personaPrimedParticipants,
          approvalCliAdapter,
        });

        const orchestrator = new MeetingOrchestrator({
          session,
          turnExecutor,
          streamBridge,
          messageService,
          meetingService,
          channelService,
          projectService,
          approvalService,
          notificationService,
          circuitBreaker,
        });

        registerOrchestrator(meeting.id, orchestrator);
        // Fire-and-forget: the loop runs until SSM terminal or user
        // abort. Errors are already surfaced as stream:meeting-error
        // events by the turn-executor + orchestrator terminal path.
        orchestrator
          .run()
          .catch((err) => {
            console.warn(
              `[meeting-orchestrator:${meeting.id}] run threw`,
              err instanceof Error ? err.message : String(err),
            );
          })
          .finally(() => {
            unregisterOrchestrator(meeting.id);
          });
      },
    });

    // Initialize consensus folder (fire-and-forget; non-blocking for window creation)
    try {
      const settings = getConfigService().getSettings();
      const customPath = settings.consensusFolderPath || null;
      void consensusFolderService.initFolder(customPath).then((info) => {
        console.info(`[consensus-folder] Initialized: ${info.folderPath} (default=${String(info.isDefault)})`);
      }).catch((err) => {
        console.error('[consensus-folder] Failed to initialize:', err);
      });
    } catch (err) {
      console.error('[consensus-folder] Failed to read settings for consensus folder:', err);
    }

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

app.on('before-quit', async () => {
  await providerRegistry.shutdownAll();
  closeDatabase();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
