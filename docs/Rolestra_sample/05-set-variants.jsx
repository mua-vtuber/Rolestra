// 05-set-variants.jsx — Settings / admin in 6 theme flavors
// Uses ProjectRail-style left column + DashCard panels for unified feel with Dashboard.

const SETTINGS_NAV = [
  { id: 'org',       label: '조직',        line: 'folder',    prefix: '[ORG]' },
  { id: 'members',   label: '직원',        line: 'dashboard', prefix: '[MEM]', active: true },
  { id: 'projects',  label: '프로젝트',    line: 'queue',     prefix: '[PRJ]' },
  { id: 'policy',    label: '권한 정책',   line: 'document',  prefix: '[POL]' },
  { id: 'connect',   label: '외부 연결',   line: 'bell',      prefix: '[API]' },
  { id: 'billing',   label: '과금',        line: 'settings',  prefix: '[BIL]' },
];

// Settings left nav — mirrors ProjectRail styling for consistency
function SetNav({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';

  const sectionTitleStyle = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: isWarm ? 0.5 : 1.6,
    color: theme.fgSubtle,
    padding: '4px 10px 8px',
    fontFamily: isWarm ? theme.font : theme.monoFont,
    textTransform: isWarm ? 'none' : 'uppercase',
  };

  return (
    <div style={{
      width: isWarm ? 238 : isTactical ? 242 : 240,
      background: theme.projectBg,
      borderRight: `1px solid ${theme.border}`,
      padding: '14px 10px',
      display: 'flex', flexDirection: 'column',
      gap: isWarm ? 4 : 3,
      flexShrink: 0,
    }}>
      <div style={sectionTitleStyle}>
        {isWarm ? '설정' : isRetro ? '$ settings' : 'SETTINGS'}
      </div>
      {SETTINGS_NAV.map((item) => {
        const isActive = !!item.active;
        return (
          <div key={item.id} style={{
            display: 'flex', alignItems: 'center', gap: isWarm ? 10 : 8,
            padding: '8px 10px',
            background: isActive && !isRetro ? theme.itemActiveBg : 'transparent',
            color: isActive ? theme.itemActiveFg : theme.fg,
            border: isActive && !isWarm && !isRetro
              ? `1px solid ${isTactical ? `${theme.brand}55` : theme.border}`
              : '1px solid transparent',
            borderRadius: isWarm ? 8 : 0,
            cursor: 'pointer',
          }}>
            {isRetro ? (
              <span style={{
                color: isActive ? theme.brand : 'transparent',
                fontSize: 11, width: 10, textAlign: 'center', flexShrink: 0,
                textShadow: isActive && theme.mode === 'dark' ? `0 0 4px ${theme.brand}66` : 'none',
              }}>▶</span>
            ) : isTactical ? (
              <LineIcon name={item.line} color={isActive ? theme.brand : theme.iconFg} />
            ) : (
              <LineIcon name={item.line} color="currentColor" stroke={1.4} />
            )}
            <span style={{
              flex: 1, fontSize: 12, fontWeight: isWarm ? 600 : 500,
              fontFamily: isRetro ? theme.monoFont : theme.font,
              whiteSpace: 'nowrap',
            }}>
              {item.label}
            </span>
          </div>
        );
      })}

      {/* Helper footnote */}
      <div style={{ ...sectionTitleStyle, paddingTop: 14 }}>
        {isWarm ? '워크스페이스' : isRetro ? '$ workspace' : 'WORKSPACE'}
      </div>
      <div style={{
        margin: '0 4px', padding: '10px 12px',
        border: `1px dashed ${theme.border}`,
        borderRadius: isWarm ? 8 : 0,
        fontSize: 11, color: theme.fgMuted, lineHeight: 1.5,
        fontFamily: isRetro ? theme.monoFont : theme.font,
      }}>
        <div style={{ fontWeight: 700, color: theme.fg, marginBottom: 3 }}>
          {isRetro ? '# Rolestra Studio' : 'Rolestra Studio'}
        </div>
        플랜: Team · 시트 6/20<br />
        만료: 2026-04-19
      </div>
    </div>
  );
}

