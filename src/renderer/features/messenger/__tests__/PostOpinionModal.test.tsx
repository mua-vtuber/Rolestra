// @vitest-environment jsdom

/**
 * PostOpinionModal 단위 테스트 — R12-C2 P4 T20 일반 채널 의견 게시 모달.
 *
 * 검증:
 *   - open=true 렌더 / open=false 비렌더
 *   - 빈 본문 → submit disabled, content-required 에러는 클릭 시 surface
 *     (UI 가 enable 되는 것은 trim 후 ≥ 1 char 일 때만)
 *   - 정상 입력 + 제출 → invoke 호출 (channel='opinion:postFromGeneral',
 *     authorProviderId=null, parts=[{title, content}]) + onPosted callback
 *   - 제목 빈 문자열 → backend 에 title=null 로 normalize
 *   - 서비스 throw (PostFromGeneralValidationError) → validation 에러 메시지
 *   - 모달이 열릴 때마다 입력 reset (이전 입력값 유출 차단)
 */

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

// ── jsdom polyfills for Radix Dialog ───────────────────────────────
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

import type { Opinion } from '../../../../shared/opinion-types';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

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
import { PostOpinionModal } from '../PostOpinionModal';

function renderWithTheme(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function makeInsertedOpinion(overrides: Partial<Opinion> = {}): Opinion {
  return {
    id: 'op-1',
    parentId: null,
    meetingId: null,
    channelId: 'ch-1',
    kind: 'user-raised',
    authorProviderId: null,
    authorLabel: 'user_1',
    title: '제목',
    content: '본문',
    rationale: null,
    status: 'pending',
    exclusionReason: null,
    round: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeResult = null;
  invokeReject = null;
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('PostOpinionModal — open/close', () => {
  it('open=true 시 dialog 렌더 + 입력 필드 + 버튼', () => {
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    expect(screen.getByTestId('post-opinion-modal')).toBeTruthy();
    expect(screen.getByTestId('post-opinion-title')).toBeTruthy();
    expect(screen.getByTestId('post-opinion-content')).toBeTruthy();
    expect(screen.getByTestId('post-opinion-submit')).toBeTruthy();
  });

  it('open=false 시 dialog 미렌더', () => {
    renderWithTheme(
      <PostOpinionModal
        open={false}
        onOpenChange={() => {}}
        channelId="ch-1"
      />,
    );
    expect(screen.queryByTestId('post-opinion-modal')).toBeNull();
  });

  it('cancel 버튼 → onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <PostOpinionModal
        open
        onOpenChange={onOpenChange}
        channelId="ch-1"
      />,
    );
    fireEvent.click(screen.getByTestId('post-opinion-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('PostOpinionModal — submit gating', () => {
  it('빈 본문 → submit disabled', () => {
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    const submit = screen.getByTestId(
      'post-opinion-submit',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('whitespace-only 본문 → submit disabled', () => {
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    const content = screen.getByTestId('post-opinion-content');
    fireEvent.change(content, { target: { value: '    \t  \n  ' } });
    const submit = screen.getByTestId(
      'post-opinion-submit',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('본문 ≥ 1 char (trim 후) → submit enabled', () => {
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문 있음' },
    });
    const submit = screen.getByTestId(
      'post-opinion-submit',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });
});

describe('PostOpinionModal — submit success', () => {
  it('제목 + 본문 입력 → invoke 호출 + onPosted callback', async () => {
    const inserted = makeInsertedOpinion({ title: '아이디어', content: '본문 텍스트' });
    invokeResult = {
      result: { channelId: 'ch-1', inserted: [inserted] },
    };
    const onOpenChange = vi.fn();
    const onPosted = vi.fn();
    renderWithTheme(
      <PostOpinionModal
        open
        onOpenChange={onOpenChange}
        channelId="ch-1"
        onPosted={onPosted}
      />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-title'), {
      target: { value: '아이디어' },
    });
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문 텍스트' },
    });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));

    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]!.channel).toBe('opinion:postFromGeneral');
    expect(invokeCalls[0]!.data).toEqual({
      channelId: 'ch-1',
      authorProviderId: null,
      parts: [{ title: '아이디어', content: '본문 텍스트' }],
    });
    expect(onPosted).toHaveBeenCalledWith(inserted);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('빈 제목 → backend 에 title=null 로 normalize', async () => {
    invokeResult = {
      result: {
        channelId: 'ch-1',
        inserted: [makeInsertedOpinion()],
      },
    };
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문만 있음' },
    });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));

    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect(invokeCalls[0]!.data).toEqual({
      channelId: 'ch-1',
      authorProviderId: null,
      parts: [{ title: null, content: '본문만 있음' }],
    });
  });

  it('whitespace-only 제목 → backend 에 title=null', async () => {
    invokeResult = {
      result: {
        channelId: 'ch-1',
        inserted: [makeInsertedOpinion()],
      },
    };
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-title'), {
      target: { value: '   ' },
    });
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문' },
    });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));
    await waitFor(() => {
      expect(invokeCalls.length).toBe(1);
    });
    expect((invokeCalls[0]!.data as { parts: { title: unknown }[] }).parts[0]!.title).toBeNull();
  });
});

describe('PostOpinionModal — submit error', () => {
  it('PostFromGeneralValidationError → validation 에러 메시지 surface', async () => {
    const err = new Error('boom');
    err.name = 'PostFromGeneralValidationError';
    invokeReject = err;
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문' },
    });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('post-opinion-error')).toBeTruthy();
    });
    // Korean validation copy.
    expect(screen.getByTestId('post-opinion-error').textContent).toContain(
      '입력',
    );
  });

  it('일반 에러 → generic 에러 메시지 surface', async () => {
    invokeReject = new Error('network down');
    renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '본문' },
    });
    fireEvent.click(screen.getByTestId('post-opinion-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('post-opinion-error')).toBeTruthy();
    });
    expect(screen.getByTestId('post-opinion-error').textContent).toContain(
      '의견',
    );
  });
});

describe('PostOpinionModal — open reset', () => {
  it('모달이 닫혔다 다시 열리면 입력 reset (이전 값 유출 차단)', async () => {
    invokeResult = {
      result: { channelId: 'ch-1', inserted: [makeInsertedOpinion()] },
    };
    const { rerender } = renderWithTheme(
      <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />,
    );
    fireEvent.change(screen.getByTestId('post-opinion-title'), {
      target: { value: '이전 제목' },
    });
    fireEvent.change(screen.getByTestId('post-opinion-content'), {
      target: { value: '이전 본문' },
    });
    rerender(
      <ThemeProvider>
        <PostOpinionModal
          open={false}
          onOpenChange={() => {}}
          channelId="ch-1"
        />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider>
        <PostOpinionModal open onOpenChange={() => {}} channelId="ch-1" />
      </ThemeProvider>,
    );
    await waitFor(() => {
      const title = screen.getByTestId(
        'post-opinion-title',
      ) as HTMLInputElement;
      expect(title.value).toBe('');
    });
    const content = screen.getByTestId(
      'post-opinion-content',
    ) as HTMLTextAreaElement;
    expect(content.value).toBe('');
  });
});

describe('PostOpinionModal — source-level hex color literal guard', () => {
  it('PostOpinionModal.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'PostOpinionModal.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
