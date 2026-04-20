// Variants 3, 4, 5 for Rolestra dashboard

// ─────────────────────────────────────────────────────────────────────
// Variant 3 — Illustrated (flat, paper, simplified illustration)
// ─────────────────────────────────────────────────────────────────────
const themeIllus = {
  bgCanvas: '#fdf7ed',
  bgElev: '#ffffff',
  bgSunk: '#fbf0dc',
  fg: '#2a2018',
  fgMuted: '#7a6550',
  fgSubtle: '#b8a486',
  border: '#2a2018',
  borderSoft: '#d9c9a9',
  brand: '#e8742c',
  brandSoft: '#fde1c7',
  accent: '#f0b84a',
  accent2: '#6bafb8',
  accent3: '#d06060',
  success: '#7ba551',
  warning: '#e8a13a',
  danger: '#d06060',
  font: '"Nunito", "Inter", system-ui, sans-serif',
  displayFont: '"Fredoka", "Nunito", sans-serif',
  monoFont: '"JetBrains Mono", monospace',
  avatarBgEmoji: '#fef1dc',
  avatarRadius: 20,
  avatarStyle: 'emoji',
  railBg: '#fef1dc',
  railExtra: { borderRight: '2px solid #2a2018' },
  logoBg: '#e8742c',
  logoFg: '#fff',
  logoRadius: 12,
  logoShadow: '2px 3px 0 #2a2018',
  iconFg: '#7a6550',
  iconActiveBg: '#fff',
  iconActiveFg: '#e8742c',
  iconActiveShadow: '2px 2px 0 #2a2018',
  iconRadius: 10,
  badgeBg: '#d06060',
  badgeFg: '#fff',
  projectBg: '#fef6e4',
  itemActiveBg: '#fde1c7',
  itemActiveFg: '#2a2018',
  itemRadius: 8,
  unreadBg: '#e8742c',
  unreadFg: '#fff',
  heroSky: '#d4ecf5',
  heroSkySoft: '#b6def0',
  memberAccent: '#a8d68a',
  memberAccentSoft: '#d9ebc8',
};

// Simplified SVG illustration — desk with plant, clock, papers
function OfficeIllustration({ w = 220, h = 140 }) {
  const t = themeIllus;
  return (
    <svg width={w} height={h} viewBox="0 0 220 140" style={{ overflow: 'visible' }}>
      {/* Floor line */}
      <line x1="0" y1="115" x2="220" y2="115" stroke={t.fg} strokeWidth="2" />
      {/* Desk */}
      <rect x="30" y="90" width="160" height="8" fill={t.fg} />
      <rect x="34" y="98" width="4" height="17" fill={t.fg} />
      <rect x="182" y="98" width="4" height="17" fill={t.fg} />
      {/* Monitor */}
      <rect x="70" y="50" width="55" height="40" rx="3" fill={t.bgElev} stroke={t.fg} strokeWidth="2" />
      <rect x="75" y="55" width="45" height="25" fill={t.accent2} />
      <circle cx="82" cy="63" r="3" fill={t.bgElev} />
      <rect x="88" y="61" width="20" height="3" fill={t.bgElev} opacity="0.8" />
      <rect x="88" y="67" width="14" height="2" fill={t.bgElev} opacity="0.6" />
      <rect x="93" y="80" width="9" height="10" fill={t.fg} />
      <rect x="85" y="88" width="25" height="3" fill={t.fg} />
      {/* Coffee cup */}
      <rect x="135" y="78" width="14" height="14" rx="1" fill={t.accent3} stroke={t.fg} strokeWidth="2" />
      <path d="M 149 82 Q 156 82 156 86 Q 156 90 149 90" fill="none" stroke={t.fg} strokeWidth="2" />
      <path d="M 138 75 Q 140 71 142 75 M 144 75 Q 146 71 148 75" stroke={t.fg} strokeWidth="1.5" fill="none" />
      {/* Plant */}
      <rect x="155" y="78" width="18" height="14" rx="1" fill={t.warning} stroke={t.fg} strokeWidth="2" />
      <ellipse cx="158" cy="70" rx="4" ry="9" fill={t.success} transform="rotate(-20 158 70)" />
      <ellipse cx="168" cy="68" rx="4" ry="10" fill={t.success} transform="rotate(15 168 68)" />
      <ellipse cx="163" cy="62" rx="4" ry="11" fill={t.success} />
      {/* Clock on wall */}
      <circle cx="40" cy="35" r="16" fill={t.bgElev} stroke={t.fg} strokeWidth="2" />
      <line x1="40" y1="35" x2="40" y2="25" stroke={t.fg} strokeWidth="2" />
      <line x1="40" y1="35" x2="48" y2="38" stroke={t.fg} strokeWidth="2" />
      <circle cx="40" cy="35" r="1.5" fill={t.fg} />
      {/* Papers */}
      <rect x="45" y="83" width="18" height="7" fill={t.bgElev} stroke={t.fg} strokeWidth="1.5" transform="rotate(-8 54 86)" />
      <rect x="50" y="85" width="18" height="7" fill={t.bgElev} stroke={t.fg} strokeWidth="1.5" transform="rotate(6 59 88)" />
      {/* Sun/window hint */}
      <circle cx="195" cy="25" r="10" fill={t.accent} />
      <g stroke={t.accent} strokeWidth="2">
        <line x1="195" y1="10" x2="195" y2="6" />
        <line x1="210" y1="25" x2="214" y2="25" />
        <line x1="206" y1="14" x2="209" y2="11" />
        <line x1="206" y1="36" x2="209" y2="39" />
      </g>
    </svg>
  );
}

