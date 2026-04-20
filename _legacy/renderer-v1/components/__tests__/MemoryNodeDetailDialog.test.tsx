/**
 * MemoryNodeDetailDialog component tests.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { installArenaMock } from './setup';
import type { KnowledgeNode } from '../../../shared/memory-types';

import { MemoryNodeDetailDialog } from '../chat/MemoryNodeDetailDialog';

function makeNode(overrides?: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: 'node-1',
    content: 'Test knowledge node content',
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

describe('MemoryNodeDetailDialog', () => {
  beforeEach(() => {
    installArenaMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders node content', () => {
    render(<MemoryNodeDetailDialog node={makeNode()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Test knowledge node content')).toBeInTheDocument();
  });

  it('renders node metadata', () => {
    render(<MemoryNodeDetailDialog node={makeNode()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('fact')).toBeInTheDocument();
    expect(screen.getByText('0.8')).toBeInTheDocument();
    expect(screen.getByText('extraction')).toBeInTheDocument();
  });

  it('shows pinned status', () => {
    render(<MemoryNodeDetailDialog node={makeNode({ pinned: true })} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('memory.pinned')).toBeInTheDocument();
  });

  it('shows dash for non-pinned', () => {
    render(<MemoryNodeDetailDialog node={makeNode({ pinned: false })} onDelete={vi.fn()} onClose={vi.fn()} />);
    // The pinned label is inside a <strong> and the value is a text sibling
    const strong = screen.getByText(/memory\.detail\.pinned/);
    const span = strong.closest('span');
    expect(span?.textContent).toContain('-');
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(<MemoryNodeDetailDialog node={makeNode()} onDelete={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByText('app.close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onDelete with confirmation', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryNodeDetailDialog node={makeNode({ id: 'n-del' })} onDelete={onDelete} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('memory.detail.delete'));
    expect(window.confirm).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('n-del');
  });

  it('does not call onDelete if confirmation rejected', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<MemoryNodeDetailDialog node={makeNode()} onDelete={onDelete} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('memory.detail.delete'));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('displays title', () => {
    render(<MemoryNodeDetailDialog node={makeNode()} onDelete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('memory.detail.title')).toBeInTheDocument();
  });
});
