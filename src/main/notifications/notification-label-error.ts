/**
 * 알림 문구를 못 찾았을 때 던지는 오류 — R12-C2 ruling R-T34.
 *
 * 두 사전 (`notification-labels.ts` 의 R9 사전, `notification-labels-r12c2.ts`
 * 의 R12-C2 사전) 이 같은 오류 형태를 쓰도록 별도 파일에 둔다. 두 사전이
 * 서로를 값으로 import 하면 순환이 생기고, 그렇다고 오류 형태가 둘로
 * 갈라지면 호출부가 어느 쪽을 잡아야 하는지 알 수 없다.
 *
 * 왜 던지는가: 예전 resolver 는 문구가 없으면 키 문자열을 그대로 돌려줬다.
 * 사용자 화면에는 `auditResult.ng.title` 같은 내부 이름이 알림 제목으로
 * 뜨는데, 무언가 떠 있으니 아무도 문제로 신고하지 않는다. 문구를 빠뜨린
 * 것은 실패이므로 실패로 드러낸다.
 */

/** 문구를 못 찾은 locale — 사전 두 곳이 공유하는 값 형태. */
export type NotificationLabelLocale = 'ko' | 'en';

export class NotificationLabelMissingError extends Error {
  constructor(
    readonly labelKey: string,
    readonly locale: NotificationLabelLocale,
    readonly dictionary: string,
  ) {
    super(
      `[${dictionary}] no template for '${labelKey}' in locale '${locale}'`,
    );
    this.name = 'NotificationLabelMissingError';
  }
}
