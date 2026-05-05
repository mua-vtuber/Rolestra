/**
 * Migration 020-run-step — R12-C2 P2 회의 turn *진행 일지* 영속 레이어.
 *
 * 회의 안 모든 turn 의 의도 / 입력 / 출력 / 사이드이펙트 / 분류 결과를
 * 영속 저장하는 *진행 일지* (RunStep) 테이블. 회의록 (`minutes.md` —
 * 모더레이터 작성, 의견 단위) 과 별개 — RunStep 은 *시스템 단계 단위* 로
 * 누적된다.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19  A. RunStep 영속 기록부 (cross-cutting)
 *
 * 활용처 (R12-C2 후속 후보):
 *  - B (NextStep 분류, T13)   step_kind='next_step_classify' row 가 분류 결과 영속
 *  - F (검사관, T11)          step_kind='inspector_check' row 가 위반 검출 영속
 *  - H (진행률, T31~T34)      부서별 RunStep count + step_kind 분포 → 진행률 산출
 *  - 회의 재현 (디버깅)       meeting_id 기준 turn-by-turn replay
 *
 * 컬럼 명세 (spec §11.19.2):
 *  - id (UUID v4 PK)
 *  - meeting_id (FK CASCADE)  회의 삭제 시 일지도 사라짐 (orphan 방지)
 *  - channel_id (FK CASCADE)  채널 삭제 시 일지도 사라짐
 *  - round                    회의 라운드 카운터 (max_rounds 와 정렬)
 *  - turn_index               회의 안 turn 순서 (0 부터, 같은 turn = 같은 index)
 *  - actor_kind               'system' | 'employee' | 'moderator' | 'user'
 *  - actor_id (FK SET NULL)   직원 삭제해도 일지 보존 (감사 무결성)
 *  - step_kind                10 enum (spec §11.19.2)
 *  - input_json               step 입력 (JSON 문자열, truncate 금지)
 *  - output_json              step 출력 (JSON 문자열, truncate 금지)
 *  - next_step_card           B1 분류 결과 7 enum + NULL (step_kind='next_step_classify' 만 채움)
 *  - side_effect_summary      1-line 요약 (NULL 허용 — 사이드이펙트 없는 step)
 *  - duration_ms              step 소요 시간
 *  - created_at               INTEGER (Unix epoch ms — opinion 등 다른 테이블과 일관)
 *
 * 인덱스 (spec §11.19.2):
 *  - (meeting_id, turn_index)    회의 turn-by-turn replay query
 *  - (channel_id, created_at)    채널 진행률 + 시간순 query
 *
 * 저장 정책 (spec §11.19.4):
 *  - 모든 turn = 1 row 이상         caller (T13 orchestrator) 책임
 *  - truncate 금지                  RunStepService 가 input/output_json 통째 보존
 *  - atomic write                   한 turn 의 row 들은 transaction 묶음 (부분 실패 rollback)
 *  - append-only                    update / delete X — 서비스 레이어가 메서드 미노출로 강제
 *
 * Idempotency 정책: migrator 가 applied set 으로 1 회 실행 보장 (chain 019 와 동일
 * — `CREATE TABLE` 에 `IF NOT EXISTS` 없음). T11 inspector mig-non-idempotent
 * 는 phase 1 에서 framework-managed false positive 로 인정.
 *
 * Migration files are immutable once applied.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '020-run-step',
  sql: `
CREATE TABLE run_step (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  turn_index INTEGER NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('system','employee','moderator','user')),
  actor_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
  step_kind TEXT NOT NULL CHECK(step_kind IN (
    'opinion_gather','opinion_tally','quick_vote','free_discussion',
    'minutes_compose','next_step_classify','handoff_dispatch',
    'tool_invoke','approval_request','inspector_check'
  )),
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  next_step_card TEXT CHECK(next_step_card IS NULL OR next_step_card IN (
    'continue','wait','approve','tool','handoff','minutes','end'
  )),
  side_effect_summary TEXT,
  duration_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_run_step_meeting_turn ON run_step(meeting_id, turn_index);
CREATE INDEX idx_run_step_channel_created ON run_step(channel_id, created_at);
`,
};
