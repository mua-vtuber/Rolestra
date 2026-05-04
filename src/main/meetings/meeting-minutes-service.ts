/**
 * MeetingMinutesService — R12-C2 P2-3 회의 step 5 모더레이터 회의록 작성.
 *
 * step 4 (모든 의견 합의 / 제외 처리) 후 시스템이 모더레이터 (R12-S
 * `MeetingSummaryService` + `getResolvedSummaryModel`) 에게 회의록 작성
 * 요청 → 자유 markdown 본문 → `<ArenaRoot>/consensus/meetings/<meetingId>/
 * minutes.md` 저장 + caller (T10 orchestrator) 가 채팅창 카드로 표시.
 *
 * 1 method = `compose(meetingId)`. 의도적으로 다른 surface 노출 X — caller
 * 는 회의가 step 5 진입 시점에 이 method 한 번만 호출한다.
 *
 * spec docs/superpowers/specs/2026-05-01-rolestra-channel-roles-design.md
 *   - §11.18.6  step 5 모더레이터 prompt (truncate 금지 + [합의] + [제외])
 *   - §11.18.7  schema 검증 + truncate 검출 fallback (×1.2 임계 + 1 회 재요청)
 *
 * truncate 검출:
 *   회의록 본문 길이 < (Σ opinion.content + opinion.rationale) × 1.2 → 1 회
 *   재요청. 재요청도 미달 → deterministic fallback. 의견 본문 합 0 (직원이
 *   의견 0 건 제출) 면 검사 skip — fallback minutes 가 자연 짧음.
 *
 * fallback:
 *   모더레이터 호출 실패 (provider null) 또는 truncate 두 번 연속 → opinion
 *   + opinion_vote DB 통째로 deterministic markdown 재구성. 결정 사유는
 *   "(모더레이터 작성 불가 — 시스템 자동 정리)" plate 로 채움.
 *
 * 저장 경로:
 *   `<ArenaRoot>/consensus/meetings/<meetingId>/minutes.md`. spec 의 informal
 *   표현 (`<ArenaRoot>/<projectId>/consensus/...`) 과 달리 코드베이스 invariant
 *   (`arenaRoot.consensusPath()` + `consensus/meetings/` ensure) 따른다.
 *   PathGuard 봉인 = consensusPath() prefix 일치 검증.
 *
 * 비-책임 (caller / 다른 service):
 *   - 채팅창 카드 표시 → T10 orchestrator + T12 회의록 chat block
 *   - 큐 트리거 → T11 (P2-5)
 *   - status='agreed'/'rejected' 갱신 → T8 OpinionService (이미 land)
 */

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ArenaRootService } from '../arena/arena-root-service';
import type { ChannelRepository } from '../channels/channel-repository';
import type { MessageRepository } from '../channels/message-repository';
import type { MeetingRepository } from './meeting-repository';
import type { OpinionRepository } from './opinion-repository';
import type { ProjectRepository } from '../projects/project-repository';
import type { MeetingSummaryService } from '../llm/meeting-summary-service';
import { buildScreenIdMap } from './screen-id';
import type { Message } from '../../shared/message-types';
import type { Opinion, OpinionTreeNode, OpinionVote } from '../../shared/opinion-types';
import type {
  MeetingMinutesComposeInput,
  MeetingMinutesComposeResult,
  MeetingMinutesSource,
} from '../../shared/meeting-minutes-types';

// ── Error hierarchy ────────────────────────────────────────────────────

export class MeetingMinutesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingMinutesError';
  }
}

export class MeetingNotFoundForMinutesError extends MeetingMinutesError {
  constructor(meetingId: string) {
    super(`MeetingMinutesService: meeting not found: ${meetingId}`);
    this.name = 'MeetingNotFoundForMinutesError';
  }
}

export class MinutesPathOutsideConsensusError extends MeetingMinutesError {
  constructor(target: string, consensusBase: string) {
    super(
      `MeetingMinutesService: refuse to write outside consensus folder. ` +
        `target=${target} base=${consensusBase}`,
    );
    this.name = 'MinutesPathOutsideConsensusError';
  }
}

// ── Constants ──────────────────────────────────────────────────────────

/**
 * truncate 검출 임계 — 회의록 본문 길이 ÷ (Σ 의견 본문) ≥ 본 비율 이어야
 * 정상으로 본다. spec §11.18.7 명시값 (1.2). 임계 미달 시 1 회 재요청.
 */
