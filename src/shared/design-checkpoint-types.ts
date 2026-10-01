export type DesignCheckpointKind = 'wireframe';

export type DesignCheckpointStatus =
  | 'pending'
  | 'continued'
  | 'revision_requested'
  | 'auto_skipped';

export type DesignCheckpointDecision =
  | 'continue'
  | 'request_revision'
  | 'auto_skip';

export interface DesignCheckpoint {
  id: string;
  projectId: string;
  meetingId: string;
  channelId: string;
  kind: DesignCheckpointKind;
  status: DesignCheckpointStatus;
  title: string;
  documentPath: string;
  documentBodySnapshot: string;
  userNote: string | null;
  payloadJson: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface DesignCheckpointGetRequest {
  checkpointId: string;
}

export interface DesignCheckpointDecideRequest {
  checkpointId: string;
  decision: DesignCheckpointDecision;
  note?: string;
}

export interface DesignCheckpointDecideResponse {
  checkpoint: DesignCheckpoint;
}
