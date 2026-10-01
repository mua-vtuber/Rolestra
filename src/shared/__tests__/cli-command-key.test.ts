import { describe, expect, it } from 'vitest';

import { cliCommandKey } from '../cli-command-key';

describe('cliCommandKey', () => {
  it.each([
    ['claude', 'claude'],
    ['/usr/local/bin/claude', 'claude'],
    ['C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', 'codex'],
    ['C:/tools/Claude.EXE', 'claude'],
    ['D:\\bin\\gemini.bat', 'gemini'],
  ])('%s -> %s', (command, key) => {
    expect(cliCommandKey(command)).toBe(key);
  });
});
