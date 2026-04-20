// ─────────────────────────────────────────────────────────────────────
// 01-dash-variants.jsx — Dashboard screen in 6 theme flavors
//
// Each variant = VariantFrame + NavRail + ProjectRail + MainArea
//
// Exports: window.V_WarmLight, V_WarmDark, V_TacticalLight,
//          V_TacticalDark, V_RetroLight, V_RetroDark
// ─────────────────────────────────────────────────────────────────────

// ─── Top bar ─────────────────────────────────────────────────────────
function DashTopBar({ theme }) {
  const overview = getStatusOverview();
  const isTactical = theme.themeKey === 'tactical';
  const isRetro = theme.themeKey === 'retro';
  const isWarm = theme.themeKey === 'warm';

  const chipStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '5px 10px',
    borderRadius: isWarm ? 999 : 0,
    background: theme.bgSunk, color: theme.fgMuted,
    fontSize: 11, fontWeight: 700,
    border: `1px solid ${theme.border}`,
    fontFamily: theme.monoFont,
    boxShadow: isTactical
      ? '0 0 14px rgba(97,200,255,0.14), inset 0 0 12px rgba(97,200,255,0.05)' : 'none',
  };

  return (
    <div style={{
      minHeight: 46, padding: '8px 18px',
      background: theme.topBarBg,
      borderBottom: `1px solid ${theme.topBarBorder}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <div style={{
          fontSize: 22, fontWeight: 700,
          fontFamily: theme.displayFont, color: theme.fg,
          letterSpacing: -0.4,
        }}>사무실</div>
        <div style={{
          fontSize: 12, color: theme.fgMuted,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>금요일 오후 2:23 · 좋은 오후입니다, 대표님</div>
      </div>
      <div style={{ flex: 1 }} />

      {/* Status chip */}
      <div style={chipStyle}>
        {isWarm ? (
          <>
            <span>🟢{overview.online}</span>
            <span>⚪{overview.idle}</span>
            <span>🔴{overview.blocked}</span>
            <span>🟡{overview.away}</span>
          </>
        ) : (
          <>
            {[
              { color: theme.success, label: overview.online, pulse: isTactical },
              { color: theme.fgMuted, label: overview.idle },
              { color: theme.danger,  label: overview.blocked, pulse: isTactical },
              { color: theme.warning, label: overview.away },
            ].map((item, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: item.color,
                  boxShadow: `0 0 ${isTactical ? 10 : 6}px ${item.color}60`,
                  animation: item.pulse ? 'dashPulse 1.8s infinite ease-in-out' : 'none',
                }} />
                <span>{item.label}</span>
              </span>
            ))}
          </>
        )}
      </div>

      {/* Permission chip */}
      <div style={{
        padding: '5px 10px',
        borderRadius: isWarm ? 8 : 0,
        border: `1px solid ${theme.border}`,
        background: theme.bgSunk, color: theme.fg,
        fontSize: 11, fontWeight: 700,
        fontFamily: theme.monoFont,
      }}>hybrid 권한</div>

      {/* Bell */}
      <div style={{
        width: 34, height: 34,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: isWarm ? 8 : 0,
        border: `1px solid ${theme.border}`,
        background: theme.bgSunk, color: theme.fg,
        position: 'relative',
      }}>
        {theme.useLineIcons
          ? <LineIcon name="bell" color="currentColor" stroke={1.4} />
          : <span>🔔</span>}
        {APPROVAL_QUEUE.length > 0 && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 14, height: 14, padding: '0 3px',
            borderRadius: isWarm ? 999 : 0,
            clipPath: isTactical
              ? 'polygon(3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) 100%, 0 100%, 0 3px)'
              : 'none',
            background: theme.danger, color: theme.badgeFg || '#fff',
            fontSize: 8, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: isTactical ? `0 0 10px ${theme.danger}60` : 'none',
          }}>{APPROVAL_QUEUE.length}</div>
        )}
      </div>

      {/* Search */}
      <div style={{
        minWidth: 220, height: 34,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px',
        borderRadius: isWarm ? 8 : 0,
        border: `1px solid ${theme.border}`,
        background: theme.bgSunk, color: theme.fgSubtle,
        fontSize: 12,
      }}>
        {theme.useLineIcons
          ? <LineIcon name="search" color="currentColor" stroke={1.4} />
          : <span>🔍</span>}
        <span>글로벌 검색</span>
      </div>

      {/* User avatar */}
      {!isRetro && (
        <ProfileAvatar
          member={getMember('me')}
          size={28}
          shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
          fallbackBg={theme.brand}
          ringColor={isTactical ? 'rgba(103,175,255,0.12)' : '#fff5'}
        />
      )}
    </div>
  );
}

// ─── Hero strip ──────────────────────────────────────────────────────
function DashHero({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const stats = [
    { label: '활성', value: '1' },
    { label: '회의', value: String(ACTIVE_MEETINGS.length) },
    { label: '승인', value: String(APPROVAL_QUEUE.length) },
    { label: '오늘 완료', value: '4' },
  ];

  if (isRetro) {
    return (
      <div style={{
        padding: '14px 18px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        display: 'flex', alignItems: 'stretch', gap: 14,
      }}>
        <div style={{ flex: 1, fontFamily: theme.monoFont, color: theme.fg, padding: '6px 0' }}>
          <div style={{ fontSize: 11, color: theme.fgMuted }}>$ rolestra office --summary</div>
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7 }}>
            <div><span style={{ color: theme.brand }}>1</span> 활성 프로젝트</div>
            <div><span style={{ color: theme.brand }}>{ACTIVE_MEETINGS.length}</span>건 회의 진행 중</div>
            <div><span style={{ color: theme.accent }}>{APPROVAL_QUEUE.length}</span>건 승인 대기</div>
            <div>
              <span style={{ color: theme.warning }}>오늘</span> 4건 완료
              <span style={{
                display: 'inline-block', width: 8, height: 14, marginLeft: 6,
                background: theme.brand, verticalAlign: 'text-bottom',
                boxShadow: theme.mode === 'dark' ? `0 0 6px ${theme.brand}55` : 'none',
                animation: 'dashCursor 1.06s infinite step-end',
              }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center',
          paddingLeft: 14, borderLeft: `1px solid ${theme.heroBorder}` }}>
          <DashButton theme={theme} primary>+ 새 프로젝트</DashButton>
          <DashButton theme={theme}>회의 소집 →</DashButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '16px 20px',
      background: theme.heroBg,
      border: `1px solid ${theme.heroBorder}`,
      borderRadius: theme.panelRadius || 10,
      clipPath: isTactical ? theme.panelClip : 'none',
      display: 'flex', alignItems: 'center', gap: 18,
      boxShadow: isTactical ? 'inset 0 0 0 1px rgba(103,175,255,0.06), 0 0 22px rgba(97,200,255,0.10)' : 'none',
      position: 'relative', overflow: 'hidden',
    }}>
      {isTactical && theme.mode === 'dark' && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 440px 220px at 12% 0%, rgba(152,220,255,0.24), transparent 58%)',
        }} />
      )}
      <div style={{
        position: 'relative', flex: 1,
        display: 'grid', gridTemplateColumns: 'repeat(4, minmax(72px, auto))', gap: 18,
      }}>
        {stats.map((stat, i) => (
          <div key={stat.label} style={{
            paddingLeft: isTactical && i > 0 ? 12 : 0,
            borderLeft: isTactical && i > 0 ? `2px solid ${theme.panelBorder}` : 'none',
          }}>
            <div style={{
              fontSize: isTactical ? 34 : 30, lineHeight: 1, fontWeight: 700,
              fontFamily: theme.displayFont,
              color: theme.heroValue,
            }}>{stat.value}</div>
            <div style={{
              marginTop: 5, fontSize: 11, fontWeight: 700,
              fontFamily: isTactical ? theme.monoFont : theme.font,
              color: theme.heroLabel,
              letterSpacing: isTactical ? 1.3 : 0,
            }}>{stat.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
        <DashButton theme={theme} primary>+ 새 프로젝트</DashButton>
        <DashButton theme={theme}>회의 소집 →</DashButton>
      </div>
    </div>
  );
}

function DashButton({ theme, primary, children }) {
  return (
    <button style={{
      height: 40, padding: '0 14px',
      border: `1px solid ${primary ? theme.actionPrimaryBg : theme.actionSecondaryBorder || theme.border}`,
      background: primary ? theme.actionPrimaryBg : theme.actionSecondaryBg,
      color: primary ? theme.actionPrimaryFg : theme.actionSecondaryFg,
      borderRadius: theme.themeKey === 'warm' ? 8 : 0,
      clipPath: theme.themeKey === 'tactical' ? themeClip(theme) : 'none',
      fontFamily: theme.font, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    }}>{children}</button>
  );
}

// ─── Generic card ────────────────────────────────────────────────────
// Supports three title styles via theme.cardTitleStyle:
//   'bar'     — tactical: clipPath corners, panel-header band, brand badge
//   'divider' — warm: white card, divider line under title (Claude Warm 톤)
//   'ascii'   — retro: "┌─ ./직원        [6]" text-based header
function DashCard({ theme, title, asciiTitle, iconWarm, iconLine, badge, badgeTone, style, children }) {
  const badgeBg = badgeTone || theme.brand;
  const titleStyle = theme.cardTitleStyle || 'bar';
  const isTactical = titleStyle === 'bar' && theme.themeKey === 'tactical';
  const isAscii = titleStyle === 'ascii';
  const isDivider = titleStyle === 'divider';

  return (
    <div style={{
      background: theme.panelBg,
      border: `1px solid ${theme.panelBorder}`,
      borderRadius: themeRadius(theme, 10),
      boxShadow: theme.panelShadow,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative',
      ...style,
    }}>
      {isTactical && (
        <>
          {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']]
            .map(([y, x], i) => (
              <div key={i} style={{
                position: 'absolute', [y]: 0, [x]: 0, width: 10, height: 10, opacity: 0.8,
                [`border${y[0].toUpperCase()+y.slice(1)}`]: `1px solid ${theme.brand}`,
                [`border${x[0].toUpperCase()+x.slice(1)}`]: `1px solid ${theme.brand}`,
              }} />
            ))}
        </>
      )}

      {isAscii ? (
        // Retro ASCII-line title: "┌─ ./직원        [6]" with dark title bg and divider
        <div style={{
          padding: '9px 12px',
          color: badgeBg,
          background: theme.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(30,40,25,0.08)',
          borderBottom: `1px solid ${theme.panelBorder}`,
          fontFamily: theme.monoFont, fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 6,
          textShadow: theme.mode === 'dark' ? `0 0 4px ${badgeBg}55` : 'none',
          letterSpacing: 0.5,
        }}>
          <span>┌─ {asciiTitle || title}</span>
          <div style={{ flex: 1 }} />
          {badge !== undefined && (
            <span style={{ color: theme.fgMuted }}>[{badge}]</span>
          )}
        </div>
      ) : (
        <div style={{
          minHeight: 40,
          padding: isDivider ? '10px 14px' : '9px 12px',
          background: isDivider ? 'transparent' : theme.panelHeaderBg,
          borderBottom: `1px solid ${isDivider ? theme.borderSoft || theme.panelBorder : theme.panelBorder}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: theme.fg }}>
            {theme.useLineIcons
              ? <LineIcon name={iconLine} color="currentColor" stroke={1.35} />
              : iconWarm}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700, color: theme.fg,
            fontFamily: isDivider ? theme.font : theme.font,
            whiteSpace: 'nowrap',
          }}>{title}</span>
          <div style={{ flex: 1 }} />
          {badge !== undefined && (
            <span style={{
              minWidth: 24, height: 22, padding: '0 8px',
              borderRadius: theme.themeKey === 'warm' ? 999 : 0,
              background: `${badgeBg}22`, color: badgeBg,
              fontSize: 10, fontWeight: 700, fontFamily: theme.monoFont,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{badge}</span>
          )}
        </div>
      )}

      <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

