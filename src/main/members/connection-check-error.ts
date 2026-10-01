/**
 * A failed connection check carried to the member layer (QA Medium-1).
 * Providers record why their last warm-up check failed
 * (`BaseProvider.connectionFailure`); the warm-up lookup turns that into
 * this error so `MemberProfileService.reconnect` keeps the cause with the
 * member's status.
 */
import type { ConnectionFailure } from '../../shared/connection-failure-types';
import type { BaseProvider } from '../providers/provider-interface';

export class ConnectionCheckError extends Error {
  constructor(public readonly failure: ConnectionFailure) {
    super(`Connection check failed: ${failure.code}${failure.detail === null ? '' : ` (${failure.detail})`}`);
    this.name = 'ConnectionCheckError';
  }
}

/** Warms the provider up and throws {@link ConnectionCheckError} when its check failed. */
export async function warmupOrThrow(provider: Pick<BaseProvider, 'warmup' | 'connectionFailure'>): Promise<void> {
  await provider.warmup();
  const failure = provider.connectionFailure;
  if (failure !== null) throw new ConnectionCheckError(failure);
}
