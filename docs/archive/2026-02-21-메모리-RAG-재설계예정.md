# 메모리/RAG 시스템 재설계 명세서

> 기반: 리뷰(`docs/reviews/memory-rag-review.md`) + 합의된 6대 원칙 + 추가 요구사항
> 작성일: 2026-02-15

---

## 0. 설계 원칙 (합의 사항)

| # | 원칙 | 메모리 시스템에서의 의미 |
|---|------|------------------------|
| 1 | 코드 품질 우선 | "올바른 정보를 저장하고 올바른 정보를 반환하는가" = 데이터 품질 포함 |
| 2 | 구조적 효율 | Facade setter 패턴 → **파이프라인 패턴** 전환 |
| 3 | 하드코딩 금지 | MemoryConfig 확장 + 프롬프트 템플릿 설정화 |
| 4 | 오류 가시화 | silent fallback 제거 → 구조화 로깅 + 사용자 알림 채널 |
| 5 | 필요 시 재작성 | extractor, assembler, facade 구조 재작성 |
| 6 | 오류에도 진행 | 단, 마이그레이션은 forward-only 예외 |

---

## 1. 현재 구조 vs 목표 구조

### 현재 (평면 단방향)

```
[저장] 메시지 → RegexExtractor → storeNode → 끝
[검색] 질문 → Retriever(FTS+Vector+Graph) → Assembler(bullet list) → 끝
```

### 목표 (다단계 파이프라인)

```
[저장 파이프라인]
메시지 → 발화자 귀속 → 추출(Regex|LLM) → 정제 → 재언급 탐지 → 충돌 검사 → 저장

[검색 파이프라인]
질문 → 검색 게이트 → 하이브리드 검색 → 리랭킹 → 컨텍스트 조립 → 프레임 주입
```

---

## 2. 파이프라인 아키텍처

### 2.1 파이프라인 인터페이스

Facade의 optional setter 패턴을 **스테이지 체인**으로 교체한다.

```typescript
/** 파이프라인 스테이지 공통 인터페이스 */
interface PipelineStage<TIn, TOut> {
  readonly name: string;
  execute(input: TIn): Promise<TOut>;
}

/** 파이프라인 빌더 — 스테이지를 순서대로 연결 */
class Pipeline<TIn, TOut> {
  private stages: PipelineStage<any, any>[] = [];

  addStage<TNext>(stage: PipelineStage<TOut, TNext>): Pipeline<TIn, TNext>;
  async execute(input: TIn): Promise<TOut>;
}
```

### 2.2 저장 파이프라인 스테이지

```
┌─────────────────┐
│ ParticipantTagger│ ← 발화자 ID 귀속
└────────┬────────┘
         ▼
┌─────────────────┐
│ ExtractionStage │ ← Regex 또는 LLM (Strategy 패턴)
└────────┬────────┘
         ▼
┌─────────────────┐
│ RefinementStage │ ← 원문 → 정제된 팩트 문장으로 변환
└────────┬────────┘
         ▼
┌─────────────────┐
│ RementiionDetect│ ← 기존 노드와 비교, mention_count++
└────────┬────────┘
         ▼
┌─────────────────┐
│ ConflictChecker │ ← 모순 탐지 (contradicts edge 생성)
└────────┬────────┘
         ▼
┌─────────────────┐
│ StorageStage    │ ← dedup + DB write + FTS sync + 비동기 임베딩
└─────────────────┘
```

### 2.3 검색 파이프라인 스테이지

```
┌─────────────────┐
│ RetrievalGate   │ ← 질문이 메모리 검색이 필요한지 판정
└────────┬────────┘
         ▼
┌─────────────────┐
│ HybridSearch    │ ← FTS5 + Vector(ANN) + Graph BFS
└────────┬────────┘
         ▼
┌─────────────────┐
│ Reranker        │ ← Stanford 3-factor + 재언급 부스트
└────────┬────────┘
         ▼
┌─────────────────┐
│ ContextAssemble │ ← 토큰 예산 내 조립 (모델별 동적 예산)
└─────────────────┘
```

---

## 3. 모듈별 재설계 상세

### 3.1 Extraction — 전략 패턴으로 전환

**현재 문제**: 40개 미만 regex, 첫 매칭만 취함, 발화자 무시, 원문 그대로 저장.

**새 설계**:

