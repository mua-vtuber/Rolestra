/**
 * Step3RoleAssignment — R11-Task6 wizard step 3.
 *
 * The user has just selected staff in step 2; here they assign a
 * one-line role label to each picked provider so the meeting
 * orchestrator's persona builder has something concrete to feed into
 * the system prompt. The form intentionally skips the deeper persona
 * fields (`personality` / `expertise`) because the wizard's purpose is
 * "minimum viable office" — Settings → Members hosts the long-form
 * profile editor for everything else.
 *
 * State contract:
 *   - Reads `selections.staff` (array of provider ids) + `selections.roles`
 *     (record id → role label) from the parent.
 *   - Calls `onChange` with the next role record on every input edit so
 *     the parent can debounce IPC patches if it likes (current parent
 *     fires the patch immediately).
 *   - Keeps an empty-string entry for any selected provider that the
 *     user has not yet typed a role for; the parent rejects "Next" if
 *     any role is still empty (the constraint label states this).
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { OnboardingSelections } from '../../../../shared/onboarding-types';

export interface Step3RoleAssignmentProps {
  staff: ReadonlyArray<string>;
  roles: NonNullable<OnboardingSelections['roles']>;
  onChange: (roles: NonNullable<OnboardingSelections['roles']>) => void;
}

/**
 * Hard-coded labels for the 6 wizard candidates so step 3 can show a
 * human-readable display name without round-tripping the registry. Any
 * id outside this map falls back to the raw id (treated as "user added
 * a custom provider through Settings before reaching this step").
 */
const PROVIDER_DISPLAY: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex CLI',
  copilot: 'Copilot CLI',
  local: 'Local (Ollama)',
  grok: 'Grok CLI',
};

export function Step3RoleAssignment({
  staff,
  roles,
  onChange,
}: Step3RoleAssignmentProps): ReactElement {
  const { t } = useTranslation();

  // 한글 IME composition 중에 부모가 IPC 응답으로 setState 하면 controlled
  // input 의 value prop 이 강제 재할당되어 자모 단위로 끊겨 들어가는 race 가
  // 있다. 입력 값은 로컬 draft 가 단일 source of truth 이고, 부모로의 전파
  // (onChange) 는 IPC 트리거 용도로만 쓴다. 부모 state 가 갱신되어도 draft 는
  // 영향받지 않으므로 IME composition 이 깨지지 않는다.
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    ...roles,
  }));

  const handleEdit = (id: string) => (e: ChangeEvent<HTMLInputElement>) => {
    const next = { ...draft, [id]: e.target.value };
    setDraft(next);
    onChange(next);
  };

  return (
    <section
      data-testid="onboarding-step-3"
      className="flex flex-col gap-3"
    >
      <p
        data-testid="onboarding-step-3-description"
        className="text-sm text-fg-muted"
      >
        {t('onboarding.step3.description')}
      </p>

      <ul className="flex flex-col gap-2">
        {staff.map((id) => {
          const value = draft[id] ?? '';
          const displayName = PROVIDER_DISPLAY[id] ?? id;
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
                {displayName}
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
    </section>
  );
}
