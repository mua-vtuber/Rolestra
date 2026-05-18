/**
 * Notification label dictionary for the main-process (R9-Task11, D8).
 *
 * The main bundle deliberately does NOT import `i18next` — doing so would
 * force SSR-style hydration and pull the entire renderer locale plumbing
 * into the Electron main process. Instead, the renderer's locale files
 * mirror the copy below under the `notification.*` / `circuitBreaker.*`
 * namespaces (preserved across parser runs by `i18next-parser.config.js`
 * `keepRemoved` entries). The two sources are kept in sync by convention
 * — the test at `__tests__/notification-labels.test.ts` pins the shape
 * and guards against accidental drift.
 *
 * Today the locale is a static module-level default (ko). R10+ will wire
 * {@link setNotificationLocale} to an app-level setting or Electron
 * `app.getLocale()` reading, without forcing call-sites to thread the
 * locale through every side-effect.
 *
 * The interpolation syntax mirrors i18next's `{{name}}` for parity with
 * the mirrored renderer keys — so if a future refactor wants to swap the
 * dictionary for a real i18next lookup, the template strings port as-is.
 */

// ── Locale registry ──────────────────────────────────────────────────

export type NotificationLocale = 'ko' | 'en';

/**
 * Default locale at process start. R9 ships `ko` only (consistent with
 * `react-i18next` `lng: 'ko'`). The mutator below lets R10 change it
 * from a settings handler without needing to thread a locale arg
 * through every call-site (the v3-side-effects SSM listener does not
 * have a project/user context in scope).
 */
const DEFAULT_LOCALE: NotificationLocale = 'ko';

let currentLocale: NotificationLocale = DEFAULT_LOCALE;

/**
 * Returns the locale currently used by every {@link resolveNotificationLabel}
 * and {@link resolveBreakerCopy} call. Exposed for tests and for R10
 * settings surfaces that want to render the "current OS-notification
 * locale" badge.
 */
export function getNotificationLocale(): NotificationLocale {
  return currentLocale;
}

/**
 * Switches the active locale for subsequent label lookups. Unknown
 * locales fall through to {@link DEFAULT_LOCALE} silently so a bad
 * settings value never crashes a notification fire.
 */
export function setNotificationLocale(locale: NotificationLocale): void {
  currentLocale = locale in DICTIONARIES ? locale : DEFAULT_LOCALE;
}

// ── Dictionary shape ─────────────────────────────────────────────────

/**
 * Structural mirror of the `notification.*` + `circuitBreaker.*` subset
 * populated in `src/renderer/i18n/locales/{ko,en}.json`. Anything added
 * here must land in both locale files (the parser keeps them alive via
 * `keepRemoved`) and in the parallel entry of the other locale below.
 */
