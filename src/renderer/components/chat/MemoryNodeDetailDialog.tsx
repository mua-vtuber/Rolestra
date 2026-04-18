/**
 * MemoryNodeDetailDialog — displays full KnowledgeNode details with delete action.
 */

import { useTranslation } from 'react-i18next';
import type { KnowledgeNode } from '../../../shared/memory-types';

export interface MemoryNodeDetailDialogProps {
  node: KnowledgeNode;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function MemoryNodeDetailDialog({ node, onDelete, onClose }: MemoryNodeDetailDialogProps): React.JSX.Element {
  const { t } = useTranslation();

  const handleDelete = (): void => {
    if (window.confirm(t('memory.detail.deleteConfirm'))) {
      onDelete(node.id);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-panel" style={{ maxWidth: 500, maxHeight: '80vh', overflow: 'auto' }}>
        <div className="dialog-header">
          <strong>{t('memory.detail.title')}</strong>
          <button className="btn-control btn-control--sm" onClick={onClose}>X</button>
        </div>

        <div className="settings-card" style={{ margin: '8px 0' }}>
          <div className="result-content" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
            {node.content}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.85em' }}>
            <span><strong>{t('memory.detail.type')}:</strong> {node.nodeType}</span>
            <span><strong>{t('memory.detail.topic')}:</strong> {t(`memory.topic.${node.topic}`)}</span>
            <span><strong>{t('memory.detail.importance')}:</strong> {node.importance}</span>
            <span><strong>{t('memory.detail.source')}:</strong> {node.source}</span>
            <span><strong>{t('memory.detail.pinned')}:</strong> {node.pinned ? t('memory.pinned') : '-'}</span>
            <span><strong>{t('memory.detail.created')}:</strong> {new Date(node.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="action-buttons" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-danger btn-primary--sm" onClick={handleDelete}>
            {t('memory.detail.delete')}
          </button>
          <button className="btn-control btn-primary--sm" onClick={onClose}>
            {t('app.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
