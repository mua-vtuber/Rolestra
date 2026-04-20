/**
 * ProjectCreateModal — spec §7.3 "새 프로젝트" dialog.
 *
 * Responsibilities:
 * - Render the 3-kind RadioGroup + the 3-permission RadioGroup together
 *   with name/description inputs, kind-specific path pickers, and an
 *   initial-members multi-checkbox.
 * - Enforce spec §7.3 CA-1 client-side: `kind='external' +
 *   permissionMode='auto'` is impossible — we disable 'auto' in the
 *   permission radio AND eagerly swap the selection to 'hybrid' whenever
 *   the user flips kind to 'external' while 'auto' was selected. The
 *   Main-side `ProjectService.create` + the zod schema still reject the
 *   combination if a malicious caller bypasses the UI; the client-side
 *   guard here is purely UX.
 * - Dispatch the correct hook method based on `kind`:
 *     new      → useProjects.createNew({ kind: 'new', ... })
 *     external → useProjects.linkExternal({ name, externalPath, ... })
 *     imported → useProjects.importFolder({ name, sourcePath, ... })
 * - Surface any error INLINE inside the modal. No toast. Spec demands
 *   visible error feedback without the user having to hunt for it.
 *
 * Error mapping:
 *   Error#name === 'ExternalAutoForbiddenError'     → externalAutoForbidden
 *   Error#name === 'DuplicateSlugError'             → duplicateSlug
 *   Error#name === 'JunctionTOCTOUMismatchError'    → junctionTOCTOU
 *   Error#message.includes('folder_missing|ENOENT') → folderMissing
 *   Everything else                                  → generic
 *
 * The modal does NOT auto-activate the newly-created project. The
 * caller's `onCreated` hook can decide (Task 10 wires this in App.tsx).
 */
import * as Dialog from '@radix-ui/react-dialog';
import { clsx } from 'clsx';
import {
  useCallback,
  useEffect,
  useReducer,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useProjects } from '../../hooks/use-projects';
import type {
  PermissionMode,
  Project,
  ProjectKind,
} from '../../../shared/project-types';

import { ExternalPathPicker } from './ExternalPathPicker';
import { InitialMembersSelector } from './InitialMembersSelector';
import { ProjectKindTabs } from './ProjectKindTabs';
import { ProjectPermissionRadio } from './ProjectPermissionRadio';

export interface ProjectCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional success callback. Invoked BEFORE the modal closes. */
  onCreated?: (project: Project) => void;
}

const NAME_MAX_LEN = 200;

interface FormState {
  name: string;
  description: string;
  kind: ProjectKind;
  externalPath: string | null;
  sourcePath: string | null;
  permissionMode: PermissionMode;
  initialMemberProviderIds: string[];
  submitting: boolean;
  error: string | null;
}

const INITIAL_STATE: FormState = {
  name: '',
  description: '',
  kind: 'new',
  externalPath: null,
  sourcePath: null,
  permissionMode: 'hybrid',
  initialMemberProviderIds: [],
  submitting: false,
  error: null,
};

type FormAction =
  | { type: 'setName'; value: string }
  | { type: 'setDescription'; value: string }
  | { type: 'setKind'; value: ProjectKind }
  | { type: 'setExternalPath'; value: string | null }
  | { type: 'setSourcePath'; value: string | null }
  | { type: 'setPermissionMode'; value: PermissionMode }
  | { type: 'setMembers'; value: string[] }
  | { type: 'submitStart' }
  | { type: 'submitError'; message: string }
  | { type: 'reset' };

function reducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value, error: null };
    case 'setDescription':
      return { ...state, description: action.value };
    case 'setKind': {
      const nextKind = action.value;
      // CA-1 client-side: flipping to 'external' while 'auto' is
      // selected must swap the permission mode; otherwise the form
      // would carry an invalid combo until submit.
      const nextPermissionMode: PermissionMode =
        nextKind === 'external' && state.permissionMode === 'auto'
          ? 'hybrid'
          : state.permissionMode;
      return {
        ...state,
        kind: nextKind,
        permissionMode: nextPermissionMode,
        error: null,
      };
    }
    case 'setExternalPath':
      return { ...state, externalPath: action.value, error: null };
    case 'setSourcePath':
      return { ...state, sourcePath: action.value, error: null };
    case 'setPermissionMode':
      return { ...state, permissionMode: action.value, error: null };
    case 'setMembers':
      return { ...state, initialMemberProviderIds: action.value };
    case 'submitStart':
      return { ...state, submitting: true, error: null };
    case 'submitError':
      return { ...state, submitting: false, error: action.message };
    case 'reset':
      return INITIAL_STATE;
  }
}

/**
 * Map a thrown error to an i18n key. Never rethrows.
 */
function mapErrorToI18nKey(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown };
    if (typeof e.name === 'string') {
      if (e.name === 'ExternalAutoForbiddenError') {
        return 'project.errors.externalAutoForbidden';
      }
      if (e.name === 'DuplicateSlugError') return 'project.errors.duplicateSlug';
      if (e.name === 'JunctionTOCTOUMismatchError') {
        return 'project.errors.junctionTOCTOU';
      }
    }
    if (typeof e.message === 'string') {
      if (e.message.includes('folder_missing') || e.message.includes('ENOENT')) {
        return 'project.errors.folderMissing';
      }
    }
  }
  return 'project.errors.generic';
}

