// Rolestra shell — global nav (left rail + channel list), main area dispatcher

function ShellLayout({ view, setView, activeProjectId, setActiveProjectId, activeChannelId, setActiveChannelId, tweaks, setTweaks, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '56px 248px 1fr',
      height: '100vh',
      background: 'var(--bg)',
      color: 'var(--fg)',
      fontFamily: 'var(--font)',
      fontSize: 'var(--text-base)',
      overflow: 'hidden',
    }}>
      <GlobalRail view={view} setView={setView}
                  activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} />
      <SideNav view={view} setView={setView}
               activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId}
               activeChannelId={activeChannelId} setActiveChannelId={setActiveChannelId} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function GlobalRail({ view, setView, activeProjectId, setActiveProjectId }) {
  return (
    <div style={{
      background: 'var(--bg-sunk)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 8,
    }}>
      <div style={{ paddingBottom: 4 }}>
        <RolestraLogo size={32} />
      </div>
      <Divider style={{ width: 24, margin: '4px 0' }} />

      <RailBtn icon="🏢" active={view === 'dashboard'} onClick={() => setView('dashboard')} title="사무실 (대시보드)" />
      <RailBtn icon="💬" active={view === 'messenger'} onClick={() => setView('messenger')} title="메신저" />
      <RailBtn icon="🔔" active={view === 'approval'} onClick={() => setView('approval')} title="승인함" badge={4} />
      <RailBtn icon="▤"  active={view === 'queue'} onClick={() => setView('queue')} title="큐" />

      <div style={{ flex: 1 }} />

      <RailBtn icon="⚙" active={view === 'settings'} onClick={() => setView('settings')} title="설정" />
      <RailBtn icon="🚀" active={view === 'onboarding'} onClick={() => setView('onboarding')} title="온보딩 데모" />
    </div>
  );
}

function RailBtn({ icon, active, onClick, title, badge }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: 40, height: 40, borderRadius: 10,
        border: 'none',
        background: active ? 'var(--brand-soft)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: active ? 'var(--brand-soft-fg)' : 'var(--fg-muted)',
        fontSize: 18, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.12s',
      }}>
      {active && (
        <span style={{
          position: 'absolute', left: -12, top: 8, bottom: 8, width: 3,
          background: 'var(--brand)', borderRadius: 2,
        }} />
      )}
      {icon}
      {badge ? (
        <span style={{
          position: 'absolute', top: -2, right: -2,
          minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 8, background: 'var(--danger)', color: '#fff',
          fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 2px var(--bg-sunk)',
        }}>{badge}</span>
      ) : null}
    </button>
  );
}

function SideNav({ view, setView, activeProjectId, setActiveProjectId, activeChannelId, setActiveChannelId }) {
  const activeProject = PROJECTS.find(p => p.id === activeProjectId);
  const channels = CHANNELS_BY_PROJECT[activeProjectId] || [];

  return (
    <div style={{
      background: 'var(--bg-elev)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      minWidth: 0,
    }}>
      <ProjectSwitcher activeProjectId={activeProjectId} setActiveProjectId={setActiveProjectId} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {activeProject ? (
          <>
            <NavSection label="채널" action={<IconBtn title="채널 추가">+</IconBtn>}>
              {channels.map(ch => (
                <ChannelRow key={ch.id} channel={ch}
                            active={activeChannelId === ch.id && view === 'messenger'}
                            onClick={() => { setActiveChannelId(ch.id); setView('messenger'); }} />
              ))}
            </NavSection>
          </>
        ) : null}

        <NavSection label="다이렉트 메시지" action={<IconBtn title="DM 시작">+</IconBtn>}>
          {DMS.map(dm => {
            const m = MEMBERS.find(x => x.id === dm.memberId);
            return (
              <DmRow key={dm.id} member={m} unread={dm.unread}
                     active={activeChannelId === dm.id && view === 'messenger'}
                     onClick={() => { setActiveChannelId(dm.id); setView('messenger'); }} />
            );
          })}
        </NavSection>

        <NavSection label="직원 근무 현황">
          {MEMBERS.slice(0, 6).map(m => (
            <MemberRow key={m.id} member={m} />
          ))}
        </NavSection>
      </div>

      <div style={{
        borderTop: '1px solid var(--border)',
        padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #ec4899)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13,
        }}>나</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>대표</div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>1인 사무실 · 온라인</div>
        </div>
      </div>
    </div>
  );
}

