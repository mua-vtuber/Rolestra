/**
 * 결재 2번 (A, 2026-05-19) — meeting-handler 의 신규 5 lifecycle IPC handler
 * 단위 테스트.
 *
 * 검증 대상:
 *   - handleMeetingRequestStop   — graceful 종료 (orchestrator.stop + service.finish)
 *   - handleMeetingEditTopic     — service.updateTopic + topic echo
 *   - handleMeetingPause         — service.pause + orchestrator?.pause
 *   - handleMeetingResume        — service.resume + orchestrator?.resume
 *   - handleMeetingLlmSummarize  — minutes read + summary 호출 + reason 3 분기
 *
 * R10-Task11 의 `meeting:llm-summarize` 명세는 reason union 에 'disabled'
 * 도 포함하나 본 라운드는 settings.llmAutoCleanup 미도입 — wire 안 함
 * (향후 settings 도입 시 별 케이스).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import type { MeetingOrchestrator } from '../../../meetings/engine/meeting-orchestrator';
import type { MeetingService } from '../../../meetings/meeting-service';
import type { MeetingMinutesService } from '../../../meetings/meeting-minutes-service';
import type { MeetingSummaryService } from '../../../llm/meeting-summary-service';
import {
  registerOrchestrator,
  __resetOrchestratorRegistryForTests,
} from '../../../meetings/engine/meeting-orchestrator-registry';
import {
  handleMeetingRequestStop,
  handleMeetingEditTopic,
  handleMeetingPause,
  handleMeetingResume,
  handleMeetingLlmSummarize,
  setMeetingAbortServiceAccessor,
  setMeetingMinutesAccessorForHandler,
  setMeetingSummaryAccessorForHandler,
} from '../meeting-handler';
import { MeetingNotFoundError } from '../../../meetings/meeting-service';

interface FakeOrchestrator {
  stop: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
}

function makeFakeOrchestrator(): FakeOrchestrator {
  return {
    stop: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

function makeMeetingService(
  overrides?: Partial<{
    finish: ReturnType<typeof vi.fn>;
    updateTopic: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  }>,
): MeetingService {
  return {
    finish: overrides?.finish ?? vi.fn(),
    updateTopic:
      overrides?.updateTopic ??
      vi.fn(() => ({
        id: 'meeting-1',
        topic: 'updated',
      })),
    pause: overrides?.pause ?? vi.fn(() => 1_700_000_000_000),
    resume: overrides?.resume ?? vi.fn(() => 1_700_000_000_500),
  } as unknown as MeetingService;
}

beforeEach(() => {
  __resetOrchestratorRegistryForTests();
});

afterEach(() => {
  __resetOrchestratorRegistryForTests();
  vi.restoreAllMocks();
});

describe('handleMeetingRequestStop (결재 2번)', () => {
  it('orchestrator.stop + service.finish(aborted) 둘 다 호출 + stoppedAt 반환', () => {
    const orc = makeFakeOrchestrator();
    registerOrchestrator('meeting-1', orc as unknown as MeetingOrchestrator);
    const finish = vi.fn();
    setMeetingAbortServiceAccessor(() => makeMeetingService({ finish }));

    const before = Date.now();
    const result = handleMeetingRequestStop({ meetingId: 'meeting-1' });
    const after = Date.now();

    expect(orc.stop).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith('meeting-1', 'aborted', null);
    expect(result.stoppedAt).toBeGreaterThanOrEqual(before);
    expect(result.stoppedAt).toBeLessThanOrEqual(after);
  });

  it('orchestrator 없어도 service.finish 는 호출 (registry 결락 보호)', () => {
    const finish = vi.fn();
    setMeetingAbortServiceAccessor(() => makeMeetingService({ finish }));
    const result = handleMeetingRequestStop({ meetingId: 'meeting-1' });
    expect(finish).toHaveBeenCalled();
    expect(result.stoppedAt).toBeGreaterThan(0);
  });

  it('이미 종료된 회의 (MeetingNotFoundError) — silent 차단 + stoppedAt 정상 반환', () => {
    const finish = vi.fn(() => {
      throw new MeetingNotFoundError('meeting-1');
    });
    setMeetingAbortServiceAccessor(() => makeMeetingService({ finish }));
    expect(() =>
      handleMeetingRequestStop({ meetingId: 'meeting-1' }),
    ).not.toThrow();
  });

  it('알 수 없는 에러 — propagate (silent fallback 금지)', () => {
    const finish = vi.fn(() => {
      throw new Error('disk full');
    });
    setMeetingAbortServiceAccessor(() => makeMeetingService({ finish }));
    expect(() =>
      handleMeetingRequestStop({ meetingId: 'meeting-1' }),
    ).toThrow('disk full');
  });
});

describe('handleMeetingEditTopic (결재 2번)', () => {
  it('service.updateTopic 호출 + 갱신된 topic echo back', () => {
    const updateTopic = vi.fn(() => ({
      id: 'meeting-1',
      topic: '새 주제',
    }));
    setMeetingAbortServiceAccessor(() => makeMeetingService({ updateTopic }));
    const result = handleMeetingEditTopic({
      meetingId: 'meeting-1',
      topic: '새 주제',
    });
    expect(updateTopic).toHaveBeenCalledWith('meeting-1', '새 주제');
    expect(result.topic).toBe('새 주제');
  });

  it('종료된 회의 — MeetingNotFoundError propagate (silent 차단)', () => {
    const updateTopic = vi.fn(() => {
      throw new MeetingNotFoundError('meeting-1');
    });
    setMeetingAbortServiceAccessor(() => makeMeetingService({ updateTopic }));
    expect(() =>
      handleMeetingEditTopic({ meetingId: 'meeting-1', topic: 'x' }),
    ).toThrow(MeetingNotFoundError);
  });
});

describe('handleMeetingPause (결재 2번)', () => {
  it('service.pause + orchestrator?.pause 둘 다 호출 + pausedAt 반환', () => {
    const orc = makeFakeOrchestrator();
    registerOrchestrator('meeting-1', orc as unknown as MeetingOrchestrator);
    const pause = vi.fn(() => 1_700_000_000_123);
    setMeetingAbortServiceAccessor(() => makeMeetingService({ pause }));

    const result = handleMeetingPause({ meetingId: 'meeting-1' });
    expect(pause).toHaveBeenCalledWith('meeting-1');
    expect(orc.pause).toHaveBeenCalledOnce();
    expect(result.pausedAt).toBe(1_700_000_000_123);
  });

  it('orchestrator 없으면 DB 만 갱신 (회의 복원되지 않은 상태)', () => {
    const pause = vi.fn(() => 1_700_000_000_999);
    setMeetingAbortServiceAccessor(() => makeMeetingService({ pause }));
    const result = handleMeetingPause({ meetingId: 'meeting-1' });
    expect(pause).toHaveBeenCalled();
    expect(result.pausedAt).toBe(1_700_000_000_999);
  });
});

describe('handleMeetingResume (결재 2번)', () => {
  it('service.resume + orchestrator?.resume 둘 다 호출 + resumedAt 반환', () => {
    const orc = makeFakeOrchestrator();
    registerOrchestrator('meeting-1', orc as unknown as MeetingOrchestrator);
    const resume = vi.fn(() => 1_700_000_001_000);
    setMeetingAbortServiceAccessor(() => makeMeetingService({ resume }));

    const result = handleMeetingResume({ meetingId: 'meeting-1' });
    expect(resume).toHaveBeenCalledWith('meeting-1');
    expect(orc.resume).toHaveBeenCalledOnce();
    expect(result.resumedAt).toBe(1_700_000_001_000);
  });
});

describe('handleMeetingLlmSummarize (결재 2번 + R10-Task11)', () => {
  function setup({
    bodyResult,
    summaryResult,
  }: {
    bodyResult: { body: string } | { error: Error };
    summaryResult: { summary: string | null; providerId: string | null };
  }): {
    minutesService: MeetingMinutesService;
    summaryService: MeetingSummaryService;
    summarizeSpy: ReturnType<typeof vi.fn>;
  } {
    const readMinutesBody = 'error' in bodyResult
      ? vi.fn(async () => {
          throw bodyResult.error;
        })
      : vi.fn(async () => bodyResult.body);
    const summarizeSpy = vi.fn(async () => summaryResult);
    const minutesService = {
      readMinutesBody,
    } as unknown as MeetingMinutesService;
    const summaryService = {
      summarize: summarizeSpy,
    } as unknown as MeetingSummaryService;
    setMeetingMinutesAccessorForHandler(() => minutesService);
    setMeetingSummaryAccessorForHandler(() => summaryService);
    return { minutesService, summaryService, summarizeSpy };
  }

  it('정상 흐름 — summary 있음 → reason=ok + providerUsed echo', async () => {
    const { summarizeSpy } = setup({
      bodyResult: { body: '회의록 본문' },
      summaryResult: { summary: '한 문장 요약', providerId: 'provider-a' },
    });
    const result = await handleMeetingLlmSummarize({
      meetingId: 'meeting-1',
      providerId: 'provider-a',
    });
    expect(summarizeSpy).toHaveBeenCalledWith(
      '회의록 본문',
      expect.objectContaining({
        preferredProviderId: 'provider-a',
        meetingId: 'meeting-1',
      }),
    );
    expect(result).toEqual({
      summary: '한 문장 요약',
      providerUsed: 'provider-a',
      reason: 'ok',
    });
  });

  it('provider 없음 (fallback chain 결락) → reason=no_provider', async () => {
    setup({
      bodyResult: { body: '본문' },
      summaryResult: { summary: null, providerId: null },
    });
    const result = await handleMeetingLlmSummarize({
      meetingId: 'meeting-1',
    });
    expect(result).toEqual({
      summary: null,
      providerUsed: null,
      reason: 'no_provider',
    });
  });

  it('provider 호출 실패 (summary=null + providerId 있음) → reason=provider_error', async () => {
    setup({
      bodyResult: { body: '본문' },
      summaryResult: { summary: null, providerId: 'provider-a' },
    });
    const result = await handleMeetingLlmSummarize({
      meetingId: 'meeting-1',
    });
    expect(result).toEqual({
      summary: null,
      providerUsed: 'provider-a',
      reason: 'provider_error',
    });
  });

  it('minutes body read 실패 → reason=provider_error (silent fallback 차단)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    setup({
      bodyResult: { error: new Error('minutes file missing') },
      summaryResult: { summary: null, providerId: null },
    });
    const result = await handleMeetingLlmSummarize({
      meetingId: 'meeting-1',
    });
    expect(result.reason).toBe('provider_error');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('minutes body read failed'),
      expect.any(Object),
    );
  });

  it('providerId 미지정 시 preferredProviderId=null 로 fallback chain 사용', async () => {
    const { summarizeSpy } = setup({
      bodyResult: { body: '본문' },
      summaryResult: { summary: '요약', providerId: 'fallback-provider' },
    });
    await handleMeetingLlmSummarize({ meetingId: 'meeting-1' });
    expect(summarizeSpy).toHaveBeenCalledWith(
      '본문',
      expect.objectContaining({ preferredProviderId: null }),
    );
  });
});