function V3_Illustrated() {
  const t = themeIllus;
  const online = MEMBERS.filter(m => m.status === 'online').length;
  return (
    <VariantFrame theme={t}>
      <LeftRail theme={t} />
      <ProjectRail theme={t} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          padding: '14px 24px',
          borderBottom: `2px solid ${t.fg}`,
          background: t.bgElev,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: t.displayFont, letterSpacing: -0.5 }}>
              ☕ 사무실
            </div>
            <div style={{ fontSize: 12, color: t.fgMuted, marginTop: 2 }}>
              따뜻한 금요일 오후 2시 23분
            </div>
          </div>
          <div style={{
            padding: '6px 12px', borderRadius: 999,
            background: t.brandSoft, border: `2px solid ${t.fg}`,
            fontSize: 12, fontWeight: 700,
            boxShadow: `2px 2px 0 ${t.fg}`,
          }}>
            🔐 hybrid 모드
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflow: 'hidden', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Hero with illustration */}
          <div style={{
            background: t.heroSky, border: `2px solid ${t.fg}`, borderRadius: 18,
            padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 20,
            boxShadow: `4px 4px 0 ${t.fg}`,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 60,
              background: `linear-gradient(180deg, ${t.heroSkySoft} 0%, transparent 100%)`,
            }} />
            <div style={{ flex: 1, position: 'relative' }}>
              <div style={{
                display: 'inline-block',
                padding: '3px 10px', borderRadius: 999,
                background: t.accent, color: t.fg,
                fontSize: 11, fontWeight: 800, marginBottom: 8,
                border: `1.5px solid ${t.fg}`,
              }}>안녕하세요!</div>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: t.displayFont, letterSpacing: -0.5, lineHeight: 1.15 }}>
                오늘 {online}명이 출근했고,<br/>
                {ACTIVE_MEETINGS.length}개 회의가 진행 중이에요.
              </div>
              <div style={{ fontSize: 13, color: t.fgMuted, marginTop: 6 }}>
                결재 {APPROVAL_QUEUE.length}건이 대표님을 기다리고 있어요 ✉️
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <IllusBtn t={t} primary>+ 새 프로젝트</IllusBtn>
                <IllusBtn t={t}>회의 소집</IllusBtn>
              </div>
            </div>
            <OfficeIllustration w={220} h={140} />
          </div>

          {/* 3-col */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
            <IllusCard t={t} title="직원들" emoji="👥" accent={t.memberAccent}>
              {MEMBERS.slice(0, 5).map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px',
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 18,
                    background: m.color + '25',
                    border: `2px solid ${t.fg}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18,
                  }}>{m.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: t.fgMuted }}>{m.role}</div>
                  </div>
                  <IllusStatus status={m.status} t={t} />
                </div>
              ))}
            </IllusCard>

            <IllusCard t={t} title="진행 중 업무" emoji="🎯" accent={t.brand}>
              {ACTIVE_MEETINGS.map(mt => {
                const p = PROJECTS.find(x => x.id === mt.project);
                const stateColor = mt.state === 'WORKING' ? t.success :
                                   mt.state === 'CONSENSUS' ? t.warning : t.accent2;
                const stateLabel = mt.state === 'WORKING' ? '작업 중' :
                                   mt.state === 'CONSENSUS' ? '합의 중' : '리뷰 중';
                return (
                  <div key={mt.id} style={{
                    padding: '9px 10px', marginBottom: 8,
                    background: t.bgSunk, borderRadius: 10,
                    border: `1.5px solid ${t.borderSoft}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
                        {p?.icon} {mt.topic}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 8px',
                        borderRadius: 999, background: stateColor, color: '#fff',
                        border: `1.5px solid ${t.fg}`,
                      }}>{stateLabel}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: t.fgMuted }}>#{mt.channel} · {mt.elapsed}째</span>
                      <div style={{ flex: 1 }} />
                      <div style={{ display: 'flex' }}>
                        {mt.members.slice(0, 3).map((mid, i) => {
                          const mm = MEMBERS.find(x => x.id === mid);
                          return (
                            <div key={mid} style={{
                              marginLeft: i ? -6 : 0,
                              width: 22, height: 22, borderRadius: 11,
                              background: mm.color + '25',
                              border: `1.5px solid ${t.fg}`,
                              fontSize: 11,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>{mm.emoji}</div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 2 }}>
                <IllusStat t={t} value="4" label="오늘 완료" color={t.success} emoji="✅" />
                <IllusStat t={t} value="17" label="주간" color={t.brand} emoji="📈" />
                <IllusStat t={t} value="6일" label="연속" color={t.warning} emoji="🔥" />
              </div>
            </IllusCard>

            <IllusCard t={t} title="결재함" emoji="📮" accent={t.danger} badge={APPROVAL_QUEUE.length}>
              {APPROVAL_QUEUE.slice(0, 2).map(a => {
                const m = MEMBERS.find(x => x.id === a.requester);
                const p = PROJECTS.find(x => x.id === a.project);
                return (
                  <div key={a.id} style={{
                    padding: '10px', marginBottom: 8,
                    background: t.bgSunk, borderRadius: 10,
                    border: `1.5px solid ${t.borderSoft}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 12,
                        background: m.color + '25', border: `1.5px solid ${t.fg}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13,
                      }}>{m.emoji}</div>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</span>
                      <span style={{ fontSize: 10, color: t.fgMuted }}>· {p?.name}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: t.fgSubtle }}>{a.time}</span>
                    </div>
                    <div style={{
                      fontSize: 12, lineHeight: 1.4, marginBottom: 8,
                      padding: '6px 8px', background: t.bgElev,
                      borderRadius: 6, border: `1px dashed ${t.borderSoft}`,
                    }}>{a.summary}</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <IllusBtn t={t} tiny success>👍 허가</IllusBtn>
                      <IllusBtn t={t} tiny>조건부</IllusBtn>
                      <IllusBtn t={t} tiny danger>✗</IllusBtn>
                    </div>
                  </div>
                );
              })}
            </IllusCard>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function IllusBtn({ t, children, primary, success, danger, tiny }) {
  const bg = primary ? t.brand : success ? t.success : danger ? t.danger : t.bgElev;
  const fg = primary || success || danger ? '#fff' : t.fg;
  const pad = tiny ? '4px 8px' : '8px 14px';
  const fs = tiny ? 11 : 13;
  return (
    <button style={{
      padding: pad, borderRadius: 8, background: bg, color: fg,
      border: `1.5px solid ${t.fg}`, fontWeight: 700, fontSize: fs,
      boxShadow: `2px 2px 0 ${t.fg}`, cursor: 'pointer',
      fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function IllusCard({ t, title, emoji, accent, badge, children }) {
  return (
    <div style={{
      background: t.bgElev, border: `2px solid ${t.fg}`, borderRadius: 14,
      boxShadow: `4px 4px 0 ${t.fg}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: `2px solid ${t.fg}`,
        background: accent + '25',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 800, fontFamily: t.displayFont }}>{title}</span>
        <div style={{ flex: 1 }} />
        {badge > 0 && (
          <span style={{
            minWidth: 22, height: 22, padding: '0 8px',
            borderRadius: 11, background: t.danger, color: '#fff',
            fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1.5px solid ${t.fg}`,
          }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: '10px 12px', flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function IllusStatus({ status, t }) {
  const map = {
    online: { bg: t.success, l: '출근' },
    connecting: { bg: t.warning, l: '연결중' },
    'offline-connection': { bg: t.danger, l: '끊김' },
    'offline-manual': { bg: t.fgSubtle, l: '퇴근' },
  };
  const s = map[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 700,
      padding: '3px 8px', borderRadius: 999,
      background: s.bg, color: '#fff',
      border: `1.5px solid ${t.fg}`,
    }}>{s.l}</span>
  );
}

function IllusStat({ t, value, label, color, emoji }) {
  return (
    <div style={{
      padding: '8px', background: color + '18',
      borderRadius: 10, border: `1.5px solid ${t.borderSoft}`,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 16 }}>{emoji}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: t.displayFont, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: t.fgMuted, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 4 — SF Command (NIKKE-style: cool glass panels, cyan, angular)
// ─────────────────────────────────────────────────────────────────────
const themeGame = {
  bgCanvas: '#0a1220',
  bgElev: 'rgba(24,38,60,0.72)',
  bgSunk: 'rgba(10,18,32,0.85)',
  fg: '#e8f1ff',
  fgMuted: '#8fa8c8',
  fgSubtle: '#5a7090',
  border: 'rgba(120,200,255,0.22)',
  borderSoft: 'rgba(120,200,255,0.10)',
  brand: '#4fd1ff',
  brandDeep: '#2a9dd4',
  accent: '#7df5c4',
  accent2: '#f5d67d',
  success: '#5de8a8',
  successDeep: '#2a9d68',
  warning: '#f5c84c',
  danger: '#ff6b8a',
  dangerDeep: '#c94464',
  purple: '#b29dff',
  font: '"Inter", "Pretendard", system-ui, sans-serif',
  displayFont: '"Space Grotesk", "Inter", sans-serif',
  monoFont: '"JetBrains Mono", monospace',
  avatarBgEmoji: 'rgba(120,200,255,0.10)',
  avatarRadius: 2,
  avatarStyle: 'initials',
  railBg: 'linear-gradient(180deg, #0a1220 0%, #050a14 100%)',
  railExtra: { borderRight: '1px solid rgba(120,200,255,0.15)' },
  logoBg: 'transparent',
  logoFg: '#4fd1ff',
  logoRadius: 2,
  logoShadow: 'inset 0 0 0 1px rgba(79,209,255,0.6), 0 0 12px rgba(79,209,255,0.35)',
  iconFg: '#5a7090',
  iconActiveBg: 'rgba(79,209,255,0.12)',
  iconActiveFg: '#4fd1ff',
  iconActiveShadow: 'inset 0 0 0 1px rgba(79,209,255,0.5), 0 0 10px rgba(79,209,255,0.25)',
  iconRadius: 2,
  badgeBg: '#ff6b8a',
  badgeFg: '#0a1220',
  projectBg: 'rgba(10,18,32,0.6)',
  itemActiveBg: 'rgba(79,209,255,0.10)',
  itemActiveFg: '#e8f1ff',
  itemRadius: 0,
  unreadBg: '#4fd1ff',
  unreadFg: '#0a1220',
};

// Angular notched corner path (clip-path)
const NOTCH = 'polygon(0 10px, 10px 0, calc(100% - 10px) 0, 100% 10px, 100% calc(100% - 10px), calc(100% - 10px) 100%, 10px 100%, 0 calc(100% - 10px))';

function V4_Game() {
  const t = themeGame;
  const online = MEMBERS.filter(m => m.status === 'online').length;
  return (
    <VariantFrame theme={t}>
      {/* Background grid + glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `
          radial-gradient(ellipse 800px 400px at 30% 0%, rgba(79,209,255,0.12), transparent 60%),
          radial-gradient(ellipse 600px 300px at 90% 100%, rgba(178,157,255,0.10), transparent 60%),
          linear-gradient(rgba(120,200,255,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(120,200,255,0.04) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 100% 100%, 48px 48px, 48px 48px',
      }} />

      <LeftRail theme={t} />
      <ProjectRail theme={t} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {/* Top HUD bar */}
        <div style={{
          padding: '12px 24px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', alignItems: 'center', gap: 16,
          background: 'linear-gradient(180deg, rgba(10,18,32,0.9), rgba(10,18,32,0.5))',
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 10, height: 10, background: t.brand,
              boxShadow: `0 0 8px ${t.brand}`,
              clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
            }} />
            <div>
              <div style={{
                fontSize: 10, color: t.brand, fontWeight: 600,
                letterSpacing: 3, fontFamily: t.monoFont,
              }}>CMD // OPERATOR-01</div>
              <div style={{
                fontSize: 15, fontWeight: 600, letterSpacing: -0.3,
                fontFamily: t.displayFont,
              }}>
                ArenaRoot Command Center
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* Pills: LV, credits, uptime */}
          <StatPill t={t} label="LV" value="12" accent={t.brand} />
          <StatPill t={t} label="CREDITS" value="2,480" accent={t.accent2} />
          <StatPill t={t} label="CREW" value={`${online}/${MEMBERS.length}`} accent={t.accent} />
          <StatPill t={t} label="UPTIME" value="6d 04h" accent={t.fgMuted} />
        </div>

        {/* Main */}
        <div style={{
          flex: 1, overflow: 'hidden', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14, position: 'relative',
        }}>
          {/* Mission briefing bar */}
          <div style={{
            display: 'flex', alignItems: 'stretch', gap: 12,
            padding: '14px 18px',
            background: 'linear-gradient(90deg, rgba(79,209,255,0.10) 0%, rgba(79,209,255,0.02) 100%)',
            border: `1px solid ${t.border}`,
            borderLeft: `3px solid ${t.brand}`,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', top: -1, right: 18,
              padding: '1px 10px', background: t.brand, color: '#0a1220',
              fontSize: 10, fontWeight: 700, letterSpacing: 2,
              fontFamily: t.monoFont,
            }}>MISSION // DAILY</div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 16, fontWeight: 600, letterSpacing: -0.2,
                fontFamily: t.displayFont, color: t.fg,
              }}>
                결재 대기열 정리 — 4건 승인/거절
              </div>
              <div style={{
                fontSize: 11, color: t.fgMuted, marginTop: 4, letterSpacing: 1,
                fontFamily: t.monoFont,
              }}>
                REWARD: +200 XP · +50 CREDITS · UNLOCK: [AUDIT-LOG-VIEWER]
              </div>
            </div>
            <SfButton t={t} primary>EXECUTE →</SfButton>
          </div>

          {/* 3-col */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1.3fr 1fr',
            gap: 12, flex: 1, minHeight: 0,
          }}>
            {/* Crew roster */}
            <SfPanel t={t} title="CREW_ROSTER" count={`${MEMBERS.length}`} countColor={t.brand}>
              {MEMBERS.slice(0, 6).map(m => {
                const lv = { jiwoo: 24, harin: 18, minjun: 20, seoyeon: 15, daeho: 7, yuna: 11 }[m.id] || 10;
                const sColor = m.status === 'online' ? t.success :
                               m.status === 'connecting' ? t.warning :
                               m.status === 'offline-connection' ? t.danger : t.fgSubtle;
                const sLabel = m.status === 'online' ? 'ACTIVE' :
                               m.status === 'connecting' ? 'SYNC' :
                               m.status === 'offline-connection' ? 'LOST' : 'STBY';
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', marginBottom: 2,
                    background: m.status === 'online' ? 'rgba(93,232,168,0.05)' : 'transparent',
                    borderLeft: `2px solid ${sColor}`,
                    position: 'relative',
                  }}>
                    <div style={{
                      width: 32, height: 32,
                      background: 'rgba(120,200,255,0.08)',
                      border: `1px solid ${t.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: t.brand,
                      fontFamily: t.monoFont,
                      clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))',
                    }}>{m.name.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.fg }}>{m.name}</span>
                        <span style={{
                          fontSize: 9, color: t.brand, fontWeight: 700, letterSpacing: 1.5,
                          fontFamily: t.monoFont,
                        }}>LV{lv}</span>
                      </div>
                      <div style={{
                        fontSize: 10, color: t.fgMuted, letterSpacing: 0.5,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{m.role}</div>
                    </div>
                    <div style={{
                      fontSize: 9, color: sColor, fontWeight: 700,
                      letterSpacing: 1.5, fontFamily: t.monoFont,
                      padding: '2px 6px',
                      border: `1px solid ${sColor}`,
                      background: `${sColor}10`,
                    }}>{sLabel}</div>
                  </div>
                );
              })}
            </SfPanel>

            {/* Operations */}
            <SfPanel t={t} title="OPERATIONS_LIVE" count={`${ACTIVE_MEETINGS.length}`} countColor={t.accent} pulse>
              {ACTIVE_MEETINGS.map(mt => {
                const p = PROJECTS.find(x => x.id === mt.project);
                const sColor = mt.state === 'WORKING' ? t.success :
                               mt.state === 'CONSENSUS' ? t.warning : t.brand;
                const pct = mt.state === 'WORKING' ? 60 : mt.state === 'CONSENSUS' ? 30 : 85;
                return (
                  <div key={mt.id} style={{
                    padding: '11px 12px', marginBottom: 8,
                    background: 'rgba(120,200,255,0.04)',
                    border: `1px solid ${t.border}`,
                    borderTop: `1px solid ${sColor}60`,
                    position: 'relative',
                  }}>
                    {/* Corner accents */}
                    <div style={{ position: 'absolute', top: -1, left: -1, width: 6, height: 6, borderTop: `1px solid ${sColor}`, borderLeft: `1px solid ${sColor}` }} />
                    <div style={{ position: 'absolute', top: -1, right: -1, width: 6, height: 6, borderTop: `1px solid ${sColor}`, borderRight: `1px solid ${sColor}` }} />

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
                        color: sColor, fontFamily: t.monoFont,
                        padding: '2px 6px', border: `1px solid ${sColor}`,
                      }}>{mt.id}</span>
                      <span style={{
                        fontSize: 13, fontWeight: 500, flex: 1,
                        color: t.fg, letterSpacing: -0.1,
                      }}>{mt.topic}</span>
                      <span style={{
                        fontSize: 10, color: t.fgMuted, fontFamily: t.monoFont, letterSpacing: 0.5,
                      }}>T+{mt.elapsed}</span>
                    </div>

                    {/* Segmented progress bar */}
                    <div style={{
                      display: 'flex', gap: 2, marginBottom: 7, height: 4,
                    }}>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} style={{
                          flex: 1,
                          background: i < Math.round(pct/100*12)
                            ? sColor
                            : 'rgba(120,200,255,0.08)',
                          boxShadow: i < Math.round(pct/100*12) ? `0 0 4px ${sColor}` : 'none',
                        }} />
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 10, color: t.fgMuted,
                        fontFamily: t.monoFont, letterSpacing: 0.5,
                      }}>
                        {p?.name}
                      </span>
                      <div style={{ flex: 1 }} />
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
                        color: sColor, fontFamily: t.monoFont,
                      }}>◆ {mt.state}</span>
                      <div style={{ display: 'flex', marginLeft: 4 }}>
                        {mt.members.slice(0, 3).map((mid, i) => {
                          const mm = MEMBERS.find(x => x.id === mid);
                          return (
                            <div key={mid} style={{
                              marginLeft: i ? -3 : 0,
                              width: 18, height: 18,
                              background: 'rgba(120,200,255,0.10)',
                              border: `1px solid ${t.border}`,
                              fontSize: 9, fontWeight: 700, color: t.brand,
                              fontFamily: t.monoFont,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
                            }}>{mm.name.charAt(0)}</div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </SfPanel>

            {/* Approval queue */}
            <SfPanel t={t} title="INCOMING_REQ" count={`${APPROVAL_QUEUE.length}`} countColor={t.danger} alert>
              {APPROVAL_QUEUE.slice(0, 2).map(a => {
                const m = MEMBERS.find(x => x.id === a.requester);
                return (
                  <div key={a.id} style={{
                    padding: '11px 12px', marginBottom: 9,
                    background: 'rgba(255,107,138,0.04)',
                    border: `1px solid ${t.border}`,
                    borderLeft: `2px solid ${t.danger}`,
                    position: 'relative',
                  }}>
                    <div style={{ position: 'absolute', top: -1, right: -1, width: 6, height: 6, borderTop: `1px solid ${t.danger}`, borderRight: `1px solid ${t.danger}` }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                      <div style={{
                        width: 22, height: 22,
                        background: 'rgba(120,200,255,0.08)',
                        border: `1px solid ${t.border}`,
                        fontSize: 10, fontWeight: 700, color: t.brand,
                        fontFamily: t.monoFont,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        clipPath: 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
                      }}>{m.name.charAt(0)}</div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.fg }}>{m.name}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{
                        fontSize: 9, color: t.danger, fontFamily: t.monoFont,
                        letterSpacing: 1.5, fontWeight: 700,
                      }}>◆ PENDING · {a.time}</span>
                    </div>
                    <div style={{
                      fontSize: 12, color: t.fg, marginBottom: 9, lineHeight: 1.45,
                      paddingLeft: 2,
                    }}>
                      {a.summary}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <SfButton t={t} success sm>APPROVE</SfButton>
                      <SfButton t={t} sm>CONDITION</SfButton>
                      <SfButton t={t} danger sm>DENY</SfButton>
                    </div>
                  </div>
                );
              })}
              {APPROVAL_QUEUE.length > 2 && (
                <div style={{
                  textAlign: 'center', padding: '6px',
                  fontSize: 10, color: t.fgMuted, letterSpacing: 1.5,
                  fontFamily: t.monoFont,
                }}>
                  +{APPROVAL_QUEUE.length - 2} QUEUED ↓
                </div>
              )}
            </SfPanel>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function StatPill({ t, label, value, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '5px 12px',
      background: 'rgba(120,200,255,0.06)',
      border: `1px solid ${t.border}`,
      clipPath: 'polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%)',
    }}>
      <span style={{
        fontSize: 9, fontFamily: t.monoFont, letterSpacing: 1.5,
        color: t.fgMuted, fontWeight: 600,
      }}>{label}</span>
      <span style={{
        fontSize: 13, fontWeight: 700, color: accent,
        fontFamily: t.displayFont, letterSpacing: -0.2,
      }}>{value}</span>
    </div>
  );
}

function SfButton({ t, children, primary, success, danger, sm }) {
  const c = success ? t.success : danger ? t.danger : primary ? t.brand : t.fg;
  const bg = success ? 'rgba(93,232,168,0.12)' : danger ? 'rgba(255,107,138,0.12)' : primary ? 'rgba(79,209,255,0.12)' : 'rgba(120,200,255,0.06)';
  return (
    <button style={{
      padding: sm ? '5px 10px' : '8px 16px',
      background: bg,
      color: c, border: `1px solid ${c}60`,
      fontSize: sm ? 10 : 12, fontWeight: 700,
      fontFamily: t.monoFont, letterSpacing: 1.5,
      cursor: 'pointer',
      clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%, 6px 50%)',
    }}>{children}</button>
  );
}

function SfPanel({ t, title, count, countColor, children, pulse, alert }) {
  return (
    <div style={{
      background: t.bgElev,
      backdropFilter: 'blur(12px)',
      border: `1px solid ${t.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Top chrome */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 14px',
        background: 'linear-gradient(180deg, rgba(120,200,255,0.08), rgba(120,200,255,0.02))',
        borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{
          width: 6, height: 6, background: countColor,
          boxShadow: pulse || alert ? `0 0 6px ${countColor}` : 'none',
          clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          color: t.fg, fontFamily: t.monoFont,
        }}>{title}</span>
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1,
          color: countColor, fontFamily: t.monoFont,
          padding: '1px 8px',
          border: `1px solid ${countColor}60`,
          background: `${countColor}10`,
        }}>{count}</span>
      </div>
      {/* Corner accents */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${t.brand}`, borderLeft: `1px solid ${t.brand}`, opacity: 0.7 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${t.brand}`, borderRight: `1px solid ${t.brand}`, opacity: 0.7 }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${t.brand}`, borderLeft: `1px solid ${t.brand}`, opacity: 0.7 }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${t.brand}`, borderRight: `1px solid ${t.brand}`, opacity: 0.7 }} />

      <div style={{ padding: 8, flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 5 — Neo-Retro Terminal (amber CRT, 8-bit office)
// ─────────────────────────────────────────────────────────────────────
const themeRetro = {
  bgCanvas: '#0d1420',
  bgElev: '#141c2e',
  bgSunk: '#0a101a',
  fg: '#88a8d4',
  fgMuted: '#5a7090',
  fgSubtle: '#3a4a65',
  border: '#2a3850',
  borderSoft: '#1a2438',
  brand: '#7ba8d8',
  brandBright: '#b8d4f0',
  accent: '#5fa8d3',
  success: '#7ac29a',
  warning: '#d4b87a',
  danger: '#c27a7a',
  font: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace',
  displayFont: '"JetBrains Mono", monospace',
  monoFont: '"JetBrains Mono", monospace',
  avatarBgEmoji: '#1a2438',
  avatarRadius: 2,
  avatarStyle: 'initials',
  railBg: '#0a101a',
  railExtra: { borderRight: '1px solid #2a3850' },
  logoBg: '#7ba8d8',
  logoFg: '#0d1420',
  logoRadius: 2,
  logoShadow: '0 0 12px rgba(123,168,216,0.5)',
  iconFg: '#5a7090',
  iconActiveBg: '#1a2438',
  iconActiveFg: '#b8d4f0',
  iconActiveShadow: '0 0 8px rgba(123,168,216,0.35), inset 0 0 0 1px #7ba8d8',
  iconRadius: 2,
  badgeBg: '#c27a7a',
  badgeFg: '#fff',
  projectBg: '#0d1420',
  itemActiveBg: '#1a2438',
  itemActiveFg: '#b8d4f0',
  itemRadius: 0,
  unreadBg: '#7ba8d8',
  unreadFg: '#0d1420',
};

// ASCII art office
function AsciiOffice() {
  return (
    <pre style={{
      fontFamily: 'inherit', fontSize: 9, lineHeight: 1.15,
      color: '#7ba8d8', margin: 0, textShadow: '0 0 4px rgba(123,168,216,0.5)',
      opacity: 0.85,
    }}>{String.raw`
  ┌─────────────────────────┐       ○ ○ ○
  │  [ROLESTRA OS v0.4.1]   │     ╔═══════╗
  │  > CONNECTED            │     ║ ▓▓▓▓▓ ║
  │  > 3 CREW ACTIVE        │     ║ ░░░░░ ║
  └─────────────────────────┘     ╚═══════╝
         ▀▀▀▀▀▀▀▀▀▀▀▀             │   │
                               ═══╧═══╧═══
`}</pre>
  );
}

function V5_Retro() {
  const t = themeRetro;
  const online = MEMBERS.filter(m => m.status === 'online').length;
  return (
    <VariantFrame theme={t}>
      {/* CRT overlay */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
        background: 'repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 3px)',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 101,
        background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
      }} />
      <LeftRail theme={t} />
      <ProjectRail theme={t} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          padding: '10px 20px', borderBottom: `1px solid ${t.border}`,
          background: t.bgSunk, display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 11, color: t.fgMuted, letterSpacing: 2 }}>
            ROLESTRA<span style={{ color: t.accent }}>.</span>OS
          </div>
          <div style={{ color: t.border }}>│</div>
          <div style={{ fontSize: 12, color: t.brandBright, letterSpacing: 1, textShadow: `0 0 6px ${t.brand}80` }}>
            /office/dashboard
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: t.fgMuted, letterSpacing: 1 }}>
            <span style={{ color: t.success }}>●</span> HYBRID_MODE <span style={{ margin: '0 8px', color: t.border }}>│</span>
            14:23:06 KST <span style={{ margin: '0 8px', color: t.border }}>│</span>
            UPTIME 6d 14h
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden' }}>
          {/* Hero terminal */}
          <div style={{
            background: t.bgSunk,
            border: `1px solid ${t.border}`,
            display: 'flex', gap: 16, alignItems: 'stretch', minHeight: 150,
          }}>
            <div style={{
              flex: 1, padding: '14px 18px',
              borderRight: `1px solid ${t.border}`,
            }}>
              <div style={{ fontSize: 11, color: t.fgMuted, marginBottom: 6 }}>
                $ rolestra status --today
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                <div><span style={{ color: t.fgMuted }}>&gt; </span>
                  <span style={{ color: t.brandBright, textShadow: `0 0 6px ${t.brand}60` }}>{online} crew online</span>
                  <span style={{ color: t.fgSubtle }}> · {MEMBERS.length - online} offline</span>
                </div>
                <div><span style={{ color: t.fgMuted }}>&gt; </span>
                  <span style={{ color: t.success }}>{ACTIVE_MEETINGS.length} active meetings</span>
                  <span style={{ color: t.fgSubtle }}> · ETA variable</span>
                </div>
                <div><span style={{ color: t.fgMuted }}>&gt; </span>
                  <span style={{ color: t.warning, textShadow: `0 0 4px ${t.warning}60` }}>{APPROVAL_QUEUE.length} approvals pending</span>
                  <span style={{ color: t.fgSubtle }}> · oldest: 1h ago</span>
                </div>
                <div><span style={{ color: t.fgMuted }}>&gt; </span>
                  <span style={{ color: t.fg }}>4 tasks completed</span>
                  <span style={{ color: t.fgSubtle }}> · weekly: 17</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: t.fgMuted }}>$ </span>
                  <span style={{
                    display: 'inline-block', width: 8, height: 14,
                    background: t.brandBright, verticalAlign: 'text-bottom',
                    boxShadow: `0 0 6px ${t.brand}`,
                    animation: 'retro-blink 1.06s infinite step-end',
                  }} />
                </div>
              </div>
            </div>
            <div style={{
              width: 280, padding: '10px 14px',
              background: 'rgba(0,0,0,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AsciiOffice />
            </div>
          </div>
          <style>{`@keyframes retro-blink { 50% { opacity: 0; } }`}</style>

          {/* 3-col */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 12, flex: 1, minHeight: 0 }}>
            <RetroPanel t={t} title="./crew" count={MEMBERS.length}>
              <div style={{ fontSize: 10, color: t.fgSubtle, padding: '2px 0 4px', borderBottom: `1px solid ${t.borderSoft}` }}>
                <span style={{ display: 'inline-block', width: '30%' }}>NAME</span>
                <span style={{ display: 'inline-block', width: '35%' }}>ROLE</span>
                <span style={{ display: 'inline-block', width: '20%' }}>CLI</span>
                <span style={{ display: 'inline-block', width: '15%', textAlign: 'right' }}>STATUS</span>
              </div>
              {MEMBERS.slice(0, 5).map(m => (
                <div key={m.id} style={{
                  fontSize: 11, padding: '5px 0',
                  borderBottom: `1px solid ${t.borderSoft}`,
                  color: m.status === 'online' ? t.brandBright : t.fgMuted,
                  textShadow: m.status === 'online' ? `0 0 4px ${t.brand}60` : 'none',
                }}>
                  <span style={{ display: 'inline-block', width: '30%' }}>
                    {m.status === 'online' ? '● ' : m.status === 'connecting' ? '◐ ' : '○ '}{m.name}
                  </span>
                  <span style={{
                    display: 'inline-block', width: '35%',
                    color: t.fgMuted, whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{m.role}</span>
                  <span style={{ display: 'inline-block', width: '20%', color: t.accent }}>{m.cliId}</span>
                  <span style={{
                    display: 'inline-block', width: '15%', textAlign: 'right',
                    color: m.status === 'online' ? t.success :
                           m.status === 'connecting' ? t.warning :
                           m.status === 'offline-connection' ? t.danger : t.fgSubtle,
                  }}>
                    {m.status === 'online' ? 'UP' :
                     m.status === 'connecting' ? '...' :
                     m.status === 'offline-connection' ? 'ERR' : 'OFF'}
                  </span>
                </div>
              ))}
              <div style={{ padding: '8px 0 2px', fontSize: 10, color: t.fgSubtle }}>
                <span style={{ color: t.fgMuted }}>$ </span>rolestra crew --help
              </div>
            </RetroPanel>

            <RetroPanel t={t} title="./tasks" count={ACTIVE_MEETINGS.length}>
              {ACTIVE_MEETINGS.map(mt => {
                const p = PROJECTS.find(x => x.id === mt.project);
                const pct = mt.state === 'WORKING' ? 60 : mt.state === 'CONSENSUS' ? 30 : 85;
                const stateColor = mt.state === 'WORKING' ? t.success :
                                   mt.state === 'CONSENSUS' ? t.warning : t.accent;
                return (
                  <div key={mt.id} style={{
                    padding: '8px 0', borderBottom: `1px solid ${t.borderSoft}`,
                    fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: t.accent }}>[{mt.id}]</span>
                      <span style={{ color: t.brandBright, flex: 1, textShadow: `0 0 4px ${t.brand}40` }}>{mt.topic}</span>
                      <span style={{ color: t.fgMuted }}>t+{mt.elapsed}</span>
                    </div>
                    <div style={{
                      display: 'flex', gap: 2, alignItems: 'center',
                      fontFamily: 'inherit', marginTop: 4,
                    }}>
                      <span style={{ color: t.fgMuted, fontSize: 10 }}>{p?.name.slice(0, 12)}</span>
                      <span style={{ color: t.border, margin: '0 6px' }}>│</span>
                      {/* ASCII progress bar */}
                      <span style={{ color: stateColor, letterSpacing: 0, fontSize: 11, textShadow: `0 0 4px ${stateColor}60` }}>
                        [{'█'.repeat(Math.floor(pct / 10))}{'░'.repeat(10 - Math.floor(pct / 10))}]
                      </span>
                      <span style={{ color: stateColor, fontSize: 10, marginLeft: 6 }}>{mt.state}</span>
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: '8px 0 2px', fontSize: 10, color: t.fgSubtle }}>
                <span style={{ color: t.fgMuted }}>$ </span>tail -f ./log/tasks.log
              </div>
            </RetroPanel>

            <RetroPanel t={t} title="./approvals" count={APPROVAL_QUEUE.length} danger>
              {APPROVAL_QUEUE.slice(0, 2).map(a => {
                const m = MEMBERS.find(x => x.id === a.requester);
                return (
                  <div key={a.id} style={{
                    padding: '6px 0', borderBottom: `1px solid ${t.borderSoft}`,
                    fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ color: t.warning }}>!</span>
                      <span style={{ color: t.brandBright, textShadow: `0 0 4px ${t.brand}40` }}>{m.name}</span>
                      <span style={{ color: t.fgMuted }}>requests:</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ color: t.fgSubtle, fontSize: 10 }}>{a.time}</span>
                    </div>
                    <div style={{
                      padding: '4px 8px', marginTop: 4,
                      background: 'rgba(0,0,0,0.3)',
                      borderLeft: `2px solid ${t.warning}`,
                      fontSize: 11, color: t.fg,
                    }}>
                      "{a.summary}"
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10 }}>
                      <RetroBtn t={t} key="y" color={t.success}>[Y] ALLOW</RetroBtn>
                      <RetroBtn t={t} key="c" color={t.fg}>[C] COND</RetroBtn>
                      <RetroBtn t={t} key="n" color={t.danger}>[N] DENY</RetroBtn>
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: '6px 0 2px', fontSize: 10, color: t.fgSubtle }}>
                <span style={{ color: t.fgMuted }}>$ </span>press [Y/C/N] or click
              </div>
            </RetroPanel>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function RetroPanel({ t, title, count, children, danger }) {
  const accent = danger ? t.danger : t.brand;
  return (
    <div style={{
      background: t.bgElev, border: `1px solid ${t.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        padding: '4px 10px', borderBottom: `1px solid ${t.border}`,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(0,0,0,0.3)',
      }}>
        <span style={{
          color: accent, fontSize: 11, letterSpacing: 1,
          textShadow: `0 0 4px ${accent}60`,
        }}>┌─ {title}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: t.fgMuted }}>[{count}]</span>
      </div>
      <div style={{ padding: '8px 12px', flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function RetroBtn({ t, children, color }) {
  return (
    <span style={{
      padding: '1px 6px', border: `1px solid ${color}`, color,
      fontSize: 10, cursor: 'pointer', letterSpacing: 1,
      textShadow: `0 0 4px ${color}60`,
    }}>{children}</span>
  );
}

Object.assign(window, {
  V3_Illustrated, V4_Game, V5_Retro,
  themeIllus, themeGame, themeRetro,
});
