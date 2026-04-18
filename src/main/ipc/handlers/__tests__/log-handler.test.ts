import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StructuredLogEntry } from '../../../../shared/log-types';

// Mock LogExporter
const mockExportAsJson = vi.fn<(opts: unknown) => string>();
const mockExportAsMarkdown = vi.fn<(opts: unknown) => string>();

vi.mock('../../../log/log-exporter', () => ({
  LogExporter: vi.fn().mockImplementation(function (this: unknown) {
    (this as Record<string, unknown>).exportAsJson = mockExportAsJson;
    (this as Record<string, unknown>).exportAsMarkdown = mockExportAsMarkdown;
  }),
}));

import {
  setLoggerAccessor,
  handleLogList,
  handleLogExport,
} from '../log-handler';

// ── Test Data ─────────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<StructuredLogEntry>): StructuredLogEntry {
  return {
    level: 'info',
    timestamp: 1700000000000,
    component: 'provider',
    action: 'generate',
    result: 'success',
    latencyMs: 150,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('log-handler', () => {
  const mockGetEntries = vi.fn<(filter?: unknown) => StructuredLogEntry[]>();

  beforeEach(() => {
    vi.clearAllMocks();

    setLoggerAccessor(() => ({
      getEntries: mockGetEntries,
    }) as never);
  });

  describe('handleLogList', () => {
    it('returns all entries when no filters', () => {
      const entries = [makeEntry(), makeEntry({ timestamp: 1700000001000 })];
      mockGetEntries.mockReturnValue(entries);

      const result = handleLogList({} as never);

      expect(result.entries).toHaveLength(2);
      expect(mockGetEntries).toHaveBeenCalledWith(undefined);
    });

    it('passes component filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleLogList({ component: 'consensus' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ component: 'consensus' }));
    });

    it('passes level filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleLogList({ level: 'error' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    });

    it('passes result filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleLogList({ result: 'failure' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ result: 'failure' }));
    });

    it('passes time range filters', () => {
      mockGetEntries.mockReturnValue([]);

      handleLogList({ startTime: 1000, endTime: 2000 } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ startTime: 1000, endTime: 2000 }));
    });

    it('applies limit by slicing from end', () => {
      const entries = [
        makeEntry({ timestamp: 1 }),
        makeEntry({ timestamp: 2 }),
        makeEntry({ timestamp: 3 }),
      ];
      mockGetEntries.mockReturnValue(entries);

      const result = handleLogList({ limit: 2 } as never);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].timestamp).toBe(2);
      expect(result.entries[1].timestamp).toBe(3);
    });
  });

  describe('handleLogExport', () => {
    it('exports as JSON', () => {
      mockExportAsJson.mockReturnValue('[{"level":"info"}]');

      const result = handleLogExport({ format: 'json', maskSecrets: true } as never);

      expect(mockExportAsJson).toHaveBeenCalledOnce();
      expect(result.content).toBe('[{"level":"info"}]');
      expect(result.filename).toMatch(/^arena-log-\d+\.json$/);
    });

    it('exports as Markdown', () => {
      mockExportAsMarkdown.mockReturnValue('# Logs');

      const result = handleLogExport({ format: 'markdown', maskSecrets: false } as never);

      expect(mockExportAsMarkdown).toHaveBeenCalledOnce();
      expect(result.content).toBe('# Logs');
      expect(result.filename).toMatch(/^arena-log-\d+\.md$/);
    });

    it('passes filter options to exporter', () => {
      mockExportAsJson.mockReturnValue('[]');

      handleLogExport({
        format: 'json',
        maskSecrets: true,
        component: 'execution',
        result: 'failure',
        startTime: 1000,
        endTime: 2000,
      } as never);

      expect(mockExportAsJson).toHaveBeenCalledWith(expect.objectContaining({
        format: 'json',
        maskSecrets: true,
        component: 'execution',
        result: 'failure',
        startTime: 1000,
        endTime: 2000,
      }));
    });
  });

  describe('accessor guard', () => {
    it('throws if accessor not set', () => {
      setLoggerAccessor(null as never);

      expect(() => handleLogList({} as never)).toThrow('StructuredLogger accessor not initialized');
    });
  });
});
