/**
 * 결재 3번 (A, 2026-05-19) — capability-resolver 매트릭스 검증.
 *
 * R11-Task9 (`r11-summarize-capability.test.ts`) 는 streaming + summarize 두
 * 능력 등록만 회귀 가드한다. 본 테스트는 결재 3번 (A) 로 신규 추가된 5 능력
 * 매트릭스 — `resume` / `tools` / `multimodal` / `json-mode` / `code-execution`
 * — 가 각 endpoint / CLI 종류별로 정확히 등록되는지 잠근다.
 *
 * 향후 capability-aware 라우팅 (예: 모더레이터가 "tools 가진 직원에게만
 * patch apply 위임") 도입 시 본 매트릭스가 잘못 흔들리면 라우팅이 silently
 * 부정확해진다. 본 테스트가 그 회귀를 차단한다.
 */
import { describe, it, expect } from 'vitest';

import {
  resolveApiCapabilities,
  resolveCliCapabilities,
  resolveLocalCapabilities,
} from '../capability-resolver';

describe('capability-resolver — API endpoint 별 매트릭스', () => {
  it('Anthropic Messages API → streaming + summarize + tools + multimodal', () => {
    const caps = resolveApiCapabilities('https://api.anthropic.com/v1/messages');
    expect(caps).toEqual(
      expect.arrayContaining(['streaming', 'summarize', 'tools', 'multimodal']),
    );
    expect(caps).not.toContain('json-mode');
    expect(caps).not.toContain('code-execution');
    expect(caps).not.toContain('resume');
  });

  it('OpenAI Chat Completions API → streaming + summarize + tools + multimodal + json-mode', () => {
    const caps = resolveApiCapabilities('https://api.openai.com/v1/chat/completions');
    expect(caps).toEqual(
      expect.arrayContaining([
        'streaming',
        'summarize',
        'tools',
        'multimodal',
        'json-mode',
      ]),
    );
    expect(caps).not.toContain('code-execution');
    expect(caps).not.toContain('resume');
  });

  it('Google generativelanguage → streaming + summarize + tools + multimodal (no json-mode)', () => {
    const caps = resolveApiCapabilities(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro',
    );
    expect(caps).toEqual(
      expect.arrayContaining(['streaming', 'summarize', 'tools', 'multimodal']),
    );
    expect(caps).not.toContain('json-mode');
    expect(caps).not.toContain('code-execution');
  });

  it('OpenRouter → streaming + summarize + tools (no multimodal/json-mode advertised)', () => {
    const caps = resolveApiCapabilities('https://openrouter.ai/api/v1/chat/completions');
    expect(caps).toEqual(expect.arrayContaining(['streaming', 'summarize', 'tools']));
    expect(caps).not.toContain('multimodal');
    expect(caps).not.toContain('json-mode');
    expect(caps).not.toContain('code-execution');
  });

  it('알 수 없는 OpenAI-compatible endpoint → 보수적 공통 능력만', () => {
    const caps = resolveApiCapabilities('https://my-private-proxy.example.com/v1');
    expect(caps).toEqual(['streaming', 'summarize']);
  });

  it('endpoint URL 대문자 / 경로 변형 — 매칭은 host 부분 lowercase 비교', () => {
    const upperCase = resolveApiCapabilities('HTTPS://API.ANTHROPIC.COM/v1/messages');
    const withTrailingPath = resolveApiCapabilities(
      'https://api.openai.com/v1/responses?stream=true',
    );
    expect(upperCase).toContain('tools');
    expect(upperCase).toContain('multimodal');
    expect(withTrailingPath).toContain('json-mode');
  });

  it('반환되는 array 는 immutable view — 내부 캐시 오염 차단', () => {
    const a = resolveApiCapabilities('https://api.anthropic.com');
    const b = resolveApiCapabilities('https://api.anthropic.com');
    a.push('code-execution');
    expect(b).not.toContain('code-execution');
  });
});

describe('capability-resolver — CLI 종류 별 매트릭스', () => {
  it('claude CLI → streaming + summarize + resume + tools + code-execution', () => {
    const caps = resolveCliCapabilities('claude');
    expect(caps).toEqual(
      expect.arrayContaining([
        'streaming',
        'summarize',
        'resume',
        'tools',
        'code-execution',
      ]),
    );
    expect(caps).not.toContain('multimodal');
    expect(caps).not.toContain('json-mode');
  });

  it('codex CLI → streaming + summarize + resume + tools + code-execution', () => {
    const caps = resolveCliCapabilities('codex');
    expect(caps).toEqual(
      expect.arrayContaining([
        'streaming',
        'summarize',
        'resume',
        'tools',
        'code-execution',
      ]),
    );
    expect(caps).not.toContain('multimodal');
  });

  it('gemini CLI → streaming + summarize + resume + tools (no code-execution)', () => {
    const caps = resolveCliCapabilities('gemini');
    expect(caps).toEqual(
      expect.arrayContaining(['streaming', 'summarize', 'resume', 'tools']),
    );
    expect(caps).not.toContain('code-execution');
    expect(caps).not.toContain('multimodal');
  });

  it('알 수 없는 CLI command → 보수적 공통 능력만', () => {
    const caps = resolveCliCapabilities('unknown-cli-baseline');
    expect(caps).toEqual(['streaming', 'summarize']);
  });

  it('반환되는 array 는 immutable view', () => {
    const a = resolveCliCapabilities('claude');
    const b = resolveCliCapabilities('claude');
    a.push('json-mode');
    expect(b).not.toContain('json-mode');
  });
});

describe('capability-resolver — local (Ollama) provider', () => {
  it('보수적 공통 능력만 (모델별 차이 광고 X)', () => {
    expect(resolveLocalCapabilities()).toEqual(['streaming', 'summarize']);
  });
});
