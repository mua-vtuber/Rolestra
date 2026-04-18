/**
 * RuntimeLogPanel — collapsible runtime log display in ChatView.
 *
 * Shows stream:log entries with level-based color coding.
 * Auto-scrolls to bottom unless user has scrolled up.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StreamLogEvent } from '../../../shared/stream-types';

export interface RuntimeLogPanelProps {
  entries: StreamLogEvent[];
}

const LEVEL_CLASS: Record<string, string> = {
  info: 'log-entry--info',
  warn: 'log-entry--warn',
  error: 'log-entry--error',
};

export function RuntimeLogPanel({ entries }: RuntimeLogPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Auto-scroll when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries.length]);

  const handleScroll = (): void => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  };

  if (entries.length === 0) return <></>;

  return (
    <div className="runtime-log-panel">
      <button
        className="runtime-log-toggle"
        onClick={() => setCollapsed((v) => !v)}
      >
        {t('log.runtime.title')} ({entries.length})
        <span className="runtime-log-chevron">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </button>

      {!collapsed && (
        <div
          ref={containerRef}
          className="runtime-log-entries"
          onScroll={handleScroll}
        >
          {entries.map((entry, i) => (
            <div key={`${entry.timestamp}-${i}`} className={`runtime-log-entry ${LEVEL_CLASS[entry.level] ?? ''}`}>
              <span className="runtime-log-time">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={`runtime-log-level runtime-log-level--${entry.level}`}>
                [{entry.level.toUpperCase()}]
              </span>
              {entry.participantId && (
                <span className="runtime-log-participant">{entry.participantId}</span>
              )}
              <span className="runtime-log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
