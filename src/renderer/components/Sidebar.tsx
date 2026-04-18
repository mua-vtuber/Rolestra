/**
 * Navigation sidebar with view switching.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, type AppView } from '../stores/app-store';
import { useProviderStore } from '../stores/provider-store';

const navItems: { view: AppView; labelKey: string }[] = [
  { view: 'chat', labelKey: 'nav.chat' },
  { view: 'settings', labelKey: 'nav.settings' },
];

export function Sidebar(): React.JSX.Element {
  const { t } = useTranslation();
  const currentView = useAppStore((s) => s.currentView);
  const setView = useAppStore((s) => s.setView);
  const appInfo = useAppStore((s) => s.appInfo);
  const providers = useProviderStore((s) => s.providers);
  const selectedProviderIds = useProviderStore((s) => s.selectedProviderIds);
  const tokenUsageByProvider = useProviderStore((s) => s.tokenUsageByProvider);
  const fetchProviders = useProviderStore((s) => s.fetchProviders);
  const toggleProviderSelection = useProviderStore((s) => s.toggleProviderSelection);

  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  return (
    <nav className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="sidebar-header">
        <button
          onClick={toggleCollapse}
          className="sidebar-toggle"
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-label={collapsed ? 'expand' : 'collapse'}
        >
          {collapsed ? '\u25B6' : '\u25C0'}
        </button>
        {!collapsed && (
          <>
            <strong>{t('app.title')}</strong>
            {appInfo && (
              <div className="sidebar-version">{appInfo.version}</div>
            )}
          </>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.view}
                onClick={() => setView(item.view)}
                className={`sidebar-nav-btn${currentView === item.view ? ' active' : ''}`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>

          <div className="sidebar-participants">
            <div className="sidebar-participants-title">
              {t('chat.participants')}
            </div>
            {providers.length === 0 ? (
              <div className="sidebar-participants-empty">
                {t('chat.emptyState')}
              </div>
            ) : (
              <div className="sidebar-participants-list">
                {providers.map((provider) => (
                  <div
                    key={provider.id}
                    className="sidebar-provider-label"
                  >
                    <button
                      type="button"
                      onClick={() => toggleProviderSelection(provider.id)}
                      className={`chip sidebar-provider-chip${(selectedProviderIds ?? []).includes(provider.id) ? ' active' : ''}`}
                      title={provider.displayName}
                    >
                      {provider.displayName}
                    </button>
                    <span
                      className="sidebar-provider-tokens"
                      title={
                        tokenUsageByProvider[provider.id]
                          ? (tokenUsageByProvider[provider.id].usageSource === 'unknown'
                            ? t('provider.tokenUsageUnknown')
                            : t('provider.tokenUsageDetail', {
                                input: tokenUsageByProvider[provider.id].inputTokens?.toLocaleString() ?? '0',
                                output: tokenUsageByProvider[provider.id].outputTokens?.toLocaleString() ?? '0',
                                source: tokenUsageByProvider[provider.id].usageSource,
                              }))
                          : t('provider.tokenUsageNone')
                      }
                    >
                      {tokenUsageByProvider[provider.id]?.usageSource === 'unknown'
                        ? t('provider.unknown')
                        : (tokenUsageByProvider[provider.id]?.totalTokens ?? 0).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </nav>
  );
}
