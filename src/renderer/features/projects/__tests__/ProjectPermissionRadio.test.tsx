// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { ProjectPermissionRadio } from '../ProjectPermissionRadio';

afterEach(() => {
  cleanup();
  void i18next.changeLanguage('ko');
});

describe('ProjectPermissionRadio — rendering', () => {
  it('renders all 3 options with ko labels', () => {
    void i18next.changeLanguage('ko');
    render(<ProjectPermissionRadio value="hybrid" onChange={() => {}} />);

    expect(screen.getByTestId('project-permission-option-auto').textContent).toContain(
      '자율 (오토)',
    );
    expect(
      screen.getByTestId('project-permission-option-hybrid').textContent,
    ).toContain('혼합 (읽기 자동)');
    expect(
      screen.getByTestId('project-permission-option-approval').textContent,
    ).toContain('승인 (매번)');
  });

  it('marks the current value via data-selected=true', () => {
    render(<ProjectPermissionRadio value="approval" onChange={() => {}} />);
    expect(
      screen
        .getByTestId('project-permission-option-approval')
        .getAttribute('data-selected'),
    ).toBe('true');
    expect(
      screen
        .getByTestId('project-permission-option-auto')
        .getAttribute('data-selected'),
    ).toBe('false');
  });
});

describe('ProjectPermissionRadio — selection behaviour', () => {
  it('clicking an enabled option invokes onChange with its value', () => {
    const onChange = vi.fn();
    render(<ProjectPermissionRadio value="hybrid" onChange={onChange} />);
    fireEvent.click(screen.getByTestId('project-permission-option-approval'));
    expect(onChange).toHaveBeenCalledWith('approval');
  });
});

describe('ProjectPermissionRadio — disabledModes', () => {
  it('disabledModes=["auto"] → auto option has aria-disabled=true', () => {
    render(
      <ProjectPermissionRadio
        value="hybrid"
        onChange={() => {}}
        disabledModes={['auto']}
      />,
    );
    const autoLabel = screen.getByTestId('project-permission-option-auto');
    expect(autoLabel.getAttribute('aria-disabled')).toBe('true');
  });

  it('clicking a disabled option does NOT invoke onChange', () => {
    const onChange = vi.fn();
    render(
      <ProjectPermissionRadio
        value="hybrid"
        onChange={onChange}
        disabledModes={['auto']}
      />,
    );
    fireEvent.click(screen.getByTestId('project-permission-option-auto'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('enabled options still fire onChange while others are disabled', () => {
    const onChange = vi.fn();
    render(
      <ProjectPermissionRadio
        value="hybrid"
        onChange={onChange}
        disabledModes={['auto']}
      />,
    );
    fireEvent.click(screen.getByTestId('project-permission-option-approval'));
    expect(onChange).toHaveBeenCalledWith('approval');
  });
});

describe('ProjectPermissionRadio — hardcoded color guard', () => {
  it('ProjectPermissionRadio.tsx contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'ProjectPermissionRadio.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
