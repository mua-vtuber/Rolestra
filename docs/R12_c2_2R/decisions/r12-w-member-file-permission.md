# ADR — R12-W 채널-단위 파일 권한 wire-up

작성일: 2026-05-11
최종 갱신: 2026-05-11 (사장 mental model 정정 — 권한 단위 = 채널 1:1)
상태: 채택 (D1~D5 사장 결재 + 채널 단위 재정의 완료)
선행 ADR: r12-s-persona-skills (능력 카탈로그 + toolGrants), r12-c-channel-roles (채널 role 컬럼), cross-cutting C3 (ExecutionService) / C4 (IPC) / C6 (path-guard) / C7 (i18n)

> **주의 (mental model 정정 반영):** 본 ADR 의 v1 (초안 추천) → v2 (사장 1차 결재 — 프로젝트 × 부서 매트릭스) → **v3 (사장 2차 결재 — 채널 1:1)** 로 진화했다. v3 의 핵심 인식: *"부서 == 기본 채널"* — Rolestra 의 부서는 별도 도메인이 아니라 기본 채널의 라벨이다. v2 의 "프로젝트 × 부서" 매트릭스가 단순 채널 권한으로 collapse 된다.

---

## 0. 한 줄 결론

옛 `buildPermissionRules` 경로는 R12-S `PromptComposer` 의 미완 wire-up 잔재다. 이를 종결하면서 **채널 row 에 권한 5축 컬럼을 직접 추가** (별도 테이블 X) 하고, **부서 template 의 default 권한을 채널 생성 시 복사** 해서 박는다. CLI argv 에는 채널-권한 filter layer 한 단계 더 끼워 다중 방어 (출입증 + 통역사) 를 둘 다 강화한다. `FilePermission` 인터페이스 (`src/shared/file-types.ts:9-20`) 는 채널 단위 매트릭스가 더 우아한 도메인이므로 **삭제** 한다.

---

## 1. 문제 정의

### 1.1 사용자 보고 증상

작업장 + 작업장 묶인 채널에서 할 일 큐로 "아이디어 부서" 회의 시작 → AI 에게 `docs/messenger-mockup-tool-spec.md` 읽고 의견을 달라고 요청 → Claude Code 응답에:

> "본 회의 채널 규칙상 파일을 직접 읽지 못해 spec 내용을 검증할 수 없는 상태다"

라는 자기검열 발언이 명시. 사용자는 채널에 권한을 부여한 적이 없고, 부여할 UI 도 없으며, AI 가 무엇을 보고 그렇게 판단했는지 알 수 없는 상태.

### 1.2 코드 차원의 실제 원인

`src/main/meetings/engine/meeting-turn-executor.ts:534-541` 가 매 turn 마다 `buildPermissionRules({ permission: null, ... })` 하드코딩 호출 → `buildPermissionRules` 의 두 번째 분기 ("권한 없음 → 모두 deny") 가 100% 발동.

### 1.3 결정적 단서 — PromptComposer 미 wire-up

`grep -rn 'PromptComposer' src/` 결과 — main process 어디서도 import 안 함. R12-S decision log 는 "PromptComposer 합성 경로" 채택 명시했지만 wire-up 누락. `SKILL_CATALOG[roleId].toolGrants` (5축 권한 matrix) + `PromptComposer.summarizeTools` (한국어 라벨 합성) 모두 이미 존재.

### 1.4 사장 mental model 정정 (v3 의 직접 근거)

> "**부서 == 기본 채널**. 프로젝트 하위에 기본 채널들 (`#아이디어 부서`, `#기획 부서`, ...) + 사용자 정의 채널이 함께 존재. **권한 단위 = 채널 1개**. 부서는 별도 도메인이 아니라 기본 채널의 라벨."

→ v2 의 "프로젝트 × 부서" 매트릭스가 v3 에서 단순 채널 권한으로 collapse:
- **별도 테이블 `project_role_permissions` 불필요** — `channels` 테이블에 5컬럼 직접 추가.
- **resolver 가 단순화** — "오버라이드 + 카탈로그" 2계층이 아니라 채널 row 단일 source.
- **UI 도 단순화** — 프로젝트 설정 탭이 아니라 채널 생성/설정 모달 안 권한 섹션.

### 1.5 사전 확인 결과 (코드 grep 으로 검증)

| 항목 | 결과 | 의미 |
|------|------|------|
| `channels.role TEXT` 컬럼 | **이미 존재** (migration 018) | 부서 식별 컬럼 1개로 backfill 매핑 가능. NULL = system 채널 / DM / legacy user |
| 기본 부서 채널 자동 생성 | **이미 존재** (`channel-service.ts:795 createDepartmentChannels`) | 5종 (`아이디어`/`기획`/`디자인`/`구현`/`검토`) + 옵션 2종 (`디자인-캐릭터`/`디자인-배경`). 기존 자동 생성 메서드 안에서 INSERT 시 권한 컬럼 추가만으로 충분 |
| `ChannelService extends EventEmitter` | **없음** | 권한 변경 invalidation 이벤트 위해 EventEmitter 승격 필요. MemberProfileService / ApprovalService / MessageService 와 일관 패턴 |
| `RoleId` 10종 vs 기본 부서 채널 5종 | DEFAULT_DEPARTMENT_BLUEPRINT = 5 (`idea`/`planning`/`design.ux`/`implement`/`review`), OPTIONAL = 2 (`design.character`/`design.background`). 나머지 (`design.ui`/`audit`/`general`) 는 자동 생성 채널에 없음 | 사용자 자유 채널은 `role` 자유 선택 — `general` 또는 nullable |

