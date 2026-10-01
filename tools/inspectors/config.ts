/**
 * 검사관 설정 — R12-C2 T41.
 *
 * `failClosed` 는 "안전 카테고리 위반이 나오면 작업을 막을 것인가" 하나만
 * 결정한다.
 *
 *   false (현재)  검사관은 결과를 알리기만 한다. `.githooks/pre-push` 는
 *                 phase 2 로 돌려 위반 목록을 보여 주되 push 를 막지 않고,
 *                 CI 도 `continue-on-error` 로 신호만 남긴다.
 *   true          같은 위반이 push 와 CI 를 실제로 막는다.
 *
 * 지금 값은 `false` 다. T41 계획이 fail-closed 전환을 **사용자 승인 게이트**
 * 로 정해 두었기 때문이다 — 계획서 P7 T41 의 "false positive 0 건 검증
 * 게이트" 두 조건 중 첫째 (안전 7 카테고리 hit 0) 는 이번 triage 로
 * 충족됐지만, 둘째 (사용자 명시 승인) 는 사람이 내리는 결정이다. 코드가
 * 대신 켤 수 없다.
 *
 * 켜는 방법: 이 파일의 `failClosed` 를 `true` 로 바꾸는 것 하나. 훅과 CI 는
 * 이미 이 값을 읽고 있어 다른 파일은 손대지 않아도 된다.
 */

export interface InspectorConfig {
  /**
   * true 면 안전 카테고리 hit > 0 일 때 pre-push 와 CI 가 실패한다.
   * false 면 목록만 보여 주고 통과시킨다.
   */
  failClosed: boolean;
}

export const INSPECTOR_CONFIG: InspectorConfig = {
  // 사용자 승인 게이트 — 사람이 결정한다 (위 주석 참조).
  failClosed: false,
};

/**
 * 환경변수로 한 번만 덮어쓰는 통로 — 값 자체는 위 상수가 진실이다.
 *
 * `ROLESTRA_INSPECTOR_FAIL_CLOSED=1` 을 붙이면 그 실행에 한해 fail-closed
 * 로 돈다. 전환 전에 "켜면 무엇이 막히는가" 를 파일을 고치지 않고 미리
 * 볼 때 쓴다. 값이 `1` / `true` 일 때만 켜지고, 그 외 (미지정 / 오타 /
 * 빈 문자열) 는 조용히 무시하지 않고 위 상수 값을 그대로 쓴다.
 */
export function resolveFailClosed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.ROLESTRA_INSPECTOR_FAIL_CLOSED;
  if (override === '1' || override === 'true') return true;
  return INSPECTOR_CONFIG.failClosed;
}
