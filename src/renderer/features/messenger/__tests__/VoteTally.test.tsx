// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { VoteTally } from '../VoteTally';

afterEach(() => {
  cleanup();
});

describe('VoteTally', () => {
  it('renders ✓ yes / ✗ no / · pending counts', () => {
    render(<VoteTally yes={2} no={0} pending={1} />);
    expect(screen.getByTestId('vote-tally-yes').textContent).toBe('✓ 2');
    expect(screen.getByTestId('vote-tally-no').textContent).toBe('✗ 0');
    expect(screen.getByTestId('vote-tally-pending').textContent).toBe('· 1');
    const root = screen.getByTestId('vote-tally');
    expect(root.getAttribute('data-yes')).toBe('2');
    expect(root.getAttribute('data-no')).toBe('0');
    expect(root.getAttribute('data-pending')).toBe('1');
  });

  it('uses mono font', () => {
    render(<VoteTally yes={0} no={0} pending={0} />);
    expect(screen.getByTestId('vote-tally').className).toContain('font-mono');
  });

  it('source contains zero hex color literals', () => {
    const source = readFileSync(
      resolve(__dirname, '..', 'VoteTally.tsx'),
      'utf-8',
    );
    expect(source.match(/#[0-9a-fA-F]{3,6}\b/g)).toBeNull();
  });
});