---

## 2. 결정 (v3 확정안 — 채널 1:1)

### D1. 권한 부여 단위 — **채널 1:1**

**확정:** 권한 row = 채널 row. 별도 매트릭스 없음.

**경로:**
```
SKILL_CATALOG[roleId].toolGrants   (코드 카탈로그, 사용자 수정 UI 없음 — 결재 B-①)
       ↓ 채널 생성 시 복사
channels row (5권한 컬럼 직접)
       ↓ 사용자 미세조정
channels row (수정된 5권한)
       ↓
ChannelPermissionResolver.resolve(channelId) → PermissionSet
```

세 가지 채널 생명주기:
1. **프로젝트 생성 시 기본 채널 자동 생성** — `createDepartmentChannels` 가 5종 (또는 옵션 포함 7종) 을 자동 시드. 각 채널이 자기 부서의 카탈로그 default 권한을 복사해서 박힘.
2. **사용자 정의 채널 생성** — 모달에서 부서 template 드롭다운 (6 옵션: `아이디어`/`기획`/`디자인`/`구현`/`검토`/`일반`) 선택 → 카탈로그 default 권한이 5 axis 토글에 자동 반영 → 사용자 미세조정 → 채널 row 에 박힘.
3. **system 채널** (`승인-대기` / `회의록` / 전역 `system_general`) + **DM 채널** — `role = NULL` 그대로. 권한 컬럼은 ALTER DEFAULT (read=1, 나머지 0) — 회의 turn 발화 컨텍스트 없음 (`channelRole=null` 분기 = PromptComposer 권한 단락 자체 생략).

**근거:**
- 사용자 mental model 정확히 반영 — *"권한 단위 = 채널 1개"*.
- 별도 도메인 / 매트릭스 / 결합 로직 0 — 단일 source.
- 마이그레이션 단순화 (ALTER 5건 + UPDATE 3건).
- IPC / Resolver / UI 모두 채널 entity 위에 자연스럽게 얹힘.

**리스크:**
- 카탈로그 default 변경 시 *기존* 채널은 영향 X — backfill 만 1회. 사용자가 "default 가 바뀌었지만 내 기존 채널은 옛 권한 그대로" 사실을 인식해야 함. UI 의 "template 으로 리셋" 버튼이 이 mental model 격차 보완.
- 채널 삭제 시 권한도 같이 사라짐 — ON DELETE CASCADE 가 채널 row 자체이므로 자연 정리. 별도 cleanup 0.
- *같은 부서 여러 채널* 간 권한 sync 부재 — 사용자가 의도적으로 활용 (sprint A vs B 권한 분리) 가능하지만 의도하지 않은 drift 도 가능. Follow-up 3 의 "일괄 변경" 기능이 mitigation.

---

### D2. 미설정 시 기본 — **읽기 허용** (확정)

**확정:** PromptComposer fallback 분기 (능력 미부여 직원 + 부서 채널) 에 "작업장 폴더 안 파일 읽기" 안내 1줄 추가. 쓰기/실행은 사용자 명시 지시 후만.

**추가로 — ALTER DEFAULT 의 함의:** `channels` 테이블 ALTER 5컬럼의 DEFAULT 가 `file_read=1`, 나머지 `0` — 마이그레이션 023 적용 직후 **모든 기존 채널이 자동으로 "읽기만" 권한** 으로 backfill. 이게 D2 "안전 측" 정신과 부합. 그 위에 기본 부서 채널 5종 + 옵션 2종은 카탈로그 default 로 다시 UPDATE (UPDATE statement 마이그레이션 본문에 포함).

**별도 1 (회의록 쓰기) 명시:**
- `#회의록` 채널은 메시지 시스템 append (AutonomyGate → `messageService.append`) — 파일 시스템 권한과 무관.
- PromptComposer fallback 안내 + 활성 분기 권한 단락 둘 다에 "회의록은 채널 시스템 기록이라 파일 권한과 무관" 1줄 명시.

---

### D3. 저장 위치 — **`channels` 테이블 ALTER 5컬럼**

**확정:** D1 의 자연 귀결. 별도 테이블 X.

**신규 마이그레이션 023** (014~022 land — 다음 forward-only 번호. 사장 메모 "016" 은 chain 상 이미 사용 중이라 023 으로 정정):

