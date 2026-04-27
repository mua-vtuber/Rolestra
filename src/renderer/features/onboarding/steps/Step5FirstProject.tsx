/**
 * Step5FirstProject — R11-Task6 wizard step 5.
 *
 * Captures the kind + slug for the user's first project so the wizard
 * can drop them straight into a usable project on completion. The
 * wizard does NOT call `project:create` here — Step 5's "Finish" button
 * is the place where ProjectService takes over (App.tsx wires the
 * call after `onboarding:complete` resolves). Step 5 is purely the
 * data-collection surface.
 *
 * Constraints:
 *   - kind: `new` | `external` | `imported`. The wizard pre-selects
 *     `new` because it is the only kind that does NOT require an
 *     existing folder picker prompt — the post-onboarding ProjectCreateModal
 *     is the place to drive `external` / `imported` flows so the wizard
 *     can stay declarative.
 *   - slug: 1..200 chars. The actual normalization happens in the
 *     project-service slug regex; the wizard mirrors a permissive
 *     validation (non-empty + no whitespace) so the user can preview
 *     the project URL ("projects/<slug>/") inline.
 */
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProjectKind } from '../../../../shared/project-types';

export interface Step5FirstProjectProps {
  kind: ProjectKind;
  slug: string;
  onChange: (next: { kind: ProjectKind; slug: string }) => void;
}

const KINDS: ReadonlyArray<ProjectKind> = ['new', 'external', 'imported'];

export function Step5FirstProject({
  kind,
  slug,
  onChange,
}: Step5FirstProjectProps): ReactElement {
  const { t } = useTranslation();

  // 한글 IME composition 중 부모가 IPC 응답으로 setState 하면 controlled
  // input 의 value prop 이 강제 재할당되어 자모 단위로 끊겨 들어가는 race 가
  // 있다. slug 입력 값은 로컬 draft 가 단일 source of truth 이고, 부모로의
  // 전파 (onChange) 는 IPC 트리거 + canProceed gate 동기화 용도로만 쓴다.
  const [slugDraft, setSlugDraft] = useState<string>(() => slug);

  const handleKind = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = e.target.value as ProjectKind;
    if (KINDS.includes(next)) onChange({ kind: next, slug: slugDraft });
  };

  const handleSlug = (e: ChangeEvent<HTMLInputElement>): void => {
    const nextSlug = e.target.value;
    setSlugDraft(nextSlug);
    onChange({ kind, slug: nextSlug });
  };

  return (
    <section
      data-testid="onboarding-step-5"
      className="flex flex-col gap-4"
    >
      <p
        data-testid="onboarding-step-5-description"
        className="text-sm text-fg-muted"
      >
        {t('onboarding.step5.description')}
      </p>

      <fieldset
        data-testid="onboarding-step-5-kinds"
        className="flex flex-col gap-2"
      >
        <legend className="text-sm font-medium text-fg">
          {t('onboarding.step5.kindLabel')}
        </legend>
        {KINDS.map((option) => {
          const checked = kind === option;
          return (
            <label
              key={option}
              data-testid="onboarding-step-5-kind-option"
              data-kind={option}
              data-selected={checked ? 'true' : 'false'}
              className={`flex cursor-pointer items-start gap-3 rounded-panel border bg-panel-bg px-3 py-2 ${
                checked
                  ? 'border-brand ring-1 ring-brand'
                  : 'border-border-soft'
              }`}
            >
              <input
                type="radio"
                name="onboarding-first-project-kind"
                value={option}
                checked={checked}
                onChange={handleKind}
                className="mt-1 accent-brand"
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-fg">
                  {t(`onboarding.step5.kinds.${option}.label`)}
                </span>
                <span className="text-xs text-fg-muted">
                  {t(`onboarding.step5.kinds.${option}.description`)}
                </span>
              </div>
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="onboarding-step-5-slug"
          className="text-sm font-medium text-fg"
        >
          {t('onboarding.step5.slugLabel')}
        </label>
        <input
          id="onboarding-step-5-slug"
          data-testid="onboarding-step-5-slug"
          type="text"
          value={slugDraft}
          onChange={handleSlug}
          placeholder={t('onboarding.step5.slugPlaceholder')}
          maxLength={200}
          className="w-full rounded-panel border border-border-soft bg-canvas px-2 py-1 text-sm text-fg focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
        <p className="text-xs text-fg-muted">
          {t('onboarding.step5.slugHint', { slug: slugDraft || '<slug>' })}
        </p>
      </div>
    </section>
  );
}
