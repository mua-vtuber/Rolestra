// Five dashboard variants for Rolestra — rendered inside DCArtboards
// Shared data: MEMBERS, PROJECTS, ACTIVE_MEETINGS, APPROVAL_QUEUE, QUEUE_ITEMS, RECENT_MESSAGES

const AB_W = 1280;
const AB_H = 820;

// ─────────────────────────────────────────────────────────────────────
// Shared primitives — each variant restyles these via a theme object
// ─────────────────────────────────────────────────────────────────────
const DEFAULT_AVATAR = 'emoji';
function MiniAvatar({ member, size = 28, theme, ring }) {
  if (!member) return null;
  const avatarStyle = theme.avatarStyle || DEFAULT_AVATAR;
  const content = avatarStyle === 'emoji' ? member.emoji : member.initials;
  return (
    <div style={{
      width: size, height: size, borderRadius: theme.avatarRadius ?? size / 2,
      background: avatarStyle === 'emoji' ? theme.avatarBgEmoji : member.color,
      color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * (avatarStyle === 'emoji' ? 0.55 : 0.42),
      fontWeight: 700,
      boxShadow: ring ? `0 0 0 2px ${theme.bgElev}` : 'none',
      flexShrink: 0,
      fontFamily: theme.font,
    }}>{content}</div>
  );
}

