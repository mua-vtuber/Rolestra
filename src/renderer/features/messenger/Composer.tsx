/**
 * Composer — 채널 메시지 입력창 (R5-Task8).
 *
 * D5 결정에 따라 `panelRadius` 토큰을 재활용한다(warm=12 / tactical=0 / retro=0).
 * glyph 3-way(`✎` / `✎` / `>`) + font 3-way(sans / sans / mono). readOnly=true
 * (system_approval / system_minutes) 일 때는 입력 비활성 + 배지만 렌더한다.
 *
 * Key handling:
 * - Enter            → `use-channel-messages().send(content)` 호출. 성공 시
 *                      입력 클리어 + onSendSuccess 콜백.
 * - Shift+Enter      → 기본 textarea 개행(preventDefault 안 함).
 * - send 실패 시 입력 유지 + `messenger.composer.errorSend` 를 inline 표면.
 *
 * R7 에서 `@mention` 자동완성 + `⌘command` 팝업을 확장할 때까지 hint row 는
 * 라벨만 표시한다(MVP).
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useChannelMessages } from '../../hooks/use-channel-messages';
import { useTheme } from '../../theme/use-theme';

export interface ComposerProps {
  channelId: string;
  readOnly?: boolean;
  onSendSuccess?: () => void;
  className?: string;
}

function toMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

export function Composer({
  channelId,
  readOnly = false,
  onSendSuccess,
  className,
}: ComposerProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();
  const { send } = useChannelMessages(channelId);

  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRetro = themeKey === 'retro';
  const glyph = isRetro ? '>' : '✎';
  const fontClass = isRetro ? 'font-mono' : 'font-sans';

  const handleSend = useCallback(async (): Promise<void> => {
    if (readOnly || submitting) return;
    const content = value.trim();
    if (content.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await send({ content });
      setValue('');
      onSendSuccess?.();
    } catch (reason) {
      // Preserve `value` so the user can retry without retyping.
      setError(toMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }, [readOnly, submitting, value, send, onSendSuccess]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    event.preventDefault();
    void handleSend();
  };

  const inputWrapStyle: CSSProperties = {
    borderRadius: `${token.panelRadius}px`,
  };

  const rootClasses = clsx(
    'flex flex-col gap-2 border-t border-topbar-border bg-elev px-4 py-3',
    className,
  );

  return (
    <div
      data-testid="composer"
      data-theme-variant={themeKey}
      data-readonly={readOnly ? 'true' : 'false'}
      data-channel-id={channelId}
      className={rootClasses}
    >
      {readOnly ? (
        <div
          data-testid="composer-readonly-badge"
          className={clsx('text-xs font-semibold text-fg-muted', fontClass)}
        >
          {t('messenger.composer.readOnlyBadge')}
        </div>
      ) : null}

      <div
        data-testid="composer-input-wrap"
        data-panel-radius={String(token.panelRadius)}
        className={clsx(
          'flex items-start gap-2 border border-border bg-canvas px-3 py-2',
          fontClass,
        )}
        style={inputWrapStyle}
      >
        <span
          data-testid="composer-glyph"
          data-glyph-value={glyph}
          aria-hidden="true"
          className={clsx('mt-0.5 select-none text-fg-subtle', fontClass)}
        >
          {glyph}
        </span>
        <textarea
          data-testid="composer-textarea"
          value={value}
          rows={1}
          disabled={readOnly || submitting}
          placeholder={t('messenger.composer.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={t('messenger.composer.inputAriaLabel')}
          className={clsx(
            'w-full resize-none bg-transparent text-sm text-fg',
            'placeholder:text-fg-subtle focus:outline-none',
            'disabled:cursor-not-allowed disabled:text-fg-muted',
            fontClass,
          )}
        />
      </div>

      {!readOnly && (
        <div
          data-testid="composer-hints"
          className={clsx(
            'flex items-center gap-3 text-[11px] text-fg-subtle',
            fontClass,
          )}
        >
          <span data-testid="composer-hint-mention">
            {t('messenger.composer.hintMention')}
          </span>
          <span data-testid="composer-hint-command">
            {t('messenger.composer.hintCommand')}
          </span>
        </div>
      )}

      {error !== null && (
        <p
          role="alert"
          data-testid="composer-error"
          className={clsx('text-xs text-danger', fontClass)}
        >
          {t('messenger.composer.errorSend', { reason: error })}
        </p>
      )}
    </div>
  );
}
