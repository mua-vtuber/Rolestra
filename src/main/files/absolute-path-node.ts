/**
 * `AbsolutePath` 파생 helper — main process 전용.
 *
 * R12-X T2 (ADR D4). `src/shared/absolute-path.ts` 는 renderer 번들에도
 * 들어가므로 `node:path` 를 import 할 수 없다 (CLAUDE.md 절대 규칙 1).
 * 반면 main 쪽에서 브랜드 값을 만드는 일의 대부분은
 * "이미 검증된 뿌리 아래로 join 한다" 한 가지 형태다. 그 형태를 여기 한
 * 곳에 모아 두면 `unsafeMarkAbsolute` 직접 호출이 흩어지지 않는다.
 *
 * 왜 join 결과가 절대경로인가:
 *   `path.join` 은 첫 인자의 절대/상대 성격을 유지한다. 첫 인자가
 *   `AbsolutePath` (= `asAbsolutePath` 검증을 통과했거나 다른 경계에서
 *   절대경로임이 보장된 값) 이면 결과도 반드시 절대경로다. 뒤 segment 에
 *   `..` 가 섞여도 절대경로라는 성질 자체는 깨지지 않는다 — 봉인 범위를
 *   벗어나는지 여부는 별개 문제이고, 그쪽은 `isPathWithin` 이 본다.
 */

import * as path from 'node:path';
import { unsafeMarkAbsolute, type AbsolutePath } from '../../shared/absolute-path';

/**
 * 이미 브랜드된 뿌리 아래로 segment 를 이어 붙인다.
 *
 * 결과는 재검증 없이 브랜드된다 — 위 JSDoc 이 그 보장의 근거다.
 *
 * @param root 검증을 통과한 절대경로.
 * @param segments 이어 붙일 상대 segment.
 */
export function joinAbsolute(
  root: AbsolutePath,
  ...segments: string[]
): AbsolutePath {
  // path.join 은 첫 인자의 절대경로 성격을 유지한다 — 파일 상단 JSDoc 참조.
  return unsafeMarkAbsolute(path.join(root, ...segments));
}

/**
 * 이미 브랜드된 절대경로의 철자를 `path.resolve` 로 정규화한다.
 *
 * 입력을 `AbsolutePath` 로 고정한 것이 핵심이다. raw `string` 을 받으면
 * `path.resolve` 가 상대 경로에 process cwd 를 채워 넣어 앱 실행 폴더가
 * 조용히 뿌리로 둔갑한다 — R12-X 가 막으려는 바로 그 사고다. 검증은
 * 호출자가 `asAbsolutePath` 로 먼저 끝내고, 이 helper 는 철자만 다듬는다.
 *
 * 왜 정규화가 필요한가: `<root>/../alt` 처럼 `..` 이 남은 철자가 설정에
 * 저장되면 같은 폴더가 두 가지 철자로 굳는다. `isPathWithin` 은 1 단계에서
 * 뿌리와 후보의 철자를 그대로 비교하므로 (`path-within.ts` JSDoc 참조)
 * 철자가 어긋나면 정상 경로가 봉인 밖으로 판정된다.
 *
 * @param p 이미 검증을 통과한 절대경로.
 */
export function normalizeAbsolute(p: AbsolutePath): AbsolutePath {
  // 절대경로를 resolve 한 결과는 여전히 절대경로다 — cwd 가 끼어들 여지가 없다.
  return unsafeMarkAbsolute(path.resolve(p));
}
