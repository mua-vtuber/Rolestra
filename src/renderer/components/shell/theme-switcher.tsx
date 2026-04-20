/**
 * DevThemeSwitcher — D3 C안 구현.
 *
 * `import.meta.env.DEV` 에서만 렌더되는 개발 편의 드롭다운.
 * 프로덕션 빌드에서는 컴파일 타임에 제거된다(Vite가 condition을 상수 fold).
 *
 * 사용자 대면 테마 전환은 R10 설정 탭이 정식 경로.
 */

import { useTranslation } from 'react-i18next';

import { THEME_MATRIX, type ThemeKey, type ThemeMode } from '../../theme/theme-tokens';
import { useThemeStore } from '../../theme/theme-store';

export function DevThemeSwitcher() {
  const { t } = useTranslation();
  const themeKey = useThemeStore((s) => s.themeKey);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    const [nextKey, nextMode] = event.target.value.split('-') as [ThemeKey, ThemeMode];
    setTheme(nextKey);
    setMode(nextMode);
  };

  return (
    <label
      aria-label={t('theme.switcher.label', 'Theme')}
      data-testid="dev-theme-switcher"
      className="flex items-center gap-1.5 text-xs text-fg-muted"
    >
      <span className="font-mono uppercase tracking-wide">{t('theme.switcher.label', 'Theme')}</span>
      <select
        value={`${themeKey}-${mode}`}
        onChange={handleChange}
        className="bg-elev text-fg border border-border rounded-panel px-2 py-1 text-xs"
      >
        {THEME_MATRIX.map((entry) => (
          <option key={entry.key} value={entry.key}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}
