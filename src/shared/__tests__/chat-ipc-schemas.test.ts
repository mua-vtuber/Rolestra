import { describe, expect, it } from 'vitest';
import { criticalChannelSchemas, v3ChannelSchemas } from '../ipc-schemas';
import { LIVE_IPC_CHANNELS } from '../ipc-types';

describe('live chat IPC schemas', () => {
  it('covers exactly the callable preload and Main channels', () => {
    expect(Object.keys(v3ChannelSchemas).sort()).toEqual([...LIVE_IPC_CHANNELS].sort());
    expect(Object.keys(criticalChannelSchemas).sort()).toEqual([
      'arena-root:open-folder', 'config:delete-secret', 'config:set-secret', 'provider:add',
      'provider:add-local', 'provider:remove', 'provider:replace-api-key',
    ]);
  });

  // 2026-10-01 R6-3: the renderer never sends an Ollama address, and only
  // main can mark a local AI as confirmed Ollama.
  it('keeps the local AI address and the Ollama confirmation on the main side', () => {
    expect(() => v3ChannelSchemas['provider:detect-local'].parse(undefined)).not.toThrow();
    expect(() => v3ChannelSchemas['provider:add-local'].parse({ displayName: 'gemma', model: 'gemma4:e4b' }))
      .not.toThrow();
    expect(() => v3ChannelSchemas['provider:add-local'].parse({
      displayName: 'gemma', model: 'gemma4:e4b', baseUrl: 'http://elsewhere:11434',
    })).toThrow();
    expect(() => v3ChannelSchemas['provider:add-local'].parse({ displayName: ' ', model: 'm' })).toThrow();
    // QA Minor 1: manual local address entry is gone — provider:add takes
    // CLI and API configs only, so a renderer cannot point a local AI at an
    // address main did not find, nor claim the Ollama confirmation.
    expect(() => v3ChannelSchemas['provider:add'].parse({
      displayName: 'local', config: { type: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'm' },
    })).toThrow();
    expect(() => v3ChannelSchemas['provider:add'].parse({
      displayName: 'local',
      config: { type: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'm', confirmedServer: 'ollama' },
    })).toThrow();
    expect(() => v3ChannelSchemas['provider:list-models'].parse({ type: 'local', key: 'http://127.0.0.1:11434' }))
      .toThrow();
  });

  it('rejects retired work payloads in live mutations', () => {
    expect(() => v3ChannelSchemas['message:append'].parse({
      channelId: 'general', meetingId: 'old-meeting', content: 'hello',
    })).toThrow();
    expect(() => v3ChannelSchemas['message:search'].parse({
      query: 'hello', scope: { kind: 'project', projectId: 'old-project' },
    })).toThrow();
    expect(() => v3ChannelSchemas['config:update-settings'].parse({
      patch: { autonomyMode: 'queue' },
    })).toThrow();
    // 2026-10-01: the consensus folder setting was removed (CLI cwd is the
    // fixed <ArenaRoot>/consensus), so the patch no longer accepts it.
    expect(() => v3ChannelSchemas['config:update-settings'].parse({
      patch: { consensusFolderPath: 'C:/elsewhere' },
    })).toThrow();
    expect(() => v3ChannelSchemas['member:update-profile'].parse({
      providerId: 'ai-1', patch: { statusOverride: 'offline-manual' },
    })).toThrow();
  });

  it('accepts a pass request with a channel id only (spec 2026-10-01 F1)', () => {
    expect(() => v3ChannelSchemas['chat:pass-turn'].parse({ channelId: 'room' })).not.toThrow();
    expect(() => v3ChannelSchemas['chat:pass-turn'].parse({ channelId: '' })).toThrow();
    expect(() => v3ChannelSchemas['chat:pass-turn'].parse({})).toThrow();
  });

  it('accepts free chat and provider connection payloads', () => {
    expect(() => v3ChannelSchemas['channel:list'].parse({ projectId: null })).not.toThrow();
    expect(() => v3ChannelSchemas['dm:create'].parse({ providerId: 'ai-1' })).not.toThrow();
    expect(() => v3ChannelSchemas['message:append'].parse({
      channelId: 'general', content: 'hello',
    })).not.toThrow();
    expect(() => v3ChannelSchemas['config:update-settings'].parse({
      patch: { language: 'ko' },
    })).not.toThrow();
  });

  // QA Minor 1: the renderer may change only the language — never the
  // Ollama address main detects with (it would redirect local detection),
  // nor the retired uiTheme field.
  it('lets the renderer change only the language setting', () => {
    expect(() => v3ChannelSchemas['config:update-settings'].parse({
      patch: { ollamaEndpoint: 'http://elsewhere:11434' },
    })).toThrow();
    expect(() => v3ChannelSchemas['config:update-settings'].parse({ patch: { uiTheme: 'light' } })).toThrow();
    expect(() => v3ChannelSchemas['config:update-settings'].parse({ patch: { language: 'en' } })).not.toThrow();
  });

  it('no longer offers settings reads or secret key listings to the renderer', () => {
    expect(LIVE_IPC_CHANNELS).not.toContain('config:get-settings');
    expect(LIVE_IPC_CHANNELS).not.toContain('config:list-secret-keys');
  });

  it('allows only live notification kinds in update and test requests', () => {
    for (const kind of ['new_message', 'error']) {
      expect(() => v3ChannelSchemas['notification:test'].parse({ kind })).not.toThrow();
      expect(() => v3ChannelSchemas['notification:update-prefs'].parse({
        patch: { [kind]: { enabled: false } },
      })).not.toThrow();
    }
    for (const kind of ['approval_pending', 'work_done', 'queue_progress', 'audit_result']) {
      expect(() => v3ChannelSchemas['notification:test'].parse({ kind })).toThrow();
      expect(() => v3ChannelSchemas['notification:update-prefs'].parse({
        patch: { new_message: { enabled: true }, [kind]: { enabled: false } },
      })).toThrow();
    }
  });
});