// ─── Form row ────────────────────────────────────────────────────────
function SetRow({ theme, label, hint, children, last }) {
  const isRetro = theme.themeKey === 'retro';
  return (
    <div style={{
      padding: '12px 4px',
      borderBottom: last ? 'none' : `1px solid ${theme.panelBorder}66`,
      display: 'flex', alignItems: 'flex-start', gap: 18,
    }}>
      <div style={{ width: 180, flexShrink: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: theme.fg,
          fontFamily: isRetro ? theme.monoFont : theme.font,
        }}>{label}</div>
        {hint && (
          <div style={{ marginTop: 3, fontSize: 10, color: theme.fgMuted, lineHeight: 1.55 }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────
function SetToggle({ theme, on = true, label }) {
  const isRetro = theme.themeKey === 'retro';
  const color = on ? theme.success : theme.fgSubtle;
  if (isRetro) {
    const options = [
      { label: '켜기', active: on, tone: theme.success },
      { label: '끄기', active: !on, tone: theme.fgSubtle },
    ];
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: theme.monoFont, fontSize: 12 }}>
          {options.map((option) => (
            <span key={option.label} style={{
              padding: '0 2px',
              color: option.active ? option.tone : theme.fgSubtle,
              fontWeight: option.active ? 700 : 500,
              textShadow: option.active && theme.mode === 'dark' ? `0 0 4px ${option.tone}55` : 'none',
            }}>
              {option.active ? `[${option.label}]` : option.label}
            </span>
          ))}
        </div>
        {label && <span style={{ fontSize: 12, color: theme.fg, fontFamily: theme.monoFont }}>{label}</span>}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 38, height: 22, borderRadius: 999,
        background: on ? color : theme.panelBorder,
        border: `1px solid ${on ? color : theme.panelBorder}`,
        position: 'relative',
        boxShadow: theme.themeKey === 'tactical' && on ? `0 0 8px ${color}80` : 'none',
      }}>
        <div style={{
          position: 'absolute',
          top: 2, left: on ? 18 : 2,
          width: 16, height: 16, borderRadius: 999,
          background: theme.mode === 'dark' ? theme.bgCanvas : theme.bgElev,
          transition: 'left 0.2s',
        }} />
      </div>
      {label && <span style={{ fontSize: 13, color: theme.fg }}>{label}</span>}
    </div>
  );
}

// ─── Select / chip group ─────────────────────────────────────────────
function SetSelect({ theme, options, active }) {
  const isWarm = theme.themeKey === 'warm';
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((opt) => {
        const isActive = opt === active;
        return (
          <div key={opt} style={{
            padding: '5px 11px',
            border: `1px solid ${isActive ? theme.brand : theme.panelBorder}`,
            background: isActive
              ? (theme.mode === 'dark' ? `${theme.brand}22` : `${theme.brand}14`)
              : theme.bgSunk,
            color: isActive ? theme.brand : theme.fg,
            borderRadius: isWarm ? 999 : 0,
            fontSize: 11, fontWeight: 600,
            fontFamily: isRetro ? theme.monoFont : theme.font,
            cursor: 'pointer',
            clipPath: isTactical
              ? 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)'
              : 'none',
          }}>{isRetro && isActive ? `[${opt}]` : opt}</div>
        );
      })}
    </div>
  );
}

