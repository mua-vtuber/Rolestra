/**
 * mig-non-forward-only — migration 안 revert / column drop / rename 검출.
 *
 * 헌법: SSoT / Atomicity.
 * 절대 위반 금지 규칙 #7 (마이그레이션 forward-only) 의 코드 표현.
 *
 * 차단 패턴 (migration 파일 한정):
 *  - DROP TABLE / DROP INDEX / DROP VIEW
 *  - ALTER TABLE ... DROP COLUMN / DROP CONSTRAINT
 *  - ALTER TABLE ... RENAME COLUMN (이전 이름 사라짐 = SSoT 깨짐)
 *
 * 데이터 마이그레이션 (UPDATE / DELETE 행 정리) 은 forward-only 의 일부 →
 * 차단 X. 컬럼 / 테이블 schema 자체의 폐기만 차단.
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const DROP_PATTERN =
  /\b(DROP\s+(?:TABLE|INDEX|VIEW|TRIGGER)|ALTER\s+TABLE\s+\w+\s+(?:DROP\s+(?:COLUMN|CONSTRAINT)|RENAME\s+COLUMN))/i;

const inspector: Inspector = {
  category: 'mig-non-forward-only',
  constitution: 'SSoT',
  scope: 'safety',
  description:
    'migration 안 DROP / RENAME 검출 — forward-only chain 위반.',
  perFile(file: ScannedFile): Hit[] {
    if (!file.isMigration) return [];
    if (file.rel.endsWith('migrations/index.ts')) return [];

    const hits: Hit[] = [];
    for (const { line, text } of iterLines(file.source)) {
      const match = DROP_PATTERN.exec(text);
      if (match === null) continue;
      const trimmed = text.trim();
      // 코멘트 안 (테이블 명 설명 등) 은 skip
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      hits.push({
        category: 'mig-non-forward-only',
        constitution: 'SSoT',
        file: file.rel,
        line,
        severity: 'safety-error',
        message: `migration 안 ${match[1]?.toUpperCase() ?? ''} — forward-only chain 위반.`,
        excerpt: trimmed.slice(0, 100),
      });
    }
    return hits;
  },
};

export default inspector;
