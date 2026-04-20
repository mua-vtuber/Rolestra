// 02-msg-variants.jsx — Messenger / meeting-in-progress screen in 6 theme flavors

function MsgChannelRail({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const projectId = 'p-blog';
  const project = getProject(projectId);
  const channels = CHANNELS_BY_PROJECT[projectId] || [];
  const prefix = PROJECT_PREFIX_MAP[projectId];
  const sectionTitleStyle = {
    padding: '10px 8px',
    fontSize: 10,
    fontWeight: 700,
    color: theme.fgSubtle,
    letterSpacing: isWarm ? 0.5 : 1.5,
    fontFamily: isWarm ? theme.font : theme.monoFont,
    textTransform: isWarm ? 'none' : 'uppercase',
  };

  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: theme.projectBg,
      borderRight: `1px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column',
      fontFamily: theme.font,
    }}>
      <div style={{
        padding: '14px 16px 10px', fontSize: 12, fontWeight: 700,
        color: theme.fgMuted, textTransform: 'uppercase', letterSpacing: 1,
        fontFamily: theme.monoFont,
        borderBottom: `1px solid ${theme.border}`,
      }}>
        {isRetro ? `${prefix} ` : ''}{project?.name || '프로젝트'}
      </div>

      <div style={sectionTitleStyle}>{isWarm ? '채널' : isRetro ? '$ channels' : 'CHANNELS'}</div>

      {channels.map((channel) => {
        const active = channel.id === 'c-blog-refactor';
        const activeBg = isTactical
          ? (theme.mode === 'dark' ? `${theme.brand}16` : `${theme.brand}12`)
          : isWarm
            ? theme.itemActiveBg
            : 'transparent';
        return (
          <div key={channel.id} style={{
            margin: '1px 6px', padding: '7px 10px',
            borderRadius: theme.themeKey === 'warm' ? 6 : 0,
            background: active ? activeBg : 'transparent',
            border: active
              ? `1px solid ${isTactical ? `${theme.brand}55` : isRetro ? theme.border : theme.border}`
              : '1px solid transparent',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, color: active ? theme.fg : theme.fgMuted,
            fontFamily: isRetro ? theme.monoFont : theme.font,
            fontWeight: active ? 700 : 500,
            clipPath: isTactical
              ? 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)'
              : 'none',
          }}>
            <span style={{
              color: active ? theme.brand : theme.fgSubtle,
              minWidth: isRetro ? 12 : 'auto',
              textAlign: 'center',
              textShadow: active && isRetro && theme.mode === 'dark' ? `0 0 4px ${theme.brand}66` : 'none',
            }}>
              {isRetro ? (active ? '▶' : '·') : '#'}
            </span>
            <span>{channel.name}</span>
            <div style={{ flex: 1 }} />
            {channel.unread > 0 && (
              <span style={{
                minWidth: 18, height: 16, padding: '0 5px',
                background: theme.danger, color: '#fff',
                borderRadius: theme.themeKey === 'warm' ? 999 : 0,
                fontSize: 9, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{channel.unread}</span>
            )}
          </div>
        );
      })}

    </div>
  );
}

// ─── Meeting banner (top of thread) ──────────────────────────────────
function MsgMeetingBanner({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const color = theme.success;

  if (isRetro) {
    return (
      <div style={{
        padding: '10px 18px',
        background: theme.mode === 'dark' ? 'rgba(0,0,0,0.28)' : theme.bgSunk,
        borderBottom: `1px solid ${theme.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 12,
        flexShrink: 0,
        fontFamily: theme.monoFont,
      }}>
        <span style={{
          color,
          textShadow: theme.mode === 'dark' ? `0 0 6px ${color}66` : 'none',
          fontWeight: 700,
        }}>[LIVE]</span>
        <span style={{ fontSize: 12, color: theme.fg }}>getPosts 쿼리 N+1 문제 해결</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: theme.fgMuted }}>crew=3 · elapsed=10m · ssm=9/12</span>
      </div>
    );
  }

  return (
    <div style={{
      padding: '10px 18px',
      background: isTactical
        ? theme.panelHeaderBg
        : isWarm ? theme.heroBg : theme.mode === 'dark' ? `${color}18` : `${color}12`,
      borderBottom: `1px solid ${theme.panelBorder}`,
      display: 'flex', alignItems: 'center', gap: 12,
      flexShrink: 0,
      clipPath: isTactical ? themeClip(theme) : 'none',
      boxShadow: isTactical ? `inset 0 0 0 1px ${theme.brand}22` : 'none',
    }}>
      {isTactical ? (
        <LineIcon name="spark" color={theme.brand} stroke={1.4} />
      ) : (
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: color,
          boxShadow: `0 0 8px ${color}`,
          animation: 'dashPulse 1.6s infinite ease-in-out',
        }} />
      )}
      <div style={{
        padding: isWarm ? '4px 10px' : '0',
        borderRadius: isWarm ? 999 : 0,
        background: isWarm ? `${color}12` : 'transparent',
        fontSize: 11, fontWeight: 700, color: isWarm ? theme.brandDeep : (isTactical ? theme.brand : color),
        fontFamily: theme.monoFont, letterSpacing: 1,
      }}>
        {isTactical ? 'MEETING ACTIVE' : '회의 진행중'}
      </div>
      <div style={{ fontSize: 13, color: theme.fg, fontWeight: 600 }}>
        getPosts 쿼리 N+1 문제 해결
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 11, color: theme.fgMuted, fontFamily: theme.monoFont }}>
        참여 3명 · 경과 10분 · SSM 9/12
      </div>
    </div>
  );
}

