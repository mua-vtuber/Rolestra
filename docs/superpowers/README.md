# superpowers 받은편지함

이 폴더는 **임시 출구**다. superpowers 플러그인이 새 plan / spec / checklist 를 자동 생성할 때 여기에 떨어뜨린다.

## 들어오면 즉시 옮길 곳

| 들어온 것 | 옮길 위치 |
|---------|----------|
| `plans/*.md` + `plans/*.tasks.json` | `docs/plans/` |
| `specs/*-design.md` | `docs/specs/` |
| `specs/r*-done-checklist.md` | `docs/checklists/` |
| `specs/appendix-*` | `docs/specs/appendix/` |
| `specs/*-prep-*-analysis.md` | `docs/reports/analysis/` |

## 왜 받은편지함인가

- 새 산출물이 들어왔을 때 **즉시 시각적으로 식별** 가능 (이 폴더가 비어있다 → 새 게 없다)
- superpowers 의 자동 생성 동작을 그대로 두되, 정리는 사람이 한 번에
- 옮긴 후 이 폴더는 다시 비워야 정상

## 주의

- 권위 문서를 **여기에 보관하지 말 것**. 모든 산출물은 분류된 폴더로 이동.
- 이 폴더에 오래 머무르는 파일이 있다면 정리 누락이거나, 새 카테고리가 필요하다는 신호.

자세한 폴더 정책은 [`docs/README.md`](../README.md) 참조.
