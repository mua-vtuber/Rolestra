/**
 * Settings view with tabs: General, AI Management, Conversation/Task,
 * Secrets, Remote, Memory, Permissions, Database, Audit Log, Log Viewer.
 *
 * Each tab is extracted into its own file under ./settings/.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GeneralTab } from './settings/GeneralTab';
import { AIManagementTab } from './settings/AIManagementTab';
import { SecretsTab } from './settings/SecretsTab';
import { RemoteAccessTab } from './settings/RemoteAccessTab';
import { MemoryTab } from './settings/MemoryTab';
import { ConversationTaskTab } from './settings/ConversationTaskTab';
import { AuditLogTab } from './settings/AuditLogTab';
import { LogViewerTab } from './settings/LogViewerTab';
import { PermissionManagementPanel } from './settings/PermissionManagementPanel';
import { DatabaseTab } from './settings/DatabaseTab';

type SettingsTab = 'general' | 'ai' | 'conversationTask' | 'secrets' | 'remote' | 'memory' | 'permissions' | 'database' | 'auditLog' | 'logViewer';

export function SettingsView(): React.JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-container">
      <div className="settings-tabs">
        <button className={`settings-tab-btn${tab === 'general' ? ' active' : ''}`} onClick={() => setTab('general')}>
          {t('settings.general')}
        </button>
        <button className={`settings-tab-btn${tab === 'ai' ? ' active' : ''}`} onClick={() => setTab('ai')}>
          {t('settings.aiManagement')}
        </button>
        <button className={`settings-tab-btn${tab === 'conversationTask' ? ' active' : ''}`} onClick={() => setTab('conversationTask')}>
          {t('settings.conversationTask')}
        </button>
        <button className={`settings-tab-btn${tab === 'secrets' ? ' active' : ''}`} onClick={() => setTab('secrets')}>
          {t('settings.secrets')}
        </button>
        <button className={`settings-tab-btn${tab === 'remote' ? ' active' : ''}`} onClick={() => setTab('remote')}>
          {t('settings.remoteAccess')}
        </button>
        <button className={`settings-tab-btn${tab === 'memory' ? ' active' : ''}`} onClick={() => setTab('memory')}>
          {t('settings.memory')}
        </button>
        <button className={`settings-tab-btn${tab === 'permissions' ? ' active' : ''}`} onClick={() => setTab('permissions')}>
          {t('settings.permissions')}
        </button>
        <button className={`settings-tab-btn${tab === 'database' ? ' active' : ''}`} onClick={() => setTab('database')}>
          {t('settings.database')}
        </button>
        <button className={`settings-tab-btn${tab === 'auditLog' ? ' active' : ''}`} onClick={() => setTab('auditLog')}>
          {t('settings.auditLog')}
        </button>
        <button className={`settings-tab-btn${tab === 'logViewer' ? ' active' : ''}`} onClick={() => setTab('logViewer')}>
          {t('settings.logViewer')}
        </button>
      </div>
      <div className="settings-content">
        {tab === 'general' && <GeneralTab />}
        {tab === 'ai' && <AIManagementTab />}
        {tab === 'conversationTask' && <ConversationTaskTab />}
        {tab === 'secrets' && <SecretsTab />}
        {tab === 'remote' && <RemoteAccessTab />}
        {tab === 'memory' && <MemoryTab />}
        {tab === 'permissions' && <PermissionManagementPanel />}
        {tab === 'database' && <DatabaseTab />}
        {tab === 'auditLog' && <AuditLogTab />}
        {tab === 'logViewer' && <LogViewerTab />}
      </div>
    </div>
  );
}
