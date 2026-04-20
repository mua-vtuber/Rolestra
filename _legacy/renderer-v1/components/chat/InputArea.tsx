/**
 * InputArea — chat input area with attachment chips, toolbar buttons,
 * textarea, and send button.
 *
 * Extracted from ChatView for clarity and testability.
 */

import { useTranslation } from 'react-i18next';

export interface InputAreaProps {
  /** Current text value. */
  input: string;
  /** Setter for the text value. */
  onInputChange: (value: string) => void;
  /** Keyboard handler for the textarea (Enter to send, etc.). */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Handler for the send button. */
  onSend: () => void;
  /** Whether inputs should be disabled (no active providers). */
  disabled: boolean;
  /** Whether a pending diff blocks sending. */
  pendingDiffs: boolean;
  /** Currently attached folder paths. */
  attachments: string[];
  /** Handler to attach a folder. */
  onAttachFiles: () => void;
  /** Handler to remove an attachment by index. */
  onRemoveAttachment: (index: number) => void;
  /** Whether the history panel is open (for toggle button style). */
  historyOpen: boolean;
  /** Toggle history panel. */
  onHistoryToggle: () => void;
  /** Whether the memory panel is open (for toggle button style). */
  memoryOpen: boolean;
  /** Toggle memory panel. */
  onMemoryToggle: () => void;
}

export function InputArea({
  input,
  onInputChange,
  onKeyDown,
  onSend,
  disabled,
  pendingDiffs,
  attachments,
  onAttachFiles,
  onRemoveAttachment,
  historyOpen,
  onHistoryToggle,
  memoryOpen,
  onMemoryToggle,
}: InputAreaProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <>
      {/* Toolbar buttons */}
      <div className="input-toolbar">
        <button
          onClick={onHistoryToggle}
          className={`btn-control btn-control--sm${historyOpen ? ' active' : ''}`}
        >
          {t('history.title')}
        </button>
        <button
          onClick={onMemoryToggle}
          className={`btn-control btn-control--sm${memoryOpen ? ' active' : ''}`}
        >
          {t('memory.title')}
        </button>
      </div>

      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((path, i) => (
            <span key={i} className="chip active chip--sm">
              {path.split(/[\\/]/).pop()}
              <button
                onClick={() => onRemoveAttachment(i)}
                className="chip-remove"
                aria-label="remove"
              >
                {'\u00D7'}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Text input row */}
      <div className="chat-input-area">
        <button
          onClick={() => void onAttachFiles()}
          disabled={disabled}
          className="btn-control btn-attach"
          title={t('chat.attach')}
        >
          +
        </button>
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.placeholder')}
          disabled={disabled || pendingDiffs}
          rows={2}
          className="chat-textarea"
        />
        <button
          onClick={onSend}
          disabled={disabled || !input.trim() || pendingDiffs}
          className="btn-primary"
        >
          {t('chat.send')}
        </button>
      </div>
    </>
  );
}