function VariantFrame({ theme, children }) {
  return (
    <div style={{
      width: AB_W, height: AB_H,
      background: theme.bgCanvas,
      color: theme.fg,
      fontFamily: theme.font,
      display: 'flex',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {children}
    </div>
  );
}

// Generic left rail — shared shell, each variant pushes its own theme through
function LeftRail({ theme, active = 'dashboard' }) {
  const items = [
    { id: 'dashboard', icon: '🏢', label: '사무실' },
    { id: 'messenger', icon: '💬', label: '메신저' },
    { id: 'approval', icon: '🔔', label: '승인함', badge: APPROVAL_QUEUE.length },
    { id: 'queue', icon: '▤', label: '큐' },
    { id: 'settings', icon: '⚙', label: '설정' },
  ];
  return (
    <div style={{
      width: 64, background: theme.railBg, borderRight: `1px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 14, gap: 8, flexShrink: 0,
      ...theme.railExtra,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: theme.logoRadius,
        background: theme.logoBg, color: theme.logoFg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 16, marginBottom: 6,
        fontFamily: theme.displayFont || theme.font,
        boxShadow: theme.logoShadow,
      }}>R</div>
      {items.map(it => {
        const isActive = it.id === active;
        return (
          <div key={it.id} style={{
            width: 44, height: 44, borderRadius: theme.iconRadius,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isActive ? theme.iconActiveBg : 'transparent',
            color: isActive ? theme.iconActiveFg : theme.iconFg,
            fontSize: 18, position: 'relative', cursor: 'pointer',
            boxShadow: isActive ? theme.iconActiveShadow : 'none',
          }}>
            {it.icon}
            {it.badge > 0 && (
              <div style={{
                position: 'absolute', top: 2, right: 2,
                minWidth: 16, height: 16, borderRadius: 8,
                background: theme.badgeBg, color: theme.badgeFg,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px',
              }}>{it.badge}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Project switcher — middle column
function ProjectRail({ theme }) {
  const activeId = 'p-blog';
  return (
    <div style={{
      width: 240, background: theme.projectBg, borderRight: `1px solid ${theme.border}`,
      flexShrink: 0, padding: '14px 10px', display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
        color: theme.fgSubtle, padding: '4px 10px 8px',
      }}>프로젝트</div>
      {PROJECTS.map(p => {
        const isActive = p.id === activeId;
        return (
          <div key={p.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: theme.itemRadius,
            background: isActive ? theme.itemActiveBg : 'transparent',
            color: isActive ? theme.itemActiveFg : theme.fg,
            fontSize: 13, fontWeight: isActive ? 600 : 500,
            opacity: p.status === 'folder_missing' ? 0.55 : 1,
            cursor: 'pointer',
          }}>
            <span style={{ fontSize: 16, filter: p.status === 'folder_missing' ? 'grayscale(1)' : 'none' }}>
              {p.icon}
            </span>
            <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.name}
            </span>
            {p.kind === 'external' && (
              <span style={{ fontSize: 10, color: theme.fgSubtle }}>↗</span>
            )}
            {p.status === 'folder_missing' && (
              <span style={{ fontSize: 10, color: theme.danger }}>⚠</span>
            )}
            {p.unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px',
                borderRadius: 9, background: theme.unreadBg, color: theme.unreadFg,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{p.unread}</span>
            )}
          </div>
        );
      })}
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
        color: theme.fgSubtle, padding: '16px 10px 8px',
      }}>1:1 대화</div>
      {DMS.slice(0, 3).map(dm => {
        const m = MEMBERS.find(x => x.id === dm.memberId);
        return (
          <div key={dm.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 10px', borderRadius: theme.itemRadius,
            fontSize: 13,
          }}>
            <MiniAvatar member={m} size={20} theme={theme} />
            <span style={{ flex: 1 }}>{m.name}</span>
            {dm.unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, borderRadius: 9,
                background: theme.unreadBg, color: theme.unreadFg,
                fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{dm.unread}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 1 — Claude Warm (orange/amber)
// ─────────────────────────────────────────────────────────────────────
const themeClaude = {
  bgCanvas: '#faf7f2',
  bgElev: '#ffffff',
  bgSunk: '#f4ede2',
  fg: '#2d1f11',
  fgMuted: '#7a6a55',
  fgSubtle: '#a89980',
  border: '#ecd9bd',
  borderSoft: '#f4e6ce',
  brand: '#c96f3a',
  brandSoft: '#fbe7d4',
  brandSoftFg: '#8a4520',
  accent: '#e8a866',
  success: '#6b8e4e',
  warning: '#d4913f',
  danger: '#b85450',
  font: '"Inter", -apple-system, BlinkMacSystemFont, "Pretendard", sans-serif',
  displayFont: '"Fraunces", "Inter", serif',
  monoFont: '"JetBrains Mono", ui-monospace, monospace',
  avatarBgEmoji: 'transparent',
  avatarRadius: 18,
  avatarStyle: 'emoji',
  railBg: '#f4e6ce',
  railExtra: {},
  logoBg: '#c96f3a',
  logoFg: '#fff',
  logoRadius: 10,
  logoShadow: '0 2px 8px rgba(201,111,58,0.35)',
  iconFg: '#8a7456',
  iconActiveBg: '#fff',
  iconActiveFg: '#c96f3a',
  iconActiveShadow: '0 2px 6px rgba(45,31,17,0.08)',
  iconRadius: 10,
  badgeBg: '#b85450',
  badgeFg: '#fff',
  projectBg: '#fdf9f1',
  itemActiveBg: '#fbe7d4',
  itemActiveFg: '#8a4520',
  itemRadius: 6,
  unreadBg: '#c96f3a',
  unreadFg: '#fff',
};

function V1_Claude() {
  const t = themeClaude;
  const online = MEMBERS.filter(m => m.status === 'online').length;
  return (
    <VariantFrame theme={t}>
      <LeftRail theme={t} />
      <ProjectRail theme={t} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top bar */}
        <div style={{
          padding: '14px 24px', borderBottom: `1px solid ${t.border}`,
          background: t.bgElev, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: t.displayFont, letterSpacing: -0.3 }}>
              사무실
            </div>
            <div style={{ fontSize: 12, color: t.fgMuted, marginTop: 2 }}>
              오늘의 1인회사 현황 · 4/19 금요일
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              fontSize: 12, fontFamily: t.monoFont,
              padding: '6px 10px', borderRadius: 999,
              background: t.brandSoft, color: t.brandSoftFg, fontWeight: 600,
            }}>hybrid 권한</div>
            <MiniAvatar member={MEMBERS[3]} size={30} theme={t} />
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflowY: 'hidden', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Hero */}
          <div style={{
            background: `linear-gradient(135deg, ${t.brand} 0%, #e8a866 100%)`,
            color: '#fff', borderRadius: 14, padding: '22px 26px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            boxShadow: '0 6px 20px rgba(201,111,58,0.25)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', right: -40, top: -40, width: 200, height: 200,
              borderRadius: '50%', background: 'rgba(255,255,255,0.12)',
            }} />
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase' }}>
                좋은 오후입니다, 대표님
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, fontFamily: t.displayFont, letterSpacing: -0.5 }}>
                {online}명 출근 · {ACTIVE_MEETINGS.length}건 회의 · {APPROVAL_QUEUE.length}건 결재
              </div>
              <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
                오늘 4건 완료 · 이번 주 17건 · 연속 6일째 🔥
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
              <button style={{
                padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.22)', color: '#fff',
                border: '1px solid rgba(255,255,255,0.4)', fontWeight: 600,
                fontSize: 13, fontFamily: 'inherit',
              }}>+ 새 프로젝트</button>
              <button style={{
                padding: '10px 14px', borderRadius: 8,
                background: '#fff', color: t.brand, border: 'none',
                fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
              }}>회의 소집 →</button>
            </div>
          </div>

          {/* 3-col widgets */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
            {/* Members */}
            <ClaudeWidget t={t} title="직원" icon="👥" badge={`${MEMBERS.length}명`}>
              {MEMBERS.slice(0, 5).map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 4px', borderBottom: `1px solid ${t.borderSoft}`,
                }}>
                  <MiniAvatar member={m} size={32} theme={t} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {m.name} <span style={{ color: t.fgMuted, fontWeight: 400 }}>· {m.role}</span>
                    </div>
                    <div style={{ fontSize: 11, color: t.fgSubtle, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {m.cli}
                    </div>
                  </div>
                  <StatusDot status={m.status} t={t} />
                </div>
              ))}
            </ClaudeWidget>

            {/* Tasks */}
            <ClaudeWidget t={t} title="진행 중 업무" icon="📋" badge={`${ACTIVE_MEETINGS.length}건`}>
              {ACTIVE_MEETINGS.map(mt => {
                const p = PROJECTS.find(x => x.id === mt.project);
                const stateColor = mt.state === 'WORKING' ? t.success :
                                   mt.state === 'CONSENSUS' ? t.warning : t.brand;
                return (
                  <div key={mt.id} style={{
                    padding: '10px 6px', borderBottom: `1px solid ${t.borderSoft}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: t.fgSubtle, fontFamily: t.monoFont }}>{mt.id}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{mt.topic}</span>
                      <span style={{ fontSize: 11, color: t.fgMuted }}>{mt.elapsed}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: t.fgMuted }}>{p?.icon} {p?.name}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: stateColor, fontWeight: 700, letterSpacing: 0.5 }}>
                        ● {mt.state}
                      </span>
                      <div style={{ display: 'flex' }}>
                        {mt.members.slice(0, 3).map((mid, i) => (
                          <div key={mid} style={{ marginLeft: i ? -6 : 0 }}>
                            <MiniAvatar member={MEMBERS.find(x => x.id === mid)} size={18} theme={t} ring />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.fgMuted, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
                  오늘 통계
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <StatBox t={t} value="4" label="완료" color={t.success} />
                  <StatBox t={t} value="17" label="주간" color={t.brand} />
                  <StatBox t={t} value="1" label="실패" color={t.danger} />
                </div>
              </div>
            </ClaudeWidget>

            {/* Approvals */}
            <ClaudeWidget t={t} title="결재 대기" icon="🔔" badge={`${APPROVAL_QUEUE.length}건`} badgeColor={t.danger}>
              {APPROVAL_QUEUE.slice(0, 2).map(a => {
                const m = MEMBERS.find(x => x.id === a.requester);
                const p = PROJECTS.find(x => x.id === a.project);
                return (
                  <div key={a.id} style={{
                    padding: '10px 6px', borderBottom: `1px solid ${t.borderSoft}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <MiniAvatar member={m} size={22} theme={t} />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</span>
                      <span style={{ fontSize: 11, color: t.fgSubtle }}>{p?.icon} {p?.name}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 11, color: t.fgMuted }}>{a.time}</span>
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.4 }}>{a.summary}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <PillBtn t={t} variant="success">✓ 허가</PillBtn>
                      <PillBtn t={t}>조건부</PillBtn>
                      <PillBtn t={t} variant="danger">거절</PillBtn>
                    </div>
                  </div>
                );
              })}
              <div style={{ paddingTop: 8, textAlign: 'center' }}>
                <span style={{ fontSize: 12, color: t.brand, fontWeight: 600 }}>
                  승인함 전체 보기 →
                </span>
              </div>
            </ClaudeWidget>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function ClaudeWidget({ t, title, icon, badge, badgeColor, children }) {
  return (
    <div style={{
      background: t.bgElev, border: `1px solid ${t.border}`, borderRadius: 12,
      boxShadow: '0 1px 3px rgba(45,31,17,0.04)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px', borderBottom: `1px solid ${t.borderSoft}`,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
        <div style={{ flex: 1 }} />
        {badge && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
            background: badgeColor ? badgeColor + '20' : t.brandSoft,
            color: badgeColor || t.brandSoftFg,
          }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: '6px 10px', flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function StatusDot({ status, t }) {
  const map = {
    online: { c: t.success, l: '출근' },
    connecting: { c: t.warning, l: '연결중' },
    'offline-connection': { c: t.danger, l: '연결끊김' },
    'offline-manual': { c: t.fgSubtle, l: '퇴근' },
  };
  const s = map[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 7, height: 7, borderRadius: 4, background: s.c }} />
      <span style={{ fontSize: 10, color: t.fgMuted, fontWeight: 600 }}>{s.l}</span>
    </div>
  );
}

function StatBox({ t, value, label, color }) {
  return (
    <div style={{
      background: t.bgSunk, borderRadius: 8, padding: '8px 10px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1, fontFamily: t.displayFont }}>{value}</div>
      <div style={{ fontSize: 10, color: t.fgMuted, marginTop: 3 }}>{label}</div>
    </div>
  );
}

function PillBtn({ t, variant, children }) {
  const bg = variant === 'success' ? t.success : variant === 'danger' ? t.danger : t.bgSunk;
  const fg = variant ? '#fff' : t.fg;
  return (
    <button style={{
      padding: '5px 10px', borderRadius: 6, background: bg, color: fg,
      border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 2 — Cyber Glow (dark, neon, restrained)
// ─────────────────────────────────────────────────────────────────────
const themeCyber = {
  bgCanvas: '#0a0e1a',
  bgElev: '#11162a',
  bgSunk: '#070a14',
  fg: '#e8ecfa',
  fgMuted: '#7a85a8',
  fgSubtle: '#4a5278',
  border: '#222845',
  borderSoft: '#171c30',
  brand: '#8b6bff',
  brandGlow: '#a88cff',
  accent: '#40d8ff',
  success: '#5cffb8',
  warning: '#ffcd42',
  danger: '#ff4d88',
  font: '"IBM Plex Sans", -apple-system, sans-serif',
  displayFont: '"Space Grotesk", sans-serif',
  monoFont: '"JetBrains Mono", monospace',
  avatarBgEmoji: '#1c2340',
  avatarRadius: 4,
  avatarStyle: 'emoji',
  railBg: '#06091a',
  railExtra: { boxShadow: 'inset -1px 0 0 rgba(139,107,255,0.15)' },
  logoBg: 'linear-gradient(135deg,#8b6bff,#40d8ff)',
  logoFg: '#fff',
  logoRadius: 8,
  logoShadow: '0 0 20px rgba(139,107,255,0.5), 0 0 4px rgba(64,216,255,0.8)',
  iconFg: '#4a5278',
  iconActiveBg: 'rgba(139,107,255,0.15)',
  iconActiveFg: '#a88cff',
  iconActiveShadow: '0 0 12px rgba(139,107,255,0.35), inset 0 0 0 1px rgba(139,107,255,0.4)',
  iconRadius: 8,
  badgeBg: '#ff4d88',
  badgeFg: '#fff',
  projectBg: '#0c1120',
  itemActiveBg: 'rgba(139,107,255,0.1)',
  itemActiveFg: '#a88cff',
  itemRadius: 4,
  unreadBg: 'rgba(64,216,255,0.18)',
  unreadFg: '#40d8ff',
};

function V2_Cyber() {
  const t = themeCyber;
  return (
    <VariantFrame theme={t}>
      <LeftRail theme={t} />
      <ProjectRail theme={t} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        {/* Scanline BG */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(139,107,255,0.015) 2px, rgba(139,107,255,0.015) 4px)',
        }} />
        {/* Top bar */}
        <div style={{
          padding: '14px 24px', borderBottom: `1px solid ${t.border}`,
          background: t.bgElev,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1,
        }}>
          <div>
            <div style={{
              fontSize: 11, fontFamily: t.monoFont, color: t.brand,
              letterSpacing: 2, fontWeight: 600, textShadow: `0 0 8px ${t.brandGlow}80`,
            }}>// OFFICE / DASHBOARD</div>
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: t.displayFont, marginTop: 2 }}>
              Rolestra <span style={{ color: t.fgSubtle, fontWeight: 400 }}>/ live</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{
              fontSize: 11, fontFamily: t.monoFont, padding: '4px 10px',
              border: `1px solid ${t.brand}`, color: t.brand, borderRadius: 2,
              boxShadow: `0 0 10px rgba(139,107,255,0.2)`,
            }}>MODE:HYBRID</div>
            <div style={{
              fontSize: 11, fontFamily: t.monoFont, color: t.success,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: t.success, boxShadow: `0 0 6px ${t.success}` }} />
              ALL SYSTEMS NOMINAL
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, position: 'relative', zIndex: 1 }}>
          {/* Hero — neon stat cluster */}
          <div style={{
            background: t.bgElev, border: `1px solid ${t.border}`,
            borderRadius: 4, padding: '18px 22px',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 1,
              background: `linear-gradient(90deg, transparent 0%, ${t.brand} 50%, transparent 100%)`,
              boxShadow: `0 0 8px ${t.brandGlow}`,
            }} />
            <div style={{
              fontSize: 10, fontFamily: t.monoFont, color: t.fgMuted, letterSpacing: 2, marginBottom: 8,
            }}>▸ MISSION_STATUS @ 14:23:06</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
              {[
                { v: '3', l: 'CREW ONLINE', c: t.success },
                { v: '3', l: 'MEETINGS', c: t.brand },
                { v: '4', l: 'APPROVALS', c: t.warning },
                { v: '17', l: 'WEEKLY OPS', c: t.accent },
              ].map(s => (
                <div key={s.l}>
                  <div style={{
                    fontSize: 42, fontWeight: 700, color: s.c, lineHeight: 1,
                    fontFamily: t.monoFont, textShadow: `0 0 16px ${s.c}60`,
                  }}>{s.v}</div>
                  <div style={{
                    fontSize: 10, color: t.fgMuted, marginTop: 6,
                    fontFamily: t.monoFont, letterSpacing: 1.5,
                  }}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 3-col */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 12, flex: 1, minHeight: 0 }}>
            <CyberPanel t={t} title="CREW.MANIFEST" count={MEMBERS.length}>
              {MEMBERS.slice(0, 5).map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px',
                  borderBottom: `1px dashed ${t.border}`,
                }}>
                  <div style={{ fontFamily: t.monoFont, fontSize: 10, color: t.fgSubtle, width: 24 }}>
                    {String(MEMBERS.indexOf(m) + 1).padStart(2, '0')}
                  </div>
                  <MiniAvatar member={m} size={28} theme={t} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, fontFamily: t.monoFont }}>{m.name}_{m.cliId}</div>
                    <div style={{ fontSize: 10, color: t.fgSubtle, fontFamily: t.monoFont }}>&gt; {m.role}</div>
                  </div>
                  <div style={{
                    fontSize: 9, fontFamily: t.monoFont, fontWeight: 700, letterSpacing: 1,
                    color: m.status === 'online' ? t.success :
                           m.status === 'connecting' ? t.warning :
                           m.status === 'offline-connection' ? t.danger : t.fgSubtle,
                    textShadow: m.status === 'online' ? `0 0 6px ${t.success}60` : 'none',
                  }}>
                    {m.status === 'online' ? '● ACTIVE' :
                     m.status === 'connecting' ? '◐ LINK' :
                     m.status === 'offline-connection' ? '✕ DOWN' : '○ IDLE'}
                  </div>
                </div>
              ))}
            </CyberPanel>

            <CyberPanel t={t} title="TASK.QUEUE" count={ACTIVE_MEETINGS.length}>
              {ACTIVE_MEETINGS.map(mt => {
                const p = PROJECTS.find(x => x.id === mt.project);
                const stateColor = mt.state === 'WORKING' ? t.success :
                                   mt.state === 'CONSENSUS' ? t.warning : t.accent;
                return (
                  <div key={mt.id} style={{
                    padding: '10px 4px', borderBottom: `1px dashed ${t.border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: t.monoFont, fontSize: 11, color: t.brand, fontWeight: 700 }}>{mt.id}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{mt.topic}</span>
                      <span style={{ fontFamily: t.monoFont, fontSize: 10, color: t.fgMuted }}>T+{mt.elapsed}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: t.fgMuted, fontFamily: t.monoFont }}>&gt; {p?.name}</span>
                      <div style={{ flex: 1 }} />
                      <div style={{
                        fontSize: 9, fontFamily: t.monoFont, letterSpacing: 1.5, fontWeight: 700,
                        padding: '2px 6px', border: `1px solid ${stateColor}`, color: stateColor,
                        boxShadow: `0 0 6px ${stateColor}40`,
                      }}>{mt.state}</div>
                    </div>
                    {/* progress bar */}
                    <div style={{ marginTop: 8, height: 3, background: t.bgSunk, position: 'relative', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        position: 'absolute', left: 0, top: 0, bottom: 0,
                        width: mt.state === 'WORKING' ? '60%' : mt.state === 'CONSENSUS' ? '30%' : '85%',
                        background: stateColor, boxShadow: `0 0 6px ${stateColor}`,
                      }} />
                    </div>
                  </div>
                );
              })}
            </CyberPanel>

            <CyberPanel t={t} title="APPROVAL.INBOX" count={APPROVAL_QUEUE.length} danger>
              {APPROVAL_QUEUE.slice(0, 2).map(a => {
                const m = MEMBERS.find(x => x.id === a.requester);
                return (
                  <div key={a.id} style={{
                    padding: '10px 4px', borderBottom: `1px dashed ${t.border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <MiniAvatar member={m} size={22} theme={t} />
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: t.monoFont }}>{m.name}</span>
                      <div style={{ flex: 1 }} />
                      <span style={{ fontSize: 10, color: t.warning, fontFamily: t.monoFont }}>⏱ {a.time}</span>
                    </div>
                    <div style={{ fontSize: 12, marginBottom: 8, color: t.fgMuted, lineHeight: 1.4 }}>{a.summary}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <CyberBtn t={t} variant="success">ALLOW</CyberBtn>
                      <CyberBtn t={t}>COND.</CyberBtn>
                      <CyberBtn t={t} variant="danger">DENY</CyberBtn>
                    </div>
                  </div>
                );
              })}
              <div style={{ padding: '10px 4px 4px', textAlign: 'center' }}>
                <span style={{ fontSize: 11, color: t.brand, fontFamily: t.monoFont, letterSpacing: 1 }}>
                  VIEW_ALL &gt;&gt;
                </span>
              </div>
            </CyberPanel>
          </div>
        </div>
      </div>
    </VariantFrame>
  );
}

