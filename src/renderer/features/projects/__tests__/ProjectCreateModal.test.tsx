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
// Radix Dialog + RadioGroup rely on browser-only APIs that jsdom does
// not ship. Stubbing them here rather than pulling in a global setup
// keeps the scope narrow to this test file.
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

import type { Project } from '../../../../shared/project-types';
import { DEFAULT_MODE, DEFAULT_THEME, useThemeStore } from '../../../theme/theme-store';
import { ThemeProvider } from '../../../theme/theme-provider';
import '../../../i18n';
import { i18next } from '../../../i18n';

// ── hook mocks ──────────────────────────────────────────────────────
const createNewMock = vi.fn();
const linkExternalMock = vi.fn();
const importFolderMock = vi.fn();

vi.mock('../../../hooks/use-projects', () => ({
  useProjects: () => ({
    projects: [],
    loading: false,
    error: null,
    refresh: async () => {},
    createNew: createNewMock,
    linkExternal: linkExternalMock,
    importFolder: importFolderMock,
    archive: async () => {},
  }),
}));

// ── ipc invoke mock (workspace:pick-folder + provider:list) ─────────
interface InvokeMockCall {
  channel: string;
  data: unknown;
}

const invokeCalls: InvokeMockCall[] = [];
let pickFolderResult: { folderPath: string | null } = { folderPath: null };
let providerListResult: { providers: Array<{ id: string; displayName: string }> } = {
  providers: [],
};
let pickFolderReject: Error | null = null;

vi.mock('../../../ipc/invoke', () => ({
  invoke: async (channel: string, data: unknown) => {
    invokeCalls.push({ channel, data });
    if (channel === 'project:pick-folder') {
      if (pickFolderReject) throw pickFolderReject;
      return pickFolderResult;
    }
    if (channel === 'provider:list') {
      return providerListResult;
    }
    throw new Error(`unexpected channel: ${channel}`);
  },
}));

// Import after mocks.
import { ProjectCreateModal } from '../ProjectCreateModal';

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const SAMPLE_PROJECT: Project = {
  id: 'p-1',
  slug: 'demo',
  name: 'demo',
  description: '',
  kind: 'new',
  externalLink: null,
  permissionMode: 'hybrid',
  autonomyMode: 'manual',
  status: 'active',
  createdAt: 1_700_000_000_000,
  archivedAt: null,
};

beforeEach(() => {
  createNewMock.mockReset();
  linkExternalMock.mockReset();
  importFolderMock.mockReset();
  invokeCalls.length = 0;
  pickFolderResult = { folderPath: null };
  pickFolderReject = null;
  providerListResult = { providers: [] };
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
  useThemeStore.setState({ themeKey: DEFAULT_THEME, mode: DEFAULT_MODE });
});

