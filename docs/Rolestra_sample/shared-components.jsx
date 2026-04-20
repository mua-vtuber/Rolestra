// ─────────────────────────────────────────────────────────────────────
// shared-components.jsx — cross-screen primitives
//
// Depends on: theme-tokens.jsx, data.jsx (MEMBERS, PROJECTS, DMS,
// APPROVAL_QUEUE, MEETING_THREAD, etc.)
//
// Exports (via Object.assign(window, ...)):
//   LineIcon          — single-stroke SVG icon set
//   ProfileAvatar     — circle / diamond / status-dot
//   getMember, getProject, getRecentAuthor
//   statusText, statusDotColor, stateColor
//   themeRadius, themeClip
//   getStatusOverview
//   SHELL_ICONS       — nav item definitions
//   NavRail           — theme-aware left icon rail (warm | tactical | retro)
//   ProjectRail       — theme-aware project+DM rail
// ─────────────────────────────────────────────────────────────────────

// ─── Icon set ────────────────────────────────────────────────────────
function LineIcon({ name, size = 16, color = 'currentColor', stroke = 1.6 }) {
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  const content = {
    dashboard: (
      <>
        <path {...common} d="M3 4.5h10v8H3z" />
        <path {...common} d="M3 8.5h10" />
        <path {...common} d="M7 12.5h2" />
      </>
    ),
    chat: (
      <path {...common} d="M3 4.5h10v7H7l-3 2z" />
    ),
    bell: (
      <>
        <path {...common} d="M4 11h8" />
        <path {...common} d="M5.2 11V8a2.8 2.8 0 0 1 5.6 0v3" />
        <path {...common} d="M7 12.8a1.2 1.2 0 0 0 2 0" />
      </>
    ),
    queue: (
      <>
        <path {...common} d="M4 4.5h8" />
        <path {...common} d="M4 8h8" />
        <path {...common} d="M4 11.5h8" />
      </>
    ),
    settings: (
      <>
        <circle {...common} cx="8" cy="8" r="2.3" />
        <path {...common} d="M8 3.5v1.2M8 11.3v1.2M3.5 8h1.2M11.3 8h1.2M4.7 4.7l.9.9M10.4 10.4l.9.9M11.3 4.7l-.9.9M5.6 10.4l-.9.9" />
      </>
    ),
    folder: (
      <path {...common} d="M2.5 5h4l1 1.2h6v5.8h-11z" />
    ),
    code: (
      <>
        <path {...common} d="M6 5.2 3.8 8 6 10.8" />
        <path {...common} d="M10 5.2 12.2 8 10 10.8" />
        <path {...common} d="M8.8 4.8 7.2 11.2" />
      </>
    ),
    pen: (
      <>
        <path {...common} d="M4 11.5 5 9l4.8-4.8 2.3 2.3L7.3 11.3Z" />
        <path {...common} d="M9.8 4.2 11 3l2 2-1.2 1.2" />
      </>
    ),
    document: (
      <>
        <path {...common} d="M4 3.5h5l3 3v6H4z" />
        <path {...common} d="M9 3.5v3h3" />
        <path {...common} d="M6 9h4M6 11h3" />
      </>
    ),
    search: (
      <>
        <circle {...common} cx="7" cy="7" r="3" />
        <path {...common} d="M9.5 9.5 12.5 12.5" />
      </>
    ),
    spark: (
      <path {...common} d="M8 2.8 9.3 6.7 13.2 8 9.3 9.3 8 13.2 6.7 9.3 2.8 8 6.7 6.7Z" />
    ),
    plus: (
      <>
        <path {...common} d="M8 3.5v9" />
        <path {...common} d="M3.5 8h9" />
      </>
    ),
    send: (
      <path {...common} d="M3 8 13 3 10.5 13 7.5 9Z" />
    ),
    paperclip: (
      <path {...common} d="M10.5 4.5 5.5 9.5a2 2 0 1 0 2.8 2.8L12 8.6a3.2 3.2 0 1 0-4.6-4.6L3.5 7.9" />
    ),
    arrow_right: (
      <>
        <path {...common} d="M3 8h10" />
        <path {...common} d="M9.5 4.5 13 8l-3.5 3.5" />
      </>
    ),
    check: (
      <path {...common} d="M3.5 8.5 6.5 11.5 12.5 5" />
    ),
    x: (
      <>
        <path {...common} d="m4 4 8 8" />
        <path {...common} d="m12 4-8 8" />
      </>
    ),
  }[name] || null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {content}
    </svg>
  );
}

