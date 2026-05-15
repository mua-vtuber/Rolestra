import { useEffect, useState } from 'react';

import { subscribeStream } from '../ipc/stream-subscribe';
import type { StreamIdeaPickSnapshotPayload } from '../../shared/stream-events';

export type IdeaPickSnapshotState = StreamIdeaPickSnapshotPayload | null;

/**
 * Active channel 의 아이디어 선택 snapshot 을 구독한다. 대화창 결정 카드용
 * hook 이므로 다른 채널 이벤트는 즉시 버린다.
 */
export function useIdeaPickSnapshot(
  channelId: string | null,
): IdeaPickSnapshotState {
  const [snapshot, setSnapshot] = useState<IdeaPickSnapshotState>(null);

  useEffect(() => {
    if (channelId === null) {
      return () => {};
    }

    const unsubscribe = subscribeStream(
      'stream:idea-pick-snapshot',
      (payload) => {
        if (payload.channelId !== channelId) return;
        setSnapshot(payload);
      },
    );

    return () => {
      unsubscribe();
    };
  }, [channelId]);

  if (channelId === null) return null;
  return snapshot?.channelId === channelId ? snapshot : null;
}
