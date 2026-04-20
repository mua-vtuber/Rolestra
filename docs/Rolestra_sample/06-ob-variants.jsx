// 06-ob-variants.jsx — Onboarding wizard in 6 theme flavors
// Step 2/5: "직원 선택" — pick which CLIs/models will act as your staff.

const ONBOARD_STEPS = [
  { id: 1, label: '사무실' },
  { id: 2, label: '직원', current: true },
  { id: 3, label: '역할' },
  { id: 4, label: '권한' },
  { id: 5, label: '첫 프로젝트' },
];

const STAFF_CANDIDATES = [
  {
    id: 'claude', name: 'Claude Code', vendor: 'Anthropic',
    tagline: '사려 깊은 시니어 · 설명 장인',
    best: '리팩토링, 아키텍처 리뷰, 문서화',
    price: '$20/mo · Pro',
    initial: 'C',
    detected: true, selected: true,
  },
  {
    id: 'gemini', name: 'Gemini CLI', vendor: 'Google',
    tagline: '멀티모달 · 빠른 반응',
    best: 'UX 탐색, 이미지 분석, 긴 컨텍스트',
    price: '$20/mo',
    initial: 'G',
    detected: true, selected: true,
  },
  {
    id: 'codex', name: 'Codex', vendor: 'OpenAI',
    tagline: '꼼꼼한 엔지니어 · 테스트 좋아함',
    best: '백엔드, 알고리즘, 성능 최적화',
    price: '$20/mo · Plus',
    initial: 'O',
    detected: true, selected: true,
  },
  {
    id: 'copilot', name: 'Copilot CLI', vendor: 'GitHub',
    tagline: 'VS Code와 잘 맞음',
    best: '자동 완성, 간단한 리팩토링',
    price: '$10/mo',
    initial: 'H',
    detected: false, selected: false,
  },
  {
    id: 'local', name: 'Local (Ollama)', vendor: '내 컴퓨터',
    tagline: '느리지만 성실한 인턴',
    best: '문서 요약, 오프라인 작업',
    price: '무료',
    initial: 'L',
    detected: true, selected: true,
  },
  {
    id: 'grok', name: 'Grok CLI', vendor: 'xAI',
    tagline: '실시간 정보 · 장난기',
    best: '리서치, 트렌드 추적',
    price: '$30/mo · Premium+',
    initial: 'X',
    detected: false, selected: false,
  },
];

function getCandidateMarkTone(theme, cand) {
  if (cand.selected) {
    return {
      border: theme.brand,
      bg: theme.actionPrimaryBg,
      fg: theme.actionPrimaryFg,
      glow: theme.brand,
    };
  }

  if (cand.detected) {
    return {
      border: theme.success,
      bg: theme.mode === 'dark' ? `${theme.success}14` : `${theme.success}10`,
      fg: theme.success,
      glow: theme.success,
    };
  }

  return {
    border: theme.panelBorder,
    bg: theme.bgSunk,
    fg: theme.fgSubtle,
    glow: theme.panelBorder,
  };
}

// ─── Stepper ─────────────────────────────────────────────────────────
function OBStepper({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: isWarm ? 8 : 6,
      padding: '4px 0',
    }}>
      {ONBOARD_STEPS.map((step, i) => {
        const done = i < 1;
        const current = step.current;
        const dotColor = done ? theme.success : current ? theme.brand : theme.fgSubtle;
        return (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <div style={{
                flex: '0 0 32px', height: 1,
                background: done ? theme.success : theme.border,
                opacity: done ? 0.8 : 0.5,
              }} />
            )}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: isWarm ? '6px 12px' : '5px 10px',
              background: current
                ? (isWarm ? `${theme.brand}15` : isTactical ? `${theme.brand}14` : 'transparent')
                : 'transparent',
              border: current && !isWarm && !isRetro ? `1px solid ${theme.brand}66` : '1px solid transparent',
              borderRadius: isWarm ? 999 : 0,
              clipPath: current && isTactical
                ? 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)' : 'none',
            }}>
              {isRetro ? (
                <span style={{
                  fontFamily: theme.monoFont, fontSize: 11, fontWeight: 700,
                  color: dotColor,
                  textShadow: theme.mode === 'dark' && current
                    ? `0 0 5px ${dotColor}66` : 'none',
                }}>
                  [{done ? '✓' : current ? '▶' : String(step.id)}]
                </span>
              ) : (
                <span style={{
                  width: 18, height: 18, borderRadius: isTactical ? 0 : 999,
                  background: done ? theme.success : current ? theme.brand : 'transparent',
                  border: `1px solid ${dotColor}`,
                  color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, fontFamily: theme.monoFont,
                  boxShadow: current && isTactical ? `0 0 8px ${theme.brand}55` : 'none',
                }}>{done ? '✓' : step.id}</span>
              )}
              <span style={{
                fontSize: 11, fontWeight: current ? 700 : 500,
                color: current ? theme.fg : theme.fgMuted,
                fontFamily: isRetro ? theme.monoFont : theme.font,
                letterSpacing: isRetro ? 0.3 : 0,
                whiteSpace: 'nowrap',
              }}>{step.label}</span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Staff candidate card ────────────────────────────────────────────
