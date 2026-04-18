import { describe, it, expect } from 'vitest';
import { ClaudePermissionAdapter, CodexPermissionAdapter, PromptOnlyPermissionAdapter } from '../permission-adapter';

describe('ClaudePermissionAdapter', () => {
  const adapter = new ClaudePermissionAdapter();

  it('returns restricted --allowedTools for read-only', () => {
    const args = adapter.buildReadOnlyArgs('/project');
    expect(args).toContain('--allowedTools');
    // Should restrict to read-only tools
    expect(args.join(' ')).not.toContain('Write');
  });

  it('returns no tool restrictions for worker mode', () => {
    const args = adapter.buildWorkerArgs('/project');
    // Worker has full access — no --allowedTools restriction
    expect(args.filter(a => a === '--allowedTools')).toHaveLength(0);
  });

  it('returns system prompt for read-only', () => {
    const prompt = adapter.getReadOnlySystemPrompt();
    expect(prompt).toContain('읽기');
  });

  it('returns system prompt for worker', () => {
    const prompt = adapter.getWorkerSystemPrompt('/project', '/consensus', 'work-summary-123.md');
    expect(prompt).toContain('작업자');
    expect(prompt).toContain('work-summary-123.md');
  });
});

describe('CodexPermissionAdapter', () => {
  const adapter = new CodexPermissionAdapter();

  it('returns empty args for read-only (codex exec has no permission flags)', () => {
    const args = adapter.buildReadOnlyArgs('/project');
    expect(args).toHaveLength(0);
  });

  it('returns empty args for worker (codex exec has no permission flags)', () => {
    const args = adapter.buildWorkerArgs('/project');
    expect(args).toHaveLength(0);
  });
});

describe('PromptOnlyPermissionAdapter', () => {
  const adapter = new PromptOnlyPermissionAdapter();

  it('returns empty args for read-only (prompt-only fallback)', () => {
    const args = adapter.buildReadOnlyArgs('/project');
    expect(args).toHaveLength(0);
  });

  it('returns empty args for worker (prompt-only fallback)', () => {
    const args = adapter.buildWorkerArgs('/project');
    expect(args).toHaveLength(0);
  });

  it('returns read-only system prompt', () => {
    const prompt = adapter.getReadOnlySystemPrompt();
    expect(prompt).toContain('읽기');
  });
});
