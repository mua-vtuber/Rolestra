# Rolestra — 메신저 오피스 설계 문서

> **프로젝트명**: Rolestra (Role + Orchestra — 역할들의 합주)
> **작성일**: 2026-04-18
> **상태**: Draft (브레인스토밍 완료, 사용자 검토 전)
> **이전 프로젝트**: AI Chat Arena v2 (`docs/설계-문서.md`) — 전통적 챗봇 UI, UI 메타포/폴더 접근 실패로 방치
> **목표**: "1인회사 사무실" 메타포의 메신저 UX로 완전 재출발 + 폴더 접근 실패 근본 해결

---

## 1. 배경과 문제 정의

### 1.1 기존 AI Chat Arena v2의 상태 (Rolestra의 전신)

- Phase 0 ~ Phase G까지 엔진 레이어 거의 완성: SSM 12상태, Provider(API/CLI/Local), Memory(FTS+임베딩+반성), ExecutionService, Audit Log, Remote Access, Deep Debate, CLI 권한 인터셉트.
- 287개 통합 테스트 통과, 엔진은 검증됨.
- 그러나 **작업용으로 사용 불가** 상태로 방치됨. 사용자 사용 중단.

### 1.2 방치된 근본 원인 — 기술 진단

UI 문제가 아닌 **프로세스 설정 문제**로 판명됨:

**원인 1. CLI `cwd` 미설정 (치명적)**
- `src/main/providers/cli/cli-process.ts`의 `execFile()` 호출 시 `cwd` 옵션이 없음.
- 결과: CLI가 Electron 앱 실행 경로에서 작동. 프로젝트 폴더 밖에서 도는 상태.
- 비교: Agestra는 `cwd: workingDir` 명시, Codex는 추가로 `-C cwd` 플래그.

**원인 2. 자동승인 플래그 누락 / 오용 (UX 치명적)**

| CLI | Arena v2 worker args | 플래그 의미 (실제) | 자동 작동에 필요한 것 |
|-----|----------------------|----------------------|------------------------|
| Claude Code | `--add-dir`만 | permission-mode 기본 = ask → 매 작업 prompt | `--permission-mode acceptEdits`(쓰기 자동) 또는 무인 전용 `--dangerously-skip-permissions`(전체 bypass) |
| Codex | `[]` | (기본) interactive 승인 | `--dangerously-bypass-approvals-and-sandbox` 또는 `-a never --sandbox danger-full-access` (주의: `--full-auto`는 `-a on-request --sandbox workspace-write` alias로, shell/network가 여전히 on-request라 non-interactive exec에서 멈춤) |
| Gemini | `[]` | (기본) 매번 prompt | `--approval-mode auto_edit`(편집 자동) 또는 `--approval-mode yolo`(전체 자동) |

즉, Codex/Gemini는 CLI 권한이 아예 걸려있지 않고 시스템 프롬프트로만 "쓸 수 있다"고 알려주는 허구 상태였음. Claude Code는 사전 허가만 되고 매 작업마다 권한 prompt가 떠서 자동화 불가. 각 CLI는 "자동승인" 개념이 **단일 플래그가 아닌** `(approval × sandbox)` 2축이며, 값 선택에 따라 위험 수준과 실제 동작이 크게 달라짐 — 상세 매트릭스는 §7.6.

**원인 3. UI 메타포 부적합 (사용성)**
- 전통적 챗봇 UI (ChatView 단일 세션, Sidebar 대화목록)는 "여러 AI와 협업"이라는 제품 특성과 맞지 않음.
- "1인회사 사무실" 메타포가 사용자의 업무 감각과 더 일치.

### 1.3 Rolestra의 방향

1. **UI 전면 재설계** — Renderer 전체를 메신저 오피스 UX로 재작성.
2. **폴더 접근 근본 해결** — `cwd` + 자동승인 플래그 + path-guard 삼중 방어.
3. **엔진은 이식** — AI Chat Arena v2의 검증된 Main 레이어를 재사용, 필요한 부분만 확장.
4. **DB 재초기화** — 기존 v2 데이터가 사용 안 됐으므로 마이그레이션 체인 재작성.
5. **브랜드 리셋** — "AI Chat Arena"의 격투장 뉘앙스 탈피. Rolestra는 역할·협업·합주를 상징.

---

## 2. 목표와 비목표

### 목표
- (G1) 사용자가 실제 작업용으로 안정적으로 쓸 수 있는 상태.
- (G2) 메신저 UI + 사무실 대시보드로 "1인회사" 메타포 구현.
- (G3) AI별 프로필(이름/역할/성격/전문/아바타) 세분화.
- (G4) 프로젝트 > 채널 2계층 구조로 잡담과 업무 공존.
- (G5) 3종 CLI(Claude Code/Codex/Gemini) 모두에서 자동승인 모드로 작업 가능.
- (G6) 외부 프로젝트 폴더를 junction/symlink로 연결 가능 (사용자 파일 안전 유지).
- (G7) 권한 요청 거절 시 코멘트/대화로 이어지는 UX.
- (G8) OS 시스템 알림 지원.
- (G9) Windows 우선, macOS 베타.

### 비목표
- (N1) 실시간 음성/영상 통화.
- (N2) 파일 공유 드래그앤드롭 (V3.1로 연기).
- (N3) 3명 이상 사용자의 협업 (1인회사 메타포 유지).
- (N4) 모바일 앱 (데스크톱 전용).
- (N5) Plugin/Extension 시스템 (V4로 연기).

---

## 3. 용어 정의

| 용어 | 의미 |
|------|------|
| **대표(Boss)** | 사용자. 앱 주인. |
| **직원(Member)** | AI 프로바이더 인스턴스. 프로필을 가짐. |
| **사무실(Office)** | 앱 전체. 좌측 네비게이션의 최상위. |
| **합의 폴더(Consensus)** | 전사 공유 공간. `~/Documents/arena/consensus/`. 모든 직원이 R+W. |
| **프로젝트(Project)** | 업무 단위. 폴더 하나 = 프로젝트 하나. |
| **채널(Channel)** | 프로젝트 내 주제별 대화 공간. 시스템 채널 + 사용자 채널. |
| **회의(Meeting)** | 채널 안에서 진행되는 SSM 세션 (합의·작업·리뷰). |
| **승인함(Approval Inbox)** | 사용자 결정 대기 항목 모음 (시스템 채널 `#승인-대기`). |
| **출근 상태(Work Status)** | 직원의 활성 상태. 값: `online` / `connecting` / `offline-connection` / `offline-manual`. 상세는 §7.2. |
| **ArenaRoot** | 앱이 관리하는 루트 폴더. 기본값 `~/Documents/arena/`. 사용자 변경 가능. |
| **프로젝트 slug** | URL-safe 폴더명(예: `my-blog-api`). DB `projects.id`(UUID)와 구분. 폴더 경로는 slug로 구성. |

---

## 4. 아키텍처 개요

### 4.1 전체 레이어

```
┌───────────────────────────────────────────────────────────┐
│ Renderer (React + TailwindCSS + Zustand) — 전면 재설계    │
│  ├─ Dashboard (3열 정보 밀집)                              │
│  ├─ Messenger (채널 네비 + 채팅 + 멤버 패널)               │
│  ├─ Settings (프로젝트/멤버/권한/알림)                     │
│  └─ Design System (tokens, primitives, blocks)             │
└───────────────────────────────────────────────────────────┘
               ↕ IPC (typed, zod 검증 dev-only)
┌───────────────────────────────────────────────────────────┐
│ Main (Node.js) — 유지 + 확장                               │
│  ├─ Engine: SessionStateMachine, Orchestrator, Turn       │
│  ├─ Providers: API / CLI / Local (+ cwd fix, auto flags)  │
│  ├─ Execution: CommandRunner, PatchApplier, AuditLog      │
│  ├─ Files: ArenaRootService, ProjectService, PermissionSvc│
│  │        (v2 Workspace/ConsensusFolderSvc 대체)           │
│  ├─ Memory: FTS5 + 임베딩 + 반성 + 진화                    │
│  ├─ Channels: ChannelService (신규)                        │
│  ├─ Notifications: NotificationService (신규)              │
│  ├─ Config: 3계층 (settings/secrets/runtime)              │
│  ├─ Recovery, Remote, Log (유지)                           │
│  └─ Database: v3 마이그레이션 체인                         │
└───────────────────────────────────────────────────────────┘
               ↕
  OS: Windows(mklink /J) / macOS(ln -s) / Linux(ln -s)
  CLIs: claude, codex, gemini (cwd 고정, auto flags)
  Storage: ~/Documents/arena/{consensus,projects/<id>}
```

### 4.2 기술 스택 결정

| 항목 | 선택 | 사유 |
|------|------|------|
| Runtime | **Electron** | 파일시스템 + 프로세스 spawn 필수 |
| Language | **TypeScript (strict)** | AI 편집 안정성 + 타입 추론 |
| UI | **React 18** | 기존 팀 친숙 + 생태계 |
| Styling | **TailwindCSS + Radix UI** (신규 채택) | 디자인 시스템 기반, Claude Design 결과물 호환 |
| Animation | **Framer Motion** (신규) | 메신저 전환·알림 애니메이션 |
| State | **Zustand** | 기존 유지, 가벼움 |
| Bundler | **electron-vite** | 기존 유지 |
| DB | **better-sqlite3 + FTS5** | 기존 유지 |
| i18n | **react-i18next + eslint-plugin-i18next** | 기존 유지, ko 기본 |
| Test | **Vitest + @testing-library + Playwright** | Playwright 신규 (E2E) |

### 4.2.1 파일시스템 경로 결정 규칙 (CD-1)

**`projects.id`는 DB 참조 전용. 파일시스템 경로 계산에는 `slug`만 사용.** 스펙 전반에서 `<projectId>`나 `<activeProjectId>`가 경로로 쓰인 부분은 전부 `<slug>`로 해석.

단일 진입점:
```ts
interface ProjectPaths {
  projectDir: string;      // <ArenaRoot>/projects/<slug>
  metaDir: string;         // <projectDir>/.arena
  spawnCwd: string;        // external이면 <projectDir>/link, 아니면 <projectDir>
  externalRealPath?: string; // external일 때 realpathSync(<projectDir>/link)
}

function resolveProjectPaths(project: Project, arenaRoot: string): ProjectPaths;
```

CLI spawn, path-guard, ArenaRoot 재스캔, junction 생성·검증, Meeting 기록 등 모든 경로 계산은 이 함수의 출력만 소비한다. 다른 어떤 코드도 `<ArenaRoot>/projects/` 아래 경로를 직접 조합하지 않는다.

### 4.3 재사용/재설계 결정 매트릭스

**Main (엔진) 레이어:**

| 모듈 | 결정 | 사유 |
|------|------|------|
| `engine/session-state-machine.ts` | **재사용** | 12상태·16이벤트 검증됨, 채널 컨텍스트만 추가 주입 |
| `engine/orchestrator.ts` | **재사용** + 채널 루팅 추가 | `runArenaLoop` 패턴 유효 |
| `engine/turn-manager.ts` | **재사용** | 라운드 로빈 로직 재활용 |
| `engine/message-formatter.ts` | **재사용** | JSON 프로토콜 안정적 |
| `engine/history.ts` | **재사용** | 멀티파티 메시지 변환 검증됨 |
| `providers/*` | **재사용 + 버그픽스** | cwd + 자동승인 플래그 수정 필수 (§7.6) |
| `providers/cli/permission-adapter.ts` | **재설계** | 3 CLI 모두 제대로된 플래그로 재작성 |
| `execution/*` | **재사용** | CommandRunner + PatchApplier + AuditLog 검증됨 |
| `files/workspace-service.ts` | **재설계 → ArenaRootService** | `.arena/workspace/` 대신 `~/Documents/arena/consensus/` |
| `files/permission-service.ts` | **재설계** | path-guard 단순화, arena 루트 기반 경계 |
| `files/consensus-folder-service.ts` | **재설계** | ArenaRootService에 흡수 |
| `memory/*` | **재사용** | FTS5+임베딩+반성 검증됨 |
| `config/*` | **재사용** | 3계층 구조 유지 |
| `log/*`, `recovery/*`, `remote/*` | **재사용** | 변경 없음 |
| `ipc/*` | **재사용 + 확장** | 새 채널·프로젝트·프로필 IPC 추가 |

**Renderer 레이어 → 전면 재설계.** `src/renderer/` 전체를 `_legacy/renderer-v1/`로 이동 후 새로 작성.

**Store 레이어:**

| Store | 결정 |
|-------|------|
| `provider-store` | **재사용 + 확장** (CB-12): v2 기본 필드는 유지하되, `member_profiles` join(role/personality/expertise/avatar) + 출근 상태 머신(online/connecting/offline-connection/offline-manual) selector 추가. v2 대비 store API는 상위호환. |
| `chat-store`, `app-store` | **재설계** — 채널·프로젝트 기반 분할 |
| `project-store` (신규) | projects/active/loading/status |
| `channel-store` (신규) | channels by projectId, messages by channelId |
| `member-profile-store` (신규) | role/personality/expertise/avatar |
| `notification-store` (신규) | inbox + OS notification prefs |
| `dashboard-store` (신규) | widgets state |
| `queue-store` (신규) | queue_items by projectId, 진행 포인터 |
| `ui-store` (신규) | 뷰 전환, 모달, 테마 |

