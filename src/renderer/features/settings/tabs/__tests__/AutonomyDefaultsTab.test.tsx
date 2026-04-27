// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import '../../../../i18n';
import { AutonomyDefaultsTab } from '../AutonomyDefaultsTab';
import { DEFAULT_SETTINGS } from '../../../../../shared/config-types';
import type { LlmCostSummary } from '../../../../../shared/llm-cost-types';

interface InvokeRecord {
  channel: string;
  data: unknown;
}

function installArena(
  responses: Partial<Record<string, (data: unknown) => unknown>>,
): { invoke: ReturnType<typeof vi.fn>; calls: InvokeRecord[] } {
  const calls: InvokeRecord[] = [];
  const invoke = vi.fn((channel: string, data: unknown) => {
    calls.push({ channel, data });
    const handler = responses[channel];
    if (!handler) {
      return Promise.reject(new Error(`unmocked channel: ${channel}`));
    }
    return Promise.resolve(handler(data));
  });
  vi.stubGlobal('arena', { platform: 'linux', invoke });
  return { invoke, calls };
}

const SAMPLE_SUMMARY: LlmCostSummary = {
  byProvider: [
    {
      providerId: 'claude',
      tokenIn: 12_000,
      tokenOut: 3_000,
      estimatedUsd: 0.045,
    },
    {
      providerId: 'gpt-5',
      tokenIn: 1_000,
      tokenOut: 200,
      estimatedUsd: null,
    },
  ],
  totalTokens: 16_200,
  periodStartAt: 0,
  periodEndAt: 1_000,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AutonomyDefaultsTab — LLM cost section (R11-Task8)', () => {
  it('renders rows for every provider returned by llm:cost-summary', async () => {
    installArena({
      'config:get-settings': () =>
        Promise.resolve({ settings: { ...DEFAULT_SETTINGS } }),
      'llm:cost-summary': () => Promise.resolve({ summary: SAMPLE_SUMMARY }),
    });
    render(<AutonomyDefaultsTab />);
    const claudeRow = await screen.findByTestId(
      'settings-autonomy-llm-cost-row-claude',
    );
    expect(claudeRow.textContent).toContain('claude');
    expect(claudeRow.textContent).toContain('12,000');
    expect(claudeRow.textContent).toContain('3,000');
    expect(claudeRow.textContent).toContain('15,000');
    const gptRow = screen.getByTestId(
      'settings-autonomy-llm-cost-row-gpt-5',
    );
    expect(gptRow).toBeTruthy();
  });

  it('renders the "단가 미설정" placeholder for null estimatedUsd', async () => {
    installArena({
      'config:get-settings': () =>
        Promise.resolve({ settings: { ...DEFAULT_SETTINGS } }),
      'llm:cost-summary': () => Promise.resolve({ summary: SAMPLE_SUMMARY }),
    });
    render(<AutonomyDefaultsTab />);
    const gptRow = await screen.findByTestId(
      'settings-autonomy-llm-cost-row-gpt-5',
    );
    expect(gptRow.textContent).toMatch(/단가 미설정|Unit price/);
  });

  it('shows the empty state when summary.byProvider is empty', async () => {
    installArena({
      'config:get-settings': () =>
        Promise.resolve({ settings: { ...DEFAULT_SETTINGS } }),
      'llm:cost-summary': () =>
        Promise.resolve({
          summary: {
            byProvider: [],
            totalTokens: 0,
            periodStartAt: 0,
            periodEndAt: 0,
          } satisfies LlmCostSummary,
        }),
    });
    render(<AutonomyDefaultsTab />);
    expect(
      await screen.findByTestId('settings-autonomy-llm-cost-empty'),
    ).toBeTruthy();
  });

  it('surfaces the error block (not empty) when llm:cost-summary rejects', async () => {
    installArena({
      'config:get-settings': () =>
        Promise.resolve({ settings: { ...DEFAULT_SETTINGS } }),
      'llm:cost-summary': () =>
        Promise.reject(new Error('cost-summary down')),
    });
    render(<AutonomyDefaultsTab />);
    expect(
      await screen.findByTestId('settings-autonomy-llm-cost-error'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('settings-autonomy-llm-cost-empty'),
    ).toBeNull();
  });

  it('committing a unit price calls config:update-settings with the merged price map', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      llmCostUsdPerMillionTokens: { 'gpt-5': 1 },
    };
    const updateSpy = vi.fn();
    installArena({
      'config:get-settings': () => Promise.resolve({ settings }),
      'config:update-settings': (data) => {
        updateSpy(data);
        return Promise.resolve({
          settings: {
            ...settings,
            ...(data as { patch: Record<string, unknown> }).patch,
          },
        });
      },
      'llm:cost-summary': () => Promise.resolve({ summary: SAMPLE_SUMMARY }),
    });
    render(<AutonomyDefaultsTab />);
    const input = (await screen.findByTestId(
      'settings-autonomy-llm-cost-price-claude',
    )) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: '3' } });
    });
    act(() => {
      fireEvent.blur(input);
    });
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    const patch = (
      updateSpy.mock.calls[0][0] as { patch: { llmCostUsdPerMillionTokens: Record<string, number> } }
    ).patch.llmCostUsdPerMillionTokens;
    // Existing 'gpt-5' price is preserved + claude=3 added.
    expect(patch).toEqual({ 'gpt-5': 1, claude: 3 });
  });
});
