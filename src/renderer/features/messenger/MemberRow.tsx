/**
 * MemberRow — 우측 MemberPanel 참여자 섹션의 단일 행 (R5-Task9).
 *
 * themeKey 3-way:
 * - warm    : `<ProfileAvatar shape='circle' size=28>` + 이름 + 역할(cli)
 * - tactical: `<ProfileAvatar shape='diamond' size=28>` + 이름 + 역할(cli)
 * - retro   : 8px status-dot only + mono 이름 + mono 역할(cli)
 *
 * 상태 점(status dot) 색상은 PeopleWidget 과 동일한 4-way token 매핑.
 * R5 범위에선 정보성(non-interactive). R8+ 에서 프로필 drill-in.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import { ProfileAvatar } from '../../components/shell/ProfileAvatar';
import { MemberProfileTrigger } from '../members/MemberProfileTrigger';
import { useTheme } from '../../theme/use-theme';
import type { MemberView, WorkStatus } from '../../../shared/member-profile-types';

const STATUS_DOT_CLASS: Record<WorkStatus, string> = {
  online: 'bg-success',
  connecting: 'bg-warning',
  'offline-connection': 'bg-fg-muted',
  'offline-manual': 'bg-fg-muted',
};

export interface MemberRowProps {
  member: MemberView;
  className?: string;
}

export function MemberRow({ member, className }: MemberRowProps): ReactElement {
  const { themeKey, token } = useTheme();
  const statusClass = STATUS_DOT_CLASS[member.workStatus];
  const fontClass = themeKey === 'retro' ? 'font-mono' : 'font-sans';

  // R10 form-level wiring: drive avatar shape from token. retro theme has
  // avatarShape='status' but renders dot-only above, so fallback to circle
  // for the warm/tactical avatar branch keeps the contract intact.
  const avatarShape = token.avatarShape === 'status' ? 'circle' : token.avatarShape;

  return (
    <li
      data-testid="member-row"
      data-theme-variant={themeKey}
      data-provider-id={member.providerId}
      data-status={member.workStatus}
      className={clsx('flex items-center gap-2', className)}
    >
      {themeKey === 'retro' ? (
        <MemberProfileTrigger member={member}>
          <button
            type="button"
            data-testid="member-row-trigger"
            aria-label={`프로필 보기: ${member.displayName}`}
            className="shrink-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span
              data-testid="member-row-status-dot"
              aria-hidden="true"
              className={clsx('h-2 w-2 block rounded-full', statusClass)}
            />
          </button>
        </MemberProfileTrigger>
      ) : (
        <MemberProfileTrigger member={member}>
          <button
            type="button"
            data-testid="member-row-trigger"
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
              shape={avatarShape}
            />
          </button>
        </MemberProfileTrigger>
      )}
      <div className={clsx('flex min-w-0 flex-1 flex-col', fontClass)}>
        <span
          data-testid="member-row-name"
          className="truncate text-sm font-medium text-fg"
        >
          {member.displayName}
        </span>
        {member.role.length > 0 && (
          <span
            data-testid="member-row-role"
            className="truncate text-xs text-fg-muted"
          >
            {member.role}
          </span>
        )}
      </div>
      {themeKey !== 'retro' && (
        <span
          data-testid="member-row-status-dot"
          aria-hidden="true"
          className={clsx('h-2 w-2 shrink-0 rounded-full', statusClass)}
        />
      )}
    </li>
  );
}
