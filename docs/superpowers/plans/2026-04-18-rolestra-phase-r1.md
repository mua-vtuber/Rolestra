# Rolestra Phase R1 — 폴더 접근 근본 해결 (격리 스모크) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2 앱을 건드리지 않고 `tools/cli-smoke/` 격리 모듈에서 ArenaRoot + Project + CLI spawn + 3 CLI×3 모드 permission 매트릭스를 구현·검증하여, "폴더 접근 실패" 근본 원인을 재현 가능한 방식으로 해결한다.

**Architecture:** `tools/cli-smoke/`는 독립 TypeScript 모듈. Node.js에서 직접 실행 가능한 CLI(`npm run smoke:run`). v2 엔진과 의존성 없음. Vitest 단위 테스트 + 실제 CLI 호출 매트릭스 러너. 결과물은 `src/main/`으로 이식하기 전의 **검증된 참조 구현**.

**Tech Stack:** TypeScript (strict) / Node.js 20+ / Vitest / better-sqlite3 불필요(R1은 파일/프로세스만) / electron 불필요(R1은 non-Electron).

**참조:**
- Spec: `docs/superpowers/specs/2026-04-18-rolestra-design.md` §4.2.1 (resolveProjectPaths), §7.6 (CLI 매트릭스), §10 R1
- 레퍼런스 코드: `/mnt/d/Taniar/Documents/Git/Agestra/packages/core/src/cli-runner.ts`, `cli-worker/cli-builder.ts`

---

## File Structure

```
tools/cli-smoke/
├── package.json                     # 독립 scripts: smoke:run, smoke:test
├── tsconfig.json                    # strict, extends 루트
├── vitest.config.ts                 # include __tests__
├── README.md                        # 실행 가이드
├── src/
│   ├── types.ts                     # Project/ProjectPaths/PermissionMode/CliKind 등
│   ├── resolve-project-paths.ts     # 단일 경로 결정 함수 (spec §4.2.1)
│   ├── path-guard.ts                # isPathWithin + realpath 검증
│   ├── junction.ts                  # Windows mklink /J / POSIX ln -s
│   ├── arena-root.ts                # ArenaRootService
│   ├── project-service.ts           # new / external / imported 3종
│   ├── cli-spawn.ts                 # execFile 래퍼: cwd 강제 + env 병합 + Windows resolve
│   ├── permission-adapter.ts        # Claude/Codex/Gemini × auto/hybrid/approval/read-only
│   ├── smoke-runner.ts              # 매트릭스 러너 orchestration
│   └── index.ts                     # export 엔트리
├── __tests__/
│   ├── resolve-project-paths.test.ts
│   ├── path-guard.test.ts
│   ├── junction.test.ts
│   ├── arena-root.test.ts
│   ├── project-service.test.ts
│   ├── cli-spawn.test.ts
│   └── permission-adapter.test.ts
└── matrix-results/                  # .gitignore: 실행 결과 JSON
```

**프로젝트 루트 수정:**
- `package.json` scripts에 `"smoke:test": "vitest run --project cli-smoke"`, `"smoke:run": "tsx tools/cli-smoke/src/smoke-runner.ts"` 추가
- `vitest.config.ts`의 `include`에 `tools/cli-smoke/__tests__/**/*.test.ts` 추가 (또는 프로젝트 분리)
- `.gitignore`에 `tools/cli-smoke/matrix-results/` 추가

**산출물:**
- `docs/superpowers/specs/appendix-cli-matrix.md` (Task 13): 실제 실행 결과 매트릭스

---

## Task 0: tools/cli-smoke 스캐폴드

**Goal:** 독립 TypeScript 모듈 스캐폴드 구축, vitest에 추가, tsx로 실행 가능하게.

**Files:**
- Create: `tools/cli-smoke/package.json`
- Create: `tools/cli-smoke/tsconfig.json`
- Create: `tools/cli-smoke/README.md`
- Modify: `package.json` (root, scripts 추가)
- Modify: `vitest.config.ts` (include 확장)
- Modify: `.gitignore` (matrix-results 추가)

**Acceptance Criteria:**
- [ ] `npm run smoke:test`가 vitest로 cli-smoke 디렉토리 테스트만 실행
- [ ] `npx tsx tools/cli-smoke/src/index.ts` 실행 시 TypeScript strict mode 오류 없이 종료
- [ ] tsconfig가 루트 `tsconfig.json`을 extends
- [ ] README에 실행 가이드 존재

**Verify:** `npx tsx -e "console.log('ok')"` → `ok`, 이후 `npm run smoke:test` → `No test files found` (아직 테스트 없음, exit 1이어도 정상)

**Steps:**

- [ ] **Step 1: 의존성 확인**

루트에 `tsx`가 없으면 추가:
```bash
npm install --save-dev tsx
```

- [ ] **Step 2: tools/cli-smoke/package.json 작성**

```json
{
  "name": "@rolestra/cli-smoke",
  "private": true,
  "version": "0.0.1",
  "description": "Phase R1 isolated smoke tests for Rolestra CLI matrix",
  "type": "module",
  "scripts": {
    "run": "tsx src/smoke-runner.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^4.3.6"
  }
}
```

- [ ] **Step 3: tools/cli-smoke/tsconfig.json 작성**

```json
{
  "extends": "../../tsconfig.node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "__tests__/**/*.ts"]
}
```

- [ ] **Step 4: tools/cli-smoke/src/index.ts 최소 진입점**

```ts
export const version = '0.0.1';
```

- [ ] **Step 5: 루트 package.json 스크립트 추가**

`scripts` 섹션에 아래 2줄 추가:
```json
"smoke:test": "vitest run tools/cli-smoke",
"smoke:run": "tsx tools/cli-smoke/src/smoke-runner.ts"
```

- [ ] **Step 6: 루트 vitest.config.ts 수정**

`include`를 다음으로 변경:
```ts
include: [
  'src/**/__tests__/**/*.test.ts',
  'src/**/__tests__/**/*.test.tsx',
  'tools/cli-smoke/__tests__/**/*.test.ts',
],
```

- [ ] **Step 7: .gitignore 추가**

기존 `.gitignore`에 한 줄 추가:
```
tools/cli-smoke/matrix-results/
```

- [ ] **Step 8: README.md**

```markdown
# cli-smoke (Rolestra Phase R1)

격리된 CLI 권한·경로 매트릭스 검증 모듈. v2 엔진과 독립.

## 실행

```bash
npm run smoke:test    # 단위 테스트
npm run smoke:run     # 3 CLI × 3 모드 실제 매트릭스 실행
```

## 결과물

`matrix-results/YYYYMMDD-HHMMSS.json`에 각 시나리오 성공/실패 기록.
종합 매트릭스는 `docs/superpowers/specs/appendix-cli-matrix.md`.
```

- [ ] **Step 9: 스모크 테스트 실행 확인**

```bash
npm run smoke:test
```
Expected: `No test files found` 또는 exit 1. (아직 테스트 없음)

```bash
npx tsx tools/cli-smoke/src/index.ts
```
Expected: 에러 없이 종료.

- [ ] **Step 10: 커밋**

```bash
git add tools/cli-smoke/ package.json vitest.config.ts .gitignore
git commit -m "chore(rolestra): scaffold tools/cli-smoke for Phase R1 isolated smoke tests"
```

---

## Task 1: 공용 타입 정의

**Goal:** R1 모든 모듈이 공유할 타입 정의 단일 파일.

**Files:**
- Create: `tools/cli-smoke/src/types.ts`

**Acceptance Criteria:**
- [ ] `Project`, `ProjectPaths`, `PermissionMode`, `ProjectKind`, `CliKind`, `ArenaRootConfig` 타입 export
- [ ] zod 런타임 스키마도 함께 export (`ProjectSchema`, `PermissionModeSchema` 등)
- [ ] 모든 리터럴 유니온은 `as const` + `z.enum`으로 일관

**Verify:** `npx tsc --noEmit -p tools/cli-smoke/tsconfig.json` → exit 0

**Steps:**

- [ ] **Step 1: types.ts 작성**

