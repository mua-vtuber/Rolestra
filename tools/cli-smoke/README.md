# cli-smoke (Rolestra Phase R1)

격리된 CLI 권한·경로 매트릭스 검증 모듈. v2 엔진과 독립.

## 실행

```bash
npm run smoke:test    # 단위 테스트
npm run smoke:run     # 3 CLI × 3 모드 실제 매트릭스 실행
```

## 결과물

`matrix-results/YYYYMMDD-HHMMSS.json`에 각 시나리오 성공/실패 기록.
종합 매트릭스는 `docs/superpowers/specs/appendix-cli-matrix.md`.

## Phase Status

- **R1** ✅ 완료 — 격리 CLI smoke 매트릭스 (본 모듈).
- **R2** ✅ 완료 — v3 DB 스키마 + Main 레이어 + IPC.
- **R3** ✅ 완료 (2026-04-20) — v2 renderer → `_legacy/renderer-v1/` 이동, 6-테마 디자인 시스템 초기, Shell + primitive 기반. done-checklist: `docs/superpowers/specs/r3-done-checklist.md`.

### R1 원본 기록

- [x] Task 0 ~ 14 완료
- [x] 단위 테스트 전체 통과 (7 files / 43 tests)
- [x] 매트릭스 러너 1회 이상 실행 성공 (`matrix-results/` 참조)
- [x] `docs/superpowers/specs/appendix-cli-matrix.md` 기록
- [x] 첫 매트릭스 실측 결과: 13/18 ok, 5 fail (Codex CLI 플래그 교정 후속 작업)

### Phase R2 진입 체크리스트

R2("v3 DB 스키마 + Main 레이어 + IPC")로 넘어가기 전:

- [x] 위 체크박스 전부 ✓
- [ ] spec §7.6.3 Codex 섹션을 첫 실측 결과 기준으로 교정 (매트릭스 러너 결과 반영)
- [x] external + auto 거부 동작 관측 기록 존재 (3/3 expected-reject)
- [x] TOCTOU 재검증 동작 관측 기록 존재

### 발견된 Phase R1 후속 이슈

매트릭스 러너가 spec의 CLI 플래그 조합에 실제 CLI 거부 반응을 관측:

1. **Codex 어댑터**: 실제 `codex exec` 옵션과 spec §7.6.3 Codex 행의 일부 값이 불일치. 매트릭스가 FAIL 낸 근거를 `appendix-cli-matrix.md`에서 확인 후 Phase R2 초반에 spec 개정 + adapter 수정.
2. **Gemini approval 모드**: approval 모드의 tool 제약이 일부 관측됨 — 무인 환경에선 prompt 대기로 timeout. Rolestra 앱에선 approval UI로 interception 예정이니 이 자체는 설계대로.
3. Claude/Codex 인증 상태가 로컬 머신 마다 다르므로 실측 결과 재현 시 환경 메모는 appendix에 기재되어야 함.
