import { beforeAll, describe, expect, it } from 'vitest';

import { failureCauseText } from '../failure-cause-text';
import { i18next } from '../../../i18n';

const t = i18next.t.bind(i18next);

beforeAll(async () => { await i18next.changeLanguage('ko'); });

describe('failureCauseText (spec 2026-10-08 F3)', () => {
  it('writes every cause as a ko sentence, with markers after it as (원인: …)', () => {
    expect(failureCauseText(t, 'key-missing', null))
      .toBe('이 AI의 API 키가 저장되어 있지 않아요. 설정 > AI에서 API 키를 다시 넣어 주세요.');
    expect(failureCauseText(t, 'auth', 'HTTP 401'))
      .toBe('API 키가 거절됐어요. 키가 만료됐거나 잘못됐을 수 있어요. 설정 > AI에서 키를 바꿔 주세요. (원인: HTTP 401)');
    expect(failureCauseText(t, 'rate-limited', 'HTTP 429'))
      .toBe('요청이 너무 잦아 AI 서비스가 잠시 막았어요. 잠시 뒤에 다시 보내 주세요. (원인: HTTP 429)');
    expect(failureCauseText(t, 'service-busy', 'HTTP 503'))
      .toBe('AI 서비스가 지금 붐벼서 응답하지 못했어요. 잠시 뒤에 다시 보내 주세요. (원인: HTTP 503)');
    expect(failureCauseText(t, 'request-rejected', 'HTTP 400'))
      .toBe('AI 서비스가 요청을 받아들이지 않았어요. 설정 > AI에서 모델 이름이 맞는지 확인해 주세요. (원인: HTTP 400)');
    expect(failureCauseText(t, 'http-error', 'HTTP 500')).toBe('AI 서비스가 오류로 응답했어요. (원인: HTTP 500)');
    expect(failureCauseText(t, 'network', 'ENOTFOUND'))
      .toBe('AI 서비스에 연결하지 못했어요. 인터넷 연결이나 서버 주소를 확인해 주세요. (원인: ENOTFOUND)');
    expect(failureCauseText(t, 'local-not-running', null))
      .toBe('로컬 AI 서버(예: Ollama)가 꺼져 있어요. 서버를 켠 뒤 다시 보내 주세요.');
    expect(failureCauseText(t, 'local-model-missing', 'gemma4:e4b'))
      .toBe('로컬 AI 서버에 gemma4:e4b 모델이 없어요. 모델을 내려받거나 설정 > AI에서 모델을 바꿔 주세요.');
    expect(failureCauseText(t, 'cli-login-required', 'claude'))
      .toBe('Claude Code 로그인이 만료됐거나 로그인되어 있지 않아요. 터미널에서 claude auth login 를 실행해 다시 로그인한 뒤 메시지를 다시 보내 주세요.');
    expect(failureCauseText(t, 'cli-not-found', 'codex'))
      .toBe('Codex 프로그램을 찾지 못했어요. 설치되어 있는지, 터미널에서 실행되는지 확인해 주세요.');
    expect(failureCauseText(t, 'cli-failed', 'claude'))
      .toBe('Claude Code 실행이 실패했어요. 자세한 원인은 앱 기록(로그)에 남겼어요.');
  });

  it('leaves the marker off when there is none, and never shows one for key-missing or a stopped server', () => {
    expect(failureCauseText(t, 'service-busy', null)).toBe('AI 서비스가 지금 붐벼서 응답하지 못했어요. 잠시 뒤에 다시 보내 주세요.');
    expect(failureCauseText(t, 'key-missing', 'ignored')).not.toContain('ignored');
    expect(failureCauseText(t, 'local-not-running', 'ignored')).not.toContain('ignored');
  });

  it('uses the codex login command and the generic CLI name for an unknown key', () => {
    expect(failureCauseText(t, 'cli-login-required', 'codex')).toContain('codex login');
    expect(failureCauseText(t, 'cli-login-required', 'gemini'))
      .toBe('CLI 로그인이 만료됐거나 로그인되어 있지 않아요. 터미널에서 다시 로그인한 뒤 메시지를 다시 보내 주세요.');
    expect(failureCauseText(t, 'cli-login-required', null)).toContain('CLI 로그인이');
    expect(failureCauseText(t, 'cli-failed', null)).toBe('CLI 실행이 실패했어요. 자세한 원인은 앱 기록(로그)에 남겼어요.');
  });
});