```ts
import { z } from 'zod';

export const PermissionModeSchema = z.enum(['auto', 'hybrid', 'approval']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const ProjectKindSchema = z.enum(['new', 'external', 'imported']);
export type ProjectKind = z.infer<typeof ProjectKindSchema>;

export const CliKindSchema = z.enum(['claude', 'codex', 'gemini']);
export type CliKind = z.infer<typeof CliKindSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/, 'lowercase slug'),
  name: z.string().min(1),
  description: z.string().default(''),
  kind: ProjectKindSchema,
  externalLink: z.string().nullable().default(null),
  permissionMode: PermissionModeSchema,
  createdAt: z.number().int(),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface ProjectPaths {
  projectDir: string;
  metaDir: string;
  spawnCwd: string;
  externalRealPath?: string;
}

export interface ArenaRootConfig {
  root: string;
  consensusDir: string;
  projectsDir: string;
  dbDir: string;
  logsDir: string;
}

export interface SmokeScenarioResult {
  scenario: string;
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  os: NodeJS.Platform;
  started: string;
  finishedAt: string;
  success: boolean;
  observations: string[];
  stderr?: string;
  fileCreated?: string;
}
```

- [ ] **Step 2: 타입체크 실행**

```bash
npx tsc --noEmit -p tools/cli-smoke/tsconfig.json
```
Expected: exit 0, 에러 없음.

- [ ] **Step 3: 커밋**

```bash
git add tools/cli-smoke/src/types.ts
git commit -m "feat(rolestra): add shared types for cli-smoke (Project/Permission/Cli)"
```

---

## Task 2: resolveProjectPaths() 구현 + 단위 테스트

**Goal:** 스펙 §4.2.1의 단일 경로 결정 함수. slug 기반, id는 DB 전용.

**Files:**
- Create: `tools/cli-smoke/__tests__/resolve-project-paths.test.ts`
- Create: `tools/cli-smoke/src/resolve-project-paths.ts`

**Acceptance Criteria:**
- [ ] `new`/`imported`는 `spawnCwd === projectDir`
- [ ] `external`은 `spawnCwd === projectDir + '/link'`, `externalRealPath` 필드 포함
- [ ] arenaRoot, slug, project.kind만 받아서 결정 — 다른 상태 의존 없음

**Verify:** `npm run smoke:test -- resolve-project-paths` → 5 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트 작성 (TDD red)**

`tools/cli-smoke/__tests__/resolve-project-paths.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveProjectPaths } from '../src/resolve-project-paths';
import type { Project } from '../src/types';

const ARENA_ROOT = '/tmp/arena';
const baseProject: Project = {
  id: '00000000-0000-4000-8000-000000000000',
  slug: 'demo',
  name: 'Demo',
  description: '',
  kind: 'new',
  externalLink: null,
  permissionMode: 'hybrid',
  createdAt: 0,
};

describe('resolveProjectPaths', () => {
  it('new 프로젝트는 projectDir을 spawnCwd로 반환', () => {
    const p = resolveProjectPaths({ ...baseProject, kind: 'new' }, ARENA_ROOT);
    expect(p.projectDir).toBe(path.join(ARENA_ROOT, 'projects', 'demo'));
    expect(p.spawnCwd).toBe(p.projectDir);
    expect(p.externalRealPath).toBeUndefined();
  });

  it('imported 프로젝트도 projectDir을 spawnCwd로 반환', () => {
    const p = resolveProjectPaths({ ...baseProject, kind: 'imported' }, ARENA_ROOT);
    expect(p.spawnCwd).toBe(p.projectDir);
  });

  it('external 프로젝트는 link 경로를 spawnCwd로 반환', () => {
    const p = resolveProjectPaths(
      { ...baseProject, kind: 'external', externalLink: '/outside/real' },
      ARENA_ROOT,
    );
    expect(p.spawnCwd).toBe(path.join(p.projectDir, 'link'));
    expect(p.externalRealPath).toBe('/outside/real');
  });

  it('external인데 externalLink 없으면 throw', () => {
    expect(() =>
      resolveProjectPaths({ ...baseProject, kind: 'external', externalLink: null }, ARENA_ROOT),
    ).toThrow(/externalLink/);
  });

  it('metaDir은 항상 projectDir/.arena', () => {
    const p = resolveProjectPaths(baseProject, ARENA_ROOT);
    expect(p.metaDir).toBe(path.join(p.projectDir, '.arena'));
  });
});
```

- [ ] **Step 2: 테스트 실행 (fail 확인)**

```bash
npm run smoke:test -- resolve-project-paths
```
Expected: FAIL, `Cannot find module '../src/resolve-project-paths'`

- [ ] **Step 3: 최소 구현**

`tools/cli-smoke/src/resolve-project-paths.ts`:
```ts
import path from 'node:path';
import type { Project, ProjectPaths } from './types';

export function resolveProjectPaths(project: Project, arenaRoot: string): ProjectPaths {
  const projectDir = path.join(arenaRoot, 'projects', project.slug);
  const metaDir = path.join(projectDir, '.arena');

  if (project.kind === 'external') {
    if (!project.externalLink) {
      throw new Error(`Project ${project.slug}: externalLink required when kind=external`);
    }
    return {
      projectDir,
      metaDir,
      spawnCwd: path.join(projectDir, 'link'),
      externalRealPath: project.externalLink,
    };
  }

  return { projectDir, metaDir, spawnCwd: projectDir };
}
```

- [ ] **Step 4: 테스트 실행 (pass 확인)**

```bash
npm run smoke:test -- resolve-project-paths
```
Expected: PASS, 5 tests.

- [ ] **Step 5: 커밋**

```bash
git add tools/cli-smoke/src/resolve-project-paths.ts tools/cli-smoke/__tests__/resolve-project-paths.test.ts
git commit -m "feat(rolestra): resolveProjectPaths — single source for filesystem path (spec §4.2.1)"
```

---

## Task 3: PathGuard — isPathWithin + realpath 재검증

**Goal:** 스펙 §7.6.4의 path-guard 코어 함수. external symlink escape 탐지 포함.

**Files:**
- Create: `tools/cli-smoke/__tests__/path-guard.test.ts`
- Create: `tools/cli-smoke/src/path-guard.ts`

**Acceptance Criteria:**
- [ ] `isPathWithin(root, candidate)` — candidate가 root 하위면 true
- [ ] `..` traversal 차단
- [ ] realpath 해결 후 재검증 (symlink이 root 밖을 가리키면 false)
- [ ] Windows와 POSIX 경로 구분자 둘 다 처리

**Verify:** `npm run smoke:test -- path-guard` → 6 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트**

`tools/cli-smoke/__tests__/path-guard.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPathWithin } from '../src/path-guard';

let root: string;
let outside: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-pg-root-'));
  outside = mkdtempSync(path.join(tmpdir(), 'rolestra-pg-out-'));
  mkdirSync(path.join(root, 'inner'));
  writeFileSync(path.join(root, 'inner', 'file.txt'), 'hello');
  writeFileSync(path.join(outside, 'secret.txt'), 'leak');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('isPathWithin', () => {
  it('루트 하위 경로는 true', () => {
    expect(isPathWithin(root, path.join(root, 'inner', 'file.txt'))).toBe(true);
  });

  it('루트 자체는 true', () => {
    expect(isPathWithin(root, root)).toBe(true);
  });

  it('루트 밖 경로는 false', () => {
    expect(isPathWithin(root, path.join(outside, 'secret.txt'))).toBe(false);
  });

  it('.. traversal은 false', () => {
    expect(isPathWithin(root, path.join(root, '..', 'etc', 'passwd'))).toBe(false);
  });

  it('symlink이 root 밖을 가리키면 false (realpath 해결 후)', () => {
    if (process.platform === 'win32') {
      // Windows는 일반 사용자 symlink 권한이 없을 수 있으니 skip
      return;
    }
    const linkPath = path.join(root, 'escape-link');
    symlinkSync(outside, linkPath);
    expect(isPathWithin(root, path.join(linkPath, 'secret.txt'))).toBe(false);
  });

  it('존재하지 않는 경로도 루트 하위면 true (새 파일 생성 예상)', () => {
    expect(isPathWithin(root, path.join(root, 'new-file-not-yet.txt'))).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm run smoke:test -- path-guard
```
Expected: FAIL, module not found.

- [ ] **Step 3: 구현**

