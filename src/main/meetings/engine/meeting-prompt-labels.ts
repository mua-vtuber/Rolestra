/**
 * Main-process dictionary for prompt-side labels injected into AI conversations
 * (D-A T2.5, spec §5.5).
 *
 * Why a separate module from `notification-labels.ts`:
 *   - `notification-labels` is OS-notification copy ("새 메시지 도착", "회로
 *     차단기 발동"). 사용자 시각 표시.
 *   - `meeting-prompt-labels` 는 *AI 가 받는 시스템 메시지 본문*. 즉 prompt
 *     payload 의 일부. 의미 영역이 다르고, 향후 (R12+) AI 어휘 / persona
 *     locale 과도 묶일 수 있어 분리한다.
 *
 * Locale 출처는 `getNotificationLocale()` 를 그대로 재사용 — main-process 의
 * 단일 locale state 가 한 곳에 모여 있어야 사용자가 Settings → 언어 토글 시
 * 모든 main-side 표면이 동기화된다 (R11 D9 의 "main-side i18n dictionary
 * 경유" 원칙).
 *
 * 본 모듈은 i18next 를 import 하지 않는다. CLAUDE.md ADR C7 + R9-Task11 D8
 * (main 번들 안에서 i18next direct import 금지) 와 일관.
 */

import { getNotificationLocale, type NotificationLocale } from '../../notifications/notification-labels';

interface MeetingPromptDictionary {
  topicSystemPrompt: {
    /** Header prefix that precedes the user-provided topic body. */
    header: string;
  };
}

const DICTIONARIES: Record<NotificationLocale, MeetingPromptDictionary> = {
  ko: {
    topicSystemPrompt: {
      header: '회의 주제',
    },
  },
  en: {
    topicSystemPrompt: {
      header: 'Meeting topic',
    },
  },
};

/**
 * Build the system-message body that injects the meeting topic into the
 * AI conversation. Spec §5.5 의 `_messages[0]` 에 들어가는 단일 출처.
 *
 * 형식 (ko 예): `회의 주제: 1+1=2 동의?`
 * 형식 (en):    `Meeting topic: 1+1=2, agreed?`
 *
 * `topic` 은 `MeetingSession` constructor 의 검증 (`length >= 3`) 을 이미
 * 통과한 값을 받는다고 가정 — 추가 trim/검증 없음.
 */
export function buildTopicSystemPrompt(topic: string): string {
  const locale = getNotificationLocale();
  const dict = DICTIONARIES[locale] ?? DICTIONARIES.ko;
  return `${dict.topicSystemPrompt.header}: ${topic}`;
}
