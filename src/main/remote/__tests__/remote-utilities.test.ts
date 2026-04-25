/**
 * Remote Access utility unit tests — R12+ 재설계 후 재작성 예정.
 *
 * 원본 v2 단위 테스트는 R11-Task3 (commit 332955a 직후 baseline) 시점에
 * 삭제된 v2 마이그레이션 (`001-initial-schema`, `003-remote-tables`) 에
 * 직접 의존했다. R11 closeout (spec §10) 에 Remote Access 항목이 포함되지
 * 않으므로, R12+ 에서 RemoteAuth/Session/Audit 의 v3 인터페이스 + 새
 * repository 계층 정합 후 단위 테스트를 새로 작성한다.
 *
 * 그때까지 suite 자체는 skip 상태로 둔다 — `it.skip` 라벨을 통해 의도가
 * 보이도록 하고, vitest 실행에는 영향이 없다.
 */
import { describe, it } from 'vitest';

describe.skip('Remote Access Utilities (R12+ 재설계 대기)', () => {
  it.skip('RemoteAuth / RemoteSessionTracker / RemoteAuditLogger (R12+ 재작성 예정)', () => {
    // 본문은 의도적으로 비워둔다. R12+ 진입 시 v3 인터페이스 정합 후
    // 단위 테스트 묶음으로 대체한다.
  });
});
