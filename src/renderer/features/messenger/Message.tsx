/**
 * Message — 본문(member/user) 메시지 버블 (R5-Task6).
 *
 * prep §2.3.1 3-way 구조 차이를 컴포넌트 내부에서 직접 처리한다
 * (ChannelRow·ProgressGauge 패턴). 색상은 전부 Tailwind theme token 또는
 * CSS variable 경유 — 이 파일에는 hex literal 이 한 번도 등장해서는 안 된다.
 *
 * 테마별 차이 요약:
 * - warm    : `<ProfileAvatar shape='circle'>` + header(name + time + role) + sans content
 * - tactical: `<ProfileAvatar shape='diamond'>` + header(name + time + role) + sans content
 * - retro   : ProfileAvatar 미렌더, mono name prefix (`MONO_NAME_MIN_WIDTH` 고정폭),
 *             header row 없음, mono content
 *
 * `compact=true` 는 연속 메시지 상태: avatar/header 전부 생략하고 content 만 렌더한다.
 * 인덴트 정렬은 상위 레이아웃 (Thread/Task 7+) 에서 처리.
 *
 * 데이터 fetch 는 하지 않는다 — Thread 가 author-join 결과를 `member` prop 으로 주입한다.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { ProfileAvatar, type MemberLike } from '../../components/shell/ProfileAvatar';
import { MemberProfileTrigger } from '../members/MemberProfileTrigger';
import { useTheme } from '../../theme/use-theme';
import type { MemberView } from '../../../shared/member-profile-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';

/**
 * Message 컴포넌트가 렌더에 필요로 하는 최소 author 정보.
 * `ProjectMember` 는 join 전 raw 테이블 row 라 name/avatar 가 없기 때문에,
 * Thread 레벨에서 providers/members 를 join 한 뒤 이 shape 으로 넘긴다.
 */
export interface MessageAuthorInfo extends MemberLike {
  roleAtProject?: string | null;
}

export interface MessageProps {
  message: ChannelMessage;
  /** Header 렌더 + ProfileAvatar 에 전달. null 이면 name fallback=authorId. */
  member: MessageAuthorInfo | null;
  /**
   * Optional full {@link MemberView} for the author (R8-Task7). When
   * provided, the avatar becomes a click target that opens
   * {@link MemberProfileTrigger}'s popover. When omitted (e.g. system
   * messages, deleted authors), the avatar is non-interactive (R5
   * behaviour preserved).
   */
  profile?: MemberView;
  /** 연속 메시지 — avatar 와 header 를 생략한다. */
  compact?: boolean;
  className?: string;
}

/** retro 테마 mono name prefix 의 고정 너비(px). prep §2.3.1 시안. */
const MONO_NAME_MIN_WIDTH = 64;
const AVATAR_SIZE = 32;

function formatTime(ts: number, lang: string): string {
  const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
  try {
    return new Date(ts).toLocaleTimeString(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export function Message({
  message,
  member,
  profile,
  compact = false,
  className,
}: MessageProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { themeKey, token } = useTheme();

  const showHeader = !compact;
  const name = member?.name ?? message.authorId;
  const timeText = formatTime(message.createdAt, i18n.language);

  const commonRootAttrs = {
    'data-testid': 'message',
    'data-theme-variant': themeKey,
    'data-message-id': message.id,
    'data-compact': compact ? 'true' : 'false',
    'data-author-kind': message.authorKind,
  } as const;

  if (themeKey === 'retro') {
    return (
      <div
        {...commonRootAttrs}
        className={clsx(
          'flex items-start gap-2 px-4 py-1 font-mono text-sm text-fg',
          className,
        )}
      >
        {showHeader ? (
          <span
            data-testid="message-name-prefix"
            className="shrink-0 text-brand"
            style={{ minWidth: `${MONO_NAME_MIN_WIDTH}px` }}
          >
            {name}
          </span>
        ) : null}
        <span
          data-testid="message-content"
          className="flex-1 whitespace-pre-wrap break-words"
        >
          {message.content}
        </span>
      </div>
    );
  }

  // Drive avatar shape from the theme token directly (R10 form-level
  // wiring). Retro renders without an avatar above, so the only callers
  // here are warm (circle) and tactical (diamond) — we still go through
  // the token for parity with future theme additions.
  const avatarShape = token.avatarShape === 'status' ? 'circle' : token.avatarShape;

  return (
    <div
      {...commonRootAttrs}
      className={clsx(
        'flex items-start gap-3 px-4 py-1.5 font-sans text-sm text-fg',
        className,
      )}
    >
      {showHeader ? (
        member !== null ? (
          profile ? (
            <MemberProfileTrigger member={profile}>
              <button
                type="button"
                data-testid="message-avatar-trigger"
                aria-label={t('member.profileTrigger.ariaLabel', { name: member.name })}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <ProfileAvatar
                  member={member}
                  profile={profile}
                  size={AVATAR_SIZE}
                  shape={avatarShape}
                />
              </button>
            </MemberProfileTrigger>
          ) : (
            <ProfileAvatar member={member} size={AVATAR_SIZE} shape={avatarShape} />
          )
        ) : (
          <div
            data-testid="message-avatar-placeholder"
            data-shape={avatarShape}
            className={clsx(
              'shrink-0 bg-sunk',
              avatarShape === 'circle' ? 'rounded-full' : 'rounded-sm',
            )}
            style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            aria-hidden="true"
          />
        )
      ) : null}
      <div className="flex-1 min-w-0">
        {showHeader ? (
          <div
            data-testid="message-header"
            className="flex items-baseline gap-2"
          >
            <span
              data-testid="message-name"
              className="font-semibold text-fg"
            >
              {name}
            </span>
            <span
              data-testid="message-time"
              className="text-xs text-fg-muted font-mono"
            >
              {timeText}
            </span>
            {member?.roleAtProject ? (
              <span
                data-testid="message-role"
                className="text-xs text-fg-subtle"
              >
                {member.roleAtProject}
              </span>
            ) : null}
          </div>
        ) : null}
        <p
          data-testid="message-content"
          className="whitespace-pre-wrap break-words text-fg"
        >
          {message.content}
        </p>
      </div>
    </div>
  );
}
