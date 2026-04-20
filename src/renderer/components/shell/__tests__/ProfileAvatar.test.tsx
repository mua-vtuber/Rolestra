// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileAvatar } from '..';

afterEach(() => {
  cleanup();
});

const MEMBER = { id: 'm1', name: 'Claude', initials: 'CL' };

describe('ProfileAvatar — shape variants', () => {
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
