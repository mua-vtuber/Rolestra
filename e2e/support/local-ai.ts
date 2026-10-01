/**
 * Adds a test AI the way the app adds any local AI (QA Minor 1: manual
 * local address entry is gone): the fake Ollama lists the model, then
 * `provider:add-local` lets main find it at `OLLAMA_HOST` (the fake's
 * address, `support/isolated-app.ts`) and register it.
 */
import type { Page } from '@playwright/test';

import type { FakeProvider } from './fake-provider';
import { invokeInApp } from './isolated-app';

export interface AddedLocalAi {
  id: string;
  displayName: string;
}

export async function addLocalAi(page: Page, fake: FakeProvider, displayName: string, model: string): Promise<AddedLocalAi> {
  fake.offerOllamaModel(model);
  const { provider } = await invokeInApp(page, 'provider:add-local', { displayName, model });
  return { id: provider.id, displayName: provider.displayName };
}
