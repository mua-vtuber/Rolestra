/**
 * RunStepAggregator — H1 대시보드 진행률 패널 (R12-C2 P3 T19) 의 데이터 source.
 *
 * RunStep 영속 기록부 (§11.19) + 활성 회의 (`meetings.ended_at IS NULL`) +
 * 채널 메타 (`channels.role` / `channels.max_rounds`) 3 신호를 *query-time*
 * 합성하여 `DashboardProgressSnapshot` 산출. 별 집계 테이블 X — 모든 row
 * 가 직접 조회 (spec §11.21.3).
 *
 * 책임:
 *   - 프로젝트 안 role 매핑된 (= NULL 아닌) 채널만 surface (system / DM /
 *     legacy user 제외)
 *   - 부서 status 4 종 (idle / in-meeting / handoff-pending / done) 결정
 *   - 활성 회의 라운드 + max_rounds 추출
 *   - step_kind 10 종 카운트 분포 산출 (0 디폴트 명시 — sparse 회피)
 *   - 정렬: `ALL_ROLE_IDS` 카탈로그 순서 → 같은 role 안 channels.created_at ASC
 *
 * SoC 경계:
 *   - aggregator 는 *조합기* — DB query 본체는 Repository / Service 가
 *     소유. RunStepAggregator 는 query 결과를 합치는 layer.
 *   - 비즈니스 검증 / 영속 X (read-only).
 *
 * 스트림 wiring:
 *   본 service 는 `dashboard:progress-snapshot` IPC 응답 산출만 책임.
 *   stream emit (`stream:dashboard-progress-changed`) 은 RunStepService 의
 *   `appended` 이벤트 → StreamBridge 가 처리 (T19-D + T19-F).
 *
 * spec docs/specs/2026-05-01-rolestra-channel-roles-design.md
 *  §11.19  A. RunStep 영속 기록부
 *  §11.21  H1. 대시보드 진행률 패널
 */

import { ALL_ROLE_IDS, type RoleId } from '../../../shared/role-types';
import {
  emptyStepKindCounts,
  type DashboardProgressSnapshot,
  type DepartmentProgress,
  type DepartmentStatus,
} from '../../../shared/dashboard-progress-types';
import type { ChannelRepository } from '../../channels/channel-repository';
import type { Channel } from '../../../shared/channel-types';
import { isGeneralChannel } from '../../channels/general-channel-opinion-flow';
import type { OpinionRepository } from '../opinion-repository';
import type { MeetingRepository } from '../meeting-repository';
import type { RunStepRepository } from './run-step-repository';

// ── Active meeting phase 매핑 ──────────────────────────────────────────

/**
 * `status='handoff-pending'` 으로 surface 할 활성 회의 phase. 다른 phase 는
 * 모두 `'in-meeting'` 으로 매핑 (`gather` / `tally` / `quick_vote` /
 * `free_discussion` / `awaiting_user_pick` / `assigning_designated_task` /
 * `compose_minutes` / `generating_snapshot`).
 *
 * `meetings.state` 는 free-text (CHECK 제약 없음) — 알 수 없는 값이 들어와도
 * 디폴트 `'in-meeting'` 으로 처리. 본 상수는 코드 SSoT — 새 phase 추가 시
 * `MEETING_PHASE_ORDER` 와 함께 갱신.
 */
const HANDOFF_PENDING_PHASE = 'handoff' as const;

// ── 부서 정렬 인덱스 ───────────────────────────────────────────────────

/**
 * RoleId 카탈로그 순서를 정수 인덱스로 — `Map.get()` O(1) 조회. 같은 role
 * 안에서는 channels.created_at ASC 가 secondary key (channels.listByProject
 * 가 이미 created_at 정렬해서 돌려주므로 stable sort 만 보장하면 자연
 * 정렬됨).
 */
const ROLE_ORDER_INDEX: ReadonlyMap<RoleId, number> = new Map(
  ALL_ROLE_IDS.map((role, idx) => [role, idx]),
);

function roleSortKey(role: RoleId): number {
  // ROLE_ORDER_INDEX 는 ALL_ROLE_IDS 전체를 덮으므로 .get() 은 항상 number —
  // 안전망으로 `?? Number.MAX_SAFE_INTEGER` 를 두어 로그 X 새 role 이 누락된
  // 경우에도 정렬이 깨지지 않게.
  return ROLE_ORDER_INDEX.get(role) ?? Number.MAX_SAFE_INTEGER;
}

// ── Aggregator ─────────────────────────────────────────────────────────

export class RunStepAggregator {
  constructor(
    private readonly channelRepo: ChannelRepository,
    private readonly meetingRepo: MeetingRepository,
    private readonly runStepRepo: RunStepRepository,
    private readonly opinionRepo: OpinionRepository,
  ) {}

