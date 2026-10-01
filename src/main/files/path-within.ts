/**
 * Path containment guard — the single place in `src/main` that answers
 * "is this target inside that sealed root?".
 *
 * R12-X T5: three call sites used to hand-roll their own containment check
 * (`PermissionService.validateAccess`, `MeetingMinutesService.resolveMinutesPath`,
 * `DesignSnapshotService.captureDesignSnapshot`). Two of them compared only the
 * lexical prefix (`path.resolve` + `startsWith(base + path.sep)`), which a
 * symlink inside the root defeats: `<consensus>/meetings/<id>` can be a link
 * pointing anywhere, and a lexical prefix check still says "inside". Having one
 * helper means a future fix to the guard reaches every sealed root at once.
 *
 * Ported from R1 `tools/cli-smoke/src/path-guard.ts`.
 *
 * Behaviour:
 *   1. Reject raw `..` traversal based on the lexical relation.
 *   2. realpath(root) and realpath(candidate); a candidate that does not exist
 *      yet falls back to the realpath of its nearest existing ancestor joined
 *      with the remaining suffix. Writes to paths that do not exist yet stay
 *      valid, while symlink escapes on existing ancestors are still caught.
 *   3. Re-check the relation on the realpath forms: reject when the relative
 *      path escapes upward or turns absolute.
 *
 * Caveats worth knowing before changing a call site:
 *   - **The root must exist.** `realpathSync(root)` failing means nothing can
 *     be proven to be inside it, so the answer is `false`. Callers whose root
 *     is created lazily must `mkdir` it before the check, not after.
 *   - **`/var` vs `/private/var` on macOS — only inside a shared root.**
 *     `os.tmpdir()` returns `/var/folders/...`, a symlink to
 *     `/private/var/folders/...`. Step 1 runs *before* any realpath, so it
 *     compares the spellings the caller passed. That is deliberate: a path
 *     that lexically escapes is rejected without touching the filesystem.
 *     The consequence is that a root spelled `/var/x` and a candidate spelled
 *     `/private/var/x/child` are reported as NOT contained, even though they
 *     name the same tree. Once root and candidate share a spelling prefix,
 *     step 2 resolves both and symlinked ancestors compare correctly.
 *     Every current caller derives both sides from the same stored string
 *     (`ArenaRootService.consensusPath()` / `resolveForCli().cwd`, both built
 *     by `path.join` on one `currentPath`), so the spellings always agree. A
 *     future caller that takes a root from one source and a candidate from
 *     another must resolve both through `fs.realpathSync` first, or step 1
 *     will reject a legitimate pair.
 *   - **Windows drive-letter case.** `path.relative` on win32 compares path
 *     segments case-insensitively, so `C:\Foo` and `c:\foo` are the same root.
 *     On POSIX they are two different directories, which is correct there.
 *   - **Trailing separators** are removed by `path.resolve` on both sides, so
 *     `root/` and `root` behave identically.
 *
 * Intentionally synchronous — call sites sit on the spawn critical path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Returns true iff `candidate` is `root` itself or a descendant of it, after
 * both paths are resolved to absolute + realpath form.
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);

  const rawRel = path.relative(normalizedRoot, normalizedCandidate);
  if (rawRel.startsWith('..') || path.isAbsolute(rawRel)) return false;

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(normalizedRoot);
  } catch {
    // Root itself must exist. If it doesn't, nothing can be "within" it.
    return false;
  }

  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(normalizedCandidate);
  } catch {
    realCandidate = resolveNearestExistingAncestor(normalizedCandidate);
  }

  const rel = path.relative(realRoot, realCandidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * For a non-existent path, walk upward until an existing ancestor is found,
 * realpath it, then re-join the remaining suffix. Falls through to the raw
 * input if no ancestor exists (e.g. invalid drive).
 */
function resolveNearestExistingAncestor(p: string): string {
  let current = p;
  while (current && current !== path.dirname(current)) {
    try {
      const real = fs.realpathSync(current);
      const remaining = path.relative(current, p);
      return path.join(real, remaining);
    } catch {
      current = path.dirname(current);
    }
  }
  return p;
}
