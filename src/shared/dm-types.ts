/**
 * DM 도메인 타입 — R10-Task1.
 *
 * spec §7.4 에 따라 DM 은 `channels.kind='dm'` + `channels.project_id IS NULL`
 * + `idx_dm_unique_per_provider` partial unique index(R2 migration 003) 위에
 * 얹는다. 별도 `dm_sessions` 테이블 미도입(Decision D1). AI 끼리 DM 은
 * 금지(spec §7.4) 이므로 `providerId` 1명만 `channel_members` 로 연결된다.
 *
 * 이 파일은 `Channel` 도메인 타입을 재사용하면서 DM 에서만 유의미한
 * 래퍼(providerId 를 일급으로 노출, 이미 존재 여부 플래그) 만 추가한다.
 */
import type { Channel } from './channel-types';

/**
 * `dm:create` IPC input — 1명의 provider 와 1:1 DM 채널을 연다.
 *
 * `idx_dm_unique_per_provider` 가 같은 provider 의 DM 을 두 번째로 생성하려
 * 하면 UNIQUE 위반으로 throw 하므로, 호출자는 먼저 {@link DmSummary.exists}
 * 를 확인해 이미 있는 경우 기존 channel 로 라우팅한다.
 */
export interface DmCreateRequest {
  /** `providers.id` — 이미 존재하는 provider 여야 한다. */
  providerId: string;
}

/**
 * `dm:list` 응답의 단일 row.
 *
 * `channel` 이 실제 채널 객체(존재할 때만)이고, `exists=false` 인 경우는
 * "이 provider 와 아직 DM 없음" 을 의미한다. 모든 활성 provider 목록을
 * UI 가 한 번에 얻도록 R10 settings/DM 진입 화면에서 `exists=false` row
 * 도 포함해 내려준다(사용자가 새 DM 생성 버튼을 눌렀을 때 비활성화 근거).
 */
export interface DmSummary {
  providerId: string;
  /** providers.display_name — 사이드바/모달 라벨. */
  providerName: string;
  /** DM 채널이 이미 있으면 해당 채널, 없으면 null. */
  channel: Channel | null;
  /** `channel !== null` 의 short-hand — UI 가 disabled 판정에 사용. */
  exists: boolean;
}

/** `dm:list` response. */
export interface DmListResponse {
  items: DmSummary[];
}
