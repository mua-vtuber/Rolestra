# 아키텍처 결정 기록 (ADR)

Rolestra v3 의 모든 phase 별 + cross-cutting 결정사항을 phase 묶음 단위로 정리한다.
R11 D8 결정에 따라 phase 별 단일 markdown 파일로 통합 (개별 ADR-NNN 파일 미채택).

| 파일 | 다루는 phase | 핵심 결정 |
|------|--------------|----------|
| [R1-R3-decisions.md](R1-R3-decisions.md) | R1 폴더 격리 스모크 / R2 v3 DB+Main+IPC / R3 디자인 시스템 초기 | ArenaRoot 단일 진입, v3 마이그레이션 011, theme-tokens 자동 생성 |
| [R4-R6-decisions.md](R4-R6-decisions.md) | R4 대시보드+프로젝트 / R5 채널+메신저 / R6 회의 엔진 v3 재작성 | 비대칭 KPI 그리드, themeKey 3-way DOM 분기, v2 engine D1 옵션 E |
| [R7-R9-decisions.md](R7-R9-decisions.md) | R7 승인 인박스 / R8 멤버 프로필 / R9 자율 모드 + Notification | ApprovalPayload union, Popover/Modal 2단계, AutonomyGate 분리 |
| [R10-decisions.md](R10-decisions.md) | R10 polish (DM/Search/Settings/themes/Optimistic UI/Circuit Breaker persist) | 형태 토큰 fidelity, Optimistic UI 3 hook 한정, 마이그레이션 012 |
| [R11-decisions.md](R11-decisions.md) | R11 레거시 청소 + 패키징 + 문서 v3 | electron-builder 채택, mig 013/014, ADR phase 묶음 D8, locale 분기 D9 |
| [cross-cutting.md](cross-cutting.md) | phase 무관 핵심 invariant | ConsensusStateMachine, Provider Capability Registry, ExecutionService 경계, IPC TypedInvoke, secrets safeStorage, path-guard, i18n dictionary |
