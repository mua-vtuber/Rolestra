/**
 * MemoryCoordinator — manages memory retrieval, extraction, and maintenance.
 *
 * Extracted from ConversationOrchestrator to isolate all memory-related
 * operations (context building, extraction, post-conversation maintenance)
 * into a focused module.
 */

import type { ConversationSession } from './conversation';
import type { MemoryFacade } from '../memory/facade';

/** Maximum number of memory results to inject into the prompt. */
const MEMORY_RETRIEVAL_LIMIT = 5;

/**
 * Coordinates memory operations for the conversation orchestrator.
 */
export class MemoryCoordinator {
  private session: ConversationSession;
  private memoryFacade: MemoryFacade | null;

  constructor(session: ConversationSession, memoryFacade: MemoryFacade | null) {
    this.session = session;
    this.memoryFacade = memoryFacade;
  }

  /**
   * Search for memories relevant to the latest user message and
   * format them as a prompt-injectable "[관련 기억]" block.
   */
  async buildMemoryContext(): Promise<string | null> {
    if (!this.memoryFacade) return null;

    const query = this.getLastUserMessageContent();
    if (!query) return null;

    try {
      const results = await this.memoryFacade.search(query, {
        limit: MEMORY_RETRIEVAL_LIMIT,
      });
      if (results.length === 0) return null;

      const lines = ['[관련 기억]'];
      for (const r of results) {
        let line = `- ${r.node.content}`;
        if (r.node.importance >= 0.8) line += ' [중요]';
        lines.push(line);
      }
      return lines.join('\n');
    } catch (err) {
      console.error(`[orchestrator:${this.session.id}] memory retrieval error:`, err);
      return null;
    }
  }

  /**
   * Extract knowledge from the AI response (and the preceding user
   * message) and store it as memory nodes.
   */
  extractMemories(aiContent: string, speakerId: string): void {
    if (!this.memoryFacade) return;

    try {
      const msgsToExtract: Array<{ content: string; participantId: string }> = [];

      // Include the last user message so user-side decisions are captured
      const userContent = this.getLastUserMessageContent();
      if (userContent) {
        msgsToExtract.push({ content: userContent, participantId: 'user' });
      }

      msgsToExtract.push({ content: aiContent, participantId: speakerId });

      const created = this.memoryFacade.extractAndStore(
        msgsToExtract,
        this.session.id,
      );
      if (created > 0) {
        console.info(
          `[orchestrator:${this.session.id}] memory: extracted ${created} node(s)`,
        );
      }
    } catch (err) {
      console.error(`[orchestrator:${this.session.id}] memory extraction error:`, err);
    }
  }

  /**
   * Find the content of the most recent user message in the session.
   */
  getLastUserMessageContent(): string | null {
    const msgs = this.session.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        const content = msgs[i].content;
        return typeof content === 'string' ? content : null;
      }
    }
    return null;
  }

  /**
   * Run background maintenance after a conversation round completes.
   *
   * 1. Embed any un-embedded nodes (from extraction or reflection).
   * 2. Run evolution (merge similar + prune stale).
   * 3. Trigger reflection if enough nodes have accumulated.
   */
  async runPostConversationMaintenance(): Promise<void> {
    if (!this.memoryFacade) return;

    try {
      // 1. Embed any nodes that were stored without embeddings
      const embedded = await this.memoryFacade.embedUnembeddedNodes();
      if (embedded > 0) {
        console.info(`[orchestrator:${this.session.id}] memory: embedded ${embedded} node(s)`);
      }

      // 2. Run evolution (merge similar, prune stale)
      const evolution = this.memoryFacade.evolve();
      if (evolution.merged > 0 || evolution.pruned > 0) {
        console.info(
          `[orchestrator:${this.session.id}] memory: evolved (merged=${evolution.merged}, pruned=${evolution.pruned})`,
        );
      }

      // 3. Trigger reflection if threshold is met
      if (this.memoryFacade.shouldReflect()) {
        const reflection = await this.memoryFacade.reflect();
        if (reflection.insightsCreated > 0) {
          console.info(
            `[orchestrator:${this.session.id}] memory: reflected (insights=${reflection.insightsCreated}, processed=${reflection.nodesProcessed})`,
          );
          // Embed the newly created insight nodes
          await this.memoryFacade.embedUnembeddedNodes();
        }
      }
    } catch (err) {
      console.error(`[orchestrator:${this.session.id}] memory maintenance error:`, err);
    }
  }
}