```typescript
interface ExtractionStrategy {
  extract(messages: AnnotatedMessage[]): Promise<ExtractionItem[]>;
}

/** Phase 3-a: regex only (LLM 미설정 시 폴백) */
class RegexStrategy implements ExtractionStrategy { ... }

/** Phase 3-b: LLM 구조화 추출 (설정 시 regex 대체) */
class LlmStrategy implements ExtractionStrategy { ... }
```

**전환 규칙**: LLM provider가 설정되면 LLM만 사용. Regex는 LLM의 하위 호환이므로 병행 불필요.

```typescript
// facade 또는 파이프라인 빌더에서
const strategy = config.extractionLlmProviderId
  ? new LlmStrategy(llmFn)
  : new RegexStrategy();
```

**LlmStrategy 추출 프롬프트 구조**:

```
시스템: "대화에서 사실/결정/선호/기술 사항을 구조화된 JSON으로 추출하라"
입력: 발화자 태그가 붙은 메시지 배열
출력: [{ content, nodeType, topic, importance, participantId }]
```

### 3.2 Refinement — 원문 → 정제된 팩트

**현재 문제**: 원문 문장을 그대로 `content`에 저장. "그건 React로 하는 게 맞을 것 같아요" 같은 구어체가 메모리에 쌓임.

**새 설계**: LLM 추출 시 정제된 형태로 반환하도록 프롬프트에 포함. Regex 모드에서는 원문 유지 (정제 불가).

```
원문: "아 그건 React로 가는 게 낫지 않을까요? SSR도 되고"
정제: "프론트엔드 프레임워크로 React 선택 (SSR 지원 고려)"
```

### 3.3 Re-mention Detection — 재언급 탐지

**신규 컬럼** (`004-memory-enhancement.ts` 마이그레이션):

```sql
ALTER TABLE knowledge_nodes ADD COLUMN participant_id TEXT;
ALTER TABLE knowledge_nodes ADD COLUMN last_mentioned_at DATETIME;
ALTER TABLE knowledge_nodes ADD COLUMN mention_count INTEGER DEFAULT 0;
ALTER TABLE knowledge_nodes ADD COLUMN confidence REAL DEFAULT 0.5;
```

**탐지 로직**:

```
새 추출 항목에 대해:
  1. dedupe_key 완전 일치 → 중복 (저장 안 함), mention_count++
  2. FTS 검색으로 유사 노드 탐색 (Phase 3-a)
     또는 cosine similarity > 0.85 (Phase 3-b)
     → 재언급으로 판정, mention_count++, last_mentioned_at 갱신
  3. 매칭 없음 → 신규 노드 저장
```

**mention_count → importance 반영**:

```typescript
// 재언급 시 importance 부스트 (상한 1.0)
const boost = Math.min(0.1, 0.05 * mentionCount);
newImportance = Math.min(1.0, currentImportance + boost);
```

### 3.4 Conflict Detection — 모순 탐지

**현재 문제**: `contradicts` edge 타입이 정의만 되어 있고 생성 경로 없음.

**새 설계**: 저장 파이프라인의 마지막 검증 스테이지.

```
새 노드 "Vue.js로 결정" 저장 시:
  1. 같은 topic의 기존 decision 노드 검색
  2. 기존에 "React로 결정" 발견
  3. 두 노드 간 contradicts edge 생성
  4. 새 노드에 supersedes edge도 생성 (시간 순서 기반)
  5. (선택) 이전 노드 importance 감소
```

Phase 3-a에서는 같은 topic + 같은 node_type의 decision 노드 간 키워드 비교.
Phase 3-b에서는 LLM에 모순 판정을 요청.

### 3.5 Retrieval Gate — 검색 필요성 판정

**현재 문제**: 모든 질문에 대해 무조건 메모리 검색. 단순 인사("안녕하세요")에도 검색 실행.

**새 설계**:

```typescript
class RetrievalGate implements PipelineStage<SearchInput, SearchInput | null> {
  async execute(input: SearchInput): Promise<SearchInput | null> {
    // 짧은 질문(< 5 tokens), 인사, 명령어 등은 검색 스킵
    if (this.shouldSkip(input.query)) return null;
    return input;
  }
}
```

Phase 3-a: 규칙 기반 (길이, 키워드). Phase 3-b: LLM 판정.

