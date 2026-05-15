/**
 * MessageRenderer barrel — 채팅창 카드 surface (R12-C2 P3 T14).
 *
 * spec §11.13a — 회의 의견 발화 / 회의록 메시지를 채팅창 카드로 렌더한다.
 */
export {
  MessageCardVariant,
  isCardMessage,
  type MessageCardVariantProps,
  type OpinionCardActionHandlers,
  type MinutesCardActionHandlers,
  type WireframeCheckpointActionHandlers,
  type PlanningDesignCheckActionHandlers,
} from './CardVariant';
