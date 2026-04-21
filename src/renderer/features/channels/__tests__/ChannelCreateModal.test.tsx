// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── jsdom polyfills for Radix ───────────────────────────────────────
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {
      /* noop */
    }
    unobserve(): void {
      /* noop */
    }
    disconnect(): void {
      /* noop */
    }
  };
}
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    releasePointerCapture?: (id: number) => void;
    setPointerCapture?: (id: number) => void;
    scrollIntoView?: () => void;
  };
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
  if (!proto.setPointerCapture) proto.setPointerCapture = () => {};
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
}

import type { Channel } from '../../../../shared/channel-types';
import type { MemberView } from '../../../../shared/member-profile-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

// ── hook mocks ──────────────────────────────────────────────────────
let membersResult: {
  members: MemberView[] | null;
  loading: boolean;
  error: Error | null;
} = { members: [], loading: false, error: null };

vi.mock('../../../hooks/use-members', () => ({
  useMembers: () => ({
    ...membersResult,
    refresh: async () => {},
  }),
}));

// ── invoke mock ─────────────────────────────────────────────────────
interface InvokeCall {
  channel: string;
  data: unknown;
}
const invokeCalls: InvokeCall[] = [];
let invokeResult: unknown = null;
let invokeReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (invokeReject) throw invokeReject;
    return invokeResult;
  },
}));

// Import after mocks.
import { ChannelCreateModal } from '../ChannelCreateModal';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const SAMPLE_CHANNEL: Channel = {
  id: 'ch-1',
  projectId: 'p-1',
  name: '기획팀',
  kind: 'user',
  readOnly: false,
  createdAt: 1_700_000_000_000,
};

const MEMBER_A: MemberView = {
  providerId: 'prov-a',
  displayName: 'Alice',
  persona: '',
  role: '',
  personality: '',
  expertise: '',
  avatarKind: 'default',
  avatarData: null,
  statusOverride: null,
  updatedAt: 1_700_000_000_000,
  workStatus: 'online',
};
const MEMBER_B: MemberView = {
  ...MEMBER_A,
  providerId: 'prov-b',
  displayName: 'Bob',
};

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResult = null;
  invokeReject = null;
  membersResult = { members: [], loading: false, error: null };
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ChannelCreateModal — open/close', () => {
  it('renders the dialog when open=true', () => {
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    expect(screen.getByTestId('channel-create-modal')).toBeTruthy();
    expect(screen.getByTestId('channel-create-name')).toBeTruthy();
    expect(screen.getByTestId('channel-create-submit')).toBeTruthy();
  });

  it('does not render when open=false', () => {
    renderWithTheme(
      <ChannelCreateModal open={false} onOpenChange={() => {}} projectId="p-1" />,
    );
    expect(screen.queryByTestId('channel-create-modal')).toBeNull();
  });

  it('ESC closes (onOpenChange called with false)', async () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={onOpenChange} projectId="p-1" />,
    );
    fireEvent.keyDown(screen.getByTestId('channel-create-modal'), {
      key: 'Escape',
      code: 'Escape',
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('cancel button closes', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={onOpenChange} projectId="p-1" />,
    );
    fireEvent.click(screen.getByTestId('channel-create-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ChannelCreateModal — inline validation', () => {
  it('empty name → nameRequired', () => {
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    fireEvent.click(screen.getByTestId('channel-create-submit'));
    expect(screen.getByTestId('channel-create-error').textContent).toContain(
      '채널 이름을 입력하세요',
    );
  });

  it('name shorter than 3 chars → nameTooShort', () => {
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: 'ab' },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));
    expect(screen.getByTestId('channel-create-error').textContent).toContain(
      '3자 이상',
    );
  });

  it('name longer than 50 chars → nameTooLong', () => {
    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: 'a'.repeat(51) },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));
    expect(screen.getByTestId('channel-create-error').textContent).toContain(
      '50자 이하',
    );
  });
});

describe('ChannelCreateModal — success path', () => {
  it('calls channel:create with projectId + name + members and calls onCreated', async () => {
    membersResult = {
      members: [MEMBER_A, MEMBER_B],
      loading: false,
      error: null,
    };
    invokeResult = { channel: SAMPLE_CHANNEL };
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();

    renderWithTheme(
      <ChannelCreateModal
        open
        onOpenChange={onOpenChange}
        projectId="p-1"
        onCreated={onCreated}
      />,
    );

    // wait for member prefill to land.
    await waitFor(() => {
      expect(
        screen
          .getByTestId('channel-create-member-option-prov-a')
          .getAttribute('data-checked'),
      ).toBe('true');
    });

    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: '기획팀' },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith(SAMPLE_CHANNEL);
    });
    expect(invokeCalls).toEqual([
      {
        channel: 'channel:create',
        data: {
          projectId: 'p-1',
          name: '기획팀',
          kind: 'user',
          memberProviderIds: ['prov-a', 'prov-b'],
        },
      },
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('user un-checking a prefilled member removes it from the payload', async () => {
    membersResult = {
      members: [MEMBER_A, MEMBER_B],
      loading: false,
      error: null,
    };
    invokeResult = { channel: SAMPLE_CHANNEL };

    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByTestId('channel-create-member-option-prov-a')
          .getAttribute('data-checked'),
      ).toBe('true');
    });

    // Uncheck Bob.
    fireEvent.click(
      screen
        .getByTestId('channel-create-member-option-prov-b')
        .querySelector('input') as HTMLInputElement,
    );

    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: '팀룸A' },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));

    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(
      (invokeCalls[0].data as { memberProviderIds: string[] }).memberProviderIds,
    ).toEqual(['prov-a']);
  });
});

describe('ChannelCreateModal — server errors', () => {
  it('DuplicateChannelNameError → duplicateName inline message', async () => {
    membersResult = { members: [], loading: false, error: null };
    const err = new Error('dup');
    err.name = 'DuplicateChannelNameError';
    invokeReject = err;

    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: '기획팀' },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-create-error').textContent).toContain(
        '이미 있습니다',
      );
    });
  });

  it('generic error → generic inline message', async () => {
    membersResult = { members: [], loading: false, error: null };
    invokeReject = new Error('boom');

    renderWithTheme(
      <ChannelCreateModal open onOpenChange={() => {}} projectId="p-1" />,
    );
    fireEvent.change(screen.getByTestId('channel-create-name'), {
      target: { value: '기획팀' },
    });
    fireEvent.click(screen.getByTestId('channel-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('channel-create-error').textContent).toContain(
        '오류',
      );
    });
  });
});

describe('ChannelCreateModal — hardcoded color guard', () => {
  it('ChannelCreateModal.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ChannelCreateModal.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