// ─── Avatar ──────────────────────────────────────────────────────────
function ProfileAvatar({
  member, size = 30, shape = 'circle',
  ringColor, fallbackBg, fallbackFg = '#fff',
}) {
  const src = member?.avatarUrl || member?.profileImage || '';
  const radius = shape === 'diamond' ? 4 : size / 2;
  const baseStyle = {
    width: size, height: size,
    overflow: 'hidden', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: fallbackBg || member?.color || '#64748b',
    color: fallbackFg,
    fontSize: size * 0.38, fontWeight: 700, lineHeight: 1,
    boxShadow: ringColor ? `0 0 0 2px ${ringColor}` : 'none',
  };
  const shapedStyle = shape === 'diamond'
    ? { clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', borderRadius: radius }
    : { borderRadius: radius };
  return (
    <div style={{ ...baseStyle, ...shapedStyle }}>
      {src ? (
        <img src={src} alt={member?.name || 'avatar'}
             style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span>{member?.initials || member?.name?.charAt(0) || '?'}</span>
      )}
    </div>
  );
}

// ─── Data helpers ────────────────────────────────────────────────────
function getMember(memberId) {
  return MEMBERS.find((member) => member.id === memberId);
}
function getProject(projectId) {
  return PROJECTS.find((project) => project.id === projectId);
}
function getRecentAuthor(authorName) {
  return MEMBERS.find((member) => member.name === authorName);
}

// ─── Theme helpers ───────────────────────────────────────────────────
function statusText(status) {
  if (status === 'online') return '출근';
  if (status === 'connecting') return '연결중';
  if (status === 'offline-connection') return '점검 필요';
  return '외근';
}
function statusDotColor(theme, status) {
  if (status === 'online') return theme.success;
  if (status === 'connecting') return theme.warning;
  if (status === 'offline-connection') return theme.danger;
  return theme.fgSubtle;
}
function stateColor(theme, state) {
  if (state === 'WORKING') return theme.success;
  if (state === 'CONSENSUS') return theme.warning;
  return theme.accent || theme.brand;
}
function themeRadius(theme, fallback = 8) {
  return theme.panelRadius ?? fallback;
}
function themeClip(theme) {
  return theme.panelClip && theme.panelClip !== 'none' ? theme.panelClip : 'none';
}
function getStatusOverview() {
  return MEMBERS.reduce((acc, member) => {
    if (member.status === 'online') acc.online += 1;
    else if (member.status === 'connecting') acc.idle += 1;
    else if (member.status === 'offline-connection') acc.blocked += 1;
    else acc.away += 1;
    return acc;
  }, { online: 0, idle: 0, blocked: 0, away: 0 });
}

// ─── Nav items ───────────────────────────────────────────────────────
const SHELL_ICONS = [
  { id: 'dashboard', icon: 'dashboard', label: '사무실' },
  { id: 'messenger', icon: 'chat',      label: '메시지' },
  { id: 'approval',  icon: 'bell',      label: '승인',  withBadge: true },
  { id: 'queue',     icon: 'queue',     label: '큐' },
  { id: 'settings',  icon: 'settings',  label: '설정' },
];

// ─── NavRail (theme-aware left rail) ─────────────────────────────────
function NavRail({ theme, active = 'dashboard' }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';

  const railWidth = isWarm ? 64 : isTactical ? 70 : 64;
  const itemSize = isWarm ? 40 : isTactical ? 46 : 40;
  const itemRadius = isWarm ? 10 : 0;

  return (
    <div style={{
      width: railWidth,
      background: theme.railBg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', paddingTop: 12, gap: 10,
      flexShrink: 0, ...theme.railExtra,
    }}>
      {/* Logo */}
      <div style={{
        width: itemSize, height: itemSize,
        background: theme.logoBg,
        color: theme.logoFg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontFamily: theme.displayFont,
        boxShadow: theme.logoShadow,
        border: isTactical ? `1px solid ${theme.brand}` : isRetro ? `1px solid ${theme.border}` : 'none',
        borderRadius: itemRadius,
      }}>
        {theme.useLineIcons
          ? <LineIcon name="dashboard" color="currentColor" stroke={1.4} />
          : 'R'}
      </div>

      {SHELL_ICONS.map((item) => {
        const isActive = item.id === active;
        const badge = item.withBadge ? APPROVAL_QUEUE.length : 0;
        return (
          <div key={item.id} style={{
            width: itemSize, height: itemSize,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isActive ? theme.iconActiveBg : 'transparent',
            color: isActive ? theme.iconActiveFg : theme.iconFg,
            boxShadow: isActive ? theme.iconActiveShadow : 'none',
            border: isTactical
              ? `1px solid ${isActive ? theme.brand : theme.border}`
              : isActive && isRetro ? `1px solid ${theme.border}` : '1px solid transparent',
            borderRadius: itemRadius,
            position: 'relative',
          }}>
            <LineIcon name={item.icon} color="currentColor" stroke={isRetro ? 1.35 : 1.6} />
            {badge > 0 && (
              <div style={{
                position: 'absolute',
                top: isWarm ? -4 : isTactical ? -6 : -2,
                right: isWarm ? -4 : isTactical ? -6 : -2,
                minWidth: isTactical ? 16 : 14,
                height: isTactical ? 16 : 14,
                padding: '0 3px',
                background: theme.badgeBg,
                color: theme.badgeFg,
                fontSize: isTactical ? 9 : 8,
                fontWeight: 800, fontFamily: theme.monoFont,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: isWarm ? 999 : 0,
                boxShadow: isTactical ? `0 0 10px ${theme.badgeBg}70` : 'none',
              }}>{badge}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── ProjectRail (theme-aware) ───────────────────────────────────────
const PROJECT_ICON_MAP = {
  'p-blog': 'code',
  'p-landing': 'spark',
  'p-invoice': 'document',
  'p-research': 'search',
  'p-cat': 'folder',
};
const PROJECT_PREFIX_MAP = {
  'p-blog': '[API]',
  'p-landing': '[WEB]',
  'p-invoice': '[DOC]',
  'p-research': '[RND]',
  'p-cat': '[ML ]',
};

function ProjectRail({ theme, activeId = 'p-blog' }) {
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
        {isWarm ? '프로젝트' : isRetro ? '$ projects' : 'PROJECT DIRECTORY'}
      </div>
      {PROJECTS.map((project) => {
        const isActive = project.id === activeId;
        return (
          <div key={project.id} style={{
            display: 'flex', alignItems: 'center', gap: isWarm ? 10 : 8,
            padding: '8px 10px',
            background: isActive && !isRetro ? theme.itemActiveBg : 'transparent',
            color: isActive ? theme.itemActiveFg : theme.fg,
            border: isActive && !isWarm && !isRetro
              ? `1px solid ${isTactical ? `${theme.brand}55` : theme.border}`
              : '1px solid transparent',
            borderRadius: isWarm ? 8 : 0,
          }}>
            {isRetro ? (
              <span style={{
                color: isActive ? theme.brand : 'transparent',
                fontSize: 11, width: 10, textAlign: 'center', flexShrink: 0,
                textShadow: isActive && theme.mode === 'dark' ? `0 0 4px ${theme.brand}66` : 'none',
              }}>▶</span>
            ) : isTactical ? (
              <LineIcon
                name={PROJECT_ICON_MAP[project.id] || 'folder'}
                color={isActive ? theme.brand : theme.iconFg}
              />
            ) : (
              <span style={{ fontSize: 15 }}>{project.icon}</span>
            )}
            <span style={{ flex: 1, fontSize: 12, fontWeight: isWarm ? 600 : 500 }}>
              {project.name}
            </span>
            {project.unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px',
                background: theme.unreadBg, color: theme.unreadFg,
                fontSize: 10, fontWeight: 700, fontFamily: theme.monoFont,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: isWarm ? 999 : 0,
                boxShadow: isTactical ? `0 0 10px ${theme.unreadBg}55` : 'none',
              }}>{project.unread}</span>
            )}
          </div>
        );
      })}

      <div style={{ ...sectionTitleStyle, paddingTop: 14 }}>
        {isWarm ? '다이렉트 메시지' : isRetro ? '$ dm' : 'DIRECT MESSAGE'}
      </div>
      {DMS.slice(0, 3).map((dm) => {
        const member = getMember(dm.memberId);
        return (
          <div key={dm.id} style={{
            display: 'flex', alignItems: 'center', gap: isWarm ? 10 : 8,
            padding: '7px 10px',
            color: theme.fgMuted,
          }}>
            {isRetro ? (
              <span style={{
                width: 8, height: 8, borderRadius: 999,
                background: statusDotColor(theme, member.status),
                boxShadow: member.status === 'online'
                  ? `0 0 6px ${statusDotColor(theme, member.status)}60` : 'none',
              }} />
            ) : (
              <ProfileAvatar
                member={member}
                size={isWarm ? 24 : 22}
                shape={isTactical ? 'diamond' : 'circle'}
                fallbackBg={member.color}
                ringColor={isTactical ? 'rgba(97,200,255,0.1)' : undefined}
              />
            )}
            <span style={{ flex: 1, fontSize: 12 }}>{member.name}</span>
            {dm.unread > 0 && (
              <span style={{
                minWidth: 18, height: 18, padding: '0 5px',
                background: theme.unreadBg, color: theme.unreadFg,
                fontSize: 10, fontWeight: 700, fontFamily: theme.monoFont,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: isWarm ? 999 : 0,
                boxShadow: isTactical ? `0 0 10px ${theme.unreadBg}55` : 'none',
              }}>{dm.unread}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── VariantFrame (fixed 1280×820 with theme-aware shell backdrop) ───
function VariantFrame({ theme, className = '', children }) {
  const isRetroDark = theme.themeKey === 'retro' && theme.mode === 'dark';
  const isTactical = theme.themeKey === 'tactical';
  const isRetroLight = theme.themeKey === 'retro' && theme.mode === 'light';

  return (
    <div className={className} style={{
      width: 1280, height: 820, position: 'relative', overflow: 'hidden',
      background: theme.bgCanvas, color: theme.fg,
      fontFamily: theme.font, fontSize: 13, lineHeight: 1.4,
      display: 'flex',
    }}>
      {/* Tactical backdrop glow + grid */}
      {isTactical && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: theme.mode === 'dark'
            ? `radial-gradient(ellipse 980px 460px at 0% 0%, rgba(170,228,255,0.22), transparent 48%),
               radial-gradient(ellipse 620px 320px at 22% 0%, rgba(97,200,255,0.16), transparent 58%),
               radial-gradient(ellipse 520px 260px at 100% 100%, rgba(97,200,255,0.08), transparent 60%),
               linear-gradient(rgba(103,175,255,0.05) 1px, transparent 1px),
               linear-gradient(90deg, rgba(103,175,255,0.05) 1px, transparent 1px)`
            : `radial-gradient(ellipse 900px 440px at 0% 0%, rgba(0,132,199,0.08), transparent 55%),
               linear-gradient(rgba(14,30,51,0.035) 1px, transparent 1px),
               linear-gradient(90deg, rgba(14,30,51,0.035) 1px, transparent 1px)`,
          backgroundSize: theme.mode === 'dark'
            ? '100% 100%, 100% 100%, 100% 100%, 42px 42px, 42px 42px'
            : '100% 100%, 42px 42px, 42px 42px',
        }} />
      )}
      {/* Retro dark: scanlines + vignette */}
      {isRetroDark && (
        <>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
            background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.008) 0, rgba(255,255,255,0.008) 1px, rgba(0,0,0,0.10) 1px, rgba(0,0,0,0.10) 3px)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 11,
            background: 'radial-gradient(ellipse at center, transparent 44%, rgba(0,0,0,0.16) 100%)',
          }} />
        </>
      )}
      {/* Retro light: paper grain */}
      {isRetroLight && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
          opacity: 0.35,
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.33 0 0 0 0 0.18 0 0 0 0.28 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          mixBlendMode: 'multiply',
        }} />
      )}

      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, {
  LineIcon, ProfileAvatar,
  getMember, getProject, getRecentAuthor,
  statusText, statusDotColor, stateColor,
  themeRadius, themeClip, getStatusOverview,
  SHELL_ICONS, NavRail, ProjectRail, VariantFrame,
  PROJECT_ICON_MAP, PROJECT_PREFIX_MAP,
  ShellTopBar,
});

// ─── ShellTopBar — reusable top bar across all screens ──────────────
// Props:
//   theme       — theme token object
//   title       — large left-side label (default '사무실')
//   subtitle    — small secondary text
//   showChips   — include status + permission chips (default true)
//   rightExtra  — JSX to render before bell (optional)
function ShellTopBar({ theme, title = '사무실', subtitle = '금요일 오후 2:23 · 좋은 오후입니다, 대표님', showChips = true, rightExtra }) {
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
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <div style={{
          fontSize: 22, fontWeight: 700,
          fontFamily: theme.displayFont, color: theme.fg,
          letterSpacing: -0.4,
        }}>{title}</div>
        {subtitle && (
          <div style={{
            fontSize: 12, color: theme.fgMuted,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{subtitle}</div>
        )}
      </div>
      <div style={{ flex: 1 }} />

      {showChips && (
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
      )}

      {showChips && (
        <div style={{
          padding: '5px 10px',
          borderRadius: isWarm ? 8 : 0,
          border: `1px solid ${theme.border}`,
          background: theme.bgSunk, color: theme.fg,
          fontSize: 11, fontWeight: 700,
          fontFamily: theme.monoFont,
        }}>hybrid 권한</div>
      )}

      {rightExtra}

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

      <div style={{
        minWidth: 200, height: 34,
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
