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
