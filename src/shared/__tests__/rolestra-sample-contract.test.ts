import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const sampleDir = join(repoRoot, 'docs', 'Rolestra_sample');

const sampleFiles = {
  dashboard: join(sampleDir, '01-dash-variants.jsx'),
  messenger: join(sampleDir, '02-msg-variants.jsx'),
  approvals: join(sampleDir, '03-apv-variants.jsx'),
  queue: join(sampleDir, '04-q-variants.jsx'),
  settings: join(sampleDir, '05-set-variants.jsx'),
  onboarding: join(sampleDir, '06-ob-variants.jsx'),
};

const allowedThemeProps = new Set([
  'themeKey',
  'mode',
  'font',
  'displayFont',
  'monoFont',
  'bgCanvas',
  'bgElev',
  'bgSunk',
  'fg',
  'fgMuted',
  'fgSubtle',
  'border',
  'borderSoft',
  'brand',
  'brandDeep',
  'accent',
  'success',
  'warning',
  'danger',
  'avatarShape',
  'useLineIcons',
  'railBg',
  'railExtra',
  'logoBg',
  'logoFg',
  'logoShadow',
  'iconFg',
  'iconActiveBg',
  'iconActiveFg',
  'iconActiveShadow',
  'badgeBg',
  'badgeFg',
  'unreadBg',
  'unreadFg',
  'projectBg',
  'itemActiveBg',
  'itemActiveFg',
  'topBarBg',
  'topBarBorder',
  'heroBg',
  'heroBorder',
  'heroValue',
  'heroLabel',
  'panelBg',
  'panelHeaderBg',
  'panelBorder',
  'panelShadow',
  'panelRadius',
  'panelClip',
  'insightBg',
  'insightColor',
  'insightBorder',
  'actionPrimaryBg',
  'actionPrimaryFg',
  'actionSecondaryBg',
  'actionSecondaryFg',
  'actionSecondaryBorder',
  'cardTitleStyle',
  'approvalBodyStyle',
  'miniBtnStyle',
  'gaugeGlow',
]);

function readSample(path: string) {
  return readFileSync(path, 'utf8');
}

function extractThemeProps(source: string) {
  return [...source.matchAll(/theme\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
}

describe('Rolestra sample regression contract', () => {
  it('keeps the agreed shared-shell primitives wired into 02~06', () => {
    const dashboard = readSample(sampleFiles.dashboard);
    const messenger = readSample(sampleFiles.messenger);
    const approvals = readSample(sampleFiles.approvals);
    const queue = readSample(sampleFiles.queue);
    const settings = readSample(sampleFiles.settings);
    const onboarding = readSample(sampleFiles.onboarding);

    for (const source of [dashboard, messenger, approvals, queue, settings, onboarding]) {
      expect(source).toContain('<VariantFrame theme={theme}>');
    }

    for (const source of [dashboard, messenger, approvals, queue]) {
      expect(source).toContain('<ProjectRail theme={theme}');
      expect(source).toContain('<NavRail theme={theme}');
    }

    for (const source of [messenger, approvals, queue]) {
      expect(source).toContain('<ShellTopBar theme={theme}');
    }

    expect(settings).toContain('<SetNav theme={theme} />');
    expect(settings).toContain('<NavRail theme={theme} active="settings" />');
    expect(settings).toContain('<ShellTopBar theme={theme}');
    expect(onboarding).not.toContain('<NavRail theme={theme}');
  });

  it('keeps retro NavRail handling aligned with the dashboard shell grammar', () => {
    const dashboard = readSample(sampleFiles.dashboard);
    const messenger = readSample(sampleFiles.messenger);
    const approvals = readSample(sampleFiles.approvals);
    const queue = readSample(sampleFiles.queue);
    const settings = readSample(sampleFiles.settings);

    for (const source of [dashboard, messenger, approvals, queue, settings]) {
      expect(source).not.toContain('{!isRetro && <NavRail theme={theme}');
    }
  });

  it('does not reference undeclared theme props in 01~06 variant files', () => {
    for (const path of Object.values(sampleFiles)) {
      const props = extractThemeProps(readSample(path));
      const unknown = [...new Set(props)].filter((prop) => !allowedThemeProps.has(prop));
      expect(unknown, path).toEqual([]);
    }
  });

  it('keeps onboarding candidate data free of screen-owned color fields', () => {
    const onboarding = readSample(sampleFiles.onboarding);
    const candidateSection = onboarding.match(/const STAFF_CANDIDATES = \[(.*?)\n];/s)?.[1] ?? '';

    expect(candidateSection).not.toMatch(/\bcolor:\s*['"]/);
    expect(onboarding).not.toContain('cand.color');
  });

  it('avoids hardcoded control surface white in settings toggles', () => {
    const settings = readSample(sampleFiles.settings);

    expect(settings).not.toContain("background: '#fff'");
  });

  it('keeps the newly agreed retro and localization polish rules', () => {
    const dashboard = readSample(sampleFiles.dashboard);
    const messenger = readSample(sampleFiles.messenger);
    const queue = readSample(sampleFiles.queue);
    const settings = readSample(sampleFiles.settings);
    const onboarding = readSample(sampleFiles.onboarding);

    expect(messenger).not.toContain('DMS.slice(0, 4)');
    expect(messenger).not.toContain("member.cli?.replace('ℛ/', '') || member.name");

    expect(queue).toContain("clipPath: 'polygon(0 0, calc(100% - 3px) 0, 100% 50%, calc(100% - 3px) 100%, 0 100%, 3px 50%)'");
    expect(queue).toContain("{'█'.repeat(");

    expect(settings).toContain("[${option.label}]");
    expect(settings).toContain("options={['자동', '혼합', '수동']}");
    expect(settings).not.toContain("options={['auto', 'hybrid', 'manual']}");
    expect(settings).not.toContain("'hybrid'");
    expect(settings).not.toContain("'manual'");
    expect(settings).toContain("key1={isRetro ? '편집' : 'E'}");
    expect(settings).toContain("<span style={{ fontWeight: 700 }}>{m.name}</span>");
    expect(settings).toContain("<span style={{ color: theme.fgMuted }}> · {m.cli}</span>");

    expect(onboarding).toContain("[{sel ? 'x' : '-'}]");
    expect(onboarding).toContain('선택[');

    expect(dashboard).toContain("animation: 'dashCursor 1.06s infinite step-end'");
    expect(queue).toContain('done[');
    expect(queue).toContain("animation: 'dashCursor 1.06s infinite step-end'");
    expect(settings).toContain('직원[');
    expect(settings).toContain('근무시간[09-18]');
    expect(settings).toContain("animation: 'dashCursor 1.06s infinite step-end'");
    expect(onboarding).toContain("animation: 'dashCursor 1.06s infinite step-end'");
  });
});
