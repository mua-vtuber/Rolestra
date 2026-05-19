/**
 * planning-design-check 영역의 영구 보관 markdown + LLM prompt 다국어 dictionary.
 *
 * 결재 5번 (C, 2026-05-19) — archive markdown 본문 + LLM prompt 본문 모두
 * 사용자 언어 따라 작성. 영어 사용자는 archive 파일을 영어로 열어보고, LLM
 * 도 영어 prompt → 영어 응답 매트릭스로 작동.
 *
 * Locale resolver 는 `main-locale.getMainLocale()` 가 단일 source. 향후 신규
 * dictionary 모듈도 같은 source 를 공유해 process-wide 일관성 유지.
 *
 * Why two namespaces (`archive.*` + `prompt.*`):
 *   - archive 는 *결정 시점의 사용자 언어로 박힌 영구 markdown* — 한 번 만든
 *     파일은 나중에 사용자 언어 바뀌어도 그대로 (i18n 의 "snapshot" 의미).
 *   - prompt 는 *매 회의 turn 마다 새 작성되는 LLM 입력* — 사용자 언어 바뀌면
 *     다음 turn 부터 새 언어로 prompt 작성, LLM 도 새 언어로 응답.
 *
 * 영문 번역 정확성: 본 라운드는 기계 번역 수준. native 영어 사용자가 도입될
 * 때 (현 단계 거의 없음 — memory 추천 (A) 참조) 자연어 검수 후 갱신 권장.
 */

import { getMainLocale, type MainLocale } from '../i18n/main-locale';

// ── Dictionary shape ─────────────────────────────────────────────────

interface PlanningDesignCheckDictionary {
  archive: {
    requestTitle: string;
    /** Heading: `# 디자인 검수 요청서` */
    headerH1: string;
    /** Field label: `되돌림 횟수: {N}` */
    returnCountLabel: string;
    sectionOriginalPlanningMinutes: string;
    sectionFinalDesignArtifacts: string;
    sectionWireframeCheckpoints: string;
    sectionUserWireframeNotes: string;
    sectionFinalDesignBody: string;
    metaMeetingId: string;
    metaPath: string;
    metaFinalDesignMinutes: string;
    metaDesktopSnapshot: string;
    metaMobileSnapshot: string;
    /** "(기록 없음)" — wireframe checkpoint 빈 경우. */
    placeholderEmpty: string;
    /** "(없음)" — user wireframe notes 빈 경우. */
    placeholderNone: string;
    /** "원래 기획 회의록 컨텍스트가 없습니다." */
    missingPlanningContextDefault: string;
    /** "찾지 못함: {reason}" prefix. */
    notFoundPrefix: string;
  };
  prompt: {
    /** "[현재 단계: 기획 검수]" 라벨. */
    labelCurrentStep: string;
    /** "[미션]" 라벨. */
    labelMission: string;
    /** "[디자인 검수 요청서]" 라벨. */
    labelDesignReviewRequest: string;
    /** "[응답 형식]" 라벨. */
    labelResponseFormat: string;
    /** "디자인 검수 요청서를 읽고 최종 디자인이..." 본문 line 1. */
    missionBodyLine1: string;
    /** "사용자 공식 승인/반려가 아니라..." 본문 line 2. */
    missionBodyLine2: string;
    /** "응답은 JSON 한 객체만 작성하세요..." */
    responseFormatBody: string;
    /** "<판단 근거>" JSON 주석 placeholder. */
    jsonPlaceholderReason: string;
    /** "<misaligned일 때 디자인 재작업 방향>" JSON 주석 placeholder. */
    jsonPlaceholderRevision: string;
    /** handoff-chain-resolver 의 prompt body 첫 라인. */
    chainResolverPromptLine: string;
    /** handoff-chain-resolver 의 prompt body 둘째 라인 (검수 의미 명확화). */
    chainResolverPromptSecondLine: string;
    /** "[최종 디자인 회의록]" 라벨 (handoff-chain-resolver). */
    chainResolverFinalDesignMinutesLabel: string;
    /** handoff-chain-resolver expectedOutputs 1. */
    chainResolverExpectedAlignment: string;
    /** handoff-chain-resolver expectedOutputs 2. */
    chainResolverExpectedRevision: string;
    /** handoff-chain-resolver userMessage. */
    chainResolverUserMessage: string;
    /** handoff-chain-resolver handoff reason. */
    chainResolverHandoffReason: string;
    /** implementation handoff body 도입부. */
    implementationHandoffIntro: string;
    /** "기획 검수 판단 근거: {reason}" prefix. */
    planningReviewReasonPrefix: string;
    /** "기획 검수 판단 근거: 의도에 맞음" (reason null 일 때). */
    planningReviewReasonFallback: string;
    /** "최종 디자인 산출물을 기준으로 한 구현 계획" expectedOutputs entry. */
    expectedOutputImplementationPlan: string;
    /** "구현 부서가 이어받을 작업 단위와 검증 기준" expectedOutputs entry. */
    expectedOutputHandoffUnits: string;
    /** "기획 검수에서 의도에 맞음으로 확인된 디자인을 구현 부서로 인계합니다." userMessage. */
    implementationHandoffUserMessage: string;
  };
}

