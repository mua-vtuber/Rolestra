/**
 * OBStaffCard — single-CLI candidate card in the Onboarding staff grid.
 *
 * Layout:
 *   - top row: initial avatar + name + vendor + DetectionBadge
 *
 * R12-C round 2 (2026-05-03 사용자 피드백): 이전 시안의 price / tagline /
 * bestFor 텍스트는 모두 제거. 가격은 모델 / 요금제가 자주 바뀌어 하드
 * 코딩이 거짓말이 되고, tagline / bestFor 는 주관적 인상문이라 사용자
 * 객관성을 해친다. 카드는 감지 여부 / 이름 / 벤더 / 선택 토글만 다룬다.
 *
 * Selection toggle: clicking the card invokes `onToggleSelected(id)` so
 * the parent owns selection state. The card itself is purely visual —
 * `selected` is derived from the candidate prop, never internal state.
 *
 * Theme branching:
 *   - warm: rounded card, brand-tinted bg when selected
 *   - tactical: clip-path corners + cyan accent line on selected
 *   - retro: ASCII frame `[X] Claude Code` + mono throughout
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

import { useTheme } from '../../theme/use-theme';
import { DetectionBadge } from './DetectionBadge';
import {
  detectionStateOf,
  type StaffCandidate,
} from './onboarding-data';

export interface OBStaffCardProps {
  candidate: StaffCandidate;
  onToggleSelected: (id: string) => void;
  className?: string;
}

export function OBStaffCard({
  candidate,
  onToggleSelected,
  className,
}: OBStaffCardProps): ReactElement {
  const { themeKey, token } = useTheme();
  const isRetro = themeKey === 'retro';
  const isTactical = themeKey === 'tactical';
  const detection = detectionStateOf(candidate);

  const handleClick = (): void => {
    onToggleSelected(candidate.id);
  };

  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggleSelected(candidate.id);
    }
  };

  const clipStyle =
    isTactical && token.panelClip !== 'none'
      ? { clipPath: token.panelClip }
      : undefined;

  if (isRetro) {
    return (
      <button
        type="button"
        data-testid="onboarding-staff-card"
        data-candidate-id={candidate.id}
        data-selected={candidate.selected ? 'true' : 'false'}
        data-detection={detection}
        aria-pressed={candidate.selected}
        onClick={handleClick}
        onKeyDown={handleKey}
        className={clsx(
          'flex flex-col text-left p-3 border bg-sunk font-mono text-sm',
          candidate.selected
            ? 'border-brand text-fg'
            : detection === 'detected'
              ? 'border-success text-fg'
              : 'border-border-soft text-fg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-subtle">[{candidate.initial}]</span>
          <span className="font-semibold">{candidate.name}</span>
          <span className="ml-auto">
            <DetectionBadge state={detection} />
          </span>
        </div>
        <div className="mt-1 text-xs text-fg-muted">{candidate.vendor}</div>
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid="onboarding-staff-card"
      data-candidate-id={candidate.id}
      data-selected={candidate.selected ? 'true' : 'false'}
      data-detection={detection}
      aria-pressed={candidate.selected}
      onClick={handleClick}
      onKeyDown={handleKey}
      style={clipStyle}
      className={clsx(
        'flex flex-col text-left p-3 border bg-panel-bg shadow-panel',
        themeKey === 'warm' ? 'rounded-panel' : '',
        candidate.selected
          ? 'border-brand ring-1 ring-brand'
          : detection === 'detected'
            ? 'border-success'
            : 'border-border-soft',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={clsx(
            'inline-flex h-7 w-7 items-center justify-center font-semibold text-white text-sm',
            isTactical ? '' : 'rounded-full',
            candidate.selected ? 'bg-brand' : 'bg-fg-muted',
          )}
        >
          {candidate.initial}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-fg truncate">{candidate.name}</div>
          <div className="text-xs text-fg-muted truncate">
            {candidate.vendor}
          </div>
        </div>
        <DetectionBadge state={detection} />
      </div>
    </button>
  );
}
