// Spec-aligned dashboard additions:
// 1) warm layout refresh
// 2) same layout with game-inspired visual language
// 3) same layout with retro terminal visual language

const SPEC_ACTIVE_PROJECT = PROJECTS[0];

const SPEC_TASK_PROGRESS = {
  '#17': 72,
  '#16': 38,
  '#15': 86,
};

const SPEC_PHASE_LABEL = {
  WORKING: '실행 중',
  CONSENSUS: '합의 중',
  REVIEW: '검토 중',
};

const SPEC_BODY_FONT = '"IBM Plex Sans", "Inter", system-ui, sans-serif';

function getMember(memberId) {
  return MEMBERS.find((member) => member.id === memberId);
}

function getProject(projectId) {
  return PROJECTS.find((project) => project.id === projectId);
}

function getRecentAuthor(authorName) {
  return MEMBERS.find((member) => member.name === authorName);
}

function stateColor(theme, state) {
  if (state === 'WORKING') return theme.success;
  if (state === 'CONSENSUS') return theme.warning;
  return theme.accent || theme.brand;
}

function statusText(status) {
  if (status === 'online') return '출근';
  if (status === 'connecting') return '연결중';
  if (status === 'offline-connection') return '점검 필요';
  return '외근';
}

function ProfileAvatar({ member, size = 30, shape = 'circle', ringColor, fallbackBg, fallbackFg = '#fff' }) {
  const src = member?.avatarUrl || member?.profileImage || '';
  const radius = shape === 'diamond' ? 6 : size / 2;
  const baseStyle = {
    width: size,
    height: size,
    overflow: 'hidden',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: fallbackBg || member?.color || '#64748b',
    color: fallbackFg,
    fontSize: size * 0.38,
    fontWeight: 700,
    lineHeight: 1,
    boxShadow: ringColor ? `0 0 0 2px ${ringColor}` : 'none',
  };
  const shapedStyle = shape === 'diamond'
    ? { clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', borderRadius: radius }
    : { borderRadius: radius };
  return (
    <div style={{ ...baseStyle, ...shapedStyle }}>
      {src ? (
        <img
          src={src}
          alt={member?.name || 'avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{member?.initials || member?.name?.charAt(0) || '?'}</span>
      )}
    </div>
  );
}

function statusDotColor(theme, status) {
  if (status === 'online') return theme.success;
  if (status === 'connecting') return theme.warning;
  if (status === 'offline-connection') return theme.danger;
  return theme.fgSubtle;
}

const themeGameNikke = {
  ...themeGame,
  bgCanvas: '#0e1622',
  bgElev: 'linear-gradient(180deg, rgba(24,36,54,0.94) 0%, rgba(17,27,43,0.92) 100%)',
  bgSunk: 'rgba(8,15,26,0.9)',
  fg: '#f3f9ff',
  fgMuted: '#9fb6d0',
  fgSubtle: '#6a87a9',
  border: 'rgba(103,175,255,0.28)',
  borderSoft: 'rgba(103,175,255,0.14)',
  brand: '#61c8ff',
  brandDeep: '#2896e6',
  accent: '#b5f0ff',
  success: '#7de5ff',
  warning: '#ffd166',
  danger: '#ff7da6',
  font: SPEC_BODY_FONT,
  displayFont: '"Space Grotesk", "IBM Plex Sans", sans-serif',
  monoFont: '"JetBrains Mono", monospace',
  avatarBgEmoji: 'rgba(97,200,255,0.08)',
  avatarRadius: 4,
  avatarStyle: 'initials',
  railBg: 'linear-gradient(180deg, #091320 0%, #050b14 100%)',
  railExtra: { borderRight: '1px solid rgba(103,175,255,0.16)' },
  logoBg: 'rgba(97,200,255,0.08)',
  logoFg: '#8fe7ff',
  logoShadow: 'inset 0 0 0 1px rgba(97,200,255,0.7), 0 0 14px rgba(97,200,255,0.25)',
  iconFg: '#6c88aa',
  iconActiveBg: 'rgba(97,200,255,0.12)',
  iconActiveFg: '#8fe7ff',
  iconActiveShadow: 'inset 0 0 0 1px rgba(97,200,255,0.55), 0 0 14px rgba(97,200,255,0.24)',
  badgeBg: '#ff7da6',
  badgeFg: '#07111d',
  projectBg: 'linear-gradient(180deg, rgba(7,15,27,0.95) 0%, rgba(8,14,24,0.88) 100%)',
  itemActiveBg: 'rgba(97,200,255,0.12)',
  itemActiveFg: '#e9f7ff',
  unreadBg: '#61c8ff',
  unreadFg: '#07111d',
};

const themeRetroDos = {
  ...themeRetro,
  bgCanvas: '#0a0d09',
  bgElev: '#10150f',
  bgSunk: '#070b07',
  fg: '#d8ead7',
  fgMuted: '#9bc29b',
  fgSubtle: '#577457',
  border: '#203425',
  borderSoft: '#132217',
  brand: '#89f09a',
  brandBright: '#c5ff9a',
  accent: '#f5a24a',
  success: '#8cf59e',
  warning: '#f7b267',
  danger: '#d77952',
  font: SPEC_BODY_FONT,
  displayFont: '"IBM Plex Mono", "JetBrains Mono", monospace',
  monoFont: '"IBM Plex Mono", "JetBrains Mono", monospace',
  avatarBgEmoji: '#111a12',
  avatarRadius: 2,
  avatarStyle: 'initials',
  railBg: '#080b08',
  railExtra: { borderRight: '1px solid #203425' },
  logoBg: 'transparent',
  logoFg: '#f5a24a',
  logoShadow: 'inset 0 0 0 1px #2d4a31, 0 0 10px rgba(245,162,74,0.18)',
  iconFg: '#4f8f59',
  iconActiveBg: '#101712',
  iconActiveFg: '#f5a24a',
  iconActiveShadow: 'inset 0 0 0 1px #335338, 0 0 8px rgba(245,162,74,0.16)',
  badgeBg: '#f5a24a',
  badgeFg: '#081008',
  projectBg: '#090d09',
  itemActiveBg: '#121912',
  itemActiveFg: '#c5ff9a',
  unreadBg: '#89f09a',
  unreadFg: '#081008',
};

function LineIcon({ name, size = 16, color = 'currentColor', stroke = 1.7 }) {
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
      <>
        <path {...common} d="M3 4.5h10v7H7l-3 2z" />
      </>
    ),
    bell: (
      <>
        <path {...common} d="M5 11.5h6" />
        <path {...common} d="M6 11.5v-3a3 3 0 1 1 6 0v3" transform="translate(-2 0)" />
        <path {...common} d="M7.5 12.5a1.5 1.5 0 0 0 3 0" />
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
      <>
        <path {...common} d="M2.5 5h4l1 1.2h6v5.8h-11z" />
      </>
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
      <>
        <path {...common} d="M8 2.8 9.3 6.7 13.2 8 9.3 9.3 8 13.2 6.7 9.3 2.8 8 6.7 6.7Z" />
      </>
    ),
  }[name] || null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {content}
    </svg>
  );
}

