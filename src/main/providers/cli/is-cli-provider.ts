/**
 * CLI provider 판정 — R12-X T4.
 *
 * `cli-workspace.ts` 가 아니라 별도 파일에 둔 이유: `cli-provider.ts` 가
 * workspace 조립 함수와 오류 타입을 import 하는데, 판정 함수까지 같은 파일에
 * 있으면 `CliProvider` 클래스를 값으로 되가져와야 해서 두 모듈이 값 수준의
 * 순환 참조가 된다. 판정만 떼어 두면 방향이 한쪽으로만 흐른다.
 */

import type { BaseProvider } from '../provider-interface';
import { CliProvider } from './cli-provider';

/**
 * CLI 로 실제 프로세스를 띄우는 provider 인지 판정.
 *
 * `instanceof` 만으로는 test double 과 (드물게) 중복 모듈 인스턴스를 놓치므로,
 * `type === 'cli'` + CLI 전용 method 존재로도 인정한다. workspace 를 넘길지
 * 말지를 여기서 갈라내므로, API provider 에 CLI workspace 를 붙이는 실수를
 * 막는 지점이기도 하다.
 */
export function isCliProvider(provider: BaseProvider): provider is CliProvider {
  return (
    provider instanceof CliProvider ||
    (provider.type === 'cli' &&
      typeof (provider as CliProvider).setPermissionRequestCallback ===
        'function')
  );
}
