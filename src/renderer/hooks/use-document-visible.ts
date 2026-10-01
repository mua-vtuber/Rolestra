/**
 * Whether the app window is showing (`document.visibilityState`), live.
 * The open conversation is marked read only while the user can see it
 * (spec 2026-10-01-messenger-redesign.md R4-3).
 */
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function readVisible(): boolean {
  return document.visibilityState !== 'hidden';
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, readVisible);
}
