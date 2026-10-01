import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardBody, CardHeader } from '../../components/primitives';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { useGlobalChannelLists } from '../../hooks/use-global-channel-lists';
import { MemberRow } from './MemberRow';
import { GeneralVariant } from './SsmBox/GeneralVariant';

export interface MemberPanelProps {
  className?: string;
}

export function MemberPanel({ className }: MemberPanelProps): ReactElement {
  const { t } = useTranslation();
  const { available, authoritative } = useGlobalChannelLists();
  const { activeChannelId } = useActiveChannel(null, authoritative);
  const activeChannel = available.find((channel) => channel.id === activeChannelId) ?? null;
  const memberChannels = activeChannel === null && authoritative === null ? null : available;
  const { members, loading, error } = useChannelMembers(activeChannelId, memberChannels);

  return (
    <div data-testid="member-panel" data-channel-id={activeChannelId ?? ''}
      data-general-channel={activeChannel?.kind === 'system_general' ? 'true' : 'false'}
      className={`flex h-full min-h-0 flex-col gap-3 p-3 ${className ?? ''}`}>
      <Card data-testid="member-panel-participants" className="flex flex-col">
        <CardHeader heading={members === null
          ? t('messenger.memberPanel.participantsTitle')
          : t('messenger.memberPanel.participantsTitleCount', { count: members.length })} />
        <CardBody>
          {activeChannelId === null ? (
            <p data-testid="member-panel-no-channel" className="text-sm text-fg-muted">
              {t('messenger.memberPanel.noActiveChannel')}
            </p>
          ) : error ? (
            <p data-testid="member-panel-error" role="alert" className="text-sm text-danger-text">
              {t('messenger.memberPanel.error')}
            </p>
          ) : members === null && loading ? (
            <p data-testid="member-panel-loading" className="text-sm text-fg-muted">
              {t('messenger.memberPanel.loading')}
            </p>
          ) : !members?.length ? (
            <p data-testid="member-panel-empty" className="text-sm text-fg-muted">
              {t('messenger.memberPanel.empty')}
            </p>
          ) : (
            <ul data-testid="member-panel-list" className="flex flex-col gap-2">
              {members.map((member) => <MemberRow key={member.providerId} member={member} />)}
            </ul>
          )}
        </CardBody>
      </Card>
      {activeChannel && (activeChannel.kind === 'system_general' || activeChannel.isChatRoom) ? (
        <GeneralVariant key={activeChannel.id} channelId={activeChannel.id} readOnly={activeChannel.readOnly} />
      ) : null}
    </div>
  );
}