// ─── Member table (lives inside a DashCard) ──────────────────────────
function SetMemberTable({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const members = MEMBERS.filter((m) => m.id !== 'me').slice(0, 6);
  return (
    <div style={{ margin: '-8px -10px' }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.6fr 1fr 100px 90px 72px',
        gap: 10, padding: '8px 14px',
        borderBottom: `1px solid ${theme.panelBorder}`,
        background: theme.mode === 'dark' ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.025)',
        fontSize: 10, fontWeight: 700, color: theme.fgMuted,
        fontFamily: theme.monoFont, letterSpacing: 1.2, textTransform: 'uppercase',
      }}>
        <span>{isRetro ? '# 직원' : '직원'}</span>
        <span>역할</span>
        <span>권한</span>
        <span>상태</span>
        <span></span>
      </div>
      {members.map((m, i) => {
        const dot = statusDotColor(theme, m.status);
        return (
          <div key={m.id} style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr 100px 90px 72px',
            gap: 10, padding: '9px 14px', alignItems: 'center',
            borderBottom: i < members.length - 1 ? `1px solid ${theme.panelBorder}55` : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {isRetro ? (
                <span style={{ width: 8, height: 8, borderRadius: 999, background: dot,
                  boxShadow: theme.mode === 'dark' ? `0 0 5px ${dot}60` : 'none', flexShrink: 0 }} />
              ) : (
                <ProfileAvatar member={m} size={26}
                  shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                  fallbackBg={m.color} />
              )}
              <div style={{ minWidth: 0 }}>
                {isRetro ? (
                  <div style={{
                    fontSize: 12, color: theme.fg,
                    fontFamily: theme.monoFont,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    <span style={{ fontWeight: 700 }}>{m.name}</span>
                    <span style={{ color: theme.fgMuted }}> · {m.cli}</span>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: theme.fg,
                      fontFamily: theme.font,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{m.name}</div>
                    <div style={{ fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>{m.cli}</div>
                  </>
                )}
              </div>
            </div>
            <div style={{ fontSize: 11, color: theme.fg,
              fontFamily: isRetro ? theme.monoFont : theme.font,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.role}</div>
            <div style={{ fontSize: 10, color: theme.fgMuted, fontFamily: theme.monoFont }}>
              {i === 0 ? '혼합' : i % 2 === 0 ? '혼합' : '수동'}
            </div>
            <div style={{ fontSize: 10, color: theme.fgMuted, fontFamily: theme.monoFont,
              textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {statusText(m.status)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <DashMiniBtn theme={theme} tone="neutral" key1={isRetro ? '편집' : 'E'} label={isRetro ? '' : '편집'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SetSummaryStrip({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const activeMembers = MEMBERS.filter((member) => member.id !== 'me');
  const hybridCount = Math.ceil(activeMembers.length / 2);
  const stats = [
    { label: isRetro ? 'staff' : '직원', value: activeMembers.length, tone: theme.heroValue },
    { label: isRetro ? 'mixed' : '혼합', value: hybridCount, tone: theme.brand },
    { label: isRetro ? 'api' : '외부 API', value: 0, tone: theme.warning },
    { label: isRetro ? 'hours' : '근무 시간', value: '09-18', tone: theme.heroLabel },
  ];

  if (isRetro) {
    const summaryText = `직원[${activeMembers.length}] | 혼합[${hybridCount}] | 외부API[0] | 근무시간[09-18]`;
    return (
      <div style={{
        padding: '14px 18px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        display: 'flex',
        alignItems: 'flex-start',
        fontFamily: theme.monoFont,
      }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ fontSize: 11, color: theme.fgMuted }}>$ settings --snapshot</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.65, color: theme.fg }}>
            현재 조직 정책과 직원 상태를 요약합니다.
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
      clipPath: isTactical ? themeClip(theme) : 'none',
    }}>
      {stats.map((stat, index) => (
        <div key={stat.label} style={{
          flex: 1,
          padding: '6px 10px',
          borderLeft: index > 0 ? `1px solid ${theme.heroBorder}` : 'none',
        }}>
          <div style={{
            fontSize: isTactical ? 30 : 28,
            fontWeight: 700,
            lineHeight: 1,
            color: stat.tone,
            fontFamily: isTactical ? theme.monoFont : theme.displayFont,
          }}>{stat.value}</div>
          <div style={{
            marginTop: 5,
            fontSize: 11,
            fontWeight: 700,
            color: theme.heroLabel,
            fontFamily: isTactical ? theme.monoFont : theme.font,
            letterSpacing: isTactical ? 1.2 : 0,
          }}>{stat.label}</div>
        </div>
      ))}
    </div>
  );
}

function SetChangeBanner({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';

  return (
    <div style={{
      padding: '10px 14px',
      border: `1px solid ${theme.warning}`,
      background: theme.mode === 'dark' ? `${theme.warning}14` : `${theme.warning}10`,
      borderRadius: theme.themeKey === 'warm' ? 10 : 0,
      clipPath: isTactical
        ? 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)'
        : 'none',
      fontSize: 12, color: theme.fg, lineHeight: 1.5,
      display: 'flex', gap: 10, alignItems: 'center',
      boxShadow: isTactical ? `0 0 16px ${theme.warning}22` : 'none',
    }}>
      <span style={{ color: theme.warning, fontWeight: 700,
        fontFamily: theme.monoFont, fontSize: 14 }}>{isRetro ? '[!]' : '⚠'}</span>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700, color: theme.warning }}>변경사항 3개</span>
        <span style={{ color: theme.fgMuted }}> · 기본 권한 모드 · SSM 마감 단계 · 외부 API 호출 허용</span>
      </div>
      <DashMiniBtn theme={theme} tone="success" key1="S" label="저장" />
      <DashMiniBtn theme={theme} tone="neutral" key1="Z" label="되돌리기" />
    </div>
  );
}

// ─── Variant ─────────────────────────────────────────────────────────
function SetVariant({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  return (
    <VariantFrame theme={theme}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes dashCursor { 50% { opacity: 0; } }
      `}</style>
      <NavRail theme={theme} active="settings" />
      <SetNav theme={theme} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ShellTopBar theme={theme}
          title="설정"
          subtitle="조직 / 직원 / 권한 정책"
          showChips={false} />
        <div style={{
          flex: 1, padding: 18, overflow: 'hidden',
          display: 'grid', gridTemplateRows: 'auto auto 1fr auto', gap: 12,
          minHeight: 0,
        }}>
          <SetSummaryStrip theme={theme} />

          {/* Member table card */}
          <DashCard theme={theme}
            title="직원 관리"
            asciiTitle="./직원      "
            iconWarm="👥" iconLine="dashboard"
            badge={MEMBERS.length - 1}
            style={{}}
          >
            <SetMemberTable theme={theme} />
            <div style={{ marginTop: 10, padding: '0 4px 4px', display: 'flex', gap: 6 }}>
              <DashMiniBtn theme={theme} tone="success" key1="+" label="직원 추가" />
              <DashMiniBtn theme={theme} tone="neutral" key1="I" label="초대 링크" />
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont,
                alignSelf: 'center' }}>
                시트 {MEMBERS.length - 1}/20 사용 중
              </div>
            </div>
          </DashCard>

          {/* Policy card */}
          <DashCard theme={theme}
            title="기본 권한 정책"
            asciiTitle="./정책      "
            iconWarm="🛡" iconLine="document"
            badge="혼합"
          >
            <div style={{ padding: '0 6px' }}>
              <SetRow theme={theme}
                label="기본 권한 모드"
                hint="파일 수정 시 대표의 결재를 받는 방식."
              >
                <SetSelect theme={theme}
                  options={['자동', '혼합', '수동']}
                  active="혼합" />
              </SetRow>

              <SetRow theme={theme}
                label="합의 없이 시작 금지"
                hint="스레드에서 최소 1명과 합의해야 작업 시작 가능."
              >
                <SetToggle theme={theme} on={true} />
              </SetRow>

              <SetRow theme={theme}
                label="SSM 마감 단계"
                hint="몇 단계에서 결재 요청이 자동 생성되는지."
              >
                <SetSelect theme={theme}
                  options={['6/12', '8/12', '9/12', '12/12']}
                  active="9/12" />
              </SetRow>

              <SetRow theme={theme}
                label="외부 API 호출 허용"
                hint="내부 LLM 외 OpenAI / Anthropic 등 외부 공급자를 호출할 수 있게 합니다."
              >
                <SetToggle theme={theme} on={false} />
              </SetRow>

              <SetRow theme={theme}
                label="사무 시간"
                hint={isRetro ? '// 시간 외에는 자동 대기 상태' : '설정한 시간 외에는 자동 대기(외근) 상태로 전환.'}
                last
              >
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  fontSize: 12, color: theme.fg,
                  fontFamily: theme.monoFont,
                }}>
                  <span style={{
                    padding: '5px 9px', border: `1px solid ${theme.panelBorder}`,
                    borderRadius: theme.themeKey === 'warm' ? 6 : 0, background: theme.bgSunk,
                  }}>09:00</span>
                  <span style={{ color: theme.fgSubtle }}>—</span>
                  <span style={{
                    padding: '5px 9px', border: `1px solid ${theme.panelBorder}`,
                    borderRadius: theme.themeKey === 'warm' ? 6 : 0, background: theme.bgSunk,
                  }}>18:00</span>
                  <span style={{ color: theme.fgMuted, fontSize: 10 }}>KST</span>
                </div>
              </SetRow>
            </div>
          </DashCard>

          {/* Unsaved changes banner */}
          <SetChangeBanner theme={theme} />
        </div>
      </div>
    </VariantFrame>
  );
}

function SV_WarmLight()     { return <SetVariant theme={themeWarmLight} />; }
function SV_WarmDark()      { return <SetVariant theme={themeWarmDark} />; }
function SV_TacticalLight() { return <SetVariant theme={themeTacticalLight} />; }
function SV_TacticalDark()  { return <SetVariant theme={themeTacticalDark} />; }
function SV_RetroLight()    { return <SetVariant theme={themeRetroLight} />; }
function SV_RetroDark()     { return <SetVariant theme={themeRetroDark} />; }

Object.assign(window, {
  SV_WarmLight, SV_WarmDark,
  SV_TacticalLight, SV_TacticalDark,
  SV_RetroLight, SV_RetroDark,
});
