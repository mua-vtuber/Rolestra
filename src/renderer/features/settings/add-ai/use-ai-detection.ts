/**
 * What the AI add dialog found on this computer (spec
 * 2026-10-01-messenger-redesign.md R6-1..R6-3): installed chat CLIs
 * (`provider:detect-cli`) and the local Ollama status
 * (`provider:detect-local`, address resolved by main). Both run when the
 * dialog opens and again on "다시 찾기". A rejected call is kept as an
 * error with its message — never shown as "nothing found".
 */
import { useCallback, useEffect, useState } from 'react';

import { invoke } from '../../../ipc/invoke';
import type { DetectedCli } from '../../../../shared/ipc-types';
import type { LocalAiDetection } from '../../../../shared/local-ai-types';
import { supportedClis } from './add-ai-model';

export type DetectionState<T> =
  | { phase: 'loading' }
  | { phase: 'failed'; message: string }
  | { phase: 'done'; value: T };

export interface AiDetection {
  cli: DetectionState<DetectedCli[]>;
  local: DetectionState<LocalAiDetection>;
  rescanning: boolean;
  rescan: () => void;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useAiDetection(open: boolean): AiDetection {
  const [cli, setCli] = useState<DetectionState<DetectedCli[]>>({ phase: 'loading' });
  const [local, setLocal] = useState<DetectionState<LocalAiDetection>>({ phase: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke('provider:detect-cli', undefined).then(
      ({ detected }) => { if (!cancelled) setCli({ phase: 'done', value: supportedClis(detected) }); },
      (reason: unknown) => { if (!cancelled) setCli({ phase: 'failed', message: messageOf(reason) }); },
    );
    void invoke('provider:detect-local', undefined).then(
      ({ detection }) => { if (!cancelled) setLocal({ phase: 'done', value: detection }); },
      (reason: unknown) => { if (!cancelled) setLocal({ phase: 'failed', message: messageOf(reason) }); },
    );
    return () => { cancelled = true; };
  }, [open, round]);

  const rescan = useCallback((): void => {
    setCli({ phase: 'loading' });
    setLocal({ phase: 'loading' });
    setRound((value) => value + 1);
  }, []);

  return { cli, local, rescanning: cli.phase === 'loading' || local.phase === 'loading', rescan };
}