**DB 스키마 → 재설계.** `src/main/database/migrations/`를 `_legacy/migrations-v2/`로 이동 후 v3 마이그레이션 체인 새로 작성 (§5).

---

## 5. 데이터 모델

### 5.1 저장 위치

```
~/Documents/arena/                 (ArenaRoot, 사용자 설정 가능)
├─ consensus/                       (전사 공유 — 모든 직원 R+W)
│  ├─ documents/                    (합의 문서)
│  ├─ meetings/                     (회의록, 자동)
│  └─ scratch/                      (임시 초안)
├─ projects/
│  ├─ <slug>/                       (신규/가져오기 프로젝트)
│  │  ├─ .arena/
│  │  │  └─ meta.json               (id, name, kind, permission_mode, autonomy_mode 등)
│  │  ├─ src/, docs/, etc.          (사용자 파일)
│  │  └─ ...
│  └─ <slug>/                       (외부 연결 프로젝트 — 동일 규칙)
│     ├─ .arena/meta.json           (kind=external, externalLink 필드 포함)
│     └─ link → <외부 경로>         (Windows: junction, *nix: symlink)
├─ db/
│  └─ arena.sqlite                  (앱 상태 DB)
└─ logs/
   └─ structured-<date>.jsonl
```

앱 DB는 `<ArenaRoot>/db/arena.sqlite`에 저장 (기존 Electron userData 대체). 사용자가 백업·동기화 쉽도록.

**권한·접근 진실의 원천:** `projects.permission_mode`, `project_members`, `channel_members`는 **DB가 정본**. `.arena/meta.json`은 포터블 참조(다른 머신으로 복사 시 재인식용)일 뿐. 불일치 시 DB 우선.

**ArenaRoot 이동 정책:** 설정에서 ArenaRoot 경로를 변경하면 재시작 후 새 경로에서 `projects/` 탐색 → DB의 slug와 폴더 매칭 → 불일치 시 "폴더 이동 필요" 경고 다이얼로그. 자동 이동은 하지 않음(데이터 손실 위험).

### 5.2 DB 스키마 (v3, 새 마이그레이션 체인)

**위상 정렬 규칙**: FK 의존성에 따라 선행 테이블이 앞 번호를 가진다. forward-only(`PRAGMA foreign_keys=ON`). 마이그레이션 파일은 아래 번호와 파일명으로 **그대로 생성**한다(변경 금지).

`src/main/database/migrations/` 아래:

**001_core.sql** — providers + member_profiles (의존성 없음)
```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('api','cli','local')),
  config_json TEXT NOT NULL,
  persona TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE member_profiles (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  role TEXT DEFAULT '',
  personality TEXT DEFAULT '',
  expertise TEXT DEFAULT '',
  avatar_kind TEXT DEFAULT 'default',
  avatar_data TEXT DEFAULT NULL,
  status_override TEXT DEFAULT NULL,
  updated_at INTEGER NOT NULL
);
```

**002_projects.sql** — projects + project_members (providers 필요)
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                          -- UUID v4, DB 참조 전용
  slug TEXT NOT NULL UNIQUE,                    -- URL-safe 폴더명 (파일시스템 유일 키)
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('new','external','imported')),
  external_link TEXT DEFAULT NULL,              -- kind=external: spawn 직전 realpathSync 재검증 대상
  permission_mode TEXT NOT NULL CHECK(permission_mode IN ('auto','hybrid','approval')),
  autonomy_mode TEXT NOT NULL DEFAULT 'manual' CHECK(autonomy_mode IN ('manual','auto_toggle','queue')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','folder_missing','archived')),
  created_at INTEGER NOT NULL,
  archived_at INTEGER DEFAULT NULL
);
-- 파일시스템 경로 결정: resolveProjectPaths(project)만 사용
--   regular:  <ArenaRoot>/projects/<slug>
--   external: <ArenaRoot>/projects/<slug>/link → realpathSync → external_link와 일치 필수

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  role_at_project TEXT DEFAULT NULL,    -- 프로젝트별 역할 오버라이드 (NULL = member_profiles.role 사용)
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, provider_id)
);
```

**003_channels.sql** — channels + channel_members (projects 필요)
```sql
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- DM은 NULL
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('system_general','system_approval','system_minutes','user','dm')),
  read_only INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(project_id, name)
);

-- channel_members: 프로젝트 경계 강제 (CD-3)
-- project_id를 포함하여 project_members와 복합 FK로 subset invariant 보장
CREATE TABLE channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- DM은 NULL (channel.project_id와 동기화)
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, provider_id),
  -- 복합 FK: project_id가 NOT NULL일 때 (project_id, provider_id)가 project_members에 존재해야 함
  FOREIGN KEY (project_id, provider_id) REFERENCES project_members(project_id, provider_id) ON DELETE CASCADE
);
-- subset invariant: DM(project_id IS NULL)이 아니면 위 FK가 강제. DM은 트리거로 별도 검증.

-- DM 단순화 (CB-4 + codex 덧붙임): v3는 단일 사용자 앱이라 "사용자"를 채널 멤버로 저장할 provider 레코드 없음.
-- → DM 채널은 참여 AI 1명만 channel_members에 저장. 사용자 참여는 암묵적.
-- → 같은 AI와의 DM 중복 방지: partial unique index
CREATE UNIQUE INDEX idx_dm_unique_per_provider
  ON channel_members(provider_id)
  WHERE project_id IS NULL;   -- DM 멤버십은 provider당 1개

CREATE INDEX idx_channels_project ON channels(project_id);
CREATE INDEX idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX idx_channel_members_provider ON channel_members(provider_id);
```

**004_meetings.sql** — meetings (channels 필요)
```sql
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic TEXT DEFAULT '',
  state TEXT NOT NULL,
  state_snapshot_json TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER DEFAULT NULL,
  outcome TEXT DEFAULT NULL CHECK(outcome IN ('accepted','rejected','aborted') OR outcome IS NULL)
);

CREATE INDEX idx_meetings_channel ON meetings(channel_id);
-- 1채널 1활성회의 (ended_at IS NULL인 레코드는 channel_id당 최대 1개)
CREATE UNIQUE INDEX idx_meetings_active_per_channel
  ON meetings(channel_id) WHERE ended_at IS NULL;
```

**005_messages.sql** — messages + FTS5 (channels, meetings, providers 필요)
```sql
CREATE TABLE messages (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,      -- FTS5 join용 정수 rowid (CA-5)
  id TEXT NOT NULL UNIQUE,                      -- 애플리케이션 레벨 식별자 (UUID)
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  meeting_id TEXT DEFAULT NULL REFERENCES meetings(id) ON DELETE SET NULL,
  author_id TEXT NOT NULL,                       -- provider_id 또는 리터럴 'user' (단일 사용자)
  author_kind TEXT NOT NULL CHECK(author_kind IN ('user','member','system')),
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  meta_json TEXT DEFAULT NULL,                   -- MessageMeta (§6 zod)
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at);
CREATE INDEX idx_messages_meeting ON messages(meeting_id);
CREATE INDEX idx_messages_id ON messages(id);

-- author_id의 conditional FK를 트리거로 강제 (CB-8)
CREATE TRIGGER messages_author_fk_check BEFORE INSERT ON messages BEGIN
  SELECT CASE
    WHEN NEW.author_kind = 'member' AND NOT EXISTS (SELECT 1 FROM providers WHERE id = NEW.author_id)
      THEN RAISE(ABORT, 'messages.author_id must reference providers.id when author_kind=member')
    WHEN NEW.author_kind = 'user' AND NEW.author_id != 'user'
      THEN RAISE(ABORT, 'messages.author_id must be literal "user" when author_kind=user')
  END;
END;

