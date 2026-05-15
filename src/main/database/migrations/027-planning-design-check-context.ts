/**
 * Migration 027-planning-design-check-context — R12-C2 4차 결함 수정.
 *
 * 기존 planning_design_check row 에 원래 기획 회의록, 같은 작업 묶음 키,
 * 사용자 판단 결과를 forward-only 로 덧붙인다. 026 은 이미 배포 가능한
 * migration 이므로 수정하지 않는다.
 */

import type { Migration } from '../migrator';

export const migration: Migration = {
  id: '027-planning-design-check-context',
  sql: `
ALTER TABLE planning_design_check
  ADD COLUMN work_bundle_key TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN original_planning_minutes_id TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN original_planning_minutes_path TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN original_planning_minutes_body TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN original_planning_minutes_missing_reason TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN user_decision TEXT CHECK(user_decision IN (
    'send_to_implementation',
    'request_design_revision',
    'stop'
  ));

ALTER TABLE planning_design_check
  ADD COLUMN user_decision_note TEXT;

ALTER TABLE planning_design_check
  ADD COLUMN user_decision_dispatch_id TEXT;

CREATE INDEX idx_planning_design_check_work_bundle
  ON planning_design_check(project_id, work_bundle_key, status, user_decision);
CREATE INDEX idx_planning_design_check_design_return_dispatch
  ON planning_design_check(design_return_dispatch_id);
`,
};
