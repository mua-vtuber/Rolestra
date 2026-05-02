/**
 * Thread — 중앙 메시지 pane shell (R5-Task5 → R5-Task7 → R5-Task8 →
 * R6-Task9 message list 본문 재작성).
 *
 * R6-Task9: placeholder 를 제거하고 실제 message 스트림을 렌더한다.
 *   - `useChannelMessages(channelId)` 로 DB 기록 로드.
 *   - `useMeetingStream(channelId)` 로 실시간 AI 턴 토큰 구독 → 스크롤
 *     끝에 임시 Message 로 추가. turn-done 이벤트가 DB refetch 를
 *     트리거하므로 라이브 버퍼는 비워지고 영구 row 로 자연스럽게 교체된다.
 *   - DateSeparator 그룹핑은 로컬 날짜 기준 (D6). 같은 날 같은
 *     authorId 가 연속이면 compact mode 로 avatar/header 를 생략한다.
 *   - kind='system_*' 채널은 SystemMessage 로, member 메시지는 Message
 *     로, 승인 meta 가 붙은 메시지는 ApprovalBlock 으로 분기 렌더.
 *
 * 데이터 소스:
 * - `useChannels(projectId)` — active channel 메타(name, kind, readOnly).
 * - `useActiveChannel(projectId, channels)` — 현재 activeChannelId.
 * - `useChannelMembers(channelId, channels)` — 참여자 수 + author
 *   정보 (MessageAuthorInfo join).
 * - `useActiveMeetings()` — 이 채널의 진행 중 회의 (MeetingBanner).
 * - `useChannelMessages(channelId)` — DB 기록 (message list).
 * - `useMeetingStream(channelId)` — turn 토큰 라이브 버퍼 + SSM.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { ChannelHeader } from './ChannelHeader';
import { Composer } from './Composer';
import { DateSeparator } from './DateSeparator';
import { MeetingBanner } from './MeetingBanner';
import { Message, type MessageAuthorInfo } from './Message';
import { SystemMessage } from './SystemMessage';
import { ApprovalBlock } from './ApprovalBlock';
import { ApprovalInboxView } from '../approvals/ApprovalInboxView';
import { GeneralChannelControls } from '../general/GeneralChannelControls';
import { useChannelDisabledState } from '../../hooks/use-channel-disabled-state';
import { useGlobalGeneralChannel } from '../../hooks/use-global-general-channel';
import { useActiveChannel } from '../../hooks/use-active-channel';
import { useActiveMeetings } from '../../hooks/use-active-meetings';
import { useChannelMembers } from '../../hooks/use-channel-members';
import { useChannelMessages } from '../../hooks/use-channel-messages';
import { useChannels } from '../../hooks/use-channels';
import { useDms } from '../../hooks/use-dms';
import { useMeetingStream } from '../../hooks/use-meeting-stream';
import type { Channel } from '../../../shared/channel-types';
import type { Message as ChannelMessage } from '../../../shared/message-types';

export interface ThreadProps {
  projectId: string;
  /** Task 10: Rename modal 오픈 핸들러. */
  onRenameChannel?: (channelId: string) => void;
  /** Task 10: Delete confirm 오픈 핸들러. */
  onDeleteChannel?: (channelId: string) => void;
  /**
   * R12-C round 4 — MeetingBanner 의 회의 중단 버튼 트리거. App 레벨에서
   * meeting:abort IPC + activeMeetings refresh. 사용자가 부서 채널 회의를
   * 명시 중단할 유일한 affordance (사이드바 ChannelMeetingControl 은 자유
   * user 채널만 표시). 정식 pause/resume 은 spec §11.4 의 T7 — 별도 task.
   */
  onAbortMeeting?: (meetingId: string) => Promise<void> | void;
  className?: string;
}

/**
 * Thread 가 렌더할 "항목" — DateSeparator / Message / SystemMessage /
 * ApprovalBlock 중 어느 것인지 discriminated union 으로 풀어둔다.
 */
type ThreadItem =
  | { kind: 'date'; key: string; label: string }
  | {
      kind: 'message';
      key: string;
      message: ChannelMessage;
      author: MessageAuthorInfo | null;
      compact: boolean;
    }
  | { kind: 'system'; key: string; message: ChannelMessage }
  | { kind: 'approval'; key: string; message: ChannelMessage }
  | {
      kind: 'live';
      key: string;
      messageId: string;
      speakerId: string;
      speakerName: string;
      cumulative: string;
      status: 'acknowledged' | 'composing' | 'failed' | 'skipped';
      errorMessage: string | null;
    };

