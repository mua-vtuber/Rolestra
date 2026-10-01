/**
 * `parseDoubleHash` 테스트 — R12-C2 P4 T20 일반 채널 [##본문] 추출.
 *
 * 0 / 1 / N 매칭 + edge cases (빈 본문 / 닫히지 않은 [## / 중첩 / 줄바꿈 /
 * UTF-16 surrogate / 한글). 파서가 silent fallback 없이 결정적으로
 * 작동함을 보장한다.
 */

import { describe, expect, it } from 'vitest';
import { parseDoubleHash } from '../parsers/double-hash-parser';

describe('parseDoubleHash — 0 / 1 / N 매칭', () => {
  it('빈 문자열 → 빈 배열', () => {
    expect(parseDoubleHash('')).toEqual([]);
  });

  it('일반 텍스트 → 빈 배열 (잡담은 자동 등록 X)', () => {
    expect(parseDoubleHash('오늘 회의 어떠셨나요?')).toEqual([]);
  });

  it('[## 없는 일반 본문 → 빈 배열', () => {
    expect(parseDoubleHash('hello world\nplain second line')).toEqual([]);
  });

  it('단일 `[##본문]` → 1 매칭', () => {
    const text = '[##할 일 제안]';
    const result = parseDoubleHash(text);
    expect(result).toEqual([
      { body: '할 일 제안', start: 0, end: text.length },
    ]);
  });

  it('한 메시지 안 여러 [##] → 등장 순서 유지', () => {
    const text = '두 가지 의견 — [##먼저] 그리고 [##두번째]';
    const result = parseDoubleHash(text);
    expect(result).toHaveLength(2);
    expect(result[0]!.body).toBe('먼저');
    expect(result[1]!.body).toBe('두번째');
    expect(result[0]!.start).toBeLessThan(result[1]!.start);
  });

  it('잡담 + [##본문] 혼합 → [##] segment 만 추출', () => {
    const text = 'hello [##first] world [##second] tail';
    const result = parseDoubleHash(text);
    expect(result.map((m) => m.body)).toEqual(['first', 'second']);
  });
});

describe('parseDoubleHash — edge cases', () => {
  it('빈 본문 `[##]` → skip', () => {
    expect(parseDoubleHash('[##]')).toEqual([]);
  });

  it('whitespace 본문 `[##   ]` → skip (trim 후 빈 문자열)', () => {
    expect(parseDoubleHash('[##   \t  ]')).toEqual([]);
  });

  it('닫히지 않은 `[##unclosed` → skip', () => {
    expect(parseDoubleHash('hello [##unclosed text')).toEqual([]);
  });

  it('닫히지 않은 + 닫힌 mix → 닫힌 것만 추출', () => {
    const result = parseDoubleHash('[##unclosed and then [##closed]');
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('unclosed and then [##closed');
  });

  it('본문 안 줄바꿈 허용', () => {
    const result = parseDoubleHash('[##line1\nline2\nline3]');
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('line1\nline2\nline3');
  });

  it('본문 trim — 앞뒤 whitespace 제거', () => {
    const result = parseDoubleHash('[##   padded body   ]');
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('padded body');
  });

  it('중첩 `[## outer [## inner ]]` → 첫 `]` 가 종결', () => {
    const result = parseDoubleHash('[## outer [## inner ]]');
    expect(result).toHaveLength(1);
    // 첫 ']' 까지 잡힘 — body = 'outer [## inner' (trim).
    expect(result[0]!.body).toBe('outer [## inner');
  });

  it('한글 본문 + 특수문자', () => {
    const text = '[##기능 추가: 사용자 검색 (FTS5 활용)]';
    const result = parseDoubleHash(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.body).toBe('기능 추가: 사용자 검색 (FTS5 활용)');
  });

  it('start / end 인덱스 정확 — 원본 substring 으로 raw 복원 가능', () => {
    const text = 'pre [##first body] mid [##second] tail';
    const result = parseDoubleHash(text);
    expect(text.slice(result[0]!.start, result[0]!.end)).toBe('[##first body]');
    expect(text.slice(result[1]!.start, result[1]!.end)).toBe('[##second]');
  });

  it('연속된 `[##a][##b]` (공백 없음) → 두 매칭', () => {
    const result = parseDoubleHash('[##a][##b]');
    expect(result.map((m) => m.body)).toEqual(['a', 'b']);
  });

  it('본문에 `##` 만 있고 brackets 없음 → skip', () => {
    expect(parseDoubleHash('## not wrapped')).toEqual([]);
  });

  it('한 줄 [#hash] (single hash) → skip — 정확히 `[##` 두 개 hash 만', () => {
    expect(parseDoubleHash('[#single hash]')).toEqual([]);
  });
});