```sql
-- 1. 권한 5컬럼 추가. 기본값 = "안전 측" (read 만 허용).
ALTER TABLE channels ADD COLUMN file_read    INTEGER NOT NULL DEFAULT 1 CHECK (file_read    IN (0,1));
ALTER TABLE channels ADD COLUMN file_write   INTEGER NOT NULL DEFAULT 0 CHECK (file_write   IN (0,1));
ALTER TABLE channels ADD COLUMN command_exec INTEGER NOT NULL DEFAULT 0 CHECK (command_exec IN (0,1));
ALTER TABLE channels ADD COLUMN web_search   INTEGER NOT NULL DEFAULT 0 CHECK (web_search   IN (0,1));
ALTER TABLE channels ADD COLUMN db_read      INTEGER NOT NULL DEFAULT 0 CHECK (db_read      IN (0,1));

-- 2. 기본 부서 채널 backfill — SKILL_CATALOG 의 toolGrants 표 그대로.
--    참조: src/shared/skill-catalog.ts
--    매핑 표는 § D3 의 "카탈로그 default 표 (정본)" 참조.

-- db_read = 1 인 부서 (READ_ONLY 가 base, 10 role 전부 file_read + db_read 보유):
UPDATE channels SET db_read = 1
 WHERE role IN ('idea','planning','design.ui','design.ux',
                'design.character','design.background','implement',
                'review','audit','general');

-- web_search = 1 인 부서 (READ_PLUS_WEB):
UPDATE channels SET web_search = 1
 WHERE role IN ('idea','planning','design.ux','design.background',
                'review','audit','general');

-- implement 만 file_write + command_exec (커스텀):
UPDATE channels SET file_write = 1, command_exec = 1
 WHERE role = 'implement';

-- 3. system 채널 + DM (role IS NULL) 은 ALTER DEFAULT 그대로 —
--    file_read=1, 나머지 0. PromptComposer 의 channelRole=null 분기로
--    권한 단락 자체 생략되므로 컬럼 값은 회의 발화에서 사용되지 않지만
--    schema 일관성 위해 row 에 채움.
```

**카탈로그 default 표 (정본 — ADR + plan + migration + sanity 테스트 일관 참조):**

| role | file_read | file_write | command_exec | web_search | db_read | 출처 (`src/shared/skill-catalog.ts`) |
|------|-----------|------------|--------------|------------|---------|---------------------------------------|
| `idea` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB |
| `planning` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB |
| `design.ui` | 1 | 0 | 0 | 0 | 1 | READ_ONLY |
| `design.ux` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB |
| `design.character` | 1 | 0 | 0 | 0 | 1 | READ_ONLY |
| `design.background` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB |
| `implement` | 1 | 1 | 1 | 0 | 1 | 커스텀 (line 139-142) |
| `review` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB (※ 코드 정본 재확인 — review 커스텀 일 가능성. Plan sanity 테스트가 검증) |
| `audit` | 1 | 0 | 1 | 0 | 1 | 커스텀 (line 185-188) |
| `general` | 1 | 0 | 0 | 1 | 1 | READ_PLUS_WEB |
| NULL (system/DM) | 1 | 0 | 0 | 0 | 0 | ALTER DEFAULT |

> **본 표는 단일 정본.** plan 의 sanity 테스트가 `SKILL_CATALOG` 코드 vs 본 표 일치를 검증 — drift 시 fail.

**신규 IPC 쌍 — 2채널** (typedInvoke + zod):

| 채널 | request | response | 의미 |
|------|---------|----------|------|
| `channel:get-permissions` | `{ channelId: string }` | `PermissionSet` | 채널 단일 권한 조회. 카탈로그 default 와의 비교는 client 측 helper. |
| `channel:update-permissions` | `{ channelId, fileRead, fileWrite, commandExec, webSearch, dbRead }` | `{ ok: true }` | 5축 동시 upsert. partial update X — UI 가 5축 모두 보내도록 강제 (race 회피). |

> v2 안의 `project:role-permission:list/set/reset` 3채널 **폐기**. channels CRUD 가 이미 있으므로 `listByProject` 응답에 권한 컬럼이 함께 반환되어 별도 list 채널 불필요. reset 은 client 측에서 카탈로그 default 를 알아 `channel:update-permissions` 로 동일 흐름.

**zod schema:** 5 boolean axis + `channelId: z.string().uuid()`. 변경 시 invalid → 명시 throw.

**신규 UI:**
- **채널 생성 모달 → 권한 섹션** 신설.
  - 부서 template 드롭다운: `아이디어` / `기획` / `디자인` / `구현` / `검토` / `일반` 6 옵션 (사용자 자유 채널은 default `일반`, 또는 사용자가 명시).
  - 선택 시 카탈로그 default 가 5 axis 토글에 자동 반영.
  - 사용자가 토글 미세조정 가능.
- **채널 설정 모달 → 권한 섹션** 신설 (사후 수정).
  - 같은 UI 재사용 — 드롭다운은 read-only (그 채널의 출발 부서 표시, 변경 X), 토글만 변경 가능.
  - "template 으로 리셋" 버튼 — 카탈로그 default 로 복귀.
  - **부서 자체 변경은 별도 follow-up** (§ Follow-up 5).
