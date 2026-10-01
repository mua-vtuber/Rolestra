import { expect, test } from '@playwright/test';
import { rm } from 'node:fs/promises';

import { startFakeProvider } from './support/fake-provider';
import { launchIsolatedApp, type IsolatedApp } from './support/isolated-app';
import { navButton } from './support/messenger-ui';

test('theme card captions keep their own colors, typography and dimensions when the active theme changes', async ({}, testInfo) => {
  const fake = await startFakeProvider();
  let isolated: IsolatedApp | null = null;
  try {
    isolated = await launchIsolatedApp({ ollamaHost: fake.baseUrl });
    const page = await isolated.app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await navButton(page, 'settings').click();
    const cards = page.getByTestId('settings-theme-card');
    const captionPixels = (label: string) => Promise.all([0, 1].map(async (index) => {
      const box = (await cards.nth(index).locator(':scope > span').nth(1).boundingBox())!;
      // Exclude the chamfered corner, where the surrounding app shows through.
      const inset = 8;
      return page.screenshot({ path: testInfo.outputPath(`${label}-caption-${index}.png`),
        clip: { x: box.x + inset, y: box.y + inset, width: box.width - inset * 2, height: box.height - inset * 2 } });
    }));
    const measure = async () => {
      await page.evaluate(async () => { await document.fonts.ready; });
      return cards.evaluateAll((elements) => elements.map((card) => {
        const caption = card.children[1]!;
        const box = card.getBoundingClientRect();
        const captionStyle = getComputedStyle(caption);
        const style = getComputedStyle(card);
        return {
          theme: card.getAttribute('data-key'), width: box.width, height: box.height,
          background: style.backgroundColor, backgroundImage: style.backgroundImage,
          clipPath: style.clipPath, borderWidth: style.borderWidth,
          caption: { gap: captionStyle.gap, padding: captionStyle.padding,
            height: caption.getBoundingClientRect().height },
          text: Array.from(caption.children).map((element) => {
            const text = getComputedStyle(element);
            return { color: text.color, font: text.fontFamily, size: text.fontSize,
              weight: text.fontWeight, lineHeight: text.lineHeight, spacing: text.letterSpacing,
              width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height };
          }),
        };
      }));
    };
    for (const mode of ['dark', 'light']) {
      await page.locator(`[data-testid="settings-brightness-option"][data-mode="${mode}"]`).click();
      await cards.filter({ has: page.locator('[data-layout="bubbles"]') }).click();
      const tacticalActive = await measure();
      const tacticalCaptions = await captionPixels(`${mode}-tactical`);
      await page.getByTestId('settings-theme').screenshot({ path: testInfo.outputPath(`${mode}-tactical-active.png`) });
      await cards.filter({ has: page.locator('[data-layout="log"]') }).click();
      const retroActive = await measure();
      const retroCaptions = await captionPixels(`${mode}-retro`);
      await page.getByTestId('settings-theme').screenshot({ path: testInfo.outputPath(`${mode}-retro-active.png`) });
      expect(retroActive).toEqual(tacticalActive);
      for (const index of [0, 1]) {
        expect(retroCaptions[index]!.equals(tacticalCaptions[index]!), `${mode} caption ${index}`).toBe(true);
      }
      await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
    }
  } finally {
    if (isolated) await isolated.app.close();
    await fake.close();
    if (isolated) await rm(isolated.tempRoot, { recursive: true, force: true });
  }
});

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