// ─── Tasks panel ─────────────────────────────────────────────────────
const PHASE_LABEL = { WORKING: 'WORK', CONSENSUS: 'CONS', WAIT_INPUT: 'WAIT' };
const SSM_STAGE = { WORKING: 9, CONSENSUS: 6, WAIT_INPUT: 3 };

function DashTasksPanel({ theme }) {
  const isTactical = theme.themeKey === 'tactical';
  const isRetro = theme.themeKey === 'retro';
  return (
    <DashCard theme={theme} title="진행 중 업무" asciiTitle="./업무      " iconWarm="📋" iconLine="queue"
              badge={ACTIVE_MEETINGS.length} style={{ gridArea: 'tasks' }}>
      {ACTIVE_MEETINGS.slice(0, 5).map((meeting) => {
        const project = getProject(meeting.project);
        const tone = stateColor(theme, meeting.state);
        const progress = Math.round((SSM_STAGE[meeting.state] / 12) * 100);
        const segments = Math.max(1, Math.round(progress / 8));
        return (
          <div key={meeting.id} style={{
            padding: '9px 2px', borderBottom: `1px solid ${theme.panelBorder}66`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: theme.brand, fontFamily: theme.monoFont }}>{meeting.id}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: theme.fg }}>{meeting.topic}</span>
              <span style={{ fontSize: 11, color: theme.fgMuted }}>{meeting.elapsed}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
              <span style={{ fontSize: 11, color: theme.fgMuted }}>
                {theme.themeKey === 'warm' ? `${project?.icon} ${project?.name}` : project?.name}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: tone }}>{PHASE_LABEL[meeting.state]}</span>
              <div style={{ display: 'flex' }}>
                {meeting.members.map((mid, idx) => {
                  const m = getMember(mid);
                  if (isRetro) {
                    return (
                      <span key={mid} style={{
                        marginLeft: idx ? -2 : 0,
                        width: 8, height: 8, borderRadius: 999,
                        background: statusDotColor(theme, m.status),
                        boxShadow: theme.mode === 'dark'
                          ? `0 0 6px ${statusDotColor(theme, m.status)}60` : 'none',
                        alignSelf: 'center',
                      }} />
                    );
                  }
                  return (
                    <div key={mid} style={{ marginLeft: idx ? -6 : 0 }}>
                      <ProfileAvatar
                        member={m} size={18}
                        shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                        fallbackBg={m.color} ringColor={theme.panelBg}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {isTactical ? (
              <>
                <div style={{
                  marginTop: 8, height: 10,
                  display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 3,
                }}>
                  {Array.from({ length: 12 }).map((_, idx) => {
                    const filled = idx < SSM_STAGE[meeting.state];
                    const d = SSM_STAGE[meeting.state] - 1 - idx;
                    const alpha = d <= 1 ? 1 : d <= 3 ? 0.75 : 0.45;
                    // Gauge glow — always visible on filled segments
                    // (Light mode uses tighter glow; Dark leans stronger)
                    const glowScale = theme.gaugeGlow ?? 0;
                    const glowPx = theme.mode === 'dark' ? 10 : 6;
                    const glowAlphaHead = Math.round(0.85 * glowScale * 255).toString(16).padStart(2, '0');
                    const glowAlphaBody = Math.round(0.32 * glowScale * 255).toString(16).padStart(2, '0');
                    let shadow = 'none';
                    if (filled && glowScale > 0) {
                      shadow = d <= 1
                        ? `0 0 ${glowPx + 4}px ${tone}${glowAlphaHead}`
                        : `0 0 ${glowPx}px ${tone}${glowAlphaBody}`;
                    }
                    return (
                      <div key={idx} style={{
                        background: filled ? tone : theme.bgSunk,
                        opacity: filled ? alpha : 1,
                        boxShadow: shadow,
                        clipPath: 'polygon(0 0, calc(100% - 3px) 0, 100% 50%, calc(100% - 3px) 100%, 0 100%, 3px 50%)',
                      }} />
                    );
                  })}
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>
                  SSM::{SSM_STAGE[meeting.state]}/12
                </div>
              </>
            ) : isRetro ? (
              <>
                <div style={{ marginTop: 8, fontFamily: theme.monoFont, fontSize: 12, color: tone }}>
                  [{'█'.repeat(segments)}{'░'.repeat(15 - segments)}]
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>
                  SSM {SSM_STAGE[meeting.state]}/12
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 8, height: 6, background: theme.bgSunk,
                              borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: tone }} />
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle }}>
                  SSM {SSM_STAGE[meeting.state]}/12
                </div>
              </>
            )}
          </div>
        );
      })}
    </DashCard>
  );
}

