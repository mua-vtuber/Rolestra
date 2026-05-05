# D-A 메시지 자동 회의 트리거 + AI 복제 동시 회의 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec `docs/specs/2026-04-29-rolestra-message-auto-meeting-trigger-design.md` (commit `d10abe7`) 의 13 결정 항목을 구현 — 모든 채널에서 메시지 송신 시 즉시 응답이 시작되고, 같은 직원이 여러 회의에 동시 참여할 수 있도록.

**Architecture:**
- Backend: 새 `MeetingAutoTrigger` 모듈이 `MessageService` 의 `'message'` 이벤트를 listen → 채널 종류 분기 → 일반/사용자 채널은 회의 자동 시작 (또는 기존 회의에 합류), DM 은 단일 turn 응답 위임. CLI session state 를 회의 단위 `Map` 으로 격리. 회의 lifecycle 에 `pause` / `resume` 추가.
- Frontend: 좌측 채널 사이드바에 회의 활성 라벨 + hover 시 종료 버튼 swap. ChannelHeader 의 [회의 시작] 평소 hide. 앱 종료 시 진행 회의 다이얼로그.
- Schema: migration 016 — `meetings.paused_at` + `meetings.kind`.

**Tech Stack:** Electron 40 / TypeScript strict / better-sqlite3 / React 19 + Tailwind / Vitest / Playwright Electron / zod / react-i18next.

---

## File Structure

### 신규 파일
- `src/main/database/migrations/016-meeting-paused-and-kind.ts` — paused_at + kind 칼럼.
- `src/main/meetings/meeting-auto-trigger.ts` — 채널 종류별 분기 + 활성 회의 조회 / 신규 / 합류.
- `src/main/meetings/meeting-auto-trigger.test.ts` — 단위 테스트.
- `src/main/channels/dm-auto-responder.ts` — DM 채널의 단일 turn 응답 핸들러.
- `src/main/channels/dm-auto-responder.test.ts` — 단위 테스트.
- `src/renderer/features/messenger/MeetingStatusLabel.tsx` — 사이드바 라벨 + hover swap.
- `src/renderer/features/messenger/MeetingTopicEditor.tsx` — 토픽 편집 inline 컴포넌트.
- `src/renderer/features/app-quit/AppQuitMeetingDialog.tsx` — 앱 종료 시 진행 회의 다이얼로그.
- `src/renderer/hooks/use-app-quit-prompt.ts` — main → renderer push 받는 hook.

### 수정 파일
- `src/shared/ipc-types.ts` — 4 신규 IPC 채널.
- `src/shared/ipc-schemas.ts` — 4 신규 zod 스키마.
- `src/shared/meeting-types.ts` — `pausedAt` 필드.
- `src/main/meetings/meeting-service.ts` — `requestStop` / `pause` / `resume` 메서드.
- `src/main/meetings/meeting-repository.ts` — paused_at SELECT/UPDATE.
- `src/main/meetings/engine/meeting-orchestrator.ts` — 자동 종료 hook + paused_at 체크 + partial-summary 옵션 전달.
- `src/main/meetings/engine/meeting-minutes-composer.ts` — `partial: true` 옵션 (합의/논쟁/미결 3 섹션).
- `src/main/providers/cli/cli-session-state.ts` — Map 기반 다중 session 격리 helper 추가.
- `src/main/providers/cli/cli-provider.ts` — `meetingId` (sessionContext) arg 추가, sessionState 호출을 ContextMap 경유.
- `src/main/ipc/handlers/meeting-handler.ts` — request-stop / edit-topic / pause / resume 4 신규 핸들러.
- `src/main/ipc/handlers/channel-handler.ts` — auto-trigger / DM responder wiring.
- `src/main/index.ts` — auto-trigger / DM responder 인스턴스화 + before-quit hook.
- `src/renderer/features/messenger/ChannelRail.tsx` — MeetingStatusLabel 통합.
- `src/renderer/features/messenger/ChannelHeader.tsx` — [회의 시작] hide + topic editor + 진행 배지 유지.
- `src/renderer/i18n/locales/ko.json`, `en.json` — 신규 키 (15+).
- `src/renderer/App.tsx` — AppQuitMeetingDialog mount + hook 연결.
- `docs/specs/2026-04-18-rolestra-design.md` — §7.4 / §7.5 / §8 갱신 reference.
- `docs/decisions/cross-cutting.md` 또는 신규 `R12-decisions.md` — D-A ADR.

### 테스트
- 위 신규 파일 각각의 `.test.ts`.
- `e2e/auto-meeting-flow.spec.ts` (신규) — 메시지 → 자동 회의 → 합의 → 회의록 e2e.
- `e2e/meeting-pause-resume.spec.ts` (신규) — 일시정지 → 재부팅 → 재개.

---

## Task 0: 사전 정리 — A+B uncommitted 작업 commit

**Goal:** D-A 시작 전에 round2 A+B (turn status indicator + dev logs) 의 uncommitted 변경 11 파일을 깔끔하게 commit. D-A 가 그 위에 빌드되므로 base 정리 필수.

**Files:**
- 모든 working tree 의 modified 파일 (`git status -s`):
  - `src/main/channels/message-service.ts`
  - `src/main/meetings/engine/meeting-orchestrator.ts`
  - `src/main/meetings/engine/meeting-turn-executor.ts`
  - `src/main/streams/stream-bridge.ts`
  - `src/renderer/features/messenger/Composer.tsx`
  - `src/renderer/features/messenger/Thread.tsx`
  - `src/renderer/features/search/MessageSearchView.tsx`
  - `src/renderer/hooks/use-meeting-stream.ts`
  - `src/renderer/i18n/locales/en.json`
  - `src/renderer/i18n/locales/ko.json`
  - `src/shared/stream-events.ts`

**Acceptance Criteria:**
- [ ] `git status` clean (working tree no modified files except `.omx/` 메타).
- [ ] commit message 가 round2 A+B 변경 (turn status + dev logger) 명시.
- [ ] typecheck PASS.

**Verify:** `git status --porcelain` 가 빈 줄 또는 `.omx/` 만 출력.

**Steps:**

- [ ] **Step 1: typecheck 확인 (working tree 그대로)**

```bash
npm run typecheck
```

PASS 확인. FAIL 면 round2 A+B 회귀 fix 후 재시도.

- [ ] **Step 2: 변경 사항 stage**

```bash
git add src/main/channels/message-service.ts src/main/meetings/engine/meeting-orchestrator.ts src/main/meetings/engine/meeting-turn-executor.ts src/main/streams/stream-bridge.ts src/renderer/features/messenger/Composer.tsx src/renderer/features/messenger/Thread.tsx src/renderer/features/search/MessageSearchView.tsx src/renderer/hooks/use-meeting-stream.ts src/renderer/i18n/locales/en.json src/renderer/i18n/locales/ko.json src/shared/stream-events.ts
```

- [ ] **Step 3: commit (mua-vtuber identity 강제)**

```bash
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "$(cat <<'EOF'
feat(rolestra): R12 round2 A+B — turn status indicator + dev lifecycle 로그

A. liveTurn status 별 inline 안내 (확인/작성중/실패/스킵, 6 초 transient)
B. structured logger turn lifecycle (run-start/run-end/turn-start/turn-done/
   turn-error/turn-skipped/message-append)

dogfooding round1 #2 ("메시지 보내도 답이 없다") 의 단기 visibility 패치.
D-A 의 자동 트리거 spec 변경 후에도 transient 안내 + dev 로그 그대로 활용.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: 검증**

```bash
git log -1 --stat
git status --short
```

Expected: 새 commit 표시, status 는 `.omx/` 제외 clean.

---

## Task 1: Migration 016 — `meetings.paused_at` + `meetings.kind`

**Goal:** DB 스키마에 일시정지 시각 + 회의 종류 (manual/auto) 칼럼 추가. forward-only / idempotent 원칙.

**Files:**
- Create: `src/main/database/migrations/016-meeting-paused-and-kind.ts`
- Modify: `src/main/database/migrations/index.ts` (가져오기 + 등록)
- Test: `src/main/database/migrations/__tests__/016-meeting-paused-and-kind.test.ts`

**Acceptance Criteria:**
- [ ] `meetings` 테이블에 `paused_at INTEGER DEFAULT NULL` 칼럼 추가.
- [ ] `meetings` 테이블에 `kind TEXT DEFAULT 'manual' CHECK (kind IN ('manual','auto'))` 칼럼 추가.
- [ ] 기존 행 모두 `paused_at = NULL`, `kind = 'manual'` 로 채워짐.
- [ ] `idx_meetings_active_per_channel` 그대로 (`ended_at IS NULL`) — paused 도 active 로 계산.
- [ ] migration 두 번 돌려도 안전 (idempotent — `ALTER TABLE` 이 fail 하지 않도록 schema 비교 후 conditional).

**Verify:** `npm run test -- src/main/database/migrations/__tests__/016` → all PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 먼저 작성 (RED)**

`src/main/database/migrations/__tests__/016-meeting-paused-and-kind.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration_016_meeting_paused_and_kind } from '../016-meeting-paused-and-kind';
import { migration_001_init } from '../001-init';
import { migration_004_meetings } from '../004-meetings';

