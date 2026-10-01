/**
 * QA High-2 (2026-10-01): with the API key screen gone, a key whose AI no
 * longer exists (or whose add attempt failed to clean up) is found and
 * deleted at startup — only keys in the app's own `provider-<uuid>` form,
 * only when no stored AI row uses them.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ProviderRow } from '../provider-repository';
import { releaseOrphanApiKeys } from '../orphan-api-keys';

const USED = 'provider-0f8e2a4c-1b2d-4e3f-8a9b-0c1d2e3f4a5b';
const ORPHAN = 'provider-9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d';
const SECOND_ORPHAN = 'provider-11111111-2222-4333-8444-555555555555';

function row(id: string, config: unknown): ProviderRow {
  return { id, configJson: JSON.stringify(config) } as ProviderRow;
}

describe('releaseOrphanApiKeys', () => {
  it('deletes app keys no stored AI uses and keeps the ones in use', () => {
    const deleteSecret = vi.fn();
    const result = releaseOrphanApiKeys({
      secretKeys: () => [USED, ORPHAN, SECOND_ORPHAN],
      rows: () => [row('a', { type: 'api', endpoint: 'https://x/v1', apiKeyRef: USED, model: 'm' })],
      deleteSecret,
    });
    expect(result).toEqual({ removed: [ORPHAN, SECOND_ORPHAN], failed: [] });
    expect(deleteSecret.mock.calls.map(([key]) => key)).toEqual([ORPHAN, SECOND_ORPHAN]);
  });

  it('never touches a secret that is not in the app\'s own key form', () => {
    const deleteSecret = vi.fn();
    const result = releaseOrphanApiKeys({
      secretKeys: () => ['openai-key', 'provider-not-a-uuid', 'PROVIDER-0F8E2A4C-1B2D-4E3F-8A9B-0C1D2E3F4A5B', 'remote_token'],
      rows: () => [],
      deleteSecret,
    });
    expect(result).toEqual({ removed: [], failed: [] });
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  it('keeps a key a broken-but-recoverable row still mentions', () => {
    const deleteSecret = vi.fn();
    releaseOrphanApiKeys({
      secretKeys: () => [ORPHAN],
      rows: () => [{ id: 'broken', configJson: `{"type":"api","apiKeyRef":"${ORPHAN}"` } as ProviderRow],
      deleteSecret,
    });
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  it('reports each failed delete and carries on with the rest', () => {
    const deleteSecret = vi.fn((key: string) => {
      if (key === ORPHAN) throw new Error('secrets file is read-only');
    });
    const result = releaseOrphanApiKeys({ secretKeys: () => [ORPHAN, SECOND_ORPHAN], rows: () => [], deleteSecret });
    expect(result).toEqual({
      removed: [SECOND_ORPHAN],
      failed: [{ ref: ORPHAN, message: 'secrets file is read-only' }],
    });
  });

  it('deletes nothing when the stored AIs cannot be read', () => {
    const deleteSecret = vi.fn();
    expect(() => releaseOrphanApiKeys({
      secretKeys: () => [ORPHAN],
      rows: () => { throw new Error('database is locked'); },
      deleteSecret,
    })).toThrow('database is locked');
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});
