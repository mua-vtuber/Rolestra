/**
 * ContextModeResolver — determines folder mode vs file mode
 * based on participant provider capabilities.
 *
 * Folder mode: at least one participant can freely explore files
 *   (CLI, or Local/API with tool support)
 * File mode: no participant can explore — user selects individual files
 */

export type ContextMode = 'folder' | 'file';

export interface ParticipantCapability {
  id: string;
  providerType: 'cli' | 'api' | 'local';
  hasToolSupport: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ContextModeResolver {
  static resolve(participants: ParticipantCapability[]): ContextMode {
    const hasFolderCapable = participants.some(
      (p) => p.providerType === 'cli' || p.hasToolSupport,
    );
    return hasFolderCapable ? 'folder' : 'file';
  }
}