function CyberPanel({ t, title, count, children, danger }) {
  const accentColor = danger ? t.danger : t.brand;
  return (
    <div style={{
      background: t.bgElev, border: `1px solid ${t.border}`, borderRadius: 2,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      boxShadow: `inset 0 0 30px ${t.bgSunk}80`,
      position: 'relative',
    }}>
      <div style={{
        padding: '8px 12px', background: t.bgSunk,
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: `1px solid ${accentColor}40`,
      }}>
        <div style={{ width: 6, height: 6, background: accentColor, boxShadow: `0 0 6px ${accentColor}` }} />
        <span style={{ fontSize: 10, fontFamily: t.monoFont, letterSpacing: 1.8, color: accentColor, fontWeight: 700 }}>
          {title}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, fontFamily: t.monoFont, color: t.fgMuted }}>[{count}]</span>
      </div>
      <div style={{ padding: '6px 10px', flex: 1, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function CyberBtn({ t, variant, children }) {
  const c = variant === 'success' ? t.success : variant === 'danger' ? t.danger : t.fgMuted;
  return (
    <button style={{
      padding: '4px 10px', background: 'transparent',
      border: `1px solid ${c}`, color: c,
      fontSize: 10, fontFamily: t.monoFont, fontWeight: 700, letterSpacing: 1.2,
      cursor: 'pointer', borderRadius: 0,
    }}>{children}</button>
  );
}

Object.assign(window, {
  V1_Claude, V2_Cyber,
  AB_W, AB_H,
});