- v2 의 "프로젝트 설정 > 부서별 권한 탭" **폐기**.

**근거:**
- D1 결과로 자연 도출.
- 채널 entity 가 이미 존재 — 추가 컬럼 5개 + repository 메서드 2개 + service 메서드 2개 + IPC 2채널 + 모달 섹션 1개.
- v2 의 "프로젝트 × 부서" 도메인 (마이그레이션 + repository + service + 3 IPC + 탭 UI) 대비 **순수 LoC 약 26% 감소** (§ 8).

**리스크:**
- "사장 결재 B-①" 명시 — *카탈로그 default 의 사용자 수정 UI 없음*. 즉 사용자가 `audit` 부서 default 의 `command_exec=true` 를 글로벌하게 끄려면 *모든 audit 채널을 일일이 수정* 해야 함. 일괄 변경 편의 기능은 Follow-up 3.

---

### D4. 조회 시점 — **회의 세션 시작 1회 캐싱 + 채널 권한 변경 invalidation**

**확정:** v2 그대로 — 입력 source 만 채널로 변경.

**구조:**

```
[MeetingSession.start]
  ↓
  permissionSnapshot = ChannelPermissionResolver.resolve(this.channelId)
  PermissionSet (단일 — 회의는 채널 단위, role 1개)
  ↓
[MeetingTurnExecutor.runPhaseTurn]
  ↓
  if (session.permissionSnapshotDirty) reload from resolver
  use snapshot → PromptComposer + argv filter
```

> v2 와의 차이 — v2 는 `Map<RoleId, PermissionSet>` (회의 채널의 role 외에도 모든 부서). v3 에서는 **회의 = 채널 1개 = role 1개** → snapshot 이 단일 `PermissionSet`. 메모리 / 코드 둘 다 더 단순.

**Invalidation 흐름:**

```
[Renderer] channel:update-permissions
  ↓
[IPC handler] ChannelService.updatePermissions(channelId, patch)
  ↓
[Service emit] 'permission-changed' { channelId }
  ↓
[MeetingSession subscriber] if (event.channelId === this.channelId) this.markPermissionSnapshotDirty()
  ↓
[다음 runPhaseTurn] dirty 면 resolver 재호출 + 다시 캐싱
```

**ChannelService EventEmitter 승격:**
- 사전 확인 결과 `ChannelService` 는 단순 클래스. 추천: `extends EventEmitter` — MemberProfileService / ApprovalService / MessageService 와 일관 패턴 + 추가 DI 없음.
- 약 30~50 LoC (class 헤더 + emit 호출 추가 + 타입 overload).

**근거:**
- v2 와 동일 — 사용자 mental model 정합 ("권한 바꿔도 다음 턴부터 반영").
- DB lookup 도 채널 단일 row 라 매우 가볍지만 — invalidation 흐름의 명료성을 위해 캐싱 유지.

**리스크:**
- v2 와 동일 — listener detach lifecycle. Plan T verify.

---

### D5. argv 동기화 — **2단계 filter** (입력 source = 채널 권한)

**확정:** v2 그대로. spec §7.6.3 매트릭스 무손상, 그 출력을 채널 `PermissionSet` 으로 좁힘.

**흐름:**

```
[작업장 mode 매트릭스]   ← spec §7.6.3 정본
       ↓
   baseFlags = PermissionFlagBuilder.build({ cliKind, permissionMode, projectKind, ... })
       ↓
[채널-권한 filter]       ← 본 ADR 신설
       ↓
   filteredFlags = filterFlagsByMemberPermission(baseFlags, { cliKind, permissions: snapshot })
       ↓
[CLI spawn]
```

**Filter 규칙** (v2 그대로):

| CLI | 작동 메커니즘 | 권한 → 도구 매핑 |
|-----|--------------|-----------------|
| **Claude** | `--allowedTools` 의 콤마 리스트에서 권한 외 도구 제거 | `file_write=false` → `Edit`, `Write`, `MultiEdit`, `NotebookEdit` 제거 |
| (동) | (동) | `command_exec=false` → `Bash` 제거 |
| (동) | (동) | `web_search=false` → `WebSearch`, `WebFetch` 제거 |
| (동) | (동) | `file_read=false` → `Read`, `Glob`, `Grep` 제거 (사실상 비-사용 시나리오 — fail-closed 단언) |
| (동) | (동) | `db_read` 는 Claude 도구 화이트리스트 직접 매핑 X — prompt only |
| **Codex** | `--sandbox` / `-a` 가 작업장 mode 정본 — 도구 단위 화이트리스트 없음 | prompt only |
| **Gemini** | `--approval-mode` 단일 축 | prompt only |

**구체 구현:**
- `src/main/permissions/permission-flag-filter.ts` 신설.
- input = `{ cliKind, baseFlags: PermissionFlagOutput, permissions: PermissionSet }`.
- output = `{ flags, rationale, filtered: { removedTools } }`.

**spec 본문 갱신:** §7.6.4 신설 + 번호 시프트 권장 — 본문은 **"채널-권한 filter"** 로 명명 (v2 의 "직원-권한 filter" 가 아님). plan T 에 포함.

