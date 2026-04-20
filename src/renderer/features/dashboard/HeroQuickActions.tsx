/**
 * HeroQuickActions — two side-by-side action buttons for the Dashboard Hero.
 *
 * - "+ 새 프로젝트" : always enabled. Delegates to `onNewProject`.
 * - "회의 소집 →"   : requires `hasActiveProject=true`. When disabled, the
 *                     button announces `aria-disabled="true"`, surfaces a
 *                     tooltip hint ("먼저 프로젝트를 선택하세요"), and
 *                     does **not** invoke `onStartMeeting`. This is the
 *                     R4 contract — R6 will wire the actual meeting flow.
 *
 * Note — we do NOT use the HTML `disabled` attribute on the meeting button.
 * `disabled` removes the element from the tab order and blocks pointer
 * events, which in turn prevents the tooltip trigger from firing. The
 * `aria-disabled` pattern preserves keyboard focus + hover affordance
 * while still blocking activation inside `handleStartMeeting`.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { Tooltip } from '../../components/primitives/tooltip';

export interface HeroQuickActionsProps {
  onNewProject: () => void;
  onStartMeeting: () => void;
  /** When false, the meeting button is aria-disabled + tooltip-hinted. */
  hasActiveProject: boolean;
  className?: string;
}

export function HeroQuickActions({
  onNewProject,
  onStartMeeting,
  hasActiveProject,
  className,
}: HeroQuickActionsProps): ReactElement {
  const { t } = useTranslation();
  const meetingDisabled = !hasActiveProject;

  const handleStartMeeting = (): void => {
    if (meetingDisabled) return;
    onStartMeeting();
  };

  const meetingButton = (
    <Button
      type="button"
      tone="secondary"
      data-testid="hero-quick-action-meeting"
      aria-disabled={meetingDisabled ? 'true' : 'false'}
      className={clsx(meetingDisabled && 'opacity-50 cursor-not-allowed')}
      onClick={handleStartMeeting}
    >
      {t('dashboard.action.startMeeting')}
    </Button>
  );

  return (
    <div
      data-testid="hero-quick-actions"
      className={clsx('flex items-center gap-2', className)}
    >
      <Button
        type="button"
        tone="primary"
        data-testid="hero-quick-action-new-project"
        onClick={onNewProject}
      >
        {t('dashboard.action.newProject')}
      </Button>
      {meetingDisabled ? (
        <Tooltip content={t('dashboard.action.startMeetingDisabled')}>
          {meetingButton}
        </Tooltip>
      ) : (
        meetingButton
      )}
    </div>
  );
}
