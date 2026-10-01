import type { ReactElement, ReactNode } from 'react';

/** A titled block of the settings "일반" tab (mockup: small muted heading, content below). */
export function SettingsSection({ title, testId, children }: {
  title: string;
  testId: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section data-testid={testId} className="flex flex-col gap-2.5">
      <h3 className="text-preview font-semibold text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}
