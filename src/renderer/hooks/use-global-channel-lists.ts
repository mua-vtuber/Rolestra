import { useMemo } from 'react';

import { useGlobalGeneralChannel } from './use-global-general-channel';
import { useChatRooms } from './use-chat-rooms';
import type { Channel } from '../../shared/channel-types';

export interface GlobalChannelLists {
  available: Channel[];
  authoritative: Channel[] | null;
  generalChannel: Channel | null;
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
    return { available, authoritative, generalChannel };
  }, [generalChannel, generalLoading, generalError, rooms, roomsLoading, roomsError]);
}
