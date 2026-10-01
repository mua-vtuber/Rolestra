/**
 * AiListView — the "AI 목록" screen (spec 2026-10-01-messenger-redesign.md
 * R2-3/R2-4): every registered AI with its avatar (not in the log layout),
 * name and the first line of its character sheet. Picking one opens its
 * 1:1 conversation — the existing DM if there is one (`dm:list`), else a
 * new one through the existing `dm:create` IPC.
 *
 * There is no add button here; with no AI at all the screen says where to
 * add one and links to the settings AI tab.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../components/members/Avatar';
import { AVATAR_SIZE } from '../../components/members/avatar-sizes';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { useDmSummaries } from '../../hooks/use-dm-summaries';
import { useMembers } from '../../hooks/use-members';
import { invoke } from '../../ipc/invoke';
import { nameColorTextClass } from '../../theme/name-palette';
import { useTheme } from '../../theme/use-theme';
import type { MemberView } from '../../../shared/member-profile-types';

/** First non-empty line of the character sheet; null when it has none. */
export function characterPreview(characterSheet: string): string | null {
  return characterSheet.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? null;
}

export interface AiListViewProps {
  /** Shows the conversation (messenger view) after it is found or created. */
  onOpenChannel: (channelId: string) => void;
  /** Opens settings on the AI tab. */
  onOpenAiSettings: () => void;
}

export function AiListView({ onOpenChannel, onOpenAiSettings }: AiListViewProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const { members, loading, error } = useMembers();
  const { data: dms, error: dmError } = useDmSummaries();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const logLayout = token.messageLayout === 'log';

  const open = async (member: MemberView): Promise<void> => {
    if (pendingId !== null) return;
    setPendingId(member.providerId);
    setOpenError(null);
    try {
      const existing = dms?.find((row) => row.providerId === member.providerId)?.channel ?? null;
      if (existing !== null) {
        onOpenChannel(existing.id);
        return;
      }
      const { channel } = await invoke('dm:create', { providerId: member.providerId });
      await notifyChannelsChanged();
      onOpenChannel(channel.id);
    } catch (reason) {
      setOpenError(t('aiList.openFailed', { name: member.displayName, message: reason instanceof Error ? reason.message : String(reason) }));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section data-testid="ai-list-view" aria-label={t('aiList.title')}
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto bg-canvas px-12 py-8">
      <header>
        <h1 className="font-display text-page-title font-bold">{token.titlePrefix}{t('aiList.title')}</h1>
        <p className="mt-1 text-preview text-fg-muted">{t('aiList.description')}</p>
      </header>
      {error !== null ? (
        <p data-testid="ai-list-error" role="alert" className="text-sm text-danger-text">
          {t('aiList.loadFailed', { message: error.message })}
        </p>
      ) : null}
      {dmError !== null ? (
        <p data-testid="ai-list-dm-error" role="alert" className="text-sm text-danger-text">
          {t('aiList.dmLoadFailed', { message: dmError.message })}
        </p>
      ) : null}
      {openError !== null ? (
        <p data-testid="ai-list-open-error" role="alert" className="text-sm text-danger-text">{openError}</p>
      ) : null}
      {members === null ? (
        loading ? <p data-testid="ai-list-loading" className="text-sm text-fg-muted">{t('aiList.loading')}</p> : null
      ) : members.length === 0 ? (
        <div data-testid="ai-list-empty" className="flex max-w-3xl items-center justify-between gap-4 border border-border-soft px-4 py-3 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
          <span className="text-sm text-fg-muted">{t('aiList.empty')}</span>
          <button type="button" data-testid="ai-list-open-settings" onClick={onOpenAiSettings}
            className="shrink-0 text-sm font-semibold text-brand-text underline-offset-2 hover:underline">
            {t('chat.openAiSettings')}
          </button>
        </div>
      ) : (
        <ul data-testid="ai-list" className="flex max-w-4xl flex-col gap-2.5">
          {members.map((member) => {
            const preview = characterPreview(member.characterSheet);
            return (
              <li key={member.providerId}>
                <button type="button" data-testid="ai-list-row" data-provider-id={member.providerId}
                  // Until dm:list answers the screen cannot tell an existing DM
                  // from a new one, so picking waits for it.
                  disabled={pendingId !== null || dms === null} onClick={() => void open(member)}
                  className="flex w-full items-center gap-4 border border-border-soft px-4 py-3.5 text-left hover:bg-sunk disabled:opacity-60 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]">
                  {logLayout ? null : (
                    <Avatar providerId={member.providerId} displayName={member.displayName}
                      avatarKind={member.avatarKind} avatarData={member.avatarData} size={AVATAR_SIZE.listRow} shape={token.avatarShape} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`truncate text-body font-bold ${logLayout ? nameColorTextClass(member.providerId) : 'text-fg'}`}>
                      {member.displayName}
                    </span>
                    <span data-testid="ai-list-character" className="truncate text-preview text-fg-muted">
                      {preview ?? t('aiList.noCharacterSheet')}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
