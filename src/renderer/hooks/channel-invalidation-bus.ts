/**
 * Channel invalidation bus — Task 10 CRUD 동기화.
 *
 * R5 는 `useChannels(projectId)` 와 `useDms()` 를 소비 측에서 **각 컴포넌트가
 * 독립 인스턴스**로 생성한다(D10). ChannelRail / Thread / MessengerPage 가
 * 같은 프로젝트 채널 리스트를 바라봐도 서로의 state 를 공유하지 않는다는
 * 뜻이다. R10 shared cache 도입 전까지는 CRUD 이벤트가 발생했을 때 살아있는
 * 인스턴스들이 일제히 refetch 할 수 있는 단일 경로가 필요하다.
 *
 * 이 모듈이 그 단일 경로다:
 * - `subscribeChannelsInvalidation(fn)` — 인스턴스 mount 시 등록, unmount 시
 *   unsubscribe. subscriber 는 Promise 반환형 refetch 함수.
 * - `notifyChannelsChanged()` — CRUD 성공 후 호스트가 호출. 모든 subscriber
 *   를 병렬로 태워서 완료를 기다린다(UI 가 "작업 직후 안정 리스트" 를
 *   볼 수 있게).
 *
 * 테스트: vitest 에서는 subscriber Set 이 모듈 단위 state 이므로 test 간
 * cleanup 을 위해 `__resetChannelInvalidationBusForTests()` 를 노출한다.
 * 프로덕션 코드에서는 호출하지 말 것.
 */

export type ChannelInvalidationCallback = () => void | Promise<void>;

const subscribers = new Set<ChannelInvalidationCallback>();

/**
 * Register a refetch callback. Returns an unsubscribe function; hooks
 * should call it in their effect cleanup.
 */
export function subscribeChannelsInvalidation(
  fn: ChannelInvalidationCallback,
): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * Fire all subscribed refetchers. Errors from individual subscribers are
 * swallowed into the returned Promise chain so a single failing hook
 * instance cannot block the others' refresh.
 */
export async function notifyChannelsChanged(): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const fn of subscribers) {
    try {
      const maybe = fn();
      if (maybe && typeof (maybe as Promise<void>).then === 'function') {
        pending.push(
          (maybe as Promise<void>).catch(() => {
            /* swallow — individual failures don't block siblings */
          }),
        );
      }
    } catch {
      /* sync throw in a subscriber: still isolate */
    }
  }
  await Promise.all(pending);
}

/** Test-only — reset subscribers between vitest cases. */
export function __resetChannelInvalidationBusForTests(): void {
  subscribers.clear();
}
