// Dashboard view — 3-column office home

function DashboardView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="사무실" subtitle="오늘의 1인회사 현황" />
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <DashboardHero />
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.2fr 1fr',
            gap: 16,
            marginTop: 20,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <MembersWidget />
              <NotesWidget />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <TasksWidget />
              <QueueMiniWidget />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <ApprovalsWidget />
              <RecentChatsWidget />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopBar({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      minHeight: 56,
    }}>
      <div>
        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--fg)' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

function DashboardHero() {
  const onlineCount = MEMBERS.filter(m => m.status === 'online').length;
  const busyMeetings = ACTIVE_MEETINGS.length;
  const pendingApprovals = APPROVAL_QUEUE.length;
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--brand) 0%, #8b5cf6 100%)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      boxShadow: 'var(--shadow-md)',
    }}>
      <div>
        <div style={{ fontSize: 'var(--text-xs)', opacity: 0.8, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          좋은 오후입니다, 대표님
        </div>
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginTop: 4 }}>
          {onlineCount}명이 출근 중 · {busyMeetings}개 회의 진행 · {pendingApprovals}건 결재 대기
        </div>
        <div style={{ fontSize: 'var(--text-sm)', opacity: 0.9, marginTop: 4 }}>
          오늘 완료된 업무 4건 · 주간 합계 17건
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={{
          padding: '10px 16px', borderRadius: 'var(--radius)',
          background: 'rgba(255,255,255,0.2)', color: '#fff',
          border: '1px solid rgba(255,255,255,0.3)', fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 'var(--text-sm)',
        }}>+ 새 프로젝트</button>
        <button style={{
          padding: '10px 16px', borderRadius: 'var(--radius)',
          background: '#fff', color: 'var(--brand)',
          border: 'none', fontWeight: 600, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 'var(--text-sm)',
        }}>회의 소집</button>
      </div>
    </div>
  );
}

function Widget({ title, icon, action, children, flex }) {
  return (
    <div style={{
      background: 'var(--bg-elev)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column',
      flex: flex ? 1 : 'none',
      minHeight: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg)' }}>
          <span>{icon}</span>{title}
        </div>
        {action}
      </div>
      <div style={{ padding: 'var(--pad-x)' }}>{children}</div>
    </div>
  );
}

function MembersWidget() {
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <Widget title="직원" icon="👥" action={<Badge>{MEMBERS.length}명</Badge>}>
      {MEMBERS.map(m => (
        <div key={m.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 4px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Avatar member={m} size={34} avatarStyle={avatarStyle} showStatus />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--fg)' }}>
              {m.name} <span style={{ fontWeight: 400, color: 'var(--fg-muted)' }}>· {m.role}</span>
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.cli}
            </div>
          </div>
          <Badge variant={
            m.status === 'online' ? 'success' :
            m.status === 'connecting' ? 'warning' :
            m.status === 'offline-connection' ? 'danger' : 'default'
          }>{STATUS_META[m.status].label}</Badge>
        </div>
      ))}
    </Widget>
  );
}