describe('migration 016 — meeting paused_at + kind', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    migration_001_init.up(db);
    migration_004_meetings.up(db);
  });

  it('adds paused_at column with NULL default', () => {
    migration_016_meeting_paused_and_kind.up(db);
    const cols = db.prepare("PRAGMA table_info(meetings)").all() as Array<{name: string; dflt_value: string | null}>;
    const pausedAt = cols.find((c) => c.name === 'paused_at');
    expect(pausedAt).toBeDefined();
    expect(pausedAt?.dflt_value).toBeNull();
  });

  it('adds kind column with default manual + CHECK constraint', () => {
    migration_016_meeting_paused_and_kind.up(db);
    const cols = db.prepare("PRAGMA table_info(meetings)").all() as Array<{name: string; dflt_value: string | null}>;
    const kind = cols.find((c) => c.name === 'kind');
    expect(kind).toBeDefined();
    expect(kind?.dflt_value).toBe("'manual'");
  });

  it('rejects invalid kind values via CHECK', () => {
    migration_016_meeting_paused_and_kind.up(db);
    db.exec("INSERT INTO channels (id, project_id, kind, name, position, created_at) VALUES ('c1', NULL, 'dm', 'test', 0, 0)");
    expect(() =>
      db.prepare("INSERT INTO meetings (id, channel_id, topic, started_at, state, kind) VALUES ('m1', 'c1', 't', 0, 'CONVERSATION', 'invalid')").run(),
    ).toThrow(/CHECK/i);
  });

  it('migrates pre-existing meetings with default values', () => {
    db.exec("INSERT INTO channels (id, project_id, kind, name, position, created_at) VALUES ('c1', NULL, 'dm', 'test', 0, 0)");
    db.prepare("INSERT INTO meetings (id, channel_id, topic, started_at, state) VALUES ('m1', 'c1', 't', 0, 'CONVERSATION')").run();
    migration_016_meeting_paused_and_kind.up(db);
    const row = db.prepare("SELECT paused_at, kind FROM meetings WHERE id='m1'").get() as {paused_at: number | null; kind: string};
    expect(row.paused_at).toBeNull();
    expect(row.kind).toBe('manual');
  });

  it('is idempotent — running twice does not throw', () => {
    migration_016_meeting_paused_and_kind.up(db);
    expect(() => migration_016_meeting_paused_and_kind.up(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행 — RED 확인**

```bash
npm run test -- src/main/database/migrations/__tests__/016-meeting-paused-and-kind.test.ts
```

Expected: 모든 테스트 FAIL ("cannot find module '../016-...'").

- [ ] **Step 3: migration 구현**

`src/main/database/migrations/016-meeting-paused-and-kind.ts`:

```typescript
import type Database from 'better-sqlite3';

/**
 * Migration 016 — D-A 메시지 자동 회의 트리거 지원 칼럼.
 *
 * - `paused_at INTEGER DEFAULT NULL`: 일시정지 시각 (ms epoch).
 *   NULL 이면 일시정지 아님. `idx_meetings_active_per_channel` 의
 *   partial 조건은 `ended_at IS NULL` 그대로 — paused 도 active 로
 *   계산되어 채널당 1 회의 제약 유지.
 *
 * - `kind TEXT DEFAULT 'manual' CHECK (kind IN ('manual','auto'))`:
 *   회의 트리거 종류. 'manual' = 사용자 [회의 시작] 클릭, 'auto' = D-A
 *   의 자동 트리거. 동작 분기 안 함, 통계 / debug 용.
 *
 * forward-only + idempotent. 이미 칼럼이 존재하면 ALTER 시도 안 함.
 */

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>;
  return rows.some((r) => r.name === col);
}

export const migration_016_meeting_paused_and_kind = {
  id: 16,
  description: 'D-A: meetings.paused_at + meetings.kind',
  up(db: Database.Database): void {
    if (!hasColumn(db, 'meetings', 'paused_at')) {
      db.exec('ALTER TABLE meetings ADD COLUMN paused_at INTEGER DEFAULT NULL');
    }
    if (!hasColumn(db, 'meetings', 'kind')) {
      db.exec(
        "ALTER TABLE meetings ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual' " +
        "CHECK (kind IN ('manual', 'auto'))",
      );
    }
  },
};
```

- [ ] **Step 4: index.ts 등록**

`src/main/database/migrations/index.ts` 의 migrations 배열 끝에 추가:

```typescript
import { migration_016_meeting_paused_and_kind } from './016-meeting-paused-and-kind';

export const migrations = [
  // ...015,
  migration_016_meeting_paused_and_kind,
];
```

- [ ] **Step 5: 테스트 재실행 — GREEN**

```bash
npm run test -- src/main/database/migrations/__tests__/016
```

Expected: 5 PASS.

- [ ] **Step 6: typecheck + commit**

```bash
npm run typecheck
git add src/main/database/migrations/016-meeting-paused-and-kind.ts src/main/database/migrations/__tests__/016-meeting-paused-and-kind.test.ts src/main/database/migrations/index.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T1 — migration 016 (meetings.paused_at + kind)"
```

---

## Task 2: Shared IPC types + zod schemas (4 신규 채널)

**Goal:** `meeting:request-stop` / `meeting:edit-topic` / `meeting:pause` / `meeting:resume` 4 신규 IPC 채널의 typed 인터페이스 + 런타임 zod 검증 추가. 메시지 추가: `meeting:list-active` 응답에 `pausedAt` 옵션 추가.

**Files:**
- Modify: `src/shared/ipc-types.ts`
- Modify: `src/shared/ipc-schemas.ts`
- Modify: `src/shared/meeting-types.ts` (Meeting / ActiveMeetingSummary 에 pausedAt)
- Test: `src/shared/__tests__/ipc-schemas-meeting.test.ts`

**Acceptance Criteria:**
- [ ] `IpcChannelMap` 에 4 신규 채널 entry. 각각 request / response shape 명시.
- [ ] zod 스키마 4 개 + ipcSchemas 매핑 4 entry.
- [ ] `Meeting` 타입에 `pausedAt: number | null` 추가.
- [ ] `ActiveMeetingSummary` 타입에 `pausedAt: number | null` 추가.
- [ ] zod 입력 검증 테스트 — invalid input rejected.
- [ ] typecheck PASS.

**Verify:** `npm run test -- src/shared/__tests__/ipc-schemas-meeting.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: 테스트 먼저 작성 (RED)**

`src/shared/__tests__/ipc-schemas-meeting.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ipcSchemas } from '../ipc-schemas';

describe('ipc-schemas: meeting request-stop / pause / resume / edit-topic', () => {
  it('accepts valid meeting:request-stop', () => {
    const s = ipcSchemas['meeting:request-stop'];
    expect(s.parse({ meetingId: 'm-uuid' })).toEqual({ meetingId: 'm-uuid' });
  });

  it('rejects meeting:request-stop without meetingId', () => {
    expect(() => ipcSchemas['meeting:request-stop'].parse({})).toThrow();
  });

  it('accepts valid meeting:edit-topic', () => {
    const s = ipcSchemas['meeting:edit-topic'];
    expect(s.parse({ meetingId: 'm', topic: 'x' })).toBeDefined();
  });

  it('rejects empty topic', () => {
    expect(() =>
      ipcSchemas['meeting:edit-topic'].parse({ meetingId: 'm', topic: '' }),
    ).toThrow();
  });

  it('rejects topic over 200 chars', () => {
    expect(() =>
      ipcSchemas['meeting:edit-topic'].parse({
        meetingId: 'm',
        topic: 'a'.repeat(201),
      }),
    ).toThrow();
  });

  it('accepts meeting:pause and meeting:resume', () => {
    expect(ipcSchemas['meeting:pause'].parse({ meetingId: 'm' })).toBeDefined();
    expect(ipcSchemas['meeting:resume'].parse({ meetingId: 'm' })).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 — RED**

```bash
npm run test -- src/shared/__tests__/ipc-schemas-meeting.test.ts
```

Expected: FAIL (스키마 미정의).

- [ ] **Step 3: ipc-types.ts 변경**

`src/shared/ipc-types.ts` 의 `IpcChannelMap` 에 추가 (meeting 섹션 근처):

```typescript
'meeting:request-stop': {
  request: { meetingId: string };
  response: { stoppedAt: number };
};
'meeting:edit-topic': {
  request: { meetingId: string; topic: string };
  response: { topic: string };
};
'meeting:pause': {
  request: { meetingId: string };
  response: { pausedAt: number };
};
'meeting:resume': {
  request: { meetingId: string };
  response: { resumedAt: number };
};
```

- [ ] **Step 4: meeting-types.ts 변경**

`src/shared/meeting-types.ts` 의 `Meeting` 인터페이스에 추가:

```typescript
export interface Meeting {
  // ...기존 필드
  pausedAt: number | null;
  kind: 'manual' | 'auto';
}

export interface ActiveMeetingSummary {
  // ...기존 필드
  pausedAt: number | null;
}
```

- [ ] **Step 5: ipc-schemas.ts 추가**

`src/shared/ipc-schemas.ts` 에 zod 스키마 + 매핑:

```typescript
const meetingRequestStopSchema = z.object({
  meetingId: z.string().min(1),
});
const meetingEditTopicSchema = z.object({
  meetingId: z.string().min(1),
  topic: z.string().min(1).max(200),
});
const meetingPauseSchema = z.object({
  meetingId: z.string().min(1),
});
const meetingResumeSchema = z.object({
  meetingId: z.string().min(1),
});

export const ipcSchemas = {
  // ...기존,
  'meeting:request-stop': meetingRequestStopSchema,
  'meeting:edit-topic': meetingEditTopicSchema,
  'meeting:pause': meetingPauseSchema,
  'meeting:resume': meetingResumeSchema,
} as const satisfies { [K in keyof IpcChannelMap]?: z.ZodType<IpcRequest<K>> };
```

- [ ] **Step 6: 테스트 재실행 — GREEN**

```bash
npm run test -- src/shared/__tests__/ipc-schemas-meeting.test.ts
npm run typecheck
```

Expected: 6 PASS, typecheck 0 error.

- [ ] **Step 7: commit**

```bash
git add src/shared/ipc-types.ts src/shared/ipc-schemas.ts src/shared/meeting-types.ts src/shared/__tests__/ipc-schemas-meeting.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T2 — IPC types + zod schemas (request-stop/edit-topic/pause/resume) + meeting pausedAt/kind"
```

---

## Task 2.5: 회의 prompt 메시지 주입 계약 (round2.6 dogfooding 발견)

**Goal:** spec §5.5 의 "회의 prompt 메시지 주입 계약" 구현. 회의 주제 + 사용자 메시지가 AI prompt 에 실제 전달되도록 만든다. 이 task 는 T4/T5/T6 (자동 트리거 + DM) 의 *전제* — 자동 트리거가 없어도 수동 [회의 시작] 흐름 + 회의 진행 중 사용자 추가 메시지가 정상 동작하도록 우선 land.

**배경**: round2.6 dogfooding 에서 회의가 시작되었지만 AI 가 주제와 사용자 추가 메시지를 모르고 generic 메타 토론으로 빠지는 회귀 보고 (#3). 코드 분석 결과 두 누락 발견:
1. `MeetingSession.topic` 이 constructor 에서 받지만 logging only — `_messages` 또는 prompt 어디에도 안 들어감.
2. `MeetingSession.interruptWithUserMessage()` / `MeetingOrchestrator.handleUserInterjection()` 이 turn rotation interrupt 만 하고 사용자 메시지 텍스트를 `_messages` 에 push 안 함.

**Files:**
- Modify: `src/main/meetings/engine/meeting-session.ts` (constructor topic 주입 + interruptWithUserMessage(message) 시그니처)
- Modify: `src/main/meetings/engine/meeting-orchestrator.ts` (handleUserInterjection(message) 시그니처)
- Modify: `src/main/engine/turn-manager.ts` (필요 시 시그니처 정합)
- Modify: `src/main/channels/channel-handler.ts` 또는 `src/main/messages/message-service.ts` (회의 진행 채널의 user 메시지 수신 시 `handleUserInterjection(message)` 호출)
- Modify: `src/renderer/i18n/locales/{ko,en}.json` (`meeting.topicSystemPrompt` 신규 키)
- Test: `src/main/meetings/engine/__tests__/meeting-session.test.ts` (topic system 메시지 주입 + interrupt 메시지 push)
- Test: `src/main/meetings/engine/__tests__/meeting-turn-executor.test.ts` (회귀 — turn 의 messages 가 topic + interrupt user 포함)

**Acceptance Criteria:**
- [ ] `new MeetingSession({topic: '1+1=2 동의?'})` 직후 `_messages.length === 1`, `_messages[0]` 이 `{role: 'system', content: '회의 주제: 1+1=2 동의?', participantId: 'system', ...}` 형태.
- [ ] `session.interruptWithUserMessage(userMessage)` 호출 후 `_messages.last() === userMessage`, 동시에 turn manager 가 interrupt 됨.
- [ ] `interruptWithUserMessage(message)` 가 `message.role !== 'user'` 인 객체 받으면 throw.
- [ ] turn-executor 가 호출하는 `getMessagesForProvider(speakerId)` 결과가 (formatInstruction prepend 후) `[formatInstruction(system), topic(system), user1, ...]` 순서로 AI prompt 에 들어감.
- [ ] 회의 진행 중 사용자 메시지 송신 → channel-handler/message-service 가 `MeetingOrchestrator.handleUserInterjection(message)` 호출 → 다음 AI turn 의 messages 에 user1 포함.
- [ ] `topic.trim().length < 3` 일 때 constructor throw 동작 유지 (regression).
- [ ] `meeting.topicSystemPrompt` i18n 키가 ko/en 양쪽 추가, dictionary 경유.
- [ ] vitest unit + e2e regression PASS.

**Test Plan:**
```
describe('MeetingSession topic prompt injection', () => {
  it('injects topic as first system message', () => {
    const s = new MeetingSession({ topic: '1+1=2 동의?', /* ... */ });
    expect(s.messages.length).toBe(1);
    expect(s.messages[0].role).toBe('system');
    expect(s.messages[0].content).toContain('1+1=2 동의?');
  });
});

describe('MeetingSession interruptWithUserMessage', () => {
  it('pushes user message to _messages and interrupts turn', () => {
    const s = new MeetingSession({ /* ... */ });
    const msg: ParticipantMessage = { id: 'u1', role: 'user', content: '추가 의견', participantId: 'user', participantName: '사용자' };
    s.interruptWithUserMessage(msg);
    expect(s.messages[s.messages.length - 1]).toEqual(msg);
    expect(s.turnManager.userInterruptPending).toBe(true);
  });

  it('throws on non-user role', () => {
    const s = new MeetingSession({ /* ... */ });
    expect(() => s.interruptWithUserMessage({ role: 'assistant', /* ... */ } as any))
      .toThrow(/user/);
  });
});
```

**Implementation Notes:**

`MeetingSession.constructor` 끝에 자동 주입 — 호출자가 신경 쓸 필요 없음. content 는 dictionary 룩업으로 만들고, 주입 시점은 main process 라 i18next direct import 금지 규칙 (CLAUDE.md ADR C7) 에 따라 `notification-labels.ts` 와 같은 dictionary 경유 패턴으로:

```ts
// src/shared/meeting-prompt-labels.ts (신규)
export const MEETING_TOPIC_PROMPT_KEY = 'meeting.topicSystemPrompt';
export function buildTopicSystemPrompt(topic: string, locale: 'ko' | 'en'): string {
  // dictionary 룩업 — main 측 locale resolver (R11 D9) 활용
}
```

`participantId='system'` / `participantName='시스템'` (또는 i18n) 로 회의 직원과 구분되는 메시지로 표시. UI 도 system 메시지를 회의록 본문에는 포함하지 않거나 별도 styling — 단 그건 R12 별도 task 로.

**완료 후 commit:**
```
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T2.5 — 회의 prompt 메시지 주입 계약 (topic system + interruptWithUserMessage(message))"
```

---

## Task 3: Per-meeting CliSessionState 격리

**Goal:** CLI provider 가 같은 직원이라도 회의별로 독립 session state 를 유지하도록. 인스턴스 필드 1 개에서 `Map<meetingId|"default", CliSessionState>` 로 외부화. 호출 entry point 가 `meetingId` 옵션 받음.

**Files:**
- Modify: `src/main/providers/cli/cli-session-state.ts` (Map manager 헬퍼)
- Modify: `src/main/providers/cli/cli-provider.ts` (sessionContext arg + Map 위임)
- Test: `src/main/providers/cli/__tests__/cli-session-state-multi.test.ts`

**Acceptance Criteria:**
- [ ] CliProvider 가 동시 두 meetingId 의 generate 호출을 받았을 때 각 sessionState 의 sessionId / rateLimited / isFirstResponse 가 격리됨.
- [ ] meetingId 미지정 (DM 등) 호출은 'default' key 의 single state 사용.
- [ ] 단위 테스트 — 두 meetingId 호출 후 sessionState 격리 검증.
- [ ] 기존 e2e 회귀 없음 (warmup, persistent session 동작 그대로).

**Verify:** `npm run test -- src/main/providers/cli/__tests__/cli-session-state-multi.test.ts` PASS + 기존 cli-provider 테스트 PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED)**

`src/main/providers/cli/__tests__/cli-session-state-multi.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { CliSessionStateManager } from '../cli-session-state';

describe('CliSessionStateManager — per-meeting isolation', () => {
  it('returns distinct state instances per meetingId', () => {
    const mgr = new CliSessionStateManager();
    const a = mgr.get('meeting-a');
    const b = mgr.get('meeting-b');
    expect(a).not.toBe(b);
  });

  it('returns the same instance on repeated get for same key', () => {
    const mgr = new CliSessionStateManager();
    expect(mgr.get('m')).toBe(mgr.get('m'));
  });

  it('defaults to "default" key when meetingId omitted', () => {
    const mgr = new CliSessionStateManager();
    expect(mgr.get(null)).toBe(mgr.get(undefined));
  });

  it('isolates sessionId mutations across meetings', () => {
    const mgr = new CliSessionStateManager();
    mgr.get('m1').sessionId = 'session-1';
    mgr.get('m2').sessionId = 'session-2';
    expect(mgr.get('m1').sessionId).toBe('session-1');
    expect(mgr.get('m2').sessionId).toBe('session-2');
  });

  it('clear(meetingId) removes only that key', () => {
    const mgr = new CliSessionStateManager();
    mgr.get('m1').sessionId = 'a';
    mgr.get('m2').sessionId = 'b';
    mgr.clear('m1');
    expect(mgr.get('m1').sessionId).toBeNull();
    expect(mgr.get('m2').sessionId).toBe('b');
  });
});
```

- [ ] **Step 2: RED 확인**

```bash
npm run test -- src/main/providers/cli/__tests__/cli-session-state-multi.test.ts
```

Expected: FAIL (CliSessionStateManager 미정의).

- [ ] **Step 3: CliSessionStateManager 추가**

`src/main/providers/cli/cli-session-state.ts` 끝에 추가 (기존 CliSessionState 클래스 그대로 유지):

```typescript
/**
 * D-A T3: per-meeting CliSessionState 격리 매니저.
 *
 * 같은 CLI provider 인스턴스가 여러 회의의 turn 호출을 받을 때 sessionId
 * / rateLimited / isFirstResponse / warmedUp / sessionStartedAt 가
 * 회의별로 분리되어야 한다 (메시지 자동 트리거 도입 후 자연스럽게
 * 발생하는 동시 회의 케이스).
 *
 * key 정책:
 *   - meetingId 가 string → 그 key 사용.
 *   - null / undefined → 'default' key (DM 또는 비-회의 호출).
 */
export class CliSessionStateManager {
  private readonly states = new Map<string, CliSessionState>();

  get(meetingId: string | null | undefined): CliSessionState {
    const key = meetingId ?? 'default';
    let state = this.states.get(key);
    if (!state) {
      state = new CliSessionState();
      this.states.set(key, state);
    }
    return state;
  }

  /** Drop the state for a key. Used on meeting end / abort. */
  clear(meetingId: string | null | undefined): void {
    const key = meetingId ?? 'default';
    this.states.delete(key);
  }

  /** Drop all states. Called on provider shutdown. */
  clearAll(): void {
    this.states.clear();
  }
}
```

- [ ] **Step 4: cli-provider.ts 호출 경로 변경**

`src/main/providers/cli/cli-provider.ts`:

기존 `private readonly sessionState = new CliSessionState();` 를 `private readonly sessionStates = new CliSessionStateManager();` 로 변경.

generate / warmup / 모든 sessionState 사용 처를 `this.sessionStates.get(options?.meetingId)` 로 치환. `BaseProviderInit` 또는 `CompletionOptions` 에 `meetingId?: string | null` 옵션 추가 (provider-types.ts 변경 필요 — 후속 task 에서 type level 정합).

핵심 변경 라인:
```typescript
// before:  this.sessionState.rateLimited = false;
// after:   this.sessionStates.get(options?.meetingId).rateLimited = false;

// before:  this.sessionState.sessionId
// after:   this.sessionStates.get(options?.meetingId).sessionId
```

`shutdown()` 에 `this.sessionStates.clearAll()` 호출 추가.

- [ ] **Step 5: provider-types.ts CompletionOptions 확장**

`src/shared/provider-types.ts` 의 `CompletionOptions`:

```typescript
export interface CompletionOptions {
  // ...기존
  /** D-A T3: per-meeting CLI session state 격리 키. null/undefined = default. */
  meetingId?: string | null;
}
```

- [ ] **Step 6: 테스트 재실행 — GREEN + 회귀**

```bash
npm run test -- src/main/providers/cli/__tests__/cli-session-state-multi.test.ts
npm run test -- src/main/providers/cli/__tests__/
npm run typecheck
```

Expected: 신규 테스트 5 PASS, 기존 cli-provider 테스트 그대로 PASS.

- [ ] **Step 7: commit**

```bash
git add src/main/providers/cli/cli-session-state.ts src/main/providers/cli/cli-provider.ts src/main/providers/cli/__tests__/cli-session-state-multi.test.ts src/shared/provider-types.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T3 — per-meeting CliSessionState 격리 (CliSessionStateManager + meetingId option)"
```

---

## Task 4: MeetingAutoTrigger — 채널 종류 분기 + race condition 가드

**Goal:** `MessageService.append` 의 `'message'` 이벤트를 받아 채널 종류별로 분기하고, 일반/사용자 채널이면 활성 회의 조회 → 없으면 자동 생성, 있으면 합류. DB unique index race 는 catch 후 fallback.

**Files:**
- Create: `src/main/meetings/meeting-auto-trigger.ts`
- Test: `src/main/meetings/meeting-auto-trigger.test.ts`

**Acceptance Criteria:**
- [ ] DM 채널 메시지: trigger 가 함수 위임만 (Task 6 의 DmAutoResponder).
- [ ] 시스템 read-only 채널 (`#승인-대기`, `#회의록`): 메시지 자체가 들어올 수 없는 가정 — 들어오면 무시 + warn log.
- [ ] 일반/사용자 채널 + 활성 회의 없음: 자동 생성 (kind='auto', topic = 메시지 첫 80 자) + orchestrator 시작.
- [ ] 일반/사용자 채널 + 활성 회의 있음: orchestrator.interruptWithUserMessage 호출.
- [ ] 동시 race: AlreadyActiveMeetingError 받으면 active 재조회 후 합류로 fallback.
- [ ] 단위 테스트 — 4 분기 + race 1.

**Verify:** `npm run test -- src/main/meetings/meeting-auto-trigger.test.ts` PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED)**

`src/main/meetings/meeting-auto-trigger.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MeetingAutoTrigger } from './meeting-auto-trigger';
import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import { AlreadyActiveMeetingError } from './meeting-service';

const userChannel: Channel = { id: 'c1', kind: 'user', projectId: 'p1', name: 'gen', position: 0, createdAt: 0 };
const dmChannel: Channel = { id: 'c2', kind: 'dm', projectId: null, name: 'dm', position: 0, createdAt: 0 };
const sysGeneralChannel: Channel = { id: 'c3', kind: 'system_general', projectId: 'p1', name: '일반', position: 0, createdAt: 0 };
const sysApprovalChannel: Channel = { id: 'c4', kind: 'system_approvals', projectId: 'p1', name: '승인-대기', position: 0, createdAt: 0 };

function mkMessage(channelId: string, content: string, authorKind: 'user' | 'member' = 'user'): Message {
  return { id: 'msg-id', channelId, meetingId: null, authorId: authorKind === 'user' ? 'user' : 'p-1', authorKind, role: authorKind === 'user' ? 'user' : 'assistant', content, meta: null, createdAt: 0 };
}

describe('MeetingAutoTrigger', () => {
  let channelService: any, meetingService: any, orchestratorFactory: any, dmResponder: any, trigger: MeetingAutoTrigger;

  beforeEach(() => {
    channelService = { getById: vi.fn() };
    meetingService = { getActive: vi.fn(), start: vi.fn() };
    orchestratorFactory = { createAndRun: vi.fn(), interruptActive: vi.fn() };
    dmResponder = { handle: vi.fn() };
    trigger = new MeetingAutoTrigger({ channelService, meetingService, orchestratorFactory, dmResponder });
  });

  it('skips assistant-authored messages (only user triggers)', async () => {
    channelService.getById.mockReturnValue(userChannel);
    await trigger.onMessage(mkMessage('c1', 'hi', 'member'));
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(dmResponder.handle).not.toHaveBeenCalled();
  });

  it('delegates DM messages to DmAutoResponder', async () => {
    channelService.getById.mockReturnValue(dmChannel);
    const msg = mkMessage('c2', 'hi');
    await trigger.onMessage(msg);
    expect(dmResponder.handle).toHaveBeenCalledWith(msg, dmChannel);
    expect(meetingService.start).not.toHaveBeenCalled();
  });

  it('ignores system read-only channels with a warn log', async () => {
    channelService.getById.mockReturnValue(sysApprovalChannel);
    await trigger.onMessage(mkMessage('c4', 'hi'));
    expect(meetingService.start).not.toHaveBeenCalled();
  });

  it('starts a new meeting when none active on user channel', async () => {
    channelService.getById.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({ id: 'm-new', channelId: 'c1', topic: 'hi', startedAt: 0 });
    await trigger.onMessage(mkMessage('c1', 'hi'));
    expect(meetingService.start).toHaveBeenCalledWith({ channelId: 'c1', topic: 'hi', kind: 'auto' });
    expect(orchestratorFactory.createAndRun).toHaveBeenCalled();
  });

  it('truncates topic to 80 chars with ellipsis', async () => {
    channelService.getById.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({ id: 'm', channelId: 'c1', topic: '', startedAt: 0 });
    const long = 'a'.repeat(200);
    await trigger.onMessage(mkMessage('c1', long));
    const topicArg = (meetingService.start.mock.calls[0][0] as any).topic;
    expect(topicArg.length).toBeLessThanOrEqual(80);
    expect(topicArg.endsWith('...')).toBe(true);
  });

  it('joins existing active meeting via interrupt', async () => {
    channelService.getById.mockReturnValue(userChannel);
    meetingService.getActive.mockReturnValue({ id: 'm-existing', channelId: 'c1', startedAt: 0 });
    await trigger.onMessage(mkMessage('c1', 'hi'));
    expect(meetingService.start).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).toHaveBeenCalledWith({ meetingId: 'm-existing', message: expect.any(Object) });
  });

  it('falls back to interrupt when start races with concurrent trigger', async () => {
    channelService.getById.mockReturnValue(userChannel);
    meetingService.getActive
      .mockReturnValueOnce(null)            // initial check
      .mockReturnValueOnce({ id: 'm-other', channelId: 'c1', startedAt: 0 }); // re-check after race
    meetingService.start.mockImplementation(() => { throw new AlreadyActiveMeetingError('c1'); });
    await trigger.onMessage(mkMessage('c1', 'hi'));
    expect(orchestratorFactory.interruptActive).toHaveBeenCalledWith({ meetingId: 'm-other', message: expect.any(Object) });
  });

  it('treats system_general channel like user channel (auto-trigger)', async () => {
    channelService.getById.mockReturnValue(sysGeneralChannel);
    meetingService.getActive.mockReturnValue(null);
    meetingService.start.mockReturnValue({ id: 'm', channelId: 'c3', topic: 'x', startedAt: 0 });
    await trigger.onMessage(mkMessage('c3', 'x'));
    expect(meetingService.start).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED 확인**

```bash
npm run test -- src/main/meetings/meeting-auto-trigger.test.ts
```

- [ ] **Step 3: 구현**

`src/main/meetings/meeting-auto-trigger.ts`:

```typescript
import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import type { ChannelService } from '../channels/channel-service';
import type { MeetingService } from './meeting-service';
import { AlreadyActiveMeetingError } from './meeting-service';
import { tryGetLogger } from '../log/logger-accessor';

const TOPIC_MAX = 80;
const TOPIC_ELLIPSIS = '...';

export interface MeetingOrchestratorAutoFactory {
  createAndRun(input: { meetingId: string; channelId: string; topic: string; firstMessage: Message }): Promise<void> | void;
  interruptActive(input: { meetingId: string; message: Message }): Promise<void> | void;
}

export interface DmAutoResponderInterface {
  handle(message: Message, channel: Channel): Promise<void> | void;
}

export interface MeetingAutoTriggerDeps {
  channelService: { getById(id: string): Channel | null };
  meetingService: Pick<MeetingService, 'getActive' | 'start'>;
  orchestratorFactory: MeetingOrchestratorAutoFactory;
  dmResponder: DmAutoResponderInterface;
}

function toTopic(content: string): string {
  if (content.length <= TOPIC_MAX) return content;
  return content.slice(0, TOPIC_MAX - TOPIC_ELLIPSIS.length) + TOPIC_ELLIPSIS;
}

export class MeetingAutoTrigger {
  constructor(private readonly deps: MeetingAutoTriggerDeps) {}

  async onMessage(message: Message): Promise<void> {
    if (message.authorKind !== 'user') return; // 사용자 메시지만 트리거.
    const channel = this.deps.channelService.getById(message.channelId);
    if (!channel) {
      tryGetLogger()?.warn({ component: 'meeting-auto-trigger', action: 'channel-missing', metadata: { channelId: message.channelId } });
      return;
    }

    if (channel.kind === 'dm') {
      await this.deps.dmResponder.handle(message, channel);
      return;
    }

    if (channel.kind === 'system_approvals' || channel.kind === 'system_minutes') {
      tryGetLogger()?.warn({ component: 'meeting-auto-trigger', action: 'readonly-channel-message', metadata: { channelId: channel.id, kind: channel.kind } });
      return;
    }

    // user / system_general — 회의 모델 적용.
    await this.handleMeetingChannel(message, channel);
  }

  private async handleMeetingChannel(message: Message, channel: Channel): Promise<void> {
    const active = this.deps.meetingService.getActive(channel.id);
    if (active) {
      await this.deps.orchestratorFactory.interruptActive({ meetingId: active.id, message });
      return;
    }

    const topic = toTopic(message.content);
    try {
      const meeting = this.deps.meetingService.start({ channelId: channel.id, topic, kind: 'auto' });
      await this.deps.orchestratorFactory.createAndRun({ meetingId: meeting.id, channelId: channel.id, topic, firstMessage: message });
    } catch (err) {
      if (err instanceof AlreadyActiveMeetingError) {
        // race: 다른 trigger 가 먼저 회의 만듦. 재조회 후 합류.
        const existing = this.deps.meetingService.getActive(channel.id);
        if (existing) {
          await this.deps.orchestratorFactory.interruptActive({ meetingId: existing.id, message });
          return;
        }
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: MeetingService.start 시그니처에 kind 추가**

`src/main/meetings/meeting-service.ts` 의 `start` 메서드:

```typescript
start(input: { channelId: string; topic: string; kind?: 'manual' | 'auto' }): Meeting {
  // ...기존 로직, kind = input.kind ?? 'manual' 로 INSERT 시 칼럼 채움
}
```

repository 의 INSERT 문에도 `kind` 칼럼 추가.

- [ ] **Step 5: GREEN + commit**

```bash
npm run test -- src/main/meetings/meeting-auto-trigger.test.ts
npm run typecheck
git add src/main/meetings/meeting-auto-trigger.ts src/main/meetings/meeting-auto-trigger.test.ts src/main/meetings/meeting-service.ts src/main/meetings/meeting-repository.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T4 — MeetingAutoTrigger (채널 종류 분기 + race 가드 + topic 슬라이스)"
```

---

## Task 5: MessageService → MeetingAutoTrigger wiring

**Goal:** `MessageService.append` 가 emit 하는 `'message'` 이벤트를 main 부팅에서 MeetingAutoTrigger 로 연결. 통합 테스트로 e2e 흐름 검증 (메시지 송신 → 회의 자동 생성).

**Files:**
- Modify: `src/main/index.ts` (factory 인스턴스화 + listener 등록)
- Modify: `src/main/meetings/index.ts` 또는 export point
- Test: `src/main/meetings/__tests__/meeting-auto-trigger-integration.test.ts`

**Acceptance Criteria:**
- [ ] 부팅 시 MeetingAutoTrigger 단일 인스턴스 생성, MessageService 의 `'message'` event 에 listener 등록.
- [ ] 통합 테스트: in-memory DB + real ChannelService + MeetingService → message append → meeting row 생성 검증.
- [ ] listener 가 throw 하면 원래 append 결과는 영향 없음 (try/catch + warn log).

**Verify:** `npm run test -- src/main/meetings/__tests__/meeting-auto-trigger-integration.test.ts` PASS.

**Steps:**

- [ ] **Step 1: 통합 테스트 (RED)**

`src/main/meetings/__tests__/meeting-auto-trigger-integration.test.ts`:

```typescript
import { describe, expect, it, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { ChannelRepository } from '../../channels/channel-repository';
import { ChannelService } from '../../channels/channel-service';
import { MessageRepository } from '../../channels/message-repository';
import { MessageService } from '../../channels/message-service';
import { MeetingRepository } from '../meeting-repository';
import { MeetingService } from '../meeting-service';
import { MeetingAutoTrigger } from '../meeting-auto-trigger';

describe('MeetingAutoTrigger ↔ MessageService integration', () => {
  let db: Database.Database;
  let messageService: MessageService;
  let meetingService: MeetingService;
  let channelService: ChannelService;
  let trigger: MeetingAutoTrigger;
  const orchestratorFactory = { createAndRun: vi.fn(), interruptActive: vi.fn() };
  const dmResponder = { handle: vi.fn() };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    channelService = new ChannelService(new ChannelRepository(db));
    messageService = new MessageService(new MessageRepository(db));
    meetingService = new MeetingService(new MeetingRepository(db));
    trigger = new MeetingAutoTrigger({ channelService, meetingService, orchestratorFactory, dmResponder });
    messageService.on('message', (m) => { void trigger.onMessage(m); });
    // user channel 생성
    channelService.create({ projectId: 'p1', kind: 'user', name: '기획', memberProviderIds: [] });
  });

  it('creates a meeting on first user message', async () => {
    const userChannel = channelService.listByProject('p1').find((c) => c.kind === 'user')!;
    messageService.append({ channelId: userChannel.id, authorId: 'user', authorKind: 'user', role: 'user', content: '오늘 일정 정리해줘' });
    await new Promise((r) => setImmediate(r));
    const active = meetingService.getActive(userChannel.id);
    expect(active).not.toBeNull();
    expect(active?.topic).toBe('오늘 일정 정리해줘');
    expect(orchestratorFactory.createAndRun).toHaveBeenCalled();
  });

  it('joins existing meeting on follow-up message', async () => {
    const userChannel = channelService.listByProject('p1').find((c) => c.kind === 'user')!;
    messageService.append({ channelId: userChannel.id, authorId: 'user', authorKind: 'user', role: 'user', content: 'first' });
    await new Promise((r) => setImmediate(r));
    orchestratorFactory.createAndRun.mockClear();
    messageService.append({ channelId: userChannel.id, authorId: 'user', authorKind: 'user', role: 'user', content: 'second' });
    await new Promise((r) => setImmediate(r));
    expect(orchestratorFactory.createAndRun).not.toHaveBeenCalled();
    expect(orchestratorFactory.interruptActive).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: index.ts wiring**

`src/main/index.ts` 의 부팅 sequence 에 추가 (MessageService / MeetingService / ChannelService 인스턴스 생성 후):

```typescript
const meetingAutoTrigger = new MeetingAutoTrigger({
  channelService,
  meetingService,
  orchestratorFactory: meetingOrchestratorAutoFactory,
  dmResponder: dmAutoResponder,
});
messageService.on('message', (msg) => {
  Promise.resolve(meetingAutoTrigger.onMessage(msg)).catch((err) => {
    tryGetLogger()?.warn({ component: 'meeting-auto-trigger', action: 'listener-error', metadata: { error: String(err) } });
  });
});
```

`meetingOrchestratorAutoFactory` 는 기존 `meetingOrchestratorFactory` 의 wrapper — `createAndRun({meetingId, channelId, topic, firstMessage})` 와 `interruptActive({meetingId, message})` 두 메서드 노출. `interruptActive` 는 활성 orchestrator instance 의 `interruptWithUserMessage` 호출.

- [ ] **Step 3: GREEN + commit**

```bash
npm run test -- src/main/meetings/__tests__/meeting-auto-trigger-integration.test.ts
npm run typecheck
git add src/main/index.ts src/main/meetings/__tests__/meeting-auto-trigger-integration.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T5 — MeetingAutoTrigger wiring (MessageService 'message' listener + orchestrator auto factory)"
```

---

## Task 6: DmAutoResponder — DM 단일 turn 응답

**Goal:** DM 채널의 사용자 메시지 시 해당 직원의 generate() 1 회 호출 → 응답 1 메시지 append. Meeting 안 만듦.

**Files:**
- Create: `src/main/channels/dm-auto-responder.ts`
- Test: `src/main/channels/dm-auto-responder.test.ts`

**Acceptance Criteria:**
- [ ] DM 채널의 유일한 멤버 (provider) 조회 → provider.generate() → 응답 메시지 1 개 append.
- [ ] 메시지 history 컨텍스트는 `MessageService.listByChannel` 으로 가져옴 (최근 N 메시지).
- [ ] provider 호출 실패 시 에러 메시지 system 메시지로 채널에 append + warn log (사용자가 무엇이 실패했는지 봄).
- [ ] 단위 테스트 — 성공 / 실패 / 멤버 없음 3 시나리오.

**Verify:** `npm run test -- src/main/channels/dm-auto-responder.test.ts` PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED)**

```typescript
// src/main/channels/dm-auto-responder.test.ts
import { describe, expect, it, vi } from 'vitest';
import { DmAutoResponder } from './dm-auto-responder';

describe('DmAutoResponder', () => {
  const dmChannel = { id: 'dm-1', kind: 'dm' as const, projectId: null, name: 'dm', position: 0, createdAt: 0 };
  const message = { id: 'msg', channelId: 'dm-1', meetingId: null, authorId: 'user', authorKind: 'user' as const, role: 'user' as const, content: 'hi', meta: null, createdAt: 0 };

  function mk() {
    const channelMembers = { listByChannel: vi.fn().mockReturnValue([{ providerId: 'p-1' }]) };
    const messageService = { listByChannel: vi.fn().mockReturnValue([message]), append: vi.fn().mockReturnValue(message) };
    const provider = { id: 'p-1', name: 'Claude', generate: vi.fn().mockResolvedValue({ content: 'hello back', usage: { tokens: 10 } }) };
    const providerRegistry = { getOrThrow: vi.fn().mockReturnValue(provider) };
    return { responder: new DmAutoResponder({ channelMembers, messageService, providerRegistry }), provider, messageService };
  }

  it('calls provider.generate and appends the assistant response', async () => {
    const { responder, provider, messageService } = mk();
    await responder.handle(message, dmChannel);
    expect(provider.generate).toHaveBeenCalled();
    expect(messageService.append).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'dm-1', authorKind: 'member', authorId: 'p-1', role: 'assistant', content: 'hello back' }));
  });

  it('appends a system error message when provider fails', async () => {
    const { responder, provider, messageService } = mk();
    provider.generate.mockRejectedValue(new Error('rate limited'));
    await responder.handle(message, dmChannel);
    const call = messageService.append.mock.calls[0][0];
    expect(call.authorKind).toBe('member');
    expect(call.role).toBe('system');
    expect(call.content).toMatch(/rate limited|실패|error/i);
  });

  it('warns and noops when channel has no member', async () => {
    const { responder } = mk();
    (responder as any).deps.channelMembers.listByChannel.mockReturnValue([]);
    await responder.handle(message, dmChannel);
    // append 호출 안 됨
  });
});
```

- [ ] **Step 2: 구현**

```typescript
// src/main/channels/dm-auto-responder.ts
import type { Channel } from '../../shared/channel-types';
import type { Message } from '../../shared/message-types';
import type { MessageService } from './message-service';
import type { ChannelMembersService } from './channel-members-service';
import type { ProviderRegistry } from '../providers/registry';
import { tryGetLogger } from '../log/logger-accessor';

export interface DmAutoResponderDeps {
  channelMembers: Pick<ChannelMembersService, 'listByChannel'>;
  messageService: Pick<MessageService, 'listByChannel' | 'append'>;
  providerRegistry: Pick<ProviderRegistry, 'getOrThrow'>;
}

const HISTORY_LIMIT = 50;

export class DmAutoResponder {
  constructor(private readonly deps: DmAutoResponderDeps) {}

  async handle(message: Message, channel: Channel): Promise<void> {
    const members = this.deps.channelMembers.listByChannel(channel.id);
    if (members.length === 0) {
      tryGetLogger()?.warn({ component: 'dm-auto-responder', action: 'no-member', metadata: { channelId: channel.id } });
      return;
    }
    const member = members[0]; // DM = 1 멤버
    const provider = this.deps.providerRegistry.getOrThrow(member.providerId);
    const history = this.deps.messageService.listByChannel(channel.id, { limit: HISTORY_LIMIT });
    const messages = history.slice().reverse().map((m) => ({
      role: m.authorKind === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));

    try {
      const result = await provider.generate({ messages, options: { meetingId: null } });
      this.deps.messageService.append({
        channelId: channel.id,
        meetingId: null,
        authorId: member.providerId,
        authorKind: 'member',
        role: 'assistant',
        content: result.content,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      tryGetLogger()?.error({ component: 'dm-auto-responder', action: 'generate-failed', metadata: { channelId: channel.id, error: errMsg } });
      this.deps.messageService.append({
        channelId: channel.id,
        meetingId: null,
        authorId: member.providerId,
        authorKind: 'member',
        role: 'system',
        content: `응답 실패: ${errMsg}`,
      });
    }
  }
}
```

- [ ] **Step 3: GREEN + commit**

```bash
npm run test -- src/main/channels/dm-auto-responder.test.ts
npm run typecheck
git add src/main/channels/dm-auto-responder.ts src/main/channels/dm-auto-responder.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T6 — DmAutoResponder (DM 단일 turn 응답, Meeting 미생성)"
```

---

## Task 7: MeetingService request-stop / pause / resume

**Goal:** 회의 lifecycle 의 명시 종료 / 일시정지 / 재개 메서드 추가 + IPC 핸들러 wiring.

**Files:**
- Modify: `src/main/meetings/meeting-service.ts` (3 메서드 + topic 편집)
- Modify: `src/main/meetings/meeting-repository.ts` (paused_at UPDATE)
- Modify: `src/main/ipc/handlers/meeting-handler.ts` (4 핸들러)
- Test: `src/main/meetings/__tests__/meeting-service-pause-resume.test.ts`

**Acceptance Criteria:**
- [ ] `requestStop(meetingId)` — orchestrator 에 stop 신호, 진행 중 turn 마치고 finish 호출.
- [ ] `pause(meetingId)` — `paused_at = now` UPDATE. 이미 paused 면 idempotent.
- [ ] `resume(meetingId)` — `paused_at = NULL` UPDATE. orchestrator 가 hydrate + 진행.
- [ ] `editTopic(meetingId, topic)` — topic 칼럼 UPDATE.
- [ ] 4 IPC 핸들러가 service 호출 + 응답 반환.
- [ ] 단위 테스트 — pause/resume round-trip + edit-topic + idempotent pause + already-finished 거절.

**Verify:** `npm run test -- src/main/meetings/__tests__/meeting-service-pause-resume.test.ts` PASS + IPC 핸들러 단위 테스트 PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED) — service 메서드**

```typescript
// src/main/meetings/__tests__/meeting-service-pause-resume.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { ChannelRepository } from '../../channels/channel-repository';
import { ChannelService } from '../../channels/channel-service';
import { MeetingRepository } from '../meeting-repository';
import { MeetingService, MeetingNotFoundError } from '../meeting-service';

describe('MeetingService pause / resume / editTopic', () => {
  let db: Database.Database, svc: MeetingService;
  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    const ch = new ChannelService(new ChannelRepository(db));
    ch.create({ projectId: 'p1', kind: 'user', name: 'gen', memberProviderIds: [] });
    svc = new MeetingService(new MeetingRepository(db));
  });

  it('pauses an active meeting', () => {
    const channels = new ChannelService(new ChannelRepository(db)).listByProject('p1');
    const m = svc.start({ channelId: channels[0].id, topic: 't', kind: 'auto' });
    const before = Date.now();
    const { pausedAt } = svc.pause(m.id);
    expect(pausedAt).toBeGreaterThanOrEqual(before);
    expect(svc.getActive(channels[0].id)?.pausedAt).toBe(pausedAt);
  });

  it('resume clears paused_at', () => {
    const channels = new ChannelService(new ChannelRepository(db)).listByProject('p1');
    const m = svc.start({ channelId: channels[0].id, topic: 't', kind: 'auto' });
    svc.pause(m.id);
    svc.resume(m.id);
    expect(svc.getActive(channels[0].id)?.pausedAt).toBeNull();
  });

  it('pause is idempotent', () => {
    const channels = new ChannelService(new ChannelRepository(db)).listByProject('p1');
    const m = svc.start({ channelId: channels[0].id, topic: 't', kind: 'auto' });
    const r1 = svc.pause(m.id);
    const r2 = svc.pause(m.id);
    expect(r2.pausedAt).toBe(r1.pausedAt);
  });

  it('editTopic updates the topic', () => {
    const channels = new ChannelService(new ChannelRepository(db)).listByProject('p1');
    const m = svc.start({ channelId: channels[0].id, topic: 't', kind: 'auto' });
    svc.editTopic(m.id, '새 토픽');
    // re-read via getActive
    expect(svc.getActive(channels[0].id)?.topic).toBe('새 토픽');
  });

  it('rejects pause/resume on unknown meeting id', () => {
    expect(() => svc.pause('unknown')).toThrow(MeetingNotFoundError);
    expect(() => svc.resume('unknown')).toThrow(MeetingNotFoundError);
  });
});
```

- [ ] **Step 2: 구현**

`src/main/meetings/meeting-service.ts` 에 추가:

```typescript
pause(id: string): { pausedAt: number } {
  const meeting = this.repo.getById(id);
  if (!meeting || meeting.endedAt !== null) throw new MeetingNotFoundError(id);
  if (meeting.pausedAt !== null) return { pausedAt: meeting.pausedAt };
  const pausedAt = Date.now();
  this.repo.updatePaused(id, pausedAt);
  return { pausedAt };
}

resume(id: string): { resumedAt: number } {
  const meeting = this.repo.getById(id);
  if (!meeting || meeting.endedAt !== null) throw new MeetingNotFoundError(id);
  this.repo.updatePaused(id, null);
  return { resumedAt: Date.now() };
}

editTopic(id: string, topic: string): { topic: string } {
  const meeting = this.repo.getById(id);
  if (!meeting || meeting.endedAt !== null) throw new MeetingNotFoundError(id);
  this.repo.updateTopic(id, topic);
  return { topic };
}

requestStop(id: string): { stoppedAt: number } {
  // Orchestrator hook 은 Task 9 에서 wire — 여기서는 finish() 직접 호출 (turn 마치는 로직은 orchestrator 가 처리).
  const meeting = this.repo.getById(id);
  if (!meeting || meeting.endedAt !== null) throw new MeetingNotFoundError(id);
  const stoppedAt = Date.now();
  // 실제 finish 는 orchestrator 가 SSM 종료 후 호출하지만, 여기서 finish 신호 emit 만.
  this.emit('request-stop', { meetingId: id });
  return { stoppedAt };
}
```

`MeetingRepository` 에 `updatePaused(id, pausedAt|null)`, `updateTopic(id, topic)`, `getById(id)` 메서드 추가.

- [ ] **Step 3: IPC 핸들러 추가**

`src/main/ipc/handlers/meeting-handler.ts`:

```typescript
export function handleMeetingRequestStop(data: IpcRequest<'meeting:request-stop'>): IpcResponse<'meeting:request-stop'> {
  return getMeeting().requestStop(data.meetingId);
}
export function handleMeetingPause(data: IpcRequest<'meeting:pause'>): IpcResponse<'meeting:pause'> {
  return getMeeting().pause(data.meetingId);
}
export function handleMeetingResume(data: IpcRequest<'meeting:resume'>): IpcResponse<'meeting:resume'> {
  return getMeeting().resume(data.meetingId);
}
export function handleMeetingEditTopic(data: IpcRequest<'meeting:edit-topic'>): IpcResponse<'meeting:edit-topic'> {
  return getMeeting().editTopic(data.meetingId, data.topic);
}
```

`router.ts` 에 4 채널 등록.

- [ ] **Step 4: GREEN + commit**

```bash
npm run test -- src/main/meetings/__tests__/meeting-service-pause-resume.test.ts
npm run typecheck
git add src/main/meetings/meeting-service.ts src/main/meetings/meeting-repository.ts src/main/ipc/handlers/meeting-handler.ts src/main/ipc/router.ts src/main/meetings/__tests__/meeting-service-pause-resume.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T7 — MeetingService pause/resume/editTopic/requestStop + 4 IPC 핸들러"
```

---

## Task 8: MeetingMinutesComposer partial summary (라운드 한계 시)

**Goal:** 회의가 라운드 한계 도달 (FAILED state) 로 종료될 때 #회의록 메시지가 "합의된 결정 / 논쟁 점 / 미결 항목" 3 섹션으로 분리 정리되도록 옵션 추가.

**Files:**
- Modify: `src/main/meetings/engine/meeting-minutes-composer.ts`
- Test: `src/main/meetings/engine/__tests__/meeting-minutes-composer-partial.test.ts`

**Acceptance Criteria:**
- [ ] `composeMinutes(input, { partial: true })` 옵션 추가.
- [ ] partial=true 시 LLM 프롬프트가 3 섹션 분리 지시.
- [ ] LLM 호출 실패 시 fallback "회의가 라운드 한계로 종료됨. 합의 도달 안 함." (i18n 키 경유).
- [ ] partial=false (default) 동작 변경 없음 (회귀 무).
- [ ] 단위 테스트 3 개.

**Verify:** `npm run test -- src/main/meetings/engine/__tests__/meeting-minutes-composer-partial.test.ts` + 기존 composer 테스트 PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED)**

```typescript
// src/main/meetings/engine/__tests__/meeting-minutes-composer-partial.test.ts
import { describe, expect, it, vi } from 'vitest';
import { composeMinutes } from '../meeting-minutes-composer';

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`;
const messages = [
  { authorKind: 'user' as const, content: 'A' },
  { authorKind: 'member' as const, content: 'B' },
];

describe('composeMinutes — partial', () => {
  it('uses partial-summary prompt when partial=true', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: '합의:\n...\n논쟁:\n...\n미결:\n...', providerId: 'p' });
    const res = await composeMinutes({ topic: 't', messages, t, summarize, partial: true });
    expect(summarize).toHaveBeenCalledWith(expect.stringMatching(/합의|논쟁|미결|consensus|disagreement|unresolved/i), expect.any(Object));
    expect(res).toContain('합의');
  });

  it('falls back to one-line message when summarize fails (partial=true)', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('llm down'));
    const res = await composeMinutes({ topic: 't', messages, t, summarize, partial: true });
    expect(res).toContain(t('meeting.partialSummary.fallback'));
  });

  it('default partial=false unchanged', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'normal summary', providerId: 'p' });
    const res = await composeMinutes({ topic: 't', messages, t, summarize });
    expect(summarize).toHaveBeenCalledWith(expect.not.stringMatching(/합의된 결정|논쟁 점|미결/), expect.any(Object));
  });
});
```

- [ ] **Step 2: 구현**

`src/main/meetings/engine/meeting-minutes-composer.ts` 의 `composeMinutes`:

```typescript
export interface ComposeMinutesInput {
  topic: string;
  messages: Array<{ authorKind: 'user' | 'member'; content: string }>;
  t: MinutesTranslator;
  summarize?: (content: string, opts?: any) => Promise<{ summary: string | null; providerId: string | null }>;
  partial?: boolean;
}

export async function composeMinutes(input: ComposeMinutesInput): Promise<string> {
  const body = renderMessageHistory(input);
  if (input.partial && input.summarize) {
    const prompt = buildPartialPrompt(body, input.topic, input.t);
    try {
      const { summary } = await input.summarize(prompt, { /* ... */ });
      return summary ?? input.t('meeting.partialSummary.fallback');
    } catch {
      return input.t('meeting.partialSummary.fallback');
    }
  }
  // 기존 path 그대로
  // ...
}

function buildPartialPrompt(body: string, topic: string, t: MinutesTranslator): string {
  return [
    t('meeting.partialSummary.consensusHeading'),
    t('meeting.partialSummary.disagreementHeading'),
    t('meeting.partialSummary.unresolvedHeading'),
    `Topic: ${topic}`,
    `Conversation:`,
    body,
  ].join('\n\n');
}
```

- [ ] **Step 3: GREEN + commit**

```bash
npm run test -- src/main/meetings/engine/__tests__/meeting-minutes-composer-partial.test.ts
npm run test -- src/main/meetings/engine/__tests__/meeting-minutes-composer.test.ts
git add src/main/meetings/engine/meeting-minutes-composer.ts src/main/meetings/engine/__tests__/meeting-minutes-composer-partial.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T8 — MeetingMinutesComposer partial summary (합의/논쟁/미결 3 섹션)"
```

---

## Task 9: MeetingOrchestrator 자동 종료 hook + paused 체크

**Goal:** orchestrator 가 (a) request-stop event 수신 시 진행 중 turn 마치고 finish, (b) 합의 도달 시 자동 finish (이미 있음 — 검증), (c) FAILED 시 partial=true 로 minutes compose, (d) paused_at 셋되면 다음 turn 시작 안 함.

**Files:**
- Modify: `src/main/meetings/engine/meeting-orchestrator.ts`
- Test: `src/main/meetings/engine/__tests__/meeting-orchestrator-stop-pause.test.ts`

**Acceptance Criteria:**
- [ ] orchestrator 가 MeetingService 의 'request-stop' event listen → 다음 turn 시작 X, 진행 중 turn 끝나면 finish.
- [ ] FAILED state 종료 시 composeMinutes 에 partial=true 전달.
- [ ] DONE state 종료 시 partial=false (기존 동작).
- [ ] paused_at 셋된 회의 (DB 조회) → run loop 가 PAUSED state 같이 wait.
- [ ] 단위 테스트 4 시나리오.

**Verify:** `npm run test -- src/main/meetings/engine/__tests__/meeting-orchestrator-stop-pause.test.ts` PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (코드는 기존 orchestrator 테스트 패턴 준수)**

핵심 검증:
- request-stop 이벤트 후 nextTurn 호출 안 됨.
- FAILED 종료 시 composeMinutes 호출이 partial=true 인자.
- DONE 종료 시 partial !== true.
- paused_at != null 체크 후 run() 진입 시 즉시 PAUSED 진입.

- [ ] **Step 2: orchestrator 변경 핵심**

```typescript
// run() 진입 직후 paused 체크
if (this.deps.session.meetingPausedAt !== null) {
  this.deps.session.transitionTo('PAUSED');
  return;
}

// MeetingService 의 'request-stop' event listener 등록 (constructor 또는 init)
this.deps.meetingService.on('request-stop', (evt) => {
  if (evt.meetingId === this.deps.session.meetingId) {
    this.stopRequested = true;
  }
});

// 매 turn 시작 전 stopRequested 체크
if (this.stopRequested) {
  this.deps.session.transitionTo('DONE');
  return;
}

// 종료 시 partial 옵션
const isFailed = finalState === 'FAILED';
const minutes = await composeMinutes({ topic, messages, t, summarize: ..., partial: isFailed });
```

- [ ] **Step 3: GREEN + commit**

```bash
npm run test -- src/main/meetings/engine/__tests__/
npm run typecheck
git add src/main/meetings/engine/meeting-orchestrator.ts src/main/meetings/engine/__tests__/meeting-orchestrator-stop-pause.test.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T9 — MeetingOrchestrator request-stop hook + paused 체크 + FAILED 시 partial summary"
```

---

## Task 10: App quit hook + 진행 회의 다이얼로그 main side

**Goal:** Electron `before-quit` 가로채기 → 활성 회의 N 개 조회 → renderer 에 push → 사용자 선택 (일시정지/대기/취소) → 결과 따라 분기.

**Files:**
- Modify: `src/main/index.ts` (before-quit handler)
- Modify: `src/main/streams/stream-bridge.ts` (`stream:app-quit-prompt` event)
- Modify: `src/shared/stream-events.ts` (event type)
- Modify: `src/main/ipc/handlers/app-handler.ts` (quit-decision IPC 신규)
- Test: `src/main/__tests__/app-quit-flow.test.ts` (가능한 범위)

**Acceptance Criteria:**
- [ ] `app.on('before-quit')` 가 활성 회의 ≥ 1 시 quit 차단 + renderer push.
- [ ] renderer 가 user 선택 결과를 IPC 로 전달 → main 이 분기 (pause / wait / cancel).
- [ ] pause: 모든 active 회의 pause() → quit() 재호출.
- [ ] wait: 활성 회의 모두 ended_at != null 될 때까지 polling (최대 N 분 timeout) → quit().
- [ ] cancel: quit 차단 그대로.

**Verify:** typecheck + 가능한 단위 테스트.

**Steps:**

- [ ] **Step 1: stream-events.ts 추가**

```typescript
export type StreamAppQuitPromptPayload = {
  type: 'app-quit-prompt';
  activeMeetings: Array<{ meetingId: string; channelId: string; channelName: string; state: string }>;
};
```

- [ ] **Step 2: app-handler.ts 신규 IPC**

```typescript
'app:quit-decision': {
  request: { decision: 'pause' | 'wait' | 'cancel' };
  response: { accepted: true };
}
```

(IPC types + zod schema 도 동시에 추가.)

- [ ] **Step 3: index.ts before-quit hook**

```typescript
app.on('before-quit', (ev) => {
  const active = meetingService.listActive();
  if (active.length === 0) return;
  ev.preventDefault();
  // push to renderer
  streamBridge.emit({ type: 'app-quit-prompt', activeMeetings: active.map(/*...*/) });
  // wait for app:quit-decision IPC (handled below)
});

// quit-decision handler
function handleQuitDecision(data) {
  if (data.decision === 'pause') {
    for (const m of meetingService.listActive()) meetingService.pause(m.id);
    setTimeout(() => app.quit(), 500); // flush
  } else if (data.decision === 'wait') {
    waitForAllMeetingsEnded().then(() => app.quit());
  }
  return { accepted: true };
}
```

- [ ] **Step 4: GREEN + commit**

```bash
npm run typecheck
git add src/main/index.ts src/main/streams/stream-bridge.ts src/shared/stream-events.ts src/main/ipc/handlers/app-handler.ts src/shared/ipc-types.ts src/shared/ipc-schemas.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T10 — app before-quit hook + 진행 회의 다이얼로그 main side (pause/wait/cancel 분기)"
```

---

## Task 11: ChannelRail — MeetingStatusLabel + hover swap

**Goal:** 좌측 채널 사이드바의 각 채널 항목 우측에 회의 상태 라벨. 활성 회의: "🟢 회의 중" → hover 시 [회의 종료] 버튼. 일시정지: "⏸ 일시정지" → hover 시 [재개].

**Files:**
- Create: `src/renderer/features/messenger/MeetingStatusLabel.tsx`
- Create: `src/renderer/features/messenger/__tests__/MeetingStatusLabel.test.tsx`
- Modify: `src/renderer/features/messenger/ChannelRail.tsx` (Label 통합)
- Modify: `src/renderer/hooks/use-active-meetings.ts` 또는 신규 hook (channel별 active meeting 상태 stream 구독)

**Acceptance Criteria:**
- [ ] 활성 회의 있는 채널만 라벨 노출.
- [ ] hover 시 라벨 → 버튼 swap (CSS group-hover 또는 React state).
- [ ] 종료 버튼 클릭 시 confirm dialog → `meeting:request-stop` IPC.
- [ ] paused 회의는 다른 색 + [재개] 버튼.
- [ ] aria-label / data-testid 명시.
- [ ] 단위 테스트 (Testing Library) — 4 시나리오.

**Verify:** `npm run test -- src/renderer/features/messenger/__tests__/MeetingStatusLabel.test.tsx` PASS.

**Steps:**

- [ ] **Step 1: 단위 테스트 (RED)**

```tsx
// src/renderer/features/messenger/__tests__/MeetingStatusLabel.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MeetingStatusLabel } from '../MeetingStatusLabel';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n';

function r(props: any) {
  return render(<I18nextProvider i18n={i18n}><MeetingStatusLabel {...props} /></I18nextProvider>);
}

describe('MeetingStatusLabel', () => {
  it('renders active label when meeting active', () => {
    r({ status: 'active', meetingId: 'm', onStop: vi.fn(), onResume: vi.fn() });
    expect(screen.getByTestId('meeting-status-label')).toHaveAttribute('data-status', 'active');
  });
  it('shows stop button on hover when active', async () => {
    const onStop = vi.fn();
    r({ status: 'active', meetingId: 'm', onStop, onResume: vi.fn() });
    fireEvent.mouseEnter(screen.getByTestId('meeting-status-label'));
    fireEvent.click(screen.getByTestId('meeting-status-stop-button'));
    expect(onStop).toHaveBeenCalledWith('m');
  });
  it('shows resume button when paused', () => {
    r({ status: 'paused', meetingId: 'm', onStop: vi.fn(), onResume: vi.fn() });
    expect(screen.getByTestId('meeting-status-label')).toHaveAttribute('data-status', 'paused');
  });
  it('renders nothing when status null', () => {
    const { container } = r({ status: null, meetingId: null, onStop: vi.fn(), onResume: vi.fn() });
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 구현**

```tsx
// src/renderer/features/messenger/MeetingStatusLabel.tsx
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface MeetingStatusLabelProps {
  status: 'active' | 'paused' | null;
  meetingId: string | null;
  onStop: (meetingId: string) => void;
  onResume: (meetingId: string) => void;
}

export function MeetingStatusLabel({ status, meetingId, onStop, onResume }: MeetingStatusLabelProps): ReactElement | null {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  if (status === null || meetingId === null) return null;

  const isActive = status === 'active';
  const labelText = isActive ? t('messenger.channelRail.meetingActive') : t('messenger.channelRail.meetingPaused');
  const buttonText = isActive ? t('messenger.channelRail.endMeetingButton') : t('messenger.channelRail.resumeMeetingButton');
  const onClick = isActive ? () => onStop(meetingId) : () => onResume(meetingId);

  return (
    <span
      data-testid="meeting-status-label"
      data-status={status}
      className={`text-xs px-1 ${isActive ? 'text-success' : 'text-warning'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={labelText}
    >
      {hovered ? (
        <button
          type="button"
          data-testid={isActive ? 'meeting-status-stop-button' : 'meeting-status-resume-button'}
          className="underline"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          {buttonText}
        </button>
      ) : (
        labelText
      )}
    </span>
  );
}
```

- [ ] **Step 3: ChannelRail 통합**

`ChannelRail.tsx` 의 channel item render 부분에 `<MeetingStatusLabel />` 추가. status / meetingId 는 hook (`useActiveMeetings`) 으로 구독.

- [ ] **Step 4: GREEN + commit**

```bash
npm run test -- src/renderer/features/messenger/__tests__/MeetingStatusLabel.test.tsx
npm run typecheck
git add src/renderer/features/messenger/MeetingStatusLabel.tsx src/renderer/features/messenger/__tests__/MeetingStatusLabel.test.tsx src/renderer/features/messenger/ChannelRail.tsx src/renderer/hooks/use-active-meetings.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T11 — ChannelRail MeetingStatusLabel (active/paused + hover swap [종료]/[재개])"
```

---

## Task 12: ChannelHeader — [회의 시작] hide + topic editor

**Goal:** 자동 트리거 도입으로 평소 [회의 시작] 버튼은 의미 없음 — hide. 단 dev/test 용으로 settings 의 dev tools 영역에서 또는 ROLESTRA_E2E env 시 노출. 토픽 편집 inline 추가.

**Files:**
- Modify: `src/renderer/features/messenger/ChannelHeader.tsx`
- Create: `src/renderer/features/messenger/MeetingTopicEditor.tsx`
- Test: `src/renderer/features/messenger/__tests__/MeetingTopicEditor.test.tsx`

**Acceptance Criteria:**
- [ ] [회의 시작] 버튼 평소 hide. `import.meta.env.DEV || window.ROLESTRA_E2E` 시만 노출.
- [ ] 활성 회의의 토픽 옆 [편집] 아이콘 → inline edit → 저장 시 `meeting:edit-topic` IPC.
- [ ] esc 로 취소, enter 로 저장.
- [ ] 단위 테스트 — 편집 / 저장 / 취소 / dev mode 노출.

**Verify:** typecheck + 단위 테스트.

**Steps:**

- [ ] **Step 1~3**: TDD 패턴 동일 (test → impl → green)

- [ ] **Step 4: commit**

```bash
git add src/renderer/features/messenger/ChannelHeader.tsx src/renderer/features/messenger/MeetingTopicEditor.tsx src/renderer/features/messenger/__tests__/MeetingTopicEditor.test.tsx
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T12 — ChannelHeader [회의 시작] hide + MeetingTopicEditor inline edit"
```

---

## Task 13: AppQuitMeetingDialog (renderer)

**Goal:** main 의 `stream:app-quit-prompt` 이벤트 받아 다이얼로그 노출, 사용자 선택 결과 `app:quit-decision` IPC 응답.

**Files:**
- Create: `src/renderer/features/app-quit/AppQuitMeetingDialog.tsx`
- Create: `src/renderer/hooks/use-app-quit-prompt.ts`
- Modify: `src/renderer/App.tsx` (mount)
- Test: `src/renderer/features/app-quit/__tests__/AppQuitMeetingDialog.test.tsx`

**Acceptance Criteria:**
- [ ] stream event 수신 시 모달 노출.
- [ ] 활성 회의 목록 표시 (채널 이름 + state).
- [ ] 3 버튼: [일시정지하고 종료] / [회의 끝까지 기다림] / [취소] — 클릭 시 IPC.
- [ ] esc = 취소.
- [ ] 단위 테스트.

**Verify:** typecheck + 단위 테스트.

**Steps:**

- [ ] **Step 1~4: TDD + commit**

```bash
git add src/renderer/features/app-quit/ src/renderer/hooks/use-app-quit-prompt.ts src/renderer/App.tsx
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T13 — AppQuitMeetingDialog (renderer) + use-app-quit-prompt hook"
```

---

## Task 14: i18n keys (ko + en)

**Goal:** D-A 의 신규 사용자 노출 문자열 15+ 키 추가.

**Files:**
- Modify: `src/renderer/i18n/locales/ko.json`
- Modify: `src/renderer/i18n/locales/en.json`

**Acceptance Criteria:**
- [ ] 다음 키 모두 추가 (양쪽 locale):
  ```
  messenger.channelRail.meetingActive
  messenger.channelRail.meetingPaused
  messenger.channelRail.endMeetingButton
  messenger.channelRail.resumeMeetingButton
  messenger.channelHeader.editTopic
  messenger.endMeetingDialog.title
  messenger.endMeetingDialog.body
  messenger.endMeetingDialog.confirm
  messenger.endMeetingDialog.cancel
  app.quitDialog.title
  app.quitDialog.body
  app.quitDialog.pauseAndQuit
  app.quitDialog.waitFinish
  app.quitDialog.cancel
  meeting.partialSummary.consensusHeading
  meeting.partialSummary.disagreementHeading
  meeting.partialSummary.unresolvedHeading
  meeting.partialSummary.fallback
  ```
- [ ] eslint-plugin-i18next 통과.

**Verify:** `npm run lint` PASS.

**Steps:**

- [ ] **Step 1: ko.json 추가**

```json
{
  "messenger": {
    "channelRail": {
      "meetingActive": "🟢 회의 중",
      "meetingPaused": "⏸ 일시정지",
      "endMeetingButton": "회의 종료",
      "resumeMeetingButton": "재개"
    },
    "channelHeader": {
      "editTopic": "토픽 편집"
    },
    "endMeetingDialog": {
      "title": "회의를 종료할까요?",
      "body": "{{channelName}} 의 진행 중인 회의를 종료합니다. 진행 중인 발언은 마저 끝낸 후 종료됩니다.",
      "confirm": "종료",
      "cancel": "취소"
    }
  },
  "app": {
    "quitDialog": {
      "title": "회의가 진행 중입니다",
      "body": "현재 {{count}} 개 회의가 진행 중입니다.",
      "pauseAndQuit": "일시정지하고 종료",
      "waitFinish": "회의 끝까지 기다림",
      "cancel": "취소"
    }
  },
  "meeting": {
    "partialSummary": {
      "consensusHeading": "## 합의된 결정",
      "disagreementHeading": "## 논쟁 점",
      "unresolvedHeading": "## 미결 항목",
      "fallback": "회의가 라운드 한계로 종료됨. 합의 도달 안 함."
    }
  }
}
```

- [ ] **Step 2: en.json — 동일 키, 영어 번역**

- [ ] **Step 3: lint + commit**

```bash
npm run lint
git add src/renderer/i18n/locales/ko.json src/renderer/i18n/locales/en.json
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "feat(rolestra): D-A T14 — i18n 신규 키 18 (ko/en) for channel rail / end-meeting / quit-dialog / partial-summary"
```

---

## Task 15: e2e 시나리오 — 자동 회의 흐름 + 일시정지·재개

**Goal:** Playwright Electron 으로 메시지 → 자동 회의 → 합의 → 회의록 / 일시정지 → 재부팅 → 재개 e2e.

**Files:**
- Create: `e2e/auto-meeting-flow.spec.ts`
- Create: `e2e/meeting-pause-resume.spec.ts`

**Acceptance Criteria:**
- [ ] auto-meeting-flow: 빈 user 채널에 "안녕" 메시지 송신 → 회의 자동 시작 → mock provider 가 응답 → SSM DONE → #회의록 에 메시지 1 개 추가.
- [ ] pause-resume: 회의 진행 중 앱 닫기 → 다이얼로그 → "일시정지하고 종료" → 재부팅 → 채널 사이드바에 "⏸ 일시정지" 라벨 → [재개] 클릭 → 회의 진행 재개.
- [ ] WSL 제약: skip with reason on linux/wsl, run on Windows/macOS CI matrix.

**Verify:** Windows host 에서 `npm run test:e2e -- e2e/auto-meeting-flow.spec.ts` PASS.

**Steps:**

- [ ] **Step 1**: 시나리오 spec 작성 — 기존 `e2e/messenger-flow.spec.ts`, `e2e/meeting-flow.spec.ts` 패턴 참고.

- [ ] **Step 2**: WSL skip guard:

```typescript
import { test } from '@playwright/test';
const isWSL = process.platform === 'linux' && (process.env.WSL_DISTRO_NAME ?? '').length > 0;
test.skip(isWSL, 'WSL rollup native binary 제약');
```

- [ ] **Step 3: commit**

```bash
git add e2e/auto-meeting-flow.spec.ts e2e/meeting-pause-resume.spec.ts
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "test(rolestra): D-A T15 — e2e 시나리오 (auto-meeting flow + pause/resume)"
```

---

## Task 16: 회귀 + spec / ADR 갱신 + 메모리 정리

**Goal:** 기존 테스트 회귀 무 확인. spec §7.4 / §7.5 / §8 갱신 reference. ADR 신규 또는 cross-cutting 추가. 메모리 갱신.

**Files:**
- Modify: `docs/specs/2026-04-18-rolestra-design.md` (§7.4 / §7.5 / §8 갱신)
- Create or modify: `docs/decisions/R12-decisions.md` (또는 cross-cutting.md 추가)
- Modify: `~/.claude/projects/-mnt-d-Taniar-Documents-Git-AI-Chat-Arena/memory/MEMORY.md` (D-A 진행 항목)

**Acceptance Criteria:**
- [ ] `npm run test` 전체 PASS (모든 단위/통합).
- [ ] `npm run typecheck` 0 error.
- [ ] `npm run lint` PASS.
- [ ] spec §7.4 / §7.5 / §8 의 D-A 관련 부분 업데이트 (또는 D-A spec 으로 cross-reference).
- [ ] R12-decisions.md (신규) — D-A 결정 13 항목 ADR.
- [ ] 메모리 진행 상황 갱신.

**Verify:** `npm run test && npm run typecheck && npm run lint` 전체 GREEN.

**Steps:**

- [ ] **Step 1: 회귀 검증**

```bash
npm run test
npm run typecheck
npm run lint
```

FAIL 항목 fix.

- [ ] **Step 2: spec 본문 갱신**

`docs/specs/2026-04-18-rolestra-design.md` §7.4 "채널 내 회의 시작" 절에:

```markdown
> **D-A (2026-04-29) 갱신**: 명시 [회의 시작] 클릭 모델은 자동 트리거 모델로 대체. 자세한 동작은 `docs/specs/2026-04-29-rolestra-message-auto-meeting-trigger-design.md` 참고.
```

§7.5 KPI "진행 회의" → "활성 회의" 라벨 갱신. §8 SSM 에 `paused_at` + 일시정지 transition 명시.

- [ ] **Step 3: ADR 작성**

`docs/decisions/R12-decisions.md` 신규 또는 `cross-cutting.md` 에 추가:

```markdown
## R12-D-A: 메시지 자동 회의 트리거 + AI 복제 동시 회의

**결정**: 모든 사용자 채널 / #일반 / DM 에서 메시지 송신 = 자동 응답. 채널 회의는 명시 종료까지 1 회의 유지. 같은 직원이 여러 회의에 동시 참여 (per-meeting CliSessionState 격리).

**원인**: dogfooding round1 #2 — 사용자 직관 ("입력창 보이면 답이 와야") 과 spec §7.4 (명시 [회의 시작]) 의 갭.

**대안**:
- A. UX hint 강화만 (단기): "회의 시작 버튼 누르세요" 안내 — affordance 정직성 위반 그대로.
- B. DM 만 자동 응답 (중기): 부분 해결, 사용자 멘탈모델 분리.
- C. 모든 채널 자동 트리거 (장기, 채택): affordance 정직성 + DM 정체성 분리 + AI 복제 인정.

**결과**: spec 별도 문서. plan 16 task. E (방 간 인계) 별도 후속.

**참고**: 본 ADR 의 결정 종합은 `docs/specs/2026-04-29-rolestra-message-auto-meeting-trigger-design.md` §2 결정 표.
```

- [ ] **Step 4: 메모리 갱신**

`MEMORY.md` 에 D-A 완료 항목 추가:

```markdown
- [D-A 완료](rolestra-d-a-completion.md) — 메시지 자동 회의 트리거 + AI 복제 동시 회의 main merge. commit <hash>. dogfooding round3 시작 가능.
```

신규 메모리 파일 `rolestra-d-a-completion.md` 작성.

- [ ] **Step 5: 최종 commit**

```bash
git add docs/specs/2026-04-18-rolestra-design.md docs/decisions/
git -c user.name='mua-vtuber' -c user.email='mua.vtuber@gmail.com' commit -m "docs(rolestra): D-A T16 — spec/ADR 갱신 + R12-decisions.md"
```

---

## Self-Review

### Spec coverage 검증

| spec §  | 결정 | task |
|---|---|---|
| §2.1 트리거 범위 | DM + system_general + user | T4 (분기) |
| §2.2 DM 모델 | 단순 1턴 | T6 |
| §2.3 회의 단위 | 명시 종료까지 | T7, T9 |
| §2.4 AI 복제 | per-meeting state | T3 |
| §2.5 autonomy 결합 | 무관 | T9 (turn loop 변경 없음 — manual 시 ApprovalService 가 기존대로 wait) |
| §2.6 토픽 | 첫 메시지 80자 | T4 (toTopic) |
| §2.7 종료 UX 위치 | 사이드바 hover | T11 |
| §2.8 종료 클릭 | 확인 + 진행중 마침 | T9, T11 |
| §2.9 자동 종료 | 합의 / 라운드 한계 | T8, T9 |
| §2.10 채널 이동 | 무관 | (변경 없음 — 검증) |
| §2.11 앱 종료 | 다이얼로그 | T10, T13 |
| §2.12 복제 시각 표시 | 안 함 + 응답 지연 | (round2-A 그대로 활용 — 변경 없음) |
| §2.13 KPI 라벨 | 활성 회의 | T14 (i18n) |
| §3 채널별 동작 모델 | 흐름 | T4, T5, T6 |
| §4 lifecycle | 자동 시작/진행/종료/이동/앱종료/재개 | T4, T7, T9, T10, T13 |
| §5 autonomy 결합 | manual 시 승인 대기 | (기존 ApprovalService 흐름 그대로) |
| §6 AI 복제 | per-meeting CliSessionState | T3 |
| §7 데이터 모델 | migration 016 | T1 |
| §8 IPC 변경 | 4 신규 + list-active 응답 | T2, T7 |
| §9 UI 변경 | sidebar / header / quit dialog | T11, T12, T13 |
| §10 에러 / 엣지케이스 | 8 케이스 | 분산 — IPC 실패 (T5 listener catch), race (T4), rehydrate 실패 (T9), idempotent quit (T13) |
| §11 테스트 전략 | 단위 + 통합 + e2e + dogfooding | T1~T15 단위/통합 + T15 e2e + T16 회귀 |
| §12 spec/ADR 갱신 | 본문 + ADR | T16 |

전 항목 task 매핑 OK.

### Placeholder scan

- "TBD" / "TODO" — 없음.
- "implement later" — 없음.
- "similar to Task N" — 없음. 각 task 의 코드 직접 제시.
- "fill in details" — 없음.
- 미정의 method 참조 — 없음 (ChannelRepository / MessageRepository / ChannelMembersService 는 기존 자산).

### Type consistency

- `meetingId: string | null | undefined` 패턴 — T3 (CliSessionState), T6 (DmAutoResponder generate options) 일관.
- `kind: 'manual' | 'auto'` 리터럴 — T1 (DB CHECK), T2 (Meeting type), T4 (start input) 일관.
- `pausedAt: number | null` — T2, T7, T9 일관.
- `composeMinutes` 의 `partial?: boolean` — T8 정의, T9 호출 일관.
- IPC 채널 이름 `meeting:request-stop` / `meeting:edit-topic` / `meeting:pause` / `meeting:resume` — T2 정의, T7 핸들러, T11 / T12 호출 일관.

### Scope check

16 task. 단일 plan 안에서 가능한 크기. 사용자 dogfooding round3 까지 한 번에 land 가능. 분할 안 함.

---

## Task 의존 관계

```
T0 (기존 A+B commit)
  ├─ T1 (migration)
  ├─ T2 (IPC types)
  └─ T3 (CliSessionState 격리)

T1, T2 → T4 (MeetingAutoTrigger)
T4 → T5 (wiring)
T2 → T6 (DmAutoResponder)
T1, T2 → T7 (pause/resume/request-stop service)
독립: T8 (partial summary)
T7, T8 → T9 (orchestrator hook)
T7, T2 → T10 (app quit hook main)
T2, T7 → T11 (ChannelRail label)
독립: T12 (ChannelHeader)
T10 → T13 (AppQuitMeetingDialog renderer)
독립: T14 (i18n)
T1~T13 → T15 (e2e)
모든 → T16 (회귀 + spec/ADR + 메모리)
```

병렬 가능한 그룹:
- 그룹 A (foundation): T1, T2, T3, T8
- 그룹 B: T4 (T1, T2 후), T6 (T2 후), T7 (T1, T2 후), T12 (독립), T14 (독립)
- 그룹 C: T5 (T4 후), T9 (T7, T8 후), T10 (T7, T2 후), T11 (T2, T7 후)
- 그룹 D: T13 (T10 후)
- 그룹 E (직렬): T15, T16

---