### 3.6 Vector Search — ANN 인덱스 (P0)

**현재 문제**: 모든 임베딩 노드를 SELECT → JS에서 cosine similarity. O(n) 전수 스캔.

**대책**: sqlite-vec 확장 도입.

```sql
-- 004-memory-enhancement.ts 마이그레이션에서
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding float[1536]
);
```

```typescript
// retriever.ts vectorSearch 교체
private async vectorSearch(query: string, topic: MemoryTopic | undefined, limit: number) {
  const queryVec = await this.embeddingService.embedText(query);
  if (!queryVec) return new Map();

  const blob = EmbeddingService.vectorToBlob(queryVec);

  // sqlite-vec: ANN 검색 (기존: JS 전수 비교)
  const rows = this.db.prepare(`
    SELECT kv.node_id, kv.distance, kn.*
    FROM knowledge_vec kv
    JOIN knowledge_nodes kn ON kn.id = kv.node_id
    WHERE kv.embedding MATCH ?
      AND kn.deleted_at IS NULL
      ${topic ? 'AND kn.topic = ?' : ''}
    ORDER BY kv.distance
    LIMIT ?
  `).all(blob, ...(topic ? [topic] : []), limit) as NodeRow[];

  // ... 3-factor scoring 적용
}
```

**임베딩 저장 이중 기록**: `knowledge_nodes.embedding` + `knowledge_vec.embedding` 양쪽에 저장. vec 테이블은 검색 전용, nodes 테이블은 evolver 등 직접 비교 시 사용.

**폴백**: sqlite-vec 로드 실패 시 현재 JS 전수 스캔으로 자동 폴백 (경고 로그 출력).

### 3.7 Assembler — 모델별 동적 예산

**현재 문제**: `contextTotalBudget: 4096` 고정. 현대 LLM(128K+)에 비해 보수적.

**새 설계**:

```typescript
interface ContextBudgetConfig {
  /** 총 예산 (모델별 동적 설정) */
  totalBudget: number;
  /** 비율은 유지하되 adaptation 가능 */
  ratios: ContextBudgetRatios;
  /** 토큰 추정 안전 마진 (기본 0.9 = 90%만 사용) */
  safetyMargin: number;
}
```

모델 등록 시 `contextWindow` 값을 제공하면, 그 값의 일정 비율(e.g., 25%)을 메모리 예산으로 자동 배분.

---

## 4. 스키마 마이그레이션

파일: `src/main/database/migrations/004-memory-enhancement.ts`

```sql
-- 발화자 귀속
ALTER TABLE knowledge_nodes ADD COLUMN participant_id TEXT;

-- 재언급 추적
ALTER TABLE knowledge_nodes ADD COLUMN last_mentioned_at DATETIME;
ALTER TABLE knowledge_nodes ADD COLUMN mention_count INTEGER DEFAULT 0;

-- 신뢰도 (LLM 추출 시 confidence 반영)
ALTER TABLE knowledge_nodes ADD COLUMN confidence REAL DEFAULT 0.5;

-- participant_id 인덱스 (AI별 필터링)
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_participant
  ON knowledge_nodes(participant_id) WHERE deleted_at IS NULL;

-- mention_count 인덱스 (재언급 순 정렬)
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_mention
  ON knowledge_nodes(mention_count DESC) WHERE deleted_at IS NULL;

-- sqlite-vec 가상 테이블 (ANN 벡터 검색)
-- 주의: sqlite-vec 확장이 로드된 경우에만 생성
-- 확장 미로드 시 이 문은 건너뛴다 (조건부 실행)
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
  node_id TEXT PRIMARY KEY,
  embedding float[1536]
);
```

**호환성**: 기존 노드는 `participant_id = NULL`, `mention_count = 0`, `confidence = 0.5`로 동작. 새 필드가 없어도 기존 쿼리 전부 정상.

---

## 5. MemoryConfig 확장

현재 하드코딩된 값들을 config로 승격:

