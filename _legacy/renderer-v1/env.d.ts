/// <reference types="vite/client" />

import type { IpcChannelMap, IpcChannel, IpcMeta } from '../shared/ipc-types';
import type { StreamEventMap, StreamEventName } from '../shared/stream-types';

interface ArenaAPI {
  platform: string;

  /**
   * Type-safe IPC invoke exposed via contextBridge.
   * All renderer → main communication MUST use this method.
   * Direct ipcRenderer usage is forbidden.
   */
  invoke<C extends IpcChannel>(
    channel: C,
    data: IpcChannelMap[C]['request'],
    meta?: Partial<IpcMeta>,
  ): Promise<IpcChannelMap[C]['response']>;

  /**
   * Type-safe event listener for push events from Main process.
   * Returns an unsubscribe function.
   */
  on<E extends StreamEventName>(
    event: E,
    callback: (data: StreamEventMap[E]) => void,
  ): () => void;
}

declare global {
  interface Window {
    arena: ArenaAPI;
  }
}

export {};
