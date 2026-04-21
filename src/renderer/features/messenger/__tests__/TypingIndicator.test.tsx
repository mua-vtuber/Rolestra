// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TypingIndicator } from '../TypingIndicator';
import { i18next } from '../../../i18n';

beforeEach(() => {
  void i18next.changeLanguage('ko');
});

afterEach(() => {
  cleanup();
});

describe('TypingIndicator', () => {
  it('renders null when names is empty', () => {
    const { container } = render(<TypingIndicator names={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders label with comma-joined names', () => {
    render(<TypingIndicator names={['Alice', 'Bob']} />);
    expect(screen.getByTestId('typing-indicator')).toBeTruthy();
    const label = screen.getByTestId('typing-indicator-label').textContent ?? '';
    expect(label).toContain('Alice, Bob');
    expect(label).toContain('작성 중');
  });

  it('single name renders correctly', () => {
    render(<TypingIndicator names={['Alice']} />);
    expect(
      screen.getByTestId('typing-indicator-label').textContent,
    ).toContain('Alice');
  });

  it('source contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'TypingIndicator.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