```typescript
interface MemoryConfig {
  // ... 기존 필드 유지 ...

  // ── 신규: 하드코딩 제거 ──────────────────────
  /** 핀 시 importance 부스트량 (기존 0.2 하드코딩) */
  pinImportanceBoost: number;          // default: 0.2
  /** 핀 노드의 기본 importance (기존 0.7 하드코딩) */
  pinDefaultImportance: number;        // default: 0.7
  /** 검색 시 핀 노드 score 부스트 배율 (기존 1.2 하드코딩) */
  pinSearchBoost: number;              // default: 1.2
  /** FTS relevance 하한 (기존 0.3 하드코딩) */
  ftsRelevanceFloor: number;           // default: 0.3
  /** importance >= 이 값이면 [중요] 마커 (기존 0.8 하드코딩) */
  importanceHighThreshold: number;     // default: 0.8
  /** Graph hop decay 계수 (기존 0.7 하드코딩) */
  graphHopDecay: number;               // default: 0.7
  /** Reflection 최소 그룹 크기 (기존 3 하드코딩) */
  reflectionMinGroupSize: number;      // default: 3
  /** 토큰 추정 안전 마진 (기존 없음) */
  tokenSafetyMargin: number;           // default: 0.9

  // ── 신규: 추출 설정 ─────────────────────────
  /** LLM extraction provider ID (null이면 regex 사용) */
  extractionLlmProviderId: string | null;  // default: null
  /** 카테고리별 기본 importance */
  categoryImportance: Record<PatternCategory, number>;

  // ── 신규: 재언급 설정 ───────────────────────
  /** 재언급 시 importance 부스트 (회당) */
  mentionBoostPerCount: number;        // default: 0.05
  /** 재언급 부스트 상한 */
  mentionBoostCap: number;             // default: 0.1

  // ── 신규: 프롬프트 템플릿 ────────────────────
  /** 메모리 컨텍스트 헤더 (기존 '[관련 기억]' 하드코딩) */
  memoryContextHeader: string;         // default: '[관련 기억]'
  /** 중요 마커 텍스트 (기존 ' [중요]' 하드코딩) */
  importanceMarkerText: string;        // default: ' [중요]'
}
```

---

## 6. 오류 처리 재설계

### 현재: Silent Fallback

```typescript
// 5곳에서 catch { } 또는 catch { return 빈값 }
```

### 목표: 가시적 알림

```typescript
/** 메모리 시스템 이벤트 (로깅 + UI 알림 공용) */
type MemoryEventType =
  | 'embedding_failed'
  | 'fts_query_failed'
  | 'reflection_failed'
  | 'extraction_failed'
  | 'vector_search_fallback';

interface MemoryEvent {
  type: MemoryEventType;
  message: string;
  nodeId?: string;
  error?: Error;
  timestamp: string;
}

/** 이벤트 emitter — 로거와 UI 상태바에 연결 */
class MemoryEventBus {
  emit(event: MemoryEvent): void;
  on(type: MemoryEventType, handler: (event: MemoryEvent) => void): void;
}
```

**적용 규칙**:

| 위치 | 현재 | 변경 |
|------|------|------|
| `embedAndUpdate` catch | 완전 무시 | `emit('embedding_failed')` + 재시도 큐 |
| `retriever.ts` FTS catch | 빈 Map 반환 | `emit('fts_query_failed')` + 빈 Map 반환 (검색은 계속) |
| `reflector.ts` LLM catch | `continue` | `emit('reflection_failed')` + continue |
| `evolve()` evolver 없음 | `{0,0}` 반환 | 정상 동작 (evolver 미설정은 에러가 아님) |
| sqlite-vec 로드 실패 | N/A (신규) | `emit('vector_search_fallback')` + JS 전수 스캔으로 폴백 |

**비동기 작업(embedAndUpdate) 규칙**: throw하지 않되, 이벤트 버스로 실패를 가시화. 호출측은 블로킹되지 않음.

---

## 7. FTS5 동기화 자동화

### 현재: 수동 sync (facade + reflector 중복)

```typescript
// facade.ts:506-518, reflector.ts:332-343 — 동일 로직 중복
```

### 목표: SQLite 트리거 (마이그레이션에서 설정)

```sql
-- 004-memory-enhancement.ts에 포함
CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert
AFTER INSERT ON knowledge_nodes
BEGIN
  INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
AFTER UPDATE OF content ON knowledge_nodes
BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
  INSERT INTO knowledge_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete
AFTER UPDATE OF deleted_at ON knowledge_nodes
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
  INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', OLD.rowid, OLD.content);
END;
```

트리거 적용 후 `syncFtsInsert()` 메서드 및 reflector 내 수동 FTS 코드 제거.

