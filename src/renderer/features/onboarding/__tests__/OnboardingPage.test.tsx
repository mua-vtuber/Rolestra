// @vitest-environment jsdom

/**
 * OnboardingPage — F1 (mock/fallback cleanup) 이후 동작 검증.
 *
 * Coverage:
 *   1. detection 빈 상태 → empty UI + Settings/rescan 버튼 + footer 차단
 *   2. detection 결과 N개 → N 카드 렌더 + auto pre-select
 *   3. card 토글 → selections.staff 갱신
 *   4. step gating (1→5)
 *   5. step 5 finish → onboarding:complete + onCompleteWithProject 호출
 *   6. retro 테마 분기
 *   7. source-level hex literal guard (모든 onboarding 파일)
 *
 * F1 이후 wizard 는 STAFF_CANDIDATES fixture 가 아닌 `provider:detect` IPC
 * 응답을 단일 진실원으로 사용하므로 모든 테스트가 `window.arena` mock 을
 * 통해 IPC 응답을 주입한다. mock 헬퍼 (`setupArenaBridge`) 가 5 개 채널
 * (get-state / set-state / complete / detect / apply-staff-selection) 을
 * in-memory 합성한다.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ThemeProvider } from '../../../theme/theme-provider';
import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  useThemeStore,
} from '../../../theme/theme-store';
import '../../../i18n';
import { i18next } from '../../../i18n';
import { OnboardingPage } from '../OnboardingPage';
import type { ThemeKey } from '../../../theme/theme-tokens';
import type {
  OnboardingState,
  ProviderDetectionSnapshot,
} from '../../../../shared/onboarding-types';
import type { RoleId } from '../../../../shared/role-types';

// ── Bridge mock ────────────────────────────────────────────────────

interface BridgeOptions {
  snapshots: ProviderDetectionSnapshot[];
  initialState?: Partial<OnboardingState>;
  applyStaffResult?: { added: unknown[]; skipped: unknown[] };
}

function setupArenaBridge(opts: BridgeOptions): {
  invoke: ReturnType<typeof vi.fn>;
  state: OnboardingState;
} {
  const state: OnboardingState = {
    completed: false,
    currentStep: 1,
    selections: {},
    updatedAt: 0,
    ...opts.initialState,
  };

  const invoke = vi.fn(
    async (channel: string, data?: { partial?: Partial<OnboardingState> }) => {
      switch (channel) {
        case 'onboarding:get-state':
          return { state: { ...state, selections: { ...state.selections } } };
        case 'onboarding:set-state': {
          const partial = data?.partial ?? {};
          if (partial.currentStep !== undefined) {
            state.currentStep = partial.currentStep;
          }
          if (partial.selections !== undefined) {
            state.selections = {
              ...state.selections,
              ...partial.selections,
            };
          }
          state.updatedAt = Date.now();
          return { state: { ...state, selections: { ...state.selections } } };
        }
        case 'onboarding:complete':
          state.completed = true;
          state.updatedAt = Date.now();
          return { success: true };
        case 'provider:detect':
          return { snapshots: [...opts.snapshots] };
        case 'onboarding:apply-staff-selection':
          return opts.applyStaffResult ?? { added: [], skipped: [] };
        default:
          throw new Error(`unmocked channel: ${channel}`);
      }
    },
  );

  (window as unknown as { arena: unknown }).arena = {
    platform: 'darwin',
    invoke,
  };

  return { invoke, state };
}

function teardownArenaBridge(): void {
  delete (window as unknown as { arena?: unknown }).arena;
}

// ── Helpers ────────────────────────────────────────────────────────

const KNOWN_AVAILABLE: ProviderDetectionSnapshot[] = [
  {
    providerId: 'claude',
    kind: 'cli',
    available: true,
    capabilities: ['streaming', 'summarize'],
  },
  {
    providerId: 'gemini',
    kind: 'cli',
    available: true,
    capabilities: ['streaming', 'summarize'],
  },
  {
    providerId: 'codex',
    kind: 'cli',
    available: true,
    capabilities: ['streaming', 'summarize'],
  },
  {
    providerId: 'local',
    kind: 'local',
    available: true,
    capabilities: ['streaming'],
  },
];

type AnyMock = ReturnType<typeof vi.fn>;

function renderPage(
  themeKey: ThemeKey = DEFAULT_THEME,
  props: {
    onExit?: AnyMock;
    onCompleteWithProject?: AnyMock;
    onOpenSettings?: AnyMock;
  } = {},
): {
  onExit: AnyMock;
  onCompleteWithProject: AnyMock;
  onOpenSettings: AnyMock;
} & ReturnType<typeof render> {
  useThemeStore.setState({ themeKey, mode: 'light' });
  const onExit: AnyMock = props.onExit ?? vi.fn();
  const onCompleteWithProject: AnyMock = props.onCompleteWithProject ?? vi.fn();
  const onOpenSettings: AnyMock = props.onOpenSettings ?? vi.fn();
  const result = render(
    <ThemeProvider>
      <OnboardingPage
        onExit={onExit as unknown as () => void}
        onCompleteWithProject={
          onCompleteWithProject as unknown as (input: {
            kind: 'new' | 'external' | 'imported';
            slug: string;
            staff: ReadonlyArray<string>;
            roles: Record<string, string>;
            permissions: 'auto' | 'hybrid' | 'approval';
          }) => void
        }
        onOpenSettings={onOpenSettings as unknown as () => void}
      />
    </ThemeProvider>,
  );
  return { onExit, onCompleteWithProject, onOpenSettings, ...result };
}

async function waitForStep(step: number): Promise<void> {
  await waitFor(() => {
    expect(
      screen.getByTestId('onboarding-page').getAttribute('data-current-step'),
    ).toBe(String(step));
  });
}

async function clickNext(): Promise<void> {
  fireEvent.click(screen.getByTestId('onboarding-action-next'));
}

beforeEach(() => {
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  teardownArenaBridge();
});

// ── Tests ──────────────────────────────────────────────────────────

describe('OnboardingPage — initial frame (F1)', () => {
  it('renders step 1 welcome body once IPC hydration completes', async () => {
    setupArenaBridge({ snapshots: [] });
    renderPage('warm');
    await waitForStep(1);
    // R12-C 정리 #4 (2026-05-03): R12-C round 2 commit 375ad77 에서
    // 사용자 요청으로 step 1 안내 카드 wrapper 가 삭제되고 본문이
    // description 아래에 inline 으로 이어 붙도록 변경. 옛 wrapper testid
    // (`onboarding-step-1`) 가 사라지고 본문에 `onboarding-step-1-body`
    // testid 만 남았다. 검증을 새 testid 로 갱신.
    expect(screen.getByTestId('onboarding-step-1-body')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-staff-grid')).toBeNull();
  });

  it('shows fatal error frame when get-state rejects', async () => {
    (window as unknown as { arena: unknown }).arena = {
      platform: 'darwin',
      invoke: vi.fn(async () => {
        throw new Error('IPC down');
      }),
    };
    renderPage('warm');
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-fatal-error')).toBeTruthy();
    });
  });
});

describe('OnboardingPage — Step 2 detection-driven grid (F1)', () => {
  it('renders one card per detection snapshot and auto pre-selects available ones', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    await waitFor(() => {
      expect(screen.getAllByTestId('onboarding-staff-card')).toHaveLength(
        KNOWN_AVAILABLE.length,
      );
    });

    const selectedCount = screen
      .getAllByTestId('onboarding-staff-card')
      .filter((c) => c.getAttribute('data-selected') === 'true').length;
    expect(selectedCount).toBe(KNOWN_AVAILABLE.length);
  });

  it('renders empty UI and disables next when detection is empty', async () => {
    setupArenaBridge({ snapshots: [] });
    renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    expect(screen.getByTestId('onboarding-detection-empty')).toBeTruthy();
    expect(
      screen
        .getByTestId('onboarding-action-next')
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('empty UI Settings button calls onOpenSettings prop', async () => {
    setupArenaBridge({ snapshots: [] });
    const { onOpenSettings } = renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    fireEvent.click(screen.getByTestId('onboarding-empty-action-settings'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('empty UI rescan button re-invokes provider:detect', async () => {
    const { invoke } = setupArenaBridge({ snapshots: [] });
    renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    invoke.mockClear();
    fireEvent.click(screen.getByTestId('onboarding-empty-action-rescan'));
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(([channel]) => channel === 'provider:detect'),
      ).toBe(true);
    });
  });

  it('clicking a selected card toggles it off and updates selection', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    await waitFor(() => {
      const cards = screen.getAllByTestId('onboarding-staff-card');
      expect(cards.length).toBe(KNOWN_AVAILABLE.length);
    });

    const claudeCard = screen
      .getAllByTestId('onboarding-staff-card')
      .find((c) => c.getAttribute('data-candidate-id') === 'claude');
    expect(claudeCard).toBeTruthy();
    expect(claudeCard!.getAttribute('data-selected')).toBe('true');
    fireEvent.click(claudeCard!);

    await waitFor(() => {
      const updated = screen
        .getAllByTestId('onboarding-staff-card')
        .find((c) => c.getAttribute('data-candidate-id') === 'claude');
      expect(updated!.getAttribute('data-selected')).toBe('false');
    });
  });
});

describe('OnboardingPage — step gates', () => {
  it('next is enabled at step 1 (no gate)', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await waitForStep(1);
    expect(
      screen.getByTestId('onboarding-action-next').getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('next is enabled at step 2 once at least one card is selected', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    await waitFor(() => {
      expect(
        screen
          .getByTestId('onboarding-action-next')
          .getAttribute('aria-disabled'),
      ).toBe('false');
    });
  });

  it('skip button calls onExit', async () => {
    setupArenaBridge({ snapshots: [] });
    const { onExit } = renderPage('warm');
    await waitForStep(1);
    fireEvent.click(screen.getByTestId('onboarding-topbar-skip'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('prev at step 1 calls onExit', async () => {
    setupArenaBridge({ snapshots: [] });
    const { onExit } = renderPage('warm');
    await waitForStep(1);
    fireEvent.click(screen.getByTestId('onboarding-action-prev'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('prev at step 2 walks back to step 1', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    const { onExit } = renderPage('warm');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    fireEvent.click(screen.getByTestId('onboarding-action-prev'));
    await waitForStep(1);
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('OnboardingPage — step 3/4/5 surfaces', () => {
  // R12-C round 2 (commit 80266f3) 부터 step 3 → 4 진행 조건이 강화됐다:
  //   1) 모든 직원의 역할 칭호 non-empty
  //   2) 9 능력 (idea / planning / design.ui / design.ux / design.character /
  //      design.background / implement / review / general) 각각 ≥ 1명 배정
  // 디폴트 skillAssignments 는 `general` 만 모든 직원 ON, 나머지 8 능력은
  // 모두 OFF. 따라서 helper 는 첫 번째 직원 (claude) 의 8 능력 체크박스를
  // 한 번씩 켜면 9 능력 모두 ≥ 1명 충족.
  const SKILLS_TO_TOGGLE_FOR_CLAUDE: RoleId[] = [
    'idea',
    'planning',
    'design.ui',
    'design.ux',
    'design.character',
    'design.background',
    'implement',
    'review',
  ];

  async function advanceToStep(target: 3 | 4 | 5): Promise<void> {
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);
    await waitFor(() => {
      expect(
        screen
          .getByTestId('onboarding-action-next')
          .getAttribute('aria-disabled'),
      ).toBe('false');
    });
    if (target >= 3) {
      await clickNext();
      await waitForStep(3);
    }
    if (target >= 4) {
      // 1) 역할 칭호 — 모든 직원 non-empty.
      const inputs = screen.getAllByTestId('onboarding-step-3-input');
      inputs.forEach((input) => {
        fireEvent.change(input, { target: { value: '시니어' } });
      });
      // 2) 능력 매트릭스 — 첫 번째 직원 (claude) 의 8 능력 체크박스를 ON.
      //    Step3RoleAssignment 의 handleToggleSkill 는 prop 으로 받은
      //    `skillAssignments` 를 closure 로 캡처해서 현재 값 위에 토글한다.
      //    sync loop 으로 8 click 을 연속 발화하면 같은 render scope 의 동일
      //    skillAssignments 를 8 번 읽어 last-write-wins 회귀가 난다 (테스트
      //    환경의 patchSelections IPC 는 microtask 단위로 비동기).
      //    각 click 후 해당 role 의 카운트가 1 로 반영될 때까지 await 해서
      //    React re-render → memo 갱신 → 다음 click closure 가 새 prop 을
      //    읽도록 한다.
      for (const role of SKILLS_TO_TOGGLE_FOR_CLAUDE) {
        const label = screen.getByTestId(
          `onboarding-step-3-skill-checkbox-${role}-claude`,
        );
        const checkbox = label.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        );
        if (checkbox === null) {
          throw new Error(
            `step 3 helper: missing checkbox for role=${role} provider=claude`,
          );
        }
        fireEvent.click(checkbox);
        await waitFor(() => {
          const countEl = screen.getByTestId(
            `onboarding-step-3-skill-count-${role}`,
          );
          expect(countEl.textContent).toContain('(1)');
        });
      }
      await waitFor(() => {
        expect(
          screen
            .getByTestId('onboarding-action-next')
            .getAttribute('aria-disabled'),
        ).toBe('false');
      });
      await clickNext();
      await waitForStep(4);
    }
    if (target >= 5) {
      await clickNext();
      await waitForStep(5);
    }
  }

  it('step 3 renders one input per selected provider (auto pre-selected)', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await advanceToStep(3);
    const rows = screen.getAllByTestId('onboarding-step-3-row');
    expect(rows.length).toBe(KNOWN_AVAILABLE.length);
  });

  // R12-C 정리 #5 (2026-05-03) 재활성: helper advanceToStep(4) 에 능력
  // 매트릭스 입력 (첫 번째 직원의 8 능력 체크박스 ON) 추가. 정리 #4 의
  // skip 사유 (능력 미배정 → step 3 next 비활성 → timeout) 해소.
  it('step 4 defaults to hybrid permission mode', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await advanceToStep(4);
    const hybrid = screen
      .getAllByTestId('onboarding-step-4-option')
      .find((el) => el.getAttribute('data-mode') === 'hybrid');
    expect(hybrid?.getAttribute('data-selected')).toBe('true');
  });

  it('step 5 next is disabled until slug is non-empty', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('warm');
    await advanceToStep(5);
    expect(
      screen.getByTestId('onboarding-action-next').getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.change(screen.getByTestId('onboarding-step-5-slug'), {
      target: { value: 'arena-test' },
    });
    await waitFor(() => {
      expect(
        screen
          .getByTestId('onboarding-action-next')
          .getAttribute('aria-disabled'),
      ).toBe('false');
    });
  });

  it('step 5 finish triggers onboarding:complete then onCompleteWithProject', async () => {
    const { invoke } = setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    const { onCompleteWithProject } = renderPage('warm');
    await advanceToStep(5);
    fireEvent.change(screen.getByTestId('onboarding-step-5-slug'), {
      target: { value: 'arena-test' },
    });
    await waitFor(() => {
      expect(
        screen
          .getByTestId('onboarding-action-next')
          .getAttribute('aria-disabled'),
      ).toBe('false');
    });
    await clickNext();
    await waitFor(() => {
      expect(
        invoke.mock.calls.some(
          ([channel]) => channel === 'onboarding:complete',
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(onCompleteWithProject).toHaveBeenCalledTimes(1);
    });
    const arg = onCompleteWithProject.mock.calls[0]![0];
    expect(arg.kind).toBe('new');
    expect(arg.slug).toBe('arena-test');
    expect(arg.staff.length).toBe(KNOWN_AVAILABLE.length);
    expect(arg.permissions).toBe('hybrid');
  });
});

describe('OnboardingPage — retro theme', () => {
  it('summary strip shows mono prompt under retro at step 2', async () => {
    setupArenaBridge({ snapshots: KNOWN_AVAILABLE });
    renderPage('retro');
    await waitForStep(1);
    await clickNext();
    await waitForStep(2);

    await waitFor(() => {
      const strip = screen.queryByTestId('onboarding-summary-strip');
      expect(strip?.getAttribute('data-theme')).toBe('retro');
    });
    expect(screen.getByTestId('onboarding-summary-strip').textContent).toContain(
      '$ onboarding --staff',
    );
  });
});

describe('Onboarding source — hex literal guard', () => {
  it('every onboarding source file has zero hex color literals', () => {
    const dir = resolve(__dirname, '..');
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.tsx') || f.endsWith('.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    files.forEach((file) => {
      const source = readFileSync(resolve(dir, file), 'utf-8');
      const matches = source.match(/#[0-9a-fA-F]{3,6}\b/g);
      expect(
        matches,
        `${file} contains hex literal(s): ${matches?.join(', ')}`,
      ).toBeNull();
    });
  });
});