`tools/cli-smoke/src/path-guard.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';

/**
 * candidate가 root의 하위(혹은 root 자체)인지 realpath 기준으로 판정.
 * - traversal(..) 차단
 * - symlink 추적 후 재검증
 * - 존재하지 않는 경로는 존재하는 가장 가까운 조상의 realpath를 기준으로 조립
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);

  // 우선 문자열 상 관계부터 차단
  const rawRel = path.relative(normalizedRoot, normalizedCandidate);
  if (rawRel.startsWith('..') || path.isAbsolute(rawRel)) return false;

  // realpath 해결 (존재하지 않는 경로는 가장 가까운 조상을 찾음)
  const realRoot = fs.realpathSync(normalizedRoot);
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(normalizedCandidate);
  } catch {
    realCandidate = resolveNearestExistingAncestor(normalizedCandidate);
  }

  const rel = path.relative(realRoot, realCandidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function resolveNearestExistingAncestor(p: string): string {
  let current = p;
  while (current && current !== path.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      const remaining = path.relative(current, p);
      return path.join(real, remaining);
    } catch {
      current = path.dirname(current);
    }
  }
  return p;
}
```

- [ ] **Step 4: 테스트 pass 확인**

```bash
npm run smoke:test -- path-guard
```
Expected: 6 tests passed (symlink 테스트는 Windows에서 skip 가능).

- [ ] **Step 5: 커밋**

```bash
git add tools/cli-smoke/src/path-guard.ts tools/cli-smoke/__tests__/path-guard.test.ts
git commit -m "feat(rolestra): path-guard with realpath-based containment check (spec §7.6.4)"
```

---

## Task 4: Junction 유틸 (Windows/POSIX 통합)

**Goal:** external 프로젝트용 `link` 생성·삭제·realpath 검증. Windows는 `mklink /J`, POSIX는 `ln -s`.

**Files:**
- Create: `tools/cli-smoke/__tests__/junction.test.ts`
- Create: `tools/cli-smoke/src/junction.ts`

**Acceptance Criteria:**
- [ ] `createLink(linkPath, targetRealPath)` — 크로스 OS 분기
- [ ] `removeLink(linkPath)` — safe delete (파일이 아님 확인)
- [ ] `resolveLink(linkPath)` → realpath 반환
- [ ] Windows junction 생성 시 관리자 권한 불필요

**Verify:** `npm run smoke:test -- junction` → 3 tests passed (Windows 환경 기준)

**Steps:**

- [ ] **Step 1: 실패 테스트**

`tools/cli-smoke/__tests__/junction.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLink, removeLink, resolveLink } from '../src/junction';

let tmpRoot: string;
let target: string;
let linkPath: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'rolestra-jct-'));
  target = path.join(tmpRoot, 'target');
  mkdirSync(target);
  writeFileSync(path.join(target, 'marker.txt'), 'here');
  linkPath = path.join(tmpRoot, 'link');
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('junction', () => {
  it('createLink + resolveLink round-trip', async () => {
    await createLink(linkPath, target);
    const resolved = await resolveLink(linkPath);
    expect(resolved).toBe(target);
  });

  it('link 경유 파일 접근 가능', async () => {
    const marker = path.join(linkPath, 'marker.txt');
    expect(statSync(marker).isFile()).toBe(true);
  });

  it('removeLink 후 접근 불가', async () => {
    await removeLink(linkPath);
    expect(() => statSync(path.join(linkPath, 'marker.txt'))).toThrow();
  });
});
```

- [ ] **Step 2: 구현**

`tools/cli-smoke/src/junction.ts`:
```ts
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';

export async function createLink(linkPath: string, targetRealPath: string): Promise<void> {
  // 이미 존재하면 제거 후 재생성 (idempotent)
  try {
    await removeLink(linkPath);
  } catch {
    // ignore
  }

  if (process.platform === 'win32') {
    await runMklinkJunction(linkPath, targetRealPath);
    return;
  }
  await fs.symlink(targetRealPath, linkPath, 'dir');
}

export async function removeLink(linkPath: string): Promise<void> {
  // 존재 확인 (lstat로 심볼릭 링크 자체만 본다)
  try {
    const st = await fs.lstat(linkPath);
    if (!st.isSymbolicLink() && !st.isDirectory()) {
      throw new Error(`${linkPath} is neither symlink nor directory`);
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  // Windows junction은 rmdir로 제거 (내용물은 건드리지 않음)
  if (process.platform === 'win32') {
    await fs.rmdir(linkPath);
    return;
  }
  await fs.unlink(linkPath);
}

export async function resolveLink(linkPath: string): Promise<string> {
  return realpathSync(linkPath);
}

function runMklinkJunction(linkPath: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmd.exe', ['/c', 'mklink', '/J', linkPath, target], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stderrChunks: string[] = [];
    proc.stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf-8')));
    proc.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`mklink /J failed (exit ${code}): ${stderrChunks.join('')}`));
    });
    proc.on('error', reject);
  });
}
```

- [ ] **Step 3: 테스트 실행**

