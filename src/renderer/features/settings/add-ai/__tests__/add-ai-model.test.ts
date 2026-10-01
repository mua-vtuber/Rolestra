import { describe, expect, it } from 'vitest';

import { i18next } from '../../../../i18n';
import type { DetectedCli } from '../../../../../shared/ipc-types';
import type { ProviderInfo } from '../../../../../shared/provider-types';
import { cliPathKey, isCliRegistered, supportedClis, uniqueDisplayName } from '../add-ai-model';

const t = i18next.t.bind(i18next);

function cliProvider(command: string, wslDistro?: string): ProviderInfo {
  return {
    id: command, type: 'cli', displayName: command, model: 'unknown', capabilities: [], status: 'ready',
    roles: [], skill_overrides: null, isDepartmentHead: {},
    config: {
      type: 'cli', command, args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
      sessionStrategy: 'persistent', hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown',
      ...(wslDistro === undefined ? {} : { wslDistro }),
    },
  };
}

function detected(path: string, wslDistro?: string): DetectedCli {
  return { command: 'claude', displayName: 'Claude Code', path, ...(wslDistro === undefined ? {} : { wslDistro }) };
}

describe('CLI registration identity (command path + WSL distro)', () => {
  it('reads Windows paths case- and slash-insensitively, POSIX paths exactly', () => {
    expect(cliPathKey('C:\\Tools\\Claude.CMD')).toBe(cliPathKey('c:/tools/claude.cmd'));
    expect(cliPathKey('/usr/bin/claude')).not.toBe(cliPathKey('/usr/bin/Claude'));
  });

  it('matches a registered CLI only on the same path and the same distro', () => {
    const providers = [cliProvider('/usr/bin/claude'), cliProvider('/home/u/.local/bin/claude', 'Ubuntu')];
    expect(isCliRegistered(detected('/usr/bin/claude'), providers)).toBe(true);
    expect(isCliRegistered(detected('/usr/local/bin/claude'), providers)).toBe(false);
    expect(isCliRegistered(detected('/usr/bin/claude', 'Ubuntu'), providers)).toBe(false);
    expect(isCliRegistered(detected('/home/u/.local/bin/claude', 'Ubuntu'), providers)).toBe(true);
  });

  it('offers only the chat CLIs', () => {
    expect(supportedClis([
      detected('/usr/bin/claude'),
      { command: 'gemini', displayName: 'Gemini CLI', path: '/usr/bin/gemini' },
    ]).map((cli) => cli.command)).toEqual(['claude']);
  });
});

describe('uniqueDisplayName', () => {
  it('keeps a free name and numbers a taken one, case-insensitively', () => {
    expect(uniqueDisplayName(t, 'Codex', [])).toBe('Codex');
    expect(uniqueDisplayName(t, 'Codex', [cliProvider('x')].map((p) => ({ ...p, displayName: 'CODEX' }))))
      .toBe('Codex 2');
  });
});
