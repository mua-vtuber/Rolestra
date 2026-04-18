import { describe, it, expect } from 'vitest';
import { AppToolProvider } from '../app-tool-provider';
import type { SessionState } from '../../../shared/session-state-types';

describe('AppToolProvider', () => {
  const provider = new AppToolProvider();

  it('provides file_read and web_search in CONVERSATION', () => {
    const tools = provider.getAvailableTools('CONVERSATION', false);
    expect(tools.map(t => t.name)).toContain('file_read');
    expect(tools.map(t => t.name)).toContain('web_search');
    expect(tools.map(t => t.name)).not.toContain('file_write');
  });

  it('provides all tools to worker in EXECUTING', () => {
    const tools = provider.getAvailableTools('EXECUTING', true);
    expect(tools.map(t => t.name)).toContain('file_read');
    expect(tools.map(t => t.name)).toContain('file_write');
    expect(tools.map(t => t.name)).toContain('command_execute');
    expect(tools.map(t => t.name)).toContain('web_search');
  });

  it('restricts non-worker in EXECUTING', () => {
    const tools = provider.getAvailableTools('EXECUTING', false);
    expect(tools.map(t => t.name)).toContain('file_read');
    expect(tools.map(t => t.name)).toContain('web_search');
    expect(tools.map(t => t.name)).not.toContain('file_write');
    expect(tools.map(t => t.name)).not.toContain('command_execute');
  });

  it('provides read-only tools in REVIEWING', () => {
    const tools = provider.getAvailableTools('REVIEWING', false);
    expect(tools.map(t => t.name)).toContain('file_read');
    expect(tools.map(t => t.name)).toContain('web_search');
    expect(tools.map(t => t.name)).not.toContain('file_write');
  });

  it('always includes web_search regardless of state', () => {
    const states: SessionState[] = ['CONVERSATION', 'WORK_DISCUSSING', 'EXECUTING', 'REVIEWING', 'DONE'];
    for (const state of states) {
      const tools = provider.getAvailableTools(state, false);
      expect(tools.map(t => t.name)).toContain('web_search');
    }
  });
});
