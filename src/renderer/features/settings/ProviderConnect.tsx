/**
 * ProviderConnect — the AI add dialog (spec 2026-10-01-messenger-redesign.md
 * R6, AddAI mockup), opened only from the settings AI tab.
 *
 *   - "이 컴퓨터에서 찾은 AI": detected chat CLIs ("추가" / "추가됨") and the
 *     local Ollama status at the address main resolves, with model choice;
 *     "다시 찾기" runs both checks again (`add-ai/FoundSection.tsx`).
 *   - "API 키로 연결": Claude / ChatGPT·Codex / Gemini / 기타 호환, the
 *     existing key + model flow (`add-ai/ApiSection.tsx`).
 *   - After adding: the default name it got, and the way on to the existing
 *     edit dialog for name and character sheet (`add-ai/AddedStep.tsx`).
 *
 * State and the key-cleanup rules: `add-ai/use-provider-connect.ts`.
 */
import * as Dialog from '@radix-ui/react-dialog';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { LineIcon } from '../../components/shell/LineIcon';
import { useProviders } from '../../hooks/use-providers';
import { useTheme } from '../../theme/use-theme';
import { AddedStep } from './add-ai/AddedStep';
import { ApiSection } from './add-ai/ApiSection';
import { FoundSection } from './add-ai/FoundSection';
import { useAiDetection } from './add-ai/use-ai-detection';
import { useProviderConnect } from './add-ai/use-provider-connect';

export interface ProviderConnectProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  /** Continue to the edit dialog of the AI just added (name, character sheet). */
  onEditProfile?: (providerId: string, displayName: string) => void;
}

export function ProviderConnect({ open, onOpenChange, onConnected, onEditProfile }: ProviderConnectProps): ReactElement {
  const { t } = useTranslation();
  const { token } = useTheme();
  const { providers, error: providersError } = useProviders();
  const detection = useAiDetection(open);
  const state = useProviderConnect({ providers, onOpenChange, onConnected, onLocalChanged: detection.rescan });
  const { added } = state;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) state.close(); else onOpenChange(true); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content data-testid="provider-connect-dialog" aria-describedby={undefined}
          className="fixed left-1/2 top-[6%] z-50 flex max-h-[88vh] w-add-ai-dialog -translate-x-1/2 flex-col border border-border bg-canvas text-fg shadow-panel [clip-path:var(--clip-control)]">
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
            <Dialog.Title className="font-display text-dialog-title font-bold">
              {token.titlePrefix}{t('providerConnect.title')}
            </Dialog.Title>
            <button type="button" data-testid="provider-connect-close" aria-label={t('providerConnect.close')}
              onClick={state.close} className="flex h-8 w-8 items-center justify-center text-fg-muted hover:text-fg">
              <LineIcon name="x" size={16} stroke={2} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            {added !== null ? (
              <AddedStep added={added} onDone={state.close}
                onEditProfile={onEditProfile === undefined ? null : () => {
                  state.close();
                  onEditProfile(added.providerId, added.displayName);
                }} />
            ) : (
              <>
                {providersError !== null ? (
                  <p data-testid="provider-connect-providers-error" role="alert" className="text-sm text-danger-text">
                    {t('providerConnect.providersFailed', { message: providersError.message })}
                  </p>
                ) : null}
                <FoundSection detection={detection} providers={providers} busy={state.pending || state.registered}
                  onAddCli={state.addCli} onAddLocal={state.addLocal} />
                <ApiSection state={state} ready={providers !== null} />
                <p className="text-meta text-fg-muted">{t('providerConnect.note')}</p>
              </>
            )}
            {state.error ? (
              <p data-testid="provider-connect-error" role="alert" className="text-sm text-danger-text">{state.error}</p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
