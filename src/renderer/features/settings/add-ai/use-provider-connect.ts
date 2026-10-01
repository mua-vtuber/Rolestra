/**
 * State and actions of the AI add dialog (spec 2026-10-01-messenger-redesign.md
 * R6): adding a detected CLI, a local Ollama model or an API service, then
 * the "added" step.
 *
 * The API flow and its secret rules are carried over unchanged from the
 * previous dialog (F1, A1):
 *   - the key is written to safeStorage once per attempt (`config:set-secret`
 *     at "모델 불러오기") and that ref is reused by `provider:add`;
 *   - editing the key, switching service or closing the dialog deletes the
 *     attempt's stored key — except while `provider:add` is in flight, when
 *     the registration itself owns the cleanup (it deletes the key on
 *     failure and keeps it on success, even if the dialog is gone);
 *   - `storedSecretRefLive` mirrors the ref so a callback built in an older
 *     render never deletes a key a later registration already handed over.
 *
 * Failures say why (QA High-1/High-2, `add-ai-errors.ts`). A key that could
 * not be deleted is reported — in the dialog while it is open, as an app
 * notice when it is closing or gone — and main deletes unused keys at the
 * next start (`providers/orphan-api-keys.ts`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { notifyError } from '../../../components/ErrorBoundary';
import { notifyChannelsChanged } from '../../../hooks/channel-invalidation-bus';
import { invoke } from '../../../ipc/invoke';
import { newApiKeyRef } from '../api-key-ref';
import { cliDisplayName } from '../tabs/ai/ai-connection';
import type { DetectedCli } from '../../../../shared/ipc-types';
import type { ModelListFailureReason, ProviderInfo } from '../../../../shared/provider-types';
import { API_SERVICE_ENDPOINTS, type ApiServiceChoice } from '../../../../shared/api-service-catalog';
import {
  addFailureText, keyCleanupFailureText, keyStoreFailureText, modelListFailureText, type AddAttempt,
} from './add-ai-errors';
import { cliConfig, uniqueDisplayName, validateEndpoint } from './add-ai-model';

export interface AddedAi {
  providerId: string;
  displayName: string;
}

export interface UseProviderConnectInput {
  /** Registered AIs (`provider:list`); null until it answers — adding waits for it. */
  providers: readonly ProviderInfo[] | null;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
  /** Ollama looked different from what the dialog showed — check again. */
  onLocalChanged: () => void;
}