interface NotificationDictionary {
  test: { title: string; body: string };
  newMessage: { title: string; body: string };
  approvalPending: { title: string; body: string };
  workDone: { title: string; body: string };
  error: { title: string; body: string };
  warmupFailed: { title: string; body: string };
  circuitBreaker: {
    title: string;
    body: string;
    filesPerTurn: { title: string; body: string; bodyGeneric: string };
    cumulativeCliMs: { title: string; body: string; bodyGeneric: string };
    queueStreak: { title: string; body: string; bodyGeneric: string };
    sameError: { title: string; body: string; bodyGeneric: string };
  };
  generalMeetingDone: { titled: string; untitled: string };
  /**
   * R10-Task12: main-process system message labels — extracted from
   * fixed Korean strings in approval-system-message-injector and
   * meeting-orchestrator so the locale switch reaches every surface
   * without threading t() into the side-effect path.
   */
  approvalSystemMessage: {
    rejectPrefix: string;
    conditionalPrefix: string;
    /**
     * R11-Task10: `mode_transition` conditional 결정 시, 다음 회의 시작
     * 직후 자동 prepend 되는 advisory 헤더. comment 자체는 별도 line 으로
     * 따라붙는다.
     */
    modeTransitionAdvisoryPrefix: string;
  };
  meetingMinutes: {
    rejection: string;
    rejectionWithComment: string;
    /** LLM summary paragraph header — `provider` interpolation. */
    summaryPrefix: string;
    /**
     * R12-C2 T10a — 부서 회의 종료 후 인계 mode='check' 시 OS 알림 (사용자
     * 승인 필요). `topic` interpolation 으로 회의 주제 안내.
     */
    handoffTitle: string;
    handoffBody: string;
    /**
     * R12-C2 T10a — 의견 1 건이 channels.max_rounds 라운드 안 합의 못 이뤄
     * 사용자 호출 시 알림. `screenId` (의견 화면 ID) + `maxRounds` 보간.
     */
    maxRoundsTitle: string;
    maxRoundsBody: string;
  };
  /**
   * R11-Task11 (D9): main-process labels for the
   * {@link ApprovalNotificationBridge}. Each `kind` carries a fixed
   * title (no interpolation) plus a body fallback used when the
   * payload-derived summary string is empty (the bridge composes a
   * richer body from the approval payload itself; the dictionary
   * supplies the safe default it falls back to).
   *
   * The `kind` set mirrors `ApprovalItem['kind']` exactly so a future
   * union extension forces a compile-time addition here.
   */
  approvalNotificationBridge: {
    cli_permission: { title: string; body: string };
    mode_transition: { title: string; body: string };
    review_outcome: { title: string; body: string };
    failure_report: { title: string; body: string };
    circuit_breaker: { title: string; body: string };
  };
  /**
   * R11-Task11 (D9): main-process labels for the {@link AutonomyGate}
   * `#회의록` trace lines and OS notification copy. The previously-
   * inline Korean strings move here so the en parity flips when the
   * user toggles `notification:set-locale` in Settings.
   *
   * Layout:
   *   - `label.<kind>` is the human-readable approval-kind label that
   *     interpolates into the trace + notification bodies.
   *   - `trace.{autoAccepted,downgraded}` are the `#회의록` system
   *     message templates (`{{label}}` interpolation).
   *   - `notify.{autoAccept,error}` are the OS notification title/
   *     body templates (`{{label}}` interpolation on the body).
   */
  autonomyGate: {
    label: {
      mode_transition: string;
      review_outcome: string;
      cli_permission: string;
      failure_report: string;
    };
    trace: {
      autoAccepted: string;
      downgraded: string;
    };
    notify: {
      autoAcceptTitle: string;
      autoAcceptBody: string;
      errorTitle: string;
      errorBody: string;
    };
  };
  /**
   * R12-C2 P6 follow-up: main-process labels for the
   * {@link MeetingReviewHandler}. `decisionMessage.*` covers the system
   * message body appended after each gate decision (approve / stop /
   * revise / restart). `archiveHeader.*` covers the archived markdown
   * heading lines (status / document / target role / dispatch / decision
   * / user note / minutes body). `decisionLabel.*` + `statusLabel.*`
   * cover the inline labels referenced from the archive markdown.
   */
  meetingReview: {
    decisionMessage: {
      approveWithoutDispatch: string;
      approveWithDispatch: string;
      stop: string;
      revise: string;
      restart: string;
    };
    archiveHeader: {
      status: string;
      document: string;
      targetRole: string;
      dispatchId: string;
      decision: string;
      userNoteSection: string;
      minutesBodySection: string;
    };
    decisionLabel: {
      approve: string;
      revise: string;
      restart: string;
      stop: string;
    };
    statusLabel: {
      pending: string;
      approved: string;
      revision_requested: string;
      restart_requested: string;
      stopped: string;
    };
  };
  /**
   * R12-C2 P6 follow-up: main-process labels for the
   * {@link PlanningDesignCheckHandler}. Mirrors `meetingReview` shape —
   * `decisionMessage.*` for system-message bodies after the user picks
   * an outcome, `archiveHeader.*` for the archived markdown headings,
   * `decisionLabel.*` for the inline label referenced from the archive.
   */
  planningDesignCheck: {
    decisionMessage: {
      sendToImplementation: string;
      requestDesignRevision: string;
      stop: string;
      saved: string;
    };
    archiveHeader: {
      title: string;
      decision: string;
      userNoteSection: string;
      dispatchId: string;
      reasonSection: string;
      reasonMissing: string;
      revisionDirectionSection: string;
    };
    decisionLabel: {
      send_to_implementation: string;
      request_design_revision: string;
      stop: string;
      unset: string;
    };
  };
  /**
   * R12-C2 P6 follow-up: main-process labels for handoff phase system
   * messages emitted by {@link MeetingOrchestrator.runHandoffPhase}.
   * Each entry mirrors a `messageService.append({ content })` call site
   * — keeping them here lets the locale flip without threading t() into
   * the orchestrator (which has no project/user context in scope).
   *
   * `maxRoundsPause` is the system message appended when an opinion did
   * not reach consensus within `channels.max_rounds` and the meeting
   * pauses for user attention. `screenId` + `maxRounds` interpolation.
   */
  meetingMinutesHandoff: {
    reviewGatePending: string;
    autoDispatched: string;
    pendingUserApproval: string;
    noChain: string;
    maxRoundsPause: string;
  };
  /**
   * R12-C2 T29 follow-up: labels embedded inside the second system
   * message that prepends handoff context to the receiver department's
   * meeting. Both the LLM prompt and the in-UI rendering read these
   * strings, so the dictionary path keeps prompt + display in sync when
   * the locale flips. `noActions` is the fallback line when the mission
   * card carries no `expectedOutputs`.
   */
  handoffContext: {
    minutesHeader: string;
    nextActionsHeader: string;
    noActions: string;
    reasonHeader: string;
    footer: string;
  };
  /**
   * R12-C2 follow-up: main-process labels for the wireframe checkpoint
   * created by {@link MeetingOrchestrator.createWireframeCheckpoint}.
   * `title` is the checkpoint title (also rendered in the channel UI),
   * `readyMessage` is the system message body appended when the
   * checkpoint becomes available.
   */
  wireframeCheckpoint: {
    title: string;
    readyMessage: string;
  };
  /**
   * R12-C2 follow-up: orchestrator-side system message bodies for the
   * meeting-review gate (`createPlanningMinutesReview`). `decisionMessage`
   * already covers handler decision outcomes — these cover the *creation*
   * side (the planning-minutes title used as the gate title + the system
   * message appended to surface the gate).
   */
  meetingReviewSystemMessage: {
    planningMinutesTitle: string;
    planningReviewReady: string;
  };
  /**
   * R12-C2 follow-up: orchestrator-side system message bodies and
   * audit-reason strings for the planning-design check phase
   * (`runPlanningDesignCheckPhase`). Each entry mirrors a
   * `appendPlanningDesignCheckRecord(..., '<korean>')` call site (the
   * 2nd arg is the system message body) plus the misalignment /
   * dispatch failure / missing-channel reason strings passed to
   * `recordNeedsUserDecision({ reason })`.
   */
  planningDesignCheckSystemMessage: {
    designCheckRequestDispatched: string;
    needsUserDecision: string;
    staffMissingReason: string;
    alignedButNoImplementationChannel: string;
    alignedDispatched: string;
    implementationDispatchFailed: string;
    designReturnDispatched: string;
    designReturnDispatchFailed: string;
    designReturnTargetMissing: string;
    missingSourceHandoffReason: string;
    missingPlanningMinutesBodyReason: string;
  };
}