// ─── Approvals panel ─────────────────────────────────────────────────
function DashApprovalsPanel({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isQuote = theme.approvalBodyStyle === 'quote';
  const tone = APPROVAL_QUEUE.length ? theme.danger : theme.fgSubtle;
  return (
    <DashCard theme={theme} title="결재 대기" asciiTitle="./결재      " iconWarm="🔔" iconLine="bell"
              badge={`${APPROVAL_QUEUE.length}건`} badgeTone={tone}
              style={{ gridArea: 'approvals' }}>
      <div style={{ height: '100%', overflowY: 'auto', paddingRight: 2 }}>
        {APPROVAL_QUEUE.map((approval) => {
          const member = getMember(approval.requester);
          const project = getProject(approval.project);
          return (
            <div key={approval.id} style={{
              padding: '10px 2px', borderBottom: `1px solid ${theme.panelBorder}66`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isRetro ? (
                  <span style={{
                    width: 8, height: 8, borderRadius: 999,
                    background: statusDotColor(theme, member.status),
                    boxShadow: theme.mode === 'dark'
                      ? `0 0 6px ${statusDotColor(theme, member.status)}60` : 'none',
                  }} />
                ) : (
                  <ProfileAvatar
                    member={member} size={24}
                    shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                    fallbackBg={member.color}
                  />
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: theme.fg }}>{member.name}</span>
                <span style={{ fontSize: 11, color: theme.fgSubtle }}>{project?.name}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 10, color: theme.fgSubtle }}>{approval.time}</span>
              </div>

              {isQuote ? (
                // Retro: quoted block with left bar, monospace
                <div style={{
                  marginTop: 6,
                  borderLeft: `2px solid ${theme.brand}`,
                  background: theme.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.04)',
                  padding: '6px 10px',
                  fontFamily: theme.monoFont,
                }}>
                  <div style={{ fontSize: 11, color: theme.fg, lineHeight: 1.5 }}>
                    <span style={{ color: theme.fgSubtle }}>{'> '}</span>
                    {approval.summary}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10, color: theme.fgMuted, lineHeight: 1.45 }}>
                    <span style={{ color: theme.fgSubtle }}>{'# '}</span>
                    {approval.reason}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 6, fontSize: 12, color: theme.fg, lineHeight: 1.45 }}>
                    {approval.summary}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: theme.fgMuted }}>{approval.reason}</div>
                </>
              )}

              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <DashMiniBtn theme={theme} tone="success" key1="Y" label="허가" />
                <DashMiniBtn theme={theme} tone="neutral" key1="C" label="조건부" />
                <DashMiniBtn theme={theme} tone="danger" key1="N" label="거절" />
              </div>
            </div>
          );
        })}
      </div>
    </DashCard>
  );
}