**리스크:** v2 와 동일.

---

## 3. 결정 요약 표 (v3 확정안)

| # | 결정 포인트 | v2 (1차 결재) | **v3 (최종 — 채널 단위)** |
|---|------------|---------------|---------------------------|
| D1 | 권한 부여 단위 | 프로젝트 × 부서 2계층 | **채널 1:1 (별도 도메인 X)** |
| D2 | 미설정 기본 | 읽기 허용 (fallback 1줄) | **동일** + ALTER DEFAULT (`file_read=1`) 로 모든 기존 채널 자동 backfill |
| D3 | 저장 | 별도 테이블 `project_role_permissions` | **`channels` 테이블 ALTER 5컬럼** |
| D3 IPC | — | `project:role-permission:list/set/reset` 3채널 | **`channel:get-permissions` + `channel:update-permissions` 2채널** |
| D3 UI | — | 프로젝트 설정 탭 | **채널 생성/설정 모달 권한 섹션** |
| D4 | 조회 | 회의 시작 + invalidation (Map<RoleId, PermissionSet>) | **동일 — 입력 source 만 채널** (snapshot 단일 PermissionSet) |
| D5 | argv 동기화 | 2단계 filter (입력 = role) | **동일 — 입력 source 만 채널** |

별도:
- **별도 1 (회의록 쓰기)**: 불필요 — fallback 안내 + 권한 단락 명시 (변경 없음).
- **별도 2 (구현 부서 동시 작업)**: § Follow-up 1 — 채널 단위 권한으로 *상당부분 자연 해결* (`#구현-스프린트-A` / `#구현-스프린트-B` 분리). 단, 동일 채널 내 메시지 race 동시성은 여전히 별도 과제.

---

## 4. 작업장 mode × 채널 권한 곱셈 매트릭스 (8셀 — v3)

채널 4 종 × 작업장 mode 3 종 × 미세조정 유무 = 핵심 8 셀.

| # | 작업장 mode | 채널 (role) | channels 권한 row | base argv (Claude) | filter 후 argv | prompt 권한 | 결합 행동 |
|---|----|----|----|----|----|----|----|
| 1 | auto | `#아이디어` (idea) | 카탈로그 default: read+web | Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch | Read,Glob,Grep,WebSearch,WebFetch | "권한: 파일 읽기 / 웹 검색" | argv + prompt 둘 다 read+web — 안전 + 일관 |
| 2 | auto | `#구현` (implement) | 카탈로그 default: read+write+exec | (동) | Read,Glob,Grep,Edit,Write,Bash (WebSearch/Fetch 제거) | "권한: 파일 읽기 / 파일 쓰기 / 명령 실행" | 풀권한 — 의도 그대로 |
| 3 | auto | `#구현-스프린트-B` (implement) | **미세조정: write=false** | (동) | Read,Glob,Grep,Bash | "권한: 파일 읽기 / 명령 실행" | **채널별 미세조정 우선** — 이 채널만 write 차단 |
| 4 | auto | system 채널 / DM (role=null) | ALTER DEFAULT: file_read=1, 나머지 0 | (동) | (PromptComposer 의 `channelRole=null` 분기로 권한 단락 생략, filter 도 그 분기) | (권한 단락 부재) | 컨텍스트 자체 부재 — 회의 발화 외 영역 |
| 5 | hybrid | `#아이디어` (idea) | 카탈로그 default | Read,Glob,Grep,Edit,Write,WebSearch,WebFetch | Read,Glob,Grep,WebSearch,WebFetch | "권한: 파일 읽기 / 웹 검색" | filter 가 Edit/Write 도 제거 — hybrid 보다 더 좁음 |
| 6 | approval | `#구현` (implement) | 카탈로그 default | Read,Glob,Grep,WebSearch,WebFetch + `--permission-mode default` | Read,Glob,Grep + default | "권한: 파일 읽기 / 파일 쓰기 / 명령 실행" | argv 좁고 prompt 풀 → write 시도 시 ApprovalCard (§7.7) |
| 7 | approval | 사용자 자유 채널 (role=general) | 카탈로그 default: read+web | (동) | Read,Glob,Grep + default | fallback (능력 미부여 시): "작업장 폴더 안 파일 읽기" | 가장 보수 — 모든 쓰기 결재 |
| 8 | auto | `#구현-스프린트-A` (implement) | **미세조정: file_read=1만, 나머지 0** | (동) | Read,Glob,Grep | "권한: 파일 읽기" + (별도1) "회의록은 채널 시스템이라 권한 무관" | 채널별 read-only 강제. CLI 자체가 다른 도구 없음 — fail-closed 완성 |

