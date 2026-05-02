/**
 * OnboardingPage — first-boot 5-step wizard.
 *
 * Composition:
 *   - Step 1 (office)        → welcome / what-is-this copy + "시작" CTA
 *   - Step 2 (staff)         → live `provider:detect` snapshots → OBStaffCard grid
 *   - Step 3 (roles)         → Step3RoleAssignment per selected provider
 *   - Step 4 (permissions)   → Step4Permissions radio group
 *   - Step 5 (firstProject)  → Step5FirstProject kind + slug
 *
 * State source-of-truth:
 *   - {@link useOnboardingState} round-trips against `onboarding:*` IPC and
 *     also fetches `provider:detect` once on mount (F1).
 *
 * Step 2 data source (F1 cleanup):
 *   - 단일 데이터 소스 = `provider:detect` snapshots. 알려진 provider 메타
 *     (claude / gemini / codex / copilot / local / grok) 는 i18n 사전
 *     `onboarding.providers.<id>` 에서 끌어오고, 알려지지 않은 id 는 unknown
 *     fallback + providerId 자체를 name 으로 사용한다.
 *   - 첫 진입 (selections.staff === undefined) 에서는 detection 의 available
 *     provider 를 자동 pre-select. 사용자가 한 번이라도 수정하면 그 결정이
 *     영속화되어 다시 갈아엎지 않는다.
 *   - detection 결과가 비어 있으면 카드 grid 대신 명시 안내 (감지 안 됨 +
 *     Settings 진입 버튼) 를 표시하고 "다음" 을 차단한다.
 *
 * Component split:
 *   - `OnboardingPage` (parent) — 단일 hook 호출 + state===null 분기. 분기에
 *     따라 LoadingFrame 또는 OnboardingWizardBody 를 렌더한다. hook 호출 순서
 *     를 안정화 (early return 후 추가 hook 이 실행되지 않도록) 하기 위한
 *     구조다.
 *   - `OnboardingWizardBody` (child) — non-null state 를 prop 으로 받아 wizard
 *     본체 렌더. 모든 step body / handler / memo 가 본 컴포넌트 내에 위치한다.
 *
 * Step 5 finishes via `complete()` which flips the persisted row +
 * unmounts the wizard via the parent `onExit` (App.tsx switches view to
 * the dashboard). The actual `project:create` invocation lives in
 * App.tsx because the wizard does not own ProjectService — it only
 * collects the inputs.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { OBStaffCard } from './OBStaffCard';
import { OBStepper } from './OBStepper';
import { OBSummaryStrip } from './OBSummaryStrip';
import { OBTopBar } from './OBTopBar';
import { Step1ArenaRoot } from './steps/Step1ArenaRoot';
import { Step3RoleAssignment } from './steps/Step3RoleAssignment';
import { Step4Permissions } from './steps/Step4Permissions';
import { Step5FirstProject } from './steps/Step5FirstProject';
import {
  ONBOARDING_STEPS,
  type OBStep,
  type OBStepStatus,
  type StaffCandidate,
} from './onboarding-data';
import {
  buildStaffCandidates,
  defaultPreSelection,
} from './build-staff-candidates';
import {
  useOnboardingState,
  type UseOnboardingStateResult,
} from './use-onboarding-state';
import type {
  OnboardingSelections,
  OnboardingState,
  OnboardingStep,
} from '../../../shared/onboarding-types';
import type {
  PermissionMode,
  ProjectKind,
} from '../../../shared/project-types';
import { ALL_ROLE_IDS, type RoleId } from '../../../shared/role-types';

export interface OnboardingPageProps {
  /** Invoked when the user clicks "나중에 하기" / "이전" / completes step 5. */
  onExit: () => void;
  /**
   * Optional callback fired when step 5 finishes (after `onboarding:complete`
   * resolves) so App.tsx can decide whether to spawn `project:create` or
   * just bounce to the dashboard. Wire site treats a missing callback as
   * "skip project creation" — the user can always reach
   * `ProjectCreateModal` from the dashboard.
   */
  onCompleteWithProject?: (input: {
    kind: ProjectKind;
    slug: string;
    staff: ReadonlyArray<string>;
    roles: Record<string, string>;
    /**
     * R12-C round 2 — wizard step 3 에서 선택된 직원별 능력 배정.
     * key = providerId, value = RoleId[]. App.tsx 가 onCompleteWithProject
     * 에서 provider:updateRoles IPC 로 영속화한다.
     */
    skillAssignments: Record<string, RoleId[]>;
    permissions: PermissionMode;
  }) => void;
  /**
   * 빈 detection 결과 시 사용자가 "Settings → CLI 탭" 으로 직접 추가하러
   * 가도록 하는 핸들러. 미연결 시 버튼은 숨김 (콜백 없으면 진입 경로 자체
   * 가 없는 것으로 간주). App.tsx 가 setView('settings') 를 넘긴다.
   */
  onOpenSettings?: () => void;
  className?: string;
}

