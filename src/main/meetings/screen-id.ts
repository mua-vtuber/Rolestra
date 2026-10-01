/**
 * Screen ID resolver — UUID 기반 opinion 트리 ↔ 화면 ID 매핑
 * (R12-C2 P2-2 / spec §11.18.3 + §11.18.1).
 *
 * DB 진실원천 = `opinion.id` (UUID) + `opinion.parent_id` (UUID|NULL).
 * 화면 ID (`ITEM_NNN` / `ITEM_NNN_NN` / `ITEM_NNN_NN_NN`) 는 *DB 비저장* —
 * 시스템이 parent chain depth-first 순회로 매번 재구성한다.
 *
 * 알고리즘:
 *   1. 입력 = `Opinion[]` (created_at 오름차순). meetingId 한 회의분.
 *   2. root (`parentId === null`) 의견을 created_at 순서대로 ITEM_001,
 *      ITEM_002, ITEM_003 ... 부여.
 *   3. 각 root 의 직계 자식 (parentId === root.id) 을 created_at 순서대로
 *      ITEM_NNN_01, ITEM_NNN_02 ... 부여.
 *   4. 손자 = ITEM_NNN_NN_01, ... — 깊이 cap 3 도달.
 *
 * 깊이 cap 3 = ITEM_001_01_01 (depth=2, 0-base) 까지. 그 이상 추가는
 * service 가 throw 차단 (silent fallback X). 본 모듈은 *입력 데이터에 cap
 * 위반이 이미 있으면 경고 없이 그대로 표현* — service 진입 시 cap 검증이
 * 1 차 방어선. DB 자체에는 cap 강제가 없다 (FK + RESTRICT 만).
 *
 * 부모가 입력 list 에 *없는* 자식 (orphan) — 즉 parent_id 가 가리키는
 * UUID 가 입력에 없으면, 본 모듈은 *루트 list 끝에 새 root* 로 부여.
 * 정상 데이터에서는 발생하지 않지만 (FK CASCADE 가 보장), 회의 도중
 * 부분 fetch 같은 edge 에서 안전하게 표시되도록 한다.
 *
 * 화면 ID 형식 (zero-padded):
 *  - root  : `ITEM_001` … `ITEM_999` (3 자리, 1000 이상은 자릿수 자연 확장)
 *  - 자식  : `ITEM_001_01` … `ITEM_001_99` (2 자리)
 *  - 손자  : `ITEM_001_01_01` … (2 자리)
 */

import type { Opinion, OpinionTreeNode } from '../../shared/opinion-types';

/** 깊이 cap — 0 = root, 1 = 자식, 2 = 손자. 3 이상 = 차단 대상. */
export const OPINION_DEPTH_CAP = 3;

/**
 * 화면 ID 부여 + 트리 빌드 결과. service.tally 가 이 모양 그대로 wrap
 * 해 IPC 응답으로 반환.
 */
export interface ScreenIdMap {
  /** 화면 ID → UUID 역매핑 (caller 가 직원 응답 안 target_id 파싱 시). */
  screenToUuid: Map<string, string>;
  /** UUID → 화면 ID 정매핑 (UI 표시 / 회의록 작성 시). */
  uuidToScreen: Map<string, string>;
  /** depth-first 트리 (root list, 각 노드에 children 재귀). */
  tree: OpinionTreeNode[];
  /** UUID → depth (0/1/2). cap 검증 헬퍼. */
  uuidToDepth: Map<string, number>;
}

/**
 * Opinions list (created_at 오름차순 가정) 받아 화면 ID + 트리 빌드.
 *
 * 입력은 한 meeting (또는 channel) 단위. caller 가 미리 정렬해서 넘기면
 * 본 함수는 그 순서를 *그대로* 화면 ID 부여 순서로 사용한다 — 안정성을
 * 위해 UUID 기반 tiebreaker 까지 caller 책임.
 */
export function buildScreenIdMap(opinions: Opinion[]): ScreenIdMap {
  const screenToUuid = new Map<string, string>();
  const uuidToScreen = new Map<string, string>();
  const uuidToDepth = new Map<string, number>();
  const childrenByParent = new Map<string | null, Opinion[]>();

  // 부모별 자식 list 구축 — 입력 순서 보존 (created_at 오름차순).
  for (const op of opinions) {
    const key = op.parentId;
    const arr = childrenByParent.get(key);
    if (arr) arr.push(op);
    else childrenByParent.set(key, [op]);
  }

  // root list — parentId === null + orphan (parent 가 입력 list 에 없음)
  // 두 부류 합집합. 정상 데이터에서는 orphan 0.
  const opinionIds = new Set(opinions.map((o) => o.id));
  const roots: Opinion[] = [];
  for (const op of opinions) {
    if (op.parentId === null) {
      roots.push(op);
    } else if (!opinionIds.has(op.parentId)) {
      // orphan — 안전 fallback: root 처럼 표시
      roots.push(op);
    }
  }

  // depth-first 부여
  const tree = roots.map((root, idx) =>
    assignNode(root, idx + 1, '', 0, childrenByParent, screenToUuid, uuidToScreen, uuidToDepth),
  );

  return { screenToUuid, uuidToScreen, uuidToDepth, tree };
}

function assignNode(
  opinion: Opinion,
  ordinal: number,
  parentScreenId: string,
  depth: number,
  childrenByParent: Map<string | null, Opinion[]>,
  screenToUuid: Map<string, string>,
  uuidToScreen: Map<string, string>,
  uuidToDepth: Map<string, number>,
): OpinionTreeNode {
  const screenId =
    depth === 0
      ? `ITEM_${pad(ordinal, 3)}`
      : `${parentScreenId}_${pad(ordinal, 2)}`;

  screenToUuid.set(screenId, opinion.id);
  uuidToScreen.set(opinion.id, screenId);
  uuidToDepth.set(opinion.id, depth);

  // 자식 재귀. 깊이 cap 도달해도 표현은 계속 (cap 강제는 service 책임).
  const childOpinions = childrenByParent.get(opinion.id) ?? [];
  const children = childOpinions.map((child, idx) =>
    assignNode(
      child,
      idx + 1,
      screenId,
      depth + 1,
      childrenByParent,
      screenToUuid,
      uuidToScreen,
      uuidToDepth,
    ),
  );

  return { opinion, screenId, depth, children };
}

function pad(n: number, width: number): string {
  const s = String(n);
  if (s.length >= width) return s;
  return '0'.repeat(width - s.length) + s;
}

/**
 * 화면 ID record 변환 헬퍼 — IPC 응답 직렬화 (Map → 평탄 객체).
 */
export function mapToRecord(m: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of m.entries()) out[k] = v;
  return out;
}
