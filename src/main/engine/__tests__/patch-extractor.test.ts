/**
 * Tests for PatchExtractor — structured JSON extraction from AI output.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';

// ── Mock node:fs/promises ──────────────────────────────────────────────────

const mockReadFile = vi.fn<(path: string, encoding: string) => Promise<string>>();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: [string, string]) => mockReadFile(...args),
}));

import { PatchExtractor } from '../patch-extractor';

// ── Mock providerRegistry ─────────────────────────────────────────────────

function createMockProvider(responses: string[]) {
  let callIndex = 0;
  return {
    streamCompletion: vi.fn(async function* () {
      const response = responses[callIndex] ?? '';
      callIndex++;
      yield response;
    }),
  };
}

vi.mock('../../providers/registry', () => ({
  providerRegistry: {
    get: vi.fn(),
  },
}));

import { providerRegistry } from '../../providers/registry';

// ── Test setup ────────────────────────────────────────────────────────────

const PROJECT_FOLDER = path.resolve('/tmp/test-project');

describe('PatchExtractor', () => {
  let extractor: PatchExtractor;

  beforeEach(() => {
    extractor = new PatchExtractor({ parseRetryLimit: 2 });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── parseFileEntries (unit) ───────────────────────────────────────────

  describe('parseFileEntries', () => {
    it('parses valid JSON with file entries', () => {
      const json = JSON.stringify({
        files: [
          { path: 'src/main.ts', operation: 'modify', content: 'new content' },
          { path: 'src/new.ts', operation: 'create', content: 'created' },
          { path: 'src/old.ts', operation: 'delete' },
        ],
      });

      const result = extractor.parseFileEntries(json);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ path: 'src/main.ts', operation: 'modify', content: 'new content' });
      expect(result[2]).toEqual({ path: 'src/old.ts', operation: 'delete' });
    });

    it('extracts JSON from surrounding text', () => {
      const text = 'Here is the result:\n' + JSON.stringify({ files: [{ path: 'a.ts', operation: 'create', content: 'x' }] }) + '\nDone.';
      const result = extractor.parseFileEntries(text);
      expect(result).toHaveLength(1);
    });

    it('throws on missing files array', () => {
      expect(() => extractor.parseFileEntries('{}')).toThrow('"files" array is required');
    });

    it('throws on missing path', () => {
      const json = JSON.stringify({ files: [{ operation: 'create', content: 'x' }] });
      expect(() => extractor.parseFileEntries(json)).toThrow('file entry "path" is required');
    });

    it('throws on invalid operation', () => {
      const json = JSON.stringify({ files: [{ path: 'a.ts', operation: 'rename', content: 'x' }] });
      expect(() => extractor.parseFileEntries(json)).toThrow('file entry "operation" must be');
    });

    it('throws on missing content for create', () => {
      const json = JSON.stringify({ files: [{ path: 'a.ts', operation: 'create' }] });
      expect(() => extractor.parseFileEntries(json)).toThrow('file entry "content" is required');
    });

    it('allows missing content for delete', () => {
      const json = JSON.stringify({ files: [{ path: 'a.ts', operation: 'delete' }] });
      const result = extractor.parseFileEntries(json);
      expect(result).toHaveLength(1);
    });

    it('throws when no JSON object found', () => {
      expect(() => extractor.parseFileEntries('no json here')).toThrow('no JSON object found');
    });
  });

  // ── extract (integration) ─────────────────────────────────────────────

  describe('extract', () => {
    it('returns null when provider not found', async () => {
      vi.mocked(providerRegistry.get).mockReturnValue(undefined);

      const result = await extractor.extract('proposal', 'unknown-id', 'conv-1', PROJECT_FOLDER);
      expect(result).toBeNull();
    });

    it('extracts PatchSet from valid AI response', async () => {
      const aiResponse = JSON.stringify({
        files: [{ path: 'src/new-file.ts', operation: 'create', content: 'console.log("hello");' }],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('create a file', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].operation).toBe('create');
      expect(result!.entries[0].targetPath).toBe(path.resolve(PROJECT_FOLDER, 'src/new-file.ts'));
      expect(result!.entries[0].newContent).toBe('console.log("hello");');
      expect(result!.aiId).toBe('ai-1');
      expect(result!.conversationId).toBe('conv-1');
      expect(result!.dryRun).toBe(true);
    });

    it('retries on parse failure and succeeds', async () => {
      const badResponse = 'not valid json';
      const goodResponse = JSON.stringify({
        files: [{ path: 'a.ts', operation: 'create', content: 'ok' }],
      });
      const mockProvider = createMockProvider([badResponse, goodResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      // Should have been called twice (first attempt + retry)
      expect(mockProvider.streamCompletion).toHaveBeenCalledTimes(2);
    });

    it('returns null after all retries fail', async () => {
      const mockProvider = createMockProvider(['bad', 'bad', 'bad']);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).toBeNull();
      // 1 initial + 2 retries = 3 calls
      expect(mockProvider.streamCompletion).toHaveBeenCalledTimes(3);
    });

    it('returns null when AI returns empty files array', async () => {
      const aiResponse = JSON.stringify({ files: [] });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);
      expect(result).toBeNull();
    });

    it('skips entries with path traversal', async () => {
      const aiResponse = JSON.stringify({
        files: [
          { path: '../../etc/passwd', operation: 'create', content: 'evil' },
          { path: 'src/safe.ts', operation: 'create', content: 'safe' },
        ],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].targetPath).toBe(path.resolve(PROJECT_FOLDER, 'src/safe.ts'));
    });

    it('fills originalContent for modify when file exists', async () => {
      const existingContent = 'old content';
      mockReadFile.mockResolvedValue(existingContent);

      const aiResponse = JSON.stringify({
        files: [{ path: 'src/existing.ts', operation: 'modify', content: 'new content' }],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries[0].originalContent).toBe('old content');
      expect(result!.entries[0].newContent).toBe('new content');
      expect(result!.entries[0].operation).toBe('modify');
    });

    it('converts modify to create when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const aiResponse = JSON.stringify({
        files: [{ path: 'src/missing.ts', operation: 'modify', content: 'new' }],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries[0].operation).toBe('create');
    });

    it('fills originalContent for delete when file exists', async () => {
      mockReadFile.mockResolvedValue('to be deleted');

      const aiResponse = JSON.stringify({
        files: [{ path: 'src/remove.ts', operation: 'delete' }],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      expect(result).not.toBeNull();
      expect(result!.entries[0].originalContent).toBe('to be deleted');
      expect(result!.entries[0].operation).toBe('delete');
    });

    it('skips delete when file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      const aiResponse = JSON.stringify({
        files: [{ path: 'src/nonexistent.ts', operation: 'delete' }],
      });
      const mockProvider = createMockProvider([aiResponse]);
      vi.mocked(providerRegistry.get).mockReturnValue(mockProvider as never);

      const result = await extractor.extract('proposal', 'ai-1', 'conv-1', PROJECT_FOLDER);

      // All entries skipped → null
      expect(result).toBeNull();
    });
  });
});
