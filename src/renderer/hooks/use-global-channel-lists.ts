import { useMemo } from 'react';

import { useDms } from './use-dms';
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
  const { dms, loading: dmsLoading, error: dmsError } = useDms();
  const {
    channel: generalChannel,
    loading: generalLoading,
    error: generalError,
  } = useGlobalGeneralChannel();

  return useMemo(() => {
    const available: Channel[] = [...(dms ?? []), ...(rooms ?? [])];
    if (generalChannel !== null) available.push(generalChannel);
    const authoritative =
      dms !== null &&
      !dmsLoading &&
      dmsError === null &&
      !generalLoading &&
      generalError === null
      && rooms !== null && !roomsLoading && roomsError === null
        ? available
        : null;
    return { available, authoritative, generalChannel };
  }, [dms, dmsLoading, dmsError, generalChannel, generalLoading, generalError, rooms, roomsLoading, roomsError]);
}