// DashMiniBtn — 3 variants per theme.miniBtnStyle
//   'pill'    → Warm: solid fill (success/danger) or neutral ghost, rounded 8
//   'notched' → Tactical: 1.5px border + offset shadow + clip-path corners, sq
//   'text'    → Retro: text-button "[Y] 허가", no bg/border
function DashMiniBtn({ theme, tone, key1, label }) {
  const style = theme.miniBtnStyle || 'pill';
  const toneColor = tone === 'success' ? theme.success
                  : tone === 'danger'  ? theme.danger
                  : null;

  if (style === 'text') {
    // Retro: [Y] 허가 — boxed button with border, mono font
    const color = toneColor || theme.fg;
    return (
      <button style={{
        height: 26, padding: '0 8px',
        border: `1px solid ${color}`,
        background: 'transparent',
        color: color,
        borderRadius: 0,
        fontSize: 11, fontWeight: 700,
        fontFamily: theme.monoFont,
        cursor: 'pointer', letterSpacing: 0.3,
      }}>
        <span style={{ fontWeight: 700 }}>[{key1}]</span>
        {label ? <span style={{ marginLeft: 4 }}>{label}</span> : null}
      </button>
    );
  }

  if (style === 'notched') {
    // Tactical: thick border + offset shadow + clipped corners
    const c = toneColor || theme.brand;
    return (
      <button style={{
        height: 28, padding: '0 12px',
        border: `1.5px solid ${c}`,
        background: theme.mode === 'dark' ? `${c}14` : `${c}10`,
        color: c,
        boxShadow: `2px 2px 0 ${c}44`,
        clipPath: 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)',
        borderRadius: 0,
        fontSize: 11, fontWeight: 700,
        fontFamily: theme.font,
        letterSpacing: 0.5, textTransform: 'uppercase',
        cursor: 'pointer',
      }}>{label}</button>
    );
  }

  // 'pill' — Warm: solid fill for success/danger, ghost for neutral
  if (toneColor) {
    return (
      <button style={{
        height: 28, padding: '0 12px',
        border: `1px solid ${toneColor}`,
        background: toneColor,
        color: '#fff',
        borderRadius: 8,
        fontSize: 11, fontWeight: 700,
        fontFamily: theme.font,
        cursor: 'pointer',
        boxShadow: theme.mode === 'dark' ? 'none' : `0 1px 2px ${toneColor}33`,
      }}>{tone === 'success' ? `✓ ${label}` : label}</button>
    );
  }
  // neutral
  return (
    <button style={{
      height: 28, padding: '0 12px',
      border: `1px solid ${theme.panelBorder}`,
      background: theme.bgSunk, color: theme.fg,
      borderRadius: 8,
      fontSize: 11, fontWeight: 600,
      fontFamily: theme.font,
      cursor: 'pointer',
    }}>{label}</button>
  );
}

