/**
 * DesignPreview — R12-C2 P3 T16c. design-workflow `generating_snapshot` 결과
 * (desktop 1280x720 + mobile 375x812 PNG) 를 두 viewport 탭으로 보여주는 UI.
 *
 * 구독 전략:
 *   `stream:design-snapshot-ready` 한 번 land 시점부터 컴포넌트 lifetime 안 캐시.
 *   meetingId props 가 바뀌면 캐시 reset (다른 회의로 전환). 회의 한 번에 PNG
 *   1 회만 생성되므로 (spec §11.18.9d) 갱신 logic 는 단순.
 *
 * 빈 상태:
 *   - meetingId 없음 → 안내 ("회의 진행 중일 때만 표시").
 *   - meetingId 있고 snapshot 미수신 → "디자인 합의 회의 후 자동 생성" placeholder.
 *
 * 본 컴포넌트는 *standalone* — T18 SsmBox DesignVariant 가 children 으로 주입
 * 하기 전까지는 직접 마운트할 surface 없음. T16c 는 컴포넌트 정식 + i18n + 테스트
 * 토대만 확보 (T18 통합 시 props 그대로 사용).
 *
 * 파일 경로 처리:
 *   StreamDesignSnapshotReadyPayload.desktopPath / mobilePath 는 OS 절대 경로.
 *   `<img src>` 에 그대로 못 씀 — `file://` URL 변환 + 일부 문자 (공백, 한글
 *   포함) 인코딩 필요. encodeURI(`file://${path}`) 가 안전.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { subscribeStream } from '../../ipc/stream-subscribe';
import type { StreamDesignSnapshotReadyPayload } from '../../../shared/stream-events';

export interface DesignPreviewProps {
  /** 디자인 부서 회의의 ID — stream filter + 캐시 키. null = 비활성. */
  meetingId: string | null;
  /** 외부 wrapper 가 layout / spacing 을 결정. */
  className?: string;
}

type ViewportTab = 'desktop' | 'mobile';

/**
 * OS 절대 경로 → `<img src>` 안전 URL 변환. `path` 가 이미 `file://` 로
 * 시작하면 중복 prefix 회피. Windows 백슬래시 (`C:\\Users\\...`) 도 forward
 * slash 변환 (Chromium accepts both, 일관성 유지).
 */
function pathToFileUrl(absolutePath: string): string {
  const normalised = absolutePath.replace(/\\/g, '/');
  const withPrefix = normalised.startsWith('file://')
    ? normalised
    : normalised.startsWith('/')
      ? `file://${normalised}`
      : `file:///${normalised}`;
  return encodeURI(withPrefix);
}

export function DesignPreview({
  meetingId,
  className,
}: DesignPreviewProps): ReactElement {
  const { t } = useTranslation();

  // 캐시 keyed by meetingId — meetingId 변경 시 자동 무효화. cascading render
  // 회피 위해 effect 안 setState 분리 X (React 19 lint 룰 준수).
  const [cache, setCache] = useState<{
    meetingId: string | null;
    payload: StreamDesignSnapshotReadyPayload | null;
  }>({ meetingId: null, payload: null });
  const [viewport, setViewport] = useState<ViewportTab>('desktop');

  // 렌더 중 meetingId 불일치 감지 시 캐시 무효화 — useEffect 안 setState 패턴 회피
  // (React 19 docs 권장: external sync 가 아니라면 derived 형태로 처리).
  const snapshot =
    cache.meetingId === meetingId && cache.payload !== null
      ? cache.payload
      : null;

  // stream:design-snapshot-ready 구독 — meetingId 일치 시만 캐시 갱신. unsub 도
  // meetingId 변경 시 자동 cleanup + 재등록 (useEffect 의존성 = [meetingId]).
  useEffect(() => {
    if (!meetingId) return;
    const unsub = subscribeStream(
      'stream:design-snapshot-ready',
      (payload) => {
        if (payload.meetingId !== meetingId) return;
        setCache({ meetingId, payload });
      },
    );
    return unsub;
  }, [meetingId]);

  const activeSrc = useMemo(() => {
    if (!snapshot) return null;
    return pathToFileUrl(
      viewport === 'desktop' ? snapshot.desktopPath : snapshot.mobilePath,
    );
  }, [snapshot, viewport]);

  // ── 빈 상태 — meetingId 없음 ──────────────────────────────────────────
  if (!meetingId) {
    return (
      <div
        className={className}
        data-testid="design-preview-empty-no-meeting"
        role="status"
      >
        <p>{t('messenger.designPreview.emptyNoMeeting')}</p>
      </div>
    );
  }

  // ── 빈 상태 — snapshot 미수신 ─────────────────────────────────────────
  if (!snapshot) {
    return (
      <div
        className={className}
        data-testid="design-preview-empty-pending"
        role="status"
      >
        <p>{t('messenger.designPreview.emptyPending')}</p>
      </div>
    );
  }

  // ── 정상 상태 — 탭 + img ─────────────────────────────────────────────
  return (
    <div className={className} data-testid="design-preview-ready">
      <div role="tablist" aria-label={t('messenger.designPreview.tabsAriaLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={viewport === 'desktop'}
          data-testid="design-preview-tab-desktop"
          onClick={() => setViewport('desktop')}
        >
          {t('messenger.designPreview.tabDesktop')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewport === 'mobile'}
          data-testid="design-preview-tab-mobile"
          onClick={() => setViewport('mobile')}
        >
          {t('messenger.designPreview.tabMobile')}
        </button>
      </div>
      <div role="tabpanel">
        {activeSrc !== null ? (
          <img
            src={activeSrc}
            alt={t('messenger.designPreview.imgAlt', { viewport })}
            data-testid="design-preview-img"
            data-viewport={viewport}
          />
        ) : null}
      </div>
    </div>
  );
}
