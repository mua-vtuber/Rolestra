export type ChatVoteStatus = 'running' | 'completed' | 'interrupted';
export type ChatVoteParticipantStatus = 'pending' | 'submitted' | 'failed';
export type ChatVoteError = 'provider_unavailable' | 'invalid_response' | 'provider_error' | 'timeout' | 'interrupted';
export type ChatVoteValue = 'agree' | 'oppose' | 'abstain';

export interface ChatVoteParticipant {
  providerId: string;
  displayName: string;
  status: ChatVoteParticipantStatus;
  opinion: string | null;
  vote: ChatVoteValue | null;
  error: ChatVoteError | null;
}

export interface ChatVote {
  id: string;
  opinionId: string;
  channelId: string;
  status: ChatVoteStatus;
  createdAt: number;
  completedAt: number | null;
  participants: ChatVoteParticipant[];
  counts: {
    agree: number;
    oppose: number;
    abstain: number;
    pending: number;
    failed: number;
    total: number;
  };
}
