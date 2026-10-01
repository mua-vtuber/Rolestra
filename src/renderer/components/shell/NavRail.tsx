/**
 * NavRail — the left vertical menu (spec 2026-10-01-messenger-redesign.md
 * R2-1): logo, the main views (채팅, AI 목록), a spacer, then `bottomItems`
 * (설정). Each button carries `data-nav-id` for its view id.
 */
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
  /** Pinned to the bottom of the rail, below a spacer. */
  bottomItems?: ReadonlyArray<NavRailItem>;
  activeId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

function NavButton({ item, active, onSelect }: {
  item: NavRailItem;
  active: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-nav-id={item.id}
      onClick={onSelect ? () => onSelect(item.id) : undefined}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      className={clsx(
        'relative flex h-11 w-11 items-center justify-center border transition-colors [clip-path:var(--clip-control)]',
        active
          ? 'border-brand bg-icon-active-bg text-icon-active-fg shadow-icon'
          : 'border-transparent text-icon-fg hover:text-fg',
      )}
    >
      <LineIcon name={item.icon} size={20} stroke={1.6} />
      {item.badge && item.badge > 0 ? (
        <span
          aria-label={`${item.label} ${item.badge}`}
          className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-badge-bg px-1 font-mono text-[8px] font-bold text-badge-fg"
        >
          {item.badge}
        </span>
      ) : null}
    </button>
  );
}

export function NavRail({ items, bottomItems = [], activeId, onSelect, className }: NavRailProps) {
  const { token } = useTheme();
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('shell.nav.ariaLabel', 'primary navigation')}
      data-testid="nav-rail"
      className={clsx(
        'flex w-16 shrink-0 flex-col items-center gap-2.5 border-r border-border-soft bg-rail-bg py-4',
        className,
      )}
    >
      <div
        aria-hidden
        className="mb-3 flex h-10 w-10 items-center justify-center bg-logo-bg font-display font-bold text-logo-fg shadow-logo [clip-path:var(--clip-control)]"
      >
        {token.useLineIcons ? <LineIcon name="dashboard" stroke={1.4} /> : 'R'}
      </div>
      {items.map((item) => (
        <NavButton key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
      ))}
      <div className="flex-1" aria-hidden />
      {bottomItems.map((item) => (
        <NavButton key={item.id} item={item} active={item.id === activeId} onSelect={onSelect} />
      ))}
    </nav>
  );
}
