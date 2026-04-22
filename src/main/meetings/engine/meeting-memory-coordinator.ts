/**
 * MeetingMemoryCoordinator — v3 replacement for the legacy
 * `engine/memory-coordinator.ts`. Coordinates MemoryFacade lookups +
 * extraction around a MeetingSession without reaching for any v2
 * singleton or ConversationSession.
 *
 * R6 scope:
 *   - Build a "[관련 기억]" system prompt block from the last user
 *     message's FTS/embedding neighbours.
 *   - Extract memories from a completed AI turn (last user message +
 *     AI content).
 *   - Run post-meeting maintenance (embed un-embedded + evolve + reflect).
 *
 * The R6 MeetingOrchestrator does NOT wire this coordinator into
 * MeetingTurnExecutor yet — that lives in R7 when ApprovalService owns
 * the execution pipeline. This file lands now so R7 can plug it in
 * without reintroducing the v2 legacy path.
 */

import type { MemoryFacade } from '../../memory/facade';
import type { MeetingSession } from './meeting-session';

const MEMORY_RETRIEVAL_LIMIT = 5;

export class MeetingMemoryCoordinator {
  constructor(
    private readonly session: MeetingSession,
    private readonly memoryFacade: MemoryFacade | null,
  ) {}

  /**
   * Look up memories relevant to the latest user message and format
   * them as a prompt-injectable "[관련 기억]" block. Returns `null` when
   * there is no user message, no memory facade, or nothing to inject.
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

      const lines: string[] = ['[관련 기억]'];
      for (const r of results) {
        let line = `- ${r.node.content}`;
        if (r.node.importance >= 0.8) line += ' [중요]';
        lines.push(line);
      }
      return lines.join('\n');
    } catch (err) {
      console.warn(
        `[meeting-memory:${this.session.meetingId}] retrieval error`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Store memories extracted from a completed AI turn. Includes the
   * last user message alongside the AI content so the user-side
   * context is captured.
   */
  extractMemories(aiContent: string, speakerId: string): number {
    if (!this.memoryFacade) return 0;
    try {
      const msgs: Array<{ content: string; participantId: string }> = [];
      const userContent = this.getLastUserMessageContent();
      if (userContent) msgs.push({ content: userContent, participantId: 'user' });
      msgs.push({ content: aiContent, participantId: speakerId });
      return this.memoryFacade.extractAndStore(msgs, this.session.meetingId);
    } catch (err) {
      console.warn(
        `[meeting-memory:${this.session.meetingId}] extraction error`,
        err instanceof Error ? err.message : String(err),
      );
      return 0;
    }
  }

  /**
   * Run post-meeting maintenance: embed un-embedded nodes, evolve
   * (merge + prune), trigger reflection when the threshold is met.
   */
  async runPostMeetingMaintenance(): Promise<void> {
    if (!this.memoryFacade) return;
    try {
      await this.memoryFacade.embedUnembeddedNodes();
      this.memoryFacade.evolve();
      if (this.memoryFacade.shouldReflect()) {
        await this.memoryFacade.reflect();
        await this.memoryFacade.embedUnembeddedNodes();
      }
    } catch (err) {
      console.warn(
        `[meeting-memory:${this.session.meetingId}] maintenance error`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private getLastUserMessageContent(): string | null {
    const msgs = this.session.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'user') {
        return typeof m.content === 'string' ? m.content : null;
      }
    }
    return null;
  }
}