// ── ko (default) ─────────────────────────────────────────────────────

const KO: PlanningDesignCheckDictionary = {
  archive: {
    requestTitle: '디자인 검수 요청서',
    headerH1: '# 디자인 검수 요청서',
    returnCountLabel: '되돌림 횟수',
    sectionOriginalPlanningMinutes: '## 원래 기획 회의록',
    sectionFinalDesignArtifacts: '## 최종 디자인 산출물',
    sectionWireframeCheckpoints: '## 와이어프레임 확인 기록',
    sectionUserWireframeNotes: '## 사용자 와이어프레임 수정 지시',
    sectionFinalDesignBody: '## 최종 디자인 회의록 본문',
    metaMeetingId: '회의 ID',
    metaPath: '경로',
    metaFinalDesignMinutes: '최종 디자인 회의록',
    metaDesktopSnapshot: '데스크톱 스냅샷',
    metaMobileSnapshot: '모바일 스냅샷',
    placeholderEmpty: '(기록 없음)',
    placeholderNone: '(없음)',
    missingPlanningContextDefault: '원래 기획 회의록 컨텍스트가 없습니다.',
    notFoundPrefix: '찾지 못함',
  },
  prompt: {
    labelCurrentStep: '[현재 단계: 기획 검수]',
    labelMission: '[미션]',
    labelDesignReviewRequest: '[디자인 검수 요청서]',
    labelResponseFormat: '[응답 형식]',
    missionBodyLine1:
      '디자인 검수 요청서를 읽고 최종 디자인이 원래 기획 의도와 사용자 와이어프레임 수정 지시에 맞는지 판단하세요.',
    missionBodyLine2: '사용자 공식 승인/반려가 아니라 기획 부서 내부 검수입니다.',
    responseFormatBody:
      '응답은 JSON 한 객체만 작성하세요. verdict 는 aligned 또는 misaligned 중 하나입니다.',
    jsonPlaceholderReason: '<판단 근거>',
    jsonPlaceholderRevision: '<misaligned일 때 디자인 재작업 방향>',
    chainResolverPromptLine:
      '디자인 검수 요청서를 읽고 최종 디자인이 기획 의도에 맞는지 내부 검수하세요.',
    chainResolverPromptSecondLine:
      '이 단계는 사용자 공식 승인/반려가 아니라 기획 검수입니다.',
    chainResolverFinalDesignMinutesLabel: '[최종 디자인 회의록]',
    chainResolverExpectedAlignment: '의도에 맞음 또는 의도와 다름 판단',
    chainResolverExpectedRevision: '의도와 다름일 때 디자인 재작업 방향',
    chainResolverUserMessage:
      '디자인 결과를 구현으로 보내기 전에 기획 의도와 맞는지 검수하세요.',
    chainResolverHandoffReason:
      '디자인 결과 완료 — 구현 전 기획 검수로 자동 인계합니다.',
    implementationHandoffIntro:
      '기획 검수에서 의도에 맞음으로 판정된 디자인을 구현 가능한 작업으로 착수하세요.',
    planningReviewReasonPrefix: '기획 검수 판단 근거',
    planningReviewReasonFallback: '기획 검수 판단 근거: 의도에 맞음',
    expectedOutputImplementationPlan: '최종 디자인 산출물을 기준으로 한 구현 계획',
    expectedOutputHandoffUnits: '구현 부서가 이어받을 작업 단위와 검증 기준',
    implementationHandoffUserMessage:
      '기획 검수에서 의도에 맞음으로 확인된 디자인을 구현 부서로 인계합니다.',
  },
};