function TasksWidget() {
  return (
    <Widget title="진행 중 업무" icon="📋" action={<Badge variant="brand">{ACTIVE_MEETINGS.length}개</Badge>}>
      {ACTIVE_MEETINGS.map(mt => {
        const project = PROJECTS.find(p => p.id === mt.project);
        const stateColor = mt.state === 'WORKING' ? 'var(--success)' :
                           mt.state === 'CONSENSUS' ? 'var(--warning)' : 'var(--brand)';
        return (
          <div key={mt.id} style={{
            padding: '10px 4px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--fg-subtle)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                {mt.id}
              </span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, flex: 1,
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {mt.topic}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{mt.elapsed}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
                {project?.icon} {project?.name} · #{mt.channel}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{
                fontSize: 'var(--text-xs)', color: stateColor, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: stateColor,
                               animation: 'rolestra-pulse 1.6s infinite' }} />
                {mt.state}
              </span>
              <div style={{ display: 'flex', marginLeft: 4 }}>
                {mt.members.slice(0, 3).map((mid, i) => {
                  const m = MEMBERS.find(x => x.id === mid);
                  return (
                    <div key={mid} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 3 - i }}>
                      <Avatar member={m} size={18} ring />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </Widget>
  );
}

function ApprovalsWidget() {
  return (
    <Widget title="결재 대기" icon="🔔"
            action={<Badge variant="danger">{APPROVAL_QUEUE.length}건</Badge>}>
      {APPROVAL_QUEUE.slice(0, 3).map(a => {
        const m = MEMBERS.find(x => x.id === a.requester);
        const p = PROJECTS.find(x => x.id === a.project);
        return (
          <div key={a.id} style={{
            padding: '10px 4px', borderBottom: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar member={m} size={22} />
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{m.name}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
                {p?.icon} {p?.name}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{a.time}</span>
            </div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg)' }}>
              {a.summary}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <Button size="sm" variant="success" icon="✓">허가</Button>
              <Button size="sm" variant="default">조건부</Button>
              <Button size="sm" variant="danger">거절</Button>
            </div>
          </div>
        );
      })}
      <div style={{ textAlign: 'center', padding: '10px 4px 4px' }}>
        <button style={{
          background: 'transparent', border: 'none',
          color: 'var(--brand)', fontWeight: 600, fontSize: 'var(--text-sm)',
          cursor: 'pointer', fontFamily: 'inherit',
        }}>승인함 전체 보기 →</button>
      </div>
    </Widget>
  );
}

function RecentChatsWidget() {
  return (
    <Widget title="최근 대화" icon="💬">
      {RECENT_MESSAGES.map((msg, i) => {
        const m = MEMBERS.find(x => x.id === msg.author);
        if (!m) return null;
        return (
          <div key={i} style={{
            padding: '8px 4px', display: 'flex', gap: 8,
            borderBottom: i < RECENT_MESSAGES.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <Avatar member={m} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{m.name}</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)' }}>
                  {msg.channel}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>{msg.time}</span>
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {msg.content}
              </div>
            </div>
          </div>
        );
      })}
    </Widget>
  );
}

function NotesWidget() {
  return (
    <Widget title="공지 & 통계" icon="📝">
      <div style={{ padding: '4px 4px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <StatBox value="4" label="오늘 완료" accent="var(--success)" />
          <StatBox value="17" label="이번 주" accent="var(--brand)" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StatBox value="128" label="누적 커밋" accent="var(--fg)" />
          <StatBox value="3건" label="실패 복구" accent="var(--warning)" />
        </div>
      </div>
    </Widget>
  );
}

function StatBox({ value, label, accent }) {
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg-sunk)',
      borderRadius: 'var(--radius)',
    }}>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: accent, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function QueueMiniWidget() {
  const inProgress = QUEUE_ITEMS.find(q => q.status === 'in_progress');
  const pending = QUEUE_ITEMS.filter(q => q.status === 'pending').length;
  const done = QUEUE_ITEMS.filter(q => q.status === 'done').length;
  return (
    <Widget title="큐 진행 상황" icon="▤" action={<Badge variant="brand">큐 모드</Badge>}>
      {inProgress && (
        <div style={{
          padding: '10px 12px', background: 'var(--brand-soft)',
          color: 'var(--brand-soft-fg)',
          borderRadius: 'var(--radius)', marginBottom: 8,
        }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: 0.3,
                        textTransform: 'uppercase', marginBottom: 4, opacity: 0.8 }}>
            현재 작업
          </div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            {inProgress.prompt}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', opacity: 0.8, marginTop: 4 }}>
            {inProgress.progress} · 시작 {inProgress.startedAt}
          </div>
        </div>
      )}
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)',
                    display: 'flex', justifyContent: 'space-between', padding: '4px 4px' }}>
        <span>완료 {done}</span>
        <span>대기 {pending}</span>
        <span style={{ color: 'var(--danger)' }}>실패 1</span>
      </div>
    </Widget>
  );
}

Object.assign(window, { DashboardView, TopBar });
