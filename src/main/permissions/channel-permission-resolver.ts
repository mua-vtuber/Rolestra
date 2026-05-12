/**
 * ChannelPermissionResolver — R12-W T6.
 *
 * 채널 권한 조회의 단일 진입점 (consumer-facing layer). 회의 세션 캐시
 * hydration (T8 MeetingSession), PermissionComposer 합성 (T9), CLI argv
 * 2단계 filter (T11) 가 모두 본 resolver 를 거친다.
 *
 * 책임 분리:
 *   - ChannelService.getPermissions    채널 CRUD / 라이프사이클 책임 안의 read.
 *   - ChannelRepository.getPermissions data-access primitive (null 반환).
 *   - 본 resolver                       *consumer 향한* throwing read.
 *
 * 의존을 ChannelRepository 한 군데로 좁혀 archive / DM 등 다른 service
 * dependency 없이도 resolver 만 별도 모듈에서 mount 할 수 있다 — 향후 cache
 * layer 추가나 다른 권한 source 합성 (예: 사용자 세션별 마스킹) 의 자연한
 * 확장 포인트.
 *
 * Silent fallback 금지 (CLAUDE.md 절대 위반 금지): 알려지지 않은 channelId
 * 는 throw. 기본값 없이 빈 권한 set 을 반환하면 권한 wire-up 의 사용자
 * 신뢰성이 깨지므로 명시적 에러로 surface.
 */

import type { ChannelRepository } from '../channels/channel-repository';
import type { PermissionSet } from '../../shared/permission-set-types';

/**
 * resolver 가 throw 하는 단일 error class — 호출자가 instanceof 로
 * discrimination 가능. ChannelService 의 `ChannelNotFoundError` 와 분리
 * (resolver 는 channels module 에 역방향 dependency 를 만들지 않음).
 */
export class ChannelPermissionLookupError extends Error {
  constructor(channelId: string) {
    super(
      `ChannelPermissionResolver: 채널 권한을 찾을 수 없음 — channelId='${channelId}'. ` +
        '채널이 삭제되었거나 wire-up 단계가 잘못되었습니다.',
    );
    this.name = 'ChannelPermissionLookupError';
  }
}

export class ChannelPermissionResolver {
  constructor(private readonly repo: ChannelRepository) {}

  /**
   * 채널의 PermissionSet 을 반환. silent fallback 금지 — 알려지지 않은
   * channelId 는 {@link ChannelPermissionLookupError} 로 throw.
   */
  resolve(channelId: string): PermissionSet {
    const perm = this.repo.getPermissions(channelId);
    if (!perm) throw new ChannelPermissionLookupError(channelId);
    return perm;
  }
}
