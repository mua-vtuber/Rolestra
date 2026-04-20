/**
 * useRoundSettings -- manages round count configuration and turn-waiting state.
 */

import { useState, useEffect, useCallback } from 'react';
import type { RoundSetting } from '../../shared/engine-types';
import { showError } from './useErrorDialog';

export interface UseRoundSettingsReturn {
  rounds: RoundSetting;
  handleSetRounds: (value: RoundSetting) => void;
  turnWaiting: boolean;
  setTurnWaiting: (v: boolean) => void;
  handleContinue: () => void;
}

export function useRoundSettings(): UseRoundSettingsReturn {
  const [rounds, setRounds] = useState<RoundSetting>(1);
  const [turnWaiting, setTurnWaiting] = useState(false);

  useEffect(() => {
    void window.arena.invoke('chat:set-rounds', { rounds });
  }, [rounds]);

  const handleSetRounds = useCallback((value: RoundSetting): void => {
    setRounds(value);
    void window.arena.invoke('chat:set-rounds', { rounds: value });
  }, []);

  const handleContinue = useCallback((): void => {
    void window.arena.invoke('chat:continue', undefined)
      .catch((err) => showError('chat:continue', err));
  }, []);

  return {
    rounds,
    handleSetRounds,
    turnWaiting,
    setTurnWaiting,
    handleContinue,
  };
}
