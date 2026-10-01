import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { startFakeProvider } from './support/fake-provider';
import { launchIsolatedApp, type IsolatedApp } from './support/isolated-app';
import { navButton } from './support/messenger-ui';

interface GoogleListProbe {
  mode: 'models' | 'auth' | 'empty';
  requests: Array<{ token: string | null; apiKey: string | null; keyInUrl: boolean }>;
}

test('Gemini selector shows only reviewed live chat models across all pages', async () => {
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Only this isolated process substitutes Google's metadata response.
    // Any attempted generation request is rejected: no real API calls or keys.
    await isolated.app.evaluate(() => {
      const scope = globalThis as typeof globalThis & { googleListProbe?: GoogleListProbe };
      const probe: GoogleListProbe = { mode: 'models', requests: [] };
      scope.googleListProbe = probe;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(input, init);
        if (url.pathname !== '/v1beta/models') throw new Error('Unexpected Google request in isolated model-list test');
        const token = url.searchParams.get('pageToken');
        probe.requests.push({ token, apiKey: new Headers(init?.headers).get('x-goog-api-key'), keyInUrl: url.searchParams.has('key') });
        if (probe.mode === 'auth') return new Response('{}', { status: 403 });
        if (probe.mode === 'empty') return Response.json({ models: [] });
        const model = (name: string) => ({ name: `models/${name}`, supportedGenerationMethods: ['generateContent'] });
        return token === 'second-page'
          ? Response.json({ models: [model('gemini-3.8-flash'), model('gemini-3.8-flash-tts')] })
          : Response.json({ models: [model('gemini-2.5-flash'), model('gemini-3.5-flash-lite'), model('gemini-3-pro-image')], nextPageToken: 'second-page' });
      };
    });
    await navButton(page, 'settings').click();
    await page.locator('[data-testid="settings-tabs-trigger"][data-tab="ai"]').click();
    await page.getByTestId('settings-ai-add').click();
    await page.getByTestId('provider-connect-service-google').click();
    await page.getByTestId('provider-connect-secret').fill('gemini-fixture-key');
    await page.getByTestId('provider-connect-load-models').click();
    const select = page.getByTestId('provider-connect-model-select');
    await expect(select.locator('option')).toHaveText(['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    await expect(page.getByTestId('provider-connect-submit')).toBeEnabled();
    expect(await isolated.app.evaluate(() => (
      globalThis as typeof globalThis & { googleListProbe: GoogleListProbe }
    ).googleListProbe.requests)).toEqual([
      { token: null, apiKey: 'gemini-fixture-key', keyInUrl: false },
      { token: 'second-page', apiKey: 'gemini-fixture-key', keyInUrl: false },
    ]);

    await isolated.app.evaluate(() => {
      (globalThis as typeof globalThis & { googleListProbe: GoogleListProbe }).googleListProbe.mode = 'auth';
    });
    await page.getByTestId('provider-connect-load-models').click();
    await expect(page.getByTestId('provider-connect-model-list-error')).toBeVisible();
    await expect(select).toHaveCount(0);
    await expect(page.getByTestId('provider-connect-submit')).toBeDisabled();

    await isolated.app.evaluate(() => {
      (globalThis as typeof globalThis & { googleListProbe: GoogleListProbe }).googleListProbe.mode = 'empty';
    });
    await page.getByTestId('provider-connect-load-models').click();
    await expect(page.getByTestId('provider-connect-model-list-empty')).toBeVisible();
    await expect(select).toHaveCount(0);
    await expect(page.getByTestId('provider-connect-submit')).toBeDisabled();
  } finally {
    if (isolated) await isolated.app.close();
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});