const MIN_STAFF = 1;
const TOTAL_STEPS = 5 as const;

/**
 * Re-derive `OBStepper` rows from the persisted current step. We keep
 * the static `ONBOARDING_STEPS` keys so the i18n labels stay anchored
 * but mark statuses dynamically — `completed` for steps below current,
 * `current` for the active step, `pending` afterwards.
 */
function buildStepperRows(
  currentStep: OnboardingStep,
): ReadonlyArray<OBStep> {
  return ONBOARDING_STEPS.map((step) => {
    let status: OBStepStatus = 'pending';
    if (step.id < currentStep) status = 'completed';
    else if (step.id === currentStep) status = 'current';
    return { ...step, status };
  });
}

export function OnboardingPage({
  onExit,
  onCompleteWithProject,
  onOpenSettings,
  className,
}: OnboardingPageProps): ReactElement {
  const hook = useOnboardingState();

  // F1: state===null 은 hydrate 미완 (loading) 또는 IPC 실패 (error). 둘 다
  // 조용한 "step 1 가짜 default" 대신 명시 surface 로 처리한다. 본 분기는
  // 자식 (OnboardingWizardBody) 의 모든 hook 을 마운트하지 않으므로 hook
  // 순서가 깨지지 않는다.
  if (hook.state === null) {
    return (
      <LoadingFrame
        loading={hook.loading}
        error={hook.error}
        onExit={onExit}
        className={className}
      />
    );
  }

  return (
    <OnboardingWizardBody
      state={hook.state}
      hook={hook}
      onExit={onExit}
      onCompleteWithProject={onCompleteWithProject}
      onOpenSettings={onOpenSettings}
      className={className}
    />
  );
}

interface LoadingFrameProps {
  loading: boolean;
  error: Error | null;
  onExit: () => void;
  className?: string;
}

function LoadingFrame({
  loading,
  error,
  onExit,
  className,
}: LoadingFrameProps): ReactElement {
  const { t } = useTranslation();
  const message =
    error !== null
      ? t('onboarding.empty.body', {
          defaultValue: 'Failed to load onboarding state. Try restarting.',
        })
      : t('onboarding.empty.loading');
  return (
    <div
      data-testid="onboarding-page"
      data-current-step="0"
      className={clsx(
        'flex h-full min-h-screen flex-col bg-canvas text-fg',
        className,
      )}
    >
      <OBTopBar
        currentStep={1}
        totalSteps={TOTAL_STEPS}
        estimatedTime={t('onboarding.topBar.estTime')}
        onSkip={onExit}
      />
      <div
        data-testid={
          error !== null ? 'onboarding-fatal-error' : 'onboarding-loading'
        }
        className="flex-1 flex items-center justify-center px-6"
      >
        <p className="text-sm text-fg-muted">
          {loading && error === null ? t('onboarding.empty.loading') : message}
        </p>
      </div>
    </div>
  );
}

interface OnboardingWizardBodyProps extends OnboardingPageProps {
  state: OnboardingState;
  hook: UseOnboardingStateResult;
}

