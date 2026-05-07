/**
 * HandoffPackage schema — R12-C2 P6 T27 부서 → 부서 *외주 의뢰서* 정식 schema.
 *
 * 사무실 메타포: 보낸 부서 회의가 끝나면 *외주 의뢰서* 한 장을 만들어 받는
 * 부서로 보낸다. 의뢰서 안에 무엇을 적느냐 = 본 schema.
 *
 * 본 schema 의 보존 정책 (옵션 B — 회의록 본문은 *파일 한 곳* 에만):
 *
 *   - 회의록 본문 (`minutes.md`) 은 `<ArenaRoot>/<projectId>/consensus/<meetingId>/minutes.md`
 *     파일 한 곳에만 보존. 본 의뢰서 schema 안에는 *식별자* (`minutesMeetingId`)
 *     만 둬서 SSoT 위반 회피.
 *   - 받는 부서가 의뢰서 화면에 진입하는 순간 caller (UI 프로세스) 가
 *     식별자 → path resolve → 파일 read → markdown 본문 surface 의 1-direction
 *     workflow.
 *   - 회의록이 없는 인계 (사용자 변경 요청 등 회의 외 진입) 는
 *     `minutesMeetingId = null` 로 남기고 받는 부서는 mission card body 만으로
 *     작업 시작.
 *
 * 본 schema 와 `handoff_dispatch` row 의 매핑 (T22 migration):
 *   - sender.meetingId          → from_meeting_id
 *   - sender.channelId          → from_channel_id
 *   - target.channelId          → to_channel_id
 *   - reason                    → reason
 *   - minutesMeetingId          → minutes_id (NULL 허용)
 *   - missionCard (직렬화)       → mission_card_json
 *   - mode                      → mode
 *   - dispatchedAt              → dispatched_at
 *   - (별도 컬럼: id, opened_at, created_at — 영속 boundary 가 채움)
 *
 * 본 모듈은 *순수 함수 + zod 타입* 만 land — IO / DB / IPC 의존 X. T28
 * HandoffApprovalModal 이 본 schema 받아 사용자 결재 모달 surface, T29
 * HandoffPackageCard 가 받는 부서 첫 화면 surface. 본 모듈 자체는 schema +
 * builder + parser 까지만.
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.18.8c  handoff_mode 우회 룰 (B1 「인계」 카드 → 채널 정책 적용)
 *  §11.22     H2. 받는 부서 첫 화면 인계 패키지
 *  §11.22.3   handoff_dispatch 데이터 source
 *  §11.22.4   컨텍스트 주입 — 회의록 본문 통째 첨부 (caller 가 path resolve)
 */

import { z } from 'zod';
import {
  ALL_HANDOFF_MODES,
  type ChannelRole,
} from '../channel-role-types';
import { ALL_ROLE_IDS, type RoleId } from '../role-types';
import { missionCardSchema } from './mission-card';

// ── sender / target ─────────────────────────────────────────────────

/**
 * 보낸 부서 식별. handoff_dispatch row 의 from_meeting_id + from_channel_id 자리.
 *
 *   - `meetingId`   회의 식별자 (UUID). caller (orchestrator) 가 회의 종결 시점에
 *                   알고 있는 값.
 *   - `channelId`   보낸 부서 채널 (UUID).
 *   - `channelRole` 보낸 부서 역할 — 받는 부서 UI 가 "기획 부서로부터 도착"
 *                   같은 surface 문구 합성 시 사용. NULL 가능 (system 채널 / DM /
 *                   legacy user — 이론적으로 인계 발신 X 지만 schema 자체는
 *                   허용해 둬서 ChannelRole 의 type 폭과 일관).
 */
const senderSchema = z
  .object({
    meetingId: z.string().min(1, 'sender.meetingId must not be empty'),
    channelId: z.string().min(1, 'sender.channelId must not be empty'),
    channelRole: z
      .enum(ALL_ROLE_IDS as readonly [RoleId, ...RoleId[]])
      .nullable(),
  })
  .strict();

/**
 * 받는 부서 식별. handoff_dispatch row 의 to_channel_id 자리.
 *
 *   - `channelId`   받는 부서 채널 (UUID).
 *   - `channelRole` 받는 부서 역할 — `'planning'` (audit NG 인계) /
 *                   `'design.ui'`/`'design.ux'` (idea 인계) /
 *                   `'implement'` (planning 인계) / `'review'` (audit chain 외) /
 *                   `'audit'` (implement 자동 chain). chain 진단 + UI 라벨 합성.
 */
