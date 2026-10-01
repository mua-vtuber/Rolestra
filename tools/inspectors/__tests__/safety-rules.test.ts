/**
 * 검사관 안전 룰 회귀 — R12-C2 T41.
 *
 * T41 triage 에서 네 룰을 고쳤다. 각 룰마다 두 갈래를 고정한다:
 *
 *   통과해야 하는 것  triage 가 false positive 로 판정해 걸러 낸 형태.
 *                     여기서 hit 가 다시 나오면 정밀화가 되돌아간 것이다.
 *   여전히 잡아야 하는 것
 *                     룰이 원래 지키려던 진짜 위반. 여기서 hit 가 사라지면
 *                     룰을 넓히다가 이빨을 뽑은 것이다.
 *
 * 두 갈래를 함께 두는 이유: 정밀화는 "덜 잡게" 만드는 변경이라, 통과 시험만
 * 있으면 룰을 통째로 `return []` 로 바꿔도 초록이 된다.
 */
import { describe, expect, it } from 'vitest';

import execShellString from '../exec-shell-string';
import migNonIdempotent from '../mig-non-idempotent';
import migNonForwardOnly from '../mig-non-forward-only';
import pathGuardBypass from '../path-guard-bypass';
import approvalBypass from '../approval-bypass';
import type { Hit, Inspector, ScannedFile } from '../types';

/** 경로만으로 분류를 정하는 walker 규칙을 그대로 흉내 낸다. */
function scanned(rel: string, source: string): ScannedFile {
  return {
    rel,
    abs: `/repo/${rel}`,
    source,
    isTest:
      rel.includes('/__tests__/') ||
      rel.endsWith('.test.ts') ||
      rel.endsWith('.test.tsx'),
    isMigration:
      rel.startsWith('src/main/database/migrations/') && /\d{3}-/.test(rel),
    isMainProcess: rel.startsWith('src/main/'),
    isRenderer: rel.startsWith('src/renderer/'),
    isPreload: rel.startsWith('src/preload/'),
    isShared: rel.startsWith('src/shared/'),
  };
}

function run(
  inspector: Inspector,
  rel: string,
  source: string,
): Hit[] {
  return inspector.perFile?.(scanned(rel, source)) ?? [];
}

// ── exec-shell-string ─────────────────────────────────────────────────

