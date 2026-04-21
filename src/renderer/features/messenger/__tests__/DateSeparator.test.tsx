// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DateSeparator } from '../DateSeparator';

afterEach(() => {
  cleanup();
});

describe('DateSeparator', () => {
  it('renders the supplied label', () => {
    render(<DateSeparator label="오늘, 2026년 4월 21일" />);
    const sep = screen.getByTestId('date-separator');
    expect(sep.getAttribute('data-label')).toBe('오늘, 2026년 4월 21일');
    expect(screen.getByTestId('date-separator-label').textContent).toBe(
      '오늘, 2026년 4월 21일',
    );
  });

  it('uses role=separator for a11y', () => {
    render(<DateSeparator label="x" />);
    const sep = screen.getByTestId('date-separator');
    expect(sep.getAttribute('role')).toBe('separator');
  });

  it('source contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'DateSeparator.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
