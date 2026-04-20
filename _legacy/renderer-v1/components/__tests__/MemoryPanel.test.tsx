/**
 * MemoryPanel component tests.
 *
 * Tests search, pinned list, detail view, extraction preview/execute.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { installArenaMock } from './setup';
import type { MemorySearchResult, KnowledgeNode, ExtractionResult } from '../../../shared/memory-types';

import { MemoryPanel, type MemoryPanelProps } from '../chat/MemoryPanel';

// ── Test Data ─────────────────────────────────────────────────────────

function makeSearchResult(overrides?: Partial<MemorySearchResult>): MemorySearchResult {
  return {
    id: 'node-1',
    content: 'Test knowledge content',
    topic: 'technical',
    pinned: false,
    score: 0.85,
    ...overrides,
  };
}

function makeNode(overrides?: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: 'node-1',
    content: 'Full node content',
    nodeType: 'fact',
    topic: 'technical',
    importance: 0.8,
    source: 'extraction',
    pinned: true,
    conversationId: 'conv-1',
    messageId: 'msg-1',
    lastAccessed: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    embeddingVersion: null,
    extractorVersion: null,
    sourceHash: null,
    dedupeKey: null,
    ...overrides,
  };
}

function defaultProps(overrides?: Partial<MemoryPanelProps>): MemoryPanelProps {
  return {
    query: '',
    onQueryChange: vi.fn(),
    topic: '',
    onTopicChange: vi.fn(),
    results: [],
    onSearch: vi.fn(),
    onClose: vi.fn(),
    pinnedNodes: [],
    onLoadPinned: vi.fn(),
    onViewDetail: vi.fn(),
    onDeleteNode: vi.fn(),
    detailNode: null,
    onCloseDetail: vi.fn(),
    extractionPreview: null,
    extractionResult: null,
    onExtractPreview: vi.fn(),
    onExtractExecute: vi.fn(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('MemoryPanel', () => {
  beforeEach(() => {
    installArenaMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders search tab by default', () => {
    render(<MemoryPanel {...defaultProps()} />);
    expect(screen.getByPlaceholderText('memory.searchPlaceholder')).toBeInTheDocument();
  });

  it('shows search results with detail button', () => {
    const results = [makeSearchResult({ id: 'n1', content: 'First result' })];
    render(<MemoryPanel {...defaultProps({ results })} />);

    expect(screen.getByText('First result')).toBeInTheDocument();
    expect(screen.getByText('memory.detail.view')).toBeInTheDocument();
  });

  it('calls onViewDetail when detail button clicked', () => {
    const onViewDetail = vi.fn();
    const results = [makeSearchResult({ id: 'n1' })];
    render(<MemoryPanel {...defaultProps({ results, onViewDetail })} />);

    fireEvent.click(screen.getByText('memory.detail.view'));
    expect(onViewDetail).toHaveBeenCalledWith('n1');
  });

  it('switches to pinned tab', () => {
    const onLoadPinned = vi.fn();
    render(<MemoryPanel {...defaultProps({ onLoadPinned })} />);

    fireEvent.click(screen.getByText('memory.pinnedList'));
    expect(onLoadPinned).toHaveBeenCalled();
    expect(screen.getByText('memory.noPinned')).toBeInTheDocument();
  });

  it('renders pinned nodes', () => {
    const pinnedNodes = [makeNode({ id: 'p1', content: 'Pinned fact' })];
    render(<MemoryPanel {...defaultProps({ pinnedNodes })} />);

    fireEvent.click(screen.getByText('memory.pinnedList'));
    expect(screen.getByText('Pinned fact')).toBeInTheDocument();
  });

  it('calls onDeleteNode from pinned tab', () => {
    const onDeleteNode = vi.fn();
    const pinnedNodes = [makeNode({ id: 'p1' })];
    render(<MemoryPanel {...defaultProps({ pinnedNodes, onDeleteNode })} />);

    fireEvent.click(screen.getByText('memory.pinnedList'));
    fireEvent.click(screen.getByText('memory.detail.delete'));
    expect(onDeleteNode).toHaveBeenCalledWith('p1');
  });

  it('shows detail dialog when detailNode is set', () => {
    const detailNode = makeNode({ content: 'Detailed content' });
    render(<MemoryPanel {...defaultProps({ detailNode })} />);

    expect(screen.getByText('memory.detail.title')).toBeInTheDocument();
    expect(screen.getByText('Detailed content')).toBeInTheDocument();
  });

  it('calls onExtractPreview', () => {
    const onExtractPreview = vi.fn();
    render(<MemoryPanel {...defaultProps({ onExtractPreview })} />);

    fireEvent.click(screen.getByText('memory.extraction.preview'));
    expect(onExtractPreview).toHaveBeenCalled();
  });

  it('shows extraction preview items', () => {
    const extractionPreview: ExtractionResult = {
      items: [
        { content: 'Extracted fact about testing', nodeType: 'fact', topic: 'technical', importance: 0.7 },
      ],
      turnCount: 5,
    };
    render(<MemoryPanel {...defaultProps({ extractionPreview })} />);

    expect(screen.getByText('memory.extraction.previewTitle')).toBeInTheDocument();
    expect(screen.getByText(/Extracted fact about testing/)).toBeInTheDocument();
  });

  it('shows execute button when preview has items', () => {
    const onExtractExecute = vi.fn();
    const extractionPreview: ExtractionResult = {
      items: [{ content: 'x', nodeType: 'fact', topic: 'technical', importance: 0.5 }],
      turnCount: 1,
    };
    render(<MemoryPanel {...defaultProps({ extractionPreview, onExtractExecute })} />);

    const executeBtn = screen.getByText('memory.extraction.execute');
    fireEvent.click(executeBtn);
    expect(onExtractExecute).toHaveBeenCalled();
  });

  it('shows extraction result', () => {
    const extractionResult = { stored: 3, skipped: 1 };
    render(<MemoryPanel {...defaultProps({ extractionResult })} />);

    expect(screen.getByText('memory.extraction.result')).toBeInTheDocument();
  });

  it('shows no items message for empty preview', () => {
    const extractionPreview: ExtractionResult = { items: [], turnCount: 5 };
    render(<MemoryPanel {...defaultProps({ extractionPreview })} />);

    expect(screen.getByText('memory.extraction.noItems')).toBeInTheDocument();
  });
});
