/**
 * ConversationTaskTab — settings for conversation/task mode policies.
 *
 * Covers deep debate budget, AI decision parsing, voting rules,
 * and block reason type displays (read-only chips).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsConfig } from '../../../shared/config-types';
import { showError } from '../../hooks/useErrorDialog';

export function ConversationTaskTab(): React.JSX.Element {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SettingsConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const fetch = async (): Promise<void> => {
      try {
        const result = await window.arena.invoke('config:get-settings', undefined);
        setSettings(result.settings);
      } catch (err) { console.warn('[config:get-settings] error:', err); }
    };
    void fetch();
  }, []);

  const handleSave = async (): Promise<void> => {
    if (!settings) return;
    try {
      const result = await window.arena.invoke('config:update-settings', { patch: settings });
      setSettings(result.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { showError('config:update-settings', err); }
  };

  const updateTask = <K extends keyof SettingsConfig['conversationTask']>(
    key: K,
    value: SettingsConfig['conversationTask'][K],
  ): void => {
    setSettings((prev) =>
      prev ? { ...prev, conversationTask: { ...prev.conversationTask, [key]: value } } : prev,
    );
  };

  if (!settings) return <div className="settings-section" />;

  const ct = settings.conversationTask;

  return (
    <div className="settings-section">
      <div className="settings-card">
        <p className="dialog-description" style={{ marginBottom: 12 }}>
          {t('settings.conversationTaskSettings.description')}
        </p>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.deepDebateTurnBudget')}
          </label>
          <input
            type="number"
            className="settings-input settings-input--narrow"
            min={1}
            value={ct.deepDebateTurnBudget}
            onChange={(e) => updateTask('deepDebateTurnBudget', Number(e.target.value))}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.aiDecisionParseRetryLimit')}
          </label>
          <input
            type="number"
            className="settings-input settings-input--narrow"
            min={0}
            value={ct.aiDecisionParseRetryLimit}
            onChange={(e) => updateTask('aiDecisionParseRetryLimit', Number(e.target.value))}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.twoParticipantUnanimousRequired')}
          </label>
          <input
            type="checkbox"
            checked={ct.twoParticipantUnanimousRequired}
            onChange={(e) => updateTask('twoParticipantUnanimousRequired', e.target.checked)}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.majorityAllowedFromParticipants')}
          </label>
          <input
            type="number"
            className="settings-input settings-input--narrow"
            min={2}
            value={ct.majorityAllowedFromParticipants}
            onChange={(e) => updateTask('majorityAllowedFromParticipants', Number(e.target.value))}
          />
        </div>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.hardBlockReasons')}
          </label>
          <div className="chip-group">
            {ct.hardBlockReasonTypes.map((r) => (
              <span key={r} className="chip chip--error">{r}</span>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <label className="settings-label settings-label--inline settings-label--wide">
            {t('settings.conversationTaskSettings.softBlockReasons')}
          </label>
          <div className="chip-group">
            {ct.softBlockReasonTypes.map((r) => (
              <span key={r} className="chip chip--warning">{r}</span>
            ))}
          </div>
        </div>

        <div className="settings-save-row">
          <button className="btn-primary" onClick={() => void handleSave()}>
            {t('app.save')}
          </button>
          {saved && <span className="settings-saved-msg">{t('settings.saved')}</span>}
        </div>
      </div>
    </div>
  );
}
