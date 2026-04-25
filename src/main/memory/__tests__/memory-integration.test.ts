/**
 * Memory System integration suite — V4 (Phase 3-b) 재작성 예정.
 *
 * 원본 v2 통합 테스트는 R11-Task3 (commit 332955a 직후 baseline) 시점에
 * 삭제된 v2 마이그레이션 (`001-initial-schema`, `004-memory-enhancement`)
 * 에 직접 의존했다. v3 메모리 파이프라인은 Phase 3-b (임베딩 + 하이브리드
 * 서치 + 반성/진화) 가 R12+ 에서 정식화되면 같은 시점에 통합 테스트를
 * 새로 작성한다 (참조: docs/superpowers/specs/2026-04-18-rolestra-design.md
 * §메모리 단계).
 *
 * 그때까지 suite 자체는 skip 상태로 둔다 — `it.skip` 라벨을 통해 의도가
 * 보이도록 하고, vitest 실행에는 영향이 없다.
 */
import { describe, it } from 'vitest';

describe.skip('Memory System Integration (V4 — Phase 3-b 재작성 대기)', () => {
  it.skip('extractor → retriever → assembler pipeline (V4 재작성 예정)', () => {
    // 본문은 의도적으로 비워둔다. V4 진입 시 v3 MemoryFacade + 임베딩
    // 파이프라인 + 하이브리드 검색을 묶은 새 통합 테스트로 대체한다.
  });
});