function OnboardingWizardBody({
  state,
  hook,
  onExit,
  onCompleteWithProject,
  onOpenSettings,
  className,
}: OnboardingWizardBodyProps): ReactElement {
  const { t } = useTranslation();
  const {
    setStep,
    patchSelections,
    complete,
    detection,
    detectionLoading,
    refreshDetection,
  } = hook;

  // F1: candidates 는 detection snapshot + selections.staff 의 합성 결과.
  // STAFF_CANDIDATES fixture 는 제거되었고 본 useMemo 가 단일 진실원이다.
  const candidates = useMemo<ReadonlyArray<StaffCandidate>>(
    () => buildStaffCandidates(detection, state.selections.staff, t),
    [detection, state.selections.staff, t],
  );

  // F1: 첫 wizard 진입에 한해 (selections.staff === undefined) detection 의
  // available provider 를 auto pre-select. 사용자가 한 번이라도 staff 배열을
  // 비우거나 수정하면 selections.staff 가 정의되므로 본 effect 는 다시
  // 실행되어도 분기에서 빠진다.
  const autoPreSelectedRef = useRef(false);
  useEffect(() => {
    if (autoPreSelectedRef.current) return;
    if (state.selections.staff !== undefined) return;
    if (detection.length === 0) return;
    autoPreSelectedRef.current = true;
    void patchSelections({ staff: defaultPreSelection(detection) });
  }, [detection, state.selections.staff, patchSelections]);

  const currentStep: OnboardingStep = state.currentStep;
  const stepperRows = useMemo(
    () => buildStepperRows(currentStep),
    [currentStep],
  );

  const selectedStaffIds = useMemo(
    () => candidates.filter((c) => c.selected).map((c) => c.id),
    [candidates],
  );
  const selectedCount = selectedStaffIds.length;

  // `?? {}` would create a new identity every render and invalidate the
  // canProceed memo's deps; memoise the fallback so the empty record
  // sticks across renders that don't actually mutate selections.roles.
  const roles = useMemo<NonNullable<OnboardingSelections['roles']>>(
    () => state.selections.roles ?? {},
    [state.selections.roles],
  );
  const permissions: PermissionMode =
    state.selections.permissions ?? 'hybrid';
  const firstProjectKind: ProjectKind =
    state.selections.firstProject?.kind ?? 'new';
  const firstProjectSlug: string =
    state.selections.firstProject?.slug ?? '';

  // Step 3 의 footer 안내를 동적으로 띄우기 위해 빈 role entry 수를 센다.
  // schema 가 빈 string 을 허용하도록 풀려 있어 (입력 중간 상태 보존),
  // "다음" 차단 사유는 UI 레벨에서 footer 로 안내한다.
  const step3PendingCount = useMemo(
    () =>
      selectedStaffIds.filter(
        (id) => (state.selections.roles?.[id] ?? '').trim().length === 0,
      ).length,
    [selectedStaffIds, state.selections.roles],
  );

  // R12-C round 2 — 능력 배정 매트릭스. 부모가 디폴트 채우기 책임.
  // 디폴트: `general` 만 모든 직원 ON, 나머지 8 능력은 OFF — 사용자가
  // 직접 부여해야 부서 채널 회의가 정상 prompt 합성된다.
  const skillAssignments = useMemo<
    NonNullable<OnboardingSelections['skillAssignments']>
  >(() => {
    const stored = state.selections.skillAssignments ?? {};
    const next: Record<string, RoleId[]> = {};
    for (const id of selectedStaffIds) {
      const existing = stored[id];
      if (Array.isArray(existing)) {
        next[id] = existing;
      } else {
        next[id] = ['general'];
      }
    }
    return next;
  }, [selectedStaffIds, state.selections.skillAssignments]);

  // staff 변경 / 디폴트 채우기 결과가 persist 되어 있는 값과 다르면 IPC
  // 한 번 patch — 새 직원이 선택될 때마다 'general' 디폴트가 자연스럽게
  // 저장되어 검증 카운트가 즉시 반영된다.
  const persistedSkillAssignmentsRef = useRef<string>('');
  useEffect(() => {
    const serialized = JSON.stringify(skillAssignments);
    if (serialized === persistedSkillAssignmentsRef.current) return;
    const stored = JSON.stringify(state.selections.skillAssignments ?? {});
    if (serialized === stored) {
      persistedSkillAssignmentsRef.current = serialized;
      return;
    }
    persistedSkillAssignmentsRef.current = serialized;
    void patchSelections({ skillAssignments });
  }, [
    skillAssignments,
    state.selections.skillAssignments,
    patchSelections,
  ]);

  // 9 능력 모두 ≥ 1명이어야 step 3 → 4 진행 허용.
  const step3SkillsMissing = useMemo<RoleId[]>(() => {
    return ALL_ROLE_IDS.filter((role) => {
      for (const id of selectedStaffIds) {
        if ((skillAssignments[id] ?? []).includes(role)) return false;
      }
      return true;
    });
  }, [selectedStaffIds, skillAssignments]);

  // F1: detection 빈 상태 (감지 0 건) 는 Step2 데이터 부재 — 사용자가
  // 진행할 수 없으므로 "다음" 차단 + empty UI 표시. detectionLoading 일
  // 때는 spinner 와 등가의 메시지만 보이고 "다음" 은 여전히 차단.
  const detectionEmpty = detection.length === 0 && !detectionLoading;

  // ── Step gates ────────────────────────────────────────────────
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return true;
      case 2:
        return selectedCount >= MIN_STAFF && !detectionEmpty;
      case 3:
        // every selected provider must have a non-empty trimmed role label
        // AND every one of the 9 skills must have at least one assignee
        // (R12-C round 2 — fixes #3-3 침묵 회귀: 능력 분배 안 된 신규
        // 직원이 부서 채널 진입 시 PromptComposer fallback 으로 빠지는 것을
        // wizard 단계에서 차단).
        return (
          selectedStaffIds.length > 0 &&
          selectedStaffIds.every((id) => (roles[id] ?? '').trim().length > 0) &&
          step3SkillsMissing.length === 0
        );
      case 4:
        return true; // default 'hybrid' always valid
      case 5:
        return firstProjectSlug.trim().length > 0;
      default:
        return false;
    }
  }, [
    currentStep,
    selectedCount,
    selectedStaffIds,
    roles,
    firstProjectSlug,
    detectionEmpty,
    step3SkillsMissing,
  ]);

  // ── Handlers ──────────────────────────────────────────────────
  const toggleSelected = useCallback(
    (id: string): void => {
      const next = candidates.map((c) =>
        c.id === id ? { ...c, selected: !c.selected } : c,
      );
      const ids = next.filter((c) => c.selected).map((c) => c.id);
      void patchSelections({ staff: ids });
    },
    [candidates, patchSelections],
  );

  const handleRolesChange = useCallback(
    (next: NonNullable<OnboardingSelections['roles']>): void => {
      void patchSelections({ roles: next });
    },
    [patchSelections],
  );

  const handleSkillsChange = useCallback(
    (
      next: NonNullable<OnboardingSelections['skillAssignments']>,
    ): void => {
      void patchSelections({ skillAssignments: next });
    },
    [patchSelections],
  );

  const handlePermissionsChange = useCallback(
    (mode: PermissionMode): void => {
      void patchSelections({ permissions: mode });
    },
    [patchSelections],
  );

  const handleFirstProjectChange = useCallback(
    (input: { kind: ProjectKind; slug: string }): void => {
      void patchSelections({ firstProject: input });
    },
    [patchSelections],
  );

  const goToStep = useCallback(
    (step: OnboardingStep): void => {
      void setStep(step);
    },
    [setStep],
  );

  const handlePrev = useCallback((): void => {
    if (currentStep <= 1) {
      onExit();
      return;
    }
    goToStep((currentStep - 1) as OnboardingStep);
  }, [currentStep, goToStep, onExit]);

  const handleNext = useCallback((): void => {
    if (!canProceed) return;
    if (currentStep < TOTAL_STEPS) {
      goToStep((currentStep + 1) as OnboardingStep);
      return;
    }
    // Step 5 → complete + delegate to App.tsx. Beyond firstProject creation,
    // App.tsx must also persist staff role assignments and the permission
    // mode the wizard collected — without this hand-off the office boots
    // empty even though the wizard ran end-to-end.
    void complete().then(() => {
      if (onCompleteWithProject && firstProjectSlug.trim().length > 0) {
        onCompleteWithProject({
          kind: firstProjectKind,
          slug: firstProjectSlug.trim(),
          staff: selectedStaffIds,
          roles: { ...roles },
          skillAssignments: { ...skillAssignments },
          permissions,
        });
      }
      onExit();
    });
  }, [
    canProceed,
    currentStep,
    goToStep,
    complete,
    onCompleteWithProject,
    onExit,
    firstProjectKind,
    skillAssignments,
    firstProjectSlug,
    selectedStaffIds,
    roles,
    permissions,
  ]);

  const handleRescan = useCallback((): void => {
    void refreshDetection();
  }, [refreshDetection]);

  // ── Step body ─────────────────────────────────────────────────
  const heading = t(`onboarding.step${currentStep}.heading`, {
    defaultValue: t('onboarding.heading'),
  });
  const description = t(`onboarding.step${currentStep}.description`, {
    defaultValue: t('onboarding.description'),
  });

  return (
    <div
      data-testid="onboarding-page"
      data-current-step={currentStep}
      className={clsx(
        'flex h-full min-h-screen flex-col bg-canvas text-fg',
        className,
      )}
    >
      <OBTopBar
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        estimatedTime={t('onboarding.topBar.estTime')}
        onSkip={onExit}
      />

      <div className="flex flex-col gap-4 px-6 pt-4 pb-2">
        <OBStepper steps={stepperRows} />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h1
          data-testid="onboarding-heading"
          className="font-display text-2xl font-semibold text-fg"
        >
          {heading}
        </h1>
        <p
          data-testid="onboarding-description"
          className="mt-2 text-sm leading-relaxed text-fg-muted max-w-3xl"
        >
          {description}
        </p>

        {currentStep === 1 && (
          <>
            {/*
              사용자 요청 (2026-05-03): 안내 카드 wrapper 삭제. 본문은
              상단 description 아래에 inline 으로 이어 붙여 step 1 의
              핵심 affordance (ArenaRoot picker) 가 즉시 보이게 한다.
            */}
            <p
              data-testid="onboarding-step-1-body"
              className="mt-2 text-sm leading-relaxed text-fg-muted max-w-3xl break-keep whitespace-pre-line"
            >
              {t('onboarding.step1.body')}
            </p>
            <Step1ArenaRoot />
          </>
        )}

        {currentStep === 2 && (
          <>
            {detectionLoading && detection.length === 0 ? (
              <div
                data-testid="onboarding-detection-loading"
                className="mt-6 max-w-2xl rounded-panel border border-border-soft bg-panel-bg p-4 text-sm text-fg-muted"
              >
                {t('onboarding.empty.loading')}
              </div>
            ) : detectionEmpty ? (
              <section
                data-testid="onboarding-detection-empty"
                className="mt-6 max-w-2xl rounded-panel border border-border-soft bg-panel-bg p-4 text-sm leading-relaxed text-fg"
              >
                <h2 className="font-semibold text-fg">
                  {t('onboarding.empty.title')}
                </h2>
                <p className="mt-2 text-fg-muted">
                  {t('onboarding.empty.body')}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    tone="primary"
                    size="sm"
                    data-testid="onboarding-empty-action-settings"
                    disabled={onOpenSettings == null}
                    onClick={onOpenSettings}
                  >
                    {t('onboarding.empty.action')}
                  </Button>
                  <Button
                    type="button"
                    tone="secondary"
                    size="sm"
                    data-testid="onboarding-empty-action-rescan"
                    onClick={handleRescan}
                  >
                    {t('onboarding.empty.rescan')}
                  </Button>
                </div>
              </section>
            ) : (
              <>
                <div className="mt-4">
                  <OBSummaryStrip candidates={candidates} />
                </div>
                <div
                  data-testid="onboarding-staff-grid"
                  className="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {candidates.map((candidate) => (
                    <OBStaffCard
                      key={candidate.id}
                      candidate={candidate}
                      onToggleSelected={toggleSelected}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {currentStep === 3 && (
          <div className="mt-4">
            <Step3RoleAssignment
              staff={selectedStaffIds}
              roles={roles}
              skillAssignments={skillAssignments}
              onChange={handleRolesChange}
              onSkillsChange={handleSkillsChange}
            />
          </div>
        )}

        {currentStep === 4 && (
          <div className="mt-4">
            <Step4Permissions
              value={permissions}
              onChange={handlePermissionsChange}
            />
          </div>
        )}

        {currentStep === 5 && (
          <div className="mt-4">
            <Step5FirstProject
              kind={firstProjectKind}
              slug={firstProjectSlug}
              onChange={handleFirstProjectChange}
            />
          </div>
        )}
      </div>

      <div
        data-testid="onboarding-footer"
        className="flex items-center gap-3 border-t border-border-soft bg-panel-bg px-6 py-3"
      >
        <span className="text-xs text-fg-muted">
          {currentStep === 2
            ? detectionEmpty
              ? t('onboarding.empty.title')
              : t('onboarding.footer.constraint', {
                  count: selectedCount,
                  min: MIN_STAFF,
                })
            : currentStep === 3 && step3PendingCount > 0
              ? t('onboarding.footer.step3Pending', {
                  count: step3PendingCount,
                })
              : t(`onboarding.footer.step${currentStep}`, {
                  defaultValue: '',
                })}
        </span>
        <span className="flex-1" />
        {currentStep === 2 && !detectionEmpty && (
          <Button
            type="button"
            tone="ghost"
            size="sm"
            data-testid="onboarding-action-rescan"
            onClick={handleRescan}
          >
            {t('onboarding.actions.rescan')}
          </Button>
        )}
        <Button
          type="button"
          tone="secondary"
          size="sm"
          data-testid="onboarding-action-prev"
          onClick={handlePrev}
        >
          {t('onboarding.actions.prev')}
        </Button>
        <Button
          type="button"
          tone="primary"
          size="sm"
          data-testid="onboarding-action-next"
          aria-disabled={canProceed ? 'false' : 'true'}
          onClick={canProceed ? handleNext : undefined}
          className={clsx(!canProceed && 'opacity-50 cursor-not-allowed')}
        >
          {currentStep < TOTAL_STEPS
            ? t('onboarding.actions.next')
            : t('onboarding.actions.finish')}
        </Button>
      </div>
    </div>
  );
}
