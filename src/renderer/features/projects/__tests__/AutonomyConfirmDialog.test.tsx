// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../i18n';
import { i18next } from '../../../i18n';
import { AutonomyConfirmDialog } from '../AutonomyConfirmDialog';

afterEach(() => {
  cleanup();
  void i18next.changeLanguage('ko');
});

function setup(
  overrides: Partial<React.ComponentProps<typeof AutonomyConfirmDialog>> = {},
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    from: 'manual' as const,
    to: 'auto_toggle' as const,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<AutonomyConfirmDialog {...props} />);
  return props;
}

describe('AutonomyConfirmDialog', () => {
  it('submit button is disabled until ack checkbox is checked', () => {
    setup();
    const submit = screen.getByTestId('autonomy-confirm-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId('autonomy-confirm-ack'));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking submit (after ack) calls onConfirm', () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByTestId('autonomy-confirm-ack'));
    fireEvent.click(screen.getByTestId('autonomy-confirm-submit'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancel button calls onCancel AND onOpenChange(false)', () => {
    const { onCancel, onOpenChange } = setup();
    fireEvent.click(screen.getByTestId('autonomy-confirm-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders all 4 tripwire list items', () => {
    setup();
    const tripwires = screen.getByTestId('autonomy-confirm-tripwires');
    const items = tripwires.querySelectorAll('li[data-tripwire]');
    expect(items).toHaveLength(4);
    const keys = Array.from(items).map((el) => el.getAttribute('data-tripwire'));
    expect(keys).toEqual([
      'filesPerTurn',
      'cumulativeCliMs',
      'queueStreak',
      'sameError',
    ]);
  });

  it('isSaving=true → all controls disabled + cancel onCancel not fired', () => {
    const { onCancel } = setup({ isSaving: true });
    const submit = screen.getByTestId('autonomy-confirm-submit');
    const cancel = screen.getByTestId('autonomy-confirm-cancel');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect((cancel as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('error message surfaces in alert', () => {
    setup({ error: new Error('설정 실패') });
    const err = screen.getByTestId('autonomy-confirm-error');
    expect(err.textContent).toContain('설정 실패');
    expect(err.getAttribute('role')).toBe('alert');
  });

  it('ack checkbox resets every time the dialog re-opens', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <AutonomyConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        from="manual"
        to="queue"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('autonomy-confirm-ack'));
    expect(
      (screen.getByTestId('autonomy-confirm-ack') as HTMLInputElement).checked,
    ).toBe(true);

    // Close + reopen
    rerender(
      <AutonomyConfirmDialog
        open={false}
        onOpenChange={onOpenChange}
        from="manual"
        to="queue"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    rerender(
      <AutonomyConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        from="manual"
        to="queue"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('autonomy-confirm-ack') as HTMLInputElement).checked,
    ).toBe(false);
  });
});
