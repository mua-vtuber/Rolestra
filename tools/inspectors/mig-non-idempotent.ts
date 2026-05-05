/**
 * mig-non-idempotent — migration 안 비-idempotent 작업 검출.
 *
 * 헌법: Idempotency.
 * 절대 위반 금지 규칙 #7 (마이그레이션 forward-only / idempotent / 실패 시
 * 앱 시작 차단) 의 코드 표현.
 *
 * 차단 패턴 (migration 파일 한정):
 *  - CREATE TABLE / CREATE INDEX / CREATE UNIQUE INDEX 가 IF NOT EXISTS 없음
 *  - ALTER TABLE ... ADD COLUMN 은 SQLite 가 IF NOT EXISTS 미지원이라 별도
 *    체크 필요 (migration framework 가 1 회 실행 보장 → 여기는 report-only)
 *
 * Note: Rolestra migrator 가 이미 1 회 실행 보장 (applied set 추적). 따라서
 * IF NOT EXISTS 누락은 *별도 도구가 같은 DB 를 건드릴 때* 의 안전망. phase
 * 1 에서 report-only 로 patten 인식 → false positive 정리.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const CREATE_PATTERN =
  /\bCREATE\s+(?:UNIQUE\s+)?(TABLE|INDEX)(?!\s+IF\s+NOT\s+EXISTS)\s+\w+/i;

const inspector: Inspector = {
  category: 'mig-non-idempotent',
  constitution: 'Idempotency',
  scope: 'safety',
  description:
    'migration 안 CREATE TABLE / CREATE INDEX 가 IF NOT EXISTS 없음.',
  perFile(file: ScannedFile): Hit[] {
    if (!file.isMigration) return [];
    if (file.rel.endsWith('migrations/index.ts')) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = CREATE_PATTERN.exec(text);
      if (match === null) continue;
      hits.push({
        category: 'mig-non-idempotent',
        constitution: 'Idempotency',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `CREATE ${match[1]?.toUpperCase() ?? ''} 가 IF NOT EXISTS 없음 — idempotent 보장 필요.`,
        excerpt: text.trim().slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
