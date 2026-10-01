import { describe, expect, it } from 'vitest';
import { chatCliIsolationArgs } from '../chat-cli-isolation';
import { CodexPermissionAdapter } from '../permission-adapter';

describe('scoped Codex project trust', () => {
  it.each([
    'C:\\Users\\Example\\chat room',
    '/mnt/c/Users/Example/chat room',
    'C:\\Users\\Example\\say "hello"',
  ])('marks the exact CLI-visible cwd untrusted: %s', (cwd) => {
    const args = chatCliIsolationArgs(new CodexPermissionAdapter(), cwd);
    expect(args).toContain(`projects.${JSON.stringify(cwd)}.trust_level="untrusted"`);
  });
});
