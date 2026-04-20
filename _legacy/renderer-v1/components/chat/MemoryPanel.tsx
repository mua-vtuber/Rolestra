/**
 * Memory search panel — query, filter by topic, view results, pinned list,
 * node detail, extraction preview/execute.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoryTopic, MemorySearchResult, KnowledgeNode, ExtractionResult } from '../../../shared/memory-types';
import { MemoryNodeDetailDialog } from './MemoryNodeDetailDialog';

export interface MemoryPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  topic: MemoryTopic | '';
  onTopicChange: (value: MemoryTopic | '') => void;
  results: MemorySearchResult[];
  onSearch: () => void;
  onClose: () => void;
  pinnedNodes: KnowledgeNode[];
  onLoadPinned: () => void;
  onViewDetail: (id: string) => void;
  onDeleteNode: (id: string) => void;
  detailNode: KnowledgeNode | null;
  onCloseDetail: () => void;
  extractionPreview: ExtractionResult | null;
  extractionResult: { stored: number; skipped: number } | null;
  onExtractPreview: () => void;
  onExtractExecute: () => void;
}

type Tab = 'search' | 'pinned';

export function MemoryPanel({
  query, onQueryChange, topic, onTopicChange, results, onSearch, onClose,
  pinnedNodes, onLoadPinned, onViewDetail, onDeleteNode,
  detailNode, onCloseDetail,
  extractionPreview, extractionResult, onExtractPreview, onExtractExecute,
}: MemoryPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const topics: MemoryTopic[] = ['technical', 'decisions', 'preferences', 'context'];
  const [tab, setTab] = useState<Tab>('search');

  const handleTabPinned = (): void => {
    setTab('pinned');
    onLoadPinned();
  };

  return (
    <div className="memory-panel">
      <div className="panel-header">
        <strong>{t('memory.title')}</strong>
        <button onClick={onClose} className="btn-control btn-control--sm">
          X
        </button>
      </div>

      {/* Tabs */}
      <div className="action-buttons" style={{ justifyContent: 'flex-start', gap: 4, marginBottom: 8 }}>
        <button
          className={`chip${tab === 'search' ? ' active' : ''}`}
          onClick={() => setTab('search')}
        >
          {t('memory.search')}
        </button>
        <button
          className={`chip${tab === 'pinned' ? ' active' : ''}`}
          onClick={handleTabPinned}
        >
          {t('memory.pinnedList')}
        </button>
      </div>

      {/* Search tab */}
      {tab === 'search' && (
        <>
          <div className="search-controls">
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={t('memory.searchPlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
              className="settings-input"
              style={{ flex: 1, padding: '6px 10px', fontSize: 13 }}
            />
            <select
              value={topic}
              onChange={(e) => onTopicChange(e.target.value as MemoryTopic | '')}
              className="settings-select"
              style={{ fontSize: 13 }}
            >
              <option value="">{t('memory.allTopics')}</option>
              {topics.map((tp) => (
                <option key={tp} value={tp}>{t(`memory.topic.${tp}`)}</option>
              ))}
            </select>
            <button onClick={onSearch} className="btn-primary btn-primary--md">
              {t('memory.search')}
            </button>
          </div>

          {results.length === 0 && query.trim() && (
            <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('memory.noResults')}</p>
          )}

          {results.map((r) => (
            <div key={r.id} className="settings-card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="result-header">
                <span className="chip active" style={{ padding: '1px 6px', fontSize: 10 }}>
                  {t(`memory.topic.${r.topic}`)}
                </span>
                <div className="result-meta">
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {r.pinned ? t('memory.pinned') : ''}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="result-content">
                {r.content}
              </div>
              <div className="action-buttons" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
                <button className="chip" onClick={() => onViewDetail(r.id)}>
                  {t('memory.detail.view')}
                </button>
              </div>
            </div>
          ))}

          {/* Extraction controls */}
          <div className="action-buttons" style={{ justifyContent: 'flex-start', gap: 8, marginTop: 12 }}>
            <button className="btn-control btn-primary--sm" onClick={onExtractPreview}>
              {t('memory.extraction.preview')}
            </button>
            {extractionPreview && extractionPreview.items.length > 0 && (
              <button className="btn-primary btn-primary--sm" onClick={onExtractExecute}>
                {t('memory.extraction.execute')}
              </button>
            )}
          </div>

          {extractionPreview && (
            <div className="settings-card" style={{ padding: 8, marginTop: 8 }}>
              <strong style={{ fontSize: '0.85em' }}>{t('memory.extraction.previewTitle')}</strong>
              {extractionPreview.items.length === 0 ? (
                <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                  {t('memory.extraction.noItems')}
                </p>
              ) : (
                <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: '0.85em' }}>
                  {extractionPreview.items.map((item, i) => (
                    <li key={i}>
                      <span className="chip chip--info" style={{ fontSize: 10, padding: '0 4px' }}>
                        {item.topic}
                      </span>{' '}
                      {item.content.slice(0, 80)}{item.content.length > 80 ? '...' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {extractionResult && (
            <p className="text-base" style={{ color: 'var(--text-success)', marginTop: 4, fontSize: '0.85em' }}>
              {t('memory.extraction.result', { stored: extractionResult.stored, skipped: extractionResult.skipped })}
            </p>
          )}
        </>
      )}

      {/* Pinned tab */}
      {tab === 'pinned' && (
        <>
          {pinnedNodes.length === 0 && (
            <p className="text-base" style={{ color: 'var(--text-tertiary)', margin: 0 }}>{t('memory.noPinned')}</p>
          )}
          {pinnedNodes.map((node) => (
            <div key={node.id} className="settings-card" style={{ padding: 10, marginBottom: 8 }}>
              <div className="result-header">
                <span className="chip active" style={{ padding: '1px 6px', fontSize: 10 }}>
                  {t(`memory.topic.${node.topic}`)}
                </span>
              </div>
              <div className="result-content">{node.content}</div>
              <div className="action-buttons" style={{ justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
                <button className="chip" onClick={() => onViewDetail(node.id)}>
                  {t('memory.detail.view')}
                </button>
                <button className="chip chip--error" onClick={() => onDeleteNode(node.id)}>
                  {t('memory.detail.delete')}
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Node detail dialog */}
      {detailNode && (
        <MemoryNodeDetailDialog
          node={detailNode}
          onDelete={onDeleteNode}
          onClose={onCloseDetail}
        />
      )}
    </div>
  );
}