export const TRUNCATE_RATIO_THRESHOLD = 1.2;

/**
 * truncate 검사 skip 임계 — 의견 본문 합이 본 값 이하면 검사 자체 skip.
 * 직원 0 건 의견 회의 / 매우 짧은 회의 보호. 100 자 미만이면 임계 비교가
 * noise — 모더레이터 자유 본문이 자연스럽게 더 길게 나오기 어려움.
 */
const TRUNCATE_SKIP_OPINION_LEN = 100;

/** 저장 디렉터리 — `<ArenaRoot>/consensus/<MINUTES_SUBDIR>/<meetingId>/minutes.md`. */
const MINUTES_SUBDIR = 'meetings';
const MINUTES_FILENAME = 'minutes.md';

// ── Service ────────────────────────────────────────────────────────────

export interface MeetingMinutesServiceDeps {
  arenaRoot: Pick<ArenaRootService, 'consensusPath'>;
  meetingRepo: Pick<MeetingRepository, 'get'>;
  channelRepo: Pick<ChannelRepository, 'get'>;
  /**
   * project lookup — projectId 가 null (DM / global general) 인 회의는 호출
   * skip. ProjectRepository 본체보다 넓은 surface 차단을 위해 좁힌 view.
   */
  projectRepo: Pick<ProjectRepository, 'get'>;
  messageRepo: Pick<MessageRepository, 'listAllByChannel'>;
  opinionRepo: Pick<
    OpinionRepository,
    'listByMeeting' | 'listVotesByMeeting'
  >;
  meetingSummary: Pick<MeetingSummaryService, 'summarize'>;
  /** 테스트 주입용 — 기본 Date.now. */
  now?: () => number;
  /**
   * 테스트 주입용 — 기본 fs.promises.writeFile / mkdir / rename. atomic write
   * 시 임시 파일 충돌을 막는 randomBytes 도 포함.
   */
  fs?: {
    mkdir: (p: string, opts: { recursive: true }) => Promise<unknown>;
    writeFile: (p: string, data: string, encoding: 'utf-8') => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    randomSuffix: () => string;
  };
}

export class MeetingMinutesService {
  private readonly now: () => number;
  private readonly fs: NonNullable<MeetingMinutesServiceDeps['fs']>;

  constructor(private readonly deps: MeetingMinutesServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.fs = deps.fs ?? {
      mkdir: (p, opts) => fsp.mkdir(p, opts),
      writeFile: (p, data, encoding) => fsp.writeFile(p, data, encoding),
      rename: (from, to) => fsp.rename(from, to),
      randomSuffix: () => randomBytes(8).toString('hex'),
    };
  }

