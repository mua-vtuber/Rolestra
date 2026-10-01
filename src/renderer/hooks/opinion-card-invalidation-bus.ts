const listeners = new Set<(channelId: string) => void>();

export function subscribeOpinionCardsChanged(listener: (channelId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyOpinionCardsChanged(channelId: string): void {
  for (const listener of listeners) listener(channelId);
}
