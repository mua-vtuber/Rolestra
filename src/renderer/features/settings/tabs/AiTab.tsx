/**
 * AiTab — settings "AI" (spec 2026-10-01-messenger-redesign.md R5-5).
 *
 * Replaces the former members / API keys / CLI tabs with one roster:
 * every registered AI with its connection, status and an edit button.
 * "AI 추가" lives only here (the top bar and the empty chat screen no
 * longer add AIs). Name, character sheet, avatar, API key replacement and
 * deleting an AI all happen in the AI's edit dialog
 * (`MemberProfileEditModal`), so there is no separate key list.
 *
 * Data: `useMembers` (name, avatar, work status) joined with `useProviders`
 * (connection config). A failed fetch shows its error; it never becomes an
 * empty roster.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../components/primitives/button';
import { LineIcon } from '../../../components/shell/LineIcon';
import { useMembers } from '../../../hooks/use-members';
import { useProviders } from '../../../hooks/use-providers';
import { MemberProfileEditModal } from '../../members/MemberProfileEditModal';
import { AiRosterRow } from './ai/AiRosterRow';
import { InactiveCliList } from './ai/InactiveCliList';

export interface AiTabProps {
  /** Opens the AI add dialog (owned by `SettingsTabs`). */
  onAddAi: () => void;
}

export function AiTab({ onAddAi }: AiTabProps): ReactElement {
  const { t } = useTranslation();
  const { members, loading, error: membersError, refresh: refreshMembers } = useMembers();
  const { providers, error: providersError } = useProviders();
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const editingMember = members?.find((m) => m.providerId === editingProviderId) ?? null;

  return (
    <section data-testid="settings-tab-ai" className="flex flex-col gap-5">
      <header className="flex max-w-4xl items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-page-title font-bold">{t('settings.ai.title')}</h2>
          <p className="mt-1 text-preview text-fg-muted">{t('settings.ai.description')}</p>
        </div>
        <Button type="button" tone="primary" size="lg" data-testid="settings-ai-add" onClick={onAddAi}
          className="shrink-0 gap-2 font-semibold">
          <LineIcon name="plus" stroke={2} />
          {t('providerConnect.add')}
        </Button>
      </header>

      {membersError !== null ? (
        <p data-testid="settings-ai-error" role="alert" className="text-sm text-danger-text">
          {t('settings.ai.loadFailed', { message: membersError.message })}
        </p>
      ) : null}
      {providersError !== null ? (
        <p data-testid="settings-ai-connection-error" role="alert" className="text-sm text-danger-text">
          {t('settings.ai.connectionLoadFailed', { message: providersError.message })}
        </p>
      ) : null}

      {members === null ? (
        loading ? (
          <p data-testid="settings-ai-loading" className="text-sm text-fg-muted">{t('settings.ai.loading')}</p>
        ) : null
      ) : members.length === 0 ? (
        <p data-testid="settings-ai-empty" className="max-w-4xl text-sm text-fg-muted">{t('settings.ai.empty')}</p>
      ) : (
        <ul data-testid="settings-ai-list" className="flex max-w-4xl flex-col gap-2.5">
          {members.map((member) => (
            <AiRosterRow
              key={member.providerId}
              member={member}
              provider={providers?.find((p) => p.id === member.providerId) ?? null}
              onEdit={() => setEditingProviderId(member.providerId)}
              onStatusChanged={refreshMembers}
            />
          ))}
        </ul>
      )}

      <p className="max-w-4xl text-meta text-fg-muted">{t('settings.ai.keyNote')}</p>

      <InactiveCliList />

      {editingMember ? (
        // customAvatarSrc omitted, as in every other caller: avatar_data is a
        // stored relative path / key, not a displayable src (see the former
        // MembersTab note).
        <MemberProfileEditModal
          open
          onOpenChange={(open) => { if (!open) setEditingProviderId(null); }}
          providerId={editingMember.providerId}
          displayName={editingMember.displayName}
        />
      ) : null}
    </section>
  );
}
