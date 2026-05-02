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
  useRef,
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
  /**
   * R12-C T11 — 워크플로우 비활성 상태의 부서 채널을 disabled 표면으로
   * 잠근다. readOnly 와 별개 — 시스템 채널 readonly 배지와 다른 메시지를
   * 보여줘야 하므로 분리. true 면 textarea + send 모두 비활성.
   */
  workflowDisabled?: boolean;
  /**
   * workflowDisabled === true 일 때 표시할 placeholder i18n 키. 미지정
   * 시 기본 `messenger.composer.placeholder` 가 그대로 노출된다.
   */
  disabledPlaceholderKey?: string | null;
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
  workflowDisabled = false,
  disabledPlaceholderKey = null,
  onSendSuccess,
  className,
}: ComposerProps): ReactElement {
  const { t } = useTranslation();
  const { themeKey, token } = useTheme();
  const { send } = useChannelMessages(channelId);

  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tracks IME composition (Korean/Japanese/Chinese syllable assembly).
  // While true, Enter is suppressed because most IMEs use Enter to
  // finalize the candidate — firing `send` on that keystroke would
  // post the half-finished syllable before the IME commits. We do
  // NOT skip `change` updates: with a controlled textarea, dropping
  // the setState during composition makes React revert the rendered
  // value to the prior state on every keystroke, so the user sees
  // typing as a no-op (especially on Windows where having a Korean
  // IME installed can fire compositionstart even for ASCII keys).
  const composingRef = useRef<boolean>(false);

  const isRetro = themeKey === 'retro';
  const glyph = isRetro ? '>' : '✎';
  const fontClass = isRetro ? 'font-mono' : 'font-sans';

  const handleSend = useCallback(async (): Promise<void> => {
    if (readOnly || workflowDisabled || submitting) return;
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
  }, [readOnly, workflowDisabled, submitting, value, send, onSendSuccess]);

  const placeholderKey =
    workflowDisabled && disabledPlaceholderKey !== null
      ? disabledPlaceholderKey
      : 'messenger.composer.placeholder';

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    // IME composition guard: pressing Enter to commit a Korean
    // syllable should NOT fire `send`. `nativeEvent.isComposing` is
    // the standard signal modern browsers expose; some Electron
    // versions also surface `keyCode === 229` for the same case.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (composingRef.current) return;
    event.preventDefault();
    void handleSend();
  };

  const handleChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ): void => {
    setValue(event.target.value);
  };

  const handleCompositionStart = (): void => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (
    event: React.CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    composingRef.current = false;
    setValue((event.target as HTMLTextAreaElement).value);
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
      data-workflow-disabled={workflowDisabled ? 'true' : 'false'}
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

      {workflowDisabled && !readOnly ? (
        <div
          data-testid="composer-workflow-disabled-badge"
          className={clsx('text-xs font-semibold text-fg-muted', fontClass)}
        >
          {t(placeholderKey)}
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
          disabled={readOnly || workflowDisabled || submitting}
          placeholder={t(placeholderKey)}
          onChange={handleChange}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
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