**Invariant:**
1. `argv ⊇ filter ⊇ prompt` 모든 셀에서 성립.
2. **채널별 미세조정이 항상 우선** — 셀 #3, #8 처럼 카탈로그 default 보다 채널 row 가 정본.
3. **mode × role × 미세조정 어떤 조합도 자기검열 발언 부재** — fallback 분기 (#7) 도 "읽기 허용" 안내.

---

## 5. Rolestra 7축 권한 비유 — 정합성 표 (v3)

| 축 | 코드 | v3 영향 |
|----|------|---------|
| 인사팀 (직원 명부) | `MemberProfileService` / `member_profiles` | 변경 0 |
| **출입증 (CLI argv)** | `PermissionFlagBuilder` + **신규 filter** | **filter layer 추가** (D5 — builder 무손상) |
| 출입문 경비원 (path-guard) | `PermissionService` | 변경 0 |
| 작업 감독관 (ExecutionService) | `execution-service.ts` | 변경 0 |
| 결재 담당자 (ApprovalService + AutonomyGate) | `approval-service.ts`, `autonomy-gate.ts` | 변경 0 |
| **통역사 (PromptComposer)** | `src/main/skills/prompt-composer.ts` | **wire-up 신설 + 권한 source = `ChannelPermissionResolver`** |
| 비서실 (i18n dictionary) | `notification-labels.ts` 등 | V1 영향 0, V2 에서 `TOOL_GRANT_LABEL_KO` locale 분기 |
| **채널 (R12-W 신규 책임)** | `ChannelService` + `ChannelRepository` | **권한 5컬럼 + EventEmitter 승격 + IPC 2채널** — v3 의 핵심 도메인 위치 |

**충돌 0** — 출입증 + 통역사 + 채널 세 축이 동시에 강화, 나머지 4 축 무손상.

---

## 6. 마이그레이션 / 인터페이스 영향 (v3)

### 6.1 신규 마이그레이션

**1건 (023-channel-permissions)** — ALTER 5건 + UPDATE 3건. § D3 정본 SQL.

### 6.2 코드 변경 표 (v3)

| 모듈 | 종류 | 변경 |
|------|------|------|
| `src/main/database/migrations/023-channel-permissions.ts` | **new** | ALTER 5건 + UPDATE 3건 (카탈로그 default backfill) |
| `src/main/database/migrations/index.ts` | edit | m023 import + 배열 추가 |
| `src/main/channels/channel-repository.ts` | edit | `CHANNEL_COLUMNS` 5컬럼 추가 + `insert` SQL 확장 + `getPermissions(channelId)` / `updatePermissions(channelId, patch)` 메서드 추가 |
| `src/main/channels/channel-service.ts` | edit | `extends EventEmitter` 승격 + `getPermissions(channelId)` / `updatePermissions(channelId, patch)` 메서드 + `createDepartmentChannels` / `createUserChannel` 시 권한 컬럼 채우기 + `PERMISSION_CHANGED_EVENT` 발사 |
| `src/main/permissions/channel-permission-resolver.ts` | **new** | `resolve(channelId): PermissionSet` — channels row 단일 lookup |
| `src/main/permissions/permission-flag-filter.ts` | **new** | `filterFlagsByMemberPermission(...)` — D5 filter layer |
| `src/main/permissions/permission-flag-builder.ts` | unchanged | spec §7.6.3 매트릭스 무손상 |
| `src/main/providers/cli/cli-provider.ts` (또는 spawn 경로) | edit | spawn 직전 base argv → filter 호출 → spawn argv |
| `src/main/meetings/engine/meeting-session.ts` | edit | `permissionSnapshot: PermissionSet | null` 필드 + dirty flag + EventEmitter 구독/해제 |
| `src/main/meetings/engine/meeting-turn-executor.ts:534-541` | edit | `buildPermissionRules` 호출 폐기, `PromptComposer.compose(...)` 호출 + permissionSnapshot 활용 |
| `src/main/meetings/engine/meeting-turn-executor.ts` deps | edit | `MeetingTurnExecutorDeps.promptComposer: PromptComposer` 추가 |
| `src/main/meetings/engine/meeting-orchestrator.ts` (또는 wire-up) | edit | turn-executor 생성 시 promptComposer + channelPermissionResolver 주입 |
| `src/main/index.ts` (composition root) | edit | PromptComposer / ChannelPermissionResolver wire / ChannelService emitter 구독 / IPC handler DI |
| `src/main/ipc/handlers/channel-permission-handler.ts` | **new** | 2 채널 핸들러 |
| `src/main/ipc/router.ts` | edit | 2 채널 register |
| `src/shared/ipc-types.ts` | edit | `IpcChannelMap` 2채널 추가 |
| `src/shared/ipc-schemas.ts` | edit | 2 zod schema 추가 |
| `src/shared/permission-set-types.ts` | **new** | `PermissionSet` 인터페이스 + 카탈로그 default 변환 helper |
| `src/renderer/features/channels/CreateChannelModal.tsx` (기존 또는 신규) | edit/new | 부서 template 드롭다운 + 권한 섹션 추가 |
| `src/renderer/features/channels/ChannelSettingsModal.tsx` (기존 또는 신규) | edit/new | 권한 섹션 + template 으로 리셋 버튼 |
| `src/renderer/hooks/use-channel-permissions.ts` | **new** | IPC round-trip + zustand store + Optimistic UI |
| `src/renderer/i18n/locales/{ko,en}/*.json` | edit | UI 라벨 + 부서 template 6 라벨 + 권한 5 axis 라벨 |
| `src/main/members/persona-permission-rules.ts` | **delete** | 모든 호출자 제거 후 |
| `src/shared/file-types.ts:9-20, 81-85` | **delete** | `FilePermission` / `DEFAULT_FILE_PERMISSION` 삭제 |
| `src/main/skills/prompt-composer.ts` | edit | 1) fallback 분기에 D2 안내 1줄 추가. 2) `compose()` 입력에 `permissionSnapshot` 추가 |