function ProjectSwitcher({ activeProjectId, setActiveProjectId }) {
  const [open, setOpen] = React.useState(false);
  const active = PROJECTS.find(p => p.id === activeProjectId);
  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 12px', background: open ? 'var(--bg-hover)' : 'transparent',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
        }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'var(--brand-soft)', color: 'var(--brand-soft-fg)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        }}>{active?.icon || '🏢'}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {active?.name || '프로젝트 선택'}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)',
                        display: 'flex', alignItems: 'center', gap: 6 }}>
            <PermissionPill mode={active?.permission || 'approval'} />
            <AutonomyPill mode={active?.autonomy || 'manual'} />
          </div>
        </div>
        <span style={{ color: 'var(--fg-subtle)', fontSize: 12 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', left: 8, right: 8, top: '100%', zIndex: 100,
          marginTop: 4,
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 6,
          maxHeight: 400, overflowY: 'auto',
        }}>
          {PROJECTS.map(p => (
            <button key={p.id}
              onClick={() => { setActiveProjectId(p.id); setOpen(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 8px',
                background: p.id === activeProjectId ? 'var(--bg-active)' : 'transparent',
                border: 'none', borderRadius: 'var(--radius)',
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit',
              }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--bg-sunk)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {p.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg)', fontWeight: 500,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
                  {p.kind === 'external' ? '외부 연결' : p.kind === 'imported' ? '가져옴' : '신규'}
                  {' · '}{p.members.length}명
                  {p.status === 'folder_missing' && (
                    <span style={{ color: 'var(--danger)', marginLeft: 6 }}>⚠ 폴더 없음</span>
                  )}
                </div>
              </div>
              {p.unread > 0 && <Badge variant="danger">{p.unread}</Badge>}
            </button>
          ))}
          <Divider style={{ margin: '6px 0' }} />
          <button style={{
            width: '100%', padding: '8px 8px', textAlign: 'left',
            background: 'transparent', border: 'none', borderRadius: 'var(--radius)',
            color: 'var(--brand)', fontSize: 'var(--text-sm)', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>+ 새 프로젝트 만들기</button>
        </div>
      )}
    </div>
  );
}

function NavSection({ label, action, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 8px 4px',
        fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: 0.4, color: 'var(--fg-subtle)',
      }}>
        <span>{label}</span>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ChannelRow({ channel, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  const isSystem = channel.kind.startsWith('system');
  const prefix = channel.kind === 'system_approval' ? '🔔' :
                 channel.kind === 'system_minutes'  ? '📋' :
                 channel.kind === 'system_general'  ? '#' : '#';
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 10px',
        minHeight: 'var(--row-h)',
        background: active ? 'var(--brand-soft)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: active ? 'var(--brand-soft-fg)' : 'var(--fg)',
        border: 'none', borderRadius: 'var(--radius)',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit',
        fontWeight: (channel.unread > 0 || active) ? 600 : 400,
      }}>
      <span style={{
        color: active ? 'var(--brand-soft-fg)' : 'var(--fg-subtle)',
        fontSize: isSystem ? 12 : 'var(--text-base)',
        width: 14, textAlign: 'center',
      }}>{prefix}</span>
      <span style={{ flex: 1, fontSize: 'var(--text-sm)',
                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {channel.name}
      </span>
      {channel.active && <span style={{ fontSize: 10, color: 'var(--warning)' }}>●</span>}
      {channel.unread > 0 && !channel.active && (
        <span style={{
          minWidth: 18, height: 16, padding: '0 5px', borderRadius: 8,
          background: channel.kind === 'system_approval' ? 'var(--danger)' : 'var(--brand)',
          color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{channel.unread}</span>
      )}
    </button>
  );
}

function DmRow({ member, unread, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px',
        minHeight: 'var(--row-h)',
        background: active ? 'var(--brand-soft)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: 'var(--fg)',
        border: 'none', borderRadius: 'var(--radius)',
        cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit',
      }}>
      <Avatar member={member} size={20} avatarStyle={avatarStyle} showStatus />
      <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: unread > 0 ? 600 : 400 }}>
        {member.name}
        <span style={{ color: 'var(--fg-subtle)', fontWeight: 400, marginLeft: 5 }}>· {member.role}</span>
      </span>
      {unread > 0 && <Badge variant="solid">{unread}</Badge>}
    </button>
  );
}

function MemberRow({ member }) {
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '3px 10px',
      minHeight: 24,
    }}>
      <Avatar member={member} size={18} avatarStyle={avatarStyle} />
      <span style={{ flex: 1, fontSize: 'var(--text-sm)', color: 'var(--fg)',
                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {member.name} <span style={{ color: 'var(--fg-subtle)' }}>· {member.role.split(' ')[0]}</span>
      </span>
      <StatusDot status={member.status} />
    </div>
  );
}

Object.assign(window, { ShellLayout });