// ─── Message bubble / row ────────────────────────────────────────────
function MsgMessage({ theme, message }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const isSystem = message.kind === 'system';
  const isApproval = message.kind === 'approval_request';
  const isMe = message.author === 'me';
  const member = !isSystem && getMember(message.author);

  if (isSystem) {
    const content = message.content;
    return (
      <div style={{
        margin: '10px 0', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, height: 1, background: `${theme.panelBorder}` }} />
        <div style={{
          padding: '4px 12px', fontSize: 11,
          color: theme.fgMuted,
          fontFamily: isRetro ? theme.monoFont : theme.font,
          background: isTactical ? `${theme.brand}10` : 'transparent',
          border: isTactical ? `1px solid ${theme.brand}44` : 'none',
          borderRadius: isWarm ? 999 : 0,
        }}>{isRetro ? `— ${content.replace(/^[📌🗳✅]\s*/, '')} —` : content}</div>
        <div style={{ flex: 1, height: 1, background: `${theme.panelBorder}` }} />
      </div>
    );
  }

  return (
    <div style={{
      padding: '10px 0', display: 'flex', gap: 10,
      opacity: 1,
    }}>
      {isRetro ? (
        <span style={{
          fontSize: 12, fontFamily: theme.monoFont,
          color: theme.brand, fontWeight: 700, minWidth: 64,
        }}>{member.name}</span>
      ) : (
        <ProfileAvatar
          member={member} size={32}
          shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
          fallbackBg={member.color}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isRetro && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: theme.fg }}>{member.name}</span>
            <span style={{ fontSize: 11, color: theme.fgSubtle, fontFamily: theme.monoFont }}>{message.time}</span>
            <span style={{ fontSize: 11, color: theme.fgMuted }}>· {member.role}</span>
          </div>
        )}
        <div style={{
          marginTop: isRetro ? 0 : 4,
          fontSize: 13, lineHeight: 1.55, color: theme.fg,
          fontFamily: isRetro ? theme.monoFont : theme.font,
        }}>{message.content}</div>

        {isApproval && (
          <div style={{
            marginTop: 8, padding: '10px 12px',
            border: `1.5px solid ${theme.warning}`,
            background: theme.mode === 'dark' ? `${theme.warning}14` : `${theme.warning}10`,
            borderRadius: isWarm ? 8 : 0,
            clipPath: isTactical ? 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)' : 'none',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: theme.warning,
              fontFamily: theme.monoFont, letterSpacing: 1, marginBottom: 6,
            }}>{isRetro ? '[APPROVAL REQUESTED]' : '⚠ 승인 요청'}</div>
            <div style={{ fontSize: 12, color: theme.fg, marginBottom: 6 }}>{message.reason}</div>
            {message.files && (
              <div style={{ fontFamily: theme.monoFont, fontSize: 11, color: theme.fgMuted, marginBottom: 8 }}>
                {message.files.map(f => <div key={f}>  {f}</div>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <DashMiniBtn theme={theme} tone="success" key1="Y" label="허가" />
              <DashMiniBtn theme={theme} tone="neutral" key1="C" label="조건부" />
              <DashMiniBtn theme={theme} tone="danger"  key1="N" label="거절" />
            </div>
          </div>
        )}

        {message.voteStatus && (
          <div style={{
            marginTop: 6, display: 'flex', gap: 14, fontSize: 11,
            fontFamily: theme.monoFont, color: theme.fgMuted,
          }}>
            <span>✓ 찬성 {message.voteStatus.yes}</span>
            <span>✗ 반대 {message.voteStatus.no}</span>
            <span>· 대기 {message.voteStatus.pending}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thread + composer ───────────────────────────────────────────────
function MsgThread({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isWarm = theme.themeKey === 'warm';
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{
        padding: '10px 18px',
        borderBottom: `1px solid ${theme.panelBorder}`,
        display: 'flex', alignItems: 'center', gap: 10,
        background: theme.topBarBg,
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: theme.fg, fontFamily: isRetro ? theme.monoFont : theme.font }}>
          # 리팩토링
        </div>
        <div style={{ fontSize: 12, color: theme.fgMuted }}>
          블로그 · getPosts 최적화
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: theme.fgMuted, fontFamily: theme.monoFont }}>
          3명 참여
        </div>
      </div>

      <MsgMeetingBanner theme={theme} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 18px' }}>
        {MEETING_THREAD.map((m) => <MsgMessage key={m.id} theme={theme} message={m} />)}
      </div>

      <div style={{
        padding: '12px 18px',
        borderTop: `1px solid ${theme.panelBorder}`,
        background: theme.panelBg, flexShrink: 0,
      }}>
        <div style={{
          minHeight: 44, padding: '10px 14px',
          background: theme.bgSunk, color: theme.fgSubtle,
          border: `1px solid ${theme.panelBorder}`,
          borderRadius: isWarm ? 10 : 0,
          fontSize: 13,
          fontFamily: isRetro ? theme.monoFont : theme.font,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ color: theme.brand }}>{isRetro ? '>' : '✎'}</span>
          <span>메시지 입력 — Shift+Enter로 줄바꿈</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, fontFamily: theme.monoFont, color: theme.fgSubtle }}>⏎ 전송</span>
        </div>
      </div>
    </div>
  );
}

