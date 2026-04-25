/**
 * use-panel-clip-style — R3 형태 토큰 `panelClip` 을 inline style 로 wire.
 *
 * 사용 시점:
 *   - Card primitive 가 자동으로 token.panelClip 을 적용한다 (Card 사용 시
 *     이 hook 불필요).
 *   - Radix Dialog/Popover Content 처럼 Card primitive 로 감쌀 수 없는
 *     surface 에서, tactical 테마의 angular clip 이 필요할 때 사용.
 *
 * 사용 패턴:
 *   const clipStyle = usePanelClipStyle();
 *   <Dialog.Content style={clipStyle} data-panel-clip={...}>
 *
 * 반환:
 *   - tactical 테마: `{ clipPath: '<polygon>' }`
 *   - 그 외 테마:    `{}` (no-op — Tailwind rounded-panel 등을 그대로 보존)
 *
 * 주의:
 *   - clip-path 가 적용되면 box-shadow 가 잘릴 수 있다 (CSS 명세). 외곽 그림자
 *     가 시각상 중요하지 않은 surface 에서만 사용할 것. tactical 테마는 inset
 *     glow 로 그림자를 대체하므로 일반적으로 무방.
 */
import { useMemo, type CSSProperties } from 'react';

import { useTheme } from './use-theme';

export interface PanelClipStyleResult {
  /** Inline style spread (`{}` when no clip applies). */
  style: CSSProperties;
  /** Raw clip-path token value (`'none'` when not applicable). */
  rawClip: string;
}

export function usePanelClipStyle(): PanelClipStyleResult {
  const { token } = useTheme();
  return useMemo(() => {
    const clip = token.panelClip;
    if (!clip || clip === 'none') {
      return { style: {}, rawClip: 'none' };
    }
    return { style: { clipPath: clip }, rawClip: clip };
  }, [token.panelClip]);
}
