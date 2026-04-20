/**
 * project:* IPC handlers.
 *
 * Map the project channels (pick-folder / list / create / link-external /
 * import / update / archive / open / set-autonomy) onto
 * {@link ProjectService}. Every business rule — slug derivation,
 * external+auto rejection, filesystem materialisation, folder_missing
 * reconciliation — lives in the service; these wrappers only translate
 * shapes.
 *
 * `link-external` and `import` are sugar over `create` with a fixed
 * `kind`; spec §6 exposes them as discrete channels so the renderer UX
 * can diverge without branching here.
 *
 * `pick-folder` is the v3 replacement for the legacy
 * `workspace:pick-folder` channel. It is scoped to the project-create
 * modal and returns the raw OS dialog result — validation/realpath
 * baselining stays inside `ProjectService.create` (spec §7.6 CA-3).
 */

import { dialog } from 'electron';

import type { IpcResponse, IpcRequest } from '../../../shared/ipc-types';
import type { ProjectService } from '../../projects/project-service';

let projectAccessor: (() => ProjectService) | null = null;

export function setProjectServiceAccessor(fn: () => ProjectService): void {
  projectAccessor = fn;
}

function getService(): ProjectService {
  if (!projectAccessor) {
    throw new Error('project handler: service not initialized');
  }
  return projectAccessor();
}

/**
 * project:pick-folder — open the OS directory picker.
 * Returns `{ folderPath: null }` on cancel.
 */
export async function handleProjectPickFolder(): Promise<
  IpcResponse<'project:pick-folder'>
> {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { folderPath: null };
  }
  return { folderPath: result.filePaths[0] };
}

/** project:list */
export function handleProjectList(
  data: IpcRequest<'project:list'>,
): IpcResponse<'project:list'> {
  const all = getService().list();
  const includeArchived = data?.includeArchived ?? false;
  const projects = includeArchived
    ? all
    : all.filter((p) => p.status !== 'archived');
  return { projects };
}

/** project:create */
export async function handleProjectCreate(
  data: IpcRequest<'project:create'>,
): Promise<IpcResponse<'project:create'>> {
  const project = await getService().create(data);
  return { project };
}

/** project:link-external */
export async function handleProjectLinkExternal(
  data: IpcRequest<'project:link-external'>,
): Promise<IpcResponse<'project:link-external'>> {
  const project = await getService().create({
    name: data.name,
    description: data.description,
    kind: 'external',
    externalPath: data.externalPath,
    permissionMode: data.permissionMode,
    autonomyMode: data.autonomyMode,
    initialMemberProviderIds: data.initialMemberProviderIds,
  });
  return { project };
}

/** project:import */
export async function handleProjectImport(
  data: IpcRequest<'project:import'>,
): Promise<IpcResponse<'project:import'>> {
  const project = await getService().create({
    name: data.name,
    description: data.description,
    kind: 'imported',
    sourcePath: data.sourcePath,
    permissionMode: data.permissionMode,
    autonomyMode: data.autonomyMode,
    initialMemberProviderIds: data.initialMemberProviderIds,
  });
  return { project };
}

/** project:update */
export function handleProjectUpdate(
  data: IpcRequest<'project:update'>,
): IpcResponse<'project:update'> {
  const project = getService().update(data.id, data.patch);
  return { project };
}

/** project:archive */
export function handleProjectArchive(
  data: IpcRequest<'project:archive'>,
): IpcResponse<'project:archive'> {
  getService().archive(data.id);
  return { success: true };
}

/** project:open */
export function handleProjectOpen(
  data: IpcRequest<'project:open'>,
): IpcResponse<'project:open'> {
  getService().open(data.id);
  return { success: true };
}

/** project:set-autonomy */
export function handleProjectSetAutonomy(
  data: IpcRequest<'project:set-autonomy'>,
): IpcResponse<'project:set-autonomy'> {
  const project = getService().setAutonomy(data.id, data.mode);
  return { project };
}
