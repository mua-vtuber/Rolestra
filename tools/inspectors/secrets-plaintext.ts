/**
 * secrets-plaintext — safeStorage 우회 평문 저장 검출.
 *
 * 헌법: NoSilentFallback / SoC.
 * 절대 위반 금지 규칙 #6 (API 키 평문 노출 금지) 의 코드 표현.
 *
 * Phase 1 휴리스틱: 파일이 (a) 비밀 식별자 property 를 포함 + (b) fs.write*
 * 호출 + (c) safeStorage 미import + (d) allowlist 밖 = 1 hit (파일당 1 회).
 *
 * Allowlist: 비밀을 합법적으로 다루는 모듈 (config/secrets, settings-store
 * 등). false positive 발생 시 allowlist 갱신 또는 룰 정밀화 (phase 1 목적).
 */
import type { Inspector, Hit, ScannedFile } from './types';
import { iterLines } from './walker';

const SECRET_PROPERTY = /\b(api[_-]?key|api[_-]?secret|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|bearer[_-]?token|private[_-]?key)\s*[:=]/i;
const FS_WRITE = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|outputFile|outputFileSync|writeJson|writeJsonSync)\b/;
const SAFE_STORAGE_IMPORT = /from\s+['"](?:electron|.*safe[_-]?storage)['"]/;

const ALLOWLIST: ReadonlySet<string> = new Set([
  // 비밀 매니저 자체 — safeStorage / 키체인 위임
  'src/main/config/secrets-store.ts',
  'src/main/config/secrets-encryptor.ts',
  // 설정 저장 (안에 비밀 식별자 등장하지만 safeStorage 통해 처리)
  'src/main/config/settings-store.ts',
]);

const inspector: Inspector = {
  category: 'secrets-plaintext',
  constitution: 'NoSilentFallback',
  scope: 'safety',
  description:
    'safeStorage 우회 평문 저장 검출 — 비밀 식별자 + fs.write 동시 등장 (phase 1 휴리스틱, 파일당 1 회).',
  perFile(file: ScannedFile): Hit[] {
    if (file.isTest) return [];
    if (!file.isMainProcess && !file.isPreload) return [];
    if (ALLOWLIST.has(file.rel)) return [];
    if (file.rel.startsWith('src/main/database/migrations/')) return [];
    if (SAFE_STORAGE_IMPORT.test(file.source)) return [];

    let firstSecretLine = -1;
    let firstWriteLine = -1;
    for (const { line, text } of iterLines(file.source)) {
      // 주석 line 은 skip
      const trimmed = text.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*'))
        continue;
      if (firstSecretLine === -1 && SECRET_PROPERTY.test(text))
        firstSecretLine = line;
      if (firstWriteLine === -1 && FS_WRITE.test(text)) firstWriteLine = line;
      if (firstSecretLine !== -1 && firstWriteLine !== -1) break;
    }
    if (firstSecretLine === -1 || firstWriteLine === -1) return [];

    return [
      {
        category: 'secrets-plaintext',
        constitution: 'NoSilentFallback',
        file: file.rel,
        line: Math.min(firstSecretLine, firstWriteLine),
        severity: 'safety-error',
        message:
          '비밀 식별자 (apiKey / secretKey 등) 와 fs.write* 가 같은 파일에 공존하나 safeStorage import 없음 — 평문 저장 의심.',
        excerpt:
          (firstSecretLine !== -1 ? `secret@${firstSecretLine} ` : '') +
          (firstWriteLine !== -1 ? `write@${firstWriteLine}` : ''),
      },
    ];
  },
};

export default inspector;
