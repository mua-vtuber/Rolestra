// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileAvatar } from '..';
import type { MemberView } from '../../../../shared/member-profile-types';

afterEach(() => {
  cleanup();
});

const MEMBER = { id: 'm1', name: 'Claude', initials: 'CL' };

describe('ProfileAvatar — legacy R3 path (member only)', () => {
  it.each(['circle', 'diamond', 'status'] as const)('renders shape=%s with data-shape attribute', (shape) => {
    render(<ProfileAvatar member={MEMBER} shape={shape} />);
    const avatar = screen.getByTestId('profile-avatar');
    expect(avatar.getAttribute('data-shape')).toBe(shape);
  });

  it('uses member.initials when avatarUrl missing', () => {
    render(<ProfileAvatar member={MEMBER} />);
    expect(screen.getByText('CL')).toBeTruthy();
  });

  it('renders an <img> when member.avatarUrl is provided', () => {
    render(<ProfileAvatar member={{ ...MEMBER, avatarUrl: 'https://example.com/x.png' }} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/x.png');
  });
});

describe('ProfileAvatar — R8 delegation to Avatar (profile prop)', () => {
  function makeProfile(over: Partial<MemberView> = {}): MemberView {
    return {
      providerId: 'p1',
      role: '',
      personality: '',
      expertise: '',
      avatarKind: 'default',
      avatarData: 'blue-dev',
      statusOverride: null,
      updatedAt: 0,
      displayName: 'Claude',
      persona: '',
      workStatus: 'online',
      ...over,
    };
  }

  it('delegates to <Avatar> and renders DEFAULT_AVATARS emoji branch', () => {
    render(<ProfileAvatar member={MEMBER} profile={makeProfile()} />);
    const root = screen.getByTestId('avatar');
    expect(root.getAttribute('data-avatar-kind')).toBe('default');
    expect(screen.getByTestId('avatar-emoji')).toBeTruthy();
    // legacy data-testid should NOT appear when profile delegation kicks in
    expect(screen.queryByTestId('profile-avatar')).toBeNull();
  });

  it('renders custom branch when profile.avatarKind=custom and customAvatarSrc passed', () => {
    render(
      <ProfileAvatar
        member={MEMBER}
        profile={makeProfile({ avatarKind: 'custom', avatarData: 'avatars/p1.png' })}
        customAvatarSrc="file:///tmp/p1.png"
      />,
    );
    const img = screen.getByTestId('avatar-custom-img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('file:///tmp/p1.png');
  });

  it('falls back to initials from profile.displayName when no avatar resolves', () => {
    render(
      <ProfileAvatar
        member={MEMBER}
        profile={makeProfile({ avatarKind: 'default', avatarData: null })}
      />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('C');
  });
});
