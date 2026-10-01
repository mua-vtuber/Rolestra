/**
 * What the AI add dialog says when something fails (QA High-1/High-2,
 * 2026-10-01): the cause main named (`shared/ipc-error.ts`), translated, or
 * else main's own message line — never only "check your input". Main's
 * error messages carry names, refs, addresses and codes, never key text.
 */
import type { TFunction } from 'i18next';

import { ipcErrorText, readIpcErrorCause } from '../../../../shared/ipc-error';

export interface AddAttempt {
  displayName: string;
  /** The Ollama model a local add asked for; null for CLI / API adds. */
  model: string | null;
}

export function addFailureText(t: TFunction, reason: unknown, attempt: AddAttempt): string {
  switch (readIpcErrorCause(reason)) {
    case 'duplicate-display-name':
      return t('providerConnect.error.duplicateName', { name: attempt.displayName });
    case 'local-ai-not-ready':
      return t('providerConnect.error.localNotReady');
    case 'local-model-missing':
      return t('providerConnect.error.localModelMissing', { model: attempt.model ?? '' });
    case null:
      return t('providerConnect.error.addFailed', { message: ipcErrorText(reason) });
  }
}

/** The key stored for this attempt could not be deleted; the next start deletes it. */
export function keyCleanupFailureText(t: TFunction, reason: unknown): string {
  return t('providerConnect.error.keyCleanupFailed', { message: ipcErrorText(reason) });
}

export function keyStoreFailureText(t: TFunction, reason: unknown): string {
  return t('providerConnect.error.keyStoreFailed', { message: ipcErrorText(reason) });
}

export function modelListFailureText(t: TFunction, reason: unknown): string {
  return t('providerConnect.error.modelListFailed', { message: ipcErrorText(reason) });
}
