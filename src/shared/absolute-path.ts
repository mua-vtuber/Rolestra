/**
 * AbsolutePath — R12-X T1 (ADR D4) 회귀 가드.
 *
 * `projectPath: ''` / `cwd: '.'` 같은 raw 문자열이 spawn 경계까지 흘러가던
 * 격차를 컴파일 타임에 막기 위한 brand type 이다. `string` 과 구조적으로
 * 호환되지만 (읽는 쪽은 그대로 `string` 으로 쓸 수 있다) 반대 방향 대입은
 * `asAbsolutePath` / `unsafeMarkAbsolute` 를 거쳐야만 가능하다.
 *
 * 왜 `node:path.isAbsolute` 를 쓰지 않는가:
 *   `src/shared` 는 renderer 번들에도 들어간다. renderer 는 Node API 직접
 *   접근이 금지 (CLAUDE.md 절대 규칙 1) 이므로 절대경로 판정을 순수 문자열
 *   검사로 구현한다. 판정 대상은 세 가지 형태뿐이다.
 *     - POSIX          `/home/user/x`
 *     - Windows 드라이브 `C:\x` / `C:/x`
 *     - Windows UNC     `\\server\share`
 *   Windows 의 드라이브 상대 경로 (`C:x`) 와 루트 상대 경로 (`\x`) 는
 *   cwd 에 의존하므로 절대경로가 아니다 — 둘 다 거부한다.
 */

/** 검증을 통과한 절대경로. 구조적으로는 string 이지만 대입은 helper 경유. */
export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' };

/** `asAbsolutePath` 검증 실패. message 에 호출 맥락과 실제 값을 담는다. */
export class AbsolutePathError extends Error {
  constructor(
    /** 호출자가 넘긴 맥락 라벨 (예: `SsmContext.projectPath`). */
    readonly context: string,
    /** 검증에 실패한 원본 값. */
    readonly value: string,
    reason: string,
  ) {
    super(
      `[absolute-path] ${context}: ${reason} (value=${JSON.stringify(value)})`,
    );
    this.name = 'AbsolutePathError';
  }
}

/** POSIX 루트 경로 (`/x`). 단독 `/` 도 절대경로다. */
const POSIX_ABSOLUTE = /^\//;
/** Windows 드라이브 절대경로 (`C:\x`, `c:/x`, `C:\`). `C:x` 는 제외. */
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** Windows UNC 경로 (`\\server\share`, `//server/share`). */
const WINDOWS_UNC_ABSOLUTE = /^[\\/]{2}[^\\/]/;

/**
 * 순수 문자열 판정 — 위 세 형태 중 하나면 true.
 *
 * 앞뒤 공백은 제거하지 않는다. 공백이 붙은 경로는 호출자의 조립 실수이고,
 * 조용히 다듬어 통과시키면 그 실수가 spawn 시점까지 숨는다.
 */
export function isAbsolutePathString(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false;
  return (
    POSIX_ABSOLUTE.test(p) ||
    WINDOWS_DRIVE_ABSOLUTE.test(p) ||
    WINDOWS_UNC_ABSOLUTE.test(p)
  );
}

/**
 * 절대경로 검증 + brand 부여.
 *
 * 빈 문자열 / 공백만 있는 값 / `.` / `./x` / `../x` / `relative/path` 는 모두
 * throw 한다. silent fallback 금지 (CLAUDE.md 절대 규칙) — 경로가 없는 것은
 * 실패이지 기본값을 끼워 넣을 상황이 아니다.
 *
 * @param p 검사할 원본 경로 문자열.
 * @param context 실패 message 에 실릴 호출 맥락 (예: `SsmContext.projectPath`).
 * @throws {AbsolutePathError} 절대경로가 아닐 때.
 */
export function asAbsolutePath(p: string, context: string): AbsolutePath {
  if (typeof p !== 'string' || p.length === 0) {
    throw new AbsolutePathError(context, String(p), 'path must not be empty');
  }
  if (p.trim().length === 0) {
    throw new AbsolutePathError(context, p, 'path must not be whitespace-only');
  }
  if (!isAbsolutePathString(p)) {
    throw new AbsolutePathError(context, p, 'path must be absolute');
  }
  return p as AbsolutePath;
}

/**
 * 검증 없이 brand 만 붙이는 탈출구.
 *
 * 이미 다른 경계에서 절대경로임이 보장된 값에만 쓴다. 호출 위치마다 *왜*
 * 이미 절대경로인지 한 줄 주석을 남겨야 한다 (ADR D4 — code review 단계에서
 * grep 으로 전수 확인). 새 코드는 기본적으로 `asAbsolutePath` 를 쓴다.
 */
export function unsafeMarkAbsolute(p: string): AbsolutePath {
  return p as AbsolutePath;
}