describe('exec-shell-string', () => {
  const FILE = 'src/main/database/database-manager.ts';

  it('better-sqlite3 의 db.exec 는 셸이 아니다 — 통과', () => {
    const source = `
import Database from 'better-sqlite3';
export function backup(db: Database.Database, targetPath: string): void {
  db.exec(\`VACUUM INTO '\${targetPath}'\`);
}
`;
    expect(run(execShellString, FILE, source)).toEqual([]);
  });

  it('RegExp.exec 도 셸이 아니다 — 통과', () => {
    const source = `
export function parseDrive(normalized: string): string | null {
  const drive = /^([A-Za-z]):(.*)$/.exec(normalized);
  return drive?.[1] ?? null;
}
`;
    expect(run(execShellString, 'src/main/providers/cli/cli-provider.ts', source))
      .toEqual([]);
  });

  it('child_process 를 안 들여온 파일은 셸을 실행할 수 없다 — 통과', () => {
    const source = `
const runner = { exec: (s: string) => s };
runner.exec('rm -rf /');
`;
    expect(run(execShellString, FILE, source)).toEqual([]);
  });

  it('child_process.exec 는 여전히 잡는다', () => {
    const source = `
import { exec } from 'node:child_process';
export function run(cmd: string): void {
  exec(cmd);
}
`;
    const hits = run(execShellString, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('child_process.exec');
  });

  it('별칭으로 들여온 exec 도 잡는다', () => {
    const source = `
import { exec as runShell } from 'child_process';
runShell('ls -al');
`;
    expect(run(execShellString, FILE, source)).toHaveLength(1);
  });

  it('namespace import 의 cp.execSync 도 잡는다', () => {
    const source = `
import * as cp from 'node:child_process';
cp.execSync('git status');
`;
    const hits = run(execShellString, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('child_process.execSync');
  });

  it('require 로 꺼낸 exec 도 잡는다', () => {
    const source = `
const { exec } = require('child_process');
exec('whoami');
`;
    expect(run(execShellString, FILE, source)).toHaveLength(1);
  });

  it('spawn + shell: true 는 여전히 잡는다', () => {
    const source = `
import { spawn } from 'node:child_process';
spawn('cmd.exe', ['/c', 'dir'], { shell: true });
`;
    const hits = run(execShellString, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('shell: true');
  });

  it('spawn + shell: false 는 통과', () => {
    const source = `
import { spawn } from 'node:child_process';
spawn('cmd.exe', ['/c', 'mklink'], { shell: false, windowsHide: true });
`;
    expect(run(execShellString, FILE, source)).toEqual([]);
  });
});

// ── mig-non-idempotent ────────────────────────────────────────────────

describe('mig-non-idempotent', () => {
  const FILE = 'src/main/database/migrations/030-example.ts';

  it('IF NOT EXISTS 없는 CREATE TABLE 은 통과 — migrator 가 1 회 실행을 보장한다', () => {
    const source = `
export const migration = {
  id: '030-example',
  sql: \`
CREATE TABLE example (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_example_created ON example(created_at);
\`,
};
`;
    expect(run(migNonIdempotent, FILE, source)).toEqual([]);
  });

  it('컬럼 DEFAULT 의 CURRENT_TIMESTAMP / datetime 은 통과 — INSERT 시각이다', () => {
    const source = `
export const migration = {
  id: '030-example',
  sql: \`
CREATE TABLE example (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  touched_at DATETIME DEFAULT (datetime('now'))
);
\`,
};
`;
    expect(run(migNonIdempotent, FILE, source)).toEqual([]);
  });

  it('INSERT 값의 datetime(now) 는 잡는다 — 실행 시각이 데이터에 남는다', () => {
    const source = `
export const migration = {
  id: '030-example',
  sql: \`
INSERT INTO example (id, created_at) VALUES ('seed', datetime('now'));
\`,
};
`;
    const hits = run(migNonIdempotent, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('비결정적');
  });

  it('random() 은 잡는다 — 실행할 때마다 값이 달라진다', () => {
    const source = `
export const migration = {
  id: '030-example',
  sql: \`
UPDATE example SET token = hex(randomblob(16));
INSERT INTO example (id) VALUES (random());
\`,
};
`;
    expect(run(migNonIdempotent, FILE, source)).toHaveLength(2);
  });

  it('주석 안 설명은 SQL 이 아니다 — 통과', () => {
    const source = `
export const migration = {
  id: '030-example',
  sql: \`
-- random() 을 쓰면 안 되는 이유는 아래와 같다.
CREATE TABLE example (id TEXT PRIMARY KEY);
\`,
};
`;
    expect(run(migNonIdempotent, FILE, source)).toEqual([]);
  });

  it('migration 이 아닌 파일은 검사하지 않는다', () => {
    const source = "const x = random();";
    expect(run(migNonIdempotent, 'src/main/foo.ts', source)).toEqual([]);
  });
});

// ── mig-non-forward-only ──────────────────────────────────────────────

describe('mig-non-forward-only', () => {
  const FILE = 'src/main/database/migrations/031-example.ts';

  it('SQLite 표 재구성 4 단계는 통과 — 데이터도 컬럼도 잃지 않는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
CREATE TABLE example_v2 (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('a','b','c'))
);
INSERT INTO example_v2 (id, kind) SELECT id, kind FROM example;
DROP TABLE example;
ALTER TABLE example_v2 RENAME TO example;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });

  it('같은 migration 이 다시 만드는 index 의 DROP 은 통과', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
CREATE TABLE example_v2 (id TEXT PRIMARY KEY);
INSERT INTO example_v2 (id) SELECT id FROM example;
DROP INDEX IF EXISTS idx_example_id;
DROP TABLE example;
ALTER TABLE example_v2 RENAME TO example;
CREATE INDEX idx_example_id ON example(id);
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });

  it('같은 migration 이 DROP 뒤에 같은 이름으로 다시 만드는 trigger 의 DROP 은 통과', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER example_insert_check;
CREATE TRIGGER example_insert_check BEFORE INSERT ON example BEGIN
  SELECT 1;
END;
DROP TRIGGER IF EXISTS example_update_check;
CREATE TRIGGER IF NOT EXISTS example_update_check BEFORE UPDATE ON example BEGIN
  SELECT 1;
END;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });

  it('다시 만들지 않는 trigger 의 DROP 은 잡는다 — trigger 가 그냥 사라진다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER example_insert_check;
\`,
};
`;
    const hits = run(migNonForwardOnly, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('DROP TRIGGER');
  });

  it('다른 이름으로 다시 만들거나 DROP 보다 먼저 만든 trigger 는 인정하지 않는다 — 잡는다', () => {
    const renamed = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER example_insert_check;
CREATE TRIGGER example_insert_check_v2 BEFORE INSERT ON example BEGIN
  SELECT 1;
END;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, renamed).map((h) => h.excerpt))
      .toEqual(['DROP TRIGGER example_insert_check;']);
    const createdFirst = `
export const migration = {
  id: '031-example',
  sql: \`
CREATE TRIGGER IF NOT EXISTS example_insert_check BEFORE INSERT ON example BEGIN
  SELECT 1;
END;
DROP TRIGGER example_insert_check;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, createdFirst)).toHaveLength(1);
  });

  it.each([
    ['-- CREATE TRIGGER example_insert_check BEFORE INSERT ON example BEGIN SELECT 1; END;'],
    ['/* CREATE TRIGGER example_insert_check BEFORE INSERT ON example BEGIN SELECT 1; END; */'],
    ['// CREATE TRIGGER example_insert_check BEFORE INSERT ON example BEGIN SELECT 1; END;'],
    ['/**\n * CREATE TRIGGER example_insert_check BEFORE INSERT ON example BEGIN SELECT 1; END;\n */'],
  ])('주석 안의 같은 이름 CREATE TRIGGER 는 다시 만든 것으로 치지 않는다 — 잡는다 (%s)', (comment) => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER example_insert_check;
${comment}
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source).map((h) => h.excerpt))
      .toEqual(['DROP TRIGGER example_insert_check;']);
  });

  it('짧은 블록 주석 뒤 같은 줄의 진짜 DROP 은 잡는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
/* cleanup */ DROP TABLE users;
\`,
};
`;
    const hits = run(migNonForwardOnly, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('DROP TABLE');
  });

  it('여러 줄 블록 주석 안의 CREATE TRIGGER 는 다시 만든 것으로 치지 않는다 — 잡는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER t1;
/*
CREATE TRIGGER t1 BEFORE INSERT ON example BEGIN SELECT 1; END;
*/
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source).map((h) => h.excerpt)).toEqual(['DROP TRIGGER t1;']);
  });

  it('여러 줄 블록 주석 안의 DROP 은 SQL 이 아니다 — 통과', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
/*
DROP TABLE legacy_thing;
DROP INDEX idx_legacy;
*/
-- DROP TRIGGER t1;
SELECT 1; -- DROP TABLE nothing
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });

  it('닫힌 블록 주석 뒤 같은 줄의 진짜 CREATE TRIGGER 는 다시 만든 것으로 친다 — 통과', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TRIGGER t1;
/* new rule */ CREATE TRIGGER t1 BEFORE INSERT ON example BEGIN
  SELECT 1;
END;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });

  it('주석 안의 CREATE INDEX 나 DROP 보다 먼저 만든 index 는 인정하지 않는다 — 잡는다', () => {
    const commented = `
export const migration = {
  id: '031-example',
  sql: \`
DROP INDEX idx_example_id;
-- CREATE INDEX idx_example_id ON example(id);
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, commented).map((h) => h.excerpt)).toEqual(['DROP INDEX idx_example_id;']);
    const createdFirst = `
export const migration = {
  id: '031-example',
  sql: \`
CREATE INDEX IF NOT EXISTS idx_example_id ON example(id);
DROP INDEX idx_example_id;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, createdFirst).map((h) => h.excerpt)).toEqual(['DROP INDEX idx_example_id;']);
  });

  it('RENAME 없는 맨 DROP TABLE 은 여전히 잡는다 — 표가 그냥 사라진다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TABLE legacy_thing;
\`,
};
`;
    const hits = run(migNonForwardOnly, FILE, source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('DROP TABLE');
  });

  it('RENAME 목적지가 다른 이름이면 재구성이 아니다 — 잡는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
CREATE TABLE other_v2 (id TEXT PRIMARY KEY);
INSERT INTO other_v2 (id) SELECT id FROM other;
DROP TABLE example;
ALTER TABLE other_v2 RENAME TO other;
\`,
};
`;
    const hits = run(migNonForwardOnly, FILE, source);
    expect(hits.map((h) => h.excerpt)).toContain('DROP TABLE example;');
  });

  it('CREATE 없이 RENAME 만 있으면 재구성으로 인정하지 않는다 — 잡는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DROP TABLE example;
ALTER TABLE something_else RENAME TO example;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toHaveLength(1);
  });

  it('ALTER TABLE ... DROP COLUMN 은 여전히 잡는다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
ALTER TABLE example DROP COLUMN legacy_field;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toHaveLength(1);
  });

  it('데이터 정리 DELETE 는 통과 — schema 폐기가 아니다', () => {
    const source = `
export const migration = {
  id: '031-example',
  sql: \`
DELETE FROM example WHERE created_at < 0;
\`,
};
`;
    expect(run(migNonForwardOnly, FILE, source)).toEqual([]);
  });
});

