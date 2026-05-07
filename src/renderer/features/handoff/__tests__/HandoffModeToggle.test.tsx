// @vitest-environment jsdom
/**
 * HandoffModeToggle 단위 테스트 — R12-C2 P6 T28 land.
 *
 * 검증:
 *   - 'check' active 상태 — aria-pressed 확인
 *   - 'auto' 클릭 → invoke('channel:update-handoff-mode', ...) 호출 + onUpdated
 *   - 같은 모드 클릭 → invoke 호출 X (no-op)
 *   - invoke throw → error 메시지 inline 표시
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { HandoffModeToggle } from '../HandoffModeToggle';
import type { Channel } from '../../../../shared/channel-types';

vi.mock('../../../ipc/invoke', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '../../../ipc/invoke';

const baseChannel: Channel = {
  id: 'ch-1',
  projectId: 'p-1',
  name: '기획',
  kind: 'user',
  readOnly: false,
  createdAt: 0,
  role: 'planning',
  purpose: null,
  handoffMode: 'check',
  maxRounds: null,
};

afterEach(() => {
  cleanup();
});

beforeEach(async () => {
  vi.clearAllMocks();
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'ko',
      resources: {
        ko: {
          translation: {
            messenger: {
              handoff: {
                toggle: {
                  label: '인계 모드',
                  check: '확인 (사용자 결재)',
                  auto: '자동 (Notification 만)',
                  error: '변경 실패: {{error}}',
                },
              },
            },
          },
        },
      },
    });
  }
});

function renderToggle(props: Parameters<typeof HandoffModeToggle>[0]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <HandoffModeToggle {...props} />
    </I18nextProvider>,
  );
}

describe('HandoffModeToggle', () => {
  it("'check' active — aria-pressed 정확", () => {
    renderToggle({ channel: baseChannel });
    const checkBtn = screen.getByTestId('handoff-mode-check');
    const autoBtn = screen.getByTestId('handoff-mode-auto');
    expect(checkBtn.getAttribute('aria-pressed')).toBe('true');
    expect(autoBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it("'auto' 클릭 → invoke + onUpdated", async () => {
    const onUpdated = vi.fn();
    const updated: Channel = { ...baseChannel, handoffMode: 'auto' };
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      channel: updated,
    });
    renderToggle({ channel: baseChannel, onUpdated });
    fireEvent.click(screen.getByTestId('handoff-mode-auto'));
    // microtask flush
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).toHaveBeenCalledWith('channel:update-handoff-mode', {
      id: 'ch-1',
      handoffMode: 'auto',
    });
    expect(onUpdated).toHaveBeenCalledWith(updated);
  });

  it("같은 모드 클릭 → invoke 호출 X", () => {
    renderToggle({ channel: baseChannel });
    fireEvent.click(screen.getByTestId('handoff-mode-check'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('invoke throw → error inline 표시', async () => {
    (invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('IPC down'),
    );
    renderToggle({ channel: baseChannel });
    fireEvent.click(screen.getByTestId('handoff-mode-auto'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByText(/변경 실패/)).toBeTruthy();
  });
});
