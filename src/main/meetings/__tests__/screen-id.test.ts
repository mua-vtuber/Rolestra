/**
 * screen-id 단위 테스트 — buildScreenIdMap 알고리즘 (R12-C2 P2-2).
 *
 * 순수 함수 — DB 의존 0. 입력 = `Opinion[]` (created_at 오름차순 가정).
 * 출력 = screenToUuid / uuidToScreen / uuidToDepth + tree.
 *
 * 검증:
 *   - root 1 개 → ITEM_001
 *   - root 3 개 → ITEM_001 / ITEM_002 / ITEM_003 (created_at 순서대로)
 *   - root + 자식 → ITEM_001 / ITEM_001_01 / ITEM_001_02
 *   - root + 자식 + 손자 (cap 도달) → ITEM_001_01_01
 *   - depth 4 입력 (cap 위반) → 표현은 그대로 (service 가 cap 강제)
 *   - orphan (parent 가 입력 list 에 없음) → root 처럼 표시 (안전 fallback)
 *   - 빈 입력 → 빈 결과 모두
 */

import { describe, expect, it } from 'vitest';
import type { Opinion } from '../../../shared/opinion-types';
import {
  OPINION_DEPTH_CAP,
  buildScreenIdMap,
  mapToRecord,
} from '../screen-id';

const NOW = 1_700_000_000_000;

function mk(
  id: string,
  parentId: string | null,
  createdAt: number,
  overrides: Partial<Opinion> = {},
): Opinion {
  return {
    id,
    parentId,
    meetingId: 'm1',
    channelId: 'c1',
    kind: parentId === null ? 'root' : 'revise',
    authorProviderId: 'pv1',
    authorLabel: 'codex_1',
    title: id,
    content: id,
    rationale: 'r',
    status: 'pending',
    exclusionReason: null,
    round: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

describe('buildScreenIdMap', () => {
  it('returns empty maps + tree when input is empty', () => {
    const map = buildScreenIdMap([]);
    expect(map.tree).toEqual([]);
    expect(map.screenToUuid.size).toBe(0);
    expect(map.uuidToScreen.size).toBe(0);
    expect(map.uuidToDepth.size).toBe(0);
  });

  it('assigns ITEM_001 to a single root opinion', () => {
    const map = buildScreenIdMap([mk('a', null, NOW)]);
    expect(map.tree).toHaveLength(1);
    expect(map.tree[0].screenId).toBe('ITEM_001');
    expect(map.tree[0].depth).toBe(0);
    expect(map.screenToUuid.get('ITEM_001')).toBe('a');
    expect(map.uuidToScreen.get('a')).toBe('ITEM_001');
    expect(map.uuidToDepth.get('a')).toBe(0);
  });

  it('assigns ITEM_001 / ITEM_002 / ITEM_003 to three roots in created_at order', () => {
    const map = buildScreenIdMap([
      mk('a', null, NOW + 1),
      mk('b', null, NOW + 2),
      mk('c', null, NOW + 3),
    ]);
    expect(map.tree.map((n) => n.screenId)).toEqual([
      'ITEM_001',
      'ITEM_002',
      'ITEM_003',
    ]);
    expect(map.screenToUuid.get('ITEM_002')).toBe('b');
  });

  it('assigns ITEM_NNN_NN to direct children, in created_at order', () => {
    const map = buildScreenIdMap([
      mk('root', null, NOW + 1),
      mk('child1', 'root', NOW + 2),
      mk('child2', 'root', NOW + 3),
    ]);
    expect(map.tree[0].children).toHaveLength(2);
    expect(map.tree[0].children[0].screenId).toBe('ITEM_001_01');
    expect(map.tree[0].children[1].screenId).toBe('ITEM_001_02');
    expect(map.uuidToDepth.get('child1')).toBe(1);
    expect(map.uuidToDepth.get('child2')).toBe(1);
  });

  it('reaches cap depth (ITEM_NNN_NN_NN) at depth 2 (grandchild)', () => {
    const map = buildScreenIdMap([
      mk('r', null, NOW + 1),
      mk('c', 'r', NOW + 2),
      mk('gc', 'c', NOW + 3),
    ]);
    const grandchild = map.tree[0].children[0].children[0];
    expect(grandchild.screenId).toBe('ITEM_001_01_01');
    expect(grandchild.depth).toBe(OPINION_DEPTH_CAP - 1);
    expect(map.uuidToDepth.get('gc')).toBe(OPINION_DEPTH_CAP - 1);
  });

  it('represents depth 3 input without crashing — cap enforcement is service-side', () => {
    // Service blocks ADDING children to depth-2 nodes. If somehow depth-3 row
    // exists in DB (e.g. manual SQL), screen-id renders it as ITEM_NNN_NN_NN_NN
    // — same pattern, one level deeper. Caller (UI) may still want to clamp.
    const map = buildScreenIdMap([
      mk('r', null, NOW + 1),
      mk('c', 'r', NOW + 2),
      mk('gc', 'c', NOW + 3),
      mk('ggc', 'gc', NOW + 4),
    ]);
    const ggc = map.tree[0].children[0].children[0].children[0];
    expect(ggc.screenId).toBe('ITEM_001_01_01_01');
    expect(ggc.depth).toBe(3);
  });

  it('treats orphan (parent not in input) as a root — safe fallback', () => {
    const map = buildScreenIdMap([
      mk('r1', null, NOW + 1),
      mk('orphan', 'missing-parent', NOW + 2),
    ]);
    // r1 → ITEM_001, orphan → ITEM_002 (treated as root).
    expect(map.tree).toHaveLength(2);
    expect(map.tree[1].screenId).toBe('ITEM_002');
    expect(map.tree[1].opinion.id).toBe('orphan');
    expect(map.tree[1].depth).toBe(0);
  });

  it('preserves input ordering — caller-provided created_at sequence is final', () => {
    // Even if "logical" insertion would re-order, the algorithm honors input
    // order exactly. Caller is expected to pre-sort (created_at ASC, id ASC).
    const map = buildScreenIdMap([
      mk('z', null, NOW + 1),
      mk('a', null, NOW + 2),
    ]);
    expect(map.tree.map((n) => n.opinion.id)).toEqual(['z', 'a']);
    expect(map.tree[0].screenId).toBe('ITEM_001');
    expect(map.tree[1].screenId).toBe('ITEM_002');
  });

  it('zero-pads root ordinals to 3 digits and child ordinals to 2 digits', () => {
    // Build 5 roots; ordinals should be ITEM_001..ITEM_005 (3-digit pad).
    const opinions: Opinion[] = [];
    for (let i = 0; i < 5; i++) {
      opinions.push(mk(`r${i}`, null, NOW + i));
    }
    // Child 1 of root 0
    opinions.push(mk('c0', 'r0', NOW + 100));
    const map = buildScreenIdMap(opinions);
    expect(map.tree[4].screenId).toBe('ITEM_005');
    expect(map.tree[0].children[0].screenId).toBe('ITEM_001_01');
  });

  it('mapToRecord converts Map → plain object preserving entries', () => {
    const m = new Map<string, string>([
      ['ITEM_001', 'uuid-a'],
      ['ITEM_002', 'uuid-b'],
    ]);
    const rec = mapToRecord(m);
    expect(rec).toEqual({ ITEM_001: 'uuid-a', ITEM_002: 'uuid-b' });
  });
});
