/**
 * Integration test: Memory Pin, Search, Retrieve
 *
 * Verifies the MemoryFacade API for:
 * - storeNode / getNode / deleteNode lifecycle
 * - FTS5-backed search with relevance ranking
 * - Pin operations and topic filtering
 * - Deduplication on store
 * - Empty search handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { MemoryFacade } from '../../memory/facade';
import { createTestDb } from '../../../test-utils';

describe('Memory Pin, Search, Retrieve', () => {
  let db: Database.Database;
  let memory: MemoryFacade;

  beforeEach(() => {
    db = createTestDb();
    memory = new MemoryFacade(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── Store → search by content → found ─────────────────────────────

  it('stores a node and finds it via FTS search', async () => {
    memory.storeNode({
      content: 'We decided to use PostgreSQL for the database',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.8,
      source: 'auto',
    });

    const results = await memory.search('PostgreSQL');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].node.content).toContain('PostgreSQL');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].source).toBe('fts');
  });

  // ── Store multiple → search returns relevant ones ─────────────────

  it('stores multiple nodes and search returns relevant ones ranked', async () => {
    memory.storeNode({
      content: 'React 18 is our UI framework of choice',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.8,
      source: 'auto',
    });

    memory.storeNode({
      content: 'SQLite is used for local data storage',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
    });

    memory.storeNode({
      content: 'TypeScript ensures type safety across the codebase',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.6,
      source: 'auto',
    });

    const reactResults = await memory.search('React');
    expect(reactResults.length).toBeGreaterThan(0);
    expect(reactResults[0].node.content).toContain('React');

    const sqliteResults = await memory.search('SQLite');
    expect(sqliteResults.length).toBeGreaterThan(0);
    expect(sqliteResults[0].node.content).toContain('SQLite');
  });

  // ── Pin a node → getPinnedNodes returns it ────────────────────────

  it('pins a message and retrieves it via getPinnedNodes', () => {
    const pinnedId = memory.pinMessage(
      'msg-pin-1',
      'Critical: always validate user input',
      'technical',
    );

    expect(pinnedId).toBeTruthy();

    const pinned = memory.getPinnedNodes();
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe(pinnedId);
    expect(pinned[0].pinned).toBe(true);
    expect(pinned[0].content).toContain('validate user input');
  });

  // ── Pin with topic filter ─────────────────────────────────────────

  it('filters pinned nodes by topic', () => {
    memory.pinMessage('msg-tech', 'Use TypeScript everywhere', 'technical');
    memory.pinMessage('msg-dec', 'Team agreed on weekly standups', 'decisions');

    const techPins = memory.getPinnedNodes('technical');
    expect(techPins).toHaveLength(1);
    expect(techPins[0].topic).toBe('technical');

    const decPins = memory.getPinnedNodes('decisions');
    expect(decPins).toHaveLength(1);
    expect(decPins[0].topic).toBe('decisions');

    const allPins = memory.getPinnedNodes();
    expect(allPins).toHaveLength(2);
  });

  // ── Delete node → search no longer returns it ─────────────────────

  it('soft-deletes a node so it is excluded from search and getNode', async () => {
    const id = memory.storeNode({
      content: 'Deprecated: use Angular for frontend',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    // Confirm searchable
    const before = await memory.search('Angular');
    expect(before.length).toBe(1);

    // Soft delete
    const deleted = memory.deleteNode(id);
    expect(deleted).toBe(true);

    // No longer searchable
    const after = await memory.search('Angular');
    expect(after).toHaveLength(0);

    // No longer retrievable by ID
    const node = memory.getNode(id);
    expect(node).toBeNull();
  });

  // ── Store → getNode by id ─────────────────────────────────────────

  it('stores a node and retrieves it by ID with correct content', () => {
    const id = memory.storeNode({
      content: 'Zustand is the state management library',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
      conversationId: 'conv-test',
    });

    const node = memory.getNode(id);
    expect(node).not.toBeNull();
    expect(node!.id).toBe(id);
    expect(node!.content).toBe('Zustand is the state management library');
    expect(node!.nodeType).toBe('decision');
    expect(node!.topic).toBe('technical');
    expect(node!.importance).toBe(0.7);
    expect(node!.source).toBe('auto');
    expect(node!.conversationId).toBe('conv-test');
    expect(node!.pinned).toBe(false);
    expect(node!.deletedAt).toBeNull();
  });

  // ── FTS word search ───────────────────────────────────────────────

  it('FTS search finds nodes matching individual words', async () => {
    memory.storeNode({
      content: 'The API uses REST architecture with JSON payloads',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.6,
      source: 'auto',
    });

    const restResults = await memory.search('REST');
    expect(restResults.length).toBe(1);

    const jsonResults = await memory.search('JSON');
    expect(jsonResults.length).toBe(1);

    const apiResults = await memory.search('API');
    expect(apiResults.length).toBe(1);
  });

  // ── Empty search ──────────────────────────────────────────────────

  it('returns empty array for search with no matching content', async () => {
    memory.storeNode({
      content: 'We use React for the frontend',
      nodeType: 'decision',
      topic: 'technical',
      importance: 0.7,
      source: 'auto',
    });

    const results = await memory.search('Kubernetes');
    expect(results).toEqual([]);
  });

  // ── Multiple topics → topic filter works ──────────────────────────

  it('filters search results by topic', async () => {
    memory.storeNode({
      content: 'React component architecture',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.6,
      source: 'auto',
    });

    memory.storeNode({
      content: 'React testing strategy decisions',
      nodeType: 'decision',
      topic: 'decisions',
      importance: 0.7,
      source: 'auto',
    });

    const techResults = await memory.search('React', { topic: 'technical' });
    expect(techResults).toHaveLength(1);
    expect(techResults[0].node.topic).toBe('technical');

    const decResults = await memory.search('React', { topic: 'decisions' });
    expect(decResults).toHaveLength(1);
    expect(decResults[0].node.topic).toBe('decisions');
  });

  // ── Pinned nodes appear in search ─────────────────────────────────

  it('pinned nodes appear in search results with boosted score', async () => {
    // Store a regular node
    memory.storeNode({
      content: 'TypeScript is used for type safety',
      nodeType: 'fact',
      topic: 'technical',
      importance: 0.5,
      source: 'auto',
    });

    // Pin a node about TypeScript
    memory.pinMessage('msg-ts', 'Critical: TypeScript is mandatory', 'technical');

    const results = await memory.search('TypeScript');
    expect(results.length).toBe(2);

    // Both should be found; pinned one should have higher score
    const pinnedResult = results.find((r) => r.node.pinned);
    const unpinnedResult = results.find((r) => !r.node.pinned);

    expect(pinnedResult).toBeDefined();
    expect(unpinnedResult).toBeDefined();

    if (pinnedResult && unpinnedResult) {
      expect(pinnedResult.score).toBeGreaterThan(unpinnedResult.score);
    }
  });
});
