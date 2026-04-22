/**
 * AvatarPicker — 8 default catalogue + custom upload (R8-Task3, spec §7.1).
 *
 * Used inside {@link MemberProfileEditModal}. The picker is controlled — it
 * reports selection to the parent through `onChange`; persistence happens
 * when the parent's "save" button hits `member:update-profile` with the
 * accumulated patch.
 *
 * Layout:
 *   - Catalogue grid: 4 × 2 of <Avatar shape='circle' size=44> + i18n
 *     label below each. Selected entry has `data-selected='true'` and a
 *     visual ring (`ring-2 ring-brand`).
 *   - Footer row: "사진 업로드" (calls `useAvatarPicker.uploadCustom`) +
 *     "기본으로 되돌리기" (sets back to the first default key).
 *
 * Custom branch:
 *   - When the parent passes `currentKind='custom'` + non-empty
 *     `currentData`, the grid section shows a "현재 업로드된 사진"
 *     <Avatar shape='circle' size=44 avatarKind='custom' resolvedSrc={...}>
 *     above the grid. The grid stays visible so the user can switch back to
 *     a default at any time.
 *
 * The picker does NOT validate file size/extension itself — those checks
 * live in AvatarStore (R8-Task5) where the actual filesystem copy happens.
 * The hook surfaces the typed error from the IPC reject; this component
 * displays the i18n-translated message.
 */

import { clsx } from 'clsx';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from './Avatar';
import { useAvatarPicker } from '../../hooks/use-avatar-picker';
import { DEFAULT_AVATARS } from '../../../shared/default-avatars';
import type { AvatarKind } from '../../../shared/member-profile-types';

export interface AvatarPickerProps {
  providerId: string;
  currentKind: AvatarKind;
  currentData: string | null;
  /**
   * Optional pre-resolved URL for the currently-selected custom avatar.
   * The parent (EditModal) computes this — AvatarPicker stays IPC-free
   * apart from the upload mutation.
   */
  currentCustomSrc?: string;
  /** Called when the user picks a default OR successfully uploads a custom. */
  onChange(patch: { avatarKind: AvatarKind; avatarData: string | null }): void;
  className?: string;
}

export function AvatarPicker({
  providerId,
  currentKind,
  currentData,
  currentCustomSrc,
  onChange,
  className,
}: AvatarPickerProps): ReactElement {
  const { t } = useTranslation();
  const {
    avatars,
    loading,
    error,
    uploadCustom,
    uploading,
    uploadError,
  } = useAvatarPicker();

  // Catalogue source preference: live IPC labels when available, otherwise
  // fall back to the static catalogue's `key` so the picker still renders
  // when the IPC fetch fails (defence-in-depth — the user can still pick
  // an avatar even if the labels are missing).
  const renderable: { key: string; label: string }[] =
    avatars ??
    DEFAULT_AVATARS.map((a) => ({ key: a.key, label: a.key }));

  async function handleUpload(): Promise<void> {
    try {
      const result = await uploadCustom(providerId);
      if (result === null) return; // user cancelled the OS picker
      onChange({ avatarKind: 'custom', avatarData: result.relativePath });
    } catch {
      // uploadError is set by the hook — surface via render below.
    }
  }

  return (
    <div
      data-testid="avatar-picker"
      className={clsx('flex flex-col gap-3', className)}
    >
      {currentKind === 'custom' && currentData && (
        <div className="flex items-center gap-2">
          <Avatar
            providerId={providerId}
            avatarKind="custom"
            avatarData={currentData}
            resolvedSrc={currentCustomSrc}
            size={44}
            shape="circle"
          />
          <span className="text-sm text-fg-muted">
            {t('member.avatarPicker.currentCustom')}
          </span>
        </div>
      )}

      <div
        data-testid="avatar-picker-grid"
        className="grid grid-cols-4 gap-2"
        role="radiogroup"
        aria-label={t('member.avatarPicker.title')}
      >
        {renderable.map((opt) => {
          const selected =
            currentKind === 'default' && currentData === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`avatar-picker-cell-${opt.key}`}
              data-selected={selected ? 'true' : 'false'}
              onClick={() =>
                onChange({ avatarKind: 'default', avatarData: opt.key })
              }
              className={clsx(
                'flex flex-col items-center gap-1 rounded-md p-2 transition',
                selected ? 'ring-2 ring-brand bg-bg-hover' : 'hover:bg-bg-hover',
              )}
            >
              <Avatar
                providerId={providerId}
                avatarKind="default"
                avatarData={opt.key}
                size={36}
                shape="circle"
              />
              <span className="truncate text-xs text-fg-muted">{opt.label}</span>
            </button>
          );
        })}
      </div>

      {loading && (
        <span data-testid="avatar-picker-loading" className="text-xs text-fg-muted">
          {t('member.avatarPicker.loadingCatalogue')}
        </span>
      )}
      {error && (
        <span data-testid="avatar-picker-error" className="text-xs text-danger">
          {t('member.avatarPicker.catalogueError')}
        </span>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="avatar-picker-upload"
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-md bg-bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-hover disabled:opacity-60"
        >
          {uploading
            ? t('member.avatarPicker.uploading')
            : t('member.avatarPicker.upload')}
        </button>
        <button
          type="button"
          data-testid="avatar-picker-revert"
          onClick={() =>
            onChange({
              avatarKind: 'default',
              avatarData: DEFAULT_AVATARS[0].key,
            })
          }
          className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
        >
          {t('member.avatarPicker.revert')}
        </button>
      </div>

      {uploadError && (
        <span data-testid="avatar-picker-upload-error" className="text-xs text-danger">
          {t('member.avatarPicker.uploadError', { message: uploadError.message })}
        </span>
      )}
    </div>
  );
}
