import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArenaRootService } from '../../arena/arena-root-service';
import { ChannelRepository } from '../../channels/channel-repository';
import { closeDatabase, getDatabase, initDatabaseRoot } from '../../database/connection';
import { runMigrations } from '../../database/migrator';
import { ProjectRepository } from '../../projects/project-repository';
import { createChatServices } from '../chat-services';
import type { Channel } from '../../../shared/channel-types';
import { asAbsolutePath } from '../../../shared/absolute-path';

describe('chat-only Main composition on an existing database', () => {
  const directories: string[] = [];
  afterEach(() => {
    closeDatabase();
    for (const directory of directories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reopens general and archived project history without work services', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestra-chat-main-'));
    directories.push(directory);
    const arena = new ArenaRootService({
      getSettings: () => ({ arenaRoot: directory }),
      updateSettings: () => undefined,
    });
    await arena.ensure();
    initDatabaseRoot(arena);
    runMigrations();
    const first = createChatServices(arena, asAbsolutePath(path.join(directory, 'chat-cli-instructions'), 'test'));
    const general = first.channelService.getGlobalGeneralChannel();
    first.messageService.append({
      channelId: general.id, meetingId: null, authorId: 'user',
      authorKind: 'user', role: 'user', content: 'saved global hello',
    });

    const db = getDatabase();
    new ProjectRepository(db).insert({
      id: 'archived-project', slug: 'archive', name: 'Archived', description: '',
      kind: 'new', externalLink: null, permissionMode: 'hybrid',
      autonomyMode: 'manual', status: 'archived', createdAt: 1, archivedAt: 2,
    });
    const archivedChannel = {
      ...general, id: 'archived-channel', projectId: 'archived-project',
      name: 'old room', kind: 'user', createdAt: 2,
    } as Channel;
    new ChannelRepository(db).insert(archivedChannel);
    first.messageService.append({
      channelId: archivedChannel.id, meetingId: null, authorId: 'user',
      authorKind: 'user', role: 'user', content: 'saved archived hello',
    });
    db.prepare(`INSERT INTO queue_items
      (id, project_id, target_channel_id, order_index, prompt, status, created_at)
      VALUES ('old-in-progress', 'archived-project', 'archived-channel',
        1000, 'unfinished archived work', 'in_progress', 1)`).run();
    db.prepare(`INSERT INTO providers
      (id, display_name, kind, config_json, created_at, updated_at)
      VALUES ('saved-provider', 'Saved', 'api', '{}', 1, 1)`).run();
    db.prepare(`INSERT INTO member_profiles
      (provider_id, role, personality, expertise, updated_at)
      VALUES ('saved-provider', 'friend', 'warm', 'chat', 1)`).run();

    closeDatabase();
    initDatabaseRoot(arena);
    runMigrations();
    const second = createChatServices(arena, asAbsolutePath(path.join(directory, 'chat-cli-instructions'), 'test'));
    expect(second.channelService.getGlobalGeneralChannel().id).toBe(general.id);
    expect(second.messageService.listByChannel(general.id)[0]?.content).toBe('saved global hello');
    expect(second.messageService.listByChannel(archivedChannel.id)[0]?.content).toBe('saved archived hello');
    expect(new ProjectRepository(getDatabase()).get('archived-project')?.status).toBe('archived');
    expect((getDatabase().prepare(`SELECT status FROM queue_items WHERE id = 'old-in-progress'`).get() as { status: string }).status).toBe('in_progress');
    expect((getDatabase().prepare(`SELECT role FROM member_profiles WHERE provider_id = 'saved-provider'`).get() as { role: string }).role).toBe('friend');
    expect('queueService' in second).toBe(false);
    expect('projectService' in second).toBe(false);
    expect('meetingService' in second).toBe(false);
    expect('executionService' in second).toBe(false);
  });
});