function formatDateLabel(ts: number, lang: string): string {
  const locale = lang.startsWith('ko') ? 'ko-KR' : 'en-US';
  try {
    return new Date(ts).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function isApprovalMessage(m: ChannelMessage): boolean {
  // R6: approval 메타는 message.meta.parsedOutput 나 meta.approval 등에
  // 자리잡을 예정이지만, R6 범위에서는 content 가 단순 approval 요청으로
  // 들어오지 않는다. 명시적 author role=system && content 가 "승인 요청"
  // 프리픽스로 시작하는 경우만 분기한다. R7 ApprovalService 통합 시 meta
  // 기반 판정으로 교체.
  return (
    m.authorKind === 'system' &&
    typeof m.content === 'string' &&
    m.content.startsWith('[APPROVAL]')
  );
}

function isSystemMessage(m: ChannelMessage): boolean {
  return m.authorKind === 'system' && !isApprovalMessage(m);
}

export function Thread({
  projectId,
  onRenameChannel,
  onDeleteChannel,
  onAbortMeeting,
  className,
}: ThreadProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { channels } = useChannels(projectId);
  const { dms } = useDms();
  // R12-C round 2 fix #2-1 + round 3: 전역 일반 채널 (system_general,
  // projectId IS NULL) 도 검증 list 에 포함시켜야 한다. 누락 시 사용자가
  // 사이드바에서 일반 채널을 클릭하면 useActiveChannel 의 "stored channel
  // not in list" 분기가 active id 를 즉시 비워버려 본문이 "왼쪽에서 채널
  // 선택" 빈 화면으로 돌아간다.
  //
  // round 3 정정: globalGeneralChannel 이 fetch 완료되기 전에 allChannels
  // 를 부분 list 로 노출하면 useActiveChannel validation 이 일반 채널 id
  // 를 list 에 없다고 판단해 wipe. globalGeneralChannel 이 loading 인
  // 동안에는 allChannels 자체를 null 로 유지해 검증 자체를 보류한다.
  const {
    channel: globalGeneralChannel,
    loading: globalGeneralChannelLoading,
  } = useGlobalGeneralChannel();
  const allChannels = useMemo(() => {
    if (channels === null || dms === null || globalGeneralChannelLoading) {
      return null;
    }
    const merged: Channel[] = [...channels, ...dms];
    if (globalGeneralChannel !== null) merged.push(globalGeneralChannel);
    return merged;
  }, [channels, dms, globalGeneralChannel, globalGeneralChannelLoading]);
  const { activeChannelId } = useActiveChannel(projectId, allChannels);
  const { members } = useChannelMembers(activeChannelId, allChannels);
  // R12: meeting start/abort moved to MessengerPage's sidebar control —
  // Thread keeps useActiveMeetings only to render the in-thread
  // MeetingBanner for the active channel. The host's separate instance
  // owns the start-modal trigger + abort dispatch.
  const { meetings } = useActiveMeetings();
  const { messages, refresh: refreshMessages } = useChannelMessages(activeChannelId);
  const meetingStream = useMeetingStream(activeChannelId);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const activeChannel = useMemo(() => {
    if (activeChannelId === null) return null;
    if (allChannels === null) return null;
    return allChannels.find((c) => c.id === activeChannelId) ?? null;
  }, [activeChannelId, allChannels]);

  const activeMeeting = useMemo(() => {
    if (activeChannelId === null) return null;
    if (meetings === null) return null;
    return meetings.find((m) => m.channelId === activeChannelId) ?? null;
  }, [activeChannelId, meetings]);

  // R12-C T11 — 부서 채널 disabled 분기 (워크플로우 미진입 시 잠금).
  const channelDisabledState = useChannelDisabledState(activeChannel, meetings);

  const memberCount = members === null ? null : members.length;

  // Map providerId → MessageAuthorInfo for author-join on member messages.
  const memberByProvider = useMemo(() => {
    const map = new Map<string, MessageAuthorInfo>();
    if (members === null) return map;
    for (const m of members) {
      map.set(m.providerId, {
        id: m.providerId,
        name: m.displayName,
      });
    }
    return map;
  }, [members]);

  // Build the render list from messages + live turns.
  const items = useMemo<ThreadItem[]>(() => {
    const out: ThreadItem[] = [];
    if (messages === null) return out;

    let lastDayKey: string | null = null;
    let lastAuthorId: string | null = null;

    for (const m of messages) {
      const dayKey = localDayKey(m.createdAt);
      if (dayKey !== lastDayKey) {
        out.push({
          kind: 'date',
          key: `date-${dayKey}`,
          label: formatDateLabel(m.createdAt, i18n.language),
        });
        lastDayKey = dayKey;
        lastAuthorId = null;
      }

      if (isApprovalMessage(m)) {
        out.push({ kind: 'approval', key: `msg-${m.id}`, message: m });
        lastAuthorId = null;
        continue;
      }

      if (isSystemMessage(m)) {
        out.push({ kind: 'system', key: `msg-${m.id}`, message: m });
        lastAuthorId = null;
        continue;
      }

      const author =
        m.authorKind === 'member'
          ? memberByProvider.get(m.authorId) ?? null
          : null;
      const compact = m.authorId === lastAuthorId;
      out.push({
        kind: 'message',
        key: `msg-${m.id}`,
        message: m,
        author,
        compact,
      });
      lastAuthorId = m.authorId;
    }

    // Append live turns (not yet persisted) at the end.
    for (const turn of meetingStream.liveTurns) {
      const existing = messages.find((m) => m.id === turn.messageId);
      if (existing) continue; // DB already has the row — skip live buffer.
      // Resolve display name: prefer the payload-supplied name (skipped
      // path carries it), otherwise look up via the channel member
      // roster. Falls through to a localised "AI" fallback so the
      // status row is never raw-id ugly.
      const memberName = memberByProvider.get(turn.speakerId)?.name ?? null;
      const speakerName =
        turn.participantName ??
        memberName ??
        t('messenger.thread.liveTurn.unknownSpeaker');
      out.push({
        kind: 'live',
        key: `live-${turn.messageId}`,
        messageId: turn.messageId,
        speakerId: turn.speakerId,
        speakerName,
        cumulative: turn.cumulative,
        status: turn.status,
        errorMessage: turn.errorMessage,
      });
    }

    return out;
  }, [messages, memberByProvider, meetingStream.liveTurns, i18n.language, t]);

  // Refresh on turn-done: when a live turn disappears from liveTurns it
  // means the orchestrator persisted the row; pull the latest DB list.
  const prevLiveCount = useRef(0);
  useEffect(() => {
    if (meetingStream.liveTurns.length < prevLiveCount.current) {
      void refreshMessages();
    }
    prevLiveCount.current = meetingStream.liveTurns.length;
  }, [meetingStream.liveTurns.length, refreshMessages]);

  // Auto-scroll to bottom on new messages / live tokens.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // R12: meeting start/abort handlers moved to MessengerPage. Thread
  // keeps only Composer success refresh.
  const handleComposerSendSuccess = useCallback((): void => {
    void refreshMessages();
  }, [refreshMessages]);

  if (activeChannel === null) {
    return (
      <div
        data-testid="thread"
        data-empty="true"
        className={clsx('flex h-full items-center justify-center p-6', className)}
      >
        <p
          data-testid="thread-empty-state"
          className="text-sm text-fg-muted"
        >
          {t('messenger.emptyState.noActiveChannel')}
        </p>
      </div>
    );
  }

  const handleRename =
    onRenameChannel === undefined
      ? undefined
      : (): void => onRenameChannel(activeChannel.id);
  const handleDelete =
    onDeleteChannel === undefined
      ? undefined
      : (): void => onDeleteChannel(activeChannel.id);

  return (
    <div
      data-testid="thread"
      data-empty="false"
      data-channel-id={activeChannel.id}
      className={clsx('flex h-full min-h-0 flex-col', className)}
    >
      <ChannelHeader
        channel={activeChannel}
        memberCount={memberCount}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      {activeChannel.kind === 'system_approval' ? (
        // R7-Task7: #승인-대기 채널은 메시지 리스트 대신 pending approval
        // inbox 를 단독 렌더한다. MeetingBanner / Composer / message-list
        // 는 이 브랜치에서는 의미가 없다 (readOnly + meeting 불가).
        <ApprovalInboxView projectId={projectId} />
      ) : (
        <>
          {/* R12-C T9: 일반 채널 (전역 system_general) 은 회의 표면 X.
              MeetingBanner hide + "새 대화 시작" 컨트롤 노출. */}
          {activeChannel.kind === 'system_general' ? (
            <GeneralChannelControls
              channelId={activeChannel.id}
              onArchived={() => {
                void refreshMessages();
              }}
            />
          ) : null}

          {activeChannel.kind !== 'system_general' && activeMeeting ? (
            <MeetingBanner
              meeting={activeMeeting}
              memberCount={memberCount}
              onAbort={() => onAbortMeeting?.(activeMeeting.id)}
            />
          ) : null}

          {meetingStream.error ? (
            <div
              data-testid="thread-meeting-error"
              data-fatal={meetingStream.error.fatal ? 'true' : 'false'}
              className="px-4 py-1 text-xs text-danger"
            >
              {/* R6-Task11: static key anchors the `meeting.*` namespace
                  so i18next-parser's keepRemoved regex preserves the
                  variable-keyed `meeting.state.*` / `meeting.error.*` /
                  `meeting.minutes.*` / `meeting.banner.state.*` subtrees. */}
              {t('meeting.error.providerError')}: {meetingStream.error.message}
            </div>
          ) : null}

          <div
            ref={scrollRef}
            data-testid="thread-message-list"
            data-message-count={messages === null ? 'null' : String(messages.length)}
            data-live-turns={String(meetingStream.liveTurns.length)}
            className="flex-1 min-h-0 overflow-y-auto px-0 py-2 text-sm text-fg"
          >
        {messages === null ? (
          <p
            data-testid="thread-loading"
            className="px-4 py-2 text-xs text-fg-muted"
          >
            {t('messenger.thread.loading')}
          </p>
        ) : items.length === 0 ? (
          <p
            data-testid="thread-empty-messages"
            className="px-4 py-2 text-xs text-fg-muted"
          >
            {t('messenger.thread.empty')}
          </p>
        ) : (
          items.map((it) => {
            if (it.kind === 'date') {
              return <DateSeparator key={it.key} label={it.label} />;
            }
            if (it.kind === 'system') {
              return <SystemMessage key={it.key} message={it.message} />;
            }
            if (it.kind === 'approval') {
              return <ApprovalBlock key={it.key} message={it.message} />;
            }
            if (it.kind === 'live') {
              const ssmLabel =
                meetingStream.ssmState !== null
                  ? // R6-Task11: dynamic key — `meeting.state.<SSM>` is
                    // parser-opaque, kept via the `meeting.state` regex
                    // in i18next-parser.config.js.
                    t(`meeting.state.${meetingStream.ssmState}`)
                  : null;
              // Status-specific status row. The Composer's "is the AI
              // even doing anything?" question is answered here so the
              // user can distinguish a slow turn from a silent failure.
              let statusLine: string;
              switch (it.status) {
                case 'acknowledged':
                  statusLine = t('messenger.thread.liveTurn.acknowledged', {
                    name: it.speakerName,
                  });
                  break;
                case 'composing':
                  statusLine = t('messenger.thread.liveTurn.composing', {
                    name: it.speakerName,
                  });
                  break;
                case 'failed':
                  statusLine = t('messenger.thread.liveTurn.failed', {
                    name: it.speakerName,
                    reason:
                      it.errorMessage ??
                      t('messenger.thread.liveTurn.unknownSpeaker'),
                  });
                  break;
                case 'skipped':
                  statusLine = t('messenger.thread.liveTurn.skipped', {
                    name: it.speakerName,
                  });
                  break;
              }
              const statusTone =
                it.status === 'failed'
                  ? 'text-danger'
                  : it.status === 'skipped'
                    ? 'text-warning'
                    : 'text-fg-muted';
              return (
                <div
                  key={it.key}
                  data-testid="thread-live-turn"
                  data-message-id={it.messageId}
                  data-speaker-id={it.speakerId}
                  data-status={it.status}
                  className="px-4 py-1 text-sm text-fg"
                >
                  <div
                    data-testid="thread-live-turn-status"
                    className={clsx('text-xs', statusTone)}
                  >
                    {ssmLabel ? (
                      <span
                        data-testid="thread-live-turn-ssm"
                        className="mr-2 text-fg-subtle"
                      >
                        [{ssmLabel}]
                      </span>
                    ) : null}
                    <span>{statusLine}</span>
                  </div>
                  {it.cumulative ? (
                    <div
                      data-testid="thread-live-turn-content"
                      className="mt-1 whitespace-pre-wrap"
                    >
                      {it.cumulative}
                    </div>
                  ) : null}
                </div>
              );
            }
            return (
              <Message
                key={it.key}
                message={it.message}
                member={it.author}
                compact={it.compact}
              />
            );
          })
        )}
          </div>

          <Composer
            channelId={activeChannel.id}
            readOnly={activeChannel.readOnly}
            workflowDisabled={channelDisabledState.workflowDisabled}
            disabledPlaceholderKey={channelDisabledState.disabledPlaceholderKey}
            onSendSuccess={handleComposerSendSuccess}
          />
        </>
      )}

    </div>
  );
}