```bash
npm run smoke:test -- junction
```
Expected: PASS (WSL/Linux 또는 Windows 환경).

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/junction.ts tools/cli-smoke/__tests__/junction.test.ts
git commit -m "feat(rolestra): junction/symlink cross-OS helper for external projects"
```

---

## Task 5: ArenaRootService

**Goal:** ArenaRoot 초기화 + consensus/projects/db/logs 디렉토리 idempotent 생성.

**Files:**
- Create: `tools/cli-smoke/__tests__/arena-root.test.ts`
- Create: `tools/cli-smoke/src/arena-root.ts`

**Acceptance Criteria:**
- [ ] `initArenaRoot(rootPath)` 호출 시 4개 하위 디렉토리 존재 보장
- [ ] 재호출해도 idempotent
- [ ] `getArenaRootConfig(rootPath)` → 절대경로 ArenaRootConfig 반환
- [ ] 루트 경로가 파일이면 throw

**Verify:** `npm run smoke:test -- arena-root` → 4 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트**

`tools/cli-smoke/__tests__/arena-root.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot, getArenaRootConfig } from '../src/arena-root';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-ar-'));
  rmSync(root, { recursive: true, force: true });  // 미리 삭제, init이 만들어야 함
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('arena-root', () => {
  it('init이 4개 하위 디렉토리 생성', async () => {
    await initArenaRoot(root);
    for (const sub of ['consensus', 'projects', 'db', 'logs']) {
      expect(statSync(path.join(root, sub)).isDirectory()).toBe(true);
    }
  });

  it('init 재호출 idempotent', async () => {
    await initArenaRoot(root);
    await initArenaRoot(root);  // 두 번째 호출도 에러 없음
    expect(existsSync(path.join(root, 'consensus'))).toBe(true);
  });

  it('getConfig는 절대경로 반환', async () => {
    await initArenaRoot(root);
    const cfg = getArenaRootConfig(root);
    expect(path.isAbsolute(cfg.root)).toBe(true);
    expect(cfg.consensusDir).toBe(path.join(cfg.root, 'consensus'));
  });

  it('루트가 파일이면 throw', () => {
    writeFileSync(root, 'i am a file');
    return expect(initArenaRoot(root)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 구현**

`tools/cli-smoke/src/arena-root.ts`:
```ts
import fs from 'node:fs/promises';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { ArenaRootConfig } from './types';

const SUBDIRS = ['consensus', 'projects', 'db', 'logs'] as const;

export async function initArenaRoot(root: string): Promise<ArenaRootConfig> {
  const absRoot = path.resolve(root);
  if (existsSync(absRoot) && !statSync(absRoot).isDirectory()) {
    throw new Error(`ArenaRoot path exists but is not a directory: ${absRoot}`);
  }
  await fs.mkdir(absRoot, { recursive: true });
  for (const sub of SUBDIRS) {
    await fs.mkdir(path.join(absRoot, sub), { recursive: true });
  }
  return getArenaRootConfig(absRoot);
}

export function getArenaRootConfig(root: string): ArenaRootConfig {
  const absRoot = path.resolve(root);
  return {
    root: absRoot,
    consensusDir: path.join(absRoot, 'consensus'),
    projectsDir: path.join(absRoot, 'projects'),
    dbDir: path.join(absRoot, 'db'),
    logsDir: path.join(absRoot, 'logs'),
  };
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- arena-root
```
Expected: 4 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/arena-root.ts tools/cli-smoke/__tests__/arena-root.test.ts
git commit -m "feat(rolestra): ArenaRootService with idempotent subdir init"
```

---

## Task 6: ProjectService — new 프로젝트 생성

**Goal:** `kind='new'` 프로젝트 생성. 폴더 + `.arena/meta.json`.

**Files:**
- Create: `tools/cli-smoke/__tests__/project-service.test.ts`
- Create: `tools/cli-smoke/src/project-service.ts`

**Acceptance Criteria:**
- [ ] `createNewProject({ slug, name, description, permissionMode })` 호출 시 폴더 + meta.json 생성
- [ ] 이미 존재하는 slug면 throw
- [ ] meta.json에 id(UUID) / slug / kind='new' / permissionMode / createdAt 저장
- [ ] external에 `auto` 넘기면 throw (spec §7.3 external+auto 금지)

**Verify:** `npm run smoke:test -- project-service` (이 task에선 new만 테스트) → 3 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트 (new만)**

`tools/cli-smoke/__tests__/project-service.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot } from '../src/arena-root';
import { ProjectService } from '../src/project-service';

let root: string;
let svc: ProjectService;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'rolestra-ps-'));
  await initArenaRoot(root);
  svc = new ProjectService(root);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ProjectService.createNewProject', () => {
  it('폴더 + meta.json 생성', async () => {
    const p = await svc.createNewProject({
      slug: 'demo',
      name: 'Demo Project',
      description: '',
      permissionMode: 'hybrid',
    });
    const projDir = path.join(root, 'projects', 'demo');
    expect(statSync(projDir).isDirectory()).toBe(true);
    const meta = JSON.parse(readFileSync(path.join(projDir, '.arena', 'meta.json'), 'utf-8'));
    expect(meta.id).toBe(p.id);
    expect(meta.slug).toBe('demo');
    expect(meta.kind).toBe('new');
    expect(meta.permissionMode).toBe('hybrid');
  });

  it('중복 slug는 throw', async () => {
    await svc.createNewProject({ slug: 'dup', name: 'A', description: '', permissionMode: 'hybrid' });
    await expect(
      svc.createNewProject({ slug: 'dup', name: 'B', description: '', permissionMode: 'hybrid' }),
    ).rejects.toThrow(/already exists/);
  });

  it('잘못된 slug는 schema 검증으로 throw', async () => {
    await expect(
      svc.createNewProject({ slug: 'Invalid Slug!', name: 'X', description: '', permissionMode: 'hybrid' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 구현**

`tools/cli-smoke/src/project-service.ts`:
```ts
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getArenaRootConfig } from './arena-root';
import { ProjectSchema, type Project, type PermissionMode } from './types';

export interface CreateNewInput {
  slug: string;
  name: string;
  description: string;
  permissionMode: PermissionMode;
}

export class ProjectService {
  constructor(private readonly arenaRoot: string) {}

  async createNewProject(input: CreateNewInput): Promise<Project> {
    const cfg = getArenaRootConfig(this.arenaRoot);
    const projectDir = path.join(cfg.projectsDir, input.slug);
    if (existsSync(projectDir)) {
      throw new Error(`Project directory already exists: ${projectDir}`);
    }

    const project: Project = ProjectSchema.parse({
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      description: input.description,
      kind: 'new',
      externalLink: null,
      permissionMode: input.permissionMode,
      createdAt: Date.now(),
    });

    await fs.mkdir(path.join(projectDir, '.arena'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.arena', 'meta.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );
    return project;
  }
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- project-service
```
Expected: 3 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/project-service.ts tools/cli-smoke/__tests__/project-service.test.ts
git commit -m "feat(rolestra): ProjectService.createNewProject with meta.json + slug validation"
```

---

## Task 7: ProjectService — external/imported

**Goal:** external(junction + realpath 검증), imported(복사). external에 `auto` 금지.

**Files:**
- Modify: `tools/cli-smoke/__tests__/project-service.test.ts` (테스트 추가)
- Modify: `tools/cli-smoke/src/project-service.ts` (메서드 추가)

**Acceptance Criteria:**
- [ ] `linkExternal({ slug, externalPath, ..., permissionMode })` → external 프로젝트 생성 + junction
- [ ] `linkExternal`에 `permissionMode='auto'` 주면 throw
- [ ] `importProject({ slug, sourcePath, ... })` → 폴더 복사 + meta
- [ ] 두 메서드 모두 중복 slug 방어

**Verify:** `npm run smoke:test -- project-service` → 8 tests passed

**Steps:**

- [ ] **Step 1: 테스트 추가**

`project-service.test.ts` 하단에:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';

describe('ProjectService.linkExternal', () => {
  it('junction 생성 + meta의 externalLink = realpath', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rolestra-out-'));
    writeFileSync(path.join(outside, 'file.txt'), 'x');
    try {
      const p = await svc.linkExternal({
        slug: 'ext',
        name: 'Ext',
        description: '',
        permissionMode: 'hybrid',
        externalPath: outside,
      });
      expect(p.kind).toBe('external');
      expect(p.externalLink).toBe(realpathSync(outside));
      const linkReal = realpathSync(path.join(root, 'projects', 'ext', 'link'));
      expect(linkReal).toBe(realpathSync(outside));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('external + permissionMode=auto는 금지', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'rolestra-out2-'));
    try {
      await expect(
        svc.linkExternal({
          slug: 'auto-ext',
          name: 'X',
          description: '',
          permissionMode: 'auto',
          externalPath: outside,
        }),
      ).rejects.toThrow(/auto mode is not allowed/i);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('ProjectService.importProject', () => {
  it('폴더 복사 후 meta 생성', async () => {
    const src = mkdtempSync(path.join(tmpdir(), 'rolestra-src-'));
    mkdirSync(path.join(src, 'nested'));
    writeFileSync(path.join(src, 'nested', 'a.txt'), 'hi');
    try {
      const p = await svc.importProject({
        slug: 'imp',
        name: 'Imported',
        description: '',
        permissionMode: 'hybrid',
        sourcePath: src,
      });
      expect(p.kind).toBe('imported');
      expect(statSync(path.join(root, 'projects', 'imp', 'nested', 'a.txt')).isFile()).toBe(true);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 구현 추가**

`project-service.ts`에 메서드 + 보조 함수:
```ts
// import 추가
import { realpathSync } from 'node:fs';
import { createLink } from './junction';

// CreateNewInput 옆에 추가:
export interface LinkExternalInput extends CreateNewInput {
  externalPath: string;
}
export interface ImportProjectInput extends CreateNewInput {
  sourcePath: string;
}

// ProjectService 클래스 내부에 추가:
async linkExternal(input: LinkExternalInput): Promise<Project> {
  if (input.permissionMode === 'auto') {
    throw new Error('auto mode is not allowed for external projects (spec §7.3)');
  }
  const cfg = getArenaRootConfig(this.arenaRoot);
  const projectDir = path.join(cfg.projectsDir, input.slug);
  if (existsSync(projectDir)) {
    throw new Error(`Project directory already exists: ${projectDir}`);
  }

  const realExternal = realpathSync(path.resolve(input.externalPath));
  const project: Project = ProjectSchema.parse({
    id: randomUUID(),
    slug: input.slug,
    name: input.name,
    description: input.description,
    kind: 'external',
    externalLink: realExternal,
    permissionMode: input.permissionMode,
    createdAt: Date.now(),
  });

  await fs.mkdir(path.join(projectDir, '.arena'), { recursive: true });
  await createLink(path.join(projectDir, 'link'), realExternal);
  await fs.writeFile(
    path.join(projectDir, '.arena', 'meta.json'),
    JSON.stringify(project, null, 2),
    'utf-8',
  );
  return project;
}

async importProject(input: ImportProjectInput): Promise<Project> {
  const cfg = getArenaRootConfig(this.arenaRoot);
  const projectDir = path.join(cfg.projectsDir, input.slug);
  if (existsSync(projectDir)) {
    throw new Error(`Project directory already exists: ${projectDir}`);
  }
  await fs.cp(input.sourcePath, projectDir, { recursive: true, errorOnExist: false });

  const project: Project = ProjectSchema.parse({
    id: randomUUID(),
    slug: input.slug,
    name: input.name,
    description: input.description,
    kind: 'imported',
    externalLink: null,
    permissionMode: input.permissionMode,
    createdAt: Date.now(),
  });

  await fs.mkdir(path.join(projectDir, '.arena'), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, '.arena', 'meta.json'),
    JSON.stringify(project, null, 2),
    'utf-8',
  );
  return project;
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- project-service
```
Expected: 8 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/project-service.ts tools/cli-smoke/__tests__/project-service.test.ts
git commit -m "feat(rolestra): ProjectService linkExternal + importProject (spec §7.3)"
```

---

## Task 8: CliSpawn 래퍼 — cwd 강제 + env 병합

**Goal:** 모든 CLI 실행에 `cwd` 강제 + Windows resolve. v2 버그의 루트 원인을 **이 함수가 대체**함.

**Files:**
- Create: `tools/cli-smoke/__tests__/cli-spawn.test.ts`
- Create: `tools/cli-smoke/src/cli-spawn.ts`

**Acceptance Criteria:**
- [ ] `runCli({ command, args, cwd, env?, stdin?, timeout })` → `{ stdout, stderr, exitCode }`
- [ ] `cwd` 필수. 없으면 throw
- [ ] `cwd`가 존재·디렉토리 아니면 spawn 전 throw
- [ ] Windows에서 `.cmd`/`.bat`는 `cmd.exe /c` 경유
- [ ] env는 `process.env` + 호출자 env + Rolestra 고정값 순 병합
- [ ] stderr 실시간 캡처, 타임아웃 시 SIGTERM

**Verify:** `npm run smoke:test -- cli-spawn` → 5 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트 (실제 프로세스 사용)**

`tools/cli-smoke/__tests__/cli-spawn.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCli } from '../src/cli-spawn';

let cwd: string;

beforeAll(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'rolestra-cli-'));
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

describe('runCli', () => {
  it('cwd 미지정 시 throw', async () => {
    await expect(runCli({ command: 'node', args: ['-v'], cwd: undefined as unknown as string })).rejects.toThrow(/cwd required/);
  });

  it('존재하지 않는 cwd는 throw', async () => {
    await expect(
      runCli({ command: 'node', args: ['-v'], cwd: '/non/existent/path/xyz' }),
    ).rejects.toThrow(/cwd/);
  });

  it('node -v 실행 성공', async () => {
    const r = await runCli({ command: 'node', args: ['-v'], cwd });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^v\d+/);
  });

  it('cwd 내에서 pwd/cd 동작 확인', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
      cwd,
    });
    expect(stdout.trim()).toBe(path.resolve(cwd));
  });

  it('env 병합: 호출자 env가 Rolestra 고정값과 공존', async () => {
    const { stdout } = await runCli({
      command: 'node',
      args: ['-e', 'console.log(process.env.ROLESTRA_PROJECT_SLUG + "|" + process.env.MY_VAR)'],
      cwd,
      env: { MY_VAR: 'custom', ROLESTRA_PROJECT_SLUG: 'slug-x' },
    });
    expect(stdout.trim()).toBe('slug-x|custom');
  });
});
```

- [ ] **Step 2: 구현**

`tools/cli-smoke/src/cli-spawn.ts`:
```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface RunCliOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const DEFAULT_TIMEOUT = 5 * 60_000;  // 5분

export async function runCli(opts: RunCliOptions): Promise<RunCliResult> {
  if (!opts.cwd) {
    throw new Error('runCli: cwd required (Rolestra polic: CLI spawn only in project context)');
  }
  const resolvedCwd = path.resolve(opts.cwd);
  if (!existsSync(resolvedCwd)) {
    throw new Error(`runCli: cwd does not exist: ${resolvedCwd}`);
  }
  if (!statSync(resolvedCwd).isDirectory()) {
    throw new Error(`runCli: cwd is not a directory: ${resolvedCwd}`);
  }

  const { command, args } = resolveWindowsCommand(opts.command, opts.args);
  const env = { ...process.env, ...(opts.env ?? {}) };

  return new Promise<RunCliResult>((resolve, reject) => {
    const proc: ChildProcessWithoutNullStreams = spawn(command, args, {
      cwd: resolvedCwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const outChunks: string[] = [];
    const errChunks: string[] = [];
    proc.stdout.on('data', (c: Buffer) => outChunks.push(c.toString('utf-8')));
    proc.stderr.on('data', (c: Buffer) => errChunks.push(c.toString('utf-8')));

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3000);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ stdout: outChunks.join(''), stderr: errChunks.join(''), exitCode: code ?? 1 });
    });

    if (opts.stdin !== undefined) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }
  });
}

function resolveWindowsCommand(cmd: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command: cmd, args };
  const lower = cmd.toLowerCase();
  if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
    return { command: 'cmd.exe', args: ['/c', cmd, ...args.map(escapeWindowsArg)] };
  }
  if (lower.endsWith('.exe') || lower.endsWith('.com')) {
    return { command: cmd, args };
  }
  // bare name: cmd.exe로 PATHEXT 해석
  return { command: 'cmd.exe', args: ['/c', cmd, ...args.map(escapeWindowsArg)] };
}

function escapeWindowsArg(a: string): string {
  if (a.includes('%')) throw new Error(`Windows arg contains % (env expansion risk): ${a}`);
  if (!/[\s"&|<>^()!]/.test(a)) return a;
  return '"' + a.replace(/"/g, '""') + '"';
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- cli-spawn
```
Expected: 5 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/cli-spawn.ts tools/cli-smoke/__tests__/cli-spawn.test.ts
git commit -m "feat(rolestra): runCli wrapper enforcing cwd + safe Windows escape"
```

---

## Task 9: ClaudePermissionAdapter (+ 공통 인터페이스)

**Goal:** 스펙 §7.6.3 Claude 표 구현. `--allowedTools` 화이트리스트 기반.

**Files:**
- Create: `tools/cli-smoke/__tests__/permission-adapter.test.ts`
- Create: `tools/cli-smoke/src/permission-adapter.ts`

**Acceptance Criteria:**
- [ ] `CliPermissionAdapter` 인터페이스: `buildArgs(ctx)` + `buildReadOnlyArgs(ctx)`
- [ ] `ClaudePermissionAdapter`:
  - `auto`: `['--permission-mode', 'acceptEdits', '--allowedTools', 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch', '--add-dir', ctx.consensusPath]`
  - `hybrid`: `Bash` 제외 동일
  - `approval`: `['--allowedTools', 'Read,Glob,Grep,WebSearch,WebFetch', '--permission-mode', 'default', '--add-dir', ctx.consensusPath]`
- [ ] `ctx`: `{ cliKind, permissionMode, cwd, consensusPath, projectKind }`
- [ ] external + auto 조합은 throw (방어 계층 중복, 스펙 §7.3 합의)

**Verify:** `npm run smoke:test -- permission-adapter` (Claude 부분만) → 4 tests passed

**Steps:**

- [ ] **Step 1: 실패 테스트**

`tools/cli-smoke/__tests__/permission-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ClaudePermissionAdapter } from '../src/permission-adapter';
import type { CliKind, PermissionMode, ProjectKind } from '../src/types';

function ctx(over: Partial<{
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  cwd: string;
  consensusPath: string;
}> = {}) {
  return {
    cliKind: 'claude' as CliKind,
    permissionMode: 'hybrid' as PermissionMode,
    projectKind: 'new' as ProjectKind,
    cwd: '/tmp/proj',
    consensusPath: '/tmp/arena/consensus',
    ...over,
  };
}

describe('ClaudePermissionAdapter', () => {
  const a = new ClaudePermissionAdapter();

  it('auto: Bash 포함 전체 화이트리스트 + acceptEdits', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'auto' }));
    expect(args).toContain('--permission-mode');
    expect(args).toContain('acceptEdits');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toContain('Bash');
  });

  it('hybrid: Bash 제외된 화이트리스트', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'hybrid' }));
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).not.toContain('Bash');
    expect(args[idx + 1]).toContain('Edit');
  });

  it('approval: default mode + 최소 도구', () => {
    const args = a.buildArgs(ctx({ permissionMode: 'approval' }));
    expect(args).toContain('default');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).not.toContain('Edit');
    expect(args[idx + 1]).toContain('Read');
  });

  it('external + auto는 throw', () => {
    expect(() => a.buildArgs(ctx({ permissionMode: 'auto', projectKind: 'external' }))).toThrow(/external/i);
  });
});
```

- [ ] **Step 2: 구현**

`tools/cli-smoke/src/permission-adapter.ts`:
```ts
import type { CliKind, PermissionMode, ProjectKind } from './types';

export interface AdapterContext {
  cliKind: CliKind;
  permissionMode: PermissionMode;
  projectKind: ProjectKind;
  cwd: string;
  consensusPath: string;
}

export interface CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[];
  buildReadOnlyArgs(ctx: AdapterContext): string[];
}

function assertExternalNotAuto(ctx: AdapterContext): void {
  if (ctx.projectKind === 'external' && ctx.permissionMode === 'auto') {
    throw new Error('external project + auto mode is forbidden (spec §7.3)');
  }
}

const CLAUDE_AUTO_TOOLS = 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch';
const CLAUDE_HYBRID_TOOLS = 'Read,Glob,Grep,Edit,Write,WebSearch,WebFetch';
const CLAUDE_READONLY_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';

export class ClaudePermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':
        return [
          '--permission-mode', 'acceptEdits',
          '--allowedTools', CLAUDE_AUTO_TOOLS,
          '--add-dir', ctx.consensusPath,
        ];
      case 'hybrid':
        return [
          '--permission-mode', 'acceptEdits',
          '--allowedTools', CLAUDE_HYBRID_TOOLS,
          '--add-dir', ctx.consensusPath,
        ];
      case 'approval':
        return [
          '--allowedTools', CLAUDE_READONLY_TOOLS,
          '--permission-mode', 'default',
          '--add-dir', ctx.consensusPath,
        ];
    }
  }

  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return [
      '--allowedTools', CLAUDE_READONLY_TOOLS,
      '--permission-mode', 'default',
      '--add-dir', ctx.consensusPath,
    ];
  }
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- permission-adapter
```
Expected: 4 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/permission-adapter.ts tools/cli-smoke/__tests__/permission-adapter.test.ts
git commit -m "feat(rolestra): ClaudePermissionAdapter with allowedTools whitelist per mode"
```

---

## Task 10: CodexPermissionAdapter

**Goal:** 스펙 §7.6.3 Codex 표 구현. `--full-auto` 오용 금지.

**Files:**
- Modify: `tools/cli-smoke/__tests__/permission-adapter.test.ts` (테스트 추가)
- Modify: `tools/cli-smoke/src/permission-adapter.ts` (클래스 추가)

**Acceptance Criteria:**
- [ ] `auto`: `['exec', '-a', 'never', '--sandbox', 'danger-full-access', '-C', ctx.cwd, '--skip-git-repo-check', '-']`
- [ ] `hybrid`: `['exec', '--full-auto', '-C', ctx.cwd, '-']`
- [ ] `approval`: `['exec', '-a', 'on-failure', '--sandbox', 'workspace-write', '-C', ctx.cwd, '-']`
- [ ] `buildReadOnlyArgs`: `['exec', '-a', 'never', '--sandbox', 'read-only', '-C', ctx.cwd, '-']`
- [ ] external + auto 조합은 throw

**Verify:** `npm run smoke:test -- permission-adapter` → Claude 4 + Codex 4 = 8 tests passed

**Steps:**

- [ ] **Step 1: 테스트 추가**

`permission-adapter.test.ts` 하단:
```ts
import { CodexPermissionAdapter } from '../src/permission-adapter';

describe('CodexPermissionAdapter', () => {
  const a = new CodexPermissionAdapter();

  it('auto: danger-full-access sandbox', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'auto' }));
    expect(args).toEqual([
      'exec', '-a', 'never', '--sandbox', 'danger-full-access',
      '-C', '/tmp/proj', '--skip-git-repo-check', '-',
    ]);
  });

  it('hybrid: --full-auto alias', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'hybrid' }));
    expect(args).toEqual(['exec', '--full-auto', '-C', '/tmp/proj', '-']);
  });

  it('approval: on-failure workspace-write', () => {
    const args = a.buildArgs(ctx({ cliKind: 'codex', permissionMode: 'approval' }));
    expect(args).toEqual(['exec', '-a', 'on-failure', '--sandbox', 'workspace-write', '-C', '/tmp/proj', '-']);
  });

  it('read-only sandbox', () => {
    const args = a.buildReadOnlyArgs(ctx({ cliKind: 'codex' }));
    expect(args).toEqual(['exec', '-a', 'never', '--sandbox', 'read-only', '-C', '/tmp/proj', '-']);
  });
});
```

- [ ] **Step 2: 구현 추가**

`permission-adapter.ts`에 클래스 추가:
```ts
export class CodexPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':
        return ['exec', '-a', 'never', '--sandbox', 'danger-full-access', '-C', ctx.cwd, '--skip-git-repo-check', '-'];
      case 'hybrid':
        return ['exec', '--full-auto', '-C', ctx.cwd, '-'];
      case 'approval':
        return ['exec', '-a', 'on-failure', '--sandbox', 'workspace-write', '-C', ctx.cwd, '-'];
    }
  }
  buildReadOnlyArgs(ctx: AdapterContext): string[] {
    return ['exec', '-a', 'never', '--sandbox', 'read-only', '-C', ctx.cwd, '-'];
  }
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- permission-adapter
```
Expected: 8 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/permission-adapter.ts tools/cli-smoke/__tests__/permission-adapter.test.ts
git commit -m "feat(rolestra): CodexPermissionAdapter with correct -a/--sandbox per mode"
```

