/**
 * Builds a full `Channel` for renderer tests from the fields a chat test
 * cares about. The rest of the shape (department role, purpose, handoff
 * mode, round cap, permission axes) is left over from the work-automation
 * app and has no effect on chat screens, so it is filled with the values a
 * projectless chat channel carries in the database: no role, no purpose,
 * the default handoff mode, no round cap, read-only file access.
 */
import type { Channel } from '../shared/channel-types';
import { DEFAULT_HANDOFF_MODE } from '../shared/channel-role-types';

export type ChatChannelFields =
  Pick<Channel, 'id' | 'projectId' | 'name' | 'kind' | 'readOnly' | 'createdAt'> & Partial<Channel>;

export function chatChannelForTest(fields: ChatChannelFields): Channel {
  return {
    role: null,
    purpose: null,
    handoffMode: DEFAULT_HANDOFF_MODE,
    maxRounds: null,
    permissions: { fileRead: true, fileWrite: false, commandExec: false, webSearch: false, dbRead: false },
    ...fields,
  };
}
