import type Database from 'better-sqlite3';
import type {
  ChatVote, ChatVoteError, ChatVoteParticipantStatus, ChatVoteStatus, ChatVoteValue,
} from '../../shared/chat-vote-types';

interface VoteRow {
  id: string; opinion_id: string; channel_id: string;
  status: ChatVoteStatus; created_at: number; completed_at: number | null;
}
interface ParticipantRow {
  provider_id: string; display_name: string; persona: string;
  status: ChatVoteParticipantStatus; opinion: string | null;
  vote: ChatVoteValue | null; error: ChatVoteError | null;
}
export interface VoteParticipantSnapshot {
  providerId: string; displayName: string; persona: string;
}

export class ChatVoteRepository {
  constructor(private readonly db: Database.Database) {}

  getByOpinion(opinionId: string): ChatVote | null {
    const row = this.db.prepare(`SELECT id,opinion_id,channel_id,status,created_at,completed_at
      FROM chat_votes WHERE opinion_id = ?`).get(opinionId) as VoteRow | undefined;
    if (!row) return null;
    return this.fromRow(row);
  }

  getByOpinionForId(voteId: string): ChatVote | null {
    const row = this.db.prepare(`SELECT id,opinion_id,channel_id,status,created_at,completed_at
      FROM chat_votes WHERE id = ?`).get(voteId) as VoteRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  private fromRow(row: VoteRow): ChatVote {
    const participants = (this.db.prepare(`SELECT provider_id,display_name,persona,status,opinion,vote,error
      FROM chat_vote_participants WHERE vote_id = ? ORDER BY sort_order`).all(row.id) as ParticipantRow[])
      .map((part) => ({ providerId: part.provider_id, displayName: part.display_name,
        status: part.status, opinion: part.opinion, vote: part.vote, error: part.error }));
    const counts = { agree: 0, oppose: 0, abstain: 0, pending: 0, failed: 0, total: participants.length };
    for (const part of participants) {
      if (part.status === 'pending') counts.pending++;
      else if (part.status === 'failed') counts.failed++;
      else if (part.vote) counts[part.vote]++;
    }
    return { id: row.id, opinionId: row.opinion_id, channelId: row.channel_id,
      status: row.status, createdAt: row.created_at, completedAt: row.completed_at,
      participants, counts };
  }

  insert(id: string, opinionId: string, channelId: string, participants: VoteParticipantSnapshot[]): void {
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO chat_votes(id,opinion_id,channel_id,status,created_at)
        VALUES (?, ?, ?, 'running', ?)`).run(id, opinionId, channelId, Date.now());
      const insert = this.db.prepare(`INSERT INTO chat_vote_participants
        (vote_id,provider_id,display_name,persona,sort_order,status)
        VALUES (?,?,?,?,?,'pending')`);
      participants.forEach((part, i) => insert.run(id, part.providerId, part.displayName, part.persona, i));
    })();
  }

  /** Conditional update is the late-response gate, including room archive/delete. */
  settleParticipant(voteId: string, providerId: string, result: {
    status: 'submitted' | 'failed'; opinion: string | null;
    vote: ChatVoteValue | null; error: ChatVoteError | null;
  }): boolean {
    const updated = this.db.prepare(`UPDATE chat_vote_participants
      SET status = ?, opinion = ?, vote = ?, error = ?
      WHERE vote_id = ? AND provider_id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM chat_votes v JOIN channels c ON c.id = v.channel_id
          LEFT JOIN chat_rooms r ON r.channel_id = v.channel_id
          WHERE v.id = ? AND v.status = 'running' AND c.read_only = 0
            AND (r.channel_id IS NULL OR r.archived_at IS NULL))`)
      .run(result.status, result.opinion, result.vote, result.error, voteId, providerId, voteId);
    return updated.changes > 0;
  }

  complete(voteId: string): void {
    this.db.prepare(`UPDATE chat_votes SET status='completed', completed_at=?
      WHERE id=? AND status='running' AND NOT EXISTS
        (SELECT 1 FROM chat_vote_participants WHERE vote_id=? AND status='pending')`)
      .run(Date.now(), voteId, voteId);
  }

  interruptChannel(channelId: string): void {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE chat_vote_participants SET status='failed',error='interrupted'
        WHERE status='pending' AND vote_id IN
          (SELECT id FROM chat_votes WHERE channel_id=? AND status='running')`).run(channelId);
      this.db.prepare(`UPDATE chat_votes SET status='interrupted',completed_at=?
        WHERE channel_id=? AND status='running'`).run(Date.now(), channelId);
    })();
  }

  interruptRunning(): void {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE chat_vote_participants SET status='failed',error='interrupted'
        WHERE status='pending' AND vote_id IN (SELECT id FROM chat_votes WHERE status='running')`).run();
      this.db.prepare(`UPDATE chat_votes SET status='interrupted',completed_at=? WHERE status='running'`)
        .run(Date.now());
    })();
  }
}
