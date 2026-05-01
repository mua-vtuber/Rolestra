/**
 * MemberProfileEditModal — 4-field profile editor (R8-Task4, spec §7.1).
 *
 * Opens as a Radix Dialog (풀스크린 modal) when the parent triggers
 * `open=true`. The 4 fields:
 *   - role        (text input, "Senior Engineer")
 *   - personality (textarea, multi-line description)
 *   - expertise   (text input, comma-separated tags)
 *   - avatar      (AvatarPicker — 8 default + custom upload)
 *
 * Save flow (R11-Task15 optimistic):
 *   1. Build a patch with only the changed fields (omits unchanged so we
 *      don't gratuitously bump `updated_at` for a no-op).
 *   2. Close the dialog immediately so the user perceives the save as
 *      applied (R10 D8 — Optimistic UI extension). The seed-cleanup
 *      effect is suppressed during the in-flight window so the draft
 *      survives a reopen-on-failure.
 *   3. Call `useUpdateMemberProfile.mutate(providerId, patch)` in the
 *      background.
 *   4. On success: invoke the seed-cleanup explicitly so the next open
 *      re-fetches a fresh profile (D8 invalidation policy).
 *   5. On failure: re-open the dialog (reopen carries the preserved
 *      draft + the saveError banner) AND surface a toast via the
 *      boundary bus.
 *
 * Cancel: ESC / outside-click / cancel button → close without IPC. The Dialog
 * blocks dismissal while save is in flight (matches RejectDialog pattern).
 *
 * Loading: while `useMemberProfile` fetches the persisted profile, the
 * editor renders with empty/disabled inputs so the user sees the modal
 * frame immediately rather than a blank flash.
 *
 * The component is intentionally controlled at the open-prop level — the
 * parent decides when to open/close. AvatarPicker patch is buffered in
 * local state until save (so a user can change their mind without firing
 * an IPC).
 */

import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/primitives/button';
import { useThrowToBoundary } from '../../components/ErrorBoundary';
import { AvatarPicker } from '../../components/members/AvatarPicker';
import {
  useMemberProfile,
  useUpdateMemberProfile,
  type MemberProfileEditPatch,
} from '../../hooks/use-member-profile';
import type {
  AvatarKind,
  MemberProfile,
} from '../../../shared/member-profile-types';
import type { RoleId } from '../../../shared/role-types';
import { invoke } from '../../ipc/invoke';
import { RolesSkillsTab } from './RolesSkillsTab';

export interface MemberProfileEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  providerId: string;
  /** Display name for the dialog title — passed in to avoid an extra IPC. */
  displayName: string;
  /**
   * Optional pre-resolved URL for the current custom avatar. AvatarPicker
   * needs this to render the preview row in the custom-kind branch.
   */
  customAvatarSrc?: string;
  /** R12-S: 직원에게 부여된 능력 (provider:list 결과에서 부모가 채움). */
  initialRoles?: RoleId[];
  /** R12-S: 능력별 customize prompt — null = 카탈로그 default. */
  initialSkillOverrides?: Partial<Record<RoleId, string>> | null;
}

/**
 * Internal staged-edit state. We seed it from the loaded profile and let
 * the user mutate it freely; only the diff against the original is sent
 * to `member:update-profile`.
 */
interface DraftState {
  role: string;
  personality: string;
  expertise: string;
  avatarKind: AvatarKind;
  avatarData: string | null;
}

function profileToDraft(p: MemberProfile): DraftState {
  return {
    role: p.role,
    personality: p.personality,
    expertise: p.expertise,
    avatarKind: p.avatarKind,
    avatarData: p.avatarData,
  };
}

