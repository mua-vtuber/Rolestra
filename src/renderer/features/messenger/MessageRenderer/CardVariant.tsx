/**
 * MessageCardVariant — 회의 의견 발화 / 회의록 메시지를 채팅창 카드로 렌더 (R12-C2 P3 T14).
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md §11.13a:
 *   - 회의 안 의견 발화 (`opinion` row 의 root / revise / block / addition kind) 는
 *     *채팅창 메시지 row* + *SsmBox 카드* 둘 다 표시.
 *   - 채팅창 = `Card primitive` (R3 시점 land) + `themeKey` 따라 변형 (warm / tactical / retro 3 family × 2 mode = 6).
 *   - 본문 truncate 금지 — long content 도 카드 안 scroll 또는 expand 버튼.
 *   - 카드 안 [선택 / 취소] / [동의 / 반대] 같은 액션 버튼 (kind 별).
 *   - 발화 ID (`codex_1`) + 의견 트리 ID (`ITEM_001_01`) 둘 다 카드 헤더에 표시.
 *   - DM / 일반 / 부서 채널 모두 같은 Card primitive.
 *
 * 본 컴포넌트는 *surface* 만 — 액션 버튼 핸들러는 부모가 props 로 주입한다
 * (T15+ workflow sub-task 가 wire). 핸들러가 미주입이면 버튼은 렌더하지
 * 않는다 (placeholder 버튼 금지 — CLAUDE.md mock/fallback rule).
 *
 * 의존:
 *   - `Card / CardHeader / CardBody / CardFooter` primitive (R3 land).
 *   - `useTheme()` — themeKey 분기 + 토큰 (Card 내부에서 자동 적용).
 *   - `MessageMeta` 의 `opinion` / `minutes` 키 + `hasOpinionMeta` / `hasMinutesMeta` type guard.
 *
 * 데이터 fetch 는 하지 않는다 — Thread / 부모 컴포넌트가 join 결과를 props 로 주입.
 */
import { clsx } from 'clsx';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Card, CardBody, CardFooter, CardHeader } from '../../../components/primitives';
import { useTheme } from '../../../theme/use-theme';
import {
  hasMinutesMeta,
  hasOpinionMeta,
  type Message as ChannelMessage,
  type MinutesCardMeta,
  type OpinionCardMeta,
} from '../../../../shared/message-types';
import type { OpinionKind, OpinionVoteValue } from '../../../../shared/opinion-types';

/**
 * 본문 collapse threshold — 이보다 길면 첫 표시는 collapsed, 사용자가 [더 보기]
 * 토글로 펼친다. truncate 가 아니라 *visibility toggle* — DOM 안 본문은 항상
 * 통째이고 CSS max-height + overflow 로 가린다.
 */
const COLLAPSE_THRESHOLD_CHARS = 600;

/** Collapsed 상태에서 보이는 영역 max-height (px). */
const COLLAPSED_MAX_HEIGHT_PX = 240;

export interface OpinionCardActionHandlers {
  /** 동의/반대 투표 (root / revise / block / addition). T15+ 가 wire. */
  onVote?: (opinionRef: string, vote: Extract<OpinionVoteValue, 'agree' | 'oppose'>) => void;
  /** 아이디어 부서 카드 선택 / 취소 (kind='root' 만, idea-workflow). */
  onSelectToggle?: (opinionRef: string, nextSelected: boolean) => void;
  /** 자유 토론 수정안 제시 (parent 가 root / revise / block / addition). */
  onPropose?: (parentOpinionRef: string) => void;
}

export interface MinutesCardActionHandlers {
  /** 회의록 본문 전체 보기 (외부 markdown 뷰어 또는 모달). */
  onMinutesOpen?: (minutesPath: string) => void;
  /** 다음 부서 인계 (handoff_mode='check' 시 결재 모달). */
  onHandoff?: (minutesPath: string) => void;
}

