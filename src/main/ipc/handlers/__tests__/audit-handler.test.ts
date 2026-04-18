import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditEntry } from '../../../../shared/execution-types';

import {
  setAuditLogAccessor,
  handleAuditList,
  handleAuditClear,
} from '../audit-handler';

// ── Test Data ─────────────────────────────────────────────────────────

function makeEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    operationId: 'op-001',
    aiId: 'gpt-4o',
    action: 'write',
    targetPath: '/project/src/index.ts',
    timestamp: 1700000000000,
    result: 'success',
    rollbackable: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('audit-handler', () => {
  const mockGetEntries = vi.fn<(filter?: unknown) => AuditEntry[]>();
  const mockClear = vi.fn();
  let mockSize: number;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSize = 0;

    setAuditLogAccessor(() => ({
      getEntries: mockGetEntries,
      clear: mockClear,
      get size() { return mockSize; },
    }) as never);
  });

  describe('handleAuditList', () => {
    it('returns all entries when no filters', () => {
      const entries = [makeEntry(), makeEntry({ operationId: 'op-002' })];
      mockGetEntries.mockReturnValue(entries);

      const result = handleAuditList({} as never);

      expect(result.entries).toHaveLength(2);
      expect(mockGetEntries).toHaveBeenCalledWith(undefined);
    });

    it('passes aiId filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleAuditList({ aiId: 'claude-3' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ aiId: 'claude-3' }));
    });

    it('passes action filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleAuditList({ action: 'execute' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ action: 'execute' }));
    });

    it('passes result filter', () => {
      mockGetEntries.mockReturnValue([]);

      handleAuditList({ result: 'denied' } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ result: 'denied' }));
    });

    it('applies limit by slicing from end', () => {
      const entries = [
        makeEntry({ operationId: 'op-1' }),
        makeEntry({ operationId: 'op-2' }),
        makeEntry({ operationId: 'op-3' }),
      ];
      mockGetEntries.mockReturnValue(entries);

      const result = handleAuditList({ limit: 2 } as never);

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].operationId).toBe('op-2');
      expect(result.entries[1].operationId).toBe('op-3');
    });

    it('passes time range filters', () => {
      mockGetEntries.mockReturnValue([]);

      handleAuditList({ since: 1000, until: 2000 } as never);

      expect(mockGetEntries).toHaveBeenCalledWith(expect.objectContaining({ since: 1000, until: 2000 }));
    });
  });

  describe('handleAuditClear', () => {
    it('returns cleared count and calls clear', () => {
      mockSize = 5;

      const result = handleAuditClear();

      expect(result.cleared).toBe(5);
      expect(mockClear).toHaveBeenCalledOnce();
    });

    it('returns 0 when log is empty', () => {
      mockSize = 0;

      const result = handleAuditClear();

      expect(result.cleared).toBe(0);
      expect(mockClear).toHaveBeenCalledOnce();
    });
  });

  describe('accessor guard', () => {
    it('returns empty entries when accessor not set', () => {
      // Reset the accessor
      setAuditLogAccessor(null as never);

      const result = handleAuditList({} as never);
      expect(result.entries).toEqual([]);
    });

    it('returns cleared 0 when accessor not set', () => {
      setAuditLogAccessor(null as never);

      const result = handleAuditClear();
      expect(result.cleared).toBe(0);
    });
  });
});
