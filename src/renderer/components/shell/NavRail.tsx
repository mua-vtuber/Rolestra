import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../theme/use-theme';
import { LineIcon, type IconName } from './LineIcon';

export interface NavRailItem {
  id: string;
  icon: IconName;
  label: string;
  badge?: number;
}

export interface NavRailProps {
  items: ReadonlyArray<NavRailItem>;
  activeId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export function NavRail({ items, activeId, onSelect, className }: NavRailProps) {
  const { token } = useTheme();
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('shell.nav.ariaLabel', 'primary navigation')}
      data-testid="nav-rail"
      className={clsx(
        'flex flex-col items-center gap-2 py-3 w-16 shrink-0 bg-rail-bg border-r border-border',
        className
      )}
    >
      <div
        aria-hidden
        className="w-10 h-10 flex items-center justify-center rounded-panel bg-logo-bg text-logo-fg shadow-logo font-display font-bold"
      >
        {token.useLineIcons ? <LineIcon name="dashboard" stroke={1.4} /> : 'R'}
      </div>
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={onSelect ? () => onSelect(item.id) : undefined}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-active={isActive || undefined}
            className={clsx(
              'relative w-10 h-10 flex items-center justify-center rounded-panel transition-colors',
              isActive
                ? 'bg-icon-active-bg text-icon-active-fg shadow-icon'
                : 'text-icon-fg hover:text-fg'
            )}
          >
            <LineIcon name={item.icon} stroke={1.6} />
            {item.badge && item.badge > 0 ? (
              <span
                aria-label={`${item.label} ${item.badge}`}
                className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 text-[8px] font-bold font-mono flex items-center justify-center rounded-full bg-badge-bg text-badge-fg"
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