// ── path-guard-bypass ─────────────────────────────────────────────────

describe('path-guard-bypass', () => {
  it('R12-X 게이트 (ensureAccess) 를 참조하면 통과', () => {
    const source = `
import * as fs from 'node:fs';
export class Svc {
  constructor(private readonly ensureAccess: () => Promise<boolean>) {}
  async write(p: string, c: string): Promise<void> {
    if (!(await this.ensureAccess())) throw new Error('denied');
    fs.writeFileSync(p, c, 'utf-8');
  }
}
`;
    expect(run(pathGuardBypass, 'src/main/execution/execution-service.ts', source))
      .toEqual([]);
  });

  it('isPathWithin 을 참조하면 통과', () => {
    const source = `
import * as fs from 'node:fs';
import { isPathWithin } from '../files/path-within';
export function save(root: string, p: string, c: string): void {
  if (!isPathWithin(root, p)) throw new Error('outside');
  fs.writeFileSync(p, c, 'utf-8');
}
`;
    expect(run(pathGuardBypass, 'src/main/meetings/minutes.ts', source)).toEqual(
      [],
    );
  });

  it('workspaceRoot 봉인을 참조하면 통과', () => {
    const source = `
import * as fs from 'node:fs';
export class Applier {
  constructor(private readonly workspaceRoot: string) {}
  apply(p: string, c: string): void {
    fs.writeFileSync(p, c, 'utf-8');
  }
}
`;
    expect(run(pathGuardBypass, 'src/main/execution/patch-applier.ts', source))
      .toEqual([]);
  });

  it('게이트를 하나도 참조하지 않는 main 모듈의 write 는 여전히 잡는다', () => {
    const source = `
import * as fs from 'node:fs';
export function dump(p: string, c: string): void {
  fs.writeFileSync(p, c, 'utf-8');
}
`;
    const hits = run(pathGuardBypass, 'src/main/somewhere/dumper.ts', source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('봉인');
  });

  it('renderer 파일은 검사 대상이 아니다', () => {
    const source = `
import * as fs from 'node:fs';
fs.writeFileSync('/tmp/x', 'y', 'utf-8');
`;
    expect(run(pathGuardBypass, 'src/renderer/foo.ts', source)).toEqual([]);
  });
});

// ── approval-bypass ───────────────────────────────────────────────────

describe('approval-bypass', () => {
  it('허가된 writer 모듈 안 write 는 통과', () => {
    const source = `
import * as fs from 'node:fs';
fs.writeFileSync('/arena/consensus/x.md', 'y', 'utf-8');
`;
    for (const rel of [
      'src/main/consensus/consensus-folder-service.ts',
      'src/main/meetings/meeting-minutes-service.ts',
      'src/main/channels/channel-service.ts',
      'src/main/skills/project-skill-sync-service.ts',
      'src/main/log/structured-logger.ts',
      'src/main/remote/tls-util.ts',
    ]) {
      expect(run(approvalBypass, rel, source), rel).toEqual([]);
    }
  });

  it('B6: src/main/execution/ 는 허용 목록에서 빠졌다 (디렉토리가 더 이상 없다) — write 는 잡힌다', () => {
    const source = `
import * as fs from 'node:fs';
fs.writeFileSync('/arena/consensus/x.md', 'y', 'utf-8');
`;
    const hits = run(approvalBypass, 'src/main/execution/execution-service.ts', source);
    expect(hits).toHaveLength(1);
  });

  it('허가 목록 밖 main 모듈의 write 는 여전히 잡는다', () => {
    const source = `
import * as fs from 'node:fs';
export function sneak(p: string): void {
  fs.writeFileSync(p, 'payload', 'utf-8');
}
`;
    const hits = run(approvalBypass, 'src/main/autonomy/sneaky.ts', source);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain('ExecutionService');
  });

  it('시험 파일은 검사 대상이 아니다', () => {
    const source = `
import * as fs from 'node:fs';
fs.writeFileSync('/tmp/x', 'y', 'utf-8');
`;
    expect(
      run(approvalBypass, 'src/main/autonomy/__tests__/sneaky.test.ts', source),
    ).toEqual([]);
  });
});
