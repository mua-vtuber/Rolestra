/** The provider rejected a turn because the account's usage allowance is exhausted. */
export class ProviderUsageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUsageLimitError';
  }
}
