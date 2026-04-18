/**
 * useChatInput -- manages chat input field state, attachments, send logic,
 * and keyboard event handlers.
 */

import { useState, useCallback } from 'react';
import { useChatStore } from '../stores/chat-store';
import { useProviderStore } from '../stores/provider-store';
import { showError } from './useErrorDialog';
import type { DiffEntry } from '../../shared/execution-types';
import type { ProviderInfo } from '../../shared/provider-types';

export interface UseChatInputReturn {
  input: string;
  setInput: (v: string) => void;
  attachments: string[];
  handleSend: () => void;
  handleAttachFiles: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleRemoveAttachment: (index: number) => void;
  handleToggleProviderSelection: (providerId: string) => void;
  hasProviders: boolean;
  providers: ProviderInfo[];
  activeProviders: ProviderInfo[];
}

export interface UseChatInputParams {
  pendingDiffs: { operationId: string; diffs: DiffEntry[] } | null;
}

export function useChatInput(params: UseChatInputParams): UseChatInputReturn {
  const { pendingDiffs } = params;

  const sending = useChatStore((s) => s.sending);
  const paused = useChatStore((s) => s.paused);
  const send = useChatStore((s) => s.send);
  const interject = useChatStore((s) => s.interject);

  const providers = useProviderStore((s) => s.providers);
  const selectedProviderIds = useProviderStore((s) => s.selectedProviderIds);
  const toggleProviderSelection = useProviderStore((s) => s.toggleProviderSelection);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);

  const hasProviders = providers.length > 0;
  const activeProviders = providers.filter((p) => (selectedProviderIds ?? []).includes(p.id));

  const handleSend = useCallback((): void => {
    const trimmed = input.trim();
    if (!trimmed || activeProviders.length === 0 || pendingDiffs != null) return;
    const files = attachments.length > 0 ? [...attachments] : undefined;
    setInput('');
    setAttachments([]);
    if (sending || paused) {
      void interject(trimmed, activeProviders.map((p) => p.id));
      return;
    }
    void send(trimmed, activeProviders.map((p) => p.id), files);
  }, [input, activeProviders, pendingDiffs, attachments, sending, paused, interject, send]);

  const handleAttachFiles = useCallback(async (): Promise<void> => {
    try {
      const result = await window.arena.invoke('workspace:pick-folder', undefined);
      const folderPath = result.folderPath;
      if (typeof folderPath === 'string' && folderPath.length > 0) {
        setAttachments((prev) => [...prev, folderPath]);
      }
    } catch (err) { showError('workspace:pick-folder', err); }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleRemoveAttachment = useCallback((index: number): void => {
    setAttachments((prev) => prev.filter((_, j) => j !== index));
  }, []);

  const handleToggleProviderSelection = useCallback((providerId: string): void => {
    toggleProviderSelection(providerId);
  }, [toggleProviderSelection]);

  return {
    input,
    setInput,
    attachments,
    handleSend,
    handleAttachFiles,
    handleKeyDown,
    handleRemoveAttachment,
    handleToggleProviderSelection,
    hasProviders,
    providers,
    activeProviders,
  };
}