---

## Task 11: GeminiPermissionAdapter

**Goal:** 스펙 §7.6.3 Gemini 표. `auto_edit` 모드 포함.

**Files:**
- Modify: 같은 두 파일

**Acceptance Criteria:**
- [ ] `auto`: `['--approval-mode', 'yolo']`
- [ ] `hybrid`: `['--approval-mode', 'auto_edit']`
- [ ] `approval`: `['--approval-mode', 'default']`
- [ ] `buildReadOnlyArgs`: `['--approval-mode', 'default']` (+ 시스템 프롬프트 역할은 상위 계층)
- [ ] external + auto 조합은 throw

**Verify:** `npm run smoke:test -- permission-adapter` → 8 + 4 = 12 tests passed

**Steps:**

- [ ] **Step 1: 테스트 추가**

```ts
import { GeminiPermissionAdapter } from '../src/permission-adapter';

describe('GeminiPermissionAdapter', () => {
  const a = new GeminiPermissionAdapter();

  it('auto: yolo', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'auto' })))
      .toEqual(['--approval-mode', 'yolo']);
  });

  it('hybrid: auto_edit', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'hybrid' })))
      .toEqual(['--approval-mode', 'auto_edit']);
  });

  it('approval: default', () => {
    expect(a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'approval' })))
      .toEqual(['--approval-mode', 'default']);
  });

  it('external + auto는 throw', () => {
    expect(() => a.buildArgs(ctx({ cliKind: 'gemini', permissionMode: 'auto', projectKind: 'external' })))
      .toThrow(/external/i);
  });
});
```