export function ProjectCreateModal({
  open,
  onOpenChange,
  onCreated,
}: ProjectCreateModalProps): ReactElement {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { createNew, linkExternal, importFolder } = useProjects();

  // Reset the form whenever the modal goes from closed→open. Submitting
  // with a leftover state from a previous open would surprise the user.
  useEffect(() => {
    if (open) {
      dispatch({ type: 'reset' });
    }
  }, [open]);

  const handleClose = useCallback((): void => {
    if (state.submitting) return;
    onOpenChange(false);
  }, [onOpenChange, state.submitting]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmedName = state.name.trim();
    if (trimmedName.length === 0) {
      dispatch({ type: 'submitError', message: t('project.errors.nameRequired') });
      return;
    }
    if (trimmedName.length > NAME_MAX_LEN) {
      dispatch({ type: 'submitError', message: t('project.errors.nameTooLong') });
      return;
    }
    if (state.kind === 'external' && !state.externalPath) {
      dispatch({
        type: 'submitError',
        message: t('project.errors.externalPathRequired'),
      });
      return;
    }
    if (state.kind === 'imported' && !state.sourcePath) {
      dispatch({
        type: 'submitError',
        message: t('project.errors.sourcePathRequired'),
      });
      return;
    }
    if (state.kind === 'external' && state.permissionMode === 'auto') {
      dispatch({
        type: 'submitError',
        message: t('project.errors.externalAutoForbidden'),
      });
      return;
    }

    dispatch({ type: 'submitStart' });
    try {
      let created: Project;
      const trimmedDescription = state.description.trim();
      const descriptionPayload =
        trimmedDescription.length > 0 ? trimmedDescription : undefined;

      if (state.kind === 'new') {
        created = await createNew({
          name: trimmedName,
          description: descriptionPayload,
          kind: 'new',
          permissionMode: state.permissionMode,
          initialMemberProviderIds: state.initialMemberProviderIds,
        });
      } else if (state.kind === 'external') {
        if (
          state.permissionMode === 'auto' ||
          state.externalPath === null
        ) {
          // Already validated above; narrowing for TS.
          return;
        }
        created = await linkExternal({
          name: trimmedName,
          externalPath: state.externalPath,
          description: descriptionPayload,
          permissionMode: state.permissionMode,
          initialMemberProviderIds: state.initialMemberProviderIds,
        });
      } else {
        if (state.sourcePath === null) return;
        created = await importFolder({
          name: trimmedName,
          sourcePath: state.sourcePath,
          description: descriptionPayload,
          permissionMode: state.permissionMode,
          initialMemberProviderIds: state.initialMemberProviderIds,
        });
      }

      onCreated?.(created);
      onOpenChange(false);
      dispatch({ type: 'reset' });
    } catch (reason) {
      const key = mapErrorToI18nKey(reason);
      dispatch({ type: 'submitError', message: t(key) });
    }
  }, [
    createNew,
    importFolder,
    linkExternal,
    onCreated,
    onOpenChange,
    state.description,
    state.externalPath,
    state.initialMemberProviderIds,
    state.kind,
    state.name,
    state.permissionMode,
    state.sourcePath,
    t,
  ]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="project-create-modal-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out"
        />
        <Dialog.Content
          data-testid="project-create-modal"
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (state.submitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (state.submitting) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('project.create.title')}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="project-create-modal-close"
                aria-label={t('project.create.cancel')}
                disabled={state.submitting}
              >
                <span aria-hidden="true">{'\u2715'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <form
            data-testid="project-create-form"
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('project.create.name')}
              </span>
              <input
                data-testid="project-create-name"
                type="text"
                value={state.name}
                maxLength={NAME_MAX_LEN + 1}
                placeholder={t('project.create.namePlaceholder')}
                disabled={state.submitting}
                onChange={(e) => dispatch({ type: 'setName', value: e.target.value })}
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('project.create.description')}
              </span>
              <input
                data-testid="project-create-description"
                type="text"
                value={state.description}
                placeholder={t('project.create.descriptionPlaceholder')}
                disabled={state.submitting}
                onChange={(e) =>
                  dispatch({ type: 'setDescription', value: e.target.value })
                }
                className="bg-elev text-fg border border-border rounded-panel px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('project.create.kind.label')}
              </span>
              <ProjectKindTabs
                value={state.kind}
                onChange={(next) => dispatch({ type: 'setKind', value: next })}
              />
            </div>

            {state.kind === 'external' && (
              <ExternalPathPicker
                value={state.externalPath}
                onChange={(path) =>
                  dispatch({ type: 'setExternalPath', value: path })
                }
                labelKey="project.create.externalPath.label"
                chooseLabelKey="project.create.externalPath.choose"
                testIdPrefix="project-create-external-path"
              />
            )}
            {state.kind === 'imported' && (
              <ExternalPathPicker
                value={state.sourcePath}
                onChange={(path) =>
                  dispatch({ type: 'setSourcePath', value: path })
                }
                labelKey="project.create.sourcePath.label"
                chooseLabelKey="project.create.sourcePath.choose"
                testIdPrefix="project-create-source-path"
              />
            )}

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('project.create.permissionMode.label')}
              </span>
              <ProjectPermissionRadio
                value={state.permissionMode}
                onChange={(next) =>
                  dispatch({ type: 'setPermissionMode', value: next })
                }
                disabledModes={state.kind === 'external' ? ['auto'] : []}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">
                {t('project.create.members.label')}
              </span>
              <InitialMembersSelector
                value={state.initialMemberProviderIds}
                onChange={(ids) => dispatch({ type: 'setMembers', value: ids })}
              />
            </div>

            {state.error !== null && (
              <div
                role="alert"
                data-testid="project-create-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {state.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft -mx-5 px-5 -mb-4 py-4 bg-panel-header-bg">
              <Button
                type="button"
                tone="ghost"
                data-testid="project-create-cancel"
                onClick={handleClose}
                disabled={state.submitting}
              >
                {t('project.create.cancel')}
              </Button>
              <Button
                type="submit"
                tone="primary"
                data-testid="project-create-submit"
                disabled={state.submitting}
              >
                {t('project.create.submit')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
