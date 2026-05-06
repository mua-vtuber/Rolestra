/**
 * SsmBox/shared — 5 variant 공통 frame + helper (R12-C2 T18 land).
 *
 * 2-way clip 규칙은 R5-Task9 결정 그대로:
 * - tactical 만 `clip-path polygon(5px)` 양 모서리 깎기
 * - 나머지(warm / retro)는 `panelRadius` 토큰 그대로 (warm=12, retro=0)
 *
 * 5 variant (Idea/Planning/Design/Implement/General) 가 모두 같은 frame
 * 위에 부서별 본문을 그리도록 frame 자체는 한 번만 정의한다. 호출 측이
 * `data-ssm-variant` 를 지정하면 routing 테스트에서 선택자로 사용.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { useTheme } from '../../../theme/use-theme';

const TACTICAL_CLIP =
  'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)';

export interface SsmBoxFrameProps {
  /** Variant 식별자 — `data-ssm-variant` 로 노출. 테스트 선택자. */
  variant: SsmBoxVariantName;
  /** Channel.role — debug + e2e 선택자. */
  role: string | null;
  /** 회의 phase 진행 단계 (있을 때만). placeholder 유지를 위한 옵션. */
  phaseIndex?: number;
  phaseName?: string;
  /** 회의 활성 여부 — `data-has-meeting` 로 노출. */
  hasMeeting: boolean;
  className?: string;
  children?: ReactNode;
}

export type SsmBoxVariantName =
  | 'idea'
  | 'planning'
  | 'design'
  | 'implement'
  | 'general'
  | 'legacy';

/**
 * 5 variant + legacy fallback 이 모두 공유하는 외곽 frame.
 *
 * tactical clip / panelRadius / mono 폰트 등 *형태 토큰* 분기는 본 frame
 * 한 군데에서만 처리한다.
 */
export function SsmBoxFrame({
  variant,
  role,
  phaseIndex,
  phaseName,
  hasMeeting,
  className,
  children,
}: SsmBoxFrameProps): ReactElement {
  const { themeKey, token } = useTheme();

  const containerStyle: CSSProperties = {
    borderRadius: `${token.panelRadius}px`,
  };
  if (themeKey === 'tactical') {
    containerStyle.clipPath = TACTICAL_CLIP;
  }

  return (
    <div
      data-testid="ssm-box"
      data-ssm-variant={variant}
      data-channel-role={role ?? ''}
      data-theme-variant={themeKey}
      data-panel-radius={String(token.panelRadius)}
      data-has-meeting={hasMeeting ? 'true' : 'false'}
      data-state-index={phaseIndex !== undefined ? String(phaseIndex) : undefined}
      data-state-name={phaseName ?? undefined}
      className={clsx(
        'flex flex-col gap-2 border border-border bg-sunk px-3 py-2',
        themeKey === 'retro' ? 'font-mono' : 'font-sans',
        className,
      )}
      style={containerStyle}
    >
      {children}
    </div>
  );
}