- [ ] **Step 2: 구현 추가**

```ts
export class GeminiPermissionAdapter implements CliPermissionAdapter {
  buildArgs(ctx: AdapterContext): string[] {
    assertExternalNotAuto(ctx);
    switch (ctx.permissionMode) {
      case 'auto':    return ['--approval-mode', 'yolo'];
      case 'hybrid':  return ['--approval-mode', 'auto_edit'];
      case 'approval': return ['--approval-mode', 'default'];
    }
  }
  buildReadOnlyArgs(_ctx: AdapterContext): string[] {
    return ['--approval-mode', 'default'];
  }
}
```

- [ ] **Step 3: 테스트 pass**

```bash
npm run smoke:test -- permission-adapter
```
Expected: 12 tests passed.

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/src/permission-adapter.ts tools/cli-smoke/__tests__/permission-adapter.test.ts
git commit -m "feat(rolestra): GeminiPermissionAdapter with yolo/auto_edit/default"
```

---

## Task 12: Smoke Matrix Runner (실제 CLI orchestration)

**Goal:** 3 CLI × 3 모드 × (new/external) = 18 시나리오(+ read-only 6) 자동 실행. 결과 JSON 기록.

**Files:**
- Create: `tools/cli-smoke/src/smoke-runner.ts`

**Acceptance Criteria:**
- [ ] 각 시나리오:
  1. ArenaRoot 임시 디렉토리에 초기화
  2. 프로젝트 생성 (new 또는 external)
  3. 해당 CLI × permissionMode 매트릭스의 args 계산
  4. "프로젝트 내에 marker.txt 파일을 쓰고 내용에 'OK'를 기록" 프롬프트 전달
  5. spawn, 결과 수집
  6. external 케이스는 spawn 직전 `realpathSync(link)` 검증 포함
- [ ] CLI가 없으면 해당 시나리오 skip (stderr에 "not installed")
- [ ] 결과를 `matrix-results/YYYYMMDD-HHMMSS.json`으로 저장
- [ ] stdout에 요약 표(성공/실패/skip 카운트)

**Verify:** `npm run smoke:run` → exit 0 (실패 시나리오 있어도 러너 자체는 종료 0), `matrix-results/*.json` 생성 확인

**Steps:**

- [ ] **Step 1: Runner 스캐폴드**

`tools/cli-smoke/src/smoke-runner.ts`:
```ts
import fs from 'node:fs/promises';
import { realpathSync, mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initArenaRoot } from './arena-root';
import { ProjectService } from './project-service';
import { runCli } from './cli-spawn';
import {
  ClaudePermissionAdapter, CodexPermissionAdapter, GeminiPermissionAdapter,
  type CliPermissionAdapter, type AdapterContext,
} from './permission-adapter';
import { resolveProjectPaths } from './resolve-project-paths';
import type { CliKind, PermissionMode, ProjectKind, SmokeScenarioResult } from './types';

const CLI_COMMANDS: Record<CliKind, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

const ADAPTERS: Record<CliKind, CliPermissionAdapter> = {
  claude: new ClaudePermissionAdapter(),
  codex: new CodexPermissionAdapter(),
  gemini: new GeminiPermissionAdapter(),
};

const PROMPT = 'Create a file "marker.txt" in the current working directory with the exact content "OK" (no newline). Do not create any other file.';

async function detectCli(cli: CliKind): Promise<boolean> {
  try {
    const r = await runCli({ command: CLI_COMMANDS[cli], args: ['--version'], cwd: tmpdir(), timeoutMs: 10_000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

async function runScenario(
  cli: CliKind,
  mode: PermissionMode,
  kind: ProjectKind,
  arenaRoot: string,
  externalSrc?: string,
): Promise<SmokeScenarioResult> {
  const started = new Date().toISOString();
  const scenarioId = `${cli}-${mode}-${kind}`;
  const observations: string[] = [];
  try {
    const svc = new ProjectService(arenaRoot);
    let project;
    if (kind === 'external') {
      if (mode === 'auto') {
        return {
          scenario: scenarioId, cliKind: cli, permissionMode: mode, projectKind: kind,
          os: process.platform, started, finishedAt: new Date().toISOString(),
          success: true,
          observations: ['expected-reject: external + auto is forbidden by design'],
        };
      }
      project = await svc.linkExternal({
        slug: scenarioId, name: scenarioId, description: '',
        permissionMode: mode, externalPath: externalSrc!,
      });
    } else {
      project = await svc.createNewProject({
        slug: scenarioId, name: scenarioId, description: '', permissionMode: mode,
      });
    }

    const paths = resolveProjectPaths(project, arenaRoot);
    const consensusPath = path.join(arenaRoot, 'consensus');

    // external TOCTOU 재검증
    if (kind === 'external') {
      const realLink = realpathSync(paths.spawnCwd);
      if (realLink !== project.externalLink) {
        throw new Error(`TOCTOU: link real=${realLink}, meta=${project.externalLink}`);
      }
      observations.push(`TOCTOU check passed: ${realLink}`);
    }

    const adapter = ADAPTERS[cli];
    const adapterCtx: AdapterContext = {
      cliKind: cli, permissionMode: mode, projectKind: kind,
      cwd: paths.spawnCwd, consensusPath,
    };
    const args = adapter.buildArgs(adapterCtx);

    // CLI별 프롬프트 전달 방식 (Claude: stdin-json, Codex: stdin, Gemini: -p)
    let cliArgs = args;
    let stdin: string | undefined;
    if (cli === 'claude') {
      cliArgs = [...args, '-p', PROMPT, '--output-format', 'text'];
    } else if (cli === 'codex') {
      stdin = PROMPT;
    } else if (cli === 'gemini') {
      cliArgs = [...args, '-p', PROMPT];
    }

    observations.push(`spawn: ${CLI_COMMANDS[cli]} ${cliArgs.join(' ')}`);
    const r = await runCli({
      command: CLI_COMMANDS[cli], args: cliArgs, cwd: paths.spawnCwd, stdin,
      timeoutMs: 90_000,
    });
    observations.push(`exit=${r.exitCode} stdout-len=${r.stdout.length} stderr-len=${r.stderr.length}`);

    const markerPath = path.join(paths.spawnCwd, 'marker.txt');
    const created = existsSync(markerPath);
    const content = created ? readFileSync(markerPath, 'utf-8') : null;
    const success = created && content?.trim() === 'OK';

    return {
      scenario: scenarioId, cliKind: cli, permissionMode: mode, projectKind: kind,
      os: process.platform, started, finishedAt: new Date().toISOString(),
      success, observations, stderr: r.stderr.slice(0, 2000),
      fileCreated: created ? markerPath : undefined,
    };
  } catch (err) {
    return {
      scenario: scenarioId, cliKind: cli, permissionMode: mode, projectKind: kind,
      os: process.platform, started, finishedAt: new Date().toISOString(),
      success: false, observations: [...observations, `error: ${(err as Error).message}`],
    };
  }
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(process.cwd(), 'tools/cli-smoke/matrix-results');
  await fs.mkdir(resultsDir, { recursive: true });

  const arenaRoot = mkdtempSync(path.join(tmpdir(), 'rolestra-arena-'));
  await initArenaRoot(arenaRoot);

  // external 소스: arenaRoot 밖에 임시 폴더
  const externalSrc = mkdtempSync(path.join(tmpdir(), 'rolestra-extsrc-'));
  writeFileSync(path.join(externalSrc, '.gitkeep'), '');

  const clis: CliKind[] = ['claude', 'codex', 'gemini'];
  const modes: PermissionMode[] = ['auto', 'hybrid', 'approval'];
  const kinds: ProjectKind[] = ['new', 'external'];

  const results: SmokeScenarioResult[] = [];

  for (const cli of clis) {
    const available = await detectCli(cli);
    if (!available) {
      console.log(`[skip] ${cli} not installed`);
      for (const m of modes) for (const k of kinds) {
        results.push({
          scenario: `${cli}-${m}-${k}`, cliKind: cli, permissionMode: m, projectKind: k,
          os: process.platform, started: new Date().toISOString(), finishedAt: new Date().toISOString(),
          success: false, observations: ['skipped: CLI not installed'],
        });
      }
      continue;
    }
    for (const mode of modes) {
      for (const kind of kinds) {
        process.stdout.write(`[run] ${cli}/${mode}/${kind} ... `);
        const r = await runScenario(cli, mode, kind, arenaRoot, externalSrc);
        results.push(r);
        console.log(r.success ? 'OK' : 'FAIL');
      }
    }
  }

  const outPath = path.join(resultsDir, `${timestamp}.json`);
  await fs.writeFile(outPath, JSON.stringify(results, null, 2));

  const ok = results.filter(r => r.success).length;
  const fail = results.filter(r => !r.success).length;
  console.log(`\nSummary: ${ok} ok / ${fail} fail / total ${results.length}`);
  console.log(`Results: ${outPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 빌드 체크**

```bash
npx tsc --noEmit -p tools/cli-smoke/tsconfig.json
```
Expected: exit 0.

- [ ] **Step 3: 커밋**

```bash
git add tools/cli-smoke/src/smoke-runner.ts
git commit -m "feat(rolestra): smoke matrix runner (3 CLI x 3 modes x new/external)"
```

---

## Task 13: 스모크 매트릭스 실행 + appendix-cli-matrix.md 생성

**Goal:** 실제 로컬 환경에서 러너 실행 → 결과 JSON → 사람이 읽는 appendix 마크다운으로 번역.

**Files:**
- Create: `docs/superpowers/specs/appendix-cli-matrix.md`
- Modify: `docs/superpowers/specs/2026-04-18-rolestra-design.md` (§15 참고에 appendix 링크 추가)

**Acceptance Criteria:**
- [ ] `npm run smoke:run` 실행 → `tools/cli-smoke/matrix-results/*.json` 생성
- [ ] `appendix-cli-matrix.md`에 각 CLI/모드/kind 조합의 결과 표 + 관측된 특이사항 기록
- [ ] 설치 안 된 CLI는 `[skipped]` 명시
- [ ] Rolestra 스펙 §15 "참고 자료"에 appendix 링크 추가

**Verify:** `cat docs/superpowers/specs/appendix-cli-matrix.md` → 매트릭스 표 존재

**Steps:**

- [ ] **Step 1: 러너 실행**

```bash
npm run smoke:run
```
Expected: `matrix-results/<timestamp>.json` 생성, 콘솔에 요약 출력.

- [ ] **Step 2: 결과 분석**

최신 결과 파일 경로 확인:
```bash
ls -t tools/cli-smoke/matrix-results/ | head -1
```

해당 JSON의 각 `result` 항목에서 `success`, `observations`, `stderr` 확인.

- [ ] **Step 3: appendix-cli-matrix.md 작성**

다음 템플릿으로 `docs/superpowers/specs/appendix-cli-matrix.md` 생성. 실제 관측 값으로 채움:

```markdown
# Appendix — CLI 권한·cwd 매트릭스 (Phase R1 스모크 결과)

**실행 환경**: (호스트 OS) / Node <버전> / 날짜 <YYYY-MM-DD>
**러너**: `npm run smoke:run`
**원본 JSON**: `tools/cli-smoke/matrix-results/<timestamp>.json`

## 매트릭스

| CLI | Mode | Kind | 결과 | 특이사항 |
|-----|------|------|------|----------|
| claude | auto | new | ✅/❌/⏭️ | <관측> |
| claude | auto | external | `expected-reject` | external+auto 금지 디자인 |
| claude | hybrid | new | ✅/❌ | |
| claude | hybrid | external | ✅/❌ | TOCTOU 재검증 결과 |
| claude | approval | new | ✅/❌ | |
| ... |

(전부 18+ 행)

## CLI 미설치로 skip된 경우

- gemini: (예시) not installed

## 결론

- 3 CLI 모두 `auto`/`hybrid` 모드로 marker.txt 생성 가능: <결론>
- `approval` 모드의 기대 동작(prompt 발생으로 인한 timeout/실패)은 별도로 확인 필요: <결론>
- external + TOCTOU 재검증 흐름 성공: <결론>

이 결과는 Rolestra §7.6.3 CLI 플래그 매트릭스의 정확성 근거로 사용된다.
```

- [ ] **Step 4: 스펙 §15에 링크 추가**

`docs/superpowers/specs/2026-04-18-rolestra-design.md`의 §15 참고 자료에 한 줄 추가:
```markdown
- 실측 매트릭스 (Phase R1): `docs/superpowers/specs/appendix-cli-matrix.md`
```

- [ ] **Step 5: 커밋**

```bash
git add docs/superpowers/specs/appendix-cli-matrix.md docs/superpowers/specs/2026-04-18-rolestra-design.md
git commit -m "docs(rolestra): Phase R1 smoke matrix results as appendix"
```

---

## Task 14: Phase R1 종료 확인 + R2 진입 체크리스트

**Goal:** R1 모든 acceptance criteria 통과 선언, 린트·타입체크 전부 통과, R2 진입 가드.

**Files:**
- Modify: `tools/cli-smoke/README.md` (완료 status 섹션 추가)

**Acceptance Criteria:**
- [ ] `npm run smoke:test` → 모든 단위 테스트 pass
- [ ] `npm run typecheck` → exit 0
- [ ] `npm run lint` → exit 0
- [ ] `npm run smoke:run` → 최소 1 CLI × 2 모드가 success (전체 skip 아님)
- [ ] `appendix-cli-matrix.md` 존재하고 결과 기록됨
- [ ] README에 Phase R1 완료 status + R2 진입 조건 체크리스트 작성

**Verify:** 위 4개 명령 전부 exit 0

**Steps:**

- [ ] **Step 1: 전체 테스트·타입·린트**

```bash
npm run smoke:test
npm run typecheck
npm run lint
```
전부 exit 0.

- [ ] **Step 2: 러너 재실행하여 현재 환경 최종 매트릭스 확보**

```bash
npm run smoke:run
```

실패가 "CLI 미설치" 외 이유면 그 Task로 되돌아가 수정.

- [ ] **Step 3: README 업데이트**

`tools/cli-smoke/README.md` 하단에 추가:
```markdown
## Phase R1 Status

- [x] Task 0 ~ 14 완료
- [x] 단위 테스트 전체 통과
- [x] 매트릭스 러너 1회 이상 성공 (`matrix-results/` 참조)
- [x] `docs/superpowers/specs/appendix-cli-matrix.md` 기록

### R2 진입 체크리스트

R2("v3 DB 스키마 + Main 레이어 + IPC")로 넘어가기 전:

- [ ] 앞 체크박스 전부 ✓
- [ ] spec §7.6 매트릭스와 실측 결과의 괴리가 있으면 spec 개정 커밋 완료
- [ ] external + auto 거부 동작 관측 기록 존재
- [ ] TOCTOU 재검증 동작 관측 기록 존재
```

- [ ] **Step 4: 커밋**

```bash
git add tools/cli-smoke/README.md
git commit -m "chore(rolestra): Phase R1 complete — smoke matrix validated"
```

- [ ] **Step 5: R2 plan 작성 준비**

다음 세션에서 `writing-plans` 스킬을 다시 invoke하여 R2 plan(`docs/superpowers/plans/2026-04-18-rolestra-phase-r2.md`)을 작성한다. 이 파일이 생성되면 R1 plan은 **완료** 표시.

---

## Self-Review (plan 작성자 체크)

### 1. Spec coverage (§10 R1의 각 요구사항 → task 매핑)

| Spec R1 요구사항 | Task |
|------------------|------|
| `tools/cli-smoke/` 격리 모듈 | Task 0 |
| resolveProjectPaths() 단일 경로 결정 | Task 2 |
| ArenaRoot 초기화, consensus 준비 | Task 5 |
| 최소 ProjectService (new/external/imported) | Task 6, 7 |
| CLI process `cwd` 추가 (모든 spawn) | Task 8 |
| PermissionAdapter 재작성 (3 CLI × 3 모드) | Task 9, 10, 11 |
| path-guard 단순화 | Task 3 |
| Windows junction / POSIX symlink | Task 4 |
| external TOCTOU 재검증 | Task 7 (생성 시), Task 12 (spawn 직전) |
| external + auto 금지 | Task 7 (서비스), Task 9/10/11 (어댑터) |
| 스모크 매트릭스 러너 | Task 12 |
| appendix-cli-matrix.md | Task 13 |
| 종료 조건: 3 CLI × 3 모드 × OS | Task 13, 14 |

누락 없음. ✅

### 2. Placeholder scan

- "TBD"/"TODO"/"implement later" 사용 없음.
- "Similar to Task N" 없음 (모든 코드 전문 전재).
- 모든 파일 경로 exact.
- 모든 테스트·구현 step에 전체 코드 블록 포함.

### 3. Type consistency

- `Project`/`ProjectPaths`/`AdapterContext`/`RunCliOptions` 등 Task 1 정의 → Task 2~12에서 동일 이름·시그니처로 사용.
- `PermissionMode` 리터럴 `'auto'|'hybrid'|'approval'` 전체에서 일관.
- `CliKind` `'claude'|'codex'|'gemini'` 전체 일관.
- 어댑터 메서드 `buildArgs`/`buildReadOnlyArgs` 3 CLI 어댑터 전부 동일.

## 참고

이 plan은 **Rolestra Phase R1만** 다룬다. R2 이후 Phase는 R1 완료 후 각각 별도 plan 문서로 작성된다 (원칙: Phase 간 의존 순차, 각 Phase = 한 plan 파일). 이는 spec §10의 Phase 분할과 1:1 대응된다.
