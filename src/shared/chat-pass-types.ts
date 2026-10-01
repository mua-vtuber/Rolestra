/**
 * 넘기기 버튼 (spec 2026-10-01 F1) 의 거절 사유 코드. main 은 문장이 아니라 이
 * 코드를 오류 메시지에 담아 던지고, 화면은 `messenger.pass.errors.<code>` 번역으로
 * 보인다.
 *
 * - `dm_channel`: DM 은 항상 답하므로 넘기기가 없다.
 * - `room_archived`: 보관됐거나 읽기 전용이거나 보관 처리 중인 대화.
 * - `round_running`: 그 대화에 도는 바퀴나 기다리는 바퀴가 있다.
 * - `no_participants`: 참가 AI 가 없어 넘겨도 아무도 말할 수 없다.
 */
const CHAT_PASS_REJECTION_CODES = ['dm_channel', 'room_archived', 'round_running', 'no_participants'] as const;
export type ChatPassRejectionCode = (typeof CHAT_PASS_REJECTION_CODES)[number];

/** 거절 오류 메시지의 머리말. IPC 를 건너며 앞에 다른 글이 붙어도 찾을 수 있다. */
const CHAT_PASS_REJECTED_PREFIX = 'chat_pass_rejected:';

export function chatPassRejectedMessage(code: ChatPassRejectionCode): string {
  return `${CHAT_PASS_REJECTED_PREFIX}${code}`;
}

/** IPC 오류에서 거절 코드를 읽는다. 거절 오류가 아니면 null. */
export function chatPassRejectionOf(error: unknown): ChatPassRejectionCode | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const start = message.indexOf(CHAT_PASS_REJECTED_PREFIX);
  if (start < 0) return null;
  const rest = message.slice(start + CHAT_PASS_REJECTED_PREFIX.length);
  return CHAT_PASS_REJECTION_CODES.find((code) => rest.startsWith(code)) ?? null;
}
