import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { startFakeProvider } from './support/fake-provider';
import { launchIsolatedApp, type IsolatedApp } from './support/isolated-app';

test('bundled fonts and saved themes load under the production CSP', async () => {
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const cspErrors: string[] = [];
    const remoteFonts: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('Content Security Policy')) {
        cspErrors.push(message.text().replace(/data:font\/[^']+/, 'data:font/[omitted]'));
      }
    });
    page.on('request', (request) => {
      if (request.resourceType() === 'font' && /^https?:/.test(request.url())) remoteFonts.push(request.url());
    });
    await page.evaluate(() => {
      localStorage.setItem('rolestra.theme.v1', JSON.stringify({
        version: 1, state: { themeKey: 'retro', mode: 'light' },
      }));
    });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'retro');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
    const loadedFontCounts = await page.evaluate(async () => {
      const loaded = await Promise.all([
        document.fonts.load('400 14px "IBM Plex Sans KR"', 'Rolestra 안녕'),
        document.fonts.load('600 20px "Space Grotesk"', 'Rolestra'),
        document.fonts.load('400 14px "JetBrains Mono"', 'Rolestra'),
        document.fonts.load('400 14px "Nanum Gothic Coding"', '안녕'),
      ]);
      await document.fonts.ready;
      return loaded.map((faces) => faces.length);
    });
    for (const count of loadedFontCounts) expect(count).toBeGreaterThan(0);
    expect(cspErrors).toEqual([]);
    expect(remoteFonts).toEqual([]);
    expect(await page.evaluate(() => {
      let errors = 0;
      document.fonts.forEach((font) => { if (font.status === 'error') errors += 1; });
      return errors;
    })).toBe(0);
  } finally {
    if (isolated) await isolated.app.close();
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});
