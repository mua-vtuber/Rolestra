/**
 * Type scale per theme (tools/theme TYPE_SCALE + typeScaleOffset): tactical
 * uses the mockup sizes, retro is 1px smaller at every step because its mono
 * fonts draw larger glyphs at the same size (user decision 2026-10-01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKENS_CSS = readFileSync(join(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');

const STEPS = ['micro', 'meta', 'preview', 'body', 'row-title', 'room-title', 'dialog-title', 'list-title', 'page-title'];

function sizesFor(selector: string): Record<string, number> {
  const start = TOKENS_CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css has no block ${selector}`);
  const block = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf('}', start));
  return Object.fromEntries(STEPS.map((step) => {
    const match = new RegExp(`--text-${step}: (\\d+)px;`).exec(block);
    if (!match) throw new Error(`${selector} has no --text-${step}`);
    return [step, Number(match[1])];
  }));
}

describe('type scale tokens', () => {
  const tactical = sizesFor(":root[data-theme='tactical'][data-mode='dark']");

  it('keeps the mockup sizes for tactical', () => {
    expect(tactical).toEqual({
      micro: 11, meta: 12, preview: 13, body: 14, 'row-title': 15,
      'room-title': 17, 'dialog-title': 20, 'list-title': 22, 'page-title': 24,
    });
    expect(sizesFor(":root[data-theme='tactical'][data-mode='light']")).toEqual(tactical);
  });

  it.each(['light', 'dark'])('makes every retro %s step 1px smaller than tactical', (mode) => {
    const retro = sizesFor(`:root[data-theme='retro'][data-mode='${mode}']`);
    for (const step of STEPS) expect(retro[step]).toBe(tactical[step]! - 1);
  });
});