### 6.3 IPC 영향

**+2 채널** (v2 의 +3 채널 → v3 의 +2 채널).

### 6.4 spec 문서 정합성

| spec 절 | 현재 | v3 적용 후 |
|---------|------|-----------|
| §7.6.1 방어 범위 표 | path-guard + argv 2축 | **argv + filter + prompt 3축** — 본문 1행 추가 |
| §7.6.3 매트릭스 | 작업장 mode 정본 | **무변경** |
| §7.6.4 path-guard | (현행 §7.6.4) | **§7.6.5 로 시프트 + 새 §7.6.4 "채널-권한 filter layer" 신설** |
| §7.6.5 (옛) → §7.6.6 | 권한 요청 인터셉트 | 번호 시프트, 본문 무변경 |

§7.6.4 신설 본문 (v3 — **채널** 단위로 명명):

```markdown
#### 7.6.4 계층 2.5 — 채널-권한 filter layer (R12-W)

§7.6.3 매트릭스가 생성한 base argv 위에 *채널 권한*
(ChannelPermissionResolver 결과) 으로 한 단계 더 좁힌다. 책임 분리:

| 축 | 결정 source |
|----|------------|
| sandbox / approval policy (`--sandbox`, `-a`, `--permission-mode`) | 작업장 mode (§7.6.3 정본) |
| 도구 화이트리스트 (`--allowedTools`, Claude 전용) | 채널 권한 (R12-W) |

Codex / Gemini 는 도구 단위 화이트리스트가 없어 prompt only 로
대체된다 (PromptComposer 의 "권한: ..." 안내 단락).

상세: `docs/R12_c2_2R/decisions/r12-w-member-file-permission.md`.
```

**spec 본문 수정 = §7.6.4 신설 1 페이지 + §7.6.1 표 1행 추가 + §7.6.4/§7.6.5 번호 시프트.**

---

## 7. Consequences (v3)

(+) 사용자 보고 자기검열 발언 해소 + 다중 방어 강화.
(+) "구현 부서 동시 작업" 시나리오에서 채널별 권한 분기 가능 (§ Follow-up 1).
(+) R12-S decision log "PromptComposer 합성 경로" 가 실제로 land.
(+) **사용자 mental model 정확히 반영** — *권한 단위 = 채널 1개*.
(+) **v2 대비 도메인 단순화** — 별도 테이블 / repository / service / 3 IPC / 프로젝트 탭 UI 폐기 → channels 테이블 ALTER + service 메서드 2개 + IPC 2채널 + 모달 섹션.
(+) **카탈로그 default 변경 파급이 forward-only** — 기존 채널 무영향, 신규만 새 default. 사용자 mental model 과 정합.

(−) 카탈로그 default 의 사용자 수정 UI 없음 (B-①) — 부서 전체 변경은 일괄 변경 follow-up 의존.
(−) 채널 1:1 이라 *같은 부서 여러 채널* 간 권한 sync 부재 — 의도적 활용 가능 / 의도하지 않은 drift 가능. UI "template 으로 리셋" mitigation.
(−) D4 EventEmitter 구독 lifecycle — `MeetingSession` 종료 시 detach 필수. Plan T verify.

---

## 8. 신규 코드 추정 (LoC — v3, v2 비교)

| 영역 | v2 LoC | v3 LoC | 증감 |
|------|--------|--------|------|
| migration 023 + index.ts | 50 | 80 | +30 (ALTER 5건 + UPDATE 3건 SQL) |
| Repository (v2: 신규 클래스, v3: channel-repository edit) | 180 | 80 | **−100** |
| Service (v2: 신규 클래스, v3: channel-service edit + EventEmitter 승격) | 150 | 90 | **−60** |
| Resolver (v2: 2계층 결합, v3: 단일 source) | 120 | 60 | **−60** |
| permission-flag-filter | 200 | 200 | 0 |
| permission-set-types (shared) | 80 | 80 | 0 |
| IPC handler + zod + router (v2: 3채널, v3: 2채널) | 180 | 130 | **−50** |
| meeting-session 변경 | 120 | 100 | −20 (snapshot 단일 PermissionSet) |
| meeting-turn-executor 변경 | 60 | 60 | 0 |
| prompt-composer 변경 | 50 | 50 | 0 |
| cli-provider spawn wire-up | 40 | 40 | 0 |
| index.ts DI | 60 | 50 | −10 |
| **UI** (v2: 신규 탭, v3: 기존 모달 edit) | 350 | 200 | **−150** |
| use-channel-permissions hook + store | 150 | 120 | −30 |
| i18n ko/en JSON | 80 | 70 | −10 |
| 옛 코드 삭제 | −120 | −120 | 0 |
| **신규 production 합계** | **1,750** | **1,290** | **−460 (약 26% 감소)** |
| Vitest unit | 800 | 600 | −200 |
| Vitest integration | 300 | 280 | −20 |
| Playwright E2E (3 시나리오) | 200 | 200 | 0 |
| **테스트 합계** | **1,300** | **1,080** | −220 |
| **총합 (production + test)** | **3,050** | **2,370** | **−680 (약 22% 감소)** |

