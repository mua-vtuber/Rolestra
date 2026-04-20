/**
 * useMemoryPanel -- manages memory panel visibility, search, pin, pinned list,
 * node detail, delete, and extraction preview/execute.
 */

import { useState, useCallback } from 'react';
import type { MemoryTopic, MemorySearchResult, KnowledgeNode, ExtractionResult } from '../../shared/memory-types';
import { useChatStore } from '../stores/chat-store';
import { showError } from './useErrorDialog';

export interface UseMemoryPanelReturn {
  memoryOpen: boolean;
  memoryQuery: string;
  setMemoryQuery: (v: string) => void;
  memoryTopic: MemoryTopic | '';
  setMemoryTopic: (v: MemoryTopic | '') => void;
  memoryResults: MemorySearchResult[];
  handleMemorySearch: () => Promise<void>;
  handlePinMessage: (messageId: string, topic: MemoryTopic) => Promise<void>;
  handleToggleMemory: () => void;
  pinnedNodes: KnowledgeNode[];
  handleLoadPinned: () => void;
  handleViewDetail: (id: string) => void;
  handleDeleteNode: (id: string) => void;
  detailNode: KnowledgeNode | null;
  handleCloseDetail: () => void;
  extractionPreview: ExtractionResult | null;
  extractionResult: { stored: number; skipped: number } | null;
  handleExtractPreview: () => void;
  handleExtractExecute: () => void;
}

export function useMemoryPanel(): UseMemoryPanelReturn {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [memoryTopic, setMemoryTopic] = useState<MemoryTopic | ''>('');
  const [memoryResults, setMemoryResults] = useState<MemorySearchResult[]>([]);
  const [pinnedNodes, setPinnedNodes] = useState<KnowledgeNode[]>([]);
  const [detailNode, setDetailNode] = useState<KnowledgeNode | null>(null);
  const [extractionPreview, setExtractionPreview] = useState<ExtractionResult | null>(null);
  const [extractionResult, setExtractionResult] = useState<{ stored: number; skipped: number } | null>(null);

  const handleMemorySearch = useCallback(async (): Promise<void> => {
    if (!memoryQuery.trim()) return;
    try {
      const result = await window.arena.invoke('memory:search', {
        query: memoryQuery.trim(),
        topic: memoryTopic || undefined,
        limit: 20,
      });
      setMemoryResults(result.results);
    } catch (err) { showError('memory:search', err); }
  }, [memoryQuery, memoryTopic]);

  const handlePinMessage = useCallback(async (messageId: string, topic: MemoryTopic): Promise<void> => {
    try {
      await window.arena.invoke('memory:pin', { messageId, topic });
    } catch (err) { showError('memory:pin', err); }
  }, []);

  const handleToggleMemory = useCallback((): void => {
    setMemoryOpen((prev) => !prev);
  }, []);

  const handleLoadPinned = useCallback((): void => {
    void (async () => {
      try {
        const result = await window.arena.invoke('memory:get-pinned', {
          topic: memoryTopic || undefined,
        });
        setPinnedNodes(result.nodes);
      } catch (err) { showError('memory:get-pinned', err); }
    })();
  }, [memoryTopic]);

  const handleViewDetail = useCallback((id: string): void => {
    void (async () => {
      try {
        const result = await window.arena.invoke('memory:get-node', { id });
        if (result.node) setDetailNode(result.node);
      } catch (err) { showError('memory:get-node', err); }
    })();
  }, []);

  const handleDeleteNode = useCallback((id: string): void => {
    void (async () => {
      try {
        await window.arena.invoke('memory:delete-node', { id });
        // Remove from current lists
        setMemoryResults((prev) => prev.filter((r) => r.id !== id));
        setPinnedNodes((prev) => prev.filter((n) => n.id !== id));
        setDetailNode(null);
      } catch (err) { showError('memory:delete-node', err); }
    })();
  }, []);

  const handleCloseDetail = useCallback((): void => {
    setDetailNode(null);
  }, []);

  const handleExtractPreview = useCallback((): void => {
    void (async () => {
      try {
        const messages = useChatStore.getState().messages
          .filter((m) => m.role !== 'system')
          .slice(-10)
          .map((m) => ({ content: m.content, participantId: m.speakerName ?? 'user' }));
        if (messages.length === 0) return;
        const result = await window.arena.invoke('memory:extract-preview', { messages });
        setExtractionPreview(result);
        setExtractionResult(null);
      } catch (err) { showError('memory:extract-preview', err); }
    })();
  }, []);

  const handleExtractExecute = useCallback((): void => {
    void (async () => {
      try {
        const messages = useChatStore.getState().messages
          .filter((m) => m.role !== 'system')
          .slice(-10)
          .map((m) => ({ content: m.content, participantId: m.speakerName ?? 'user' }));
        if (messages.length === 0) return;
        const result = await window.arena.invoke('memory:extract-and-store', { messages });
        setExtractionResult({ stored: result.stored, skipped: result.skipped });
        setExtractionPreview(null);
      } catch (err) { showError('memory:extract-and-store', err); }
    })();
  }, []);

  return {
    memoryOpen,
    memoryQuery,
    setMemoryQuery,
    memoryTopic,
    setMemoryTopic,
    memoryResults,
    handleMemorySearch,
    handlePinMessage,
    handleToggleMemory,
    pinnedNodes,
    handleLoadPinned,
    handleViewDetail,
    handleDeleteNode,
    detailNode,
    handleCloseDetail,
    extractionPreview,
    extractionResult,
    handleExtractPreview,
    handleExtractExecute,
  };
}