const KO: NotificationDictionary = {
  test: {
    title: 'Rolestra 테스트',
    body: 'OS 알림 확인용',
  },
  newMessage: {
    title: '새 메시지',
    body: '{{author}}: {{preview}}',
  },
  approvalPending: {
    title: '승인 요청 대기',
    body: '{{kind}} 승인이 필요합니다.',
  },
  workDone: {
    title: '작업 완료',
    body: '회의가 완료되었습니다',
  },
  error: {
    title: '작업 실패',
    body: '{{previous}} 상태에서 종료되었습니다',
  },
  warmupFailed: {
    title: '연결 실패',
    body: '{{name}} 연결을 확인해 주세요',
  },
  circuitBreaker: {
    title: 'Circuit breaker 발동',
    body: '자율 모드가 manual로 변경되었습니다.',
    filesPerTurn: {
      title: 'Circuit breaker 발동 — 파일 변경 한계',
      body: '한 턴에 파일 {{count}}개를 변경했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '파일 변경이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    cumulativeCliMs: {
      title: 'Circuit breaker 발동 — CLI 누적 시간 한계',
      body: 'CLI 누적 실행 시간이 {{minutes}}분을 넘었습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        'CLI 누적 실행 시간이 한계를 초과했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    queueStreak: {
      title: 'Circuit breaker 발동 — 연속 큐 실행',
      body: '연속으로 {{count}}개의 큐 항목을 실행했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '연속 큐 실행이 한계에 도달했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
    sameError: {
      title: 'Circuit breaker 발동 — 같은 오류 반복',
      body: '같은 오류({{category}})가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.',
      bodyGeneric:
        '같은 오류가 반복해서 발생했습니다. 자율 모드가 manual로 변경되었습니다.',
    },
  },
  generalMeetingDone: {
    titled: '회의 "{{title}}" 이(가) 완료되었습니다.',
    untitled: '회의가 완료되었습니다.',
  },
  approvalSystemMessage: {
    rejectPrefix: '[승인 거절]',
    conditionalPrefix: '[조건부 승인]',
    modeTransitionAdvisoryPrefix: '[권한 모드 변경 — 조건부 안내]',
  },
  meetingMinutes: {
    rejection: '회의 합의 거절됨',
    rejectionWithComment: '회의 합의 거절됨 — {{comment}}',
    summaryPrefix: '📝 LLM 요약 ({{provider}}):',
    handoffTitle: '회의 종료 — 다음 부서 인계 결재',
    handoffBody: '"{{topic}}" 회의가 끝났습니다. 다음 부서로 인계할지 결재해 주세요.',
    maxRoundsTitle: '회의 합의 지연 — 사용자 호출',
    maxRoundsBody: '의견 {{screenId}} 가 {{maxRounds}} 라운드 안 합의에 이르지 못해 사용자 결재가 필요합니다.',
  },
  approvalNotificationBridge: {
    cli_permission: { title: 'CLI 권한 요청', body: '승인 대기' },
    mode_transition: { title: '권한 모드 변경 요청', body: '권한 모드 변경 대기' },
    review_outcome: { title: '리뷰 결과 승인', body: '리뷰 결과를 확인해 주세요.' },
    failure_report: { title: '실패 리포트', body: '자동 실행 실패가 보고되었습니다.' },
    circuit_breaker: {
      title: '자율 모드 다운그레이드',
      body: '자동 실행이 중단되어 자율 모드가 manual로 변경되었습니다.',
    },
  },
  autonomyGate: {
    label: {
      mode_transition: '모드 전환',
      review_outcome: '리뷰 결과',
      cli_permission: 'CLI 권한',
      failure_report: '실패 리포트',
    },
    trace: {
      autoAccepted: '자율 모드: {{label}} 자동 수락',
      downgraded: '자율 모드: {{label}} 실패 감지 → manual로 강제 전환',
    },
    notify: {
      autoAcceptTitle: '자동 수락',
      autoAcceptBody: '{{label}} 승인이 자동 처리되었습니다',
      errorTitle: '자율 모드 해제',
      errorBody: '{{label}} 실패로 manual 모드로 전환되었습니다',
    },
  },
  meetingReview: {
    decisionMessage: {
      approveWithoutDispatch: '기획 회의록이 승인되었습니다.',
      approveWithDispatch: '기획 회의록이 승인되어 디자인 부서로 인계되었습니다.',
      stop: '기획 회의록 검토 결과, 다음 부서 인계 없이 진행을 중지했습니다.',
      revise:
        '기획 회의록에 수정 지시가 저장되었습니다. 이 회의록은 반려 기록으로 보관됩니다.',
      restart: '기획 회의록 기준으로 새 회의 시작 요청이 저장되었습니다.',
    },
    archiveHeader: {
      status: '상태: {{value}}',
      document: '문서: {{value}}',
      targetRole: '다음 부서: {{value}}',
      dispatchId: '인계 ID: {{value}}',
      decision: '결정: {{value}}',
      userNoteSection: '## 사용자 검토 의견',
      minutesBodySection: '## 회의록 본문',
    },
    decisionLabel: {
      approve: '승인',
      revise: '수정 지시',
      restart: '새 회의 시작 요청',
      stop: '진행 중지',
    },
    statusLabel: {
      pending: '검토 대기',
      approved: '승인됨',
      revision_requested: '수정 지시',
      restart_requested: '새 회의 시작 요청',
      stopped: '진행 중지',
    },
  },
  planningDesignCheck: {
    decisionMessage: {
      sendToImplementation: '사용자 판단에 따라 구현으로 보냈습니다.',
      requestDesignRevision: '사용자 판단에 따라 디자인에 다시 수정 요청했습니다.',
      stop: '사용자 판단에 따라 진행을 중지했습니다.',
      saved: '사용자 판단이 저장되었습니다.',
    },
    archiveHeader: {
      title: '# 사용자 판단 필요',
      decision: '결정: {{value}}',
      userNoteSection: '## 사용자 판단 의견',
      dispatchId: '인계 ID: {{value}}',
      reasonSection: '## 기획 검수 의견',
      reasonMissing: '(기록 없음)',
      revisionDirectionSection: '## 수정 방향',
    },
    decisionLabel: {
      send_to_implementation: '구현으로 보내기',
      request_design_revision: '디자인에 다시 수정 요청하기',
      stop: '진행 중지',
      unset: '(미정)',
    },
  },
  meetingMinutesHandoff: {
    reviewGatePending:
      '기획 회의록 검토 대기 중입니다. 승인 전까지 디자인 부서 인계를 보류합니다.',
    autoDispatched: '회의 종결 — 받는 부서로 자동 인계 완료.',
    pendingUserApproval: '회의 종결 — 다음 부서 인계는 사용자 승인 대기 중입니다.',
    noChain: '회의가 끝났습니다.',
    maxRoundsPause:
      '의견 {{screenId}} 가 {{maxRounds}} 라운드 동안 합의에 이르지 못해 사용자 호출 — 회의를 일시 정지합니다.',
  },
  handoffContext: {
    minutesHeader: '[보낸 부서 인계 회의록]',
    nextActionsHeader: '[당신이 처리할 작업]',
    noActions: '(작업 list 없음 — 위 회의록 본문에서 자체 분배)',
    reasonHeader: '[인계 사유]',
    footer:
      '위 인계 회의록 + 작업 list 보고 의견을 제시하세요. 응답 schema 는 별도 system message 안내.',
  },
  wireframeCheckpoint: {
    title: '와이어프레임 확인',
    readyMessage: '와이어프레임 확인이 준비되었습니다.',
  },
  meetingReviewSystemMessage: {
    planningMinutesTitle: '기획 회의록',
    planningReviewReady:
      '기획 회의록이 준비되었습니다. 검토하기를 눌러 승인하거나 반려해 주세요.',
  },
  planningDesignCheckSystemMessage: {
    designCheckRequestDispatched: '디자인 검수 요청서가 기획 부서로 전달되었습니다.',
    needsUserDecision: '사용자 판단 필요',
    staffMissingReason: '기획 검수 담당 직원 응답이 없어 사용자 판단이 필요합니다.',
    alignedButNoImplementationChannel:
      '기획 검수는 의도에 맞음으로 끝났지만 구현 부서 채널을 찾지 못했습니다.',
    alignedDispatched:
      '기획 검수 결과 의도에 맞음으로 판단되어 구현 부서로 자동 인계되었습니다.',
    implementationDispatchFailed:
      '구현 부서 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
    designReturnDispatched:
      '기획 검수 결과 의도와 다름으로 판단되어 디자인 되돌림을 한 번 자동 실행했습니다.',
    designReturnDispatchFailed:
      '디자인 수정 요청 자동 인계에 실패했습니다. 사용자 판단이 필요합니다.',
    designReturnTargetMissing:
      '디자인 되돌림 대상 부서를 찾지 못해 사용자 판단이 필요합니다.',
    missingSourceHandoffReason:
      '디자인 회의가 기획 인계서에서 시작된 기록이 없어 원래 기획 회의록을 찾지 못했습니다.',
    missingPlanningMinutesBodyReason:
      '기획 검수 기준인 원래 기획 회의록 본문 또는 경로를 찾지 못했습니다.',
  },
};

const EN: NotificationDictionary = {
  test: {
    title: 'Rolestra test',
    body: 'OS notification check',
  },
  newMessage: {
    title: 'New message',
    body: '{{author}}: {{preview}}',
  },
  approvalPending: {
    title: 'Approval pending',
    body: 'A {{kind}} approval is waiting.',
  },
  workDone: {
    title: 'Work done',
    body: 'The meeting has completed',
  },
  error: {
    title: 'Work failed',
    body: 'Ended in {{previous}} state',
  },
  warmupFailed: {
    title: 'Connection failed',
    body: 'Please check {{name}} connectivity',
  },
  circuitBreaker: {
    title: 'Circuit breaker fired',
    body: 'Autonomy reverted to manual.',
    filesPerTurn: {
      title: 'Circuit breaker fired — file change limit',
      body: 'Changed {{count}} files in one turn. Autonomy reverted to manual.',
      bodyGeneric:
        'File changes exceeded the limit. Autonomy reverted to manual.',
    },
    cumulativeCliMs: {
      title: 'Circuit breaker fired — CLI time limit',
      body: 'Cumulative CLI runtime exceeded {{minutes}} minutes. Autonomy reverted to manual.',
      bodyGeneric:
        'Cumulative CLI runtime exceeded the limit. Autonomy reverted to manual.',
    },
    queueStreak: {
      title: 'Circuit breaker fired — consecutive queue runs',
      body: 'Ran {{count}} consecutive queue items. Autonomy reverted to manual.',
      bodyGeneric:
        'Consecutive queue runs hit the limit. Autonomy reverted to manual.',
    },
    sameError: {
      title: 'Circuit breaker fired — repeated error',
      body: 'Same error ({{category}}) repeated. Autonomy reverted to manual.',
      bodyGeneric: 'The same error repeated. Autonomy reverted to manual.',
    },
  },
  generalMeetingDone: {
    titled: 'Meeting "{{title}}" has completed.',
    untitled: 'The meeting has completed.',
  },
  approvalSystemMessage: {
    rejectPrefix: '[Approval rejected]',
    conditionalPrefix: '[Approval conditional]',
    modeTransitionAdvisoryPrefix: '[Permission mode change — conditional note]',
  },
  meetingMinutes: {
    rejection: 'Consensus rejected',
    rejectionWithComment: 'Consensus rejected — {{comment}}',
    summaryPrefix: '📝 LLM summary ({{provider}}):',
    handoffTitle: 'Meeting ended — handoff approval',
    handoffBody: 'Meeting on "{{topic}}" finished. Approve handoff to the next department.',
    maxRoundsTitle: 'Consensus stalled — user attention',
    maxRoundsBody: 'Opinion {{screenId}} did not reach consensus within {{maxRounds}} rounds — please review.',
  },
  approvalNotificationBridge: {
    cli_permission: { title: 'CLI permission request', body: 'Awaiting approval' },
    mode_transition: { title: 'Permission mode change request', body: 'Awaiting permission mode change' },
    review_outcome: { title: 'Review outcome approval', body: 'Please review the outcome.' },
    failure_report: { title: 'Failure report', body: 'An automated run failed.' },
    circuit_breaker: {
      title: 'Autonomy downgrade',
      body: 'Automated execution stopped — autonomy reverted to manual.',
    },
  },
  autonomyGate: {
    label: {
      mode_transition: 'Mode transition',
      review_outcome: 'Review outcome',
      cli_permission: 'CLI permission',
      failure_report: 'Failure report',
    },
    trace: {
      autoAccepted: 'Autonomy: {{label}} auto-accepted',
      downgraded: 'Autonomy: {{label}} failure detected → forced to manual',
    },
    notify: {
      autoAcceptTitle: 'Auto-accepted',
      autoAcceptBody: '{{label}} approval was processed automatically',
      errorTitle: 'Autonomy disabled',
      errorBody: 'Reverted to manual after {{label}} failure',
    },
  },
  meetingReview: {
    decisionMessage: {
      approveWithoutDispatch: 'The planning minutes were approved.',
      approveWithDispatch:
        'The planning minutes were approved and handed off to the design department.',
      stop: 'After reviewing the planning minutes, the work was stopped without a handoff.',
      revise:
        'Revision instructions for the planning minutes were saved. This document is archived as a returned record.',
      restart: 'A request to start a new meeting based on the planning minutes was saved.',
    },
    archiveHeader: {
      status: 'Status: {{value}}',
      document: 'Document: {{value}}',
      targetRole: 'Next department: {{value}}',
      dispatchId: 'Handoff ID: {{value}}',
      decision: 'Decision: {{value}}',
      userNoteSection: '## User review note',
      minutesBodySection: '## Minutes body',
    },
    decisionLabel: {
      approve: 'Approve',
      revise: 'Request revision',
      restart: 'Request restart',
      stop: 'Stop',
    },
    statusLabel: {
      pending: 'Pending review',
      approved: 'Approved',
      revision_requested: 'Revision requested',
      restart_requested: 'Restart requested',
      stopped: 'Stopped',
    },
  },
  planningDesignCheck: {
    decisionMessage: {
      sendToImplementation:
        'Per user decision, the work was forwarded to implementation.',
      requestDesignRevision:
        'Per user decision, a revision was requested back from the design department.',
      stop: 'Per user decision, the work was stopped.',
      saved: 'The user decision was saved.',
    },
    archiveHeader: {
      title: '# User decision required',
      decision: 'Decision: {{value}}',
      userNoteSection: '## User decision note',
      dispatchId: 'Handoff ID: {{value}}',
      reasonSection: '## Planning review note',
      reasonMissing: '(no record)',
      revisionDirectionSection: '## Revision direction',
    },
    decisionLabel: {
      send_to_implementation: 'Send to implementation',
      request_design_revision: 'Request design revision',
      stop: 'Stop',
      unset: '(unset)',
    },
  },
  meetingMinutesHandoff: {
    reviewGatePending:
      'The planning minutes are awaiting review. Design handoff is held until approval.',
    autoDispatched: 'Meeting ended — auto-dispatched to the receiver department.',
    pendingUserApproval:
      'Meeting ended — the handoff is awaiting user approval.',
    noChain: 'The meeting has ended.',
    maxRoundsPause:
      'Opinion {{screenId}} did not reach consensus within {{maxRounds}} rounds — calling the user, the meeting is paused.',
  },
  handoffContext: {
    minutesHeader: '[Sender department minutes]',
    nextActionsHeader: '[Tasks for you to handle]',
    noActions: '(No task list — distribute from the minutes body above)',
    reasonHeader: '[Handoff reason]',
    footer:
      'Review the minutes + task list above and post your opinion. The response schema is provided in a separate system message.',
  },
  wireframeCheckpoint: {
    title: 'Wireframe review',
    readyMessage: 'The wireframe review is ready.',
  },
  meetingReviewSystemMessage: {
    planningMinutesTitle: 'Planning minutes',
    planningReviewReady:
      'The planning minutes are ready. Press "Review" to approve or return them.',
  },
  planningDesignCheckSystemMessage: {
    designCheckRequestDispatched:
      'The design-review request was forwarded to the planning department.',
    needsUserDecision: 'User decision required',
    staffMissingReason:
      'No staff is assigned to the planning-review department, so a user decision is required.',
    alignedButNoImplementationChannel:
      'The planning review came back as aligned, but no implementation department channel was found.',
    alignedDispatched:
      'The planning review came back as aligned, so the work was auto-dispatched to the implementation department.',
    implementationDispatchFailed:
      'Auto-dispatch to the implementation department failed. A user decision is required.',
    designReturnDispatched:
      'The planning review came back as misaligned, so one design return was auto-dispatched.',
    designReturnDispatchFailed:
      'Auto-dispatch of the design revision request failed. A user decision is required.',
    designReturnTargetMissing:
      'No design return target department was found, so a user decision is required.',
    missingSourceHandoffReason:
      'The design meeting was not started from a planning handoff, so the original planning minutes could not be located.',
    missingPlanningMinutesBodyReason:
      'The body or path of the original planning minutes (the planning-review baseline) was not found.',
  },
};

const DICTIONARIES: Record<NotificationLocale, NotificationDictionary> = {
  ko: KO,
  en: EN,
};

// ── Public API ──────────────────────────────────────────────────────

/**
 * Union of leaf labels addressable via {@link resolveNotificationLabel}.
 * Mirrors the top-level `notification.*` i18n keys the renderer exposes
 * — anything the main-process emits as an OS notification body should be
 * addressable through one of these keys.
 */
export type NotificationLabelKey =
  | 'test.title'
  | 'test.body'
  | 'newMessage.title'
  | 'newMessage.body'
  | 'approvalPending.title'
  | 'approvalPending.body'
  | 'workDone.title'
  | 'workDone.body'
  | 'error.title'
  | 'error.body'
  | 'warmupFailed.title'
  | 'warmupFailed.body'
  | 'circuitBreaker.title'
  | 'circuitBreaker.body'
  | 'generalMeetingDone.titled'
  | 'generalMeetingDone.untitled'
  | 'approvalSystemMessage.rejectPrefix'
  | 'approvalSystemMessage.conditionalPrefix'
  | 'approvalSystemMessage.modeTransitionAdvisoryPrefix'
  | 'meetingMinutes.rejection'
  | 'meetingMinutes.rejectionWithComment'
  | 'meetingMinutes.summaryPrefix'
  | 'meetingMinutes.handoffTitle'
  | 'meetingMinutes.handoffBody'
  | 'meetingMinutes.maxRoundsTitle'
  | 'meetingMinutes.maxRoundsBody'
  // R11-Task11 (D9): approval-notification-bridge labels.
  | 'approvalNotificationBridge.cli_permission.title'
  | 'approvalNotificationBridge.cli_permission.body'
  | 'approvalNotificationBridge.mode_transition.title'
  | 'approvalNotificationBridge.mode_transition.body'
  | 'approvalNotificationBridge.review_outcome.title'
  | 'approvalNotificationBridge.review_outcome.body'
  | 'approvalNotificationBridge.failure_report.title'
  | 'approvalNotificationBridge.failure_report.body'
  | 'approvalNotificationBridge.circuit_breaker.title'
  | 'approvalNotificationBridge.circuit_breaker.body'
  // R11-Task11 (D9): autonomy-gate labels.
  | 'autonomyGate.label.mode_transition'
  | 'autonomyGate.label.review_outcome'
  | 'autonomyGate.label.cli_permission'
  | 'autonomyGate.label.failure_report'
  | 'autonomyGate.trace.autoAccepted'
  | 'autonomyGate.trace.downgraded'
  | 'autonomyGate.notify.autoAcceptTitle'
  | 'autonomyGate.notify.autoAcceptBody'
  | 'autonomyGate.notify.errorTitle'
  | 'autonomyGate.notify.errorBody'
  // R12-C2 P6 follow-up: meeting-review-handler labels.
  | 'meetingReview.decisionMessage.approveWithoutDispatch'
  | 'meetingReview.decisionMessage.approveWithDispatch'
  | 'meetingReview.decisionMessage.stop'
  | 'meetingReview.decisionMessage.revise'
  | 'meetingReview.decisionMessage.restart'
  | 'meetingReview.archiveHeader.status'
  | 'meetingReview.archiveHeader.document'
  | 'meetingReview.archiveHeader.targetRole'
  | 'meetingReview.archiveHeader.dispatchId'
  | 'meetingReview.archiveHeader.decision'
  | 'meetingReview.archiveHeader.userNoteSection'
  | 'meetingReview.archiveHeader.minutesBodySection'
  | 'meetingReview.decisionLabel.approve'
  | 'meetingReview.decisionLabel.revise'
  | 'meetingReview.decisionLabel.restart'
  | 'meetingReview.decisionLabel.stop'
  | 'meetingReview.statusLabel.pending'
  | 'meetingReview.statusLabel.approved'
  | 'meetingReview.statusLabel.revision_requested'
  | 'meetingReview.statusLabel.restart_requested'
  | 'meetingReview.statusLabel.stopped'
  // R12-C2 P6 follow-up: planning-design-check-handler labels.
  | 'planningDesignCheck.decisionMessage.sendToImplementation'
  | 'planningDesignCheck.decisionMessage.requestDesignRevision'
  | 'planningDesignCheck.decisionMessage.stop'
  | 'planningDesignCheck.decisionMessage.saved'
  | 'planningDesignCheck.archiveHeader.title'
  | 'planningDesignCheck.archiveHeader.decision'
  | 'planningDesignCheck.archiveHeader.userNoteSection'
  | 'planningDesignCheck.archiveHeader.dispatchId'
  | 'planningDesignCheck.archiveHeader.reasonSection'
  | 'planningDesignCheck.archiveHeader.reasonMissing'
  | 'planningDesignCheck.archiveHeader.revisionDirectionSection'
  | 'planningDesignCheck.decisionLabel.send_to_implementation'
  | 'planningDesignCheck.decisionLabel.request_design_revision'
  | 'planningDesignCheck.decisionLabel.stop'
  | 'planningDesignCheck.decisionLabel.unset'
  // R12-C2 P6 follow-up: meeting-orchestrator handoff phase system messages.
  | 'meetingMinutesHandoff.reviewGatePending'
  | 'meetingMinutesHandoff.autoDispatched'
  | 'meetingMinutesHandoff.pendingUserApproval'
  | 'meetingMinutesHandoff.noChain'
  | 'meetingMinutesHandoff.maxRoundsPause'
  // R12-C2 T29 follow-up: handoff-context system message labels.
  | 'handoffContext.minutesHeader'
  | 'handoffContext.nextActionsHeader'
  | 'handoffContext.noActions'
  | 'handoffContext.reasonHeader'
  | 'handoffContext.footer'
  // R12-C2 follow-up B1: meeting-orchestrator wireframe checkpoint labels.
  | 'wireframeCheckpoint.title'
  | 'wireframeCheckpoint.readyMessage'
  // R12-C2 follow-up B1: meeting-orchestrator planning-minutes review labels.
  | 'meetingReviewSystemMessage.planningMinutesTitle'
  | 'meetingReviewSystemMessage.planningReviewReady'
  // R12-C2 follow-up B1: meeting-orchestrator planning-design check labels.
  | 'planningDesignCheckSystemMessage.designCheckRequestDispatched'
  | 'planningDesignCheckSystemMessage.needsUserDecision'
  | 'planningDesignCheckSystemMessage.staffMissingReason'
  | 'planningDesignCheckSystemMessage.alignedButNoImplementationChannel'
  | 'planningDesignCheckSystemMessage.alignedDispatched'
  | 'planningDesignCheckSystemMessage.implementationDispatchFailed'
  | 'planningDesignCheckSystemMessage.designReturnDispatched'
  | 'planningDesignCheckSystemMessage.designReturnDispatchFailed'
  | 'planningDesignCheckSystemMessage.designReturnTargetMissing'
  | 'planningDesignCheckSystemMessage.missingSourceHandoffReason'
  | 'planningDesignCheckSystemMessage.missingPlanningMinutesBodyReason';

/**
 * Resolves a notification label for the current locale. `key` is a
 * dotted path into the dictionary (e.g. `'workDone.title'`). Missing
 * interpolation variables render as the empty string — same as i18next's
 * silent-missing default — so a bad callsite never surfaces
 * `{{name}}` to the user.
 */
export function resolveNotificationLabel(
  key: NotificationLabelKey,
  vars?: Record<string, string | number>,
  locale: NotificationLocale = currentLocale,
): string {
  const template = lookup(dictionaryFor(locale), key);
  if (template === null) return key;
  return interpolate(template, vars ?? {});
}

/**
 * Resolves the `circuitBreaker` label family for a given tripwire reason.
 * Returns `{title, body}` with interpolation applied. When a numeric
 * detail value is missing (e.g. `count=null`) the generic body is used —
 * same shape as the hand-written fallback at v3-side-effects.ts before
 * this module existed.
 *
 * Keeping the per-tripwire switch here (rather than in v3-side-effects)
 * lets the dictionary stay the single source of truth for breaker copy
 * — callers emit `reason` + `detail`, the dictionary picks the shape.
 */
export function resolveBreakerCopy(
  reason: BreakerReason,
  detail: Record<string, unknown> | null | undefined,
  locale: NotificationLocale = currentLocale,
): { title: string; body: string } {
  const dict = dictionaryFor(locale).circuitBreaker;
  switch (reason) {
    case 'files_per_turn': {
      const count = readNumber(detail, 'count');
      return {
        title: dict.filesPerTurn.title,
        body:
          count !== null
            ? interpolate(dict.filesPerTurn.body, { count })
            : dict.filesPerTurn.bodyGeneric,
      };
    }
    case 'cumulative_cli_ms': {
      const ms = readNumber(detail, 'ms');
      const minutes = ms !== null ? Math.round(ms / 60000) : null;
      return {
        title: dict.cumulativeCliMs.title,
        body:
          minutes !== null
            ? interpolate(dict.cumulativeCliMs.body, { minutes })
            : dict.cumulativeCliMs.bodyGeneric,
      };
    }
    case 'queue_streak': {
      const count = readNumber(detail, 'count');
      return {
        title: dict.queueStreak.title,
        body:
          count !== null
            ? interpolate(dict.queueStreak.body, { count })
            : dict.queueStreak.bodyGeneric,
      };
    }
    case 'same_error': {
      const category = readString(detail, 'category');
      return {
        title: dict.sameError.title,
        body:
          category !== null
            ? interpolate(dict.sameError.body, { category })
            : dict.sameError.bodyGeneric,
      };
    }
    default:
      // Exhaustive fallback for future CircuitBreakerReason additions.
      return { title: dict.title, body: dict.body };
  }
}

/**
 * Resolves the `#일반` (general) channel copy for a completed meeting.
 * Mirrors spec §8 wording. Empty/whitespace `title` falls through to the
 * untitled variant so the message never renders a stray trailing quote.
 */
export function resolveGeneralMeetingDoneBody(
  meetingTitle: string,
  locale: NotificationLocale = currentLocale,
): string {
  const trimmed = meetingTitle.trim();
  const dict = dictionaryFor(locale).generalMeetingDone;
  if (trimmed.length === 0) return dict.untitled;
  return interpolate(dict.titled, { title: trimmed });
}

/**
 * Circuit breaker reason union mirrored from the breaker module. Kept
 * here rather than re-exported so the dictionary layer has zero imports
 * from the queue module (same "electron-free" principle as the service).
 */
export type BreakerReason =
  | 'files_per_turn'
  | 'cumulative_cli_ms'
  | 'queue_streak'
  | 'same_error';

// ── Internals ───────────────────────────────────────────────────────

function dictionaryFor(locale: NotificationLocale): NotificationDictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

function lookup(dict: NotificationDictionary, key: string): string | null {
  const segments = key.split('.');
  let node: unknown = dict;
  for (const seg of segments) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[seg];
  }
  return typeof node === 'string' ? node : null;
}

function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? '' : String(value);
  });
}

function readNumber(
  detail: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = detail[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(
  detail: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = detail[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// ── Test-only hook ──────────────────────────────────────────────────

/**
 * Resets the module-level locale back to {@link DEFAULT_LOCALE}. Exposed
 * for unit tests that mutate `setNotificationLocale('en')` and need to
 * avoid bleed-through to neighbours (vitest isolates files, not tests).
 */
export function __resetNotificationLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE;
}
