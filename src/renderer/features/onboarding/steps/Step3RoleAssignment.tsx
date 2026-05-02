/**
 * Step3RoleAssignment — R11-Task6 wizard step 3 + R12-C round 2 능력 배정.
 *
 * 두 영역을 한 step 안에 둔다:
 *   1. 역할 칭호 입력 (직원별 한 줄 — 메신저 persona 라벨)
 *   2. 능력 배정 매트릭스 — 9 능력 (idea / planning / design.ui /
 *      design.ux / design.character / design.background / implement /
 *      review / general) × 직원 다중 체크박스. 사용자 결정으로 디폴트는
 *      `general` 만 모든 직원 ON, 나머지 8 능력은 모두 OFF. 사용자가
 *      직원에게 능력을 직접 부여한 뒤에야 step 3 → 4 로 진행 가능
 *      (검증: 9 능력 전부 ≥ 1명).
 *
 * State contract:
 *   - 부모 (OnboardingPage) 가 staff (selected provider ids) + roles
 *     (id → role label) + skillAssignments (id → RoleId[]) 셋을 prop 으로
 *     전달, 각 변경마다 onChange 콜백.
 *   - 디폴트 skillAssignments 채우기는 부모가 책임진다 (staff 변경 시점에).
 *     본 컴포넌트는 받은 값을 그대로 표시 + 토글.
 *   - 빈 role label 은 부모의 canProceed 가 차단. 능력 미달 안내는 본 컴포넌트
 *     하단에 표시한다.
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ALL_ROLE_IDS } from '../../../../shared/role-types';
import type { RoleId } from '../../../../shared/role-types';
import { getSkillTemplate } from '../../../../shared/skill-catalog';
import type { OnboardingSelections } from '../../../../shared/onboarding-types';

export interface Step3RoleAssignmentProps {
  staff: ReadonlyArray<string>;
  roles: NonNullable<OnboardingSelections['roles']>;
  skillAssignments: NonNullable<OnboardingSelections['skillAssignments']>;
  onChange: (roles: NonNullable<OnboardingSelections['roles']>) => void;
  onSkillsChange: (
    next: NonNullable<OnboardingSelections['skillAssignments']>,
  ) => void;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  copilot: 'Copilot CLI',
  local: 'Local (Ollama)',
  grok: 'Grok CLI',
};

const ROLE_ICON: Record<RoleId, string> = {
  idea: '💡',
  planning: '📋',
  'design.ui': '🎨',
  'design.ux': '🎨',
  'design.character': '🧝',
  'design.background': '🏞️',
  implement: '🔧',
  review: '✅',
  general: '💬',
};

function displayProviderName(id: string): string {
  return PROVIDER_DISPLAY[id] ?? id;
}

function countAssignees(
  skillAssignments: NonNullable<OnboardingSelections['skillAssignments']>,
  staff: ReadonlyArray<string>,
  role: RoleId,
): number {
  let count = 0;
  for (const id of staff) {
    const list = skillAssignments[id];
    if (Array.isArray(list) && list.includes(role)) count += 1;
  }
  return count;
}

function toggleRoleAssignment(
  skillAssignments: NonNullable<OnboardingSelections['skillAssignments']>,
  providerId: string,
  role: RoleId,
): NonNullable<OnboardingSelections['skillAssignments']> {
  const current = skillAssignments[providerId] ?? [];
  const next = current.includes(role)
    ? current.filter((r) => r !== role)
    : [...current, role];
  return { ...skillAssignments, [providerId]: next };
}

export function Step3RoleAssignment({
  staff,
  roles,
  skillAssignments,
  onChange,
  onSkillsChange,
}: Step3RoleAssignmentProps): ReactElement {
  const { t } = useTranslation();

  // 한글 IME composition guard — 부모로의 role label 전파는 IPC trigger 용도,
  // 로컬 draft 가 single source of truth.
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...roles,
  }));

  const handleEdit = (id: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const next = { ...draft, [id]: e.target.value };
    setDraft(next);
    onChange(next);
  };

  const handleToggleSkill = (providerId: string, role: RoleId) => (): void => {
    const next = toggleRoleAssignment(skillAssignments, providerId, role);
    onSkillsChange(next);
  };

  const missingRoles = ALL_ROLE_IDS.filter(
    (role) => countAssignees(skillAssignments, staff, role) === 0,
  );

  return (
    <section
      data-testid="onboarding-step-3"
      className="flex flex-col gap-4"
    >
      {/*
        R12-C round 2: 상단 OnboardingPage description 과 중복 안내가 두
        번 노출되던 회귀 (사용자 보고). step 본문은 역할 칭호 영역부터
        곧장 시작한다.
      */}

      {/* 역할 칭호 영역 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">
          {t('onboarding.step3.rolesHeader', { defaultValue: '역할 칭호' })}
        </h3>
        <ul className="flex flex-col gap-2">
          {staff.map((id) => {
            const value = draft[id] ?? '';
            return (
              <li
                key={id}
                data-testid="onboarding-step-3-row"
                data-provider-id={id}
                className="grid grid-cols-[160px_1fr] items-center gap-3 rounded-panel border border-border-soft bg-panel-bg px-3 py-2"
              >
                <label
                  htmlFor={`onboarding-role-${id}`}
                  className="text-sm font-medium text-fg"
                >
                  {displayProviderName(id)}
                </label>
                <input
                  id={`onboarding-role-${id}`}
                  data-testid="onboarding-step-3-input"
                  data-provider-id={id}
                  type="text"
                  value={value}
                  onChange={handleEdit(id)}
                  placeholder={t('onboarding.step3.placeholder')}
                  maxLength={120}
                  className="w-full rounded-panel border border-border-soft bg-canvas px-2 py-1 text-sm text-fg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </li>
            );
          })}
        </ul>
      </div>

      {/* 능력 배정 매트릭스 — R12-C round 2 */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">
          {t('onboarding.step3.skillsHeader', {
            defaultValue: '능력 배정 (능력별 1명 이상 필수)',
          })}
        </h3>
        <p className="text-xs text-fg-muted">
          {t('onboarding.step3.skillsHint', {
            defaultValue:
              '각 능력에 최소 1명을 배정해야 합니다. 한 직원이 여러 능력을 가질 수 있습니다. 디폴트는 일반 능력만 ON.',
          })}
        </p>
        <div
          data-testid="onboarding-step-3-skills-matrix"
          className="rounded-panel border border-border-soft bg-panel-bg p-2"
        >
          <ul className="flex flex-col gap-1">
            {ALL_ROLE_IDS.map((role) => {
              const labelKo = getSkillTemplate(role).label.ko;
              const icon = ROLE_ICON[role];
              const assigned = countAssignees(skillAssignments, staff, role);
              const missing = assigned === 0;
              return (
                <li
                  key={role}
                  data-testid={`onboarding-step-3-skill-row-${role}`}
                  data-missing={missing ? 'true' : 'false'}
                  className="flex flex-wrap items-center gap-2 rounded-panel px-2 py-1.5 hover:bg-canvas/40"
                >
                  <div className="flex w-44 items-center gap-1.5 text-sm">
                    <span aria-hidden="true">{icon}</span>
                    <span className="font-medium">{labelKo}</span>
                    <span
                      data-testid={`onboarding-step-3-skill-count-${role}`}
                      className={
                        missing ? 'text-xs text-danger' : 'text-xs text-fg-muted'
                      }
                    >
                      ({assigned})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {staff.map((providerId) => {
                      const checked = (
                        skillAssignments[providerId] ?? []
                      ).includes(role);
                      return (
                        <label
                          key={providerId}
                          data-testid={`onboarding-step-3-skill-checkbox-${role}-${providerId}`}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-soft bg-canvas px-2 py-0.5 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={handleToggleSkill(providerId, role)}
                            className="size-3"
                          />
                          <span>{displayProviderName(providerId)}</span>
                        </label>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {missingRoles.length > 0 ? (
          <p
            data-testid="onboarding-step-3-skills-missing"
            role="alert"
            className="text-xs text-danger"
          >
            {t('onboarding.step3.skillsMissing', {
              defaultValue: '능력 미배정: {{labels}} (각 1명 이상 필요)',
              labels: missingRoles
                .map((r) => getSkillTemplate(r).label.ko)
                .join(', '),
            })}
          </p>
        ) : null}
      </div>
    </section>
  );
}
