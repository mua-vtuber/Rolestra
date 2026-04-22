// @vitest-environment jsdom

/**
 * Avatar — 3 render branches × DEFAULT_AVATARS 8 + custom + initials fallback
 * (R8-Task2). Asserts the data-attributes the surrounding surfaces (Popover /
 * Picker / MemberRow) and Playwright e2e selectors rely on.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Avatar } from '../Avatar';
import { DEFAULT_AVATARS } from '../../../../shared/default-avatars';

afterEach(() => {
  cleanup();
});

describe('Avatar — default-branch render', () => {
  it.each(DEFAULT_AVATARS.map((a) => a.key))(
    'renders the catalogue entry for key=%s with emoji + color',
    (key) => {
      const entry = DEFAULT_AVATARS.find((a) => a.key === key)!;
      render(
        <Avatar
          providerId="p1"
          displayName="Claude"
          avatarKind="default"
          avatarData={key}
        />,
      );
      const root = screen.getByTestId('avatar');
      expect(root.getAttribute('data-avatar-kind')).toBe('default');
      const emojiNode = screen.getByTestId('avatar-emoji');
      expect(emojiNode.textContent).toContain(entry.emoji);
      // background colour should be the catalogue colour
      expect((emojiNode as HTMLElement).style.backgroundColor.length).toBeGreaterThan(0);
    },
  );

  it('exposes data-shape so Picker grid can pin a circle even under a diamond theme', () => {
    render(
      <Avatar
        providerId="p1"
        avatarKind="default"
        avatarData="blue-dev"
        shape="diamond"
      />,
    );
    expect(screen.getByTestId('avatar').getAttribute('data-shape')).toBe(
      'diamond',
    );
  });
});

describe('Avatar — custom-branch render', () => {
  it('renders an <img> when avatarKind=custom and resolvedSrc is provided', () => {
    render(
      <Avatar
        providerId="p1"
        displayName="Claude"
        avatarKind="custom"
        avatarData="avatars/p1.png"
        resolvedSrc="file:///tmp/arena/avatars/p1.png"
      />,
    );
    const img = screen.getByTestId('avatar-custom-img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('file:///tmp/arena/avatars/p1.png');
    expect(img.getAttribute('alt')).toBe('Claude');
    expect(screen.getByTestId('avatar').getAttribute('data-avatar-kind')).toBe(
      'custom',
    );
  });

  it('falls back to initials when avatarKind=custom but resolvedSrc is missing', () => {
    render(
      <Avatar
        providerId="p1"
        displayName="Claude"
        avatarKind="custom"
        avatarData="avatars/p1.png"
      />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('C');
    expect(screen.getByTestId('avatar').getAttribute('data-avatar-kind')).toBe(
      'initials',
    );
  });
});

describe('Avatar — initials fallback', () => {
  it('renders the first character of displayName uppercase', () => {
    render(
      <Avatar
        providerId="p1"
        displayName="codex"
        avatarKind="default"
        avatarData={null}
      />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('C');
  });

  it('falls back to providerId initial when displayName missing', () => {
    render(
      <Avatar
        providerId="zeta"
        avatarKind="default"
        avatarData={null}
      />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('Z');
  });

  it('shows ? when neither displayName nor providerId yields a character', () => {
    render(
      <Avatar providerId="" displayName="" avatarKind="default" avatarData={null} />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('?');
  });

  it('falls back when default key is unknown (defensive — catalogue rename)', () => {
    render(
      <Avatar
        providerId="p1"
        displayName="X"
        avatarKind="default"
        avatarData="non-existent-key"
      />,
    );
    expect(screen.getByTestId('avatar-initials').textContent).toBe('X');
    expect(screen.getByTestId('avatar').getAttribute('data-avatar-kind')).toBe(
      'initials',
    );
  });
});
