import { useCallback, useEffect, useState } from 'react';
import type { ChatRoom } from '../../shared/chat-room-types';
import { invoke } from '../ipc/invoke';
import { subscribeChannelsInvalidation } from './channel-invalidation-bus';

export function useChatRooms(): { rooms: ChatRoom[] | null; loading: boolean; error: Error | null } {
  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const load = useCallback(async () => invoke('room:list', undefined), []);
  useEffect(() => {
    let alive = true;
    let request = 0;
    const refresh = async (): Promise<void> => {
      const version = ++request;
      setLoading(true);
      try {
        const result = await load();
        if (alive && version === request) { setRooms(result.rooms); setError(null); }
      } catch (reason) {
        if (alive && version === request) setError(reason instanceof Error ? reason : new Error(String(reason)));
      } finally {
        if (alive && version === request) setLoading(false);
      }
    };
    void refresh();
    const unsubscribe = subscribeChannelsInvalidation(refresh);
    return () => { alive = false; unsubscribe(); };
  }, [load]);
  return { rooms, loading, error };
}