// ─── People panel ────────────────────────────────────────────────────
function DashPeoplePanel({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  return (
    <DashCard theme={theme} title="직원" asciiTitle="./직원      " iconWarm="👥" iconLine="dashboard"
              badge={MEMBERS.length} style={{ gridArea: 'people' }}>
      {MEMBERS.map((member) => {
        const dot = statusDotColor(theme, member.status);

        if (isRetro) {
          // Retro: single line, mono, status dot + id + name + state
          return (
            <div key={member.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 2px',
              fontFamily: theme.monoFont, fontSize: 12,
              color: theme.fg, lineHeight: 1.4,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: dot, flexShrink: 0,
                boxShadow: member.status === 'online' && theme.mode === 'dark'
                  ? `0 0 6px ${dot}60` : 'none',
              }} />
              <span style={{ color: theme.brand, fontWeight: 700 }}>{member.cli}</span>
              <span style={{ color: theme.fg }}>{member.name}</span>
              <span style={{ color: theme.fgMuted }}>· {member.role}</span>
              <div style={{ flex: 1 }} />
              <span style={{ color: theme.fgSubtle, fontSize: 10, textTransform: 'uppercase' }}>
                {statusText(member.status)}
              </span>
            </div>
          );
        }

        return (
          <div key={member.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 2px', borderBottom: `1px solid ${theme.panelBorder}55`,
          }}>
            {theme.avatarShape === 'status' ? (
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: dot, flexShrink: 0,
                boxShadow: member.status === 'online' && theme.mode === 'dark'
                  ? `0 0 6px ${dot}60` : 'none',
              }} />
            ) : (
              <ProfileAvatar
                member={member} size={30}
                shape={theme.avatarShape} fallbackBg={member.color}
                ringColor={theme.useLineIcons ? 'rgba(103,175,255,0.08)' : undefined}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: theme.fg }}>
                {member.name}
                <span style={{ color: theme.fgMuted, fontWeight: 500 }}> · {member.role}</span>
              </div>
              <div style={{ marginTop: 2, fontSize: 11, color: theme.fgSubtle }}>
                {member.cli}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: theme.fgMuted, fontWeight: 700 }}>
                {statusText(member.status)}
              </div>
            </div>
          </div>
        );
      })}
    </DashCard>
  );
}

