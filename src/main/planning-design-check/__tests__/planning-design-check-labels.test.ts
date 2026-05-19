/**
 * 결재 5번 (C, 2026-05-19) — planning-design-check dictionary 매트릭스 검증.
 *
 * 검증 대상:
 *   - 기본 locale ('ko') 에서 archive + prompt 모두 한국어
 *   - setMainLocale('en') 후 archive + prompt 모두 영어 매핑
 *   - 알 수 없는 locale → silently 'ko' fallback
 *   - 두 dictionary 의 shape (key 집합) 가 ko / en 사이 일치 — drift 가드
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  __resetMainLocaleForTests,
  setMainLocale,
} from '../../i18n/main-locale';
import {
  archiveLabels,
  promptLabels,
  getPlanningDesignCheckDictionary,
} from '../planning-design-check-labels';

afterEach(() => {
  __resetMainLocaleForTests();
});

beforeEach(() => {
  __resetMainLocaleForTests();
});

describe('planning-design-check-labels — ko default', () => {
  it('archive 헤더 한국어 매핑', () => {
    const labels = archiveLabels();
    expect(labels.headerH1).toBe('# 디자인 검수 요청서');
    expect(labels.sectionOriginalPlanningMinutes).toBe('## 원래 기획 회의록');
    expect(labels.sectionFinalDesignArtifacts).toBe('## 최종 디자인 산출물');
    expect(labels.sectionWireframeCheckpoints).toBe('## 와이어프레임 확인 기록');
    expect(labels.sectionUserWireframeNotes).toBe('## 사용자 와이어프레임 수정 지시');
    expect(labels.sectionFinalDesignBody).toBe('## 최종 디자인 회의록 본문');
    expect(labels.placeholderEmpty).toBe('(기록 없음)');
    expect(labels.placeholderNone).toBe('(없음)');
  });

  it('prompt 본문 한국어 매핑', () => {
    const labels = promptLabels();
    expect(labels.labelCurrentStep).toBe('[현재 단계: 기획 검수]');
    expect(labels.labelMission).toBe('[미션]');
    expect(labels.missionBodyLine1).toContain('디자인 검수 요청서');
    expect(labels.missionBodyLine1).toContain('판단하세요');
    expect(labels.responseFormatBody).toContain('JSON');
    expect(labels.jsonPlaceholderReason).toBe('<판단 근거>');
    expect(labels.chainResolverPromptLine).toContain('내부 검수');
  });
});

describe('planning-design-check-labels — en (결재 5번 다국어)', () => {
  it('setMainLocale("en") 후 archive 영어 매핑', () => {
    setMainLocale('en');
    const labels = archiveLabels();
    expect(labels.headerH1).toBe('# Design Review Request');
    expect(labels.sectionOriginalPlanningMinutes).toBe('## Original Planning Minutes');
    expect(labels.sectionWireframeCheckpoints).toBe('## Wireframe Checkpoints');
    expect(labels.placeholderEmpty).toBe('(no records)');
    expect(labels.placeholderNone).toBe('(none)');
    expect(labels.requestTitle).toBe('Design Review Request');
  });

  it('setMainLocale("en") 후 prompt 영어 매핑', () => {
    setMainLocale('en');
    const labels = promptLabels();
    expect(labels.labelCurrentStep).toBe('[Current step: Planning review]');
    expect(labels.labelMission).toBe('[Mission]');
    expect(labels.missionBodyLine1).toContain('design review request');
    expect(labels.responseFormatBody).toContain('JSON object');
    expect(labels.jsonPlaceholderReason).toBe('<reasoning>');
    expect(labels.chainResolverPromptLine).toContain('internally review');
  });

  it('ko → en → ko switch — toggling 정상 작동', () => {
    expect(archiveLabels().headerH1).toBe('# 디자인 검수 요청서');
    setMainLocale('en');
    expect(archiveLabels().headerH1).toBe('# Design Review Request');
    setMainLocale('ko');
    expect(archiveLabels().headerH1).toBe('# 디자인 검수 요청서');
  });
});

describe('planning-design-check-labels — drift 가드', () => {
  it('ko / en dictionary 의 key 집합 일치 (translation drift 차단)', () => {
    setMainLocale('ko');
    const ko = getPlanningDesignCheckDictionary();
    setMainLocale('en');
    const en = getPlanningDesignCheckDictionary();
    expect(Object.keys(en.archive).sort()).toEqual(Object.keys(ko.archive).sort());
    expect(Object.keys(en.prompt).sort()).toEqual(Object.keys(ko.prompt).sort());
  });

  it('알 수 없는 locale → silently ko fallback (main-locale clamp)', () => {
    setMainLocale('xx' as 'ko' | 'en');
    expect(archiveLabels().headerH1).toBe('# 디자인 검수 요청서');
  });
});

describe('main-locale state', () => {
  it('기본 locale = ko', async () => {
    const { getMainLocale } = await import('../../i18n/main-locale');
    expect(getMainLocale()).toBe('ko');
  });

  it('setMainLocale 후 갱신 + reset 후 ko 복원', async () => {
    const { getMainLocale, setMainLocale: setLocale, __resetMainLocaleForTests: reset } =
      await import('../../i18n/main-locale');
    setLocale('en');
    expect(getMainLocale()).toBe('en');
    reset();
    expect(getMainLocale()).toBe('ko');
  });
});