const targetSchema = z
  .object({
    channelId: z.string().min(1, 'target.channelId must not be empty'),
    channelRole: z
      .enum(ALL_ROLE_IDS as readonly [RoleId, ...RoleId[]])
      .nullable(),
  })
  .strict();

// ── HandoffPackage 본체 schema ──────────────────────────────────────

/**
 * HandoffPackage zod schema — 외주 의뢰서 *전 영역*. 본 schema 가 통과하면
 * row 영속 / IPC 송수신 / UI surface 모두 안전한 형태.
 *
 *   - `sender`           보낸 부서 + 회의 식별
 *   - `target`           받는 부서 식별
 *   - `reason`           인계 사유 (자유 텍스트, 회의록 외 metadata).
 *                        받는 부서 첫 surface 의 "인계 사유" 라벨에 노출.
 *   - `minutesMeetingId` 회의록 식별자. NULL 가능 (회의 외 진입). 본문은 파일
 *                        한 곳에만 — 본 schema 는 식별자만 보존.
 *   - `nextActions`      받는 부서가 처리할 작업 list. 보낸 부서 회의록의
 *                        "## 다음 단계" 단락에서 추출 (caller 책임 — T29 land
 *                        시점에 자동 추출 wire). 빈 배열 허용 (받는 부서가
 *                        mission card body 만으로 작업 시작).
 *   - `missionCard`      T23 MissionCard schema 의 검증된 카드. 받는 부서
 *                        designated worker 의 prompt 컨텍스트.
 *   - `mode`             handoff_mode 분기 ('check' = 사용자 결재 모달,
 *                        'auto' = 자동 인계 + Notification).
 *   - `dispatchedAt`     보낸 시각 Unix epoch ms. dispatched_at 컬럼 자리.
 */
export const handoffPackageSchema = z
  .object({
    sender: senderSchema,
    target: targetSchema,
    reason: z.string().min(1, 'handoff reason must not be empty'),
    minutesMeetingId: z.string().min(1).nullable(),
    nextActions: z.array(z.string().min(1)).readonly(),
    missionCard: missionCardSchema,
    mode: z.enum(ALL_HANDOFF_MODES as readonly ['check', 'auto']),
    dispatchedAt: z
      .number()
      .int()
      .min(0, 'dispatchedAt must be a non-negative epoch ms'),
  })
  .strict();

/** {@link handoffPackageSchema} 의 inferred type. */
export type HandoffPackage = z.infer<typeof handoffPackageSchema>;

/** sender 의 inferred type — 외부 wiring 시 활용. */
export type HandoffSender = z.infer<typeof senderSchema>;

/** target 의 inferred type. */
export type HandoffTarget = z.infer<typeof targetSchema>;

// ── invariant error ─────────────────────────────────────────────────

/**
 * HandoffPackage schema 위반 / build / parse 실패 시 throw. caller (T28
 * HandoffApprovalModal / T29 HandoffPackageCard / HandoffDispatchService)
 * 가 catch 후 인계 abort + 사용자 노출 에러 분기.
 *
 * `cause` 는 zod {@link z.ZodError} 보존 — UI 디버그 / 원격 진단 시 회복
 * 가능한 형태로 노출.
 */
export class HandoffPackageInvariantError extends Error {
  readonly cause?: z.ZodError;

  constructor(message: string, cause?: z.ZodError) {
    super(`[HandoffPackage] ${message}`);
    this.name = 'HandoffPackageInvariantError';
    this.cause = cause;
  }
}

// ── builder + parser + serializer ──────────────────────────────────

/**
 * HandoffPackage builder + zod 검증. 입력이 schema 와 일치하면 검증된 의뢰서
 * 반환, 아니면 {@link HandoffPackageInvariantError} throw.
 *
 * 추가 invariant (zod 외):
 *   - `sender.meetingId` 와 `missionCard.targetChannelId` 가 `target.channelId` 와
 *     일치 — 의뢰서가 가리키는 받는 채널과 mission card 가 가리키는 채널이
 *     같아야 함. 다르면 *어디로 가는 의뢰서* 인지 모호 → 영속 거부.
 *   - `sender.channelId === target.channelId` 거부 — 자기 자신에게 인계는
 *     의미 없음 (cycle 방지의 가장 단순한 첫 단계). 더 깊은 cycle 검출 (A→B→A) 은
 *     R12-H 단계의 caller 책임 (handoffs.parent_handoff_id depth 추적, spec §6).
 *
 * caller 책임:
 *   - mission card 는 본 함수 호출 *전에* `buildMissionCard` 통과한 검증된
 *     카드여야 함 — 본 함수는 missionCardSchema 한 번 더 검증하지만, build 시
 *     UUID 생성 / createdAt epoch 같은 caller side-effect 는 caller 책임.
 *   - `dispatchedAt` 은 caller 가 결정 (보통 `Date.now()`).
 *   - `nextActions` 는 caller 가 회의록 "## 다음 단계" 단락에서 추출 또는
 *     사용자가 변경 요청 시 직접 입력. 본 함수는 빈 배열 허용 (필수 X).
 */
