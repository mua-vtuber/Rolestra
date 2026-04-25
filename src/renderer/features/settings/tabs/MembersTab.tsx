/**
 * MembersTab — R10-Task6 roster surface.
 *
 * Lists every registered provider as a member row with display name,
 * persona, work status and the existing R8 `MemberProfileTrigger`
 * (avatar → popover → edit modal). The trigger reuses the dashboard's
 * popover/modal stack so editing logic lives in exactly one place
 * (R8-D5).
 *
 * Bulk-add / bulk-delete (the R8-D8 "full version") is intentionally
 * scoped to the CLI tab (provider:add) and the popover's existing
 * "remove" affordance — adding it twice would create two parallel
 * provider-CRUD surfaces. Members tab is read + per-row edit.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { MemberProfileTrigger } from '../../members/MemberProfileTrigger';
import { Avatar } from '../../../components/members/Avatar';
import { WorkStatusDot } from '../../../components/members/WorkStatusDot';
import { useMembers } from '../../../hooks/use-members';

export function MembersTab(): ReactElement {
  const { t } = useTranslation();
  const { members, loading, error } = useMembers();

  return (
    <section
      data-testid="settings-tab-members"
      className="space-y-3 max-w-2xl"
    >
      <header>
        <h2 className="text-sm font-display font-semibold">
          {t('settings.members.title')}
        </h2>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('settings.members.description')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="settings-members-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {error.message}
        </div>
      )}

      {loading && members === null ? (
        <p
          data-testid="settings-members-loading"
          className="text-sm text-fg-muted italic"
        >
          {t('settings.members.loading')}
        </p>
      ) : members === null || members.length === 0 ? (
        <p
          data-testid="settings-members-empty"
          className="text-sm text-fg-muted italic"
        >
          {t('settings.members.empty')}
        </p>
      ) : (
        <ul
          data-testid="settings-members-list"
          className="space-y-1"
        >
          {members.map((member) => (
            <li
              key={member.providerId}
              data-testid="settings-members-row"
              data-provider-id={member.providerId}
              className="flex items-center gap-3 px-2 py-2 border border-border-soft rounded-panel bg-sunk"
            >
              <MemberProfileTrigger member={member}>
                <button
                  type="button"
                  aria-label={t('settings.members.openProfile', {
                    name: member.displayName,
                  })}
                  className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Avatar
                    providerId={member.providerId}
                    avatarKind={member.avatarKind}
                    avatarData={member.avatarData}
                    displayName={member.displayName}
                    size={32}
                  />
                  <WorkStatusDot
                    status={member.workStatus}
                    className="absolute -bottom-0.5 -right-0.5"
                  />
                </button>
              </MemberProfileTrigger>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {member.displayName}
                </div>
                <div className="text-xs text-fg-muted truncate">
                  {member.role || member.persona || member.providerId}
                </div>
              </div>

              <span
                data-testid="settings-members-status"
                data-status={member.workStatus}
                className="text-xs text-fg-muted font-mono uppercase"
              >
                {t(`settings.members.status.${member.workStatus}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
