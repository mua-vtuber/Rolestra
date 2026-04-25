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
import { setNotificationServiceAccessor } from './ipc/handlers/notification-handler';
import { setQueueServiceAccessor } from './ipc/handlers/queue-handler';
import { CircuitBreaker } from './queue/circuit-breaker';
import { setCircuitBreakerAccessor } from './queue/circuit-breaker-accessor';
import { setExecutionCircuitBreaker } from './ipc/handlers/execution-handler';
import { QueueRepository } from './queue/queue-repository';
import { QueueService } from './queue/queue-service';
import { AutonomyGate } from './autonomy/autonomy-gate';
import { setMeetingOrchestratorFactory } from './ipc/handlers/channel-handler';
import { MemberProfileRepository } from './members/member-profile-repository';
import { MemberProfileService } from './members/member-profile-service';
import { MemberWarmupService } from './members/member-warmup-service';
import { AvatarStore } from './members/avatar-store';
import {
  setMemberProfileServiceAccessor,
  setAvatarStoreAccessor,
} from './ipc/handlers/member-handler';

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

    // R8-Task8: MemberProfileService boot (production wire — R2~R7 only
    // wired this in tests). Without this block the renderer's six member:*
    // IPC calls all throw "service not initialized". The service depends
    // on a narrow MemberProviderLookup adapter rather than the full
    // ProviderRegistry to mirror the ProjectLookup pattern (matches the
    // R2 service contract).
    const memberProfileRepo = new MemberProfileRepository(db);
    const memberProfileService = new MemberProfileService(memberProfileRepo, {
      get: (providerId) => {
        const p = providerRegistry.get(providerId);
        return p
          ? { id: p.id, displayName: p.displayName, persona: p.persona }
          : null;
      },
      warmup: async (providerId) => {
        // getOrThrow gives a clearer error than reading-then-checking;
        // MemberProfileService catches any rejection generically and maps
        // to 'offline-connection', so the message text isn't user-facing.
        await providerRegistry.getOrThrow(providerId).warmup();
      },
    });
    setMemberProfileServiceAccessor(() => memberProfileService);

    // R8-Task5/8: AvatarStore boot — depends on arenaRoot for the
    // <ArenaRoot>/avatars destination. Stateless, safe to share.
    const avatarStore = new AvatarStore(arenaRoot);
    setAvatarStoreAccessor(() => avatarStore);

    // R8-Task8: fire-and-forget boot warmup. Probes every persisted
    // provider in parallel with a 5 s deadline (R8-D3). The promise is
    // intentionally NOT awaited — first paint must not wait on slow
    // providers. Each probe's result mutates the runtime status map
    // inside MemberProfileService so member:list / member:get-profile
    // surfaces (Popover, MemberRow, PeopleWidget) reflect the live state
    // without an explicit refresh.
    const memberWarmup = new MemberWarmupService(memberProfileService);
    const bootProviderIds = providerRegistry.listAll().map((p) => p.id);
    void memberWarmup.warmAll(bootProviderIds).catch((err) => {
      console.warn(
        '[member-warmup] boot batch threw',
        err instanceof Error ? err.message : String(err),
      );
    });

    // R5-Task11 wires the full channel + project service graph so the
    // renderer's channel:* / project:* IPC calls land on a live service.
    // Projects get the auto-provision hook that materialises the three
    // system channels (#일반 / #승인-대기 / #회의록) inside the same
    // create flow — keeps `onProjectCreated` additive and leaves DB/FS
    // rollback untouched (system channels are DB-only, no FS side).
    const channelRepo = new ChannelRepository(db);
    const channelService = new ChannelService(channelRepo, projectRepo);

    // R7-Task2: ApprovalService must be instantiated BEFORE StreamBridge
    // so `streamBridge.connect({ approvals })` can subscribe to the
    // service's EventEmitter (spec §6 stream:approval-*). This also
    // unblocks `approval:list` / `approval:decide` IPC — without the
    // accessor the handlers throw at invoke time.
    // R7-Task8: moved above ProjectService construction so the project
    // service can receive the approvalService dep for the mode-transition
    // flow (request + apply via ApprovalDecisionRouter).
    const approvalService = new ApprovalService(new ApprovalRepository(db));
    setApprovalServiceAccessor(() => approvalService);

    const projectService = new ProjectService(projectRepo, arenaRoot, {
      onProjectCreated: (project) => {
        channelService.createSystemChannels(project.id);
      },
      approvalService,
      // spec §7.3 CB-3: no mode transition while a meeting is live.
      // `meetingRepo.listActive()` already joins `channels` so it returns
      // the projectId we need to match against.
      hasActiveMeeting: (projectId) =>
        meetingRepo
          .listActive()
          .some((meeting) => meeting.projectId === projectId),
    });
    setProjectServiceAccessor(() => projectService);
    setChannelServiceAccessor(() => channelService);
    setMeetingServiceAccessor(() => meetingService);

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

    // R7-Task8: ApprovalDecisionRouter — dispatches 'decided' events by
    // `item.kind` to the owning service. Currently routes `mode_transition`
    // → ProjectService.applyPermissionModeChange. R7-Task9 wires
    // `consensus_decision` on the same router.
    const { ApprovalDecisionRouter } = await import(
      './approvals/approval-decision-router'
    );
    const approvalDecisionRouter = new ApprovalDecisionRouter({
      approvalService,
      projectService,
    });
    approvalDecisionRouter.wire();

    // R6-Task4: MeetingOrchestrator support services.
    // NotificationService lands here (not its own handler block) because
    // the R6 side-effect wiring needs it BEFORE channel:start-meeting
    // fires. R7-Task11 wires ApprovalService 'created' → NotificationService
    // approval_pending trigger (see ApprovalNotificationBridge below).
    const notificationService = new NotificationService(
      new NotificationRepository(db),
      new ElectronNotifierAdapter(),
    );

    // R9-Task9: production wire for `notification:*` IPC. Without this
    // accessor the 3 notification handlers throw
    // `'notification handler: service not initialized'` on every invoke.
    // Also seed the 6 default pref rows so first-boot callers of
    // `notification:get-prefs` see a complete map (the repo's read-repair
    // would insert them anyway — we seed eagerly so the first render is
    // not observing a half-populated table through a race).
    setNotificationServiceAccessor(() => notificationService);
    const seeded = notificationService.seedDefaultPrefsIfEmpty();
    if (seeded > 0) {
      console.info(
        `[notification] seeded ${seeded} default pref row(s) on first boot`,
      );
    }

    const circuitBreaker = new CircuitBreaker();

    // R9-Task6: register the breaker so CLI spawn sites (CliProcessManager
    // deep inside CliProvider factory chain) and any future spawner can
    // record elapsed wall-clock via `getCircuitBreaker()`. Also prime the
    // ExecutionService cache so the next `workspace:init` IPC call builds
    // an ExecutionService that feeds the `files_per_turn` tripwire
    // without re-threading the breaker through workspace-handler.
    setCircuitBreakerAccessor(() => circuitBreaker);
    setExecutionCircuitBreaker(circuitBreaker);

    // R9-Task7: QueueService — autonomy-queue run loop owner. Construct
    // before StreamBridge.connect so the bridge can subscribe to the
    // service's `'changed'` event and fan out `stream:queue-updated`
    // snapshots. The optional `meetingStarter` injection that spawns a
    // meeting for each claimed item lands with Task 9 production wiring
    // (needs the fully-built MeetingOrchestratorFactory reference); for
    // now `startNext` still performs the atomic claim + snapshot emit so
    // the onFinalized hook can observe the flip.
    const queueService = new QueueService(new QueueRepository(db), {
      circuitBreaker,
    });
    // R9-Task9: production wire for `queue:*` IPC. 7 queue handlers all
    // throw `'queue handler: service not initialized'` until this runs.
    setQueueServiceAccessor(() => queueService);
    // Spec §5.2 recovery rule — revert any `in_progress` rows left by a
    // crash mid-run back to `pending` so the next claim picks them up.
    // No-op count on a clean DB.
    queueService.recoverInProgress();

    // R7-Task11: ApprovalNotificationBridge — ApprovalService 'created' →
    // NotificationService.show(approval_pending). NotificationService's
    // own prefs + focus gates decide whether the OS toast actually fires.
    const { ApprovalNotificationBridge } = await import(
      './approvals/approval-notification-bridge'
    );
    const approvalNotificationBridge = new ApprovalNotificationBridge({
      approvalService,
      notificationService,
    });
    approvalNotificationBridge.wire();

    // R9-Task5: AutonomyGate — inspects every approval created and, for
    // projects in `auto_toggle`/`queue`, either auto-accepts it (mode
    // transition to auto|hybrid / consensus decision / review accepted)
    // or forces the project back to `manual` (cli_permission / rework /
    // fail / failure_report). See `src/main/autonomy/autonomy-gate.ts`.
    const autonomyGate = new AutonomyGate({
      approvalService,
      projectService,
      notificationService,
      messageService,
      channelService,
    });
    autonomyGate.wire();

    // R6-Task1 + R7-Task2 + R7-Task11: StreamBridge — central Main →
    // Renderer v3 push hub. `connect({ notifications })` wires
    // NotificationService 'clicked' → `stream:notification-clicked` so
    // the renderer can navigate on OS notification click.
    const streamBridge = new StreamBridge();
    streamBridge.connect({
      messages: messageService,
      approvals: approvalService,
      notifications: notificationService,
      members: memberProfileService,
      // R9-Task5: project autonomy toggles + system downgrades become
      // `stream:autonomy-mode-changed` pushes without a dedicated emit
      // helper at each call site.
      projects: projectService,
      // R9-Task7: queue mutation fan-out. `queueSnapshot` resolves a
      // `changed` hint to the project-level full list + paused flag so
      // the renderer's `useQueue` hook reconciles in a single push.
      // `queueItemLookup` is retained for the `{id}`-only hint → projectId
      // indirection that `complete`/`cancel` emit.
      queue: queueService,
      queueItemLookup: (id) => {
        const item = queueService.get(id);
        return item ? { id: item.id, projectId: item.projectId } : null;
      },
      queueSnapshot: (projectId) => ({
        items: queueService.listByProject(projectId),
        paused: queueService.isPaused(projectId),
      }),
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
          // R8-Task9: enable the work-status gate (spec §7.2). Speakers
          // not in `online` state get their turn skipped + a system
          // message + `stream:meeting-turn-skipped` event.
          memberProfileService,
          // R9-Task6: feed the `same_error` tripwire so N consecutive
          // same-category turn failures downgrade the project out of
          // auto_toggle / queue. Classification runs inside the
          // executor — provider/message text never reaches the breaker.
          circuitBreaker,
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
          // R9-Task7: autonomy-queue run loop. When the finalised meeting
          // belongs to a project in `queue` mode, complete the owning
          // queue item and advance to the next pending item. Lookups miss
          // cleanly when the meeting was not started from the queue — in
          // that case `findByMeetingId` returns null and we skip complete.
          onFinalized: async ({ meetingId, projectId, outcome }) => {
            const project = projectService.get(projectId);
            if (!project || project.autonomyMode !== 'queue') return;
            const item = queueService.findByMeetingId(meetingId);
            if (item) {
              try {
                queueService.complete(
                  item.id,
                  meetingId,
                  outcome === 'accepted',
                );
              } catch (err) {
                console.warn(
                  '[queue-runner] complete failed',
                  err instanceof Error ? err.message : String(err),
                );
              }
            }
            try {
              await queueService.startNext(projectId);
            } catch (err) {
              // `startNext` throws when the (future) meetingStarter
              // callback fails. Log + move on — the failed queue row is
              // already recorded so the UI sees the failure state.
              console.warn(
                '[queue-runner] startNext failed',
                err instanceof Error ? err.message : String(err),
              );
            }
          },
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