export function buildHandoffPackage(input: HandoffPackage): HandoffPackage {
  const result = handoffPackageSchema.safeParse(input);
  if (!result.success) {
    throw new HandoffPackageInvariantError(
      'invalid handoff package input — see cause for details',
      result.error,
    );
  }
  const pkg = result.data;

  if (pkg.sender.channelId === pkg.target.channelId) {
    throw new HandoffPackageInvariantError(
      `sender.channelId === target.channelId (${pkg.sender.channelId}) — ` +
        'self-handoff is meaningless and forbidden',
    );
  }
  if (pkg.missionCard.targetChannelId !== pkg.target.channelId) {
    throw new HandoffPackageInvariantError(
      `missionCard.targetChannelId (${pkg.missionCard.targetChannelId}) does not match ` +
        `target.channelId (${pkg.target.channelId}) — caller must rebuild mission card ` +
        'with the correct target channel before dispatching',
    );
  }

  return pkg;
}

/**
 * IPC payload / DB-derived raw object → HandoffPackage. JSON 파싱은 caller
 * 책임 — 본 함수는 *이미 파싱된 unknown* 을 받아 schema 검증.
 *
 * 본 함수는 *경계 (boundary) parser* — IPC / 외부 source 에서 들어오는
 * unknown 1 회 검증 후 내부에서는 검증된 {@link HandoffPackage} 만 통용.
 */
export function parseHandoffPackage(raw: unknown): HandoffPackage {
  const result = handoffPackageSchema.safeParse(raw);
  if (!result.success) {
    throw new HandoffPackageInvariantError(
      'parsed input did not match HandoffPackage schema — see cause for details',
      result.error,
    );
  }
  // 추가 invariant (self-handoff / mission card target mismatch) 도 buildHandoffPackage
  // 와 동일하게 검증 — caller 가 build 후 직렬화 → 파싱 시에도 같은 룰 강제.
  return buildHandoffPackage(result.data);
}

/**
 * HandoffPackage → JSON 문자열. handoff_dispatch row 의 mission_card_json 컬럼
 * 영속 시는 *missionCard 만* 별도 직렬화하므로 본 helper 는 IPC / 파일 dump 등
 * 의뢰서 *통째* 직렬화 시점에 사용.
 *
 * 본 함수는 검증 X — 입력이 이미 {@link buildHandoffPackage} 또는
 * {@link parseHandoffPackage} 통과한 검증된 의뢰서라고 가정.
 */
export function serializeHandoffPackage(pkg: HandoffPackage): string {
  return JSON.stringify(pkg);
}

// ── role guard ──────────────────────────────────────────────────────

/**
 * `target.channelRole` 이 chain 진단 시 *받는 부서가 대응하는 부서인지* 확인.
 * NULL (system 채널 / DM) 은 인계 받을 수 없음 — 본 helper 는 이런 채널이
 * target 으로 들어오는 경우를 caller 가 1 회 사전 차단할 때 사용.
 *
 * 본 schema 는 NULL 도 허용 (ChannelRole type 폭과 일관) 하지만, 실제 dispatch
 * 흐름에서 NULL target 은 불가능 — caller 가 본 helper 로 1 차 검증 권장.
 */
export function isReceivableHandoffTarget(target: HandoffTarget): boolean {
  return target.channelRole !== null;
}

/**
 * sender / target 양쪽이 같은 ChannelRole 인지 확인. 옛 SSM 의 self-loop 와
 * 동격 — UI 가 "기획 → 기획" 인계를 막을 때 사용. 다른 RoleId 끼리는 cycle 가능
 * (A → B → A) — 그건 R12-H 의 handoffs.parent_handoff_id depth 추적이 잡는다.
 */
export function isSameRoleHandoff(
  sender: HandoffSender,
  target: HandoffTarget,
): boolean {
  if (sender.channelRole === null || target.channelRole === null) return false;
  return sender.channelRole === target.channelRole;
}

/** {@link ChannelRole} re-export — caller 가 한 번에 import 가능. */
export type { ChannelRole };