  /**
   * 프로젝트 1 개의 부서별 진행률 snapshot — `dashboard:progress-snapshot`
   * IPC 응답.
   *
   * 알 수 없는 projectId 도 *throw 안 함* — 빈 `departments: []` 와 현재
   * timestamp 만 돌려준다. 사용자가 갓 import 한 빈 프로젝트에서도 H1
   * 패널이 즉시 mount 되어야 하기 때문 (silent fallback 아님 — 도메인
   * 적으로 "역할 매핑된 채널이 0 개" 가 의미 있는 정상 상태).
   *
   * R12-C2 P4 T22 — 일반 채널 (system_general 전역 + user role='general')
   * 분기:
   *  - 회의 X 라 RunStep 0 건 → opinion 카드 수를 `cardCount` 로 별도 surface
   *  - status='chatting' 고정 (회의 4 종 status 와 분리)
   *  - `stream:dashboard-progress-changed` 신호 통로는 RunStep 'appended' 외
   *    별도 신호 미연결 — 잡담은 가벼운 surface 라 mount 1 회 + zustand TTL 로
   *    충분 (사용자 결정, 옵션 C)
   */
  getProgressSnapshot(projectId: string): DashboardProgressSnapshot {
    const generatedAt = Date.now();
    const channels = this.channelRepo.listByProject(projectId);

    const departments: DepartmentProgress[] = [];
    for (const channel of channels) {
      // role 미매핑 채널 (system_approval / system_minutes / legacy user) 은
      // H1 surface 에서 제외. DM 은 listByProject 가 애초 돌려주지 않음
      // (project_id IS NULL).
      if (channel.role === null) continue;

      // 일반 채널 (전역 #일반 또는 user role='general') = 회의 X. RunStep 안
      // 적고 의견 카드 카운트만 surface. `channel.role` non-null 분기 직후
      // 라 narrow 단언 가능.
      if (isGeneralChannel(channel)) {
        departments.push(
          buildGeneralProgress(
            channel as Channel & { role: RoleId },
            this.opinionRepo,
          ),
        );
        continue;
      }

      const activeMeeting = this.meetingRepo.getActiveByChannel(channel.id);
      const allSteps = this.runStepRepo.listByChannel(channel.id);

      const status = resolveStatus(activeMeeting, allSteps.length);
      const stepKindCounts = emptyStepKindCounts();
      let totalSteps = 0;
      for (const step of allSteps) {
        stepKindCounts[step.stepKind] += 1;
        totalSteps += 1;
      }

      const currentRound = activeMeeting
        ? maxRoundForMeeting(allSteps, activeMeeting.id)
        : null;

      departments.push({
        channelId: channel.id,
        channelName: channel.name,
        role: channel.role,
        status,
        activeMeetingId: activeMeeting?.id ?? null,
        currentRound,
        maxRounds: channel.maxRounds,
        stepKindCounts,
        totalSteps,
        cardCount: null,
      });
    }

    // ALL_ROLE_IDS 카탈로그 순서 → channels.listByProject 가 이미 created_at
    // ASC 로 돌려주므로 stable sort 만 유지하면 같은 role 안 두 채널은 자연
    // 정렬됨. JS Array.sort 는 ES2019 부터 stable 보장.
    departments.sort((a, b) => roleSortKey(a.role) - roleSortKey(b.role));

    return { projectId, departments, generatedAt };
  }
}

// ── helpers ────────────────────────────────────────────────────────────

/**
 * 부서 status 4 종 매핑. `meetings.state` 가 free-text 라 알 수 없는 phase
 * 는 디폴트 `'in-meeting'` 으로 매핑 (handoff-pending 만 명시 분기).
 */
function resolveStatus(
  activeMeeting: { state: string } | null,
  totalSteps: number,
): DepartmentStatus {
  if (activeMeeting === null) {
    return totalSteps === 0 ? 'idle' : 'done';
  }
  if (activeMeeting.state === HANDOFF_PENDING_PHASE) {
    return 'handoff-pending';
  }
  return 'in-meeting';
}

/**
 * 활성 회의 ID 의 RunStep row 들 중 MAX(round). row 0 → null (회의는
 * 시작됐으나 아직 첫 turn 도 안 든 phase 진입 직후 단계).
 *
 * `allSteps` 는 채널의 모든 RunStep — 활성 회의 이전 *과거 회의* row 도
 * 포함. activeMeetingId 로 한 번 더 필터해서 *현재* 라운드만 추출.
 */
function maxRoundForMeeting(
  allSteps: ReadonlyArray<{ meetingId: string; round: number }>,
  activeMeetingId: string,
): number | null {
  let max = -1;
  for (const step of allSteps) {
    if (step.meetingId !== activeMeetingId) continue;
    if (step.round > max) max = step.round;
  }
  return max < 0 ? null : max;
}

/**
 * 일반 채널 (user role='general' / 프로젝트 안 잡담) 의 진행률 row. 회의 X
 * 라 RunStep 안 적고 — opinion 카드 수만 surface (spec §11.21.2 위젯 라벨
 * "잡담 (카드 N)" 의 N).
 *
 * 전역 #일반 (system_general, projectId NULL) 은 channelRepo.listByProject 가
 * 애초 돌려주지 않으므로 본 helper 도달 X — 사이드바 entry 가 별 surface.
 *
 * 회의 부서와 같은 schema 를 채우지만 의미는 다름:
 *  - status='chatting' 고정
 *  - activeMeetingId / currentRound = null (회의 개념 없음)
 *  - totalSteps = 0 / stepKindCounts = 모두 0 (RunStep 안 적음)
 *  - cardCount = opinion row 수 (light 표는 별 surface — opinion 카드 자체에 카운터)
 *
 * 호출 측에서 `channel.role === null` 분기 직후 진입하므로 본 helper 안에서는
 * channel.role 이 항상 non-null ('general' enum 값).
 */
function buildGeneralProgress(
  channel: Channel & { role: RoleId },
  opinionRepo: OpinionRepository,
): DepartmentProgress {
  const cardCount = opinionRepo.listByChannel(channel.id).length;
  return {
    channelId: channel.id,
    channelName: channel.name,
    role: channel.role,
    status: 'chatting',
    activeMeetingId: null,
    currentRound: null,
    maxRounds: channel.maxRounds,
    stepKindCounts: emptyStepKindCounts(),
    totalSteps: 0,
    cardCount,
  };
}
