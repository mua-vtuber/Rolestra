/**
 * permission-flag-filter — R12-W T11 (ADR D5 2단계 filter 의 2단계).
 *
 * 1단계는 {@link import('./permission-flag-builder').buildReadOnlyPermissionFlags}
 * 가 만드는 base argv 다 — 프로젝트 정책 (mode / kind) 이 정하는 CLI 플래그.
 * 여기 2단계는 그 base argv 를 *채널 권한* 으로 한 번 더 좁힌다. 사용자가
 * 채널 설정에서 "웹 검색 끔" 을 고르면 그 채널의 회의 turn 은 Claude 를
 * `WebSearch` / `WebFetch` 없이 띄운다.
 *
 * 좁히기만 한다 — base 에 없던 도구를 새로 허용하는 일은 절대 없다. 채널
 * 권한이 전부 켜져 있어도 결과는 base 그대로다.
 *
 * fail-closed 규약: 채널 권한으로 제외된 도구는 `--allowedTools` 에서 빼는
 * 것으로 끝내지 않고 `--disallowedTools` 에 명시한다. Claude CLI 는 두
 * 철자 (`--disallowedTools` / `--disallowed-tools`) 를 모두 받으며, 본
 * 모듈은 기존 `--allowedTools` 와 표기를 맞춰 camelCase 를 쓴다. 좁힌
 * 결과가 빈 목록이면 `--allowedTools` 자체를 argv 에서 뺀다 — 빈 문자열을
 * 넘기면 CLI 가 "지정 없음 = 기본 전체 허용" 으로 읽을 수 있어서, 권한을
 * 모두 끈 채널이 오히려 가장 넓은 권한을 받는 역전이 생긴다.
 *
 * Codex 는 도구 단위 allow 목록이라는 개념이 argv 에 없다 (샌드박스
 * 등급 하나로 표현). 그래서 base 를 그대로 돌려주고 rationale 로만 사유를
 * 남긴다.
 *
 * 계약 상 유의 (plan 대비 편차): plan T11 의 시그니처는 `baseFlags:
 * PermissionFlagOutput` 이지만, 실제 호출 지점인 adapter shim
 * (`src/main/providers/cli/permission-adapter.ts` 의 `buildReadOnlyArgs`)
 * 은 `string[]` 을 돌려준다. 중간에서 형태를 지어내지 않도록 입력 타입을
 * `string[]` 로 맞춘다.
 */

import type { CliKind } from '../../shared/cli-types';
import type { PermissionSet } from '../../shared/permission-set-types';

/** Claude `--allowedTools` csv 를 담은 플래그 이름. */
const ALLOWED_TOOLS_FLAG = '--allowedTools';

/**
 * fail-closed 표기 — 제외된 도구를 명시적으로 거부한다.
 *
 * 철자는 설치된 Claude CLI `--help` 가 첫 번째로 문서화하는 형태
 * (`--disallowedTools, --disallowed-tools`) 를 따른다.
 */
const DISALLOWED_TOOLS_FLAG = '--disallowedTools';

/**
 * Claude 도구 → 그 도구가 요구하는 권한 axis (plan T11 표 그대로).
 *
 * 여기에 없는 도구는 채널 권한과 무관하다고 보고 손대지 않는다 — 알 수
 * 없는 도구를 임의로 떨어뜨리면 사용자가 이유를 알 수 없는 축소가 된다.
 */
const TOOL_REQUIREMENTS: Record<string, keyof PermissionSet> = {
  Read: 'fileRead',
  Glob: 'fileRead',
  Grep: 'fileRead',
  Edit: 'fileWrite',
  Write: 'fileWrite',
  MultiEdit: 'fileWrite',
  NotebookEdit: 'fileWrite',
  Bash: 'commandExec',
  WebSearch: 'webSearch',
  WebFetch: 'webSearch',
};

/** 무엇이든 하나라도 제외됐을 때 한 번만 붙는 사유 key. */
const REASON_REMOVED = 'permission.flag.filter.reason.removed_by_channel_permission';