---

## 8. Google API 키 보안 수정

**현재** (`instance.ts:154`):

```typescript
const url = `${endpoint}/models/text-embedding-004:embedContent?key=${apiKey}`;
```

**변경**:

```typescript
const res = await fetch(`${endpoint}/models/text-embedding-004:embedContent`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  },
  body: JSON.stringify({ content: { parts: [{ text }] } }),
  signal: AbortSignal.timeout(30_000),
});
```

---

## 9. 모듈 구조 변경

```
memory/
├── pipeline/
│   ├── pipeline.ts              파이프라인 엔진 (빌더 + 실행기)
│   ├── ingest-pipeline.ts       저장 파이프라인 조립
│   └── search-pipeline.ts       검색 파이프라인 조립
├── stages/
│   ├── participant-tagger.ts    발화자 귀속 스테이지
│   ├── extraction-strategy.ts   추출 전략 인터페이스
│   ├── regex-strategy.ts        Regex 추출 (기존 extractor.ts 리팩토링)
│   ├── llm-strategy.ts          LLM 구조화 추출
│   ├── refinement.ts            원문 → 정제 팩트
│   ├── remention-detector.ts    재언급 탐지
│   ├── conflict-checker.ts      모순 탐지 + edge 생성
│   ├── storage.ts               dedup + DB write
│   ├── retrieval-gate.ts        검색 필요성 판정
│   ├── hybrid-search.ts         FTS5 + Vector(ANN) + Graph
│   ├── reranker.ts              3-factor scoring + 재언급 부스트
│   └── context-assembler.ts     토큰 예산 조립
├── facade.ts                    파이프라인 조율 (setter 제거)
├── scorer.ts                    Stanford 3-factor (변경 없음)
├── embedding-service.ts         벡터 래퍼 (변경 없음)
├── evolver.ts                   병합/정리 (LSH 최적화 예정)
├── reflector.ts                 인사이트 생성 (모순 탐지 확장)
├── token-counter.ts             CJK 추정 + 안전 마진 적용
├── event-bus.ts                 이벤트 emitter
└── instance.ts                  싱글톤 + graceful reconfigure
```

---

## 10. 구현 순서

| 순서 | 작업 | 의존성 | 영향 |
|------|------|--------|------|
| **S1** ✅ | 마이그레이션 004 작성 (participant_id, mention_count, confidence, 인덱스, FTS 트리거) | 없음 | 스키마 |
| **S2** ✅ | MemoryConfig 확장 + 하드코딩 상수 config 이관 | S1 | 전 모듈 |
| **S3** ✅ | MemoryEventBus 구현 + 기존 silent catch를 이벤트 발행으로 교체 | 없음 | 오류 가시화 |
| **S4** ✅ | Pipeline 엔진 + 인터페이스 작성 | 없음 | 구조 기반 |
| **S5** ✅ | ExtractionStrategy 인터페이스 + RegexStrategy (기존 코드 리팩토링) | S4 | 추출 |
| **S6** ✅ | LlmStrategy 구현 | S5 | 추출 품질 (P0) |
| **S7** ✅ | ParticipantTagger + ReMentionDetector + ConflictChecker 스테이지 | S1, S4 | 데이터 품질 |
| **S8** ✅ | sqlite-vec 연동 + HybridSearch 스테이지 (ANN 전환) | S1, S4 | 검색 성능 (P0) |
| **S9** ✅ | Reranker (mention_count 부스트 포함) + RetrievalGate | S7, S8 | 검색 품질 |
| **S10** ✅ | ContextAssembler 모델별 동적 예산 + 안전 마진 | S2 | 조립 |
| **S11** ✅ | Facade 재작성 (파이프라인 조율) + instance.ts graceful reconfigure | S4~S10 | 통합 |
| **S12** ✅ | Google API 키 헤더 전환 | 없음 | 보안 |
| **S13** ✅ | 전체 테스트 업데이트 | S1~S12 | 검증 |

---

## 11. 호환성 보장

- **기존 데이터**: 새 컬럼은 모두 nullable 또는 default 값. 기존 노드 정상 동작
- **Phase 3-a 폴백**: LLM/sqlite-vec 미설정 시 기존 Regex + FTS5 + JS 전수 스캔으로 동작
- **마이그레이션**: forward-only, 004번 파일 신규 생성. 001~003 수정 없음
- **API 호환**: `MemoryFacade`의 public 메서드 시그니처 유지 (`search`, `storeNode`, `pinMessage`, `getAssembledContext`). 내부 구현만 파이프라인으로 교체