export interface MessageCardVariantProps {
  message: ChannelMessage;
  /** Optional — idea-workflow 에서 사용자가 카드 선택했는지 표시 (체크 마크). */
  selected?: boolean;
  /**
   * Optional — opinion-card 액션 버튼 핸들러. 생략 시 버튼 미렌더 (T14 시점에는
   * Thread 가 미주입 — T15+ workflow sub-task 가 wire).
   */
  opinionHandlers?: OpinionCardActionHandlers;
  /** Optional — minutes-card 액션 버튼 핸들러. */
  minutesHandlers?: MinutesCardActionHandlers;
  className?: string;
}

/**
 * 의견 카드 헤더 라벨 — kind 마다 짧은 prefix.
 */
function opinionKindLabelKey(kind: OpinionKind): string {
  return `messenger.messageCard.opinion.kindLabel.${kind}`;
}

/**
 * 본문 collapse 가능 여부 — content 길이만으로 결정 (DOM 측정 X — 서버 사이드
 * 렌더 호환).
 */
function shouldCollapseByDefault(content: string): boolean {
  return content.length > COLLAPSE_THRESHOLD_CHARS;
}

/**
 * 의견 카드 헤더 — 발화 ID (authorLabel) + 의견 트리 ID (screenId) + kind label.
 * spec §11.13a "발화 ID + 의견 트리 ID 둘 다 카드 헤더에 표시".
 */
function OpinionCardHeader({
  meta,
}: {
  meta: OpinionCardMeta;
}): ReactElement {
  const { t } = useTranslation();
  const kindLabel = t(opinionKindLabelKey(meta.opinionKind));
  return (
    <CardHeader
      heading={
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            data-testid="message-card-author-label"
            className="font-mono text-xs text-fg-muted"
          >
            {meta.authorLabel}
          </span>
          <span
            data-testid="message-card-screen-id"
            className="font-mono text-xs font-semibold text-brand"
          >
            {meta.opinionScreenId}
          </span>
          <span
            data-testid="message-card-kind-label"
            data-opinion-kind={meta.opinionKind}
            className="text-xs text-fg-subtle"
          >
            {kindLabel}
          </span>
          {meta.opinionTitle !== undefined && meta.opinionTitle !== null && meta.opinionTitle.length > 0 ? (
            <span
              data-testid="message-card-title"
              className="text-sm font-semibold text-fg"
            >
              {meta.opinionTitle}
            </span>
          ) : null}
        </div>
      }
    />
  );
}

/**
 * Opinion / minutes 카드 공용 본문 컨테이너 — collapse toggle 포함.
 */
function CollapsibleBody({
  content,
  rationale,
}: {
  content: string;
  rationale?: string | null;
}): ReactElement {
  const { t } = useTranslation();
  const collapsibleByDefault = shouldCollapseByDefault(content);
  const [collapsed, setCollapsed] = useState(collapsibleByDefault);

  return (
    <CardBody>
      <div
        data-testid="message-card-body"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={clsx(
          'whitespace-pre-wrap break-words text-sm text-fg',
          collapsed && 'overflow-hidden',
        )}
        style={collapsed ? { maxHeight: `${COLLAPSED_MAX_HEIGHT_PX}px` } : undefined}
      >
        {content}
      </div>
      {rationale !== undefined && rationale !== null && rationale.length > 0 ? (
        <div
          data-testid="message-card-rationale"
          className="mt-2 border-l-2 border-border-soft pl-2 text-xs text-fg-muted whitespace-pre-wrap break-words"
        >
          {rationale}
        </div>
      ) : null}
      {collapsibleByDefault ? (
        <button
          type="button"
          data-testid="message-card-toggle"
          data-collapsed={collapsed ? 'true' : 'false'}
          onClick={() => setCollapsed((v) => !v)}
          className="mt-2 text-xs text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {collapsed
            ? t('messenger.messageCard.expand')
            : t('messenger.messageCard.collapse')}
        </button>
      ) : null}
    </CardBody>
  );
}

