/**
 * Conversation history panel — lists recoverable sessions and persisted conversations.
 */

import { useTranslation } from 'react-i18next';
import type { StateRecoveryData } from '../../../shared/recovery-types';
import type { ConversationSummary } from '../../../shared/engine-types';

export interface ConversationHistoryPanelProps {
  conversations: StateRecoveryData[];
  onRestore: (conversationId: string) => void;
  onDiscard: (conversationId: string) => void;
  onClose: () => void;
  persistedConversations: ConversationSummary[];
  onLoad: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
  onNew: () => void;
}

export function ConversationHistoryPanel({
  conversations,
  onRestore,
  onDiscard,
  onClose,
  persistedConversations,
  onLoad,
  onDelete,
  onNew,
}: ConversationHistoryPanelProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="history-panel">
      <div className="panel-header">
        <strong>{t('history.title')}</strong>
        <div className="action-buttons">
          <button onClick={onNew} className="btn-primary btn-primary--sm">
            {t('history.new')}
          </button>
          <button onClick={onClose} className="btn-control btn-control--sm">
            X
          </button>
        </div>
      </div>

      {/* Persisted conversations section */}
      {persistedConversations.length > 0 && (
        <>
          {persistedConversations.map((conv) => (
            <div key={conv.id} className="settings-card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="card-header">
                <strong className="text-base">
                  {conv.title || t('history.noTitle')}
                </strong>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {new Date(conv.updatedAt).toLocaleString()}
                </span>
              </div>
              <div className="card-metadata">
                <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {t('history.messageCount', { count: conv.messageCount })}
                </span>
                <div className="participant-badges">
                  {conv.participantNames.map((name, i) => (
                    <span key={i} className="participant-badge">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="card-actions">
                <button
                  onClick={() => onDelete(conv.id)}
                  className="btn-danger btn-danger--sm"
                >
                  {t('history.discard')}
                </button>
                <button
                  onClick={() => onLoad(conv.id)}
                  className="btn-primary btn-danger--sm"
                >
                  {t('history.load')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Recovery sessions section */}
      {conversations.length > 0 && (
        <>
          {persistedConversations.length > 0 && (
            <div className="history-section-divider">
              <span className="text-sm" style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>
                {t('history.restore')}
              </span>
            </div>
          )}
          {conversations.map((conv) => {
            const snap = conv.snapshot;
            const participants = (() => {
              try { return JSON.parse(snap.participantsJson) as Array<{ displayName?: string }>; }
              catch { return []; }
            })();

            return (
              <div key={conv.conversationId} className="settings-card" style={{ padding: 10, marginBottom: 8 }}>
                <div className="card-header">
                  <div>
                    <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      {t('history.participants', { count: participants.length })}
                    </span>
                  </div>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {new Date(snap.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className="participant-badges" style={{ marginBottom: 6 }}>
                  {participants.map((p, i) => (
                    <span key={i} className="participant-badge">
                      {p.displayName ?? `AI ${i + 1}`}
                    </span>
                  ))}
                </div>
                <div className="card-actions">
                  <button
                    onClick={() => onDiscard(conv.conversationId)}
                    className="btn-danger btn-danger--sm"
                  >
                    {t('history.discard')}
                  </button>
                  <button
                    onClick={() => onRestore(conv.conversationId)}
                    disabled={!conv.isRecoverable}
                    className="btn-primary btn-danger--sm"
                  >
                    {t('history.restore')}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {conversations.length === 0 && persistedConversations.length === 0 && (
        <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('history.empty')}</p>
      )}
    </div>
  );
}