> v3 가 v2 대비 약 1/4 감소. 사용자 mental model 일치 + 코드 단순화 둘 다 달성.

---

## 9. Follow-up (별도 ADR / 라운드)

### Follow-up 1 — 구현 부서 동시 작업 동시성 모델 (재검토 — v3 에서 변화)

**v3 의 채널 단위 권한이 상당부분 자연 해결한다.** 사용자가 다음 패턴으로 동시 작업 가능:

- `#구현-스프린트-A` 채널 생성 (role=implement, 권한 미세조정 가능)
- `#구현-스프린트-B` 채널 생성 (동일)
- 각 채널에 다른 직원 배치 + 각 채널이 독립 회의 진행 + 각 채널이 독립 권한

**채널 단위 권한 분리 + 채널 단위 회의 격리 (R12-C 의 "채널 = 회의 컨텍스트 단위") → 영역 분할이 *자연스럽게* 해결.**

**남은 과제 (별도 ADR 후보 — `r12-x-channel-concurrency.md`):**
1. **같은 채널 내 직원 메시지 race** — turn 단위 sequence 라 본질적으로 sequential, 다만 cross-channel coordination 은 별도.
2. **물리 파일 시스템 race** — 두 채널의 implement 직원이 같은 파일 동시 수정. ExecutionService dryRun→승인→atomic apply 가 single-writer 라 application 단계는 sequential, 다만 CLI 자체 spawn write 는 ExecutionService 우회 가능 (spec §7.6.1 한계).
3. **branch 모델 / mutex / channel-scoped sub-folder 강제** — 본질적으로 동시성 모델은 채널 권한과 직교.

→ **v3 시점에 Follow-up 1 의 필요성이 v2 시점 대비 *낮아짐***. 사용자 사용 패턴이 채널 분리로 자연 해결 가능. 1번/2번/3번 중 사용자 실제 마찰 보고가 있을 때 별도 ADR.

### Follow-up 2 — `skill_overrides` 스키마 확장

현재 systemPromptKo 텍스트 override. V2 에서 toolGrants override 도 추가 가능. 본 ADR 의 *채널* 단위 권한과 직교 axis — 필요 시 별도 마이그레이션.

### Follow-up 3 — UI 편의 기능

- "같은 부서 모든 채널에 이 권한 일괄 적용" — D3 의 사용자 수정 UI 없음 (B-①) 한계 mitigation.
- "이 채널 권한을 다른 채널에 복사".
- 권한 변경 감사 로그 (`AuditEntry`) — 누가 언제 권한 바꿨나.
- 채널 생성 모달의 부서 template 드롭다운에 "권한 미리보기" — 5축 toolGrants 가 토글에 자동 채워지는 시각 피드백.

### Follow-up 4 — argv filter 의 Codex / Gemini 강화

Codex `--sandbox` 세부 옵션 (workspace-write / read-only / danger-full-access) 을 채널 권한과 곱해서 더 정교한 매트릭스. 별도 ADR.

### Follow-up 5 — 채널 부서 자체 변경

채널 생성 후 `role` 컬럼 변경 (`#아이디어` → `#구현` 같은). v3 에서는 read-only 드롭다운으로 두고 — 부서 변경이 권한 default 재적용 + 회의 기록 의미 변경을 동반. V1 범위 밖.

---

## 10. 관련 문서

- spec: `docs/specs/2026-04-18-rolestra-design.md` §7.6 — 본 ADR land 후 §7.6.4 신설 (Plan T)
- ADR 선행: `docs/decisions/r12-s-persona-skills.md` (SKILL_CATALOG + PromptComposer), `docs/decisions/r12-c-channel-roles.md` (`channels.role` 컬럼 land)
- ADR cross-cutting: `docs/decisions/cross-cutting.md` C3 / C4 / C6 / C7
- plan: `docs/R12_c2_2R/plans/2026-05-11-rolestra-r12-w-member-file-permission.md`
- 사전 확인 결과 위치: `src/main/database/migrations/018-channels-role-purpose-handoff.ts` (`channels.role` 컬럼), `src/main/channels/channel-service.ts:227-236` (`DEFAULT_DEPARTMENT_BLUEPRINT`), `src/main/channels/channel-service.ts:795-839` (`createDepartmentChannels`), `src/shared/skill-catalog.ts` (카탈로그 default 정본)