---

## 부록 A. 합의된 6대 원칙 — 현행 코드 대비 상세 분석

이하는 재설계 결정의 근거가 된 원칙별 분석 전문이다.

### A.1 "작업양이나 난이도보다 코드품질을 우선한다"

방향은 맞고, 현재 코드가 정확히 반대 방향의 흔적을 가지고 있다.

**대표 사례 — `extractor.ts`**: LLM 추출이 어려우니까 정규식으로 대충 잡는 접근. 결과적으로 40개 패턴이 있지만 복합 문장에서 첫 매칭만 취하고(`matchSentence`에서 첫 hit 시 즉시 return), 발화자 구분도 안 하고, 원문을 그대로 저장한다.

```typescript
// extractor.ts:202-213 — "작동은 하지만 품질이 낮은" 전형적 케이스
private matchSentence(sentence: string): ExtractionItem | null {
  for (const def of ALL_PATTERNS) {
    if (def.pattern.test(sentence)) {
      const mapping = CATEGORY_MAP[def.category];
      return {                          // ← 첫 매칭에서 즉시 return
        content: sentence,              // ← 원문 그대로 저장
        nodeType: mapping.nodeType,
        topic: mapping.topic,
        importance: mapping.importance,  // ← 고정 importance
      };
    }
  }
  return null;
}
```

**"코드 품질"의 정의**: 여기서 코드 품질은 "코드 자체의 깔끔함"이 아니라 **"메모리 시스템이 실제로 올바른 정보를 저장하고 올바른 정보를 반환하는가"**를 의미해야 한다. 코드가 깔끔해도 저장 데이터가 오염되면 무의미하다.

→ 설계서 반영: 3.1절 Extraction 전략 패턴, 3.2절 Refinement

### A.2 "설계는 구조적 효율을 고려한다"

방향은 맞지만, 현재 구조에서 충돌이 있다.

현재 facade 패턴(`MemoryFacade`가 모든 것을 조율)은 좋은 구조다. **문제는 파이프라인이 단방향 평면 구조라는 점**:

```
메시지 → extractor → storeNode → [끝]
질문 → retriever → assembler → [끝]
```

목표 구조는 다단계 파이프라인:

```
메시지 → 발화자 필터 → 추출 → 정제 → 충돌 검사 → 저장
질문 → 게이트 → 검색 → 리랭킹 → 증류 → 프레임 주입
```

지금 facade가 `setEvolver()`, `setReflector()` 같은 optional setter로 Phase 3-b를 끼우는 방식은 구조적으로 확장이 어렵다. 파이프라인 스테이지를 추가할 때마다 facade에 setter가 늘어나고, 조건 분기가 많아진다.

→ 설계서 반영: 2절 파이프라인 아키텍처 전체

### A.3 "세팅 및 동적 값을 사용. 하드코딩 금지"

방향은 맞고, 현재 코드에 위반 사례가 많다.

**현재 하드코딩된 값 전수 목록**:

| 위치 | 하드코딩 값 | 있어야 할 곳 |
|------|------------|-------------|
| `assembler.ts:172` | `'[관련 기억]'` | i18n 또는 config 프롬프트 템플릿 |
| `assembler.ts:182` | `' [중요]'` | 동일 |
| `assembler.ts:181` | `0.8` (중요 마커 임계값) | `MemoryConfig` |
| `retriever.ts:163` | `1.2` (핀 부스트) | `MemoryConfig` |
| `retriever.ts:274` | `0.3` (relevance floor) | `MemoryConfig` |
| `facade.ts:160` | `0.2` (핀 importance boost) | `MemoryConfig` |
| `facade.ts:179` | `0.7` (핀 기본 importance) | `MemoryConfig` |
| `reflector.ts:40-54` | 전체 시스템 프롬프트 | config 프롬프트 템플릿 |
| `reflector.ts:117` | `3` (최소 그룹 크기) | `MemoryConfig` |
| `extractor.ts:27-35` | 카테고리별 importance 값 | `MemoryConfig` |
| `retriever.ts:419` | `0.7` (hop decay) | `MemoryConfig` |