// ─── Member side panel ───────────────────────────────────────────────
function MsgMemberPanel({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const participants = ['jiwoo', 'minjun', 'yuna'];
  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: theme.projectBg,
      borderLeft: `1px solid ${theme.panelBorder}`,
      padding: '14px 12px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <DashCard
        theme={theme}
        title="참여자"
        asciiTitle="./crew      "
        iconWarm="👥"
        iconLine="dashboard"
        badge={participants.length}
      >
        <div style={{ margin: '-8px -10px' }}>
          {participants.map((id, index) => {
            const m = getMember(id);
            const dot = statusDotColor(theme, m.status);
            return (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px',
                borderBottom: index < participants.length - 1 ? `1px solid ${theme.panelBorder}55` : 'none',
              }}>
                {isRetro ? (
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
                ) : (
                  <ProfileAvatar member={m} size={28}
                    shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
                    fallbackBg={m.color} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: theme.fg,
                    fontFamily: isRetro ? theme.monoFont : theme.font }}>{m.name}</div>
                  <div style={{ fontSize: 10, color: theme.fgSubtle, fontFamily: theme.monoFont }}>{m.cli}</div>
                </div>
              </div>
            );
          })}
        </div>
      </DashCard>

      <DashCard
        theme={theme}
        title="합의 상태"
        asciiTitle="./consensus "
        iconWarm="🗳"
        iconLine="chat"
      >
        <div style={{ fontSize: 12, color: theme.fg, lineHeight: 1.6 }}>
          <div><span style={{ color: theme.success }}>✓</span> 민준 찬성</div>
          <div><span style={{ color: theme.success }}>✓</span> 유나 찬성</div>
          <div><span style={{ color: theme.fgSubtle }}>·</span> 지우 (상정자)</div>
        </div>

        <div style={{
          marginTop: 10,
          padding: '10px 12px',
          background: theme.bgSunk,
          border: `1px solid ${theme.panelBorder}`,
          borderRadius: theme.themeKey === 'warm' ? 8 : 0,
          fontSize: 11, color: theme.fgMuted, lineHeight: 1.6,
          fontFamily: theme.monoFont,
          clipPath: theme.themeKey === 'tactical'
            ? 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)'
            : 'none',
        }}>
          <div style={{ color: theme.fg, fontWeight: 700, marginBottom: 4 }}>SSM 9/12</div>
          마감 가능 단계 도달 · 대표 결재 후 작업 종료
        </div>
      </DashCard>
    </div>
  );
}

// ─── Variant frame ───────────────────────────────────────────────────
function MsgVariant({ theme }) {
  return (
    <VariantFrame theme={theme}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
      `}</style>
      <NavRail theme={theme} active="messenger" />
      <ProjectRail theme={theme} activeId="p-blog" />
      <MsgChannelRail theme={theme} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ShellTopBar theme={theme} title="메시지"
          subtitle="p-blog / 리팩토링 · 회의 진행중"
          showChips={false} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <MsgThread theme={theme} />
          <MsgMemberPanel theme={theme} />
        </div>
      </div>
    </VariantFrame>
  );
}

function MV_WarmLight()     { return <MsgVariant theme={themeWarmLight} />; }
function MV_WarmDark()      { return <MsgVariant theme={themeWarmDark} />; }
function MV_TacticalLight() { return <MsgVariant theme={themeTacticalLight} />; }
function MV_TacticalDark()  { return <MsgVariant theme={themeTacticalDark} />; }
function MV_RetroLight()    { return <MsgVariant theme={themeRetroLight} />; }
function MV_RetroDark()     { return <MsgVariant theme={themeRetroDark} />; }

Object.assign(window, {
  MV_WarmLight, MV_WarmDark,
  MV_TacticalLight, MV_TacticalDark,
  MV_RetroLight, MV_RetroDark,
});
