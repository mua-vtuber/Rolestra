# Legacy v2 Migrations (archived 2026-04-19)

이 디렉토리는 AI Chat Arena v2의 마이그레이션 원본이다. v3(Rolestra)는 새 체인 `src/main/database/migrations/001-core.ts` ~ `011-notifications.ts`를 사용한다.

## 이식 매핑

- `001-initial-schema.ts` → v3 `009-audit.ts` (audit_log 부분만 이식)
- `002-recovery-tables.ts` → 폐기 (recovery는 v3에서 `approval_items` + `queue_items`로 대체)
- `003-remote-tables.ts` → v3 `010-remote.ts`
- `004-memory-enhancement.ts` → v3 `008-memory.ts`
- `005-consensus-records.ts` → 폐기 (합의 로직은 v3 `consensus-folder-service` + `meetings`로 재설계)
- `006-consensus-summary.ts` → 폐기 (위와 동일 사유)
- `007-session-mode-columns.ts` → 폐기 (위와 동일 사유)

## 주의

- 이 파일들은 `src/main/database/migrations/index.ts`에서 **import되지 않으며**, 런타임 번들에도 포함되지 않는다 (tree-shaking 대상).
- v2 DB 파일이 남아있는 환경에서 v3를 부팅하면 `assertNoLegacyMigrations()`가 예외를 던져 시작을 차단한다. 사용자는 fresh ArenaRoot를 만들어야 한다.
- Phase R11에서 완전 삭제 예정.