  /**
   * 회의록 작성 + minutes.md 저장. caller 책임:
   *   - 회의가 step 5 진입 (모든 의견 합의 / 제외 처리 완료) 검증.
   *   - 결과 `body` 를 채팅창 카드로 표시 (T10 / T12).
   *   - 결과 `minutesPath` 를 사용자에게 안내 (열기 / 외부 도구 연동).
   *
   * 본 method 는 멱등 X — 매 호출 시 모더레이터 새로 호출 + 파일 새로 작성
   * (덮어쓰기). caller 가 "한 번만" 호출하도록 한다.
   */
  async compose(
    input: MeetingMinutesComposeInput,
  ): Promise<MeetingMinutesComposeResult> {
    // 1. 입력 수집
    const meeting = this.deps.meetingRepo.get(input.meetingId);
    if (!meeting) throw new MeetingNotFoundForMinutesError(input.meetingId);

    const channel = this.deps.channelRepo.get(meeting.channelId);
    // channel 이 사라진 경우 (정상 흐름에서는 발생 X — FK 가 cascade 보장)
    // 도 회의록 작성은 시도. project / topic 이 빈 채로 양식만 따름.
    const projectName =
      channel?.projectId !== undefined && channel?.projectId !== null
        ? this.deps.projectRepo.get(channel.projectId)?.name ?? null
        : null;

    const opinions = this.deps.opinionRepo.listByMeeting(input.meetingId);
    const votes = this.deps.opinionRepo.listVotesByMeeting(input.meetingId);
    const screenMap = buildScreenIdMap(opinions);

    const allMessages = this.deps.messageRepo.listAllByChannel(meeting.channelId);
    const meetingMessages = allMessages.filter(
      (m) => m.meetingId === input.meetingId,
    );

    // 2. truncate 검사 기준선 — 의견 본문 합
    const opinionBodyLen = sumOpinionBodyLength(opinions);

    // 3. prompt body 구성 + 모더레이터 1 차 호출
    const promptBody = buildPromptBody({
      topic: meeting.topic,
      projectName,
      messages: meetingMessages,
      tree: screenMap.tree,
      votes,
    });

    const first = await this.deps.meetingSummary.summarize(promptBody, {
      meetingId: input.meetingId,
    });

    let chosenBody: string | null = null;
    let chosenSource: MeetingMinutesSource | null = null;
    let chosenProvider: string | null = null;
    let truncationDetected = false;

    if (first.summary !== null) {
      if (passesTruncateCheck(first.summary, opinionBodyLen)) {
        chosenBody = first.summary;
        chosenSource = 'moderator';
        chosenProvider = first.providerId;
      } else {
        truncationDetected = true;
        // 4. 1 회 재요청 — prompt 재사용. provider 도 다시 자동 선택.
        const second = await this.deps.meetingSummary.summarize(promptBody, {
          meetingId: input.meetingId,
        });
        if (
          second.summary !== null &&
          passesTruncateCheck(second.summary, opinionBodyLen)
        ) {
          chosenBody = second.summary;
          chosenSource = 'moderator-retry';
          chosenProvider = second.providerId;
        }
        // else fallback (chosenBody null 유지)
      }
    }

    // 5. fallback — 모더레이터 실패 또는 두 번 연속 truncate
    if (chosenBody === null) {
      chosenBody = composeDeterministicFallback({
        topic: meeting.topic,
        projectName,
        tree: screenMap.tree,
        votes,
        endedAt: meeting.endedAt ?? this.now(),
      });
      chosenSource = 'fallback';
    }

    // 6. atomic write — `<consensus>/meetings/<meetingId>/minutes.md`
    const minutesPath = await this.writeMinutes(input.meetingId, chosenBody);

    return {
      body: chosenBody,
      source: chosenSource ?? 'fallback',
      providerId: chosenProvider,
      minutesPath,
      truncationDetected,
    };
  }

