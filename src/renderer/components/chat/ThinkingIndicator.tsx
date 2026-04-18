/**
 * ThinkingIndicator — placeholder bubble shown while waiting for
 * AI response (streaming has not yet started).
 *
 * Extracted from ChatView for clarity.
 */

import { MessageBubble } from './MessageBubble';

export interface ThinkingIndicatorProps {
  timestamp: number;
  highlight: string;
}

export function ThinkingIndicator({ timestamp, highlight }: ThinkingIndicatorProps): React.JSX.Element {
  return (
    <MessageBubble
      message={{
        id: 'thinking-placeholder',
        role: 'assistant',
        content: '',
        speakerName: 'AI',
        timestamp,
        streaming: true,
      }}
      highlight={highlight}
    />
  );
}
