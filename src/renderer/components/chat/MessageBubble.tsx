/**
 * Single chat message bubble with metadata, fork/pin actions.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../stores/chat-store';
import type { MemoryTopic } from '../../../shared/memory-types';
import { StreamingText } from './StreamingText';

export interface MessageBubbleProps {
  message: ChatMessage;
  highlight?: string;
  onPin?: (messageId: string, topic: MemoryTopic) => void;
  onFork?: (messageId: string) => void;
}

export function MessageBubble({ message, highlight, onPin, onFork }: MessageBubbleProps): React.JSX.Element {
  const { t } = useTranslation();
  const [pinMenuOpen, setPinMenuOpen] = useState(false);
  const isUser = message.role === 'user';
  const isThinking = !!message.streaming && !message.content.trim();
  const topics: MemoryTopic[] = ['technical', 'decisions', 'preferences', 'context'];

  return (
    <div className={`message-bubble ${isUser ? 'user' : message.role === 'system' ? 'system' : 'assistant'}`}>
      <div className="message-header">
        <span className={`message-speaker${isUser ? ' message-speaker--user' : ''}`}>
          {message.speakerName ?? message.role}
        </span>
        <div className="message-meta message-meta--inline">
          {onFork && (
            <button onClick={() => onFork(message.id)} className="message-action-btn" title={t('chat.fork')}>
              {'\u2442'}
            </button>
          )}
          {onPin && (
            <div className="pin-menu-wrapper">
              <button onClick={() => setPinMenuOpen((prev) => !prev)} className="message-action-btn" title={t('memory.pin')}>
                {'\u{1F4CC}'}
              </button>
              {pinMenuOpen && (
                <div className="pin-menu">
                  {topics.map((topic) => (
                    <button
                      key={topic}
                      onClick={() => { onPin(message.id, topic); setPinMenuOpen(false); }}
                      className="pin-menu-item"
                    >
                      {t(`memory.topic.${topic}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {message.responseTimeMs != null && (
            <span>
              {message.responseTimeMs < 1000
                ? `${message.responseTimeMs}ms`
                : `${(message.responseTimeMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {message.tokenCount != null && (
            <span>{message.tokenCount} {t('chat.tokens')}</span>
          )}
          <span className="message-timestamp">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>
      <div className="message-content">
        {isThinking ? (
          <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
        ) : (
          <StreamingText text={message.content} highlight={highlight ?? ''} />
        )}
      </div>
    </div>
  );
}
