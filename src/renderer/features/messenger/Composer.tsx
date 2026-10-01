/**
 * Composer — 대화 입력칸 (spec 2026-10-01-messenger-redesign.md R3-7).
 *
 * - 말풍선 방식: 입력칸 + 넘기기(`actions`) + 보내기 아이콘 버튼.
 * - 로그 방식: `나>` 프롬프트 + 입력칸 + `[넘기기] [보내기]`.
 * "@ 멘션 ⌘ 명령" 안내 줄은 없다. readOnly 면 입력 비활성 + 배지만.
 *
 * Key handling:
 * - Enter            → `use-channel-messages().send(content)` 호출. 성공 시
 *                      입력 클리어 + onSendSuccess 콜백.
 * - Shift+Enter      → 기본 textarea 개행(preventDefault 안 함).
 * - 한글 조합 중 Enter 는 보내지 않는다.
 * - send 실패 시 입력 유지 + `messenger.composer.errorSend` 를 inline 표면.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { LineIcon } from '../../components/shell/LineIcon';
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
  /** Controls shown next to the input, e.g. the pass button (spec 2026-10-01 F1). */
  actions?: ReactNode;
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
  actions,
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

  const logLayout = token.messageLayout === 'log';

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
      : logLayout ? 'messenger.composer.placeholderLog' : 'messenger.composer.placeholder';

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

  const inputDisabled = readOnly || workflowDisabled || submitting;
  const canSend = !inputDisabled && value.trim().length > 0;
  const textarea = (
    <textarea
      data-testid="composer-textarea"
      value={value}
      rows={1}
      disabled={inputDisabled}
      placeholder={t(placeholderKey)}
      onChange={handleChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
      aria-label={t('messenger.composer.inputAriaLabel')}
      className={clsx(
        'h-11 min-w-0 flex-1 resize-none text-body text-fg outline-none',
        'placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-muted',
        logLayout
          ? 'bg-transparent py-2.5'
          : 'border border-border bg-sunk px-3.5 py-3 [clip-path:var(--clip-control)]',
      )}
    />
  );

  return (
    <div
      data-testid="composer"
      data-theme-variant={themeKey}
      data-layout={token.messageLayout}
      data-readonly={readOnly ? 'true' : 'false'}
      data-workflow-disabled={workflowDisabled ? 'true' : 'false'}
      data-channel-id={channelId}
      className={clsx(
        'flex shrink-0 flex-col gap-1.5 border-t border-border-soft px-5 pb-4 pt-3 [background:var(--color-topbar-bg)]',
        className,
      )}
    >
      {readOnly ? (
        <div data-testid="composer-readonly-badge" className="text-xs font-semibold text-fg-muted">
          {t('messenger.composer.readOnlyBadge')}
        </div>
      ) : null}

      {workflowDisabled && !readOnly ? (
        <div data-testid="composer-workflow-disabled-badge" className="text-xs font-semibold text-fg-muted">
          {t(placeholderKey)}
        </div>
      ) : null}

      {logLayout ? (
        <div data-testid="composer-input-row" className="flex items-center gap-3 text-body">
          <span data-testid="composer-prompt" aria-hidden="true" className="shrink-0 font-bold text-brand-text">
            {t('messenger.composer.logPrompt')}
          </span>
          {textarea}
          {actions}
          <button type="button" data-testid="composer-send" disabled={!canSend}
            onClick={() => { void handleSend(); }}
            className="h-11 shrink-0 px-1.5 font-bold text-brand-text disabled:opacity-40">
            {t('messenger.composer.sendLog')}
          </button>
        </div>
      ) : (
        <div data-testid="composer-input-row" className="flex items-start gap-2.5">
          {textarea}
          {actions}
          <button type="button" data-testid="composer-send" disabled={!canSend}
            aria-label={t('messenger.composer.send')} onClick={() => { void handleSend(); }}
            className="flex h-11 w-11 shrink-0 items-center justify-center bg-brand text-brand-fg disabled:opacity-40 [clip-path:var(--clip-control)]">
            <LineIcon name="send" size={18} stroke={2} />
          </button>
        </div>
      )}

      {error !== null && (
        <p role="alert" data-testid="composer-error" className="text-xs text-danger-text">
          {t('messenger.composer.errorSend', { reason: error })}
        </p>
      )}
    </div>
  );
}
