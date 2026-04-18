import fs from 'node:fs';
import path from 'node:path';

/**
 * candidate가 root의 하위(혹은 root 자체)인지 realpath 기준으로 판정.
 * - traversal(..) 차단
 * - symlink 추적 후 재검증
 * - 존재하지 않는 경로는 존재하는 가장 가까운 조상의 realpath를 기준으로 조립
 */
export function isPathWithin(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);

  // 문자열 상 관계부터 차단
  const rawRel = path.relative(normalizedRoot, normalizedCandidate);
  if (rawRel.startsWith('..') || path.isAbsolute(rawRel)) return false;

  // realpath 해결
  const realRoot = fs.realpathSync(normalizedRoot);
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync(normalizedCandidate);
  } catch {
    realCandidate = resolveNearestExistingAncestor(normalizedCandidate);
  }

  const rel = path.relative(realRoot, realCandidate);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

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
