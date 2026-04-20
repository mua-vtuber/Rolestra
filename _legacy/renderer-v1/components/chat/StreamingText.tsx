/**
 * StreamingText — renders message content with code block detection
 * and search-term highlighting.
 *
 * Extracted from MessageBubble to be reusable and independently testable.
 */

export interface HighlightedTextProps {
  text: string;
  highlight: string;
}

export function HighlightedText({ text, highlight }: HighlightedTextProps): React.JSX.Element {
  if (!highlight) return <>{text}</>;
  const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight ? (
          <mark key={i}>{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export interface StreamingTextProps {
  text: string;
  highlight: string;
}

export function StreamingText({ text, highlight }: StreamingTextProps): React.JSX.Element {
  const blocks: React.JSX.Element[] = [];
  const regex = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const [full, lang, code] = match;
    const start = match.index;
    if (start > cursor) {
      const plain = text.slice(cursor, start);
      blocks.push(
        <span key={`txt-${index++}`}>
          <HighlightedText text={plain} highlight={highlight} />
        </span>,
      );
    }
    blocks.push(
      <div key={`code-${index++}`} className="code-block">
        {(lang ?? '').trim() && (
          <div className="code-block-lang">{(lang ?? '').trim()}</div>
        )}
        <pre>{code}</pre>
      </div>,
    );
    cursor = start + full.length;
  }

  if (cursor < text.length) {
    blocks.push(
      <span key={`txt-${index++}`}>
        <HighlightedText text={text.slice(cursor)} highlight={highlight} />
      </span>,
    );
  }

  if (blocks.length === 0) {
    return <HighlightedText text={text} highlight={highlight} />;
  }

  return <>{blocks}</>;
}