function buildPatch(
  original: DraftState,
  draft: DraftState,
): MemberProfileEditPatch {
  const patch: MemberProfileEditPatch = {};
  if (draft.role !== original.role) patch.role = draft.role;
  if (draft.personality !== original.personality) {
    patch.personality = draft.personality;
  }
  if (draft.expertise !== original.expertise) patch.expertise = draft.expertise;
  if (
    draft.avatarKind !== original.avatarKind ||
    draft.avatarData !== original.avatarData
  ) {
    patch.avatarKind = draft.avatarKind;
    patch.avatarData = draft.avatarData;
  }
  return patch;
}

const EMPTY_DRAFT: DraftState = {
  role: '',
  personality: '',
  expertise: '',
  avatarKind: 'default',
  avatarData: null,
};

function rolesEqual(a: RoleId[], b: RoleId[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

function overridesEqual(
  a: Partial<Record<RoleId, string>> | null,
  b: Partial<Record<RoleId, string>> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keysA = Object.keys(a) as RoleId[];
  const keysB = Object.keys(b) as RoleId[];
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

export function MemberProfileEditModal({
  open,
  onOpenChange,
  providerId,
  displayName,
  customAvatarSrc,
  initialRoles,
  initialSkillOverrides,
}: MemberProfileEditModalProps): ReactElement {
  const { t } = useTranslation();
  const throwToBoundary = useThrowToBoundary();

  // Disable the IPC fetch when the modal is closed so we don't fire on every
  // parent render that just toggles `open`.
  const fetchKey = open ? providerId : '';
  const { profile, loading, error: fetchError } = useMemberProfile(fetchKey);
  const { mutate, loading: saving, error: saveError, reset } =
    useUpdateMemberProfile();

  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [original, setOriginal] = useState<DraftState>(EMPTY_DRAFT);

  // R12-S Task 8: roles + skill_overrides 는 ProviderInfo 측 데이터라
  // useMemberProfile 의 4-field 패치와 별도 state. 부모가 props 로 초기값을
  // 채움 (provider:list 결과에서 lookup). 저장 시 provider:updateRoles IPC
  // 분리 호출 — 변경 없으면 호출 생략 (해시 비교).
  const [roles, setRoles] = useState<RoleId[]>(initialRoles ?? []);
  const [skillOverrides, setSkillOverrides] = useState<
    Partial<Record<RoleId, string>> | null
  >(initialSkillOverrides ?? null);
  const originalRolesRef = useRef<{
    roles: RoleId[];
    overrides: Partial<Record<RoleId, string>> | null;
  }>({ roles: initialRoles ?? [], overrides: initialSkillOverrides ?? null });

  // R11-Task15: latch raised between optimistic close and the mutation
  // settling. Used by the seed effect to suppress the close-cleanup
  // branch (which would otherwise wipe `draft` + `original` and force a
  // re-seed if the dialog reopens after a save failure).
  const isSavingOptimisticRef = useRef<boolean>(false);

  // Seed draft when the profile fetch resolves (or when opening with a fresh
  // providerId). Skips if the user has already started editing — but R8
  // closes the modal on save so this race is rare in practice.
  //
  // We track the last-seeded provider key in a ref so the effect's
  // setState calls fire AT MOST ONCE per open/providerId combo —
  // satisfying the lint rule against cascading renders. On close we
  // reset the ref so the next open re-seeds even for the same id.
  const seededForKeyRef = useRef<string>('');
  useEffect(() => {
    if (!open) {
      // R11-Task15: skip cleanup while an optimistic save is in flight.
      // The mutation may resolve as failure → reopen, in which case we
      // need the draft preserved so the user keeps their input.
      if (isSavingOptimisticRef.current) return;
      if (seededForKeyRef.current === '') return;
      seededForKeyRef.current = '';
      setDraft(EMPTY_DRAFT);
      setOriginal(EMPTY_DRAFT);
      reset();
      return;
    }
    if (profile && seededForKeyRef.current !== providerId) {
      seededForKeyRef.current = providerId;
      const seed = profileToDraft(profile);
      setDraft(seed);
      setOriginal(seed);
      // R12-S: roles 도 모달 진입 시 부모 props 로 다시 seed.
      const seededRoles = initialRoles ?? [];
      const seededOverrides = initialSkillOverrides ?? null;
      setRoles(seededRoles);
      setSkillOverrides(seededOverrides);
      originalRolesRef.current = {
        roles: seededRoles,
        overrides: seededOverrides,
      };
    }
  }, [open, profile, providerId, reset, initialRoles, initialSkillOverrides]);

  async function handleSave(): Promise<void> {
    const patch = buildPatch(original, draft);
    const profilePatchEmpty = Object.keys(patch).length === 0;
    const rolesChanged = !rolesEqual(originalRolesRef.current.roles, roles);
    const overridesChanged = !overridesEqual(
      originalRolesRef.current.overrides,
      skillOverrides,
    );

    if (profilePatchEmpty && !rolesChanged && !overridesChanged) {
      // No-op edit — close without IPC.
      onOpenChange(false);
      return;
    }
    // R11-Task15: optimistic — close immediately, run the mutation in the
    // background, reopen on failure with draft/saveError preserved.
    isSavingOptimisticRef.current = true;
    onOpenChange(false);
    try {
      // R12-S: profile + roles 두 IPC 를 병렬로 호출. 둘 중 하나만 변경됐으면
      // 해당 IPC 만 호출 — 불필요 mutate 회피.
      const tasks: Promise<unknown>[] = [];
      if (!profilePatchEmpty) {
        tasks.push(mutate(providerId, patch));
      }
      if (rolesChanged || overridesChanged) {
        tasks.push(
          invoke('provider:updateRoles', {
            providerId,
            roles,
            skill_overrides: skillOverrides,
          }),
        );
      }
      await Promise.all(tasks);
      // Success: tear the latch down then drop the seed cache so the
      // next open re-fetches (D8 invalidation policy). The effect would
      // have done this on close, but we suppressed it for the in-flight
      // window — emulate it explicitly here.
      isSavingOptimisticRef.current = false;
      seededForKeyRef.current = '';
      setDraft(EMPTY_DRAFT);
      setOriginal(EMPTY_DRAFT);
      originalRolesRef.current = { roles, overrides: skillOverrides };
      reset();
    } catch (reason) {
      // Failure: drop the latch BEFORE reopening so the open=true effect
      // run sees the same `seededForKeyRef.current === providerId` and
      // skips re-seeding (which would clobber the draft the user wants
      // to fix). saveError is already populated by the hook and renders
      // inside the dialog body. The boundary toast is non-blocking — it
      // mirrors the inline banner in the global toast strip.
      isSavingOptimisticRef.current = false;
      onOpenChange(true);
      throwToBoundary(reason);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="profile-editor-overlay"
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
        <Dialog.Content
          data-testid="profile-editor-dialog"
          data-provider-id={providerId}
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(36rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto',
            'bg-panel-bg text-fg border border-panel-border rounded-panel shadow-panel',
          )}
          onInteractOutside={(e) => {
            if (saving) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (saving) e.preventDefault();
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft bg-panel-header-bg">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('profile.editor.title', { name: displayName })}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                size="sm"
                data-testid="profile-editor-close"
                aria-label={t('profile.editor.cancel')}
                disabled={saving}
              >
                <span aria-hidden="true">{'✕'}</span>
              </Button>
            </Dialog.Close>
          </div>

          <div
            data-testid="profile-editor-body"
            className="px-5 py-4 flex flex-col gap-4"
          >
            {loading && (
              <span
                data-testid="profile-editor-loading"
                className="text-xs text-fg-muted"
              >
                {t('profile.editor.loading')}
              </span>
            )}
            {fetchError && (
              <div
                role="alert"
                data-testid="profile-editor-fetch-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk"
              >
                {t('profile.editor.fetchError')}
              </div>
            )}

            <Tabs.Root defaultValue="character" className="flex flex-col gap-3">
              <Tabs.List
                aria-label={t('profile.editor.title', { name: displayName })}
                className="flex gap-1 border-b border-border-soft"
              >
                <Tabs.Trigger
                  value="character"
                  data-testid="profile-editor-tab-character"
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px',
                    'data-[state=inactive]:border-transparent data-[state=inactive]:text-fg-muted',
                    'data-[state=active]:border-brand data-[state=active]:text-fg',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  )}
                >
                  {t('profile.editor.tab.character')}
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="rolesSkills"
                  data-testid="profile-editor-tab-roles-skills"
                  className={clsx(
                    'px-3 py-1.5 text-xs font-medium border-b-2 -mb-px',
                    'data-[state=inactive]:border-transparent data-[state=inactive]:text-fg-muted',
                    'data-[state=active]:border-brand data-[state=active]:text-fg',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  )}
                >
                  {t('profile.editor.tab.rolesSkills')}
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content
                value="character"
                className="flex flex-col gap-4 outline-none"
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t('profile.editor.fields.role')}
                  </span>
                  <input
                    data-testid="profile-editor-role"
                    type="text"
                    maxLength={120}
                    value={draft.role}
                    disabled={loading || saving}
                    onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    className="rounded-panel border border-panel-border bg-sunk px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t('profile.editor.fields.personality')}
                  </span>
                  <textarea
                    data-testid="profile-editor-personality"
                    rows={3}
                    maxLength={2000}
                    value={draft.personality}
                    disabled={loading || saving}
                    onChange={(e) =>
                      setDraft({ ...draft, personality: e.target.value })
                    }
                    className="resize-none rounded-panel border border-panel-border bg-sunk px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t('profile.editor.fields.expertise')}
                  </span>
                  <input
                    data-testid="profile-editor-expertise"
                    type="text"
                    maxLength={500}
                    value={draft.expertise}
                    disabled={loading || saving}
                    onChange={(e) =>
                      setDraft({ ...draft, expertise: e.target.value })
                    }
                    className="rounded-panel border border-panel-border bg-sunk px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">
                    {t('profile.editor.fields.avatar')}
                  </span>
                  <AvatarPicker
                    providerId={providerId}
                    currentKind={draft.avatarKind}
                    currentData={draft.avatarData}
                    currentCustomSrc={customAvatarSrc}
                    onChange={(p) =>
                      setDraft({
                        ...draft,
                        avatarKind: p.avatarKind,
                        avatarData: p.avatarData,
                      })
                    }
                  />
                </div>
              </Tabs.Content>

              <Tabs.Content
                value="rolesSkills"
                className="outline-none"
              >
                <RolesSkillsTab
                  roles={roles}
                  skillOverrides={skillOverrides}
                  disabled={loading || saving}
                  onChange={(nextRoles, nextOverrides) => {
                    setRoles(nextRoles);
                    setSkillOverrides(nextOverrides);
                  }}
                />
              </Tabs.Content>
            </Tabs.Root>

            {saveError && (
              <div
                role="alert"
                data-testid="profile-editor-save-error"
                className="text-sm text-danger border border-danger rounded-panel px-3 py-2 bg-sunk flex flex-col gap-1"
              >
                <p>
                  {t('profile.editor.saveError', { message: saveError.message })}
                </p>
                <p
                  data-testid="profile-editor-rollback-hint"
                  className="text-xs text-fg-muted"
                >
                  {t('profile.editor.optimisticRollback')}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-soft">
            <Dialog.Close asChild>
              <Button
                type="button"
                tone="ghost"
                data-testid="profile-editor-cancel"
                disabled={saving}
              >
                {t('profile.editor.cancel')}
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              tone="primary"
              data-testid="profile-editor-save"
              disabled={loading || saving}
              onClick={handleSave}
            >
              {saving ? t('profile.editor.saving') : t('profile.editor.save')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