// ── en (machine-quality, awaiting native review) ─────────────────────

const EN: PlanningDesignCheckDictionary = {
  archive: {
    requestTitle: 'Design Review Request',
    headerH1: '# Design Review Request',
    returnCountLabel: 'Return count',
    sectionOriginalPlanningMinutes: '## Original Planning Minutes',
    sectionFinalDesignArtifacts: '## Final Design Artifacts',
    sectionWireframeCheckpoints: '## Wireframe Checkpoints',
    sectionUserWireframeNotes: '## User Wireframe Revisions',
    sectionFinalDesignBody: '## Final Design Minutes Body',
    metaMeetingId: 'Meeting ID',
    metaPath: 'Path',
    metaFinalDesignMinutes: 'Final design minutes',
    metaDesktopSnapshot: 'Desktop snapshot',
    metaMobileSnapshot: 'Mobile snapshot',
    placeholderEmpty: '(no records)',
    placeholderNone: '(none)',
    missingPlanningContextDefault: 'Original planning minutes context is unavailable.',
    notFoundPrefix: 'Not found',
  },
  prompt: {
    labelCurrentStep: '[Current step: Planning review]',
    labelMission: '[Mission]',
    labelDesignReviewRequest: '[Design Review Request]',
    labelResponseFormat: '[Response format]',
    missionBodyLine1:
      'Read the design review request and judge whether the final design matches the original planning intent and the user wireframe revision instructions.',
    missionBodyLine2:
      'This is an internal planning review, not a user approval/rejection.',
    responseFormatBody:
      'Reply with a single JSON object only. The verdict must be either "aligned" or "misaligned".',
    jsonPlaceholderReason: '<reasoning>',
    jsonPlaceholderRevision: '<design rework direction when misaligned>',
    chainResolverPromptLine:
      'Read the design review request and internally review whether the final design matches the planning intent.',
    chainResolverPromptSecondLine:
      'This step is an internal planning review, not a user-level approval/rejection.',
    chainResolverFinalDesignMinutesLabel: '[Final Design Minutes]',
    chainResolverExpectedAlignment: 'Verdict: aligned with intent or diverging from intent',
    chainResolverExpectedRevision:
      'When diverging from intent, the direction of design rework',
    chainResolverUserMessage:
      'Before sending the design to implementation, review whether it matches the planning intent.',
    chainResolverHandoffReason:
      'Design result complete — auto-handed off to planning review before implementation.',
    implementationHandoffIntro:
      'Start implementing the design that the planning review judged aligned with the intent.',
    planningReviewReasonPrefix: 'Planning review reasoning',
    planningReviewReasonFallback: 'Planning review reasoning: aligned with intent',
    expectedOutputImplementationPlan:
      'Implementation plan based on the final design artifacts',
    expectedOutputHandoffUnits:
      'Work units and verification criteria for the implementation team to pick up',
    implementationHandoffUserMessage:
      'Handing off the planning-reviewed (aligned) design to the implementation team.',
  },
};

const DICTIONARIES: Record<MainLocale, PlanningDesignCheckDictionary> = {
  ko: KO,
  en: EN,
};

/**
 * Returns the planning-design-check dictionary for the current main-process
 * locale. Unknown locales (should not happen — main-locale setter clamps)
 * fall through to ko.
 */
export function getPlanningDesignCheckDictionary(): PlanningDesignCheckDictionary {
  const locale = getMainLocale();
  return DICTIONARIES[locale] ?? KO;
}

/** Convenience accessor for `archive.*` keys. */
export function archiveLabels(): PlanningDesignCheckDictionary['archive'] {
  return getPlanningDesignCheckDictionary().archive;
}

/** Convenience accessor for `prompt.*` keys. */
export function promptLabels(): PlanningDesignCheckDictionary['prompt'] {
  return getPlanningDesignCheckDictionary().prompt;
}
