/**
 * One registered AI in the settings AI tab (spec 2026-10-01-messenger-redesign.md
 * R5-5, SettingsAI mockup): avatar (bubble themes only — the log layout has
 * no profile pictures), name, one-line connection, status, a hint and
 * "다시 연결" when the AI is not reachable, and "편집".
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '../../../../components/members/Avatar';
import { AVATAR_SIZE } from '../../../../components/members/avatar-sizes';
import { Button } from '../../../../components/primitives/button';
import { invoke } from '../../../../ipc/invoke';
import { nameColorTextClass } from '../../../../theme/name-palette';
import { useTheme } from '../../../../theme/use-theme';
import type { MemberView } from '../../../../../shared/member-profile-types';
import type { ProviderInfo } from '../../../../../shared/provider-types';
import { describeConnection, describeStatus, type AiStatusTone } from './ai-connection';

const STATUS_TONE_CLASS: Record<AiStatusTone, string> = {
  ok: 'text-success',
  pending: 'text-fg-muted',
  problem: 'text-warning',
};

export interface AiRosterRowProps {
  member: MemberView;
  /** Null until `provider:list` has answered for this AI. */
  provider: ProviderInfo | null;
  onEdit: () => void;
  /** Re-read the roster after a reconnect attempt changed the status. */
  onStatusChanged: () => Promise<void>;
}

export function AiRosterRow({ member, provider, onEdit, onStatusChanged }: AiRosterRowProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  const status = describeStatus(t, member.workStatus, provider?.config ?? null, member.connectionFailure ?? null);
  const logLayout = token.messageLayout === 'log';

  const reconnect = async (): Promise<void> => {
    setReconnecting(true);
    setReconnectError(null);
    try {
      await invoke('member:reconnect', { providerId: member.providerId });
      await onStatusChanged();
    } catch (reason) {
      setReconnectError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <li
      data-testid="settings-ai-row"
      data-provider-id={member.providerId}
      data-status={member.workStatus}
      className="flex items-center gap-4 border border-border-soft px-4 py-3.5 [background:var(--color-panel-bg)] [clip-path:var(--clip-control)]"
    >
      {logLayout ? null : (
        <Avatar
          providerId={member.providerId}
          displayName={member.displayName}
          avatarKind={member.avatarKind}
          avatarData={member.avatarData}
          size={AVATAR_SIZE.listRow}
          shape={token.avatarShape}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          data-testid="settings-ai-name"
          className={clsx('truncate text-row-title font-bold', logLayout ? nameColorTextClass(member.providerId) : 'text-fg')}
        >
          {member.displayName}
        </span>
        <span data-testid="settings-ai-connection" className="truncate font-mono text-meta text-fg-muted">
          {provider === null ? t('settings.ai.connection.loading') : describeConnection(t, provider.config)}
        </span>
        {status.hint !== null ? (
          <span data-testid="settings-ai-hint" className="text-xs text-warning">{status.hint}</span>
        ) : null}
        {reconnectError !== null ? (
          <span data-testid="settings-ai-reconnect-error" role="alert" className="text-xs text-danger-text">
            {t('settings.ai.reconnectFailed', { message: reconnectError })}
          </span>
        ) : null}
      </span>
      <span
        data-testid="settings-ai-status"
        className={clsx('inline-flex shrink-0 items-center gap-1.5 text-xs', STATUS_TONE_CLASS[status.tone])}
      >
        <span aria-hidden="true" className="h-2 w-2 bg-current" />
        {status.label}
      </span>
      {status.canReconnect ? (
        <Button type="button" tone="secondary" size="md" data-testid="settings-ai-reconnect"
          disabled={reconnecting} onClick={() => void reconnect()}>
          {reconnecting ? t('settings.ai.reconnecting') : t('settings.ai.reconnect')}
        </Button>
      ) : null}
      <Button type="button" tone="secondary" size="md" data-testid="settings-ai-edit" onClick={onEdit}>
        {t('settings.ai.edit')}
      </Button>
    </li>
  );
}
