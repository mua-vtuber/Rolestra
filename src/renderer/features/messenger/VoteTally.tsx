/**
 * VoteTally — 회의 투표 현황 mono 표시 (R5-Task9, token-only).
 *
 * 형태: "✓ 2  ✗ 0  · 1" (찬성 / 반대 / 미정). 실제 데이터 연결은 R6
 * (SSM VOTING 상태). R5 에서는 MemberPanel 합의 상태 섹션에서
 * placeholder 로 사용한다.
 *
 * hex literal 금지.
 */
import { clsx } from 'clsx';
import type { ReactElement } from 'react';

export interface VoteTallyProps {
  yes: number;
  no: number;
  pending: number;
  className?: string;
}

export function VoteTally({
  yes,
  no,
  pending,
  className,
}: VoteTallyProps): ReactElement {
  return (
    <div
      data-testid="vote-tally"
      data-yes={yes}
      data-no={no}
      data-pending={pending}
      className={clsx(
        'inline-flex items-center gap-3 font-mono text-xs text-fg-muted',
        className,
      )}
    >
      <span data-testid="vote-tally-yes" className="text-success">
        {`✓ ${yes}`}
      </span>
      <span data-testid="vote-tally-no" className="text-danger">
        {`✗ ${no}`}
      </span>
      <span data-testid="vote-tally-pending" className="text-fg-subtle">
        {`· ${pending}`}
      </span>
    </div>
  );
}
