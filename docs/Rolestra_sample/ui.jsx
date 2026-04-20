// Shared UI primitives for Rolestra prototype

const STATUS_META = {
  'online': { color: 'var(--success)', label: '출근' },
  'connecting': { color: 'var(--warning)', label: '연결 중' },
  'offline-connection': { color: 'var(--danger)', label: '연결 끊김' },
  'offline-manual': { color: 'var(--fg-subtle)', label: '퇴근' },
};

function Avatar({ member, size = 32, avatarStyle = 'initials', showStatus = false, ring = false }) {
  const dim = size + 'px';
  const fontSize = Math.floor(size * 0.42) + 'px';
  return (
    <div style={{ position: 'relative', width: dim, height: dim, flexShrink: 0 }}>
      <div style={{
        width: dim, height: dim, borderRadius: '50%',
        background: member.color,
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 600, fontSize,
        boxShadow: ring ? `0 0 0 2px var(--bg-elev), 0 0 0 4px ${member.color}` : 'none',
        userSelect: 'none',
      }}>
        {avatarStyle === 'emoji' ? (
          <span style={{ fontSize: Math.floor(size * 0.55) + 'px' }}>{member.emoji}</span>
        ) : (
          <span>{member.initials}</span>
        )}
      </div>
      {showStatus && (
        <span style={{
          position: 'absolute', bottom: -1, right: -1,
          width: Math.max(8, size * 0.28) + 'px', height: Math.max(8, size * 0.28) + 'px',
          borderRadius: '50%',
          background: STATUS_META[member.status].color,
          boxShadow: '0 0 0 2px var(--bg-elev)',
        }} />
      )}
    </div>
  );
}

function StatusDot({ status, size = 8 }) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size, borderRadius: '50%',
      background: meta.color,
      boxShadow: status === 'connecting' ? `0 0 0 2px ${meta.color}33` : 'none',
      animation: status === 'connecting' ? 'rolestra-pulse 1.6s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  );
}

function Badge({ children, variant = 'default', size = 'sm' }) {
  const variants = {
    default: { bg: 'var(--bg-sunk)', fg: 'var(--fg-muted)' },
    brand: { bg: 'var(--brand-soft)', fg: 'var(--brand-soft-fg)' },
    success: { bg: 'rgba(22,163,74,0.12)', fg: 'var(--success)' },
    warning: { bg: 'rgba(217,119,6,0.14)', fg: 'var(--warning)' },
    danger: { bg: 'rgba(220,38,38,0.12)', fg: 'var(--danger)' },
    solid: { bg: 'var(--brand)', fg: 'var(--brand-fg)' },
  };
  const v = variants[variant];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: size === 'sm' ? '2px 7px' : '4px 10px',
      borderRadius: 999,
      background: v.bg, color: v.fg,
      fontSize: size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      lineHeight: 1.3,
    }}>{children}</span>
  );
}

function Button({ children, variant = 'default', size = 'md', onClick, icon, disabled, fullWidth }) {
  const variants = {
    default: { bg: 'var(--bg-elev)', fg: 'var(--fg)', border: '1px solid var(--border)', hover: 'var(--bg-hover)' },
    primary: { bg: 'var(--brand)', fg: 'var(--brand-fg)', border: '1px solid var(--brand)', hover: 'var(--brand)' },
    ghost: { bg: 'transparent', fg: 'var(--fg-muted)', border: '1px solid transparent', hover: 'var(--bg-hover)' },
    danger: { bg: 'transparent', fg: 'var(--danger)', border: '1px solid var(--border)', hover: 'rgba(220,38,38,0.08)' },
    success: { bg: 'var(--success)', fg: '#fff', border: '1px solid var(--success)', hover: 'var(--success)' },
  };
  const v = variants[variant];
  const sizes = {
    sm: { h: 26, px: 10, fs: 'var(--text-xs)' },
    md: { h: 32, px: 12, fs: 'var(--text-sm)' },
    lg: { h: 40, px: 16, fs: 'var(--text-base)' },
  };
  const s = sizes[size];
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        height: s.h, padding: `0 ${s.px}px`,
        background: hover && !disabled ? (variant === 'primary' || variant === 'success' ? v.bg : v.hover) : v.bg,
        color: v.fg, border: v.border,
        borderRadius: 'var(--radius)',
        fontSize: s.fs, fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : (hover && (variant === 'primary' || variant === 'success') ? 0.92 : 1),
        transition: 'all 0.12s ease',
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}{children}
    </button>
  );
}

function IconBtn({ children, onClick, title, active }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: active ? 'var(--bg-active)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
        border: 'none', borderRadius: 'var(--radius)',
        cursor: 'pointer',
        fontSize: 15,
      }}
    >{children}</button>
  );
}

function Panel({ children, style = {}, pad = true }) {
  return (
    <div style={{
      background: 'var(--bg-elev)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: pad ? 'var(--pad-x)' : 0,
      ...style,
    }}>{children}</div>
  );
}

function Divider({ v, style = {} }) {
  return v ? (
    <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', ...style }} />
  ) : (
    <div style={{ height: 1, width: '100%', background: 'var(--border)', ...style }} />
  );
}

// ─── Permission mode pill ──────────────────────────────
function PermissionPill({ mode }) {
  const map = {
    auto:     { label: '자율',   variant: 'warning', icon: '⚡' },
    hybrid:   { label: '혼합',   variant: 'brand',   icon: '◐' },
    approval: { label: '승인',   variant: 'default', icon: '✓' },
  };
  const m = map[mode];
  return <Badge variant={m.variant}><span>{m.icon}</span>{m.label}</Badge>;
}

function AutonomyPill({ mode }) {
  const map = {
    manual:      { label: '수동',      icon: '✋' },
    auto_toggle: { label: '자동 진행', icon: '🔁' },
    queue:       { label: '큐 모드',   icon: '▤' },
  };
  const m = map[mode];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 'var(--text-xs)', color: 'var(--fg-muted)',
      fontWeight: 500,
    }}>
      <span>{m.icon}</span>{m.label}
    </span>
  );
}

// Logo — a circular cluster of members forming an orchestra ring
function RolestraLogo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
      <circle cx="16" cy="16" r="14" fill="var(--brand)" />
      <circle cx="16" cy="8"  r="2.4" fill="var(--brand-fg)" opacity="0.95"/>
      <circle cx="22" cy="12" r="2.0" fill="var(--brand-fg)" opacity="0.8"/>
      <circle cx="22" cy="20" r="2.0" fill="var(--brand-fg)" opacity="0.65"/>
      <circle cx="16" cy="24" r="2.4" fill="var(--brand-fg)" opacity="0.5"/>
      <circle cx="10" cy="20" r="2.0" fill="var(--brand-fg)" opacity="0.65"/>
      <circle cx="10" cy="12" r="2.0" fill="var(--brand-fg)" opacity="0.8"/>
      <circle cx="16" cy="16" r="3.4" fill="var(--brand-fg)" />
    </svg>
  );
}

Object.assign(window, {
  STATUS_META, Avatar, StatusDot, Badge, Button, IconBtn, Panel, Divider,
  PermissionPill, AutonomyPill, RolestraLogo,
});
