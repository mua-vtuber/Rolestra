// @vitest-environment jsdom

/**
 * WorkStatusDot — 4-state matrix (R8-Task2, spec §7.2).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// react-i18next picks up the singleton i18next initialised by this import.
import '../../../i18n';

import {
  WorkStatusDot,
  WORK_STATUS_DOT_CLASS,
  WORK_STATUS_I18N_KEY,
} from '../WorkStatusDot';
import type { WorkStatus } from '../../../../shared/member-profile-types';

afterEach(() => {
  cleanup();
});

const STATUSES: WorkStatus[] = [
  'online',
  'connecting',
  'offline-connection',
  'offline-manual',
];

describe('WorkStatusDot — tone class matrix', () => {
  it.each(STATUSES)('uses spec-mandated tone class for %s', (status) => {
    render(<WorkStatusDot status={status} />);
    const wrapper = screen.getByTestId('work-status-dot');
    const dot = wrapper.firstElementChild as HTMLElement;
    expect(dot.className).toContain(WORK_STATUS_DOT_CLASS[status]);
  });

  it('connecting carries animate-pulse for in-flight visual cue', () => {
    render(<WorkStatusDot status="connecting" />);
    const wrapper = screen.getByTestId('work-status-dot');
    const dot = wrapper.firstElementChild as HTMLElement;
    expect(dot.className).toContain('animate-pulse');
  });
});

describe('WorkStatusDot — a11y', () => {
  it('puts the i18n label on aria-label when showLabel=false (compact mode)', () => {
    render(<WorkStatusDot status="online" />);
    const wrapper = screen.getByTestId('work-status-dot');
    expect(wrapper.getAttribute('aria-label')).toBeTruthy();
    expect(wrapper.getAttribute('role')).toBe('status');
    expect(screen.queryByTestId('work-status-label')).toBeNull();
  });

  it('renders a visible label when showLabel=true and drops aria-label (text takes over)', () => {
    render(<WorkStatusDot status="offline-manual" showLabel />);
    const wrapper = screen.getByTestId('work-status-dot');
    expect(wrapper.getAttribute('aria-label')).toBeNull();
    expect(screen.getByTestId('work-status-label').textContent).toBeTruthy();
  });
});

describe('WorkStatusDot — i18n key invariant', () => {
  it.each(STATUSES)('has a stable i18n key for %s', (status) => {
    expect(WORK_STATUS_I18N_KEY[status]).toMatch(/^member\.status\./);
  });
});
