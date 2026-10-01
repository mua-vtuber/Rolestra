import { describe, expect, it, vi } from 'vitest';

import { isApiKeyRefStillReferenced, releaseApiKeyRef } from '../api-key-release';
import type { ProviderRow } from '../provider-repository';

function row(id: string, config: unknown): ProviderRow {
  return {
    id,
    kind: 'api',
    displayName: id,
    persona: null,
    configJson: typeof config === 'string' ? config : JSON.stringify(config),
  } as ProviderRow;
}

const apiRow = (id: string, apiKeyRef: string) =>
  row(id, { type: 'api', endpoint: 'https://api.example.test/v1', apiKeyRef, model: 'm' });

describe('isApiKeyRefStillReferenced', () => {
  it('is true when another API row points at the same ref', () => {
    expect(isApiKeyRefStillReferenced('provider-shared', [apiRow('b', 'provider-shared')])).toBe(true);
  });

  it('is false when no remaining row uses the ref', () => {
    expect(isApiKeyRefStillReferenced('provider-gone', [
      apiRow('b', 'provider-other'),
      row('cli', { type: 'cli', command: 'claude', args: [], model: 'unknown' }),
    ])).toBe(false);
  });

  it('keeps the key for an unreadable row whose stored text still mentions the ref', () => {
    expect(isApiKeyRefStillReferenced('provider-x', [row('broken', '{"apiKeyRef":"provider-x"')])).toBe(true);
    expect(isApiKeyRefStillReferenced('provider-x', [row('broken', '{not json')])).toBe(false);
  });
});

describe('releaseApiKeyRef', () => {
  it('deletes the secret when nothing else references it', () => {
    const deleteSecret = vi.fn();
    const result = releaseApiKeyRef('provider-old', {
      remainingRows: () => [apiRow('b', 'provider-other')],
      deleteSecret,
    });
    expect(result).toEqual({ status: 'deleted' });
    expect(deleteSecret).toHaveBeenCalledWith('provider-old');
  });

  it('keeps a secret another registered AI still uses', () => {
    const deleteSecret = vi.fn();
    const result = releaseApiKeyRef('provider-shared', {
      remainingRows: () => [apiRow('b', 'provider-shared')],
      deleteSecret,
    });
    expect(result).toEqual({ status: 'kept-shared' });
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  it('reports a failed delete as data instead of throwing past the caller', () => {
    const result = releaseApiKeyRef('provider-old', {
      remainingRows: () => [],
      deleteSecret: () => { throw new Error('EACCES: secrets.enc.json'); },
    });
    expect(result).toEqual({ status: 'failed', message: 'EACCES: secrets.enc.json' });
  });

  it('reports a failed reference check (DB read) as failed and deletes nothing', () => {
    const deleteSecret = vi.fn();
    const result = releaseApiKeyRef('provider-old', {
      remainingRows: () => { throw new Error('database is locked'); },
      deleteSecret,
    });
    expect(result).toEqual({ status: 'failed', message: 'database is locked' });
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});
