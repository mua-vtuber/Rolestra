import type Database from 'better-sqlite3';

/** One durable claim per explicit user message. Interrupted claims never replay. */
export class ChatWhisperRoundRepository {
  constructor(private readonly db: Database.Database) {}

  claim(channelId: string, userMessageId: string): boolean {
    const now = Date.now();
    const result = this.db.prepare(`INSERT OR IGNORE INTO chat_whisper_rounds
      (channel_id, user_message_id, status, created_at, updated_at)
      SELECT channel_id, id, 'running', ?, ? FROM messages
      WHERE id = ? AND channel_id = ? AND author_kind = 'user'
        AND role = 'user' AND visibility = 'public'`)
      .run(now, now, userMessageId, channelId);
    return result.changes === 1;
  }

  finish(channelId: string, userMessageId: string): void {
    this.setStatus(channelId, userMessageId, 'finished');
  }

  interrupt(channelId: string, userMessageId: string): void {
    this.setStatus(channelId, userMessageId, 'interrupted');
  }

  interruptChannel(channelId: string): void {
    this.db.prepare(`UPDATE chat_whisper_rounds SET status = 'interrupted', updated_at = ?
      WHERE channel_id = ? AND status = 'running'`).run(Date.now(), channelId);
  }

  interruptRunning(): void {
    this.db.prepare(`UPDATE chat_whisper_rounds SET status = 'interrupted', updated_at = ?
      WHERE status = 'running'`).run(Date.now());
  }

  status(channelId: string, userMessageId: string): 'running' | 'finished' | 'interrupted' | null {
    const row = this.db.prepare(`SELECT status FROM chat_whisper_rounds
      WHERE channel_id = ? AND user_message_id = ?`)
      .get(channelId, userMessageId) as { status: 'running' | 'finished' | 'interrupted' } | undefined;
    return row?.status ?? null;
  }

  private setStatus(channelId: string, userMessageId: string, status: 'finished' | 'interrupted'): void {
    this.db.prepare(`UPDATE chat_whisper_rounds SET status = ?, updated_at = ?
      WHERE channel_id = ? AND user_message_id = ? AND status = 'running'`)
      .run(status, Date.now(), channelId, userMessageId);
  }
}