특히 프롬프트 문자열 하드코딩은 CLAUDE.md의 "하드코딩 UI 문자열 금지" 규칙에도 직접 위반된다. `'[관련 기억]'`은 사용자에게 노출되지는 않지만, AI에게 주입되는 프롬프트이므로 설정 가능해야 한다.

→ 설계서 반영: 5절 MemoryConfig 확장

### A.4 "폴백보다는 오류를 띄워 사용자가 알게 한다"

방향은 맞고, 현재 코드의 가장 위험한 패턴을 정확히 짚는다.

**현재 silent fallback 사례들**:

```typescript
// facade.ts:374 — 임베딩 실패를 완전 무시
private async embedAndUpdate(...): Promise<void> {
  try { ... } catch { /* Embedding failure must not affect the stored node */ }
}

// retriever.ts:253-256 — FTS 쿼리 에러를 빈 결과로 삼킴
try { rows = this.db.prepare(sql).all(...) as NodeRow[]; }
catch { return new Map(); }

// reflector.ts:125-128 — LLM 실패를 조용히 넘김
try { ... } catch { continue; }

// facade.ts:322-327 — evolver 없으면 조용히 {0, 0}
evolve(): EvolutionResult {
  if (!this.evolver) return { merged: 0, pruned: 0 };
}
```

이 패턴들은 문제가 발생해도 사용자가 절대 알 수 없다. FTS 쿼리가 매번 실패해도 빈 결과만 나오니 "메모리가 비어있나 보다"로 오해한다. 임베딩이 계속 실패해도 벡터 검색이 안 되는 것처럼 보일 뿐이다.

**구분이 필요한 부분**: `embedAndUpdate`의 fire-and-forget은 의도적 설계다. 노드 저장이 임베딩 실패로 블로킹되면 안 되니까. 이 경우는 오류를 에러로 throw하되, 호출측에서 별도 채널(로그, 상태바, 알림)로 사용자에게 전달하는 방식이 맞다. 즉 "폴백 대신 에러"가 아니라 **"조용한 실패 대신 가시적 알림"**으로 읽어야 한다.

→ 설계서 반영: 6절 MemoryEventBus

### A.5 "코드품질 및 문제해결을 위해서라면 코드 재작성도 할 수 있다"

방향은 맞고, 실제로 재작성이 필요한 모듈이 있다.

**재작성 대상 판정**:

| 모듈 | 이유 | 수준 |
|------|------|------|
| `extractor.ts` | 정규식 only → 파이프라인(필터→추출→정제→검증)으로 근본 구조 변경 필요 | **전면 재작성** |
| `assembler.ts` | 단순 bullet list → 게이트+증류+프레임 주입으로 역할 변경 | **전면 재작성** |
| `retriever.ts` | 검색 자체는 괜찮으나 게이트, 리랭킹, 임계값 필터가 추가되어야 함 | 부분 재작성 (search 메서드) |
| `memory-types.ts` | confidence, TTL, participantRole 등 필드 추가 | 확장 |
| `facade.ts` | optional setter 패턴 → 파이프라인 패턴 | **구조 재작성** |
| `reflector.ts` | 기본 로직은 괜찮으나 모순 탐지 추가 필요 | 확장 |

**수정이 아니라 재작성인 이유**: `extractor.ts`의 문제는 정규식 패턴을 추가/수정해서 해결되지 않는다. "문장 단위 정규식 매칭 → 원문 저장"이라는 접근 방식 자체가 문제이기 때문이다.

→ 설계서 반영: 3.1절~3.7절 모듈별 재설계, 9절 모듈 구조 변경

### A.6 "수정 중 오류 발생은 당연하다. 목표한 방향으로 진행을 계속 한다"

방향은 맞지만, 조건이 있다.

메모리 시스템은 DB 스키마 변경이 수반된다. `001-initial-schema.ts`에 `knowledge_nodes` 테이블이 정의되어 있고, CLAUDE.md에 **"마이그레이션 파일 수정 금지 — forward-only"** 규칙이 있다. 즉:

- 기존 마이그레이션 파일은 절대 수정 불가
- `confidence`, `participant_id` 같은 새 컬럼은 새 마이그레이션 파일(`004-memory-enhancement.ts`)로 추가해야 함
- 스키마 변경이 데이터 호환성을 깨면 안 됨 (기존 노드가 새 필드 없이도 동작해야 함)

