import type { Channel } from '../../channel-types';
import type { DmCreateRequest, DmListResponse } from '../../dm-types';

export type DmIpcChannelMap = {
  /**
   * R10-Task3: 사용자↔AI 1:1 DM 채널 목록. 아직 DM 이 없는 provider 도
   * `channel=null, exists=false` 로 포함해 renderer 에서 "새 DM 생성" 모달이
   * 비활성 여부를 한 번의 응답으로 결정할 수 있게 한다.
   */
  'dm:list': {
    request: undefined;
    response: DmListResponse;
  };
  /**
   * R10-Task3: 지정 provider 와 1:1 DM 채널 생성. `idx_dm_unique_per_provider`
   * 가 중복 방지를 보장하므로 이미 있는 provider 를 넘기면 UNIQUE 위반
   * throw — 호출자는 먼저 `dm:list` 로 존재 여부를 확인한다.
   */
  'dm:create': {
    request: DmCreateRequest;
    response: { channel: Channel };
  };
};
