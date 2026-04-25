/**
 * Remote Access integration suite — R12+ 재설계 후 재작성 예정.
 *
 * 원본 v2 통합 테스트는 R11-Task3 (commit 332955a 직후 baseline) 시점에
 * 삭제된 v2 마이그레이션 (`001-initial-schema`, `003-remote-tables`) 에
 * 직접 의존했다. R11 closeout (spec §10) 에 Remote Access 항목이 포함되지
 * 않으므로, R12+ 에서 토큰/세션/감사 로그 모델을 v3 IPC + repository 계층
 * 위에 다시 설계한 뒤 통합 테스트를 새로 작성한다.
 *
 * 그때까지 suite 자체는 skip 상태로 둔다 — `it.skip` 라벨을 통해 의도가
 * 보이도록 하고, vitest 실행에는 영향이 없다.
 */
import { describe, it } from 'vitest';

describe.skip('Remote Access Integration (R12+ 재설계 대기)', () => {
  it.skip('token → server start → authenticated request → audit log (R12+ 재작성 예정)', () => {
    // 본문은 의도적으로 비워둔다. R12+ 진입 시 v3 RemoteManager + 새
    // 권한 모델 + audit log repository 를 묶은 새 통합 테스트로 대체한다.
  });
});