/**
 * Opinion 카드 액션 버튼 footer. handlers 가 미주입이면 footer 자체 렌더 X.
 */
function OpinionActionFooter({
  meta,
  selected,
  handlers,
}: {
  meta: OpinionCardMeta;
  selected: boolean;
  handlers: OpinionCardActionHandlers;
}): ReactElement | null {
  const { t } = useTranslation();
  const { onVote, onSelectToggle, onPropose } = handlers;
  const buttons: ReactElement[] = [];

  // 동의 / 반대 — root / revise / block / addition / self-raised / user-raised 모두.
  if (onVote !== undefined) {
    buttons.push(
      <button
        key="vote-agree"
        type="button"
        data-testid="message-card-action-agree"
        onClick={() => onVote(meta.opinionRef, 'agree')}
        className="rounded-md border border-success bg-elev px-2 py-1 text-xs text-success hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('messenger.messageCard.action.agree')}
      </button>,
      <button
        key="vote-oppose"
        type="button"
        data-testid="message-card-action-oppose"
        onClick={() => onVote(meta.opinionRef, 'oppose')}
        className="rounded-md border border-danger bg-elev px-2 py-1 text-xs text-danger hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('messenger.messageCard.action.oppose')}
      </button>,
    );
  }

  // 선택 / 취소 — idea-workflow root 카드 전용.
  if (onSelectToggle !== undefined && meta.opinionKind === 'root') {
    buttons.push(
      <button
        key="select-toggle"
        type="button"
        data-testid="message-card-action-select"
        data-selected={selected ? 'true' : 'false'}
        onClick={() => onSelectToggle(meta.opinionRef, !selected)}
        className={clsx(
          'rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          selected
            ? 'border-brand bg-brand text-action-primary-fg'
            : 'border-border-soft bg-elev text-fg hover:bg-canvas',
        )}
      >
        {selected
          ? t('messenger.messageCard.action.unselect')
          : t('messenger.messageCard.action.select')}
      </button>,
    );
  }

  // 수정안 제시 — root / revise / block / addition (자유 토론 진입 가능).
  // self-raised / user-raised (일반 채널) 는 회의 surface 가 없으므로 제외.
  const proposable: OpinionKind[] = ['root', 'revise', 'block', 'addition'];
  if (
    onPropose !== undefined &&
    proposable.indexOf(meta.opinionKind) >= 0
  ) {
    buttons.push(
      <button
        key="propose"
        type="button"
        data-testid="message-card-action-propose"
        onClick={() => onPropose(meta.opinionRef)}
        className="rounded-md border border-border-soft bg-elev px-2 py-1 text-xs text-fg hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('messenger.messageCard.action.propose')}
      </button>,
    );
  }

  if (buttons.length === 0) return null;
  return (
    <CardFooter data-testid="message-card-footer">{buttons}</CardFooter>
  );
}

function MinutesActionFooter({
  meta,
  handlers,
}: {
  meta: MinutesCardMeta;
  handlers: MinutesCardActionHandlers;
}): ReactElement | null {
  const { t } = useTranslation();
  const { onMinutesOpen, onHandoff } = handlers;
  const buttons: ReactElement[] = [];

  if (onMinutesOpen !== undefined) {
    buttons.push(
      <button
        key="minutes-open"
        type="button"
        data-testid="message-card-action-minutes-open"
        onClick={() => onMinutesOpen(meta.minutesPath)}
        className="rounded-md border border-border-soft bg-elev px-2 py-1 text-xs text-fg hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('messenger.messageCard.action.minutesOpen')}
      </button>,
    );
  }

  if (onHandoff !== undefined) {
    buttons.push(
      <button
        key="handoff"
        type="button"
        data-testid="message-card-action-handoff"
        onClick={() => onHandoff(meta.minutesPath)}
        className="rounded-md border border-brand bg-brand px-2 py-1 text-xs text-action-primary-fg hover:bg-brand-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {t('messenger.messageCard.action.handoff')}
      </button>,
    );
  }

  if (buttons.length === 0) return null;
  return (
    <CardFooter data-testid="message-card-footer">{buttons}</CardFooter>
  );
}

