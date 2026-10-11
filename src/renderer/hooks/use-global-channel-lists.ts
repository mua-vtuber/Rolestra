import { useMemo } from 'react';

import { useGlobalGeneralChannel } from './use-global-general-channel';
import { useChatRooms } from './use-chat-rooms';
import type { Channel } from '../../shared/channel-types';

export interface GlobalChannelLists {
  available: Channel[];
  authoritative: Channel[] | null;
  generalChannel: Channel | null;
  /**
   * Why the lists could not be read: the general channel's error first, else
   * the room list's. While it is set `authoritative` stays null, so callers
   * must show it instead of waiting silently (spec 2026-10-08 F1, QA).
   */
  loadError: Error | null;
}

/** Render loaded global channels immediately; validate only after both sources settle. */
export function useGlobalChannelLists(): GlobalChannelLists {
  const { rooms, loading: roomsLoading, error: roomsError } = useChatRooms();
  const {
    channel: generalChannel,
    loading: generalLoading,
    error: generalError,
  } = useGlobalGeneralChannel();

  return useMemo(() => {
    const available: Channel[] = [...(rooms ?? [])];
    if (generalChannel !== null) available.push(generalChannel);
    const authoritative =
      !generalLoading &&
      generalError === null
      && rooms !== null && !roomsLoading && roomsError === null
        ? available
        : null;
    return { available, authoritative, generalChannel, loadError: generalError ?? roomsError };
  }, [generalChannel, generalLoading, generalError, rooms, roomsLoading, roomsError]);
}
