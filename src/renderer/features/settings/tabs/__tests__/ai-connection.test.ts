import { describe, expect, it } from 'vitest';

import { i18next } from '../../../../i18n';
import { describeConnection, describeStatus } from '../ai/ai-connection';
import type { ProviderConfig } from '../../../../../shared/provider-types';

const t = i18next.getFixedT('ko');

const cli = (command: string, wslDistro?: string): ProviderConfig => ({
  type: 'cli', command, args: [], inputFormat: 'stdin-json', outputFormat: 'stream-json',
  sessionStrategy: 'persistent', hangTimeout: { first: 1, subsequent: 1 }, model: 'unknown',
  ...(wslDistro === undefined ? {} : { wslDistro }),
});

describe('describeConnection', () => {
  it('names a known CLI by product, an unknown one by its command', () => {
    expect(describeConnection(t, cli('C:\\npm\\claude.cmd'))).toBe('Claude Code · CLI');
    expect(describeConnection(t, cli('/usr/bin/codex', 'Ubuntu'))).toBe('Codex · CLI (WSL: Ubuntu)');
    expect(describeConnection(t, cli('/opt/other-cli'))).toBe('other-cli · CLI');
  });

  it('names the API model and the company of an official endpoint', () => {
    expect(describeConnection(t, {
      type: 'api', endpoint: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyRef: 'provider-x', model: 'gemini-2.5-flash',
    })).toBe('gemini-2.5-flash · API (Google)');
  });

  it('names an OpenAI-compatible endpoint by its address, never a guessed company', () => {
    expect(describeConnection(t, {
      type: 'api', endpoint: 'http://127.0.0.1:8080/v1', apiKeyRef: 'provider-x', model: 'm',
    })).toBe('m · API (127.0.0.1:8080)');
  });

  it('names a local model by its server address', () => {
    expect(describeConnection(t, { type: 'local', baseUrl: 'http://localhost:11434', model: 'gemma4:e4b' }))
      .toBe('gemma4:e4b · 로컬 (localhost:11434)');
  });

  // 2026-10-01 user decision: "로컬 (Ollama)" only with evidence — main sets
  // `confirmedServer` after Ollama's own endpoint answered during the add.
  it('says Ollama only for a local AI main confirmed as Ollama', () => {
    expect(describeConnection(t, {
      type: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:e4b', confirmedServer: 'ollama',
    })).toBe('gemma4:e4b · 로컬 (Ollama)');
    expect(describeConnection(t, { type: 'local', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:e4b' }))
      .toBe('gemma4:e4b · 로컬 (127.0.0.1:11434)');
  });
});

describe('describeStatus', () => {
  it('a connected AI needs no action', () => {
    expect(describeStatus(t, 'online', null, null)).toEqual({
      label: '연결됨', tone: 'ok', hint: null, canReconnect: false,
    });
  });

  // QA Medium-1: the hint is the cause main's check found, not a fixed tip.
  it('an unreachable AI shows the cause the last check found, with a reconnect action', () => {
    const rejected = describeStatus(t, 'offline-connection', null, { code: 'auth', detail: 'HTTP 401' });
    expect(rejected.tone).toBe('problem');
    expect(rejected.canReconnect).toBe(true);
    expect(rejected.hint).toContain('API 키');
    expect(rejected.hint).toContain('HTTP 401');
    expect(describeStatus(t, 'offline-connection', cli('claude'), { code: 'cli-not-found', detail: 'ENOENT' }).hint)
      .toContain('Claude Code');
    expect(describeStatus(t, 'offline-connection', null, { code: 'local-model-missing', detail: 'gemma4:e4b' }).hint)
      .toContain('gemma4:e4b');
    expect(describeStatus(t, 'offline-connection', null, { code: 'network', detail: 'ECONNREFUSED' }).hint)
      .toContain('ECONNREFUSED');
  });

  it('says the connection has not been checked yet when no check has run', () => {
    const unchecked = describeStatus(t, 'offline-connection', null, null);
    expect(unchecked.hint).toBe('아직 연결을 확인하지 않았습니다.');
    expect(unchecked.canReconnect).toBe(true);
  });

  it('a manually turned-off AI can be reconnected', () => {
    expect(describeStatus(t, 'offline-manual', null, null).canReconnect).toBe(true);
  });
});