/**
 * Opinion 카드 — root / revise / block / addition / self-raised / user-raised 6 종.
 */
function OpinionCard({
  message,
  meta,
  selected,
  handlers,
  className,
}: {
  message: ChannelMessage;
  meta: OpinionCardMeta;
  selected: boolean;
  handlers: OpinionCardActionHandlers;
  className?: string;
}): ReactElement {
  const { themeKey } = useTheme();
  return (
    <Card
      data-testid="message-card"
      data-message-id={message.id}
      data-card-variant="opinion"
      data-opinion-kind={meta.opinionKind}
      data-opinion-ref={meta.opinionRef}
      data-theme-variant={themeKey}
      className={clsx('mx-4 my-1', className)}
    >
      <OpinionCardHeader meta={meta} />
      <CollapsibleBody content={message.content} rationale={meta.opinionRationale} />
      <OpinionActionFooter meta={meta} selected={selected} handlers={handlers} />
    </Card>
  );
}

/**
 * 회의록 카드 — compose_minutes phase 결과. body = full minutes markdown.
 */
function MinutesCard({
  message,
  meta,
  handlers,
  className,
}: {
  message: ChannelMessage;
  meta: MinutesCardMeta;
  handlers: MinutesCardActionHandlers;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const { themeKey } = useTheme();
  return (
    <Card
      data-testid="message-card"
      data-message-id={message.id}
      data-card-variant="minutes"
      data-minutes-source={meta.minutesSource}
      data-theme-variant={themeKey}
      className={clsx('mx-4 my-1', className)}
    >
      <CardHeader
        heading={
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              data-testid="message-card-minutes-title"
              className="text-sm font-semibold text-fg"
            >
              {t('messenger.messageCard.minutes.title')}
            </span>
            <span
              data-testid="message-card-minutes-source"
              data-source={meta.minutesSource}
              className="font-mono text-xs text-fg-subtle"
            >
              {t(`messenger.messageCard.minutes.source.${meta.minutesSource}`)}
            </span>
          </div>
        }
      />
      <CollapsibleBody content={message.content} />
      <MinutesActionFooter meta={meta} handlers={handlers} />
    </Card>
  );
}

/**
 * 채팅창 카드 메시지 entry — meta 로 분기.
 *
 * - `meta.opinion` 존재 → OpinionCard
 * - `meta.minutes`  존재 → MinutesCard
 * - 둘 다 없으면 caller 가 잘못 dispatch — null 반환 (defensive). Thread.tsx
 *   의 dispatcher 는 `isCardMessage` 가 true 일 때만 본 컴포넌트를 호출한다.
 */
export function MessageCardVariant({
  message,
  selected = false,
  opinionHandlers,
  minutesHandlers,
  className,
}: MessageCardVariantProps): ReactElement | null {
  const meta = message.meta;
  if (hasOpinionMeta(meta)) {
    return (
      <OpinionCard
        message={message}
        meta={meta.opinion}
        selected={selected}
        handlers={opinionHandlers ?? {}}
        className={className}
      />
    );
  }
  if (hasMinutesMeta(meta)) {
    return (
      <MinutesCard
        message={message}
        meta={meta.minutes}
        handlers={minutesHandlers ?? {}}
        className={className}
      />
    );
  }
  return null;
}

/**
 * Thread.tsx dispatcher 가 분기 결정에 사용.
 *
 * `system` author 이면서 minutes meta 가 있는 경우는 SystemMessage 가 아니라
 * MinutesCard 로 가야 한다. opinion meta 는 author 가 'member' / 'user' /
 * 'system' 어느 것이든 카드로 간다 (system raised opinion 시나리오는 없으나
 * 미래 호환).
 */
export function isCardMessage(message: ChannelMessage): boolean {
  return hasOpinionMeta(message.meta) || hasMinutesMeta(message.meta);
}