describe('ProjectCreateModal — open/close', () => {
  it('renders the dialog when open=true', () => {
    renderWithTheme(
      <ProjectCreateModal open onOpenChange={() => {}} />,
    );
    expect(screen.getByTestId('project-create-modal')).toBeTruthy();
    expect(screen.getByTestId('project-create-name')).toBeTruthy();
    expect(screen.getByTestId('project-create-submit')).toBeTruthy();
  });

  it('does not render the dialog when open=false', () => {
    renderWithTheme(
      <ProjectCreateModal open={false} onOpenChange={() => {}} />,
    );
    expect(screen.queryByTestId('project-create-modal')).toBeNull();
  });

  it('ESC closes the modal (onOpenChange called with false)', async () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ProjectCreateModal open onOpenChange={onOpenChange} />,
    );
    fireEvent.keyDown(screen.getByTestId('project-create-modal'), {
      key: 'Escape',
      code: 'Escape',
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('cancel button closes the modal', () => {
    const onOpenChange = vi.fn();
    renderWithTheme(
      <ProjectCreateModal open onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByTestId('project-create-cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ProjectCreateModal — CA-1 external + auto defence', () => {
  it('kind="external" → auto option is aria-disabled=true', async () => {
    renderWithTheme(<ProjectCreateModal open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByTestId('project-kind-option-external'));
    await waitFor(() => {
      expect(
        screen
          .getByTestId('project-permission-option-auto')
          .getAttribute('aria-disabled'),
      ).toBe('true');
    });
  });

  it('flipping kind→external while auto was selected auto-switches to hybrid', async () => {
    renderWithTheme(<ProjectCreateModal open onOpenChange={() => {}} />);

    // Preselect auto under kind='new' (where it's legal).
    fireEvent.click(screen.getByTestId('project-permission-option-auto'));
    await waitFor(() => {
      expect(
        screen
          .getByTestId('project-permission-option-auto')
          .getAttribute('data-selected'),
      ).toBe('true');
    });

    // Now flip to external; the guard must swap to hybrid.
    fireEvent.click(screen.getByTestId('project-kind-option-external'));
    await waitFor(() => {
      expect(
        screen
          .getByTestId('project-permission-option-hybrid')
          .getAttribute('data-selected'),
      ).toBe('true');
    });
    expect(
      screen
        .getByTestId('project-permission-option-auto')
        .getAttribute('data-selected'),
    ).toBe('false');
  });
});

describe('ProjectCreateModal — inline validation errors', () => {
  it('empty name → nameRequired error rendered inline', () => {
    renderWithTheme(<ProjectCreateModal open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByTestId('project-create-submit'));
    const banner = screen.getByTestId('project-create-error');
    expect(banner.textContent).toContain('이름을 입력하세요');
  });

  it('external kind + missing externalPath → externalPathRequired inline', async () => {
    renderWithTheme(<ProjectCreateModal open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'demo' },
    });
    fireEvent.click(screen.getByTestId('project-kind-option-external'));
    await waitFor(() => {
      expect(screen.getByTestId('project-create-external-path')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));
    const banner = screen.getByTestId('project-create-error');
    expect(banner.textContent).toContain('외부 폴더를 선택하세요');
  });
});

describe('ProjectCreateModal — success path', () => {
  it('kind=new → calls createNew with the form payload and closes', async () => {
    const onOpenChange = vi.fn();
    const onCreated = vi.fn();
    createNewMock.mockResolvedValue(SAMPLE_PROJECT);

    renderWithTheme(
      <ProjectCreateModal
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: '새 프로젝트 A' },
    });
    fireEvent.change(screen.getByTestId('project-create-description'), {
      target: { value: '한 줄 설명' },
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(createNewMock).toHaveBeenCalledTimes(1);
    });
    expect(createNewMock).toHaveBeenCalledWith({
      name: '새 프로젝트 A',
      description: '한 줄 설명',
      kind: 'new',
      permissionMode: 'hybrid',
      initialMemberProviderIds: [],
    });
    expect(onCreated).toHaveBeenCalledWith(SAMPLE_PROJECT);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('kind=external → calls linkExternal with externalPath', async () => {
    const onOpenChange = vi.fn();
    linkExternalMock.mockResolvedValue(SAMPLE_PROJECT);
    pickFolderResult = { folderPath: '/tmp/user/some-repo' };

    renderWithTheme(
      <ProjectCreateModal open onOpenChange={onOpenChange} />,
    );
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'ext-link' },
    });
    fireEvent.click(screen.getByTestId('project-kind-option-external'));
    await waitFor(() => {
      expect(screen.getByTestId('project-create-external-path')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('project-create-external-path-button'));
    await waitFor(() => {
      expect(
        screen.getByTestId('project-create-external-path-value').textContent,
      ).toContain('/tmp/user/some-repo');
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(linkExternalMock).toHaveBeenCalledTimes(1);
    });
    expect(linkExternalMock).toHaveBeenCalledWith({
      name: 'ext-link',
      externalPath: '/tmp/user/some-repo',
      description: undefined,
      permissionMode: 'hybrid',
      initialMemberProviderIds: [],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('kind=imported → calls importFolder with sourcePath', async () => {
    importFolderMock.mockResolvedValue(SAMPLE_PROJECT);
    pickFolderResult = { folderPath: '/tmp/user/to-import' };

    renderWithTheme(
      <ProjectCreateModal open onOpenChange={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'imp-proj' },
    });
    fireEvent.click(screen.getByTestId('project-kind-option-imported'));
    await waitFor(() => {
      expect(screen.getByTestId('project-create-source-path')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('project-create-source-path-button'));
    await waitFor(() => {
      expect(
        screen.getByTestId('project-create-source-path-value').textContent,
      ).toContain('/tmp/user/to-import');
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(importFolderMock).toHaveBeenCalledTimes(1);
    });
    expect(importFolderMock).toHaveBeenCalledWith({
      name: 'imp-proj',
      sourcePath: '/tmp/user/to-import',
      description: undefined,
      permissionMode: 'hybrid',
      initialMemberProviderIds: [],
    });
  });
});

describe('ProjectCreateModal — server error surfaced inline', () => {
  it('linkExternal throwing ExternalAutoForbiddenError → externalAutoForbidden message', async () => {
    pickFolderResult = { folderPath: '/tmp/ext' };
    const err = new Error('external + auto forbidden');
    err.name = 'ExternalAutoForbiddenError';
    linkExternalMock.mockRejectedValue(err);

    renderWithTheme(
      <ProjectCreateModal open onOpenChange={() => {}} />,
    );

    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'ext' },
    });
    fireEvent.click(screen.getByTestId('project-kind-option-external'));
    await waitFor(() => {
      expect(screen.getByTestId('project-create-external-path')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('project-create-external-path-button'));
    await waitFor(() => {
      expect(
        screen.getByTestId('project-create-external-path-value').textContent,
      ).toContain('/tmp/ext');
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('project-create-error').textContent).toContain(
        '자율 모드',
      );
    });
  });

  it('createNew rejecting with generic error renders generic i18n message', async () => {
    createNewMock.mockRejectedValue(new Error('network hiccup'));

    renderWithTheme(
      <ProjectCreateModal open onOpenChange={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'ok' },
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('project-create-error').textContent).toContain(
        '프로젝트 생성 중 오류',
      );
    });
  });

  it('DuplicateSlugError → duplicateSlug i18n message', async () => {
    const err = new Error('slug clash');
    err.name = 'DuplicateSlugError';
    createNewMock.mockRejectedValue(err);

    renderWithTheme(<ProjectCreateModal open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'dup' },
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('project-create-error').textContent).toContain(
        '이미 있습니다',
      );
    });
  });
});

describe('ProjectCreateModal — hardcoded color guard', () => {
  it('ProjectCreateModal.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ProjectCreateModal.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
