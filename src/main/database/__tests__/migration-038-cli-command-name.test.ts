import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrations } from '../migrations';
import { runMigrations } from '../migrator';

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });

function insertProvider(db: Database.Database, id: string, kind: string, config: object | string): void {
  db.prepare(`INSERT INTO providers (id, display_name, kind, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1)`).run(id, id, kind, typeof config === 'string' ? config : JSON.stringify(config));
}

function command(db: Database.Database, id: string): unknown {
  const row = db.prepare('SELECT config_json FROM providers WHERE id = ?').get(id) as { config_json: string };
  try {
    return (JSON.parse(row.config_json) as { command?: unknown }).command;
  } catch {
    return row.config_json;
  }
}

function upgrade(seed: (db: Database.Database) => void): Database.Database {
  const db = new Database(':memory:');
  opened.push(db);
  runMigrations(db, migrations.filter((item) => item.id < '038-cli-command-name'));
  seed(db);
  runMigrations(db, migrations);
  return db;
}

describe('038 CLI command name', () => {
  it('rewrites a stored claude / codex path to the bare command name', () => {
    const db = upgrade((seed) => {
      insertProvider(seed, 'codex-app', 'cli',
        { type: 'cli', command: 'C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\de8a38d2100ae498\\codex.exe', args: [] });
      insertProvider(seed, 'codex-npm', 'cli', { type: 'cli', command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\Codex.CMD' });
      insertProvider(seed, 'claude-local', 'cli', { type: 'cli', command: 'C:\\Users\\me\\.local\\bin\\claude.exe' });
      insertProvider(seed, 'claude-wsl', 'cli', { type: 'cli', command: '/home/u/.local/bin/claude', wslDistro: 'Ubuntu' });
      insertProvider(seed, 'claude-ext', 'cli', { type: 'cli', command: 'claude.bat' });
    });
    expect(command(db, 'codex-app')).toBe('codex');
    expect(command(db, 'codex-npm')).toBe('codex');
    expect(command(db, 'claude-local')).toBe('claude');
    expect(command(db, 'claude-wsl')).toBe('claude');
    expect(command(db, 'claude-ext')).toBe('claude');
  });

  it('keeps the rest of the config and the WSL distro', () => {
    const db = upgrade((seed) => {
      insertProvider(seed, 'wsl', 'cli',
        { type: 'cli', command: '/usr/bin/codex', args: [], model: 'unknown', wslDistro: 'Ubuntu' });
    });
    const row = db.prepare("SELECT config_json FROM providers WHERE id = 'wsl'").get() as { config_json: string };
    expect(JSON.parse(row.config_json)).toEqual({
      type: 'cli', command: 'codex', args: [], model: 'unknown', wslDistro: 'Ubuntu',
    });
  });

  it('leaves other CLIs, look-alike names, non-CLI rows and malformed JSON alone', () => {
    const db = upgrade((seed) => {
      insertProvider(seed, 'gemini', 'cli', { type: 'cli', command: 'C:\\Tools\\gemini.cmd' });
      insertProvider(seed, 'lookalike', 'cli', { type: 'cli', command: 'C:\\Tools\\my-codex.exe' });
      insertProvider(seed, 'dir-only', 'cli', { type: 'cli', command: '/opt/codex/run' });
      insertProvider(seed, 'local', 'local', { type: 'local', baseUrl: 'http://localhost:11434', command: '/x/codex' });
      insertProvider(seed, 'malformed', 'cli', 'not JSON');
    });
    expect(command(db, 'gemini')).toBe('C:\\Tools\\gemini.cmd');
    expect(command(db, 'lookalike')).toBe('C:\\Tools\\my-codex.exe');
    expect(command(db, 'dir-only')).toBe('/opt/codex/run');
    expect(command(db, 'local')).toBe('/x/codex');
    expect(command(db, 'malformed')).toBe('not JSON');
  });

  it('reruns without changing anything', () => {
    const db = upgrade((seed) => {
      insertProvider(seed, 'codex', 'cli', { type: 'cli', command: 'codex' });
    });
    const migration = migrations.find((item) => item.id === '038-cli-command-name');
    expect(migration).toBeDefined();
    expect(() => db.exec(migration!.sql)).not.toThrow();
    expect(command(db, 'codex')).toBe('codex');
  });
});