export function useProviderConnect({ providers, onOpenChange, onConnected, onLocalChanged }: UseProviderConnectInput) {
  const { t } = useTranslation();
  const [service, setService] = useState<ApiServiceChoice | null>(null);
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [added, setAdded] = useState<AddedAi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registeringRef = useRef(false);
  const registeredRef = useRef(false);
  const [storedSecretRef, setStoredSecretRef] = useState<string | null>(null);
  const storedSecretRefLive = useRef<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[] | null>(null);
  const [modelListErrorReason, setModelListErrorReason] = useState<ModelListFailureReason | null>(null);
  // Only "other" lets the user type a model name when listing fails (F1-8).
  const [manualModel, setManualModel] = useState(false);
  const modelRequestRef = useRef(0);
  const closingRef = useRef(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; modelRequestRef.current += 1; };
  }, []);

  /** In the dialog while it is open; as an app notice once it is closing or gone. */
  const report = useCallback((text: string, closing: boolean): void => {
    if (closing || !mountedRef.current) notifyError(text);
    else setError(text);
  }, []);

  const setStoredSecretRefState = useCallback((ref: string | null): void => {
    storedSecretRefLive.current = ref;
    setStoredSecretRef(ref);
  }, []);

  /** Delete the CURRENT attempt's stored key (read from the live mirror); a failure is reported. */
  const discardStoredSecret = useCallback(async (closing: boolean): Promise<void> => {
    const ref = storedSecretRefLive.current;
    if (ref === null) return;
    setStoredSecretRefState(null);
    try {
      await invoke('config:delete-secret', { key: ref });
    } catch (reason) {
      report(keyCleanupFailureText(t, reason), closing);
    }
  }, [report, setStoredSecretRefState, t]);

  const resetModelState = useCallback((): void => {
    modelRequestRef.current += 1;
    setLoadingModels(false);
    setModelOptions(null);
    setModelListErrorReason(null);
    setManualModel(false);
    setModel('');
  }, []);

  const close = useCallback((): void => {
    closingRef.current = true;
    registeredRef.current = false;
    setRegistered(false);
    // While provider:add is in flight the registration owns the key cleanup.
    if (!registeringRef.current) void discardStoredSecret(true);
    setSecret('');
    setName('');
    setEndpoint('');
    setError(null);
    setAdded(null);
    resetModelState();
    onOpenChange(false);
  }, [discardStoredSecret, onOpenChange, resetModelState]);

  const defaultName = useCallback((base: string): string => {
    if (providers === null) throw new Error('provider:list has not answered; default names need it');
    return uniqueDisplayName(t, base, providers);
  }, [providers, t]);

  // F1-3: an official service locks its endpoint and pre-fills a free name.
  const selectService = useCallback((next: ApiServiceChoice): void => {
    closingRef.current = false;
    void discardStoredSecret(false);
    resetModelState();
    setSecret('');
    setError(null);
    setService(next);
    setEndpoint(next === 'other' ? '' : API_SERVICE_ENDPOINTS[next]);
    setName(next === 'other' ? '' : defaultName(t(`providerConnect.service.${next}.defaultName`)));
  }, [defaultName, discardStoredSecret, resetModelState, t]);

  // A key edit invalidates the stored key and any loaded models (F1-4/F1-5).
  const handleSecretChange = useCallback((value: string): void => {
    setSecret(value);
    if (storedSecretRef !== null) void discardStoredSecret(false);
    resetModelState();
  }, [discardStoredSecret, resetModelState, storedSecretRef]);

  const handleEndpointChange = useCallback((value: string): void => {
    setEndpoint(value);
    resetModelState();
  }, [resetModelState]);

  const loadModels = useCallback(async (): Promise<void> => {
    const trimmedSecret = secret.trim();
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedSecret || !trimmedEndpoint) return;
    // "Load models" already fetches from the endpoint, so check it first.
    if (!validateEndpoint(trimmedEndpoint)) {
      setError(t('providerConnect.invalidEndpoint'));
      return;
    }
    resetModelState();
    const request = modelRequestRef.current;
    const isCurrentRequest = (): boolean => mountedRef.current && modelRequestRef.current === request;
    setLoadingModels(true);
    setError(null);
    let ref = storedSecretRef;
    if (ref === null) {
      ref = newApiKeyRef();
      try {
        await invoke('config:set-secret', { key: ref, value: trimmedSecret });
      } catch (reason) {
        if (isCurrentRequest()) {
          setError(keyStoreFailureText(t, reason));
          setLoadingModels(false);
        }
        return;
      }
      if (!isCurrentRequest()) {
        // This fresh key never became dialog state or a registered provider's key.
        try {
          await invoke('config:delete-secret', { key: ref });
        } catch (reason) {
          report(keyCleanupFailureText(t, reason), closingRef.current);
        }
        return;
      }
      setStoredSecretRefState(ref);
    }
    try {
      const result = await invoke('provider:list-models', { type: 'api', key: trimmedEndpoint, apiKeyRef: ref });
      if (!isCurrentRequest()) return;
      if (result.ok) {
        setModelOptions(result.models);
        setManualModel(false);
        setModel(result.models[0] ?? '');
      } else {
        setModelListErrorReason(result.reason);
        setModelOptions(null);
        if (service === 'other') setManualModel(true);
      }
    } catch (reason) {
      // Not one of the three list-model reasons (auth / network / parse).
      if (isCurrentRequest()) setError(modelListFailureText(t, reason));
    } finally {
      if (isCurrentRequest()) setLoadingModels(false);
    }
  }, [endpoint, secret, service, storedSecretRef, report, resetModelState, setStoredSecretRefState, t]);

  const register = useCallback(async (
    run: () => Promise<{ provider: ProviderInfo }>,
    secretRef: string | null,
    attempt: AddAttempt,
  ): Promise<void> => {
    if (registeringRef.current || registeredRef.current) return;
    registeringRef.current = true;
    setPending(true);
    setError(null);
    let provider: ProviderInfo;
    try {
      ({ provider } = await run());
    } catch (reason) {
      const cause = addFailureText(t, reason, attempt);
      let cleanupProblem: string | null = null;
      if (secretRef !== null) {
        try {
          await invoke('config:delete-secret', { key: secretRef });
          setStoredSecretRefState(null);
        } catch (cleanupReason) {
          cleanupProblem = keyCleanupFailureText(t, cleanupReason);
        }
      }
      report(cleanupProblem === null ? cause : `${cause} ${cleanupProblem}`, false);
      // A failed local add means Ollama changed since the dialog looked.
      if (attempt.model !== null) onLocalChanged();
      setPending(false);
      registeringRef.current = false;
      return;
    }

    registeredRef.current = true;
    setRegistered(true);
    // The key now belongs to the AI: clear the ref so no later close() deletes it.
    setStoredSecretRefState(null);
    setSecret('');
    try {
      await notifyChannelsChanged();
      onConnected();
      setAdded({ providerId: provider.id, displayName: provider.displayName });
    } catch {
      setError(t('providerConnect.connectedRefreshFailed'));
    } finally {
      setPending(false);
      registeringRef.current = false;
    }
  }, [onConnected, onLocalChanged, report, setStoredSecretRefState, t]);

  const addCli = useCallback((cli: DetectedCli): void => {
    const product = cliDisplayName(t, cli.command);
    const base = cli.wslDistro === undefined ? product
      : t('providerConnect.cli.wslName', { name: product, distro: cli.wslDistro });
    const displayName = defaultName(base);
    void register(() => invoke('provider:add', { displayName, config: cliConfig(cli) }), null,
      { displayName, model: null });
  }, [defaultName, register, t]);

  const addLocal = useCallback((localModel: string): void => {
    const displayName = defaultName(localModel);
    void register(() => invoke('provider:add-local', { displayName, model: localModel }), null,
      { displayName, model: localModel });
  }, [defaultName, register]);

  const submitApi = useCallback((): void => {
    const displayName = name.trim();
    const chosenModel = model.trim();
    const url = endpoint.trim();
    if (service === null || !displayName || !chosenModel || !url) return;
    if (!validateEndpoint(url)) {
      setError(t('providerConnect.invalidEndpoint'));
      return;
    }
    const ref = storedSecretRef;
    if (!secret.trim() || ref === null) return;
    void register(() => invoke('provider:add', {
      displayName, config: { type: 'api', endpoint: url, model: chosenModel, apiKeyRef: ref },
    }), ref, { displayName, model: null });
  }, [endpoint, model, name, register, secret, service, storedSecretRef, t]);

  const canSubmitApi = Boolean(name.trim() && endpoint.trim() && model.trim() && secret.trim() && storedSecretRef !== null);

  return {
    service, name, setName, endpoint, model, setModel, secret,
    pending, registered, added, error,
    loadingModels, modelOptions, modelListErrorReason, manualModel, canSubmitApi,
    close, selectService, handleSecretChange, handleEndpointChange, loadModels,
    addCli, addLocal, submitApi,
  };
}

export type ProviderConnectState = ReturnType<typeof useProviderConnect>;
