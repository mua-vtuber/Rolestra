/**
 * PeopleWidget — bottom-left of the R4 dashboard 2×2 grid.
 *
 * Renders the member roster from `member:list`: avatar + display name +
 * role + status dot. Status colour maps to the 4 {@link WorkStatus}
 * values via Tailwind tokens (`bg-success` / `bg-warning` /
 * `bg-fg-muted`) — no hex literals.
 *
 * R4: rows are not interactive. R8 wires member-profile navigation via
 * the optional `onRowActivate` prop.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardHeader, CardBody } from '../../../components/primitives';
import { ProfileAvatar } from '../../../components/shell/ProfileAvatar';
import { MemberProfileTrigger } from '../../members/MemberProfileTrigger';
import { useMembers } from '../../../hooks/use-members';
import type {
  MemberView,
  WorkStatus,
} from '../../../../shared/member-profile-types';

export interface PeopleWidgetProps {
  /** Future (R8): invoked when a member row is activated. Defaults to no-op. */
  onRowActivate?: (member: MemberView) => void;
  className?: string;
}

function noop(): void {
  /* intentionally empty — R4 rows are not yet interactive */
}

/**
 * Map a {@link WorkStatus} to a Tailwind bg-token class for the status
 * dot. `connecting` reads as "in transition" so it shares the warning
 * colour; the two offline states read as "unavailable" so they share
 * muted. This mapping is intentionally conservative — the sample
 * mockups leave the exact palette choice to the renderer implementor.
 */
const STATUS_DOT_CLASS: Record<WorkStatus, string> = {
  online: 'bg-success',
  connecting: 'bg-warning',
  'offline-connection': 'bg-fg-muted',
  'offline-manual': 'bg-fg-muted',
};

export function PeopleWidget({
  onRowActivate = noop,
  className,
}: PeopleWidgetProps): ReactElement {
  const { t } = useTranslation();
  const { members, loading, error } = useMembers();

  const body = (() => {
    if (members === null && loading) {
      return (
        <div
          data-testid="people-widget-loading"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.people.loading')}
        </div>
      );
    }
    if (error !== null) {
      const message =
        error.message && error.message.length > 0
          ? error.message
          : t('dashboard.people.error');
      return (
        <div
          role="alert"
          data-testid="people-widget-error"
          className="text-sm text-danger py-2"
        >
          {message}
        </div>
      );
    }
    const list = members ?? [];
    if (list.length === 0) {
      return (
        <div
          data-testid="people-widget-empty"
          className="text-sm text-fg-muted py-2"
        >
          {t('dashboard.people.empty')}
        </div>
      );
    }
    return (
      <ul
        data-testid="people-widget-list"
        className="flex flex-col gap-2"
      >
        {list.map((member) => (
          <li
            key={member.providerId}
            data-testid="people-widget-row"
            data-provider-id={member.providerId}
            data-status={member.workStatus}
            className="flex items-center gap-2"
          >
            <MemberProfileTrigger member={member}>
              <button
                type="button"
                data-testid="people-widget-row-trigger"
                aria-label={`프로필 보기: ${member.displayName}`}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ProfileAvatar
                  member={{
                    id: member.providerId,
                    name: member.displayName,
                  }}
                  profile={member}
                  size={28}
                />
              </button>
            </MemberProfileTrigger>
            <div className="flex-1 min-w-0 flex flex-col">
              <button
                type="button"
                data-testid="people-widget-row-activate"
                onClick={() => onRowActivate(member)}
                className="text-left text-sm font-medium text-fg truncate hover:underline"
              >
                {member.displayName}
              </button>
              {member.role.length > 0 && (
                <span className="text-xs text-fg-muted truncate">
                  {member.role}
                </span>
              )}
            </div>
            <span
              aria-hidden="true"
              data-testid="people-widget-status-dot"
              className={clsx(
                'w-2 h-2 rounded-full shrink-0',
                STATUS_DOT_CLASS[member.workStatus],
              )}
            />
          </li>
        ))}
      </ul>
    );
  })();

  return (
    <Card
      data-testid="people-widget"
      className={clsx('flex flex-col', className)}
    >
      <CardHeader heading={t('dashboard.people.title')} />
      <CardBody className="flex flex-col gap-2">{body}</CardBody>
    </Card>
  );
}