이 제약 하에서 "오류가 나도 계속 진행"은 **애플리케이션 코드에서는 맞지만, 마이그레이션에서는 위험**하다. 마이그레이션 오류는 "앱 시작 차단"이 설계 원칙이다.

→ 설계서 반영: 4절 마이그레이션 (forward-only), 11절 호환성 보장

---

## 부록 B. 추가 요구사항 상세 — AI별 저장 + 시간 메타데이터

### B.1 AI별 저장 — participant_id 귀속

AI Chat Arena는 멀티 AI 대화 플랫폼이다. AI A가 "React 쓰자"라고 하고 AI B가 "Vue가 낫다"라고 하면, 이 둘을 구분 없이 저장하면 모순 탐지가 불가능하다.

**별도 저장소 불필요**. 저장소를 분리하면 "AI-A가 말한 것을 AI-B가 참조"할 때 크로스 조회가 필요해져서 복잡도만 올라간다.

**구현**:
- `knowledge_nodes`에 `participant_id TEXT` 컬럼 하나 추가
- 추출 시 이미 `participantId`를 받고 있음 (`extractFromMessages`의 파라미터) — 저장만 안 하고 있었을 뿐
- 검색 시에는 기본적으로 전체 검색, 필요할 때만 participant 필터
- 복잡도 증가 거의 없음

```typescript
// 현재: participantId를 받지만 버림
extractFromMessages(messages: Array<{ content: string; participantId: string }>)

// 변경: ExtractionItem에 participantId 포함 → storeNode에 전달
interface ExtractionItem {
  content: string;
  nodeType: NodeType;
  topic: MemoryTopic;
  importance: number;
  participantId?: string;  // 신규
}
```

→ 설계서 반영: 4절 마이그레이션 `participant_id`, 3.3절 재언급 탐지

### B.2 시간 메타데이터 — 재언급 추적

| 필드 | 현재 상태 | 필요 여부 |
|------|----------|----------|
| 최초 언급 시점 | `created_at`으로 이미 있음 | 있음 |
| 최근 재언급 시점 | `last_accessed`가 있지만, **검색 시 갱신됨** (재언급과 다름) | **신규 필요** |
| 재언급 횟수 | 없음 | **신규 필요** |

`last_accessed`는 "검색에 의해 꺼내졌을 때" 갱신되는데, "대화에서 다시 언급되었을 때"와는 의미가 다르다. 분리가 맞다:

- `last_mentioned_at` — 대화에서 같은 내용이 재등장한 시점
- `mention_count` — 재등장 횟수 → importance 스코어링에 직접 반영 가능

**재언급 탐지 전략** (실제 어려운 부분):

| 전략 | Phase | 방식 |
|------|-------|------|
| FTS 매칭 | 3-a | 새 추출 항목을 저장 전에 기존 노드와 FTS 검색 → 유사 노드 발견 시 `mention_count++` |
| 임베딩 유사도 | 3-b | 코사인 유사도 > threshold → 재언급으로 판정 |

Phase 3-a에서는 FTS만으로 충분하다. `dedupe_key`가 이미 정규화된 해시이므로, 완전 일치는 `dedupe_key`, 유사 재언급은 FTS 매칭으로 처리.

→ 설계서 반영: 3.3절, 4절 마이그레이션

### B.3 Extraction 전략 전환 규칙

```
LLM provider 미설정 → Regex 추출 (현재와 동일)
LLM provider 설정됨 → LLM 추출만 (Regex 안 함)
```

LLM이 Regex보다 상위 호환이기 때문에, 둘 다 돌릴 이유가 없다. Regex가 잡는 건 LLM도 잡고, LLM은 Regex가 못 잡는 것도 잡는다.

```typescript
interface ExtractionStrategy {
  extract(messages: AnnotatedMessage[]): Promise<ExtractionItem[]>;
}

class RegexStrategy implements ExtractionStrategy { ... }  // 현재 코드
class LlmStrategy implements ExtractionStrategy { ... }    // 신규

// 파이프라인 빌더에서
const strategy = config.extractionLlmProviderId
  ? new LlmStrategy(llmFn)
  : new RegexStrategy();
```

→ 설계서 반영: 3.1절 ExtractionStrategy
