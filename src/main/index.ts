import { app, BrowserWindow, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'path';
import { runMigrations } from './database/migrator';
import { closeDatabase, initDatabaseRoot } from './database/connection';
import { registerIpcHandlers } from './ipc/router';
import { providerRegistry } from './providers/registry';
import {
  setExecutionWebContents,
  setExecutionApprovalServiceAccessor,
} from './ipc/handlers/execution-handler';
import { setArenaRootServiceAccessor } from './ipc/handlers/arena-root-handler';
import { setLoggerAccessor } from './ipc/handlers/log-handler';
import { configureApplicationMenu } from './ui/app-menu';
import { restoreProvidersFromDb } from './providers/provider-restore';
import { createLogger } from './log/structured-logger';
import { tryGetLogger } from './log/logger-accessor';
import { consensusFolderService } from './ipc/handlers/workspace-handler';
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
import { OpinionRepository } from './meetings/opinion-repository';
import { OpinionService } from './meetings/opinion-service';
import { setOpinionServiceAccessor } from './ipc/handlers/opinion-handler';
import { RunStepRepository } from './meetings/run-step/run-step-repository';
import { RunStepService } from './meetings/run-step/run-step-service';
import { setRunStepServiceAccessor } from './ipc/handlers/run-step-handler';
import { RunStepAggregator } from './meetings/run-step/run-step-aggregator';
import { setRunStepAggregatorAccessor } from './ipc/handlers/dashboard-progress-handler';
import { MeetingMinutesService } from './meetings/meeting-minutes-service';
import { setMeetingMinutesServiceAccessor } from './ipc/handlers/meetings-minutes-handler';
import { MeetingReviewGateRepository } from './meeting-review/meeting-review-gate-repository';
import { MeetingReviewGateService } from './meeting-review/meeting-review-gate-service';
import { DesignCheckpointRepository } from './design-checkpoints/design-checkpoint-repository';
import { DesignCheckpointService } from './design-checkpoints/design-checkpoint-service';
import { PlanningDesignCheckRepository } from './planning-design-check/planning-design-check-repository';
import { PlanningDesignCheckService } from './planning-design-check/planning-design-check-service';
import {
  setMeetingReviewChannelServiceAccessor,
  setMeetingReviewDispatchServiceAccessor,
  setMeetingReviewGateServiceAccessor,
  setMeetingReviewMessageServiceAccessor,
  setMeetingReviewStreamBridgeAccessor,
} from './ipc/handlers/meeting-review-handler';
import { setDesignCheckpointServiceAccessor } from './ipc/handlers/design-checkpoint-handler';
import {
  setPlanningDesignCheckChannelServiceAccessor,
  setPlanningDesignCheckDispatchServiceAccessor,
  setPlanningDesignCheckMessageServiceAccessor,
  setPlanningDesignCheckMissionCardIdFactory,
  setPlanningDesignCheckServiceAccessor,
  setPlanningDesignCheckStreamBridgeAccessor,
} from './ipc/handlers/planning-design-check-handler';
import { setMessageServiceAccessor } from './ipc/handlers/message-handler';
import { setMeetingAbortServiceAccessor } from './ipc/handlers/meeting-handler';
import { ChannelRepository } from './channels/channel-repository';
import { ChannelService } from './channels/channel-service';
import { ProjectService } from './projects/project-service';
import { PermissionService } from './files/permission-service';
import {
  setProjectServiceAccessor,
  setProjectSkillSyncAccessor,
  setProjectHandlerArenaRootAccessor,
} from './ipc/handlers/project-handler';
import { ProjectSkillSyncService } from './skills/project-skill-sync-service';
import { SkillService } from './skills/skill-service';
import { PromptComposer } from './skills/prompt-composer';
import { ChannelPermissionResolver } from './permissions/channel-permission-resolver';
import { setChannelPermissionServiceAccessor } from './ipc/handlers/channel-permission-handler';
import {
  setChannelServiceAccessor,
  setChannelMemberServiceAccessor,
  setMeetingServiceAccessor,
  setProjectServiceAccessor as setChannelHandlerProjectServiceAccessor,
  setPermissionServiceAccessor as setChannelHandlerPermissionServiceAccessor,
} from './ipc/handlers/channel-handler';
import { StreamBridge } from './streams/stream-bridge';
import { setStreamBridgeInstance } from './streams/stream-bridge-accessor';
import { ApprovalService } from './approvals/approval-service';
import { MeetingSummaryService } from './llm/meeting-summary-service';
import { LlmCostRepository } from './llm/llm-cost-repository';
import { LlmCostService } from './llm/llm-cost-service';
import { setLlmCostServiceAccessor } from './ipc/handlers/llm-handler';
import { ApprovalSystemMessageInjector } from './approvals/approval-system-message-injector';
import {
  setApprovalServiceAccessor,
  setApprovalDetailExecutionAccessor,
  setApprovalDetailMeetingAccessor,
} from './ipc/handlers/approval-handler';
import { NotificationRepository } from './notifications/notification-repository';
import { NotificationService } from './notifications/notification-service';
import { ElectronNotifierAdapter } from './notifications/electron-notifier-adapter';
import { setNotificationServiceAccessor } from './ipc/handlers/notification-handler';
import { setDevHooksAccessors } from './ipc/handlers/dev-hooks-handler';
import {
  setOnboardingServiceAccessor,
  setProviderDetectionDeps,
} from './ipc/handlers/onboarding-handler';
import { OnboardingService } from './onboarding/onboarding-service';
import { OnboardingStateRepository } from './onboarding/onboarding-state-repository';
import { handleProviderDetectCli } from './ipc/handlers/cli-detect-handler';
import { setQueueServiceAccessor } from './ipc/handlers/queue-handler';
import { CircuitBreaker } from './queue/circuit-breaker';
import { CircuitBreakerStore } from './queue/circuit-breaker-store';
import { setCircuitBreakerAccessor } from './queue/circuit-breaker-accessor';
import { setExecutionCircuitBreaker } from './ipc/handlers/execution-handler';
import { ExecutionService } from './execution/execution-service';
import { QueueRepository } from './queue/queue-repository';
import { QueueService } from './queue/queue-service';
import { createDefaultMeetingStarter } from './queue/default-meeting-starter';
import { AutonomyGate } from './autonomy/autonomy-gate';
import {
  setMeetingOrchestratorFactory,
  type MeetingOrchestratorFactory,
} from './ipc/handlers/channel-handler';
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

  setExecutionWebContents(mainWindow.webContents);

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

// R12-C round 2 (2026-05-03): app.setName 은 app.whenReady 전에 호출해야
// app.getPath('userData') 가 올바른 폴더 (`%APPDATA%\Rolestra` 등) 를
// 반환한다. package.json 의 npm 식별자 ("ai-chat-arena") 는 그대로 두고
// 런타임 표시 / userData 폴더만 productName 과 일치시킨다.
app.setName('Rolestra');

app.whenReady().then(async () => {
  try {
    // Initialize ArenaRoot before anything that touches the DB or logs.
    // ConfigService is required because the root path is read from settings.
    // F4-Task6: pass Electron's OS-localized Documents path so the
    // platform default respects 한국어/日本語 Windows folder names and
    // OneDrive redirects. `app.getPath('documents')` is safe here —
    // we are inside `app.whenReady()`.
    const config = getConfigService();
    const documentsPath = (() => {
      try {
        return app.getPath('documents');
      } catch {
        return undefined;
      }
    })();
    const arenaRoot = new ArenaRootService(config, documentsPath);
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
    // arena-root:* IPC handlers depend on the singleton ArenaRootService.
    // Without this wiring renderer-side `useArenaRoot` calls (Settings →
    // Storage tab among others) throw "service not initialized" the very
    // first time they fire. Discovered during dogfooding — the accessor
    // was previously only wired inside unit tests.
    setArenaRootServiceAccessor(() => arenaRoot);

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
    // R12-C T9: MessageRepository 를 별도 변수로 들고 ChannelService 의
    // archiveConversation 에서도 재사용 — 채널 service 가 메시지 archive
    // 시 listAllByChannel + deleteByChannel 를 호출한다.
    const messageRepository = new MessageRepository(db);
    const messageService = new MessageService(messageRepository);
    setMeetingAbortServiceAccessor(() => meetingService);
    setMessageServiceAccessor(() => messageService);

    // R12-C2 P2-2: OpinionService 부팅. opinion + opinion_vote 두 테이블의
    // 4 method (gather / tally / quickVote / freeDiscussionRound) 을 IPC
    // surface (opinion:*) 에 노출. T10 MeetingOrchestrator 재배선이 본
    // accessor 를 통해 service 를 호출하게 된다 — 그 전까지는 일반 채널
    // [##] flow / 테스트 / dev tools 가 직접 호출.
    const opinionRepo = new OpinionRepository(db);
    const opinionService = new OpinionService(opinionRepo);
    setOpinionServiceAccessor(() => opinionService);

    // R12-C2 P2 T12: RunStepService 부팅. 회의 turn *진행 일지* 영속 레이어
    // (run_step 테이블, migration 020). T13 MeetingOrchestrator 재배선이
    // 매 turn 후 service.appendForTurn 으로 일지 적층. T12 시점에는
    // skeleton — IPC `meeting:list-run-steps` (dev 전용) 으로 영속 동작
    // 검증. spec §11.19.
    const runStepRepo = new RunStepRepository(db);
    const runStepService = new RunStepService(runStepRepo);
    setRunStepServiceAccessor(() => runStepService);

    // D-A T2.5 / spec §5.5 — 채널에 user 메시지가 들어오면 활성 회의의
    // orchestrator 로 전달해 다음 AI turn 의 prompt 에 합류시킨다. 이전에는
    // handleUserInterjection 호출자 자체가 없어 사용자 추가 메시지가
    // _messages 에 들어가지 못하고 AI 가 무시하는 회귀가 있었다 (round2.6
    // dogfooding 보고 #3). T4/T5 의 자동 트리거(회의 *생성*) 와는 별개로
    // 이미 활성 회의에는 본 dispatcher 만으로 합류 동작.
    const { dispatchUserMessageToActiveMeeting } = await import(
      './meetings/engine/meeting-orchestrator-registry'
    );
    messageService.on('message', dispatchUserMessageToActiveMeeting);

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
      // R12-W T9 — 직원 roles / skillOverrides 는 BaseProvider.toInfo() 가
      // ProviderInfo (roles + skill_overrides) 를 반환하므로 wire 단에서 그대로
      // proxy. null = 알려지지 않은 providerId.
      getRoles: (providerId) => {
        const p = providerRegistry.get(providerId);
        return p ? p.toInfo().roles : null;
      },
      getSkillOverrides: (providerId) => {
        const p = providerRegistry.get(providerId);
        return p ? p.toInfo().skill_overrides : null;
      },
    });
    setMemberProfileServiceAccessor(() => memberProfileService);
    // R12-C dogfooding round 1 (2026-05-03): channel-handler 의
    // channel:list-members 가 같은 service 인스턴스를 fuse 에 사용한다.
    // member-handler 와 cross-handler dependency 회피를 위해 별도 accessor.
    setChannelMemberServiceAccessor(() => memberProfileService);

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
    const channelService = new ChannelService(channelRepo, projectRepo, {
      archiveMessages: messageRepository,
      archiveRoot: { getArenaRoot: () => arenaRoot.getPath() },
    });

    // R12-C — boot 시점에 전역 일반 채널 1개 보장 (마이그레이션 018 +
    // ensureGlobalGeneralChannel). 사이드바 상단 entry 가 이 row 를
    // 참조하므로 service / IPC 활성 전에 land 되어야 한다.
    channelService.ensureGlobalGeneralChannel();

    // R12-C2 P3 T19: RunStepAggregator — H1 dashboard 진행률 패널 데이터
    // source. channelRepo / meetingRepo / runStepRepo 위 query-time 합성.
    // `dashboard:progress-snapshot` IPC + `stream:dashboard-progress-changed`
    // 두 surface 모두 본 인스턴스를 통해 응답. spec §11.21.
    const runStepAggregator = new RunStepAggregator(
      channelRepo,
      meetingRepo,
      runStepRepo,
      opinionRepo,
    );
    setRunStepAggregatorAccessor(() => runStepAggregator);

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

    // R11-Task7: dedicated ExecutionService used only by the Approval
    // detail panel's dryRunPreview projection. Decoupled from the
    // workspace-bound singleton inside execution-handler because
    // (i) the detail panel must work BEFORE the user opens a workspace,
    // (ii) the projection is strictly read-only so an arena-root scoping
    // is sufficient — no patches ever apply through this instance.
    const detailPreviewExecutionService = new ExecutionService({
      workspaceRoot: arenaRoot.getPath(),
    });
    setApprovalDetailExecutionAccessor(() => detailPreviewExecutionService);
    setApprovalDetailMeetingAccessor(() => meetingService);
    // execution:dry-run-preview itself routes approvalId → ApprovalItem via
    // the approval service before delegating to dryRunPreview, so the
    // execution-handler also needs a thin ApprovalService accessor.
    setExecutionApprovalServiceAccessor(() => approvalService);

    const projectService = new ProjectService(projectRepo, arenaRoot, {
      onProjectCreated: (project) => {
        // R12-C — system 채널 (승인-대기 + 회의록) 2개 + 부서 채널 (아이디어
        // / 기획 / 디자인 / 구현 / 검토) 5개 = 7 채널 자동 생성.
        // 일반 채널은 전역 1개라 여기서 안 만든다 (boot 시 ensureGlobalGeneralChannel).
        channelService.createSystemChannels(project.id);
        channelService.createDepartmentChannels(project.id);
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
    const permissionService = new PermissionService(arenaRoot, projectService);
    setProjectServiceAccessor(() => projectService);
    setChannelServiceAccessor(() => channelService);
    // R12-W T10.5.G2+G5 — channel:start-meeting handler 가 ssmCtx.projectPath
    // 를 정확한 cwd 로, permissionMode/autonomyMode 를 project row 값으로
    // 흘리기 위한 deps. dogfooding 2026-05-12 발견 — 옛 하드코딩이 CLI cwd
    // 를 앱 실행 위치 (= rolestra source repo) 로 보내 봉인 chain 무력화.
    setChannelHandlerProjectServiceAccessor(() => projectService);
    setChannelHandlerPermissionServiceAccessor(() => permissionService);
    // R12-W T9 + T7 — 채널 권한 IPC 와 PromptComposer wire-up 의 단일 인스턴스
    // 공유. ChannelPermissionResolver 는 ChannelRepository 만 의존 (좁은 read
    // 책임) 이라 동일 인스턴스를 turn-executor / IPC handler 양쪽이 안전하게
    // 활용. PromptComposer 는 SkillService 가 stateless 라 단일 instance 충분.
    setChannelPermissionServiceAccessor(() => channelService);
    const skillService = new SkillService();
    const promptComposer = new PromptComposer(skillService);
    const channelPermissionResolver = new ChannelPermissionResolver(channelRepo);

    // R12-C Task 6 — SKILL.md auto-sync service
    const projectSkillSyncService = new ProjectSkillSyncService();
    setProjectSkillSyncAccessor(() => projectSkillSyncService);
    setProjectHandlerArenaRootAccessor(() => arenaRoot);
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

    // R7-Task8 + R10-Task4: ApprovalDecisionRouter — dispatches 'decided'
    // events by `item.kind` to the owning service. Routes:
    //   - `mode_transition`  → ProjectService.applyPermissionModeChange
    //   - `circuit_breaker`  → CircuitBreaker.resetCounter + setAutonomy
    //                          (resume to the recorded previousMode).
    // The circuit breaker dep is bound after construction (line below) so
    // the legacy 2-arg deps shape stays optional for tests.
    const { ApprovalDecisionRouter } = await import(
      './approvals/approval-decision-router'
    );

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

    // R10-Task9: persist tripwire counters across restarts. The store
    // is shared with the breaker via the constructor's `store` slot —
    // every `record*` mutation queues a debounced UPSERT, every
    // `resetCounter` writes immediately. `hydrate()` runs once now so
    // the counters reflect the pre-restart state before any meeting /
    // queue run can mutate them. Closes R9 Known Concern #2.
    const circuitBreakerStore = new CircuitBreakerStore(db);
    const circuitBreaker = new CircuitBreaker({ store: circuitBreakerStore });
    circuitBreaker.hydrate();

    // R9-Task6: register the breaker so CLI spawn sites (CliProcessManager
    // deep inside CliProvider factory chain) and any future spawner can
    // record elapsed wall-clock via `getCircuitBreaker()`. Also prime the
    // ExecutionService cache so the next `workspace:init` IPC call builds
    // an ExecutionService that feeds the `files_per_turn` tripwire
    // without re-threading the breaker through workspace-handler.
    setCircuitBreakerAccessor(() => circuitBreaker);
    setExecutionCircuitBreaker(circuitBreaker);

    // R10-Task4: ApprovalDecisionRouter wire — `circuit_breaker` resume
    // routes to the breaker (resetCounter) + projectService (setAutonomy
    // restore previousMode). Construction sits below the breaker so the
    // dep is non-null in production; tests still construct without it.
    const approvalDecisionRouter = new ApprovalDecisionRouter({
      approvalService,
      projectService,
      circuitBreaker,
    });
    approvalDecisionRouter.wire();

    // R9-Task7 + R10-Task4: QueueService — autonomy-queue run loop owner.
    // Construct before StreamBridge.connect so the bridge can subscribe to
    // the service's `'changed'` event and fan out `stream:queue-updated`
    // snapshots. The `meetingStarter` is the production wiring that
    // closes R9 Known Concern #1 — it spawns a meeting through the same
    // orchestrator factory `channel:start-meeting` uses.
    //
    // Forward-reference dance: the orchestrator factory is registered
    // below (after StreamBridge wiring), but QueueService and the factory
    // reference each other (queue→factory for spawn, factory→queue for
    // `onFinalized`). We bind via a holder so both can be constructed
    // independently and the starter resolves the factory at call time.
    const orchestratorFactoryHolder: {
      current: MeetingOrchestratorFactory | null;
    } = { current: null };

    // D-A T5 / T6 / spec §3.1+§4.1 — message-driven auto meeting trigger
    // + DM responder. The renderer no longer initiates meetings via
    // `channel:start-meeting` for the common path; users just type into a
    // user/system_general channel and a meeting auto-spawns. DM channels
    // get a single-turn response without spawning a meeting at all.
    //
    // Wiring order vs. T2.5: both subscribe to MessageService 'message'.
    // T2.5 dispatcher (registered above) handles already-tagged messages
    // (`meetingId !== null` — i.e. interjections into a meeting the
    // renderer already showed). The auto-trigger handles untagged ones.
    // The two are mutually exclusive in effect — see meeting-auto-trigger.ts.
    const { DmAutoResponder } = await import(
      './channels/dm-auto-responder'
    );
    const { MeetingAutoTrigger } = await import(
      './meetings/meeting-auto-trigger'
    );
    const { getOrchestrator } = await import(
      './meetings/engine/meeting-orchestrator-registry'
    );

    const dmAutoResponder = new DmAutoResponder({
      channelService,
      messageService,
      providerLookup: providerRegistry,
    });

    // Adapter — bridges MeetingAutoTrigger's narrow contract to the
    // production orchestrator factory (which wants `participants` +
    // `ssmCtx` resolved). Auto meetings always use permission='hybrid'
    // / autonomy='manual' since no UI dialog asked the user otherwise;
    // a project autonomy mode upgrade lands by the user's later flow.
    const meetingAutoOrchestratorFactory = {
      createAndRun: async ({
        meetingId,
        channelId,
        topic,
        firstMessage,
      }: {
        meetingId: string;
        channelId: string;
        topic: string;
        firstMessage: import('../shared/message-types').Message;
      }): Promise<void> => {
        const factory = orchestratorFactoryHolder.current;
        if (!factory) {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'no-factory',
            result: 'failure',
            metadata: { meetingId, channelId },
          });
          return;
        }
        const channel = channelService.get(channelId);
        if (!channel || !channel.projectId) {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'channel-or-project-missing',
            result: 'failure',
            metadata: { meetingId, channelId },
          });
          return;
        }
        const members = channelService.listMembers(channelId);
        const aiMembers = members.filter((m) => m.providerId !== 'user');
        if (aiMembers.length < 2) {
          // MeetingSession requires >= 2 AI participants. Auto-trigger
          // can't satisfy that with a single-member channel; we'd insert
          // a meeting row that immediately fails on session construction.
          // Drop the trigger + warn so the user sees something happened.
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'insufficient-participants',
            result: 'failure',
            metadata: {
              meetingId,
              channelId,
              memberCount: aiMembers.length,
            },
          });
          return;
        }
        const meeting = meetingService.get(meetingId);
        if (!meeting) {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'meeting-row-missing',
            result: 'failure',
            metadata: { meetingId },
          });
          return;
        }
        const participants = aiMembers.map((m) => {
          const provider = providerRegistry.get(m.providerId);
          return {
            id: m.providerId,
            providerId: m.providerId,
            displayName: provider?.displayName ?? m.providerId,
            isActive: true,
          };
        });
        // R12-W T10.5.G2+G5 — project row + ArenaRoot 로 cwd / mode 동기화.
        // 옛 하드코딩 (`projectPath: ''`, `'hybrid' as const`) 은 CLI spawn
        // cwd 를 프로젝트와 분리해 source repo 가 노출되던 dogfooding
        // 2026-05-12 격차의 hotfix.
        const project = projectService.get(channel.projectId);
        if (!project) {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'project-missing',
            result: 'failure',
            metadata: { meetingId, channelId, projectId: channel.projectId },
          });
          return;
        }
        if (project.status === 'folder_missing') {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'project-folder-missing',
            result: 'failure',
            metadata: { meetingId, channelId, slug: project.slug },
          });
          return;
        }
        const projectPaths = permissionService.resolveForCli(project.id);
        const ssmCtx = {
          meetingId,
          channelId,
          projectId: channel.projectId,
          projectPath: projectPaths.cwd,
          permissionMode: project.permissionMode,
          autonomyMode: project.autonomyMode,
        };
        // R12-C round 4 (meeting-auto-trigger.ts:120) 가 system_general /
        // dm 을 dm-style responder 로 일찍 분기시키므로 이 createAndRun
        // 경로는 항상 user 채널 (부서 / 자유) — multi-round 회의. round
        // setting 은 unlimited 로 고정.
        await factory.createAndRun({
          meeting,
          projectId: channel.projectId,
          participants,
          topic,
          ssmCtx,
          roundSetting: 'unlimited',
        });
        // The orchestrator is now registered; seed the meeting with the
        // user's first message so the AI's first turn sees what the user
        // actually wrote (the topic system message alone would let the
        // AI guess intent from the truncated topic only).
        //
        // dogfooding 2026-04-30 fix — must NOT use `handleUserInterjection`
        // here: that path raises TurnManager's interrupt flag, which
        // causes the very first `getNextSpeaker()` to yield null, which
        // the orchestrator treats as `ROUND_COMPLETE` and ends the
        // meeting after zero or one AI turn. Use the dedicated
        // initial-message inject method which only appends to
        // `_messages` without disturbing the turn rotation.
        const orchestrator = getOrchestrator(meetingId);
        if (orchestrator) {
          try {
            orchestrator.injectInitialUserMessage({
              id: firstMessage.id,
              role: 'user',
              content: firstMessage.content,
              participantId: 'user',
              participantName: '사용자',
            });
          } catch (err) {
            tryGetLogger()?.warn({
              component: 'meeting-auto-trigger',
              action: 'first-message-injection-failed',
              result: 'failure',
              metadata: {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
              },
            });
          }
        }
      },
      interruptActive: async ({
        meetingId,
        message,
      }: {
        meetingId: string;
        message: import('../shared/message-types').Message;
      }): Promise<void> => {
        const orchestrator = getOrchestrator(meetingId);
        if (!orchestrator) {
          // Meeting may have ended between the channel append and the
          // listener firing. Drop silently — the message is on disk.
          tryGetLogger()?.debug?.({
            component: 'meeting-auto-trigger',
            action: 'interrupt-no-active-orchestrator',
            result: 'success',
            metadata: { meetingId, messageId: message.id },
          });
          return;
        }
        try {
          orchestrator.handleUserInterjection({
            id: message.id,
            role: 'user',
            content: message.content,
            participantId: 'user',
            participantName: '사용자',
          });
        } catch (err) {
          tryGetLogger()?.warn({
            component: 'meeting-auto-trigger',
            action: 'interrupt-throw',
            result: 'failure',
            metadata: {
              meetingId,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        }
      },
    };

    const meetingAutoTrigger = new MeetingAutoTrigger({
      channelService,
      meetingService,
      orchestratorFactory: meetingAutoOrchestratorFactory,
      dmResponder: dmAutoResponder,
    });

    messageService.on('message', (msg) => {
      Promise.resolve(meetingAutoTrigger.onMessage(msg)).catch((err) => {
        // Listener errors must not propagate into MessageService.append's
        // contract. Log loudly so a real bug doesn't hide.
        tryGetLogger()?.warn({
          component: 'meeting-auto-trigger',
          action: 'listener-error',
          result: 'failure',
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      });
    });

    // R12-C2 P4 T20 — 일반 채널 [##본문] 자동 파서 wire. system_general
    // (전역) 과 user role='general' (per-project 잡담) 채널 모두 본 flow
    // 의 대상. message-event 두 listener 는 책임 분리 — auto-trigger 는
    // 회의 모델 라우팅 / 본 flow 는 카드 등록 (잡담 정체성).
    const { GeneralChannelOpinionFlow } = await import(
      './channels/general-channel-opinion-flow'
    );
    const generalChannelOpinionFlow = new GeneralChannelOpinionFlow({
      channelService,
      opinionService,
    });
    messageService.on('message', (msg) => {
      try {
        generalChannelOpinionFlow.onMessage(msg);
      } catch (err) {
        tryGetLogger()?.warn({
          component: 'general-channel-opinion-flow',
          action: 'listener-error',
          result: 'failure',
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    // Use a forward-declared queueService reference inside the starter so
    // the lookup hands back the just-claimed row's `targetChannelId`.
    let queueServiceRef: QueueService | null = null;

    const meetingStarter = createDefaultMeetingStarter({
      channelService,
      meetingService,
      projectService,
      permissionService,
      queueItemLookup: {
        get: (id) => (queueServiceRef ? queueServiceRef.get(id) : null),
      },
      orchestratorFactory: {
        createAndRun: (input) => {
          if (!orchestratorFactoryHolder.current) {
            throw new Error(
              'queue meetingStarter: orchestrator factory not initialized',
            );
          }
          return orchestratorFactoryHolder.current.createAndRun(input);
        },
      },
    });

    const queueService = new QueueService(new QueueRepository(db), {
      circuitBreaker,
      meetingStarter,
    });
    queueServiceRef = queueService;
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

    // R11-Task6: Onboarding service singleton + provider:detect deps.
    // The wizard needs durable state (migration 013) so a window close
    // mid-flow does not throw the user back to step 1. Detection deps
    // bridge the registry + the existing CLI scanner so provider:detect
    // never reaches into electron internals from the handler module.
    const onboardingService = new OnboardingService(
      new OnboardingStateRepository(db),
    );
    setOnboardingServiceAccessor(() => onboardingService);
    setProviderDetectionDeps({
      listProviders: () => providerRegistry.listAll(),
      scanCli: () => handleProviderDetectCli(),
    });

    // R11-Task4: dev hooks accessor wire (E2E only). The IPC channel
    // registration in `router.ts` is itself gated by ROLESTRA_E2E=1, so
    // setting accessors here is a no-op cost in production builds (the
    // four refs hold real services, but the renderer can never reach the
    // handler that reads them). Done here so the accessors track the
    // exact same singletons the rest of the boot block uses — avoids a
    // second instantiation path for tests.
    setDevHooksAccessors({
      projectService: () => projectService,
      approvalService: () => approvalService,
      notificationService: () => notificationService,
      circuitBreaker: () => circuitBreaker,
    });

    // R11-Task8: LLM 비용 audit log. Repository owns the append-only
    // SQL; LlmCostService folds the user-supplied per-provider unit
    // price (D5) into the response. The repository is wired into
    // MeetingSummaryService below so every successful summary call
    // logs its token usage. The service feeds the `llm:cost-summary`
    // IPC consumed by the AutonomyDefaultsTab "LLM 사용량" card.
    const llmCostRepository = new LlmCostRepository(getDatabase());
    const llmCostService = new LlmCostService({
      repository: llmCostRepository,
      getPriceMap: () =>
        getConfigService().getSettings().llmCostUsdPerMillionTokens,
    });
    setLlmCostServiceAccessor(() => llmCostService);

    // R10-Task11: optional LLM summary service. Singleton — picks the
    // first ready provider with the summarize capability at call time so
    // a provider hot-swap (warm-up / unregister) is honoured per call.
    // R11-Task8: cost audit sink wired so every summary appends one
    // row to `llm_cost_audit_log`.
    const meetingSummaryService = new MeetingSummaryService({
      providerRegistry,
      costAuditSink: llmCostRepository,
      // R12-S Task 10: 회의록 정리 모델은 settings 가 결정 (자동 / 사용자 명시).
      // 매 호출 시 fresh 한 settings 를 받아 hot-swap 즉시 반영.
      getSummaryModelSettings: () => ({
        summaryModelProviderId:
          getConfigService().getSettings().summaryModelProviderId,
      }),
    });

    // R12-C2 P2-3: MeetingMinutesService 부팅. step 5 모더레이터 회의록
    // 작성 + minutes.md atomic write. T10 재배선 전까지는 dev tools / 테스트
    // 가 직접 IPC `meetings:composeMinutes` 호출. provider 가 truncate /
    // 호출 실패 시 deterministic fallback 으로 떨어진다.
    const meetingMinutesService = new MeetingMinutesService({
      arenaRoot,
      meetingRepo,
      channelRepo,
      projectRepo,
      messageRepo: messageRepository,
      opinionRepo,
      meetingSummary: meetingSummaryService,
    });
    setMeetingMinutesServiceAccessor(() => meetingMinutesService);

    // R12-C2 T28 + T29 — handoff handler 의 모든 accessor 한 번에 wire.
    const {
      setHandoffPendingStateAccessor,
      setHandoffDispatchServiceAccessor,
      setHandoffStreamBridgeAccessor,
      setHandoffMinutesServiceAccessor,
      setHandoffMeetingServiceAccessor,
      setHandoffChannelServiceAccessor,
      setHandoffMeetingOrchestratorFactory,
    } = await import('./ipc/handlers/handoff-handler');
    setHandoffPendingStateAccessor(() => handoffPendingState);
    setHandoffDispatchServiceAccessor(() => handoffDispatchService);
    setHandoffMinutesServiceAccessor(() => meetingMinutesService);
    setHandoffMeetingServiceAccessor(() => meetingService);
    setHandoffChannelServiceAccessor(() => channelService);
    // setHandoffStreamBridgeAccessor + setHandoffMeetingOrchestratorFactory 는
    // streamBridge / meetingOrchestratorFactory 생성 *이후* 위치에서 wire.

    // R12-C2 T28: HandoffDispatchService + HandoffPendingState 부팅. 'auto' 분기
    // = orchestrator 가 dispatch 즉시 호출 / 'check' 분기 = pending state 등록 후
    // IPC handler (handoff:approve / cancel) 가 결정. spec §11.18.8c.
    const { HandoffDispatchRepository } = await import(
      './handoff/handoff-dispatch-repository'
    );
    const { HandoffDispatchService } = await import(
      './handoff/handoff-dispatch-service'
    );
    const { HandoffPendingState } = await import(
      './handoff/handoff-pending-state'
    );
    const handoffDispatchService = new HandoffDispatchService(
      new HandoffDispatchRepository(db),
    );
    const handoffPendingState = new HandoffPendingState();
    const meetingReviewGateService = new MeetingReviewGateService(
      new MeetingReviewGateRepository(db),
    );
    const designCheckpointService = new DesignCheckpointService(
      new DesignCheckpointRepository(db),
    );
    const planningDesignCheckService = new PlanningDesignCheckService(
      new PlanningDesignCheckRepository(db),
      designCheckpointService,
    );
    setMeetingReviewGateServiceAccessor(() => meetingReviewGateService);
    setMeetingReviewDispatchServiceAccessor(() => handoffDispatchService);
    setMeetingReviewMessageServiceAccessor(() => messageService);
    setMeetingReviewChannelServiceAccessor(() => channelService);
    setDesignCheckpointServiceAccessor(() => designCheckpointService);
    setPlanningDesignCheckServiceAccessor(() => planningDesignCheckService);
    setPlanningDesignCheckDispatchServiceAccessor(() => handoffDispatchService);
    setPlanningDesignCheckMessageServiceAccessor(() => messageService);
    setPlanningDesignCheckChannelServiceAccessor(() => channelService);
    setPlanningDesignCheckMissionCardIdFactory(() => randomUUID());

    // handoff handler accessor 등록은 meetingMinutesService / orchestratorFactory
    // 생성 이후 위치에서 한 번에 진행 (아래 setMeetingMinutesServiceAccessor 직후).

    // R12-C2 T16c: DesignSnapshotService 부팅. design-workflow step 7b
    // (generating_snapshot) 의 본체 — 회의 #2 합의 직후 design_implementation
    // root opinion (HTML+CSS) 을 desktop 1280x720 + mobile 375x812 PNG 로
    // 렌더 + ArenaRoot 봉인 안 atomic 저장. Electron BrowserWindow off-screen
    // capture 어댑터는 별도 모듈 (electron-snapshot-capture) — service 자체는
    // Node-only test 에서도 import 가능 (electron import 격리).
    const { DesignSnapshotService } = await import(
      './snapshot/playwright-snapshot'
    );
    const { createElectronSnapshotCapture } = await import(
      './snapshot/electron-snapshot-capture'
    );
    const designSnapshotService = new DesignSnapshotService({
      arenaRoot,
      capture: createElectronSnapshotCapture(),
    });

    // R12-C2 T10b: 옛 consensus_decision rehydrate 흐름 제거 — 새 phase loop
    // 모델은 SSM DONE sign-off approval 자체를 발사하지 않으므로 boot 시점에
    // 재무장할 row 가 없다.

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
      // R12-C2 T19: RunStep `'appended'` → stream:dashboard-progress-changed.
      // lookup 은 channels.project_id 그대로 — DM / global system general
      // (project_id IS NULL) 은 null 돌려주어 bridge 가 silent skip (H1
      // 패널 surface 대상 아님).
      runStep: runStepService,
      runStepChannelToProject: (channelId) => {
        const channel = channelRepo.get(channelId);
        return channel?.projectId ?? null;
      },
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
    // R12-C2 T28 — handoff IPC handler 가 stream emit 시 사용.
    setHandoffStreamBridgeAccessor(() => streamBridge);
    setMeetingReviewStreamBridgeAccessor(() => streamBridge);
    setPlanningDesignCheckStreamBridgeAccessor(() => streamBridge);

    // Meeting orchestrator factory — channel-handler calls this on
    // `channel:start-meeting` after MeetingService.start() has created
    // the DB row. The factory owns the session + turn-executor + per-
    // meeting side-effect wiring lifecycle (disposer on DONE/FAILED).
    //
    // R10-Task4: the same factory is also bound to
    // `orchestratorFactoryHolder.current` so the queue's
    // `meetingStarter` (constructed earlier) can invoke it without a
    // direct import of the closure body.
    const meetingOrchestratorFactory: MeetingOrchestratorFactory = {
      createAndRun: async ({ meeting, projectId, participants, topic, ssmCtx, roundSetting, priorContextSystemMessage, sourceHandoffContext }) => {
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

        // R12-C2 T10a: new MeetingSession dropped `roundSetting` — channels.
        // max_rounds replaces the per-meeting setting, resolved by the
        // orchestrator from `Channel.maxRounds` at run-time.
        void roundSetting;
        // R12-W T9 — 세션이 속한 채널 role 을 fetch 해 session 에 전달.
        // 미존재 채널 (race 등) 은 명시 throw — silent null fallback 시
        // PromptComposer 가 부서 회의 컨텍스트 없는 분기를 타게 되어
        // 사용자가 "왜 회의가 정식 path 가 아니지?" 라는 미스터리를
        // 디버깅해야 함.
        const channelForSession = channelService.get(meeting.channelId);
        if (!channelForSession) {
          throw new Error(
            `meeting-orchestrator-factory: channel not found for meeting ` +
              `${meeting.id} (channelId=${meeting.channelId})`,
          );
        }
        const session = new MeetingSession({
          meetingId: meeting.id,
          channelId: meeting.channelId,
          projectId,
          topic,
          participants,
          ssmCtx,
          channelRole: channelForSession.role,
          priorContextSystemMessage,
          sourceHandoffContext,
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
          // R12-W T9: PromptComposer + ChannelPermissionResolver wire — 회의
          // turn 페르소나가 채널 단위 권한 snapshot 을 받아 합성.
          promptComposer,
          channelPermissionResolver,
          cliWorkspaceResolver: permissionService,
          // R9-Task6: feed the `same_error` tripwire so N consecutive
          // same-category turn failures downgrade the project out of
          // auto_toggle / queue. Classification runs inside the
          // executor — provider/message text never reaches the breaker.
          circuitBreaker,
        });

        // R12-C2 T28 — chain resolver 의 받는 채널 lookup helper. role + projectId
        // 로 단일 채널 매칭 + listMembers 로 후보 합성 + designated-worker-resolver
        // 호출. R12-C2 시점 audit→planning chain 에서만 actual 호출, 다른 chain 은
        // chain resolver 내부에서 'no_chain' 분기라 호출 자체 미발생. role 매칭 0
        // 또는 candidate 0 시 null 반환 → chain resolver 가 invariant throw 분기.
        const {
          resolveDesignatedWorker,
          DesignatedWorkerNotFoundError,
        } = await import('./meetings/designated-worker-resolver');
        const resolveReceiverChannel = (
          targetProjectId: string,
          role: import('../shared/channel-role-types').ChannelRole,
        ) => {
          if (role === null) return null;
          const channels = channelService.listByProject(targetProjectId);
          const target = channels.find((c) => c.role === role);
          if (!target) return null;
          const members = channelService.listMembers(target.id);
          const candidates: Array<
            import('./meetings/designated-worker-resolver').DesignatedWorkerCandidate
          > = [];
          for (const m of members) {
            const provider = providerRegistry.get(m.providerId);
            if (!provider) continue;
            candidates.push({
              providerId: m.providerId,
              displayName: provider.displayName ?? m.providerId,
              roles: provider.roles,
              isDepartmentHead: {},
              dragOrder: m.dragOrder ?? null,
            });
          }
          if (candidates.length === 0) return null;
          // ChannelRole 와 RoleId 가 같은 string union — design.* / 다른 role 모두
          // 매핑 동일. T28 시점 actual 호출은 audit→'planning' chain 만.
          try {
            const resolved = resolveDesignatedWorker(candidates, role);
            return {
              channelId: target.id,
              handoffMode: target.handoffMode,
              assignedProviderId: resolved.candidate.providerId,
            };
          } catch (err) {
            if (err instanceof DesignatedWorkerNotFoundError) return null;
            throw err;
          }
        };

        const orchestrator = new MeetingOrchestrator({
          session,
          turnExecutor,
          streamBridge,
          messageService,
          meetingService,
          channelService,
          projectService,
          handoffPendingState,
          handoffDispatchService,
          meetingReviewGateService,
          designCheckpointService,
          planningDesignCheckService,
          resolveReceiverChannel,
          missionCardIdFactory: () => randomUUID(),
          notificationService,
          circuitBreaker,
          opinionService,
          meetingMinutesService,
          runStepService,
          providerRegistry,
          designSnapshotService,
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
    };

    setMeetingOrchestratorFactory(meetingOrchestratorFactory);
    // R10-Task4: bind the factory holder so the queue meetingStarter can
    // resolve `createAndRun` at call time. Setting this AFTER the IPC
    // handler is registered keeps the production path identical to a
    // manually-started meeting.
    orchestratorFactoryHolder.current = meetingOrchestratorFactory;

    // R12-C2 T29 — handoff:start-meeting-from-package 가 사용. 기존 factory
    // 재사용 + receiver 채널의 participants / ssmCtx 합성 helper 별도 wire.
    setHandoffMeetingOrchestratorFactory(meetingOrchestratorFactory);
    const { setHandoffStartMeetingResolver } = await import(
      './ipc/handlers/handoff-handler'
    );
    // P0 — handoff:start-meeting-from-package 도 PermissionService 경유 cwd
    // 를 사용한다. 외부 프로젝트 link swap 은 회의 시작 전 여기서 차단된다.
    setHandoffStartMeetingResolver({
      resolveParticipants: (channelId: string) => {
        const members = channelService.listMembers(channelId);
        return members.map((m) => ({
          id: m.providerId,
          providerId: m.providerId,
          displayName: m.providerId,
          isActive: true,
        }));
      },
      buildSsmCtx: ({ meetingId, channelId, projectId }) => {
        const project = projectService.get(projectId);
        if (!project) {
          throw new Error(
            `handoff:start-meeting-from-package: project not found — projectId=${projectId}`,
          );
        }
        if (project.status === 'folder_missing') {
          throw new Error(
            `handoff:start-meeting-from-package: project folder missing — slug=${project.slug}`,
          );
        }
        const paths = permissionService.resolveForCli(project.id);
        return {
          meetingId,
          channelId,
          projectId,
          projectPath: paths.cwd,
          permissionMode: project.permissionMode,
          autonomyMode: project.autonomyMode,
        };
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