function TacticalRail({ theme, active = 'dashboard' }) {
  const items = [
    { id: 'dashboard', icon: 'dashboard', label: '오피스' },
    { id: 'messenger', icon: 'chat', label: '메시지' },
    { id: 'approval', icon: 'bell', label: '승인', badge: APPROVAL_QUEUE.length },
    { id: 'queue', icon: 'queue', label: '큐' },
    { id: 'settings', icon: 'settings', label: '설정' },
  ];
  return (
    <div style={{
      width: 70,
      background: theme.railBg,
      borderRight: `1px solid ${theme.border}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 12,
      gap: 10,
      flexShrink: 0,
      ...theme.railExtra,
    }}>
      <div style={{
        width: 42,
        height: 42,
        background: theme.logoBg,
        color: theme.logoFg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontFamily: theme.displayFont,
        boxShadow: theme.logoShadow,
        border: `1px solid ${theme.brand}`,
      }}>
        R
      </div>
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <div key={item.id} style={{
            width: 46,
            height: 46,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isActive ? theme.iconActiveBg : 'transparent',
            color: isActive ? theme.iconActiveFg : theme.iconFg,
            boxShadow: isActive ? theme.iconActiveShadow : 'none',
            position: 'relative',
            border: `1px solid ${isActive ? theme.brand : theme.border}`,
            overflow: 'visible',
          }}>
            <LineIcon name={item.icon} color="currentColor" />
            {item.badge > 0 && (
              <div style={{
                position: 'absolute',
                top: -6,
                right: -6,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                background: theme.badgeBg,
                color: theme.badgeFg,
                fontSize: 9,
                fontWeight: 800,
                fontFamily: theme.monoFont,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                boxShadow: `0 0 10px ${theme.badgeBg}70`,
              }}>{item.badge}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TacticalProjectRail({ theme }) {
  const iconMap = {
    'p-blog': 'code',
    'p-landing': 'spark',
    'p-invoice': 'document',
    'p-research': 'search',
    'p-cat': 'folder',
  };
  const activeId = 'p-blog';
  return (
    <div style={{
      width: 242,
      background: theme.projectBg,
      borderRight: `1px solid ${theme.border}`,
      padding: '14px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      flexShrink: 0,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.8,
        color: theme.fgSubtle,
        padding: '4px 10px 8px',
        fontFamily: theme.monoFont,
      }}>PROJECT DIRECTORY</div>
      {PROJECTS.map((project) => {
        const isActive = project.id === activeId;
        return (
          <div key={project.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            background: isActive ? theme.itemActiveBg : 'transparent',
            color: isActive ? theme.itemActiveFg : theme.fg,
            border: isActive ? `1px solid ${theme.brand}55` : '1px solid transparent',
          }}>
            <LineIcon name={iconMap[project.id] || 'folder'} color={isActive ? theme.brand : theme.iconFg} />
            <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{project.name}</span>
            {project.unread > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                background: theme.unreadBg,
                color: theme.unreadFg,
                fontSize: 10,
                fontWeight: 800,
                fontFamily: theme.monoFont,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 10px ${theme.unreadBg}55`,
              }}>{project.unread}</span>
            )}
          </div>
        );
      })}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.8,
        color: theme.fgSubtle,
        padding: '14px 10px 8px',
        fontFamily: theme.monoFont,
      }}>DIRECT MESSAGE</div>
      {DMS.slice(0, 3).map((dm) => {
        const member = MEMBERS.find((entry) => entry.id === dm.memberId);
        return (
          <div key={dm.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '7px 10px',
            color: theme.fgMuted,
          }}>
            <ProfileAvatar
              member={member}
              size={22}
              shape="diamond"
              fallbackBg={member.color}
              ringColor="rgba(97,200,255,0.1)"
            />
            <span style={{ flex: 1, fontSize: 12 }}>{member.name}</span>
            {dm.unread > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                background: theme.unreadBg,
                color: theme.unreadFg,
                fontSize: 10,
                fontWeight: 800,
                fontFamily: theme.monoFont,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 10px ${theme.unreadBg}55`,
              }}>{dm.unread}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RetroLineRail({ theme, active = 'dashboard' }) {
  const items = [
    { id: 'dashboard', icon: 'dashboard' },
    { id: 'messenger', icon: 'chat' },
    { id: 'approval', icon: 'bell', badge: APPROVAL_QUEUE.length },
    { id: 'queue', icon: 'queue' },
    { id: 'settings', icon: 'settings' },
  ];
  return (
    <div style={{
      width: 64,
      background: theme.railBg,
      borderRight: `1px solid ${theme.border}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      paddingTop: 12,
      gap: 10,
      flexShrink: 0,
      ...theme.railExtra,
    }}>
      <div style={{
        width: 40,
        height: 40,
        color: theme.logoFg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: theme.logoShadow,
        border: `1px solid ${theme.border}`,
      }}>
        <LineIcon name="dashboard" color={theme.logoFg} stroke={1.4} />
      </div>
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <div key={item.id} style={{
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isActive ? theme.iconActiveFg : theme.iconFg,
            background: isActive ? theme.iconActiveBg : 'transparent',
            boxShadow: isActive ? theme.iconActiveShadow : 'none',
            border: `1px solid ${isActive ? theme.border : 'transparent'}`,
            position: 'relative',
          }}>
            <LineIcon name={item.icon} color="currentColor" stroke={1.35} />
            {item.badge > 0 && (
              <div style={{
                position: 'absolute',
                top: -2,
                right: -2,
                minWidth: 14,
                height: 14,
                padding: '0 3px',
                background: theme.badgeBg,
                color: theme.badgeFg,
                fontSize: 8,
                fontWeight: 700,
                fontFamily: theme.monoFont,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>{item.badge}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RetroProjectRail({ theme }) {
  const activeId = 'p-blog';
  const prefixes = {
    'p-blog': '[API]',
    'p-landing': '[WEB]',
    'p-invoice': '[DOC]',
    'p-research': '[RND]',
    'p-cat': '[ML ]',
  };
  return (
    <div style={{
      width: 240,
      background: theme.projectBg,
      borderRight: `1px solid ${theme.border}`,
      padding: '14px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      flexShrink: 0,
    }}>
      <div style={{
        fontSize: 10,
        color: theme.fgSubtle,
        letterSpacing: 1.6,
        padding: '4px 10px 8px',
      }}>$ projects</div>
      {PROJECTS.map((project) => {
        const isActive = project.id === activeId;
        return (
          <div key={project.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: isActive ? theme.itemActiveBg : 'transparent',
            color: isActive ? theme.itemActiveFg : theme.fg,
            border: `1px solid ${isActive ? theme.border : 'transparent'}`,
          }}>
            <span style={{ color: theme.accent, fontSize: 11 }}>{prefixes[project.id] || '[DIR]'}</span>
            <span style={{ flex: 1, fontSize: 12 }}>{project.name}</span>
            {project.unread > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                background: theme.unreadBg,
                color: theme.unreadFg,
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>{project.unread}</span>
            )}
          </div>
        );
      })}
      <div style={{
        fontSize: 10,
        color: theme.fgSubtle,
        letterSpacing: 1.6,
        padding: '14px 10px 8px',
      }}>$ dm</div>
      {DMS.slice(0, 3).map((dm) => {
        const member = MEMBERS.find((entry) => entry.id === dm.memberId);
        return (
          <div key={dm.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 10px',
            color: theme.fgMuted,
          }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: statusDotColor(theme, member.status),
              boxShadow: member.status === 'online' ? `0 0 6px ${statusDotColor(theme, member.status)}60` : 'none',
            }} />
            <span style={{ flex: 1, fontSize: 12 }}>{member.name}</span>
            {dm.unread > 0 && (
              <span style={{
                minWidth: 18,
                height: 18,
                padding: '0 5px',
                background: theme.unreadBg,
                color: theme.unreadFg,
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>{dm.unread}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------
// Unified main layout refresh based on the latest dashboard structure
// -------------------------------------------------------------------

const SPEC_DISPLAY_FONT = '"Space Grotesk", "IBM Plex Sans", sans-serif';
const SPEC_MONO_FONT = '"JetBrains Mono", monospace';
const SPEC_BOSS = { name: '대표', initials: '대', color: '#8b95a7' };
const SPEC_SSM_STAGE = {
  WORKING: 8,
  CONSENSUS: 5,
  REVIEW: 10,
};

const themeWarmUnified = {
  ...themeClaude,
  themeKey: 'warm',
  font: SPEC_BODY_FONT,
  displayFont: SPEC_DISPLAY_FONT,
  monoFont: SPEC_MONO_FONT,
  topBarBg: '#fffaf3',
  topBarBorder: '#ecd9bd',
  heroBg: 'linear-gradient(135deg, #fff1de 0%, #fde8ce 100%)',
  heroBorder: '#f0d2a8',
  heroValue: '#cc7a34',
  heroLabel: '#7a6a55',
  panelBg: '#ffffff',
  panelHeaderBg: '#fff8ef',
  panelBorder: '#ecd9bd',
  panelShadow: '0 1px 3px rgba(45,31,17,0.04)',
  insightBg: '#f8f3ea',
  insightColor: '#7e705d',
  insightBorder: '#eadbc0',
  actionPrimaryBg: '#c96f3a',
  actionPrimaryFg: '#fff',
  actionSecondaryBg: '#fff',
  actionSecondaryFg: '#c96f3a',
  actionSecondaryBorder: '#e6bf8f',
  panelRadius: 12,
  avatarShape: 'circle',
  useLineIcons: false,
};

const themeTacticalUnified = {
  ...themeGameNikke,
  themeKey: 'tactical',
  font: SPEC_BODY_FONT,
  displayFont: SPEC_DISPLAY_FONT,
  monoFont: SPEC_MONO_FONT,
  topBarBg: 'linear-gradient(180deg, rgba(18,30,48,0.94), rgba(9,17,28,0.88))',
  topBarBorder: 'rgba(103,175,255,0.22)',
  heroBg: 'linear-gradient(135deg, rgba(38,60,91,0.92), rgba(18,30,48,0.94) 42%, rgba(12,20,33,0.92) 100%)',
  heroBorder: 'rgba(103,175,255,0.24)',
  heroValue: '#f3f9ff',
  heroLabel: '#9fb6d0',
  panelBg: 'linear-gradient(180deg, rgba(24,36,54,0.94), rgba(17,27,43,0.92))',
  panelHeaderBg: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(97,200,255,0.03))',
  panelBorder: 'rgba(103,175,255,0.22)',
  panelShadow: 'inset 0 0 0 1px rgba(103,175,255,0.08), 0 0 22px rgba(97,200,255,0.14)',
  insightBg: 'rgba(255,255,255,0.04)',
  insightColor: '#9fb6d0',
  insightBorder: 'rgba(103,175,255,0.16)',
  actionPrimaryBg: 'rgba(97,200,255,0.16)',
  actionPrimaryFg: '#8fe7ff',
  actionSecondaryBg: 'rgba(255,255,255,0.04)',
  actionSecondaryFg: '#f3f9ff',
  actionSecondaryBorder: 'rgba(103,175,255,0.22)',
  panelRadius: 0,
  panelClip: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))',
  avatarShape: 'diamond',
  useLineIcons: true,
};

const themeRetroUnified = {
  ...themeRetroDos,
  themeKey: 'retro',
  font: SPEC_BODY_FONT,
  displayFont: SPEC_DISPLAY_FONT,
  monoFont: SPEC_MONO_FONT,
  topBarBg: '#0c100c',
  topBarBorder: '#1e2c1f',
  heroBg: '#0f140f',
  heroBorder: '#213021',
  heroValue: '#e9f3e7',
  heroLabel: '#9bc29b',
  panelBg: '#101410',
  panelHeaderBg: '#0d110d',
  panelBorder: '#213021',
  panelShadow: '0 0 0 1px rgba(245,180,103,0.08), 0 0 16px rgba(245,180,103,0.06)',
  insightBg: '#121712',
  insightColor: '#9bc29b',
  insightBorder: '#1f2b1f',
  actionPrimaryBg: '#162116',
  actionPrimaryFg: '#f5b467',
  actionSecondaryBg: '#121712',
  actionSecondaryFg: '#d8ead7',
  actionSecondaryBorder: '#294129',
  panelRadius: 0,
  avatarShape: 'status',
  useLineIcons: true,
};

function themeRadius(theme, fallback = 8) {
  return theme.panelRadius ?? fallback;
}

function themeClip(theme) {
  return theme.panelClip || 'none';
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

function SpecIcon({ theme, warm, line }) {
  if (theme.useLineIcons && line) {
    return <LineIcon name={line} color="currentColor" stroke={1.35} />;
  }
  return <span>{warm}</span>;
}

function SpecStatusChip({ theme }) {
  const overview = getStatusOverview();
  if (theme.themeKey === 'tactical') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 10px',
        borderRadius: 0,
        clipPath: 'none',
        background: theme.bgSunk,
        color: theme.fgMuted,
        fontSize: 11,
        fontWeight: 700,
        border: `1px solid ${theme.topBarBorder}`,
        fontFamily: theme.monoFont,
        boxShadow: '0 0 14px rgba(97,200,255,0.14), inset 0 0 12px rgba(97,200,255,0.05)',
      }}>
        {[
          { color: '#7ef3b4', label: String(overview.online), pulse: true },
          { color: '#cfd6df', label: String(overview.idle) },
          { color: '#ff7da6', label: String(overview.blocked), pulse: true },
          { color: '#f5b467', label: String(overview.away) },
        ].map((item, index) => (
          <span key={`${item.color}-${item.label}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: item.color,
              boxShadow: `0 0 10px ${item.color}80`,
              animation: item.pulse ? 'tacticalPulse 1.8s infinite ease-in-out' : 'none',
            }} />
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    );
  }
  if (theme.themeKey === 'retro') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 10px',
        borderRadius: 0,
        background: theme.bgSunk,
        color: theme.fgMuted,
        fontSize: 11,
        fontWeight: 700,
        border: `1px solid ${theme.topBarBorder}`,
        fontFamily: theme.monoFont,
        boxShadow: '0 0 8px rgba(245,180,103,0.05)',
      }}>
        {[
          { color: theme.success, label: String(overview.online) },
          { color: '#cfd6df', label: String(overview.idle) },
          { color: theme.danger, label: String(overview.blocked) },
          { color: theme.warning, label: String(overview.away) },
        ].map((item, index) => (
          <span key={`${item.color}-${item.label}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: item.color,
              boxShadow: `0 0 6px ${item.color}50`,
            }} />
            <span>{item.label}</span>
          </span>
        ))}
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '5px 10px',
      borderRadius: theme.themeKey === 'warm' ? 999 : 0,
      clipPath: 'none',
      background: theme.bgSunk,
      color: theme.fgMuted,
      fontSize: 11,
      fontWeight: 700,
      border: `1px solid ${theme.topBarBorder}`,
      fontFamily: theme.monoFont,
      boxShadow: theme.themeKey === 'tactical'
        ? '0 0 18px rgba(97,200,255,0.18), inset 0 0 12px rgba(97,200,255,0.05)'
        : theme.themeKey === 'retro'
          ? '0 0 8px rgba(245,180,103,0.05)'
          : 'none',
    }}>
      <span style={{ animation: theme.themeKey === 'tactical' ? 'tacticalPulse 1.8s infinite ease-in-out' : 'none' }}>🟢{overview.online}</span>
      <span>⚪{overview.idle}</span>
      <span style={{ animation: theme.themeKey === 'tactical' ? 'tacticalPulse 2.1s infinite ease-in-out' : 'none' }}>🔴{overview.blocked}</span>
      <span style={{ color: theme.fgSubtle }}>외근 {overview.away}</span>
    </div>
  );
}

function SpecUserAvatar({ theme }) {
  if (theme.themeKey === 'retro') return null;
  const shape = theme.avatarShape === 'diamond' ? 'diamond' : 'circle';
  return (
    <ProfileAvatar
      member={SPEC_BOSS}
      size={28}
      shape={shape}
      fallbackBg={theme.avatarShape === 'diamond' ? '#2f73c9' : theme.brand}
      ringColor={theme.useLineIcons ? 'rgba(103,175,255,0.12)' : '#fff5'}
    />
  );
}

function SpecTopBar({ theme }) {
  return (
    <div style={{
      minHeight: 46,
      padding: '8px 18px',
      background: theme.topBarBg,
      borderBottom: `1px solid ${theme.topBarBorder}`,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        <div style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: theme.displayFont,
          color: theme.fg,
          letterSpacing: -0.4,
        }}>사무실</div>
        <div style={{
          fontSize: 12,
          color: theme.fgMuted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>금요일 오후 2:23 · 좋은 오후입니다, 대표님</div>
      </div>
      <div style={{ flex: 1 }} />
      <SpecStatusChip theme={theme} />
      <div style={{
        padding: '5px 10px',
        borderRadius: themeRadius(theme),
        clipPath: theme.themeKey === 'tactical' ? themeClip(theme) : 'none',
        border: `1px solid ${theme.topBarBorder}`,
        background: theme.bgSunk,
        color: theme.fg,
        fontSize: 11,
        fontWeight: 700,
        boxShadow: theme.themeKey === 'tactical'
          ? '0 0 14px rgba(97,200,255,0.14), inset 0 0 10px rgba(97,200,255,0.04)'
          : theme.themeKey === 'retro'
            ? '0 0 8px rgba(245,180,103,0.05)'
            : 'none',
      }}>hybrid 권한</div>
      <div style={{
        width: 34,
        height: 34,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: themeRadius(theme),
        clipPath: 'none',
        border: `1px solid ${theme.topBarBorder}`,
        background: theme.bgSunk,
        color: theme.fg,
        position: 'relative',
        boxShadow: theme.themeKey === 'tactical'
          ? '0 0 14px rgba(97,200,255,0.16), inset 0 0 10px rgba(97,200,255,0.05)'
          : theme.themeKey === 'retro'
            ? '0 0 8px rgba(245,180,103,0.05)'
            : 'none',
      }}>
        <SpecIcon theme={theme} warm="🔔" line="bell" />
        {APPROVAL_QUEUE.length > 0 && (
          <div style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 14,
            height: 14,
            padding: '0 3px',
            borderRadius: theme.themeKey === 'warm' ? 999 : 0,
            clipPath: theme.themeKey === 'tactical'
              ? 'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))'
              : 'none',
            background: theme.danger,
            color: theme.badgeFg || '#fff',
            fontSize: 8,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: theme.themeKey === 'retro' ? `1px solid ${theme.accent}` : 'none',
            boxShadow: theme.themeKey === 'tactical'
              ? '0 0 14px rgba(255,125,166,0.3)'
              : theme.themeKey === 'retro'
                ? '0 0 6px rgba(245,180,103,0.08)'
                : 'none',
          }}>{APPROVAL_QUEUE.length}</div>
        )}
      </div>
      <div style={{
        minWidth: 220,
        height: 34,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 12px',
        borderRadius: themeRadius(theme),
        clipPath: theme.themeKey === 'tactical' ? 'none' : 'none',
        border: `1px solid ${theme.topBarBorder}`,
        background: theme.bgSunk,
        color: theme.fgSubtle,
        fontSize: 12,
        boxShadow: theme.themeKey === 'tactical'
          ? '0 0 16px rgba(97,200,255,0.16), inset 0 0 12px rgba(97,200,255,0.03)'
          : theme.themeKey === 'retro'
            ? '0 0 8px rgba(245,180,103,0.05)'
            : 'none',
      }}>
        <SpecIcon theme={theme} warm="🔍" line="search" />
        <span>글로벌 검색</span>
      </div>
      <SpecUserAvatar theme={theme} />
    </div>
  );
}

function SpecHero({ theme }) {
  const stats = [
    { label: '활성', value: '1' },
    { label: '회의', value: String(ACTIVE_MEETINGS.length) },
    { label: '승인', value: String(APPROVAL_QUEUE.length) },
    { label: '오늘 완료', value: '4' },
  ];
  if (theme.themeKey === 'retro') {
    return (
      <div style={{
        padding: '14px 18px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        borderRadius: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: 14,
      }}>
        <div style={{
          flex: 1,
          minWidth: 0,
          padding: '6px 0',
          fontFamily: theme.monoFont,
          color: theme.fg,
        }}>
          <div style={{ fontSize: 11, color: theme.fgMuted }}>$ rolestra office --summary</div>
          <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7 }}>
            <div><span style={{ color: theme.brand }}>1</span> 활성 프로젝트</div>
            <div><span style={{ color: theme.brand }}>3</span>건 회의 진행 중</div>
            <div><span style={{ color: theme.accent }}>4</span>건 승인 대기</div>
            <div><span style={{ color: theme.warning }}>오늘</span> 4건 완료</div>
            <div style={{ marginTop: 10 }}>
              <span style={{ color: theme.fgMuted }}>$ </span>
              <span style={{
                display: 'inline-block',
                width: 8,
                height: 14,
                background: theme.brand,
                verticalAlign: 'text-bottom',
                boxShadow: `0 0 6px ${theme.brand}55`,
                animation: 'retro-hero-cursor 1.06s infinite step-end',
              }} />
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          paddingLeft: 14,
          borderLeft: `1px solid ${theme.heroBorder}`,
        }}>
          <SpecActionButton theme={theme} primary>+ 새 프로젝트</SpecActionButton>
          <SpecActionButton theme={theme}>회의 소집 →</SpecActionButton>
        </div>
        <style>{`@keyframes retro-hero-cursor { 50% { opacity: 0; } }`}</style>
      </div>
    );
  }
  if (theme.themeKey === 'tactical') {
    return (
      <div style={{
        padding: '14px 18px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        clipPath: theme.panelClip,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: 'inset 0 0 0 1px rgba(103,175,255,0.08), 0 0 24px rgba(97,200,255,0.14)',
        position: 'relative',
        overflow: 'hidden',
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'radial-gradient(ellipse 440px 220px at 12% 0%, rgba(152,220,255,0.24), transparent 58%), linear-gradient(180deg, rgba(255,255,255,0.04), transparent 55%)',
        }} />
        <div style={{
          position: 'relative',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(72px, auto))',
          gap: 18,
        }}>
          {stats.map((stat, index) => (
            <div key={stat.label} style={{
              padding: '4px 0',
              borderLeft: index === 0 ? 'none' : `2px solid ${theme.panelBorder}`,
              paddingLeft: index === 0 ? 0 : 12,
            }}>
              <div style={{
                fontSize: 34,
                lineHeight: 1,
                fontWeight: 700,
                fontFamily: theme.displayFont,
                color: stat.label === '승인' ? theme.warning : theme.heroValue,
              }}>{stat.value}</div>
              <div style={{
                marginTop: 5,
                fontSize: 11,
                color: theme.heroLabel,
                fontWeight: 700,
                fontFamily: theme.monoFont,
                letterSpacing: 1.3,
              }}>{stat.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <SpecActionButton theme={theme} primary>+ 새 프로젝트</SpecActionButton>
          <SpecActionButton theme={theme}>회의 소집 →</SpecActionButton>
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
      clipPath: theme.panelClip || 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 18,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(72px, auto))', gap: 18, flex: 1 }}>
        {stats.map((stat) => (
          <div key={stat.label}>
            <div style={{
              fontSize: 30,
              lineHeight: 1,
              fontWeight: 700,
              fontFamily: theme.displayFont,
              color: theme.heroValue,
            }}>{stat.value}</div>
            <div style={{
              marginTop: 4,
              fontSize: 11,
              color: theme.heroLabel,
              fontWeight: 600,
            }}>{stat.label}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <SpecActionButton theme={theme} primary>+ 새 프로젝트</SpecActionButton>
        <SpecActionButton theme={theme}>회의 소집 →</SpecActionButton>
      </div>
    </div>
  );
}

function SpecActionButton({ theme, primary, children }) {
  return (
    <button style={{
      height: 40,
      padding: '0 14px',
      border: `1px solid ${primary ? theme.actionPrimaryBg : theme.actionSecondaryBorder || theme.topBarBorder}`,
      background: primary ? theme.actionPrimaryBg : theme.actionSecondaryBg,
      color: primary ? theme.actionPrimaryFg : theme.actionSecondaryFg,
      borderRadius: themeRadius(theme),
      clipPath: theme.themeKey === 'tactical' ? themeClip(theme) : 'none',
      fontFamily: theme.font,
      fontSize: 12,
      fontWeight: 700,
      cursor: 'pointer',
      boxShadow: theme.themeKey === 'tactical'
        ? `0 0 18px ${primary ? 'rgba(97,200,255,0.2)' : 'rgba(97,200,255,0.1)'}, inset 0 0 10px ${primary ? 'rgba(97,200,255,0.06)' : 'rgba(255,255,255,0.03)'}`
        : theme.themeKey === 'retro'
          ? '0 0 8px rgba(245,180,103,0.05)'
          : 'none',
    }}>{children}</button>
  );
}

function SpecCard({ theme, title, iconWarm, iconLine, badge, badgeTone, style, children }) {
  const badgeBg = badgeTone || theme.brand;
  return (
    <div style={{
      background: theme.panelBg,
      border: `1px solid ${theme.panelBorder}`,
      borderRadius: themeRadius(theme, 10),
      clipPath: 'none',
      boxShadow: theme.panelShadow,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
      ...style,
    }}>
      {theme.themeKey === 'tactical' && (
        <>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: `1px solid ${theme.brand}`, borderLeft: `1px solid ${theme.brand}`, opacity: 0.8 }} />
          <div style={{ position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderTop: `1px solid ${theme.brand}`, borderRight: `1px solid ${theme.brand}`, opacity: 0.8 }} />
          <div style={{ position: 'absolute', bottom: 0, left: 0, width: 10, height: 10, borderBottom: `1px solid ${theme.brand}`, borderLeft: `1px solid ${theme.brand}`, opacity: 0.8 }} />
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: `1px solid ${theme.brand}`, borderRight: `1px solid ${theme.brand}`, opacity: 0.8 }} />
        </>
      )}
      <div style={{
        minHeight: 40,
        padding: '9px 12px',
        background: theme.panelHeaderBg,
        borderBottom: `1px solid ${theme.panelBorder}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ color: theme.fg }}>{theme.useLineIcons ? <LineIcon name={iconLine} color="currentColor" stroke={1.35} /> : iconWarm}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.fg }}>{title}</span>
        <div style={{ flex: 1 }} />
        {badge !== undefined && (
          <span style={{
            minWidth: 24,
            height: 22,
            padding: '0 8px',
            borderRadius: theme.themeKey === 'warm' ? 999 : 0,
            clipPath: theme.themeKey === 'tactical'
              ? 'polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))'
              : 'none',
            background: `${badgeBg}20`,
            color: badgeBg,
            fontSize: 10,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: theme.monoFont,
            border: theme.themeKey === 'retro' ? `1px solid ${badgeBg}` : 'none',
            boxShadow: theme.themeKey === 'tactical'
              ? `0 0 14px ${badgeBg}35`
              : theme.themeKey === 'retro'
                ? `0 0 8px ${badgeBg}14`
                : 'none',
          }}>{badge}</span>
        )}
      </div>
      <div style={{ flex: 1, padding: '8px 10px', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function SpecPeoplePanel({ theme, style }) {
  return (
    <SpecCard theme={theme} title="직원" iconWarm="👥" iconLine="dashboard" badge={MEMBERS.length} style={style}>
      {MEMBERS.map((member) => {
        const dot = statusDotColor(theme, member.status);
        return (
          <div key={member.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 2px',
            borderBottom: `1px solid ${theme.panelBorder}55`,
          }}>
            {theme.avatarShape === 'status' ? (
              <span style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: dot,
                boxShadow: member.status === 'online' ? `0 0 6px ${dot}60` : 'none',
                flexShrink: 0,
              }} />
            ) : (
              <ProfileAvatar
                member={member}
                size={30}
                shape={theme.avatarShape}
                fallbackBg={member.color}
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
              <div style={{
                fontSize: 10,
                color: theme.fgMuted,
                fontWeight: 700,
                animation: theme.themeKey === 'tactical' && member.status === 'online'
                  ? 'tacticalPulse 1.8s infinite ease-in-out'
                  : 'none',
              }}>{statusText(member.status)}</div>
              {member.status === 'offline-connection' && theme.avatarShape !== 'status' && (
                <button style={{
                  marginTop: 4,
                  height: 22,
                  padding: '0 8px',
                  border: `1px solid ${theme.panelBorder}`,
                  background: theme.bgSunk,
                  color: theme.fg,
                  borderRadius: theme.panelRadius ? 999 : 4,
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: theme.font,
                }}>연락해보기</button>
              )}
            </div>
          </div>
        );
      })}
    </SpecCard>
  );
}

function SpecRecentPanel({ theme, style }) {
  return (
    <SpecCard theme={theme} title="최근 대화" iconWarm="💬" iconLine="chat" badge={Math.min(RECENT_MESSAGES.length, 7)} style={style}>
      {RECENT_MESSAGES.slice(0, 7).map((message) => (
        <div key={`${message.channel}-${message.time}`} style={{
          padding: '8px 2px',
          borderBottom: `1px solid ${theme.panelBorder}55`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              color: theme.brand,
              fontFamily: theme.monoFont,
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
    </SpecCard>
  );
}

function SpecTasksPanel({ theme }) {
  return (
    <SpecCard
      theme={theme}
      title="진행 중 업무"
      iconWarm="📋"
      iconLine="queue"
      badge={ACTIVE_MEETINGS.length}
      style={{ gridArea: 'tasks' }}
    >
      {ACTIVE_MEETINGS.slice(0, 5).map((meeting) => {
        const project = getProject(meeting.project);
        const tone = stateColor(theme, meeting.state);
        const progress = Math.round((SPEC_SSM_STAGE[meeting.state] / 12) * 100);
        const segments = Math.max(1, Math.round(progress / 8));
        return (
          <div key={meeting.id} style={{
            padding: '9px 2px',
            borderBottom: `1px solid ${theme.panelBorder}55`,
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
              <span style={{ fontSize: 10, fontWeight: 700, color: tone }}>{SPEC_PHASE_LABEL[meeting.state]}</span>
              <div style={{ display: 'flex' }}>
                {meeting.members.map((memberId, index) => {
                  const member = getMember(memberId);
                  if (theme.themeKey === 'retro') {
                    return (
                      <span
                        key={memberId}
                        style={{
                          marginLeft: index ? -2 : 0,
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: statusDotColor(theme, member.status),
                          boxShadow: `0 0 6px ${statusDotColor(theme, member.status)}60`,
                          display: 'inline-block',
                          alignSelf: 'center',
                        }}
                      />
                    );
                  }
                  return (
                    <div key={memberId} style={{ marginLeft: index ? -6 : 0 }}>
                      <ProfileAvatar
                        member={member}
                        size={18}
                        shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                        fallbackBg={member.color}
                        ringColor={theme.panelBg}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            {theme.themeKey === 'tactical' ? (
              <>
                <div style={{
                  marginTop: 8,
                  height: 10,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(12, 1fr)',
                  gap: 3,
                }}>
                  {Array.from({ length: 12 }).map((_, index) => {
                    const filled = index < SPEC_SSM_STAGE[meeting.state];
                    const distanceFromHead = SPEC_SSM_STAGE[meeting.state] - 1 - index;
                    const alpha = distanceFromHead <= 1 ? 1 : distanceFromHead <= 3 ? 0.75 : 0.45;
                    return (
                      <div key={index} style={{
                        background: filled ? tone : theme.bgSunk,
                        opacity: filled ? alpha : 1,
                        boxShadow: filled && distanceFromHead <= 1 ? `0 0 14px ${tone}70` : filled ? `0 0 6px ${tone}28` : 'none',
                        clipPath: 'polygon(0 0, calc(100% - 3px) 0, 100% 50%, calc(100% - 3px) 100%, 0 100%, 3px 50%)',
                      }} />
                    );
                  })}
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>
                  SSM::{SPEC_SSM_STAGE[meeting.state]}/12
                </div>
              </>
            ) : theme.themeKey === 'retro' ? (
              <>
                <div style={{ marginTop: 8, fontFamily: theme.monoFont, fontSize: 12, color: tone }}>
                  [{'█'.repeat(segments)}{'░'.repeat(15 - segments)}]
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>
                  SSM {SPEC_SSM_STAGE[meeting.state]}/12
                </div>
              </>
            ) : (
              <>
                <div style={{
                  marginTop: 8,
                  height: 6,
                  background: theme.bgSunk,
                  borderRadius: 999,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: tone,
                  }} />
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: theme.fgSubtle }}>
                  SSM {SPEC_SSM_STAGE[meeting.state]}/12
                </div>
              </>
            )}
          </div>
        );
      })}
    </SpecCard>
  );
}

function SpecApprovalsPanel({ theme }) {
  const countTone = APPROVAL_QUEUE.length ? theme.danger : theme.fgSubtle;
  return (
    <SpecCard
      theme={theme}
      title="결재 대기"
      iconWarm="🔔"
      iconLine="bell"
      badge={`${APPROVAL_QUEUE.length}건`}
      badgeTone={countTone}
      style={{ gridArea: 'approvals' }}
    >
      {APPROVAL_QUEUE.length === 0 ? (
        <div style={{
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.fgMuted,
          fontSize: 13,
        }}>처리할 결재가 없습니다 ✨</div>
      ) : (
        <div style={{ height: '100%', overflowY: 'auto', paddingRight: 2 }}>
          {APPROVAL_QUEUE.map((approval) => {
            const member = getMember(approval.requester);
            const project = getProject(approval.project);
            return (
              <div key={approval.id} style={{
                padding: '10px 2px',
                borderBottom: `1px solid ${theme.panelBorder}55`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {theme.themeKey === 'retro' ? (
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: statusDotColor(theme, member.status),
                      boxShadow: `0 0 6px ${statusDotColor(theme, member.status)}60`,
                      flexShrink: 0,
                    }} />
                  ) : (
                    <ProfileAvatar
                      member={member}
                      size={24}
                      shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                      fallbackBg={member.color}
                    />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: theme.fg }}>{member.name}</span>
                  <span style={{ fontSize: 11, color: theme.fgSubtle }}>{project?.name}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: theme.fgSubtle }}>{approval.time}</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: theme.fg, lineHeight: 1.45 }}>{approval.summary}</div>
                <div style={{ marginTop: 4, fontSize: 11, color: theme.fgMuted }}>{approval.reason}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <SpecMiniButton theme={theme} tone={theme.success}>✓ 허가</SpecMiniButton>
                  <SpecMiniButton theme={theme}>조건부</SpecMiniButton>
                  <SpecMiniButton theme={theme} tone={theme.danger}>거절</SpecMiniButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SpecCard>
  );
}

function SpecMiniButton({ theme, tone, children }) {
  const borderColor = tone || theme.panelBorder;
  return (
    <button style={{
      height: 28,
      padding: '0 10px',
      border: `1px solid ${borderColor}`,
      background: tone ? `${borderColor}18` : theme.bgSunk,
      color: tone || theme.fg,
      borderRadius: theme.themeKey === 'warm' ? 8 : 0,
      clipPath: 'none',
      fontSize: 11,
      fontWeight: 700,
      fontFamily: theme.themeKey === 'retro' ? theme.monoFont : theme.font,
      cursor: 'pointer',
      boxShadow: theme.themeKey === 'tactical'
        ? `0 0 10px ${borderColor}18`
        : theme.themeKey === 'retro'
          ? `0 0 8px ${borderColor}12`
          : 'none',
    }}>{children}</button>
  );
}

function SpecInsightStrip({ theme }) {
  const items = ['오늘 완료 4', '이번 주 완료 17', '누적 승인 142건', '평균 응답 9분'];
  return (
    <div style={{
      marginTop: 12,
      minHeight: 34,
      padding: '8px 12px',
      border: `1px solid ${theme.insightBorder}`,
      background: theme.insightBg,
      borderRadius: theme.themeKey === 'warm' ? 10 : 0,
      color: theme.insightColor,
      fontSize: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      boxShadow: theme.themeKey === 'retro' ? '0 0 8px rgba(245,180,103,0.04)' : 'none',
    }}>
      {items.map((item, index) => (
        <React.Fragment key={item}>
          {index > 0 && <span style={{ color: theme.fgSubtle }}>·</span>}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function SpecMainArea({ theme }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <style>{`
        @keyframes tacticalPulse {
          0%, 100% { opacity: 1; filter: drop-shadow(0 0 2px rgba(97,200,255,0.55)); }
          50% { opacity: 0.72; filter: drop-shadow(0 0 10px rgba(97,200,255,0.95)); }
        }
      `}</style>
      <SpecTopBar theme={theme} />
      <div style={{
        flex: 1,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <SpecHero theme={theme} />
        <div style={{
          marginTop: 12,
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.2fr 0.9fr 1fr',
          gridTemplateRows: '1.1fr 1fr',
          gridTemplateAreas: `
            "tasks tasks approvals"
            "people recent approvals"
          `,
          gap: 12,
        }}>
          <SpecTasksPanel theme={theme} />
          <SpecApprovalsPanel theme={theme} />
          <SpecPeoplePanel theme={theme} style={{ gridArea: 'people' }} />
          <SpecRecentPanel theme={theme} style={{ gridArea: 'recent' }} />
        </div>
        <SpecInsightStrip theme={theme} />
      </div>
    </div>
  );
}

function V6_WarmSpec() {
  return (
    <VariantFrame theme={themeWarmUnified} className="theme-shell theme-warm">
      <LeftRail theme={themeWarmUnified} />
      <ProjectRail theme={themeWarmUnified} />
      <SpecMainArea theme={themeWarmUnified} />
    </VariantFrame>
  );
}

function V7_GameSpec() {
  return (
    <VariantFrame theme={themeTacticalUnified} className="theme-shell theme-tactical">
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `
          radial-gradient(ellipse 980px 460px at 0% 0%, rgba(170,228,255,0.26), transparent 48%),
          radial-gradient(ellipse 620px 320px at 22% 0%, rgba(97,200,255,0.18), transparent 58%),
          radial-gradient(ellipse 520px 260px at 100% 100%, rgba(97,200,255,0.08), transparent 60%),
          linear-gradient(rgba(103,175,255,0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(103,175,255,0.05) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 100% 100%, 100% 100%, 42px 42px, 42px 42px',
      }} />
      <TacticalRail theme={themeTacticalUnified} />
      <TacticalProjectRail theme={themeTacticalUnified} />
      <SpecMainArea theme={themeTacticalUnified} />
    </VariantFrame>
  );
}

function V8_RetroSpec() {
  return (
    <VariantFrame theme={themeRetroUnified} className="theme-shell theme-retro">
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.008) 0, rgba(255,255,255,0.008) 1px, rgba(0,0,0,0.10) 1px, rgba(0,0,0,0.10) 3px)',
      }} />
      <div style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 11,
        background: 'radial-gradient(ellipse at center, transparent 44%, rgba(0,0,0,0.16) 100%)',
      }} />
      <RetroLineRail theme={themeRetroUnified} />
      <RetroProjectRail theme={themeRetroUnified} />
      <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', minWidth: 0 }}>
        <SpecMainArea theme={themeRetroUnified} />
      </div>
    </VariantFrame>
  );
}

Object.assign(window, {
  V6_WarmSpec,
  V7_GameSpec,
  V8_RetroSpec,
});
