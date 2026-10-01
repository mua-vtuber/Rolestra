import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { AvatarPicker } from '../../components/members/AvatarPicker';
import { Button } from '../../components/primitives/button';
import {
  useMemberProfile,
  useUpdateMemberProfile,
  useRenameMember,
  type MemberProfileEditPatch,
} from '../../hooks/use-member-profile';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { ProviderAccountSection } from './ProviderAccountSection';
import {
  MEMBER_CHARACTER_SHEET_MAX_LENGTH,
  type MemberProfile,
} from '../../../shared/member-profile-types';
import { PROVIDER_DISPLAY_NAME_MAX_LENGTH } from '../../../shared/provider-types';
import { readIpcErrorCause } from '../../../shared/ipc-error';

/**
 * Electron passes only an error's message across IPC, so the error's name
 * never reaches the renderer; main tags the cause in the message instead
 * (`shared/ipc-error.ts`). The name check stays for in-process callers.
 */
function isDuplicateDisplayName(err: unknown): boolean {
  if (readIpcErrorCause(err) === 'duplicate-display-name') return true;
  if (!err || typeof err !== 'object') return false;
  return (err as { name?: unknown }).name === 'DuplicateDisplayNameError';
}

export interface MemberProfileEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerId: string;
  displayName: string;
  customAvatarSrc?: string;
}

export function MemberProfileEditModal({
  open,
  onOpenChange,
  providerId,
  displayName,
  customAvatarSrc,
}: MemberProfileEditModalProps): ReactElement {
  const { t } = useTranslation();
  const { profile, loading, error } = useMemberProfile(open ? providerId : '');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay data-testid="profile-editor-overlay" className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content data-testid="profile-editor-dialog" aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-border bg-canvas text-fg shadow-panel">
          <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
            <Dialog.Title className="text-base font-display font-semibold">
              {t('profile.editor.title', { name: displayName })}
            </Dialog.Title>
            <Dialog.Close asChild><Button type="button" tone="ghost" size="sm"
              data-testid="profile-editor-close">{t('profile.editor.cancel')}</Button></Dialog.Close>
          </div>
          {loading && profile === null ? <p data-testid="profile-editor-loading" className="p-5 text-sm text-fg-muted">{t('profile.editor.loading')}</p> : null}
          {error ? <p data-testid="profile-editor-fetch-error" role="alert" className="p-5 text-sm text-danger-text">{t('profile.editor.fetchError')}</p> : null}
          {profile ? <ProfileForm key={`${providerId}:${profile.updatedAt}`} profile={profile}
            displayName={displayName} customAvatarSrc={customAvatarSrc} onClose={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProfileForm({ profile, displayName, customAvatarSrc, onClose }: {
  profile: MemberProfile;
  displayName: string;
  customAvatarSrc?: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { mutate: mutateProfile, loading: savingProfile, error: profileError } = useUpdateMemberProfile();
  const { mutate: mutateName, loading: savingName, error: nameError } = useRenameMember();
  const [name, setName] = useState(displayName);
  const [characterSheet, setCharacterSheet] = useState(profile.characterSheet);
  const [avatarKind, setAvatarKind] = useState(profile.avatarKind);
  const [avatarData, setAvatarData] = useState(profile.avatarData);

  const saving = savingProfile || savingName;
  // A duplicate-name failure surfaces its own dedicated message; any other
  // rename failure falls back to the generic save-error banner.
  const duplicateName = nameError !== null && isDuplicateDisplayName(nameError);

  const save = async (): Promise<void> => {
    const trimmedName = name.trim();
    let renamed = false;
    // Rename first — a duplicate-name rejection should not leave the
    // character sheet half-saved while the user re-checks the name field.
    if (trimmedName !== displayName) {
      try {
        await mutateName(profile.providerId, trimmedName);
        renamed = true;
      } catch {
        return; // nameError now holds the failure; keep the modal open.
      }
    }

    const patch: MemberProfileEditPatch = {};
    if (characterSheet !== profile.characterSheet) patch.characterSheet = characterSheet;
    if (avatarKind !== profile.avatarKind || avatarData !== profile.avatarData) {
      patch.avatarKind = avatarKind;
      patch.avatarData = avatarData;
    }
    if (Object.keys(patch).length > 0) {
      try {
        await mutateProfile(profile.providerId, patch);
      } catch {
        // useUpdateMemberProfile exposes the error next to the form. The
        // rename above (if any) already committed — do not roll it back;
        // the user can re-save the character sheet on its own.
        if (renamed) await notifyChannelsChanged();
        return;
      }
    }
    if (renamed || Object.keys(patch).length > 0) await notifyChannelsChanged();
    onClose();
  };

  return (
    <>
      <div data-testid="profile-editor-body" className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
        <label className="block text-sm">{t('profile.editor.fields.name')}
          <input data-testid="profile-editor-name" value={name} onChange={(event) => setName(event.target.value)}
            maxLength={PROVIDER_DISPLAY_NAME_MAX_LENGTH} disabled={saving}
            className="mt-1 w-full rounded-panel border border-panel-border bg-sunk px-3 py-2" />
        </label>
        {duplicateName ? <p data-testid="profile-editor-name-duplicate-error" role="alert" className="text-sm text-danger-text">
          {t('profile.editor.nameDuplicateError', { name: name.trim() })}
        </p> : null}
        <label className="block text-sm">{t('profile.editor.fields.characterSheet')}
          <textarea data-testid="profile-editor-character-sheet" value={characterSheet}
            onChange={(event) => setCharacterSheet(event.target.value)} rows={8}
            maxLength={MEMBER_CHARACTER_SHEET_MAX_LENGTH} disabled={saving}
            className="mt-1 w-full rounded-panel border border-panel-border bg-sunk px-3 py-2" />
        </label>
        <AvatarPicker providerId={profile.providerId} currentKind={avatarKind}
          currentData={avatarData} currentCustomSrc={customAvatarSrc}
          onChange={(next) => { setAvatarKind(next.avatarKind); setAvatarData(next.avatarData); }} />
        <ProviderAccountSection providerId={profile.providerId} displayName={displayName} onDeleted={onClose} />
        {(() => {
          // nameError (non-duplicate) and profileError never coexist — a
          // failed rename returns before the profile patch is attempted.
          const genericError = !duplicateName && nameError ? nameError : profileError;
          return genericError ? (
            <p data-testid="profile-editor-save-error" role="alert" className="text-sm text-danger-text">
              {t('profile.editor.saveError', { message: genericError.message })}
            </p>
          ) : null;
        })()}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-soft px-5 py-3">
        <Button type="button" tone="ghost" size="sm" data-testid="profile-editor-cancel"
          onClick={onClose} disabled={saving}>{t('profile.editor.cancel')}</Button>
        <Button type="button" tone="primary" size="sm" data-testid="profile-editor-save"
          onClick={() => void save()} disabled={saving || name.trim().length === 0}>{t('profile.editor.save')}</Button>
      </div>
    </>
  );
}