function OBStaffCard({ theme, cand }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const sel = cand.selected;
  const markTone = getCandidateMarkTone(theme, cand);
  const activeBorder = sel ? theme.brand : theme.panelBorder;
  const bg = sel
    ? (theme.mode === 'dark' ? `${theme.brand}14` : `${theme.brand}0d`)
    : theme.panelBg;
  const statusLabel = sel
    ? (isRetro ? '[JOIN]' : '입사 예정')
    : cand.detected
      ? (isRetro ? '[HOLD]' : '감지됨 · 보류')
      : (isRetro ? '[MISS]' : '설치 후 사용');

  const titleBar = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      background: sel
        ? (theme.mode === 'dark' ? `${theme.brand}1a` : `${theme.brand}14`)
        : theme.panelHeaderBg,
    }}>
      {isRetro ? (
        <span style={{
          fontFamily: theme.monoFont, fontSize: 13, fontWeight: 700,
          color: sel ? theme.brand : theme.fgMuted,
          width: 22, textAlign: 'center',
          textShadow: sel && theme.mode === 'dark' ? `0 0 5px ${theme.brand}66` : 'none',
        }}>[{sel ? 'x' : '-'}]</span>
      ) : (
        <div style={{
          width: 30, height: 30, flexShrink: 0,
          background: markTone.bg, color: markTone.fg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, fontFamily: theme.displayFont,
          borderRadius: isWarm ? 999 : isTactical ? 0 : 6,
          border: `1px solid ${markTone.border}`,
          clipPath: isTactical
            ? 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)' : 'none',
          boxShadow: sel && isTactical ? `0 0 10px ${markTone.glow}60` : 'none',
        }}>{cand.initial}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: theme.fg,
          fontFamily: isRetro ? theme.monoFont : theme.font,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{cand.name}</div>
        <div style={{
          fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont,
          marginTop: 1,
        }}>{cand.vendor} · {cand.price}</div>
      </div>
      {cand.detected ? (
        <span style={{
          fontSize: 9, fontWeight: 700, color: theme.success,
          padding: '3px 6px',
          border: `1px solid ${theme.success}88`,
          background: `${theme.success}12`,
          borderRadius: isWarm ? 999 : 0,
          fontFamily: theme.monoFont, letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>{isRetro ? 'OK' : '감지됨'}</span>
      ) : (
        <span style={{
          fontSize: 9, fontWeight: 700, color: theme.fgSubtle,
          padding: '3px 6px',
          border: `1px dashed ${theme.panelBorder}`,
          borderRadius: isWarm ? 999 : 0,
          fontFamily: theme.monoFont, letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>미설치</span>
      )}
    </div>
  );

  return (
    <div style={{
      background: bg,
      border: `1px solid ${activeBorder}`,
      borderRadius: isWarm ? 10 : 0,
      clipPath: isTactical
        ? 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' : 'none',
      boxShadow: sel && isTactical ? `inset 0 0 0 1px ${theme.brand}33, 0 0 16px ${theme.brand}20` : theme.panelShadow,
      overflow: 'hidden',
      cursor: 'pointer',
    }}>
      {titleBar}
      <div style={{ padding: '10px 12px' }}>
        <div style={{
          fontSize: 11, color: theme.fg, fontWeight: 600,
          fontFamily: isRetro ? theme.monoFont : theme.font,
          lineHeight: 1.4,
        }}>{isRetro ? `> ${cand.tagline}` : cand.tagline}</div>
        <div style={{
          marginTop: 6, fontSize: 10, color: theme.fgMuted, lineHeight: 1.5,
          fontFamily: isRetro ? theme.monoFont : theme.font,
        }}>
          <span style={{ color: theme.fgSubtle, fontFamily: theme.monoFont }}>
            {isRetro ? '# 잘하는 일: ' : '잘하는 일 · '}
          </span>
          {cand.best}
        </div>
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${theme.panelBorder}55`,
          fontSize: 10,
          color: sel ? theme.brand : cand.detected ? theme.success : theme.fgSubtle,
          fontFamily: theme.monoFont,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>{statusLabel}</div>
      </div>
    </div>
  );
}

function OBActionButton({ theme, kind = 'secondary', children }) {
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const isPrimary = kind === 'primary';

  return (
    <button style={{
      height: 36,
      padding: '0 14px',
      border: `1px solid ${isPrimary ? theme.actionPrimaryBg : theme.panelBorder}`,
      background: isPrimary ? theme.actionPrimaryBg : (kind === 'ghost' ? 'transparent' : theme.bgSunk),
      color: isPrimary ? theme.actionPrimaryFg : (kind === 'ghost' ? theme.fgMuted : theme.fg),
      borderRadius: isWarm ? 8 : 0,
      clipPath: isTactical
        ? 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)'
        : 'none',
      fontSize: 12,
      fontWeight: isPrimary ? 700 : 600,
      fontFamily: theme.themeKey === 'retro' ? theme.monoFont : theme.font,
      letterSpacing: theme.themeKey === 'retro' ? 0.3 : 0,
      cursor: 'pointer',
      boxShadow: isPrimary && isTactical ? `0 0 16px ${theme.actionPrimaryBg}66` : 'none',
    }}>{children}</button>
  );
}

function OBSummaryStrip({ theme, selectedCount }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const detectedCount = STAFF_CANDIDATES.filter((candidate) => candidate.detected).length;
  const missingCount = STAFF_CANDIDATES.length - detectedCount;
  const items = [
    { label: isRetro ? 'selected' : '선택됨', value: selectedCount, tone: theme.brand },
    { label: isRetro ? 'detected' : '감지됨', value: detectedCount, tone: theme.success },
    { label: isRetro ? 'missing' : '미설치', value: missingCount, tone: theme.fgSubtle },
  ];

  if (isRetro) {
    const summaryText = `선택[${selectedCount}] | 감지[${detectedCount}] | 미설치[${missingCount}]`;
    return (
      <div style={{
        padding: '12px 16px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        fontFamily: theme.monoFont,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
      }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 11, color: theme.fgMuted }}>$ onboarding --staff</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.65, color: theme.fg }}>
            최소 1명을 선택하면 다음 단계에서 역할을 부여합니다.
          </div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.65, color: theme.fg }}>
            {summaryText}
            <span style={{
              display: 'inline-block', width: 8, height: 14, marginLeft: 6,
              background: theme.brand, verticalAlign: 'text-bottom',
              boxShadow: theme.mode === 'dark' ? `0 0 6px ${theme.brand}55` : 'none',
              animation: 'dashCursor 1.06s infinite step-end',
            }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '14px 18px',
      display: 'flex',
      gap: 14,
      background: theme.heroBg,
      border: `1px solid ${theme.heroBorder}`,
      borderRadius: theme.themeKey === 'warm' ? 10 : 0,
      clipPath: isTactical ? theme.panelClip : 'none',
    }}>
      {items.map((item, index) => (
        <div key={item.label} style={{
          flex: 1,
          padding: '6px 10px',
          borderLeft: index > 0 ? `1px solid ${theme.heroBorder}` : 'none',
        }}>
          <div style={{
            fontSize: isTactical ? 30 : 28,
            fontWeight: 700,
            lineHeight: 1,
            color: item.tone,
            fontFamily: isTactical ? theme.monoFont : theme.displayFont,
          }}>{item.value}</div>
          <div style={{
            marginTop: 5,
            fontSize: 11,
            fontWeight: 700,
            color: theme.heroLabel,
            fontFamily: isTactical ? theme.monoFont : theme.font,
            letterSpacing: isTactical ? 1.2 : 0,
          }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Variant ─────────────────────────────────────────────────────────
function OBVariant({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const selectedCount = STAFF_CANDIDATES.filter(c => c.selected).length;

  return (
    <VariantFrame theme={theme}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes dashCursor { 50% { opacity: 0; } }
      `}</style>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
        position: 'relative',
      }}>
        {/* Minimal top bar — just logo + hint, no nav yet */}
        <div style={{
          minHeight: 52, padding: '10px 24px',
          background: theme.topBarBg,
          borderBottom: `1px solid ${theme.topBarBorder}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 32, height: 32,
            background: theme.logoBg, color: theme.logoFg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontFamily: theme.displayFont,
            borderRadius: isWarm ? 8 : 0,
            border: isTactical ? `1px solid ${theme.brand}` : isRetro ? `1px solid ${theme.border}` : 'none',
            boxShadow: theme.logoShadow,
            fontSize: 14,
          }}>
            {theme.useLineIcons
              ? <LineIcon name="dashboard" color="currentColor" stroke={1.4} />
              : 'R'}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={{
              fontSize: 17, fontWeight: 700, color: theme.fg,
              fontFamily: theme.displayFont, letterSpacing: -0.3,
            }}>Rolestra 시작하기</div>
            <div style={{ fontSize: 11, color: theme.fgMuted, fontFamily: theme.monoFont }}>
              2/5 단계 · 약 4분 남음
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{
            fontSize: 11, color: theme.fgSubtle, fontFamily: theme.monoFont,
          }}>나중에 하기 →</div>
        </div>

        {/* Stepper row */}
        <div style={{
          padding: '14px 24px',
          borderBottom: `1px solid ${theme.border}`,
          background: theme.bgSunk,
          display: 'flex', justifyContent: 'center',
        }}>
          <OBStepper theme={theme} />
        </div>

        {/* Content */}
        <div style={{
          flex: 1, overflow: 'hidden',
          display: 'grid', gridTemplateRows: 'auto auto 1fr auto',
          padding: '22px 40px 0',
          gap: 16,
        }}>
          {/* Header */}
          <div>
            <div style={{
              fontSize: 26, fontWeight: 700, color: theme.fg,
              fontFamily: theme.displayFont, letterSpacing: -0.5,
              lineHeight: 1.2,
            }}>
              {isRetro ? '## 직원을 고용하시겠어요?' : '누구와 함께 일하시겠어요?'}
            </div>
            <div style={{
              marginTop: 6, fontSize: 13, color: theme.fgMuted, lineHeight: 1.6,
              maxWidth: 780,
            }}>
              설치된 CLI / 모델을 감지했습니다. 체크한 모델이 <span style={{ color: theme.fg, fontWeight: 700 }}>직원</span>으로 사무실에 입사하고,
              다음 단계에서 역할을 부여합니다. 언제든 설정에서 추가·해고할 수 있습니다.
            </div>
          </div>

          <OBSummaryStrip theme={theme} selectedCount={selectedCount} />

          {/* Staff grid — 3 columns × 2 rows */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            alignContent: 'start',
            overflow: 'hidden',
          }}>
            {STAFF_CANDIDATES.map(c => (
              <OBStaffCard key={c.id} theme={theme} cand={c} />
            ))}
          </div>

          {/* Footer bar */}
          <div style={{
            padding: '14px 0 18px',
            borderTop: `1px solid ${theme.border}`,
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{
              fontSize: 12, color: theme.fg, fontFamily: isRetro ? theme.monoFont : theme.font,
            }}>
              {isRetro ? `# 선택됨: ` : '선택됨 '}
              <span style={{ color: theme.brand, fontWeight: 800, fontFamily: theme.monoFont }}>
                {selectedCount}명
              </span>
              <span style={{ color: theme.fgMuted }}> · 최소 1명 필요</span>
            </div>
            <div style={{ flex: 1 }} />
            <OBActionButton theme={theme}>{isRetro ? '$ rescan' : '↻ 다시 감지'}</OBActionButton>
            <OBActionButton theme={theme} kind="ghost">← 이전</OBActionButton>
            <OBActionButton theme={theme} kind="primary">{isRetro ? '[Enter] 다음 →' : '다음 → 역할 부여'}</OBActionButton>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function OV_WarmLight()     { return <OBVariant theme={themeWarmLight} />; }
function OV_WarmDark()      { return <OBVariant theme={themeWarmDark} />; }
function OV_TacticalLight() { return <OBVariant theme={themeTacticalLight} />; }
function OV_TacticalDark()  { return <OBVariant theme={themeTacticalDark} />; }
function OV_RetroLight()    { return <OBVariant theme={themeRetroLight} />; }
function OV_RetroDark()     { return <OBVariant theme={themeRetroDark} />; }

Object.assign(window, {
  OV_WarmLight, OV_WarmDark,
  OV_TacticalLight, OV_TacticalDark,
  OV_RetroLight, OV_RetroDark,
});
