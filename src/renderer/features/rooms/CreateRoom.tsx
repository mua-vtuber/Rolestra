import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useMembers } from '../../hooks/use-members';
import { notifyChannelsChanged } from '../../hooks/channel-invalidation-bus';
import { invoke } from '../../ipc/invoke';

interface ParticipantDraft { personaSource: 'default' | 'custom'; customPersona: string }
interface Props { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }

export function CreateRoom({ open, onOpenChange, onCreated }: Props): ReactElement {
  const { t } = useTranslation();
  const { members } = useMembers();
  const [name, setName] = useState('');
  const [participants, setParticipants] = useState<Record<string, ParticipantDraft>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const submitting = useRef(false);
  const created = useRef(false);
  const entries = Object.entries(participants);
  const valid = name.trim().length > 0 && entries.length > 0 && entries.every(
    ([, draft]) => draft.personaSource === 'default' || draft.customPersona.trim().length > 0,
  );

  const submit = async (): Promise<void> => {
    if (!valid || submitting.current || created.current) return;
    submitting.current = true;
    setPending(true);
    setError(false);
    try {
      const { room } = await invoke('room:create', {
        name: name.trim(),
        participants: entries.map(([providerId, draft]) => ({
          providerId, personaSource: draft.personaSource,
          ...(draft.personaSource === 'custom' ? { customPersona: draft.customPersona.trim() } : {}),
        })),
      });
      created.current = true;
      await notifyChannelsChanged();
      onCreated(room.id);
      onOpenChange(false);
    } catch {
      setError(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content data-testid="room-create-dialog"
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-border bg-canvas p-5 text-fg shadow-panel">
          <Dialog.Title className="font-display text-base font-semibold">{t('rooms.createTitle')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-fg-muted">{t('rooms.personaSnapshotHint')}</Dialog.Description>
          <label className="mt-4 block text-sm">{t('rooms.name')}
            <input data-testid="room-create-name" value={name} maxLength={100} disabled={pending}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-panel border border-border bg-sunk p-2" />
          </label>
          <fieldset className="mt-4 space-y-3" disabled={pending}>
            <legend className="mb-2 text-sm font-semibold">{t('rooms.participants')}</legend>
            {members === null ? <p className="text-xs text-fg-muted">{t('rooms.loading')}</p> : !members.length ? (
              <p className="text-xs text-fg-muted">{t('rooms.noMembers')}</p>
            ) : members.map((member) => {
              const draft = participants[member.providerId];
              return (
                <div key={member.providerId} className="rounded-panel border border-border p-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" data-testid={`room-participant-${member.providerId}`} checked={draft !== undefined}
                      onChange={(e) => setParticipants((current) => {
                        if (!e.target.checked) return Object.fromEntries(Object.entries(current).filter(([id]) => id !== member.providerId));
                        const next = { ...current };
                        next[member.providerId] = { personaSource: 'default',
                          customPersona: member.characterSheet };
                        return next;
                      })} />
                    {member.displayName}
                  </label>
                  {draft ? <div className="mt-2 space-y-2">
                    <label className="block text-xs text-fg-muted">{t('rooms.personaSource')}
                      <select data-testid={`room-persona-source-${member.providerId}`} value={draft.personaSource}
                        className="mt-1 w-full rounded-panel border border-border bg-sunk p-2 text-fg"
                        onChange={(e) => setParticipants((current) => ({ ...current, [member.providerId]: {
                          ...draft, personaSource: e.target.value === 'custom' ? 'custom' : 'default',
                        } }))}>
                        <option value="default">{t('rooms.personaDefault')}</option>
                        <option value="custom">{t('rooms.personaCustom')}</option>
                      </select>
                    </label>
                    {draft.personaSource === 'custom' ? <textarea data-testid={`room-persona-text-${member.providerId}`}
                      aria-label={t('rooms.personaFor', { name: member.displayName })} rows={4} maxLength={10000}
                      value={draft.customPersona} className="w-full rounded-panel border border-border bg-sunk p-2 text-sm"
                      onChange={(e) => setParticipants((current) => ({ ...current, [member.providerId]: { ...draft, customPersona: e.target.value } }))} /> : null}
                  </div> : null}
                </div>
              );
            })}
          </fieldset>
          {error ? <p data-testid="room-create-error" role="alert" className="mt-3 text-sm text-danger-text">{t('rooms.createFailed')}</p> : null}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" disabled={pending} onClick={() => onOpenChange(false)} className="rounded-panel px-3 py-2 text-sm">{t('rooms.cancel')}</button>
            <button type="button" data-testid="room-create-submit" disabled={!valid || pending} onClick={() => { void submit(); }}
              className="rounded-panel bg-brand px-3 py-2 text-sm text-white disabled:opacity-40">{t('rooms.create')}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