  /**
   * `<ArenaRoot>/consensus/meetings/<meetingId>/minutes.md` 로 atomic 저장.
   *
   * tmp 파일 (`minutes.md.<rand>.tmp`) 에 먼저 쓰고 rename — POSIX/Windows
   * 모두 같은 디렉터리 안 rename 은 atomic. PathGuard 봉인 = consensusPath
   * prefix 일치 검증 (TOCTOU 안전 — path.resolve 후 startsWith).
   */
  private async writeMinutes(meetingId: string, body: string): Promise<string> {
    const consensusBase = path.resolve(this.deps.arenaRoot.consensusPath());
    const targetDir = path.resolve(consensusBase, MINUTES_SUBDIR, meetingId);
    const targetFile = path.join(targetDir, MINUTES_FILENAME);

    // PathGuard — resolved target 이 consensusBase 안인지 검증.
    const baseWithSep = consensusBase + path.sep;
    if (
      targetDir !== consensusBase &&
      !targetDir.startsWith(baseWithSep)
    ) {
      throw new MinutesPathOutsideConsensusError(targetDir, consensusBase);
    }

    await this.fs.mkdir(targetDir, { recursive: true });

    const tmpFile = `${targetFile}.${this.fs.randomSuffix()}.tmp`;
    await this.fs.writeFile(tmpFile, body, 'utf-8');
    await this.fs.rename(tmpFile, targetFile);

    return targetFile;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * truncate 검사 — 회의록 본문 길이 ÷ 의견 본문 합 ≥ 임계 (1.2). 의견 본문
 * 합이 매우 작으면 (skip 임계 미만) 항상 PASS — 짧은 회의 보호.
 */
function passesTruncateCheck(body: string, opinionBodyLen: number): boolean {
  if (opinionBodyLen <= TRUNCATE_SKIP_OPINION_LEN) return true;
  const ratio = body.length / opinionBodyLen;
  return ratio >= TRUNCATE_RATIO_THRESHOLD;
}

function sumOpinionBodyLength(opinions: Opinion[]): number {
  let total = 0;
  for (const op of opinions) {
    total += (op.content ?? '').length;
    total += (op.rationale ?? '').length;
  }
  return total;
}

// ── Prompt builder (spec §11.18.6) ─────────────────────────────────────

interface PromptBuildInput {
  topic: string;
  projectName: string | null;
  messages: Message[];
  tree: OpinionTreeNode[];
  votes: OpinionVote[];
}

/**
 * spec §11.18.6 prompt 양식 그대로 구성. truncate 금지 / [합의 항목] +
 * [제외 항목] / 결정 사유 모더레이터 작성 강제.
 */
function buildPromptBody(input: PromptBuildInput): string {
  const lines: string[] = [];

  // 헤더 — 규칙 + 양식 (양식은 모더레이터가 그대로 따라야 함).
  lines.push('당신은 회의 모더레이터입니다. 아래 회의 history + 의견 트리를 받아');
  lines.push('회의록을 작성하세요.');
  lines.push('');
  lines.push('[규칙 — 반드시 준수]');
  lines.push('- 의견 본문 통째 보존 (truncate / 요약 / 축약 금지)');
  lines.push('- 근거 통째 보존');
  lines.push('- 결정 사유 (왜 합의 / 왜 제외) 직접 작성');
  lines.push('');
  lines.push('[양식]');
  lines.push('# {meeting_topic} — {date}');
  lines.push('');
  lines.push('## 합의 항목');
  lines.push('- 의견 ITEM_NNN: "{title}" ({author_label} 발의)');
  lines.push('  - 본문: ... (통째)');
  lines.push('  - 근거: ... (통째)');
  lines.push('  - 결정: 합의 (X 명 동의)');
  lines.push('');
  lines.push('(후략 — 모든 status=agreed 의견 반복)');
  lines.push('');
  lines.push('## 제외 항목');
  lines.push('- 의견 ITEM_NNN: "{title}" ({author_label} 발의)');
  lines.push('  - 본문: ... (통째)');
  lines.push('  - 근거: ... (통째)');
  lines.push('  - 제외 사유: ... (모더레이터 작성)');
  lines.push('  - ☞ 사용자가 다시 발화하려면: "회의록 X — 제외 항목 #N (title) 다시 진행"');
  lines.push('');
  lines.push('(후략 — 모든 status=rejected/excluded 의견 반복)');
  lines.push('');

  // 컨텍스트 — 시스템이 동봉하는 구체값.
  lines.push('---');
  lines.push('');
  lines.push(`회의 주제: ${input.topic.trim() || '(주제 미지정)'}`);
  if (input.projectName) {
    lines.push(`프로젝트: ${input.projectName}`);
  }
  lines.push('');

  lines.push('[회의 history]');
  if (input.messages.length === 0) {
    lines.push('(메시지 없음)');
  } else {
    for (const msg of input.messages) {
      lines.push(formatMessageLine(msg));
    }
  }
  lines.push('');

  lines.push('[의견 트리]');
  if (input.tree.length === 0) {
    lines.push('(의견 없음)');
  } else {
    const votesByOpinion = groupVotesByOpinion(input.votes);
    for (const node of input.tree) {
      appendOpinionNode(lines, node, votesByOpinion);
    }
  }

  return lines.join('\n');
}

function formatMessageLine(msg: Message): string {
  const who =
    msg.authorKind === 'user'
      ? '사용자'
      : msg.authorKind === 'system'
        ? `[시스템:${msg.authorId}]`
        : msg.authorId;
  const content = msg.content.replace(/\r\n/g, '\n').trim();
  return `- (${who}) ${content}`;
}

function groupVotesByOpinion(votes: OpinionVote[]): Map<string, OpinionVote[]> {
  const out = new Map<string, OpinionVote[]>();
  for (const v of votes) {
    const arr = out.get(v.targetId);
    if (arr) arr.push(v);
    else out.set(v.targetId, [v]);
  }
  return out;
}

function appendOpinionNode(
  lines: string[],
  node: OpinionTreeNode,
  votesByOpinion: Map<string, OpinionVote[]>,
  indent = '',
): void {
  const op = node.opinion;
  const tally = summarizeVotes(votesByOpinion.get(op.id) ?? []);
  lines.push(
    `${indent}- ${node.screenId} [${op.kind}] [${op.status}] (${op.authorLabel} 발의) "${op.title ?? '(제목 없음)'}"`,
  );
  if (op.content) {
    lines.push(`${indent}  - 본문: ${op.content}`);
  }
  if (op.rationale) {
    lines.push(`${indent}  - 근거: ${op.rationale}`);
  }
  if (tally) {
    lines.push(`${indent}  - 투표: ${tally}`);
  }
  if (op.exclusionReason) {
    lines.push(`${indent}  - 제외 사유 (시스템 기록): ${op.exclusionReason}`);
  }
  for (const child of node.children) {
    appendOpinionNode(lines, child, votesByOpinion, `${indent}  `);
  }
}

function summarizeVotes(votes: OpinionVote[]): string {
  if (votes.length === 0) return '';
  let agree = 0;
  let oppose = 0;
  let abstain = 0;
  for (const v of votes) {
    if (v.vote === 'agree') agree += 1;
    else if (v.vote === 'oppose') oppose += 1;
    else abstain += 1;
  }
  return `agree=${agree} oppose=${oppose} abstain=${abstain}`;
}

// ── Deterministic fallback (모더레이터 실패 / 두 번 연속 truncate) ────

interface FallbackInput {
  topic: string;
  projectName: string | null;
  tree: OpinionTreeNode[];
  votes: OpinionVote[];
  endedAt: number;
}

/**
 * spec §11.18.6 양식 그대로 따르되 결정 사유는 plate 로 채운다 (모더레이터
 * 작성 불가 — 시스템 자동 정리). 의견 본문 / 근거는 통째 보존 — truncate
 * 금지 정신 동일.
 */
function composeDeterministicFallback(input: FallbackInput): string {
  const lines: string[] = [];
  const date = new Date(input.endedAt).toISOString().slice(0, 10);
  const topic = input.topic.trim() || '(주제 미지정)';

  lines.push(`# ${topic} — ${date}`);
  if (input.projectName) {
    lines.push(``);
    lines.push(`프로젝트: ${input.projectName}`);
  }
  lines.push('');

  // 합의 / 제외 분리. tree depth-first 순회.
  const flatten: OpinionTreeNode[] = [];
  const walk = (node: OpinionTreeNode): void => {
    flatten.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of input.tree) walk(root);

  const votesByOpinion = groupVotesByOpinion(input.votes);
  const agreed = flatten.filter((n) => n.opinion.status === 'agreed');
  const excluded = flatten.filter(
    (n) => n.opinion.status === 'rejected' || n.opinion.status === 'excluded',
  );

  lines.push('## 합의 항목');
  if (agreed.length === 0) {
    lines.push('(합의된 의견 없음)');
  } else {
    let idx = 1;
    for (const node of agreed) {
      appendFallbackEntry(lines, node, votesByOpinion, idx, 'agreed');
      idx += 1;
    }
  }
  lines.push('');

  lines.push('## 제외 항목');
  if (excluded.length === 0) {
    lines.push('(제외된 의견 없음)');
  } else {
    let idx = 1;
    for (const node of excluded) {
      appendFallbackEntry(lines, node, votesByOpinion, idx, 'excluded');
      idx += 1;
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('_본 회의록은 모더레이터 작성 불가로 시스템이 자동 정리한 결과입니다._');

  return lines.join('\n');
}

function appendFallbackEntry(
  lines: string[],
  node: OpinionTreeNode,
  votesByOpinion: Map<string, OpinionVote[]>,
  ordinal: number,
  bucket: 'agreed' | 'excluded',
): void {
  const op = node.opinion;
  const tally = summarizeVotes(votesByOpinion.get(op.id) ?? []);
  const author = op.authorLabel || '(작성자 미상)';
  const title = op.title ?? '(제목 없음)';

  lines.push(`- 의견 ${node.screenId}: "${title}" (${author} 발의)`);
  if (op.content) {
    lines.push(`  - 본문: ${op.content}`);
  }
  if (op.rationale) {
    lines.push(`  - 근거: ${op.rationale}`);
  }
  if (bucket === 'agreed') {
    lines.push(
      `  - 결정: 합의${tally ? ` (${tally})` : ''} (모더레이터 작성 불가 — 시스템 자동 정리)`,
    );
  } else {
    const reason = op.exclusionReason
      ? op.exclusionReason
      : '(모더레이터 작성 불가 — 시스템 자동 정리)';
    lines.push(`  - 제외 사유: ${reason}`);
    lines.push(
      `  - ☞ 사용자가 다시 발화하려면: "회의록 X — 제외 항목 #${ordinal} (${title}) 다시 진행"`,
    );
  }
}