/** Codex — 도구 단위 filter 대상이 아님. */
const REASON_NO_FILTER = 'permission.flag.filter.reason.cli_no_filter';

export interface PermissionFilterInput {
  cliKind: CliKind;
  /** 1단계 결과 argv (adapter shim 이 돌려준 그대로). */
  baseFlags: string[];
  permissions: PermissionSet;
}

export interface PermissionFilterOutput {
  /** spawn 에 그대로 쓰는 argv. */
  flags: string[];
  /** i18n key 배열 — 로그 / UI 안내용. */
  rationale: string[];
  filtered: { removedTools: string[] };
}

/** csv 를 도구 이름 배열로. 빈 항목은 버린다. */
function splitTools(csv: string): string[] {
  return csv
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 채널 권한이 이 도구를 허용하는가. 매핑에 없는 도구는 항상 허용. */
function isToolAllowed(tool: string, permissions: PermissionSet): boolean {
  const axis = TOOL_REQUIREMENTS[tool];
  if (axis === undefined) return true;
  return permissions[axis];
}

/**
 * base argv 에서 `--allowedTools <csv>` 의 위치를 찾는다.
 *
 * @returns 플래그 이름의 index, 없으면 -1. 값이 뒤따르지 않는 마지막
 *   토큰이면 좁힐 대상이 없으므로 -1 과 같게 취급한다.
 */
function findAllowedToolsIndex(flags: string[]): number {
  const idx = flags.indexOf(ALLOWED_TOOLS_FLAG);
  if (idx < 0 || idx + 1 >= flags.length) return -1;
  return idx;
}

/**
 * 채널 권한으로 CLI argv 를 좁힌다.
 *
 * Claude 만 실제 filter 대상이다. base 에 `--allowedTools` 가 없으면
 * (예: Codex 형태이거나 표가 바뀐 경우) 아무것도 하지 않는다 —
 * 없는 플래그를 새로 만들어 붙이지 않는다.
 */
export function filterFlagsByChannelPermission(
  input: PermissionFilterInput,
): PermissionFilterOutput {
  if (input.cliKind !== 'claude') {
    return {
      flags: [...input.baseFlags],
      rationale: [REASON_NO_FILTER],
      filtered: { removedTools: [] },
    };
  }

  const allowedIdx = findAllowedToolsIndex(input.baseFlags);
  if (allowedIdx < 0) {
    return {
      flags: [...input.baseFlags],
      rationale: [],
      filtered: { removedTools: [] },
    };
  }

  const csv = input.baseFlags[allowedIdx + 1] ?? '';
  const baseTools = splitTools(csv);
  const keptTools: string[] = [];
  const removedTools: string[] = [];
  for (const tool of baseTools) {
    if (isToolAllowed(tool, input.permissions)) {
      keptTools.push(tool);
    } else {
      removedTools.push(tool);
    }
  }

  if (removedTools.length === 0) {
    return {
      flags: [...input.baseFlags],
      rationale: [],
      filtered: { removedTools: [] },
    };
  }

  // 나머지 플래그는 순서를 그대로 둔다 — CLI 옵션 순서에 의미가 있는
  // 경우 (Codex 의 global/exec 구분 등) 를 여기서 흐트러뜨리지 않는다.
  const flags: string[] = [];
  for (let i = 0; i < input.baseFlags.length; i += 1) {
    if (i === allowedIdx) {
      if (keptTools.length > 0) {
        flags.push(ALLOWED_TOOLS_FLAG, keptTools.join(','));
      }
      // keptTools 가 비면 `--allowedTools` 와 그 값을 통째로 뺀다.
      i += 1;
      continue;
    }
    const flag = input.baseFlags[i];
    if (flag !== undefined) flags.push(flag);
  }
  flags.push(DISALLOWED_TOOLS_FLAG, removedTools.join(','));

  return {
    flags,
    rationale: [REASON_REMOVED],
    filtered: { removedTools },
  };
}