-- FTS5: content 테이블 연결 (rowid 매핑 명시)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_fts_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- FTS 검색 쿼리 예시:
--   SELECT m.* FROM messages m
--     JOIN messages_fts f ON f.rowid = m.rowid
--   WHERE messages_fts MATCH ?
--     AND m.channel_id = ?
--   ORDER BY rank;
```

**006_approval_inbox.sql** — approval_items (projects/channels/meetings 필요)
```sql
-- 감사 유실 방지 (CB-7): 부모 삭제 시 레코드 보존, 하드 DELETE 금지
CREATE TABLE approval_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('cli_permission','mode_transition','consensus_decision','review_outcome','failure_report')),
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  requester_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','superseded')),
  decision_comment TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER DEFAULT NULL
);
CREATE INDEX idx_approval_status ON approval_items(status, created_at);
-- 애플리케이션 레벨 규칙: approval_items는 hard DELETE 금지. status='superseded'/'expired'로만 종료.
```

**007_queue.sql** — queue_items (projects 필요) (CD-2 신규)
```sql
CREATE TABLE queue_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,  -- 큐 항목 실행 대상 채널 (기본 #일반)
  order_index INTEGER NOT NULL,                                       -- 정렬용 (소수 간격으로 재정렬 용이: 1000, 2000, 3000)
  prompt TEXT NOT NULL,                                               -- 사용자 입력 원문
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','done','failed','cancelled','paused')),
  started_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL, -- 실행 중/완료 시 연결된 회의
  started_at INTEGER DEFAULT NULL,
  finished_at INTEGER DEFAULT NULL,
  last_error TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_queue_project_order ON queue_items(project_id, status, order_index);

-- 복구 규칙: 앱 재시작 시 status='in_progress'인 항목은 'pending'으로 되돌리고 사용자에게 안내
-- (연결된 meeting이 살아있으면 이어받기 옵션 제공).
```

**008_memory.sql** — v2 메모리 스키마(FTS+embedding+reflection+evolution) 이식. v2 001~004의 memory 관련 DDL을 그대로 복붙하되 `messages` 참조는 없음(독립).

**009_audit.sql** — v2 audit_log 그대로 이식. ON DELETE 동작은 전부 `SET NULL` 또는 없음(감사 레코드 보존).

**010_remote.sql** — v2 remote_access_tokens / remote_sessions / remote_audit_log 이식.

**011_notifications.sql**
```sql
CREATE TABLE notification_prefs (
  key TEXT PRIMARY KEY CHECK(key IN ('new_message','approval_pending','work_done','error','queue_progress','meeting_state')),
  enabled INTEGER NOT NULL DEFAULT 1,
  sound_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE notification_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
  clicked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

---

## 6. IPC 프로토콜 (확장)

기존 `IpcChannelMap` + `IpcMeta` + `typedInvoke` 구조 그대로. 추가 채널:

**Project**
- `project:list` → `Project[]`
- `project:create({name, kind, description, permissionMode, autonomyMode, initialMembers})` → `Project`
- `project:link-external({name, externalPath, ...})` → `Project`
- `project:import({sourcePath, name, ...})` → `Project` (복사 + 생성)
- `project:update(id, patch)` → `Project`
- `project:archive(id)` → `void`
- `project:open(id)` → 활성 프로젝트 설정
- `project:set-autonomy(id, mode)` → `void`

**Channel**
- `channel:list(projectId?)` → `Channel[]` (null = DM + 프로젝트없는)
- `channel:create({projectId?, name, kind, members[]})` → `Channel`
- `channel:rename(id, name)` → `Channel`
- `channel:delete(id)` → `void` (system은 불가)
- `channel:add-members(id, providerIds[])` → `void`
- `channel:remove-members(id, providerIds[])` → `void`
- `channel:start-meeting(channelId, topic)` → `Meeting`

**Member Profile**
- `member:get-profile(providerId)` → `MemberProfile`
- `member:update-profile(providerId, patch)` → `MemberProfile`
- `member:set-status(providerId, 'online'|'offline-manual')` → `void`
- `member:reconnect(providerId)` → `WorkStatus` (재연결 시도)
- `member:list-avatars()` → 기본 아바타 풀

**Approval Inbox**
- `approval:list({status?, projectId?})` → `ApprovalItem[]`
- `approval:decide(id, 'approve'|'reject'|'conditional', comment?)` → `void`
  - `conditional`일 때 `comment`가 AI에게 자연어 조건으로 주입됨

**Notification**
- `notification:get-prefs()` → `NotificationPrefs`
- `notification:update-prefs(patch)` → `NotificationPrefs`
- `notification:test(kind)` → `void` (OS 알림 테스트)

**Arena Root**
- `arena-root:get()` → `string`
- `arena-root:set(path)` → `void` (앱 재시작 필요)
- `arena-root:status()` → `{ exists, writable, consensusReady, projectsCount }`

**푸시 이벤트** (신규)
- `stream:channel-message` — 새 메시지
- `stream:member-status` — 직원 상태 변경
- `stream:approval-created` — 승인 항목 추가
- `stream:approval-decided` — 승인 항목 결정 반영 (CB-9)
- `stream:project-updated` — 프로젝트 메타 변경
- `stream:meeting-state-changed` — SSM 상태 전환 (CB-9, 대시보드·채널 헤더 실시간 갱신용)
- `stream:queue-progress` — 큐 진행/완료/실패 업데이트 (CB-9, CD-2)
- `stream:notification` — OS 알림 발송 전 renderer 이벤트

**Queue IPC (CD-2)**
- `queue:list(projectId)` → `QueueItem[]`
- `queue:add({projectId, prompt, targetChannelId?})` → `QueueItem`
- `queue:reorder({projectId, orderedIds[]})` → `void` (order_index 재계산, 소수 간격 유지)
- `queue:remove(id)` → `void` (status='pending'만 가능, 진행 중은 cancel)
- `queue:cancel(id)` → `void` (in_progress → cancelled + 진행 중 meeting abort)
- `queue:pause(projectId)` → `void` / `queue:resume(projectId)` → `void`

**zod 검증 정책 (CC-2)**:
- 개발 모드: 모든 IPC 요청/응답 + 모든 `stream:*` 이벤트 전체 zod 검증.
- 프로덕션 모드: 최소 shape validation(`z.object().passthrough()` + discriminator만 체크) 유지. 특히 `stream:*` 이벤트는 페이로드 종류가 다양해 런타임 크래시 위험 — 프로덕션에서도 최소 검증으로 잘못된 페이로드는 drop + 로깅.
- 검증 실패 시: 개발 모드는 throw, 프로덕션은 structured error 로그 + 해당 이벤트 drop, 연속 5회 이상 실패 시 채널 일시 차단.

---

## 7. 기능 사양

### 7.1 멤버 프로필 시스템

**구조화 필드** (기존 `persona` 자유텍스트 대체):
- `displayName` (Provider 테이블, 필수)
- `role` — 직함 (예: "시니어 개발자", "UX 디자이너")
- `personality` — 말투/성격 (예: "직설적, 유머러스, 엔지니어 출신")
- `expertise` — 전문분야 (예: "React, Node, DB 최적화")
- `avatarKind` — `'default' | 'custom'`
- `avatarData` — default일 때 팔레트 키, custom일 때 파일 참조 또는 base64

**PersonaBuilder 확장**: 기존 `buildEffectivePersona`가 위 필드들을 조합해 system prompt 생성:
```
[Base Conversation Rules]
...

[Your Identity]
Name: {displayName}
Role: {role}
Personality: {personality}
Expertise: {expertise}

[Tool Usage Rules]
...
```

**편집 UX**:
- 메시지 버블의 아바타 클릭 → 프로필 팝업 → "편집" 버튼 → 프로필 모달.
- 설정 화면에서도 전체 멤버 편집 가능.
- 편집은 즉시 반영, 다음 턴부터 새 페르소나 적용.

**기본 아바타 풀** (8개):
- 색상 + 이모지 조합 (예: blue+🧑‍💻, green+🎨, purple+🔬, ...).
- 사용자 업로드 이미지는 `~/Documents/arena/avatars/<providerId>.<ext>`에 복사 저장, DB엔 상대 경로.

### 7.2 출근 상태 시스템

**상태 4종 (1인회사 메타포 — "AI=직원"):**

| 값 | 도트 | UI 라벨 | i18n 키 | 의미 | 전환 |
|---|---|---|---|---|---|
| `online` | 🟢 녹색 | "출근" | `member.status.online` | 연결 OK + 활성 | warmup 성공 |
| `connecting` | 🟡 노랑 애니 | "재연결 중" | `member.status.connecting` | 재연결 시도 중 | warmup 진행 |
| `offline-connection` | 🔴 빨강 | "점검 필요" | `member.status.offlineConnection` | ping/warmup 실패 — 시스템 이상 | warmup 실패 |
| `offline-manual` | ⚪ 회색 | "외근" | `member.status.offlineManual` | 사용자가 수동으로 자리 비움 설정 | "외근" 토글 |

- 앱 시작 시 모든 provider에 대해 warmup 병렬 실행, 실패 시 `offline-connection`("점검 필요"로 표시).
- 사용자가 **"외근"** 토글을 누르면 DB `member_profiles.status_override = 'offline-manual'` 저장. 수동 "출근" 토글 전까지 자동 재연결 시도 제외.
- 프로필 카드에 "연락해보기" 버튼 → `member:reconnect` IPC → warmup 재실행.
- 턴매니저는 `online` 상태 멤버만 선발. 다른 상태는 스킵.

**용어 원칙 (1인회사 메타포 일치):**
- "퇴근"이라는 용어는 **앱 종료**를 연상시키므로 사용하지 않음. 자리를 비우는 일시 상태는 "외근"으로 통일.
- "연결끊김"은 기술 용어이므로 사용자 노출 UI에서 사용하지 않음. 시스템 이상은 "점검 필요"로 통일(사용자 귀속 표현).
- 코드 레벨 enum(`offline-manual`, `offline-connection`)은 유지 — DB·IPC 호환.

### 7.3 프로젝트 관리

**생성 유형 3가지:**

1. **신규(New)**
   - `<ArenaRoot>/projects/<slug>/` 폴더 생성
   - `.arena/meta.json` 작성
   - 템플릿(V3 범위 최소): **빈 폴더** 또는 **README.md 1개만 생성**. 언어별 스캐폴드는 V3.1 이후.

2. **외부 연결(External)**
   - 사용자가 외부 폴더 경로 선택 (파일 대화상자)
   - `<ArenaRoot>/projects/<slug>/` 폴더 생성
   - `.arena/meta.json` 작성 (kind=external, `externalLink` = 선택 시점 realpath)
   - `link`라는 이름의 junction/symlink 생성:
     - Windows: `mklink /J "<ArenaRoot>\projects\<slug>\link" "<외부경로>"` (관리자 권한 불필요)
     - macOS/Linux: `ln -s <외부경로> <ArenaRoot>/projects/<slug>/link`
   - CLI는 `cwd = <ArenaRoot>/projects/<slug>/link`로 spawn (junction/symlink 투명 추적)
   - **TOCTOU 방지 (CA-3)**: CLI spawn 직전마다 `fs.realpathSync(link)` 재계산 후 `projects.external_link`(DB 정본)와 **정확히 일치** 검증. 불일치/끊김이면 spawn 거부, 사용자에게 재연결 UI + `projects.status='folder_missing'`.
   - **external 프로젝트는 `permission_mode='auto'` 금지 (CA-1/CA-3)**: 외부 실경로는 사용자가 소유하는 다른 레포일 가능성 — 무심사 변경 위험 과도. UI에서 `auto` 옵션 비활성 + 서버 validation에서 거부. `hybrid` 또는 `approval`만 허용.

3. **가져오기(Import)**
   - 사용자가 외부 폴더 경로 선택
   - `~/Documents/arena/projects/<slug>/`로 **복사** (대용량은 경고)
   - 원본은 건드리지 않음

**생성 모달**:
```
┌─ 새 프로젝트 ──────────────────────────┐
│ 이름: [________]                       │
│ 설명: [________]                       │
│                                        │
│ 타입:                                  │
│  ○ 신규 빈 프로젝트                     │
│  ○ 외부 폴더 연결 [폴더 선택]            │
│  ○ 외부 폴더 가져오기(복사) [폴더 선택] │
│                                        │
│ 권한 모드:                              │
│  ○ 자율 (오토)    ● 혼합 (읽기 자동)   │
│  ○ 승인 (매번)                          │
│                                        │
│ 초기 참여 직원:                         │
│  ☑ Claude (개발)                        │
│  ☑ Gemini (디자인)                      │
│  ☑ Codex                                │
│                                        │
│        [취소]   [생성]                  │
└────────────────────────────────────────┘
```

**자율 모드 설정 (프로젝트 생성 후 변경 가능):**
- `manual` (기본): 각 단계마다 사용자 확인.
- `auto_toggle`: AI들끼리 합의 → 작업 → 리뷰 자동 진행. 완료/실패 시 알림.
- `queue`: "할 일 목록" 입력 → 큐에서 순차 처리. 각 항목 완료 시 알림.

**`permission_mode` 변경 제약 (CB-3):**
- Claude Code의 `--permission-mode`는 세션 시작 시점에 고정되고 런타임 변경 불가.
- 활성 Meeting이 있는 프로젝트는 `permission_mode` 변경 UI가 비활성 ("진행 중 회의가 끝나야 변경 가능" 안내).
- 변경을 승인한 뒤에는 CLI 프로세스 전면 재시작(=앱 재시작 또는 provider cooldown→warmup) 필요. 설정 저장 시 "변경은 다음 회의부터 적용" 배너.

### 7.4 채널 시스템

**시스템 채널 (프로젝트 생성 시 자동):**
- `#일반` — 잡담/공지. 삭제 불가, 이름변경 가능.
- `#승인-대기` — Approval Inbox 자동 반영. 읽기전용(사용자 입력 X), 버튼만. 삭제 불가.
- `#회의록` — 완료된 회의의 요약 자동 기록. 읽기전용. 삭제 불가.

**사용자 채널:**
- 사용자가 자유 생성 (예: `#기획`, `#개발`, `#버그`).
- 채널별 참여 멤버 선택 가능 (프로젝트 멤버 부분집합).
- 이름변경·삭제 가능.

**DM:**
- `project_id = NULL`인 채널, `kind = 'dm'`. 참여자는 **AI 1명만** `channel_members`에 저장(사용자 참여는 앱 레벨 암묵).
- 단일 사용자 앱이라 `channel_members.provider_id`는 `providers(id)`만 참조. 로컬 사용자는 FK로 저장할 수 없음. 장기적으론 `participants(kind,id)` 계층으로 재모델링 여지(V4 고려).
- `idx_dm_unique_per_provider` partial unique index로 동일 AI와의 DM 중복 방지.
- AI끼리의 DM은 지원하지 않음 (V3 범위). AI 간 대화는 프로젝트 채널에서만.
- 좌측 네비 "DM" 섹션에 별도 그룹.
- DM은 프로젝트 컨텍스트가 없으므로 권한·실행 기능은 비활성. 순수 대화용.

**채널 내 "회의 시작":**
- 채널 상단에 `[회의 시작]` 버튼.
- 클릭 → 주제 입력 모달 → `Meeting` 레코드 생성 → SSM 초기화.
- **제약: 한 채널에 동시 활성 회의는 1개만.** 이미 진행 중이면 버튼 비활성 + 툴팁 "이미 회의 중"(DB의 `idx_meetings_active_per_channel`이 강제).
- 회의 중엔 채널 상단에 진행 상태 뱃지 (예: "🗳 합의 투표 3/4").
- 회의 완료 시 자동으로 `#회의록`에 요약 포스팅.
- DM 채널은 회의 시작 불가.

### 7.5 대시보드 (사무실 첫 화면)

> **설계 정본**: `docs/Rolestra_sample/01-Dashboard.html` + `01-dash-variants.jsx` 6 테마 변형. 본 절은 그 시안을 spec 언어로 정식화.

**레이아웃 구성 (위→아래):**

1. **ShellTopBar** — "사무실 · 시간 · 인사" 한 줄. 마케팅 카피·홍보 문구 금지.
2. **Hero** — 4 KPI 타일 + 빠른 액션 2개.
3. **비대칭 2x2 콘텐츠 그리드** — 4 위젯.
4. **Insight 띠** — 주간 지표 한 줄.

**Hero (상단 블록):**

```
┌──────────────────────────────────────────────────────────────┐
│  활성 프로젝트 3   │  진행 회의 2   │  승인 대기 5  │  오늘 완료 7 │
├──────────────────────────────────────────────────────────────┤
│  [ + 새 프로젝트 ]                        [ 회의 소집 → ]       │
└──────────────────────────────────────────────────────────────┘
```

| KPI | 데이터 소스 | i18n 키 |
|---|---|---|
| 활성 프로젝트 | `projects.status='active'` count | `dashboard.kpi.activeProjects` |
| 진행 회의 | `meetings.ended_at IS NULL` count (진행 중인 회의만 — 모든 종료 경로는 `ended_at`을 stamp) | `dashboard.kpi.activeMeetings` |
| 승인 대기 | `approval_items.status='pending'` count | `dashboard.kpi.pendingApprovals` |
| 오늘 완료 | `meetings.outcome='accepted' AND ended_at >= startOfLocalToday()` count (실패/abort는 포함 안 함 — 성공 건수만 노출) | `dashboard.kpi.completedToday` |

> **주**: `startOfLocalToday()`는 앱 로컬 타임존 기준 자정. UTC 자정 아님. DST 전환일 엣지는 `DashboardService`의 `startOfLocalDay()` 헬퍼가 Y/M/D 기반 `Date` 생성자로 처리(V8 normalisation 회피).

빠른 액션 2개: `+ 새 프로젝트`(신규 생성 모달), `회의 소집 →`(현재 채널 또는 프로젝트 선택 모달). 문구는 i18n 키 `dashboard.action.newProject` / `dashboard.action.startMeeting`.

**비대칭 2x2 그리드 (중앙 콘텐츠):**

```
┌──────────────────────────────┬──────────────────┐
│  📋 업무 (2-col 폭)           │  🔔 결재        │
│                               │  (풀높이, 2 row) │
├──────────────────────────────┤                  │
│  👥 직원    │  💬 최근 대화  │                  │
└──────────────┴────────────────┴──────────────────┘
```

CSS grid template: `"tasks tasks approvals" "people recent approvals"`. 결재 위젯은 풀높이(2 row span), 나머지 3 위젯은 단일 row.

**위젯 4종 (기존 5종에서 📝 공지 제거 — Hero + Insight 띠로 흡수):**

| 위젯 | 내용 | 클릭 동작 | i18n 키 prefix |
|------|------|-----------|-----------------|
| 📋 업무 | 진행 중 Meeting 목록(상위 10) + 프로젝트·상태·경과시간·진행률 게이지 | 해당 채널 이동 | `dashboard.tasks.*` |
| 👥 직원 | 전체 멤버 목록 + 출근 상태 도트 + 역할 1줄 | 프로필 팝업 | `dashboard.people.*` |
| 💬 최근 대화 | 전체 채널 통합 최신 메시지 스트림(5~10줄) + 발신 프로필 썸네일 | 해당 채널·메시지로 이동 | `dashboard.recent.*` |
| 🔔 결재 | `status=pending` approval items 상위 5건 요약 + 카운트 배지 | ApprovalInbox 이동 | `dashboard.approvals.*` |

**진행률 게이지 — SSM 12상태 기반, 테마별 분기 (시안 lock):**

| 테마 | 렌더 스타일 |
|---|---|
| warm (light/dark) | 라운드 바(`border-radius: panel`), 은은한 그라데이션 |
| tactical (light/dark) | 12분절 다이아 + alpha gradient(`clip-path`), 상태 인덱스에 해당하는 segment까지 활성 |
| retro (light/dark) | ASCII 패턴 `[████████░░░░]` (12 slots, 모노폰트) |

게이지 값 = `ssm.stateIndex / 12`. 라벨(`"4/12 · REFINEMENT"` 등)은 게이지 오른쪽.

**Insight 띠 (하단):**

```
이번 주 +21% · 평균 응답 9분 · 누적 승인 142건 · 리뷰 완료율 94%
```

문구는 i18n 키 (`dashboard.insight.weeklyDelta` 등) + runtime 값 치환. 4 셀 가로 균등 분할.

**상단 글로벌 바 (ShellTopBar와 별개의 도메인 UI — 대시보드 전용):**
- 활성 프로젝트 드롭다운 / 전체 직원 상태 요약(🟢 3 / ⚪ 1 / 🔴 0) / 알림 벨 / 설정 / 글로벌 메시지 검색.
- 시안 정본은 `docs/Rolestra_sample/01-dash-variants.jsx`의 `DashTopStrip`.

### 7.6 CLI 폴더 접근 해결 (핵심)

#### 7.6.1 방어 범위의 정확한 한계 (CA-1)

**중요: path-guard는 "Rolestra Main을 통한 파일 I/O"만 차단한다.** CLI 프로세스가 자기 프로세스 내부에서 `fs.writeFile` 등을 직접 호출하면 Main은 그 호출을 가로채지 못한다. 즉:

| 방어선 | 대상 | `auto` 모드에서 막는가? | `hybrid` | `approval` |
|--------|------|------------|----------|-----------|
| path-guard (PermissionService) | Main IPC를 경유한 파일 I/O (ExecutionService, memory 파이프라인, consensus 쓰기) | O | O | O |
| CLI sandbox / 승인 플래그 | CLI 프로세스가 직접 부르는 fs/shell 호출 | **X** (의도적 bypass) | △ (shell/network만 승인 요청) | O (매번 prompt) |
| CLI `cwd` + 승인 범위 제한 | CLI가 cwd 밖 파일을 건드리지 못하도록 CLI 자체가 강제 (tool마다 상이) | △ (도구별) | △ | △ |
| OS 수준 샌드박스 | 진짜 격리 (seccomp/chroot/app sandbox) | **X** (본 spec에서 다루지 않음) | X | X |

즉 `auto` 모드의 "안전"은 **CLI 도구 자신의 cwd 존중 + Rolestra의 프로젝트 폴더 선택이 곧 변경 허용 범위**라는 **신뢰** 위에 선다. Rolestra는 그 위에 감사 로그와 AI 페르소나 제약으로 추가 방어만 제공한다. Defense-in-depth는 3중이 아니라 실제로는 **1.5~2중**.

본 문서에서 "폴더 접근 해결"이라 할 때는 `cwd` 고정 + 자동승인 플래그 + 경계 검증의 조합으로 **의도한 프로젝트 폴더에서의 정상 작업이 가능**하도록 한다는 의미이지, 악의적 CLI 코드 실행을 막는 보안 경계는 아니다.

#### 7.6.2 계층 1 — `cwd` 강제 설정

`src/main/providers/cli/cli-process.ts`의 모든 spawn 호출에 `cwd` 추가:

```ts
// Before (v2 - 버그)
execFile(resolvedCommand, resolvedArgs, { shell: false, maxBuffer, windowsHide: true });

// After (v3)
const resolved = resolveProjectPaths(project);   // §4 단일 경로 결정 함수 (CD-1)
execFile(resolvedCommand, resolvedArgs, {
  shell: false,
  maxBuffer,
  windowsHide: true,
  cwd: resolved.spawnCwd,
  env: { ...process.env, ROLESTRA_PROJECT_SLUG: project.slug }
});
```

**`projectCwd` 결정 규칙** (resolveProjectPaths의 출력):
- `kind='new'|'imported'`: `<ArenaRoot>/projects/<slug>/`
- `kind='external'`: `<ArenaRoot>/projects/<slug>/link/` (spawn 직전 `realpathSync`로 `externalLink`와 정확 일치 검증 — CA-3)
- DM 등 프로젝트 컨텍스트 없음: **spawn 거부**.

#### 7.6.3 계층 2 — 3 CLI × 3 모드 실제 매트릭스 (CB-1, CB-2, CB-3, CB-6)

**Claude Code**

| 모드 | 플래그 | 실제 의미 | 세션 중 전환 |
|------|--------|-----------|----------------|
| `auto` | `--permission-mode acceptEdits` + `--allowedTools Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch` + `--add-dir <consensusPath>` | 편집 자동, `allowedTools` 화이트리스트로 위험 도구 제한 | 불가 (세션 시작 시 고정) |
| `hybrid` | `--permission-mode acceptEdits` + `--allowedTools Read,Glob,Grep,Edit,Write,WebSearch,WebFetch` + `--add-dir <consensusPath>` | 편집 자동, `Bash` 제외로 임의 명령 실행은 앱 레벨 prompt | 불가 |
| `approval` | `--allowedTools Read,Glob,Grep,WebSearch,WebFetch` + `--permission-mode default` + `--add-dir <consensusPath>` | 쓰기·실행 전부 prompt | 불가 |

**`--dangerously-skip-permissions`는 사용하지 않음.** 기본값이 과도 권한 부여(세션 전체 bypass)이므로 도구 화이트리스트만으로 충분한 `acceptEdits` + `--allowedTools` 조합을 선택. 사용자가 "극한 자율"이 필요하면 설정에서 opt-in하는 별도 스위치(§7.6.5)로만.

**Codex**

| 모드 | 플래그 | 실제 의미 | 비고 |
|------|--------|-----------|------|
| `auto` | `exec -a never --sandbox danger-full-access -C <cwd> --skip-git-repo-check -` (또는 `--dangerously-bypass-approvals-and-sandbox`) | 승인 없음 + 전면 쓰기/실행 | **external 프로젝트는 비허용** |
| `hybrid` | `exec --full-auto -C <cwd> -` | `-a on-request --sandbox workspace-write` alias. 파일 편집 자동, shell/network는 on-request → **Rolestra 앱 레벨 turn 승인 UI로 처리** (CLI 내부 prompt는 non-interactive에서 멈추므로 Rolestra가 가로채야 함) | CB-6 |
| `approval` | `exec -a on-failure --sandbox workspace-write -C <cwd> -` | 파일 편집 시도 시 승인, 실패 시 승인 | 실질적으로 `hybrid`에 가깝지만 초기 편집부터 승인 요청 |
| read-only | `exec -a never --sandbox read-only -C <cwd> -` | 읽기 전용 sandbox | |

Codex `exec`는 tool-level UI가 없어서 hybrid/approval의 차이는 **Rolestra 측 승인 게이팅 세분화**로 구현. Codex CLI 자체는 approval_policy(`-a`)와 sandbox(`--sandbox`) 2축으로 설정되며, 각 값 조합의 실제 행동은 Codex 문서(`codex exec --help`)를 정본으로 본다.

**Gemini**

| 모드 | 플래그 | 실제 의미 |
|------|--------|-----------|
| `auto` | `--approval-mode yolo` | 전부 자동 |
| `hybrid` | `--approval-mode auto_edit` | 파일 편집 자동, shell 등은 승인 |
| `approval` | `--approval-mode default` | 매 요청 승인 |
| read-only | `--approval-mode default` + 시스템 프롬프트로 쓰기 금지 | CLI 자체에 read-only 모드 없음 — 프롬프트 강제 |

#### 7.6.4 계층 3 — path-guard (Main 경유 I/O만)

`PermissionService.validateAccess(path)` 경계 판정:
- 허용 영역:
  - `<ArenaRoot>/consensus/`
  - `<ArenaRoot>/projects/<activeProjectSlug>/` (+ external은 `link` 따라 realpath 해결한 실경로)
- 그 외는 모두 차단 (traversal, symlink escape 포함)
- 단순 규칙: `isPathWithin(allowedRoots, realPath)` 단일 함수로 체크
- **CA-3 재검증**: external 프로젝트 참조 시마다 `realpathSync(link)`가 `projects.external_link`와 정확히 일치하는지 매번 확인.

이 계층은 CLI 내부 fs 호출을 **막지 않는다.** §7.6.1 방어 범위 표 참조.

#### 7.6.5 계층 4 — 권한 요청 인터셉트

- `auto` 모드: CLI prompt 없음. 파일 변경은 audit log와 `#회의록`에 사후 기록.
- `hybrid` 모드: Codex/Gemini의 승인 요청을 Rolestra 앱 레벨에서 가로채 ApprovalCard로 표시(Claude는 `Bash` 도구만 앱 레벨로 승인). 편집은 자동.
- `approval` 모드: 모든 쓰기/실행 요청을 ApprovalCard로 표시. Phase G 스타일.

**`auto` 모드 경고 UX 재작성:** "자율 모드는 AI가 프로젝트 `cwd` 내 파일 쓰기/명령 실행을 **CLI 자체 승인 없이** 수행합니다. Rolestra의 path-guard는 Main 경유 I/O만 방어하며 CLI 내부 fs 호출은 가드 밖입니다. 파일 변경은 되돌릴 수 없으니 git commit 등으로 복원 포인트를 확보해 두시길 권장합니다." 2단계 확인 다이얼로그. **external 프로젝트에서는 `auto` 선택지 자체를 비활성** (§7.3).

극한 자율(Claude `--dangerously-skip-permissions`, Codex `--dangerously-bypass-approvals-and-sandbox`)은 기본 off이며, 설정 탭의 별도 "위험한 자율 모드" 스위치를 명시적으로 켜야 사용 가능. 스위치 자체가 활성되면 프로젝트 목록에 "⚠ Dangerous Auto" 배지.

### 7.7 권한 요청 UX (거절 + 대화)

**메시지 포맷** (기존 CliPermissionRequestCard 확장):

```tsx
<ApprovalCard>
  <Header>
    <Avatar member={requester} />
    <Title>{requester.displayName} ({requester.role})</Title>
  </Header>
  <Body>
    <Line>{action.summary}</Line>  {/* "package.json 수정해도 될까요?" */}
    <Line class="muted">이유: {action.reason}</Line>
  </Body>
  <Actions>
    <Button onClick={approve}>허가</Button>
    <Button onClick={openRejectDialog}>거절</Button>
    <Button onClick={openConditionalDialog}>조건부 허가</Button>
  </Actions>
</ApprovalCard>
```

**거절 다이얼로그:**
- 코멘트 입력 (선택): "이건 건드리지마, 다른 방법 찾아봐"
- 결정 확정 → IPC `approval:decide(id, 'reject', comment)` → SSM 이벤트 `CLI_PERMISSION_REJECTED` + comment는 다음 턴 시스템 메시지로 해당 AI에게 주입.
- 코멘트 자체가 채팅에도 사용자 메시지로 표시.

**조건부 허가:**
- 자연어 조건 입력: "이 파일만, 커밋은 하지마"
- 허가는 되고, 조건이 시스템 메시지로 주입.
- 채팅에 사용자 메시지로 표시.

### 7.8 OS 시스템 알림

`src/main/notifications/notification-service.ts`:
- Electron `Notification` API 사용 (Windows Action Center / macOS Notification Center).
- 앱이 포커스 잃었을 때만 트리거 (`app.isFocused()`).
- 알림 종류: `new_message`, `approval_pending`, `work_done`, `error`.
- 사용자가 설정에서 종류별 on/off + 소리 on/off.
- 알림 클릭 → 앱 포커스 + 해당 채널/승인함으로 라우팅 (`stream:notification-clicked` IPC).

### 7.9 크로스 플랫폼 고려

**Windows (주 타겟)**:
- `mklink /J` junction (관리자 권한 불필요)
- `wsl.exe -d <distro>` 경유 CLI 지원 (기존)
- 경로 정규화: `D:\foo` ↔ `/mnt/d/foo` 자동 변환 (CLI가 WSL에 있을 때)
- 빌드: `electron-builder` → `.exe` + NSIS 인스톨러

**macOS (베타)**:
- `ln -s` symlink
- **GUI Electron 앱의 PATH 상속 문제 (CA-4)**: macOS GUI 앱은 사용자 shell 로그인 환경(`~/.zshrc`, `~/.zprofile`, fnm/nvm/asdf/nodenv/pyenv 초기화 스크립트)을 상속받지 못함. `fix-path`는 `PATH`만 복원하므로 asdf/nodenv/pyenv처럼 shim 디렉토리를 PATH에 동적으로 넣는 버전 매니저를 커버하지 못함.
  - 채택: **`shell-env`** 패키지. 사용자 기본 shell(`$SHELL`)을 `login+interactive`로 실행해 전체 env 스냅샷(PATH, ASDF_*, NVM_BIN, PYENV_ROOT 등)을 JSON으로 덤프 → Electron `app.whenReady()`에서 병합.
  - CliRunner env 병합 순서: `process.env` ← `shell-env` 덤프 ← Rolestra 고정값(`ROLESTRA_PROJECT_SLUG` 등). Rolestra 키는 항상 마지막이라 덮어씀.
  - 실패 시 fallback: 사용자가 `ProviderConfig.commandPath`에 직접 절대경로 지정 가능 (설정 UI).
- 빌드: unsigned `.dmg` (공증은 향후 $99/년 Apple Developer 계정 확보 후)
- Gatekeeper 우회 안내: 첫 실행 시 "확인되지 않은 개발자" 경고 → 우클릭→"열기" 방법 문서화.
- 파일 대화상자 등은 Electron 네이티브로 동일

**Linux (부가, 자동 얻음)**:
- symlink, FHS 경로. Electron AppImage.

### 7.10 디자인 시스템 개요

> **설계 정본**: `docs/Rolestra_sample/theme-tokens.jsx`(6 테마 토큰) + `docs/Rolestra_sample/shared-components.jsx`(Shell/NavRail/ProjectRail/ShellTopBar/ProfileAvatar/LineIcon) + `docs/Rolestra_sample/2026-04-19-theme-alignment-checklist.md`. 본 절은 시안을 spec 언어로 정식화.

#### 7.10.1 테마 매트릭스 (6 조합 = 3 계열 × 2 모드)

| 계열(`data-theme`) | 모드(`data-mode`) | 정체성 | 기본 추천 |
|---|---|---|---|
| `warm` | `light` | "거실 같은 사무실" — 따뜻한 orange/amber + Fraunces serif headline | ✅ 기본값 |
| `warm` | `dark` | 우디 카페 야간 — `#1f1611` base, amber accent |  |
| `tactical` | `light` | 항공/우주 관제실 주간 — cool gray + cyan, 글로우 80% 약화 |  |
| `tactical` | `dark` | 관제실 HUD 야간 — clip-path 모서리, 12분절 SSM 게이지, 다이아몬드 아바타, 라인 아이콘 |  |
| `retro` | `light` | 도트매트릭스 출력 — cream + sepia 잉크, 본문은 sans, 모노는 헤더·게이지. 스캔라인 제거, grain 텍스처 |  |
| `retro` | `dark` | CRT 호박색 + 스캔라인 + ASCII 게이지 |  |

각 테마 엔트리는 시안 `theme-tokens.jsx`의 ThemeToken schema와 1:1 대응(전체 key는 `src/renderer/theme/theme-tokens.ts`의 `ThemeToken` 인터페이스로 정식화).

#### 7.10.2 토큰 스키마 (schema key set)

색(`bgCanvas/bgElev/bgSunk/fg/fgMuted/fgSubtle/border/borderSoft/brand/brandDeep/accent/success/warning/danger`) · 레일(`railBg/railExtra/logoBg/logoFg/logoShadow/iconFg/iconActiveBg/iconActiveFg/iconActiveShadow/badgeBg/badgeFg/unreadBg/unreadFg/projectBg/itemActiveBg/itemActiveFg`) · 상단바·Hero(`topBarBg/topBarBorder/heroBg/heroBorder/heroValue`) · 형태(`avatarShape: circle|diamond|status`, `useLineIcons: boolean`, `panelRadius: number`, `panelClip: string`, `cardTitleStyle: bar|divider|ascii`, `miniBtnStyle: pill|notched|text`, `gaugeGlow: number`) · 폰트(`font`, `displayFont`, `monoFont`).

시안 schema의 모든 key가 `ThemeToken` 인터페이스에 포함되어야 한다(Task 5 auto-extract + Task 6 `theme-tokens.test.ts`가 고정).

#### 7.10.3 CSS variable + `data-theme` / `data-mode` 분기

- 런타임: `document.documentElement` 에 `data-theme`(warm|tactical|retro)와 `data-mode`(light|dark) 두 속성을 attach.
- CSS: `src/renderer/styles/tokens.css` 에 6 블록(`[data-theme='warm'][data-mode='light'] { --color-* : ... }` 등) + `:root` 기본 폴백(warm-light 복제) 포함.
- Tailwind: `tailwind.config.ts`의 `theme.extend.colors`는 **모두 `var(--color-*)` 참조**(하드코딩 색 0건). `darkMode: ['selector', '[data-mode="dark"]']`.
- 컴포넌트: 하드코딩 색 리터럴(`#...`, `rgb(...)`) 금지 — Tailwind utility 클래스 + CSS variable만 사용.

#### 7.10.4 폰트 매트릭스

| 계열 | 본문(body) | 디스플레이(headline) | 모노 |
|---|---|---|---|
| warm | sans (IBM Plex Sans) | Fraunces serif | IBM Plex Mono |
| tactical | sans (Space Grotesk) | 동일 sans | JetBrains Mono (헤더·게이지 전용) |
| retro | sans (IBM Plex Sans) | 동일 sans | IBM Plex Mono (헤더·게이지 전용) |

**모든 테마에서 본문은 sans-serif.** Retro도 본문 모노폰트 금지 — 모노는 헤더·게이지에만.

#### 7.10.5 Primitives (Radix UI 래핑)

**R3 최소 세트 (R4+ 사용 필수):** `Button`, `Card`(Header/Body/Footer), `Badge`, `Separator`, `Tooltip`. `class-variance-authority` 기반 variants + `useTheme()` 토큰에 따른 자동 매핑(예: Button `shape="auto"` → `miniBtnStyle` pill/notched/text 자동 선택, Card Header 스타일 → `cardTitleStyle` bar/divider/ascii).

**R4+ 이후 추가 예정:** `Input`, `Textarea`, `Select`, `Dialog`, `DropdownMenu`, `Tabs`, `Toast`, `Avatar`(shell의 `ProfileAvatar`와 별도 generic), `ScrollArea`, `Switch`, `Checkbox`.

#### 7.10.6 Blocks (제품 특화 — Phase 분배)

| Block | 담당 Phase |
|---|---|
| `MemberCard`, `MemberListItem`, `StatusDot`, `PresenceRoster` | R8 |
| `ChannelItem`, `ChannelHeader`, `ChannelList` | R5 |
| `MessageBubble`(self/member/system), `MessageComposer`, `TypingIndicator` | R5 |
| `ApprovalCard`, `ApprovalInbox` | R7 |
| `TaskCard`, `MeetingBadge`, `PermissionBadge` | R4/R6 |
| `DashboardWidget`(Tasks/People/RecentChats/Approvals — 4종) | R4 |
| `ProjectSwitcher`, `GlobalNav`, `SettingsSection` | R4/R10 |

**R3 범위의 Shell 컴포넌트 (시안 `shared-components.jsx` 정식화):** `Shell`, `NavRail`(64px), `ProjectRail`(240px), `ShellTopBar`(한 줄), `ProfileAvatar`(8 default + custom, `avatarShape` 분기), `LineIcon`(`useLineIcons` 토큰 분기).

#### 7.10.7 Animation

Framer Motion — 메시지 입장(0→opacity), 상태 변경(spring), 알림 토스트(slide), 사이드바 열림/닫힘. R3는 shell 레벨 motion 훅만 스캐폴딩, 실제 애니메이션은 R4+.

#### 7.10.8 금지 사항 (시안 락 — 이탈 즉시 리뷰 반려)

- **게이미피케이션 단어 금지:** `XP`, `CREDITS`, `LV`, `MISSION`, `REWARD`, `UNLOCK` — 토큰·i18n·컴포넌트·테스트 스냅샷 전부에서 0건 (CI grep 가드).
- **본문 모노폰트 금지:** Retro 테마도 본문은 sans. 모노는 헤더·게이지에만.
- **마케팅 카피 헤더 금지:** `ShellTopBar`는 "사무실 · 시간 · 인사" 한 줄 외 홍보 문구 금지.
- **시각 정보 밀도 변경 금지:** 6 테마 전부 동일 레이아웃·동일 정보량. 테마는 시각 스타일만 바꿈, 구조는 안 바꿈.
- **하드코딩 색·폰트 리터럴 금지:** `#RRGGBB`, `rgb()`, `"Fraunces"` 같은 문자열 리터럴은 `theme-tokens.ts`/`tokens.css`/`tailwind.config.ts` 외에서 등장하면 PR 반려.

### 7.11 i18n 네이밍 규칙 (v3 재편)

- react-i18next 유지, ko 기본 + en. 새 UI 문자열은 전부 t() 경유.
- 도메인 최상위: `dashboard.*`, `messenger.*`, `channel.*`, `member.*`, `project.*`, `approval.*`, `notification.*`, `settings.*`, `common.*`, `error.*`
- 도메인 내부: `<domain>.<surface>.<key>` (예: `project.create.title`, `project.create.kindNew`)
- 버튼·액션: `*.action.<verb>` (예: `member.action.reconnect`, `project.action.archive`)
- 상태 라벨: `*.status.<name>` (예: `member.status.online`, `member.status.offlineManual`)
- 오류: `error.<domain>.<code>` (예: `error.arena.rootMissing`, `error.cli.spawnFailed`)
- 고아 키 CI 가드: `eslint-plugin-i18next` + `i18next-parser`로 기존 정책 유지.

---

## 8. 상태 모델 (SSM 확장)

기존 12상태 유지. 신규 컨텍스트 주입:

```ts
interface SsmContext {
  meetingId: string;         // 신규
  channelId: string;         // 신규
  projectId: string;         // 신규
  projectPath: string;       // 신규 (cwd로 전달)
  permissionMode: 'auto' | 'hybrid' | 'approval';  // 신규
  autonomyMode: 'manual' | 'auto_toggle' | 'queue'; // 신규
  // ... 기존 필드
}
```

`autonomyMode` 별 동작 상세:

| 모드 | USER_DECISION 처리 | 완료 후 동작 | 예외 처리 |
|------|--------------------|------|---------|
| `manual` | approval_item 생성, 사용자 결정 대기 | 회의 종료, 사용자 지시 대기 | 정상 흐름 |
| `auto_toggle` | 자동 accept (모드전환·합의 투표·리뷰 결과가 `accepted`일 때) | 회의 종료 → `#일반` 채널에 완료 알림 | review outcome이 `rework`/`fail`이거나 CLI 실패/합의 실패 시 **강제 `manual`로 다운그레이드**, 알림 + approval_item |
| `queue` | `auto_toggle`과 동일 | 회의 종료 → **queue에 다음 작업이 있으면 자동 시작**, 없으면 종료 | `auto_toggle`과 동일 다운그레이드 규칙 |

**queue 모드 UX:**
- 프로젝트 상단에 "할 일 큐" 패널 (접기 가능).
- 사용자가 줄바꿈으로 여러 작업 입력 (예: `로그인 리팩토링\n다크모드 추가\n리드미 업데이트`).
- 각 항목이 대기 큐에 쌓임. 한 번에 하나씩 회의 시작(대상 채널 사용자 지정, 기본 `#일반`).
- 항목 완료 시 OS 알림, 다음 항목으로 진행.
- 사용자가 언제든 큐에서 항목 제거·순서 변경 가능.
- 저장은 `queue_items` 테이블(§5.2). 앱 재시작/크래시 이후에도 순서·진행 포인터·실패 이력 복구.

### 자율 모드 Circuit Breaker (CB-5)

`auto_toggle`/`queue` 모드에서 무한 루프·폭주 방지용 4종 상한. 하나라도 초과되면 **즉시 `manual`로 강제 다운그레이드** + 진행 중 작업 abort + approval_item 생성 + OS 알림.

| 한계 | 기본값 | 비고 |
|------|--------|------|
| 턴당 파일 변경 수 | 20개 | 한 턴에서 AI가 수정한 파일 수(ExecutionService 집계). 넘으면 이 턴 rollback + 브레이커. |
| 누적 CLI 실행 시간 | 30분 / meeting | wall-clock. 타임아웃 다른 메커니즘과 별개로 "너무 오래 돌면 의심". |
| 큐 연속 실행 | 5항목 | `queue` 모드에서 연속 5개 성공 후엔 사용자 확인 요구(배터리, 비용 방어). 사용자가 "계속"을 누르면 카운터 리셋. |
| 실패 패턴 | 같은 에러 메시지 3연속 | consensus 실패·CLI 에러·테스트 실패 등이 3연속 같은 카테고리면 브레이커. |

설정 UI에서 값 조정 가능. "Circuit breaker 비활성화" 옵션은 **없음** (최소 상한은 항상 유효). 브레이커 발동 이력은 `notification_log`와 audit log에 기록.

### 채널/회의 사이드이펙트 리스너

- `onPermissionAction(grant_worker)` → CliPermissionBridge 호출 + CLI respawn + approval inbox에 로그 이벤트.
- `onMessage` → messages 테이블 저장 + `stream:channel-message` emit.
- `onStateChange` → meetings 테이블 state 갱신 + 대시보드 업무 위젯 refresh.
- `onFinal` → `#회의록`에 요약 메시지 자동 포스팅 + notification.

---

## 9. 에러 처리와 복구

### 에러 카테고리
| 종류 | 처리 |
|------|------|
| CLI spawn 실패 | provider → `offline-connection`, 알림 발송, 재연결 버튼 |
| CLI 권한 거부 (prompt 응답) | SSM 이벤트 발사, 사용자 코멘트 주입 |
| 파일 접근 경계 위반 (Main 경유) | PermissionService 거부, audit log, 채팅 시스템 메시지로 공지 |
| 외부 링크 끊김 / realpath 불일치 | spawn 차단 + `projects.status='folder_missing'` + 재연결 UI |
| 마이그레이션 실패 | 앱 시작 차단, 오류 다이얼로그, 로그 경로 안내 |
| SSM 타임아웃 | 기존 규칙 유지 (타임아웃 → FAILED 상태 + 스냅샷) |
| Circuit breaker 발동 | autonomyMode을 강제 `manual`로 다운그레이드 + 알림 + approval_item |
| Consensus 파일 race | `.tmp` 쓰기 실패/충돌 시 자동 재시도 3회, 초과 시 audit log + 시스템 메시지 |

### Consensus 폴더 동시성 (CC-3)

`<ArenaRoot>/consensus/`는 모든 직원이 R+W 가능해서 동시 쓰기 race가 있을 수 있음. 해결:
- **Atomic rename 원칙**: 모든 쓰기는 `name.md.tmp.<pid>-<random>` → `fsync` → `rename(tmp, name.md)`. rename은 POSIX에서 atomic, Windows(NTFS)에서도 같은 볼륨이면 atomic.
- **Advisory lock**: `name.md.lock` sentinel 파일(mkdir 기반 lock). `ConsensusFolderService.withLock(path, async () => ...)` API로 강제. 타임아웃 10s, expire 감지 후 stale lock 자동 제거.
- AI 프롬프트에 "합의 문서 저장은 ConsensusFolderService 경유 (Main IPC)로만 쓰기. 직접 write 금지" 규칙 주입. auto 모드에서 AI가 직접 쓰더라도 ExecutionService allowlist로 consensus 경로는 `consensus-write` 도구만 허용.

### 복구
- 앱 종료/크래시 후 재시작 시: 진행 중 Meeting 감지 → 복구 프롬프트.
- 외부 링크 재연결: `.arena/meta.json`의 `externalLink`를 다시 선택하면 junction 재생성, `projects.status='active'`로 복귀.
- Queue 복구: `status='in_progress'` 항목은 `pending`으로 롤백, 연결된 meeting이 있으면 이어받기 옵션.

---

## 10. 구현 순서 (Phase)

작은 단위로 분할, 각 Phase 종료 시 실제 쓸 수 있는 상태.

**Phase R1 — 폴더 접근 근본 해결 (최우선, 격리 스모크 — CA-6)**

이 Phase는 **v2 앱과 분리된 격리 환경**에서 수행한다. v2 UI/IPC/Main을 건드리지 않음.
- 새 서브모듈/폴더 `tools/cli-smoke/`에서 ArenaRoot 초기화 스크립트 + 3 CLI spawn 래퍼 + 자동승인 플래그 매트릭스를 구현.
- 실제 Claude Code / Codex / Gemini CLI를 로컬에 설치하고 `auto`/`hybrid`/`approval` × `new`/`external` 조합별 실제 동작을 **스크립트로 자동 검증**:
  - "`<ArenaRoot>/projects/smoke-1/` 안에 README.md 쓰기"
  - "`<ArenaRoot>/projects/smoke-ext/link` (external junction)에 쓰기 + TOCTOU 재검증 성공"
  - `hybrid`에서 앱 레벨 turn 승인 게이팅 흐름 시뮬레이션 (mock UI)
- resolveProjectPaths() 유틸 단일 함수로 경로 결정 검증 (CD-1).
- 성공 매트릭스(모드·CLI·OS별 실제 관측 결과)를 `docs/superpowers/specs/appendix-cli-matrix.md`로 기록 — 이후 Phase의 플래그 변경 근거.
- **종료 조건**: 3 CLI × 3 모드 × Windows/(macOS) 매트릭스에서 기대 동작(파일 생성 성공 또는 승인 요청 가로채기)이 모두 관측됨. v2 앱 통합은 R2 이후.

**Phase R2 — v3 DB 스키마 + Main 레이어 + IPC**
- 기존 migrations → `_legacy/migrations-v2/`
- 011까지 v3 마이그레이션 작성 (§5.2 순서) + up/재실행/down 테스트.
- ArenaRootService, ProjectService, ChannelService, MeetingService, MessageService, ApprovalService, QueueService, MemberProfileService, NotificationService 신규 — R1 매트릭스를 실제 Main 레이어에 이식.
- IPC 채널 추가 + zod 스키마 (프로덕션 shape validation 포함).
- SSM ctx 확장 (projectId/channelId/meetingId/permissionMode/autonomyMode) + circuit breaker(§8) 초기 구현.
- Main 레이어 리팩토링. Renderer 변경 아직 없음 — v2 UI는 정상 동작 유지 (v2 UI가 새 Main 서비스와 호환 안 되면 R2 내에서 v2 UI는 임시 비활성, 스크립트 기반 통합 테스트로 검증).

**Phase R3 — 레거시 이동 + 디자인 시스템 초기** (plan: `docs/superpowers/plans/2026-04-20-rolestra-phase-r3.md`, done-checklist: `docs/superpowers/specs/r3-done-checklist.md`)

구현 체크리스트 (완료 시 ✓ + 산출물 링크 채움):

- [x] §7.2 출근 상태 라벨 갱신 (외근/점검 필요) — 산출물: 본 spec §7.2
- [x] §7.5 대시보드 재정의 (Hero 4 KPI + 비대칭 2x2 그리드 + Insight 띠 + 진행률 게이지 테마 분기) — 산출물: 본 spec §7.5
- [x] §7.10 디자인 시스템 재정의 (6 테마 + CSS variable + 폰트 매트릭스 + 금지사항) — 산출물: 본 spec §7.10
- [x] `src/renderer/` → `_legacy/renderer-v1/` 이동 (삭제 아님, git mv로 히스토리 보존) — 산출물: `_legacy/renderer-v1/`
- [x] 새 `src/renderer/` 부팅 가능한 뼈대 — 산출물: `src/renderer/{index.html,main.tsx,App.tsx}`
- [x] Tailwind + PostCSS + Radix(slot/tooltip/separator) + framer-motion + cva + clsx 설치 및 설정 — 산출물: `tailwind.config.ts`, `postcss.config.js`
- [x] `theme-tokens.jsx` → `theme-tokens.ts` + `tokens.css` 자동 생성 스크립트(`npm run theme:build`) — 산출물: `tools/theme/extract-tokens.ts`, `src/renderer/theme/theme-tokens.ts`, `src/renderer/styles/tokens.css`
- [x] ThemeProvider + themeStore(zustand persist) + useTheme() — 산출물: `src/renderer/theme/{theme-provider.tsx,theme-store.ts,use-theme.ts}`
- [x] Shell 컴포넌트 6종 (Shell/NavRail/ProjectRail/ShellTopBar/ProfileAvatar/LineIcon) — 산출물: `src/renderer/components/shell/*`
- [x] Primitive 5종 (Button/Card/Badge/Separator/Tooltip) — 산출물: `src/renderer/components/primitives/*`
- [x] App 루트 Shell 와이어업 + dev-only theme-switcher(`import.meta.env.DEV`) — 산출물: `src/renderer/App.tsx`, `src/renderer/components/shell/theme-switcher.tsx`
- [x] i18n 도메인 네임스페이스 15종 (`I18N_NAMESPACES`) + 실 사용 도메인부터 JSON 채움 — 산출물: `src/renderer/i18n/keys.ts`, `src/renderer/i18n/locales/{ko,en}.json`
- [x] Legacy channel warning 현황 문서화 + 격리 테스트(제거는 R11) — 산출물: `docs/superpowers/specs/appendix-legacy-channels.md`, `src/renderer/__tests__/legacy-channel-isolation.test.ts`
- [x] 6 테마 × 2 모드 스크린샷 증빙 — 산출물: `docs/superpowers/specs/appendix-r3-evidence/{warm,tactical,retro}-{light,dark}.png` + README. 실제 Electron 런타임 캡처 완료 (2026-04-20).
- [x] typecheck/lint/i18n:check/theme:check/build exit 0 + test 64 pre-existing fail 유지(R3 신규 30+ 테스트 전부 green) — 산출물: `docs/superpowers/specs/r3-done-checklist.md`

**scope 경계 (R3에서 하지 않는 것, R4+ 이연):**
- 제품 특화 Blocks(`MessageBubble`, `MemberCard`, `ChannelItem`, `ApprovalCard`, `DashboardWidget`, `ProjectSwitcher` 등) — 도메인 IPC·상호작용 훅업과 얽힘. R4(대시보드) 이후 각 Phase에서.
- Storybook — 채택 안 함. dev-only theme-switcher가 최소 플레이그라운드 역할.
- Legacy IPC 채널(chat:*/workspace:*/consensus-folder:*/consensus:*/session:*) 제거 — warn 유지, 제거는 R11.

**Phase R4 — 대시보드 + 프로젝트 관리** (plan: `docs/superpowers/plans/2026-04-20-rolestra-phase-r4.md`, done-checklist: `docs/superpowers/specs/r4-done-checklist.md`)

구현 체크리스트 (완료 시 ✓ + 산출물 링크 채움):

- [x] §7.5 Hero 4 KPI 타일 + 빠른 액션 2개 (`+ 새 프로젝트` / `회의 소집`) — 산출물: `src/renderer/features/dashboard/{HeroKpiTile,HeroQuickActions,DashboardPage}.tsx`
- [x] §7.5 비대칭 2x2 위젯 4종 (📋업무 / 👥직원 / 💬최근대화 / 🔔결재 2-row span) — 산출물: `src/renderer/features/dashboard/widgets/{TasksWidget,PeopleWidget,RecentWidget,ApprovalsWidget}.tsx` + `src/renderer/hooks/{use-active-meetings,use-recent-messages,use-members,use-pending-approvals}.ts` + 신규 채널 `meeting:list-active`/`message:list-recent`
- [x] §7.5 Insight 띠 (4 셀: 주간Δ/평균응답/누적승인/리뷰완료율) — 산출물: `src/renderer/features/dashboard/InsightStrip.tsx` (R4는 4 cell 구조 + placeholder `—` + tone api; 실 값은 R6)
- [x] §7.5 진행률 게이지 테마별 3 variant (warm round / tactical 12-seg / retro ASCII) — 산출물: `src/renderer/features/dashboard/ProgressGauge.tsx` (themeKey 기반 분기)
- [x] §7.5 KPI 단일 집계 서비스 (N+1 방지) + `dashboard:get-kpis` IPC — 산출물: `src/main/dashboard/dashboard-service.ts`, `src/main/ipc/handlers/dashboard-handler.ts`, `src/shared/dashboard-types.ts` (≤ 4 repo call, DST 전환일 경계 테스트 포함)
- [x] §7.3 프로젝트 생성 모달 3 kinds (신규/외부/가져오기) + Radix Dialog + external+auto 비활성 — 산출물: `src/renderer/features/projects/{ProjectCreateModal,ProjectKindTabs,ProjectPermissionRadio,ExternalPathPicker,InitialMembersSelector}.tsx` + 신규 v3 채널 `project:pick-folder` (legacy `workspace:pick-folder`는 R3 isolation 테스트가 차단)
- [x] §7.3/§7.6 CA-3 junction TOCTOU 엣지 커버리지 보강 — 산출물: `src/main/projects/__tests__/project-service.test.ts` (external+auto 거부 + TOCTOU rollback 신규 2 케이스, 프로덕션 코드 0 diff)
- [x] 활성 프로젝트 전환 UI (ProjectRail + ShellTopBar subtitle) + persist store — 산출물: `src/renderer/stores/active-project-store.ts` (persist key `rolestra.activeProject.v1`), `src/renderer/hooks/use-active-project.ts`, `src/renderer/components/shell/{ProjectRail,ShellTopBar}.tsx` (ProjectRail에 `+ 새 프로젝트` row 추가, ShellTopBar에 `activeProjectName` prop 추가)
- [x] Renderer typed IPC wrapper + 3 hooks — 산출물: `src/renderer/ipc/invoke.ts`, `src/renderer/hooks/{use-dashboard-kpis,use-projects,use-active-project}.ts` (silent fallback 금지, strict-mode single-fetch guard)
- [x] i18n populate (`dashboard.*` / `project.*` / `shell.topbar.noActiveProject`) — 산출물: `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js` `keepRemoved` 9 패턴 (dynamic 키 보호)
- [x] Playwright Electron E2E "외부 프로젝트 연결 → 대시보드" 시나리오 — 산출물: `e2e/external-project-flow.spec.ts`, `e2e/playwright.config.ts`, `e2e/electron-launch.ts` (**WSL 런타임 제약으로 로컬 부팅은 DONE_WITH_CONCERNS — Windows/native 또는 R10 OS matrix CI에서 실제 런**)
- [ ] 6 테마 대시보드 스크린샷 증빙 + E2E 캡처 — 산출물: `docs/superpowers/specs/appendix-r4-evidence/*.png` **(수동 캡처 대기 — WSL 런타임 제약 동일. R4 code correctness는 non-blocking, 시각 sign-off는 Windows/native에서)**
- [x] typecheck/lint/test/i18n:check/theme:check/build exit 0 + R4 신규 테스트 전부 green + Playwright 로컬 pass — 산출물: `docs/superpowers/specs/r4-done-checklist.md` (Playwright 로컬 pass는 위 항목과 동일 이연)

**scope 경계 (R4에서 하지 않는 것, R5+ 이연):**
- KPI 실시간 스트림 구독 (R4는 진입/활성전환/모달 close 3 시점만 refresh) — R6 스트림 통합 이후
- Dashboard KPI의 `projectId` scope 구현 (타입은 optional 선언만) — R6 이후
- 위젯 클릭 네비게이션 (각 위젯 클릭 시 채널/인박스 이동) — 담당 Phase(R5/R7/R8)에서
- Playwright CI integration + OS matrix — R10
- 낙관적 업데이트(optimistic UI) / Error Boundary 래핑 — R10

**Phase R5 — 채널 + 메신저 본체** (plan: `docs/superpowers/plans/2026-04-21-rolestra-phase-r5.md`, prep: `docs/superpowers/specs/r5-prep-messenger-theme-analysis.md`, done-checklist: `docs/superpowers/specs/r5-done-checklist.md`)

구현 체크리스트 (완료 시 ✓ + 산출물 링크 채움):

- [x] §7.10 신규 theme token 2개 (`messengerHeaderPolicy`, `badgeRadius`) — 산출물: `docs/Rolestra_sample/theme-tokens.jsx` 확장 + `src/renderer/theme/theme-tokens.ts`(자동생성) + `src/renderer/styles/tokens.css`(자동생성)
- [x] Renderer hooks 5종 + active-channel-store (project-scoped persist) — 산출물: `src/renderer/hooks/{use-channels,use-dms,use-channel-messages,use-active-channel,use-channel-members}.ts` + `src/renderer/stores/active-channel-store.ts`
- [x] App view router (dashboard ↔ messenger) + MessengerPage skeleton — 산출물: `src/renderer/App.tsx` 수정 + `src/renderer/features/messenger/MessengerPage.tsx`
- [x] §7.4 ChannelRail — 프로젝트 시스템 + 사용자 채널 + DM 섹션 (themeKey 3-way 글리프/radius/clip 분기) — 산출물: `src/renderer/features/messenger/{ChannelRail,ChannelRow}.tsx`
- [x] §7.4 Thread + ChannelHeader (채널 kind별 UI 분기 + 회의 시작 버튼 메타) — 산출물: `src/renderer/features/messenger/{Thread,ChannelHeader}.tsx`
- [x] §7.4 Message + SystemMessage (themeKey 3-way — retro avatar/헤더 생략, mono-prefix 정책) — 산출물: `src/renderer/features/messenger/{Message,SystemMessage}.tsx`
- [x] §7.4 MeetingBanner + ApprovalBlock + StartMeetingModal (retro 별도 JSX, 영문 라벨 한국어화) — 산출물: `src/renderer/features/messenger/{MeetingBanner,ApprovalBlock}.tsx` + `src/renderer/features/meetings/StartMeetingModal.tsx`
- [x] §7.4 Composer (themeKey 분기 — `panelRadius` 재활용 + glyph 3-way + `message:append` wire) — 산출물: `src/renderer/features/messenger/Composer.tsx`
- [x] §7.4 MemberPanel + SsmBox + 공통 small primitive (DateSeparator / TypingIndicator placeholder / VoteTally) — 산출물: `src/renderer/features/messenger/{MemberPanel,MemberRow,SsmBox,TypingIndicator,DateSeparator,VoteTally}.tsx`
- [x] §7.4 채널 CRUD 모달 3종 (create/rename/delete — Radix Dialog 재사용, 시스템 채널 비활성) — 산출물: `src/renderer/features/channels/{ChannelCreateModal,ChannelRenameDialog,ChannelDeleteConfirm}.tsx`
- [x] §7.4 시스템 채널 자동 생성 wire-up (ProjectService.create/linkExternal/importFolder → ChannelService.createSystemChannels) + DM 시작 UX 최소 surface — 산출물: `src/main/projects/project-service.ts` 수정 + `src/renderer/features/members/StartDmButton.tsx`
- [x] i18n populate `messenger.*` (영문 라벨 한국어 통일, retro 터미널 스타일 한국어 `$ 채널` 등) + i18next-parser `keepRemoved` 확장 — 산출물: `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js`
- [x] Playwright Electron E2E "채널 생성 → 메시지 전송 → 렌더" — 산출물: `e2e/messenger-flow.spec.ts` (**WSL 런타임 제약으로 로컬 부팅은 DONE_WITH_CONCERNS — Windows/native 또는 R10 OS matrix CI에서 실 런; R4 Task12와 동일 정책**)
- [x] typecheck/lint/test/i18n:check/theme:check/build exit 0 + R5 신규 테스트 green + done-checklist 작성 — 산출물: `docs/superpowers/specs/r5-done-checklist.md` (Playwright 로컬 pass는 위 항목과 동일 이연)

**scope 경계 (R5에서 하지 않는 것, R6+ 이연):**
- AI 발화 렌더링(SSM 턴 → 메시지) — R6
- 실시간 메시지 스트림 구독(stream-bridge IPC wiring) — R6
- Meeting 진행/합의/결과 포스팅 — R6 (R5는 start/abort만)
- Approval 버튼 클릭 → 실제 승인/거절 → AI 재시도 — R7
- Member 프로필 편집 UX — R8
- DM 완성 기능(read receipt / typing indicator 실 이벤트) — R10
- 낙관적 업데이트 / Error Boundary 래핑 — R10
- Playwright CI integration + OS matrix — R10
- 6 테마 메신저 스크린샷 시각 sign-off (+ retro 영어 복귀 결정 D8) — Windows/native 수동 또는 R11 릴리스 전

**Phase R6 — 회의(SSM) 연동 + v2 engine 잔재 완전 청산** (plan: `docs/superpowers/plans/2026-04-22-rolestra-phase-r6.md`, done-checklist: `docs/superpowers/specs/r6-done-checklist.md`)

구현 체크리스트 (완료 시 ✓ + 산출물 링크 채움):

- [x] Shared meeting stream types + stream-bridge v3 이벤트 API (meeting:state-changed / turn-start/token/done / error) — 산출물: `src/shared/meeting-stream-types.ts` + `src/main/streams/stream-bridge.ts` 확장 + `src/preload/index.ts` 화이트리스트
- [x] §7.5 MeetingSession v3 — meetingId/channelId/projectId 1급, participants ≥ 2 enforcement, 기존 SSM/TurnManager/history.ts 자산 재사용 — 산출물: `src/main/meetings/engine/meeting-session.ts`
- [x] §7.5 MeetingTurnExecutor v3 — permissionService/workspaceService/consensusFolderService singleton 5곳 참조를 생성자 DI로 전환, streamBridge.emitMeetingTurn* 이벤트 발사, CLI permission은 v2 registerPendingCliPermission 흐름 유지(R7 이전) — 산출물: `src/main/meetings/engine/meeting-turn-executor.ts`
- [x] §7.5 MeetingOrchestrator v3 — v3-side-effects wireV3SideEffects() per-meeting 호출 + minutesComposer DONE 시 #회의록 포스팅 + main/index.ts DI 배선, v2 stream:* 이벤트 emit 0 — 산출물: `src/main/meetings/engine/meeting-orchestrator.ts` + `src/main/index.ts` + `src/main/ipc/handlers/meeting-handler.ts`
- [x] §7.5 MeetingMinutesComposer — 메타 헤더(참여자/주제/SSM/경과/투표) + 합의본 원문 + 종료시각, FAILED 분기, i18n 라벨 경유 — 산출물: `src/main/meetings/engine/meeting-minutes-composer.ts`
- [x] v2 singleton 완전 제거 + @deprecated 마킹(workspace-handler 3 singleton + engine/orchestrator + turn-executor + conversation + execution-coordinator + memory-coordinator 5 파일) — 산출물: `src/main/ipc/handlers/workspace-handler.ts` 주석 + `src/main/engine/{orchestrator,turn-executor,conversation,execution-coordinator,memory-coordinator}.ts` 주석 + `src/main/meetings/engine/__tests__/smoke-v3-di.test.ts`
- [x] execution-coordinator / memory-coordinator 흡수 — MeetingOrchestrator 메서드 또는 meeting-memory-coordinator 로 이관 — 산출물: `src/main/meetings/engine/meeting-memory-coordinator.ts`
- [x] Renderer use-meeting-stream 훅 — meeting:* 5 이벤트 reducer + live turn buffer + DB replace — 산출물: `src/renderer/hooks/use-meeting-stream.ts`
- [x] §7.4 Thread 본문 재작성 — placeholder 제거, DateSeparator + Message/SystemMessage/ApprovalBlock 분기 + compact mode + live turn 표시/replace; MeetingBanner 실 데이터(elapsed/ssmState/crewCount) — 산출물: `src/renderer/features/messenger/Thread.tsx` 본문 + `src/renderer/features/messenger/MeetingBanner.tsx`
- [x] Legacy typecheck 170건 정리 — `tsconfig.node.json` exclude 조정으로 archived `src/main/{memory,recovery,remote}/__tests__` 배제 + R11 에서 파일 삭제 예약 — 산출물: `tsconfig.node.json`
- [x] i18n populate `meeting.*` (minutes.header / state 12 SSM 이름 / error / notification / banner.state) + i18next-parser keepRemoved 2 regex — 산출물: `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js`
- [x] Playwright Electron E2E "프로젝트 → 채널 → 회의 시작 → mock turn → #회의록 포스팅" — 산출물: `e2e/meeting-flow.spec.ts` + `e2e/helpers/mock-provider.ts` (**WSL 런타임 제약 시 R4/R5와 동일 DONE_WITH_CONCERNS**)
- [x] typecheck(전체) / typecheck:web / lint / test / i18n:check / theme:check / build exit 0 + R6 신규 테스트 green + done-checklist 작성 — 산출물: `docs/superpowers/specs/r6-done-checklist.md`

**scope 경계 (R6에서 하지 않는 것, R7+ 이연):**
- ApprovalInbox UX (사용자가 승인 요청을 검토/승인/거절) — R7
- Approval 버튼 클릭 → 실제 승인/거절 → AI 재시도 wire — R7
- CLI permission adapter v3 완전 교체 (R6에서는 v2 흐름 보존) — R7
- DM 완성 기능(read receipt / typing indicator 실 이벤트) — R10
- FTS5 메시지 검색 — R10
- 낙관적 업데이트 / Error Boundary 래핑 — R10
- LLM 요약 기반 회의록 요약 (R6는 원문 + 메타 헤더) — R10
- Playwright CI integration + OS matrix — R10
- v2 engine 5 파일 물리적 삭제 (orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator) — R11
- Retro 영어 복귀 결정 D8 — R11 릴리스 전

**Phase R7 — 승인 시스템(ApprovalInbox + CLI permission adapter v3 전면 교체)** (plan: `docs/superpowers/plans/2026-04-22-rolestra-phase-r7.md`, done-checklist: `docs/superpowers/specs/r7-done-checklist.md`)

구현 체크리스트 (완료 시 ✓ + 산출물 링크 채움):

- [ ] Shared approval stream events + ApprovalPayload discriminated union (cli_permission / mode_transition / consensus_decision) — 산출물: `src/shared/approval-stream-events.ts` + `src/shared/approval-types.ts` 확장 + zod round-trip 테스트
- [ ] ApprovalStreamAdapter + usePendingApprovals 실시간 전환 — ApprovalService EventEmitter → StreamBridge emit + mount-fetch + stream 구독 병합 — 산출물: `src/main/approvals/approval-stream-adapter.ts` + `src/main/streams/stream-bridge.ts` 확장 + `src/main/index.ts` wire + `src/preload/index.ts` 화이트리스트 + `src/renderer/hooks/use-pending-approvals.ts` 재작성
- [ ] §7.7 CLI Permission v3 ApprovalCliAdapter + MeetingTurnExecutor 교체 — `createCliPermissionApproval(ctx) → Promise<boolean>` (create + subscribe-once('decided') + timeout 5분 default + auto-expire) — 산출물: `src/main/approvals/approval-cli-adapter.ts` + `src/main/meetings/engine/meeting-turn-executor.ts` 내부 교체 + `src/main/index.ts` approvalService DI 추가
- [ ] v2 cli-permission-handler + IPC + stream event + preload + renderer subscriber 완전 제거 — 산출물: `src/main/ipc/handlers/cli-permission-handler.ts` 파일 삭제 + `src/shared/{ipc-types,stream-types}.ts` 정리 + `src/preload/index.ts` 정리 + renderer legacy subscriber 0
- [x] §7.7 ApprovalBlock onDecision wire + RejectDialog + ConditionalDialog (코멘트 입력) — 산출물: `src/renderer/features/messenger/ApprovalBlock.tsx` + `src/renderer/features/approvals/{RejectDialog,ConditionalDialog}.tsx` + `src/renderer/features/messenger/__tests__/ApprovalBlock.test.tsx` + `src/renderer/features/approvals/__tests__/{RejectDialog,ConditionalDialog}.test.tsx` + `src/renderer/i18n/locales/{ko,en}.json` `messenger.approval.{rejectDialog,conditionalDialog,errors}.*` populate + `i18next-parser.config.js` `messenger.approval.errors` keepRemoved regex
- [x] §7.7 ApprovalSystemMessageInjector — reject/conditional comment → 다음 턴 시스템 메시지 주입 — 산출물: `src/main/approvals/approval-system-message-injector.ts` + `src/main/approvals/__tests__/approval-system-message-injector.test.ts` (11 tests green) + `src/main/index.ts` wire(approvalService + messageService, disposer retained)
- [x] §7.4 ApprovalInboxView + Thread `#승인-대기`(kind='system_approval') 분기 렌더 — 산출물: `src/renderer/features/approvals/ApprovalInboxView.tsx` + `src/renderer/features/approvals/__tests__/ApprovalInboxView.test.tsx` + `src/renderer/features/messenger/Thread.tsx` 분기 (+ Thread.test.tsx 커버리지 확장) + `src/renderer/hooks/use-pending-approvals.ts` `projectId` 옵션 + stream 필터 + `messenger.approval.inbox.{empty,error,loading}` i18n populate
- [x] §7.6/§7.3 ProjectService.updatePermissionMode — mode_transition approval flow (활성 회의 체크 + external+auto 금지 + TOCTOU 재검증) — 산출물: `src/main/projects/project-service.ts` (requestPermissionModeChange / applyPermissionModeChange + 4 error classes + ProjectServiceOptions.{approvalService,hasActiveMeeting}) + `src/main/approvals/approval-decision-router.ts` + `src/main/approvals/__tests__/approval-decision-router.test.ts` + `src/main/projects/__tests__/project-service.test.ts` 확장 + `src/main/ipc/handlers/project-handler.ts` + `src/shared/ipc-types.ts` 채널 + `src/shared/ipc-schemas.ts` zod + `src/main/ipc/router.ts` registration + `src/main/index.ts` DI (ApprovalService 순서 조정 + `hasActiveMeeting` = meetingRepo.listActive projectId 조회 + ApprovalDecisionRouter wire)
- [x] §7.5 Consensus Decision Approval — SSM DONE → consensus_decision approval 게이트 (approve → MinutesComposer 포스팅, reject → 거절 메시지 + outcome='rejected', conditional → approve + injector, timeout 24h default → expired) — 산출물: `src/main/engine/v3-side-effects.ts` (DONE `#회의록` post 를 approval 뒤로 미룸) + `src/main/meetings/engine/meeting-orchestrator.ts` (openConsensusDecisionGate + handleConsensusDecision + handleConsensusTimeout + buildConsensusDecisionPayload + stop() 시 disposer + `consensusDecisionTimeoutMs` opt) + `src/main/meetings/engine/__tests__/meeting-orchestrator.test.ts` (+6 DONE approval-gate 테스트) + `src/main/engine/__tests__/v3-side-effects.test.ts` (DONE 테스트 재작성)
- [x] §7.5 Dashboard ApprovalsWidget onRowActivate → `#승인-대기` 채널 라우팅 — 산출물: `src/renderer/features/dashboard/widgets/ApprovalsWidget.tsx` (default handler: activeChannelStore.setActiveChannelId + appViewStore.setView('messenger'), projectId=null safe no-op) + `src/renderer/hooks/use-system-channel.ts` + `src/renderer/stores/app-view-store.ts` + `src/renderer/App.tsx` (local useState → useAppViewStore) + `src/renderer/features/dashboard/widgets/__tests__/ApprovalsWidget.test.tsx` (+4 activation 테스트)
- [ ] §7.8 NotificationService approval_pending 트리거 (비포커스 시 OS 알림 + 클릭 시 #승인-대기 라우팅 힌트) — 산출물: `src/main/notifications/notification-service.ts` 확장 + `src/main/index.ts` wire
- [ ] i18n populate `approval.kind.*` / `approval.systemMessage.*` / `messenger.approval.{reject,conditional}Dialog.*` / `messenger.approval.inboxEmpty` / `dashboard.approvals.*` / `notification.approvalPending.*` + i18next-parser keepRemoved 확장 — 산출물: `src/renderer/i18n/locales/{ko,en}.json` + `i18next-parser.config.js`
- [ ] Playwright Electron E2E "승인 flow (CLI permission 또는 consensus decision happy path)" — 산출물: `e2e/approval-flow.spec.ts` (**WSL 런타임 제약 시 R4/R5/R6 와 동일 DONE_WITH_CONCERNS**)
- [ ] typecheck(전체) / typecheck:web / lint / test / i18n:check / theme:check / build exit 0 + R7 신규 테스트 green + done-checklist 작성 — 산출물: `docs/superpowers/specs/r7-done-checklist.md`

**scope 경계 (R7에서 하지 않는 것, R8+ 이연):**
- `review_outcome` / `failure_report` kind 의 발사 지점 (R7 은 enum 만) — R8 이후 autonomy/리뷰 도입 시
- Consensus approval autonomy auto-approve (24h timeout 전 자동 승인) — R9 autonomy 시스템
- `mode_transition` 조건부(conditional) UX — R10 (D3: 비활성 + 툴팁만, 재검토)
- 설정 UI 전체(mode 변경 UI 포함 — R7 은 최소 IPC 만) — R10
- Dashboard KPI 실시간 approval count stream — R10 (R7 은 KPI 는 mount-fetch + 정기 invalidate 수준)
- Playwright CI integration + OS matrix — R10
- v2 engine 5 파일 물리적 삭제 (orchestrator/turn-executor/conversation/execution-coordinator/memory-coordinator) — R11 (단 **cli-permission-handler 는 R7-Task4 에서 즉시 삭제** — D1)
- Retro 영어 복귀 결정 D8 — R11 릴리스 전

**Phase R8 — 멤버 프로필 + 출근 상태**

**Phase R8 — 멤버 프로필 + 출근 상태**
- MemberProfile 편집 모달 (role/personality/expertise/avatar)
- 기본 아바타 8종
- 출근 상태 머신 + 프로필 카드 "연락해보기" 버튼
- PersonaBuilder 확장

**Phase R9 — 자율 모드 + 시스템 알림**
- autonomyMode `auto_toggle`, `queue` 구현
- NotificationService (OS 알림)
- 알림 설정 UI

**Phase R10 — 다듬기**
- DM 기능 완성
- 검색 (FTS5 메시지 검색)
- 설정 UI 전체 (기존 10탭 재구성)
- 다크모드
- i18n ko/en 완성
- E2E 시나리오 커버

**Phase R11 — 레거시 청소 + 릴리스**
- `_legacy/` 삭제
- 문서 갱신 (`docs/설계-문서.md` → v3로 교체)
- Windows 인스톨러 / macOS dmg 빌드

---

## 11. 테스트 전략

- **단위 테스트 (Vitest)**: 서비스 로직 (PermissionService, ArenaRootService, ProjectService, PersonaBuilder, SSM ctx 변환).
- **통합 테스트 (Vitest)**: IPC 핸들러, DB 마이그레이션(up+down+재실행 idempotent 확인), CLI provider spawn (mock spawn + 실제 spawn 모두).
- **E2E (Electron + Playwright)**: `@playwright/test`의 Electron 모드 (`_electron.launch`) 사용. 실제 Electron 앱을 Playwright로 구동.
  - "외부 폴더 연결 → junction 생성 확인 → Claude에 파일 쓰기 지시 → 파일 생성 확인"
  - "프로젝트 생성 → 회의 → 합의 → 작업 → 리뷰"
  - "권한 거절 후 코멘트 → AI가 다음 시도"
  - "멤버 수동 퇴근 → 턴 스킵 → 출근 복귀"
  - "auto 모드 경고 다이얼로그 → 2단계 확인"
  - "ArenaRoot 이동 → 재시작 → 경고 표시"
- **크로스 OS CI**: GitHub Actions matrix `windows-latest` + `macos-latest` + `ubuntu-latest`. CLI들은 matrix job에서 실제 설치(`npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli`). API 키가 없으면 해당 테스트는 skip.

---

## 12. 보안/프라이버시

- API 키: `safeStorage` 암호화 유지.
- CLI 인수 escape: Windows `cmd.exe /c` 메타문자(`%`, `^`, `"`) 안전 처리 — Agestra의 `quoteWindowsCmdArg` 패턴 차용.
- path-guard가 arena 루트 밖 접근 모두 차단.
- 외부 링크 realpath 검증 (symlink escape 방지).
- Remote Access TLS 기본 (기존 유지).
- 감사 로그: 모든 권한 결정, 파일 접근, CLI spawn 기록.
- 크래시 리포트: 로컬만 저장, 자동 전송 없음.

---

## 13. 마이그레이션 전략

기존 사용자 데이터가 없는 것이 전제 (사용자가 Arena v2를 방치했음)지만, 안전장치 포함:

1. **첫 실행 시 ArenaRoot 선택 온보딩**: 기본값 `~/Documents/arena/` 제안, 사용자가 다른 경로 선택 가능.
2. **구 v2 DB 감지**: `app.getPath('userData')` 아래 `arena.sqlite` 존재 여부 확인. 발견 시:
   - `<ArenaRoot>/db/backup-v2-<yyyymmdd-hhmmss>.sqlite`로 **복사**(이동 아님 — 원본 보존).
   - 사용자에게 "구 데이터 발견" 알림. 가져올지 선택.
3. **v3 마이그레이션 실행**: `<ArenaRoot>/db/arena.sqlite` 생성. 001~009 순차 실행. 실패 시 앱 시작 차단 + 로그 경로 안내.
4. **선택적 v2 → v3 데이터 가져오기** (사용자 동의 시):
   - `providers.display_name`, `providers.persona` → `member_profiles.personality`로 이관 (기존 persona는 personality 필드에 그대로 복붙).
   - `providers.kind`, `config_json` → `providers` 테이블 (동일 구조).
   - 대화 기록은 채널 구조에 맞지 않으므로 **기본적으로 가져오지 않음**. 선택 옵션으로 "v2 대화를 `_legacy` 프로젝트 안에 덤프" 제공.
5. **마이그레이션 idempotent**: 재실행 시 `INSERT OR IGNORE`, `CREATE TABLE IF NOT EXISTS` 패턴 유지. 기존 v2의 실패 시 앱 차단 규칙 유지.

---

## 14. 오픈 이슈 / 향후 작업

- Claude Design으로 생성한 UI mockup을 이 spec의 블록/프리미티브에 매핑하는 단계 (구현 계획에서 확정).
- 파일 첨부 드래그앤드롭은 V3.1에서 추가.
- 음성 메모 등 메신저 부가 기능은 V4.
- Plugin 시스템은 V4.

---

## 15. 참고 자료

- 이전 설계: `docs/설계-문서.md` (v2)
- 구현 현황 (v2): `docs/구현-현황.md`
- 기능 정의서: `docs/기능-정의서.md`
- Agestra 레퍼런스 경로:
  - CLI runner (cwd 설정): `packages/core/src/cli-runner.ts`
  - CLI builder (자동승인 플래그): `packages/core/src/cli-worker/cli-builder.ts`
  - Permission adapter 아이디어: `packages/core/src/cli-provider-base.ts`
- 리뷰 합의본: `.agestra/workspace/synthesis/rolestra-synthesis_20260418_001.md` (claude/gemini + 로컬 codex. BLOCK → 본 문서 개정의 근거)
- 실측 매트릭스 (Phase R1): `docs/superpowers/specs/appendix-cli-matrix.md`

---

## 부록 A. v2 → Rolestra(v3) 델타 요약 (CB-12)

| 영역 | v2 | Rolestra | 비고 |
|------|----|-----------|------|
| 프로젝트 개념 | 없음 (conversation만) | `projects` 상위 + `channels` 하위 2계층 | 잡담(DM)과 작업 공존 |
| 저장 루트 | Electron userData | `<ArenaRoot>` (기본 `~/Documents/arena`) | 사용자 백업 용이 |
| 외부 폴더 | 없음 (고정 workspace) | junction/symlink 연결 + TOCTOU 재검증 | external은 `auto` 금지 |
| 멤버 프로필 | persona 자유 텍스트 | 구조화 필드 (role/personality/expertise/avatar) + 프로젝트별 role 오버라이드 | PersonaBuilder 확장 |
| 권한 모드 | 단일 (매 prompt) | `auto`/`hybrid`/`approval` 3단계 × 3 CLI 실제 매트릭스 | §7.6 |
| 방어 범위 | path-guard 단일 주장 | 1.5~2중 명시 + CLI sandbox 플래그 역할 분리 | §7.6.1 |
| 자율 모드 | 없음 | `manual`/`auto_toggle`/`queue` + Circuit breaker 4종 | §8 |
| 큐 | 없음 | `queue_items` 테이블 + IPC + recovery | CD-2 |
| UI 메타포 | 챗봇(ChatView 단일) | 메신저 + 사무실 대시보드(3열) | 전면 재설계 |
| Store | provider-store / chat-store / app-store | provider 확장 + project/channel/member-profile/notification/dashboard/queue/ui 분할 | §4.3 |
| DB 마이그레이션 | 001~007 | v3 체인 001_core~011_notifications (v2는 `_legacy`) | 위상 정렬 |
| 출근 상태 | 없음 | `online`/`connecting`/`offline-connection`/`offline-manual` 4종 | §7.2 |
| DM | 없음 | 사용자+AI 1명, AI끼리 DM 없음 | 단순화 |
| 시스템 알림 | 없음 | Electron Notification API 기반 | §7.8 |
| 플랫폼 | Windows | Windows 우선, macOS 베타(+ `shell-env` PATH fix) | §7.9 |
| 테스트 | Vitest 단위·통합 | + Playwright Electron E2E + 크로스 OS CI | §11 |

---

**Draft v0.3 완료.** 리뷰 합의본(synthesis) P0 4건 + P1 8건 + P2 7건 + P3 2건 + CD-1~3 전부 반영. 다음 단계는 사용자 최종 리뷰 → writing-plans 스킬로 구현 계획 생성.
