/**
 * 테스트에서 `AbsolutePath` 값을 만드는 helper — R12-X T2.
 *
 * 왜 cast (`as AbsolutePath`) 를 쓰지 않는가:
 *   brand 는 "빈 문자열 / 상대 경로가 spawn cwd 까지 흘러간다" 는 사고를
 *   잡으려고 만들었다. 테스트가 cast 로 통과시키면 정작 그 사고를 재현하는
 *   자리에서 검증이 꺼진다 — 테스트만 초록색이 되고 제품은 그대로 깨진다.
 *   그래서 이 helper 는 실제 `asAbsolutePath` 검증을 그대로 거친다.
 *
 * 임시 폴더가 필요하면 `createTmpDir` (`./integration-helpers`) 을 쓴다 —
 * 그쪽도 이 helper 를 거쳐 브랜드된 경로를 돌려준다.
 */

import { asAbsolutePath, type AbsolutePath } from '../shared/absolute-path';

/** 검증을 거쳐 브랜드한다. 상대 경로를 넘기면 테스트가 즉시 실패한다. */
export function absolutePathForTest(p: string): AbsolutePath {
  return asAbsolutePath(p, 'test.absolutePath');
}