// ─── Recent panel ────────────────────────────────────────────────────
function DashRecentPanel({ theme }) {
  return (
    <DashCard theme={theme} title="최근 대화" iconWarm="💬" iconLine="chat"
              badge={Math.min(RECENT_MESSAGES.length, 7)} style={{ gridArea: 'recent' }}>
      {RECENT_MESSAGES.slice(0, 7).map((message) => (
        <div key={`${message.channel}-${message.time}`} style={{
          padding: '8px 2px', borderBottom: `1px solid ${theme.panelBorder}55`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: theme.brand, fontFamily: theme.monoFont,
            }}>{message.channel}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: theme.fgSubtle }}>{message.time}</span>
          </div>
          <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45, color: theme.fg }}>
            <span style={{ fontWeight: 700 }}>{message.author}</span>
            <span style={{ color: theme.fgMuted }}> · {message.content}</span>
          </div>
        </div>
      ))}
    </DashCard>
  );
}

// ─── Insight strip ───────────────────────────────────────────────────
function DashInsightStrip({ theme }) {
  const items = ['오늘 완료 4', '이번 주 완료 17', '누적 승인 142건', '평균 응답 9분'];
  return (
    <div style={{
      marginTop: 12, minHeight: 34, padding: '8px 12px',
      border: `1px solid ${theme.insightBorder}`,
      background: theme.insightBg, color: theme.insightColor,
      borderRadius: theme.themeKey === 'warm' ? 10 : 0,
      fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {items.map((item, i) => (
        <React.Fragment key={item}>
          {i > 0 && <span style={{ color: theme.fgSubtle }}>·</span>}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Main area assembly ──────────────────────────────────────────────
function DashMain({ theme }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes dashCursor { 50% { opacity: 0; } }
      `}</style>
      <DashTopBar theme={theme} />
      <div style={{
        flex: 1, padding: 18,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <DashHero theme={theme} />
        <div style={{
          marginTop: 12, flex: 1, minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.9fr 1fr',
          gridTemplateRows: '1.1fr 1fr',
          gridTemplateAreas: `
            "tasks tasks approvals"
            "people recent approvals"
          `,
          gap: 12,
        }}>
          <DashTasksPanel theme={theme} />
          <DashApprovalsPanel theme={theme} />
          <DashPeoplePanel theme={theme} />
          <DashRecentPanel theme={theme} />
        </div>
        <DashInsightStrip theme={theme} />
      </div>
    </div>
  );
}

// ─── 6 variants ──────────────────────────────────────────────────────
function DashVariant({ theme }) {
  return (
    <VariantFrame theme={theme}>
      <NavRail theme={theme} />
      <ProjectRail theme={theme} />
      <DashMain theme={theme} />
    </VariantFrame>
  );
}

function V_WarmLight()     { return <DashVariant theme={themeWarmLight} />; }
function V_WarmDark()      { return <DashVariant theme={themeWarmDark} />; }
function V_TacticalLight() { return <DashVariant theme={themeTacticalLight} />; }
function V_TacticalDark()  { return <DashVariant theme={themeTacticalDark} />; }
function V_RetroLight()    { return <DashVariant theme={themeRetroLight} />; }
function V_RetroDark()     { return <DashVariant theme={themeRetroDark} />; }

Object.assign(window, {
  V_WarmLight, V_WarmDark,
  V_TacticalLight, V_TacticalDark,
  V_RetroLight, V_RetroDark,
});
