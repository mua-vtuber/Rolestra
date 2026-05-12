/**
 * Migration 022-handoff-dispatch — R12-C2 P6 T27 부서 → 부서 *외주 의뢰서*
 * 영속 레이어.
 *
 * 부서 회의가 종결될 때 발생하는 *인계* (보낸 부서 → 받는 부서) 를 1 row =
 * 1 의뢰서로 영속한다. spec §11.18.8c 의 handoff_mode 분기 (check / auto) +
 * §11.22 H2 받는 부서 첫 화면 인계 패키지 + §11.16 부서 lock 사이클이 본
 * 테이블의 row 위에서 surface.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.18.8c  handoff_mode 우회 룰 (B1 「인계」 카드 → 채널 정책 적용)
 *  §11.22.3   handoff_dispatch 데이터 source — 컬럼 명세
 *  §11.16     부서 lock 사이클 (인계 시점 = lock 풀림)
 *
 * plan docs/R12_c2_2R/plans/2026-05-04-rolestra-phase-r12-c2.md
 *  T27 line 469-482 — handoff_dispatch 테이블 + HandoffPackage schema +
 *                     HandoffDispatchService 3 method (dispatch / open / track)
 *
 * 컬럼 명세:
 *  - id (UUID v4 PK)             의뢰서 식별자
 *  - from_meeting_id (FK CASCADE) 보낸 회의 — 회의 삭제 시 의뢰서도 사라짐
 *  - from_channel_id (FK CASCADE) 보낸 부서 채널
 *  - to_channel_id   (FK CASCADE) 받는 부서 채널
 *  - reason                       인계 사유 (자유 텍스트, 회의록 외 metadata)
 *  - minutes_id      (NULL 허용)  보낸 회의록 reference. 회의록 본문은
 *                                 `<ArenaRoot>/<projectId>/consensus/<meetingId>/minutes.md`
 *                                 — DB 컬럼은 식별자만 보존 (truncate 금지 정책 +
 *                                 SSoT). NULL = 회의 외 진입 (변경 요청 등).
 *  - mission_card_json            T23 MissionCard schema 의 JSON 직렬화. 받는
 *                                 부서 designated worker 가 작업 시작할 때
 *                                 prompt 컨텍스트로 사용.
 *  - mode ('check' | 'auto')      handoff_mode 분기 (§11.18.8c). 사용자 결재
 *                                 모달 등장 여부.
 *  - dispatched_at (Unix epoch ms) 보낸 시각 — 회의 종결 직후
 *  - opened_at     (NULL 허용)    받는 부서 첫 진입 시각 — 받는 채널이
 *                                 처음 surface 한 순간 캐시. NULL = 미열람.
 *  - created_at (Unix epoch ms)   row insert 시각 (dispatched_at 과 보통 동일,
 *                                 향후 retry / 재발송 시 dispatched_at != created_at
 *                                 구분 가능하도록 별 컬럼 보존).
 *
 * 인덱스 (spec §11.22.3 + 사용 패턴):
 *  - (to_channel_id, dispatched_at)  받는 부서 채널 entry 시 미열람 패키지 query
 *  - (from_meeting_id)               회의 삭제 시 cascade lookup
 *
 * Idempotency 정책: migrator 가 applied set 으로 1 회 실행 보장 (chain 020/021
 * 와 동일). T11 inspector mig-non-idempotent 는 phase 1 에서 framework-managed
 * false positive 로 인정.
 *
 * Forward-only: 새 테이블 + 새 인덱스 추가만 — DROP / RENAME / ALTER DROP X.
 * T11 inspector mig-non-forward-only 통과.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '022-handoff-dispatch',
  sql: `
CREATE TABLE handoff_dispatch (
  id TEXT PRIMARY KEY,
  from_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  from_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  to_channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  minutes_id TEXT,
  mission_card_json TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('check','auto')),
  dispatched_at INTEGER NOT NULL,
  opened_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_handoff_dispatch_to_channel ON handoff_dispatch(to_channel_id, dispatched_at);
CREATE INDEX idx_handoff_dispatch_from_meeting ON handoff_dispatch(from_meeting_id);
`,
};
