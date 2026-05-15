import type { HandoffPackage } from '../schema/handoff-package';

export interface SourceHandoffContext {
  dispatchRowId: string;
  handoffPackage: HandoffPackage;
  minutesMeetingId: string | null;
  minutesPath: string | null;
  minutesBody: string | null;
}
