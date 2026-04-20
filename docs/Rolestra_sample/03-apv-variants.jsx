// 03-apv-variants.jsx — Approvals / decision inbox in 6 theme flavors

// Extended approvals (adds historical items)
const APPROVAL_LOG = [
  ...APPROVAL_QUEUE,
  {
    id: 'a-past-1', requester: 'yuna', project: 'p-blog',
    kind: 'cli_permission', decided: 'approved',
    summary: '로그인 페이지 다크모드 CSS 추가', reason: '디자인 시스템 토큰 변경',
    files: ['src/styles/dark.css', 'src/components/LoginForm.tsx'],
    time: '13:54', decidedAt: '13:55',
  },
  {
    id: 'a-past-2', requester: 'daeho', project: 'p-research',
    kind: 'cli_permission', decided: 'rejected',
    summary: '리서치 원본 데이터 외부 저장소 업로드', reason: 'Google Drive API 연동',
    files: ['scripts/upload-research.ts'],
    time: '11:22', decidedAt: '11:24',
  },
  {
    id: 'a-past-3', requester: 'harin', project: 'p-landing',
    kind: 'consensus_decision', decided: 'approved',
    summary: '히어로 카피 2안 채택', reason: '합의 투표 3:1 통과',
    time: '10:05', decidedAt: '10:06',
  },
];

const KIND_LABEL = {
  cli_permission: '파일 수정',
  mode_transition: '권한 전환',
  consensus_decision: '합의 결과',
};

function ApvStatusBadge({ theme, approval, compact = false }) {
  const isRetro = theme.themeKey === 'retro';
  const isPending = !approval.decided;
  const statusColor = approval.decided === 'approved' ? theme.success
    : approval.decided === 'rejected' ? theme.danger
    : theme.warning;
  const label = isPending
    ? (isRetro ? '[P]' : '대기')
    : approval.decided === 'approved'
      ? (isRetro ? '[Y]' : '허가')
      : (isRetro ? '[N]' : '거절');

  return (
    <span style={{
      padding: compact ? '2px 8px' : '4px 10px',
      fontSize: compact ? 9 : 10,
      fontWeight: 700,
      color: statusColor,
      border: `1px solid ${statusColor}`,
      borderRadius: theme.themeKey === 'warm' ? 999 : 0,
      fontFamily: theme.monoFont,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      background: theme.mode === 'dark' ? `${statusColor}10` : `${statusColor}08`,
    }}>{label}</span>
  );
}

// ─── Filter bar ──────────────────────────────────────────────────────
function ApvFilterBar({ theme, active, onSet }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const tabs = [
    { id: 'pending', label: isRetro ? '[P] 대기' : '대기', count: APPROVAL_QUEUE.length },
    { id: 'approved', label: isRetro ? '[A] 허가' : '허가', count: 12 },
    { id: 'rejected', label: isRetro ? '[R] 거절' : '거절', count: 3 },
    { id: 'all', label: isRetro ? '[*] 전체' : '전체', count: 142 },
  ];
  return (
    <div style={{
      padding: '10px 18px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      display: 'flex', alignItems: 'center', gap: 8,
      background: theme.topBarBg, flexShrink: 0,
    }}>
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <div key={t.id} style={{
            padding: '6px 12px',
            background: isActive ? (theme.mode === 'dark' ? `${theme.brand}22` : `${theme.brand}14`) : 'transparent',
            border: `1px solid ${isActive ? theme.brand : theme.panelBorder}`,
            borderRadius: theme.themeKey === 'warm' ? 999 : 0,
            color: isActive ? theme.brand : theme.fgMuted,
            fontSize: 12, fontWeight: 700,
            fontFamily: isRetro ? theme.monoFont : theme.font,
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer',
            clipPath: isTactical
              ? 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)'
              : 'none',
          }}>
            <span>{t.label}</span>
            <span style={{
              color: isActive ? theme.brand : theme.fgSubtle,
              fontFamily: theme.monoFont,
            }}>{t.count}</span>
          </div>
        );
      })}
      <div style={{ flex: 1 }} />
      <div style={{
        padding: '6px 12px', fontSize: 11, color: theme.fgMuted,
        fontFamily: theme.monoFont,
      }}>평균 응답 9분 · 오늘 15건 처리</div>
    </div>
  );
}

// ─── Approval list row ───────────────────────────────────────────────
function ApvListRow({ theme, approval, active, onSelect }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const member = getMember(approval.requester);
  const project = getProject(approval.project);
  const activeBg = isTactical
    ? (theme.mode === 'dark' ? `${theme.brand}16` : `${theme.brand}12`)
    : isWarm ? theme.itemActiveBg : 'transparent';
  return (
    <div style={{
      padding: '12px 16px',
      background: active ? activeBg : 'transparent',
      borderLeft: `3px solid ${active ? theme.brand : 'transparent'}`,
      borderBottom: `1px solid ${theme.panelBorder}66`,
      cursor: 'pointer',
      clipPath: isTactical
        ? 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)'
        : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isRetro ? (
          <span style={{ width: 8, height: 8, borderRadius: 999,
            background: statusDotColor(theme, member.status),
            boxShadow: theme.mode === 'dark' ? `0 0 5px ${statusDotColor(theme, member.status)}60` : 'none',
          }} />
        ) : (
          <ProfileAvatar member={member} size={26}
            shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
            fallbackBg={member.color} />
        )}
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.fg,
          fontFamily: isRetro ? theme.monoFont : theme.font }}>{member.name}</span>
        <span style={{ fontSize: 11, color: theme.fgSubtle }}>·</span>
        <span style={{ fontSize: 11, color: theme.fgSubtle, fontFamily: theme.monoFont }}>{project?.name}</span>
        <div style={{ flex: 1 }} />
        <ApvStatusBadge theme={theme} approval={approval} compact />
      </div>
      <div style={{ marginTop: 6, fontSize: 13, color: theme.fg, lineHeight: 1.4,
        fontFamily: isRetro ? theme.monoFont : theme.font,
      }}>{approval.summary}</div>
      <div style={{ marginTop: 4, display: 'flex', gap: 10, fontSize: 10, color: theme.fgSubtle,
        fontFamily: theme.monoFont }}>
        <span>{KIND_LABEL[approval.kind] || approval.kind}</span>
        <span>·</span>
        <span>{approval.time}</span>
        {approval.files && (<><span>·</span><span>{approval.files.length}개 파일</span></>)}
      </div>
    </div>
  );
}

function ApvListPane({ theme, approvals, activeId }) {
  const isRetro = theme.themeKey === 'retro';
  const isWarm = theme.themeKey === 'warm';
  const sectionTitleStyle = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: isWarm ? 0.5 : 1.6,
    color: theme.fgSubtle,
    padding: '10px 16px 8px',
    fontFamily: isWarm ? theme.font : theme.monoFont,
    textTransform: isWarm ? 'none' : 'uppercase',
    borderBottom: `1px solid ${theme.panelBorder}`,
  };

  return (
    <div style={{
      width: 380, flexShrink: 0,
      background: theme.projectBg,
      borderRight: `1px solid ${theme.panelBorder}`,
      overflowY: 'auto',
    }}>
      <div style={sectionTitleStyle}>
        {isWarm ? '결재 요청' : isRetro ? '$ approvals' : 'APPROVAL INBOX'}
      </div>
      {approvals.map((approval) => (
        <ApvListRow
          key={approval.id}
          theme={theme}
          approval={approval}
          active={approval.id === activeId}
        />
      ))}
    </div>
  );
}

// ─── Detail panel (right side) ───────────────────────────────────────
function ApvDetail({ theme, approval }) {
  const isRetro = theme.themeKey === 'retro';
  const member = getMember(approval.requester);
  const project = getProject(approval.project);

  return (
    <div style={{
      flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column',
      background: theme.panelBg, overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {isRetro ? (
          <span style={{ width: 10, height: 10, borderRadius: 999,
            background: statusDotColor(theme, member.status) }} />
        ) : (
          <ProfileAvatar member={member} size={42}
            shape={theme.avatarShape === 'diamond' ? 'diamond' : 'circle'}
            fallbackBg={member.color} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 18, fontWeight: 700, color: theme.fg,
            fontFamily: isRetro ? theme.monoFont : (theme.displayFont || theme.font),
            letterSpacing: -0.2,
          }}>{member.name} · {member.role}</div>
          <div style={{ fontSize: 12, color: theme.fgMuted, fontFamily: theme.monoFont, marginTop: 2 }}>
            {member.cli} · {project?.name || 'unknown'}
          </div>
        </div>
        <ApvStatusBadge theme={theme} approval={approval} />
      </div>

      {/* Summary */}
      <div style={{
        marginTop: 18, fontSize: 20, lineHeight: 1.4, fontWeight: 600,
        color: theme.fg,
        fontFamily: isRetro ? theme.monoFont : (theme.displayFont || theme.font),
      }}>{approval.summary}</div>

      <div style={{
        marginTop: 8, fontSize: 13, color: theme.fgMuted, lineHeight: 1.55,
      }}>{approval.reason}</div>

      <div style={{ marginTop: 18, display: 'grid', gap: 14 }}>
        {approval.files && (
          <DashCard
            theme={theme}
            title="영향 받는 파일"
            asciiTitle="./files     "
            iconWarm="📄"
            iconLine="document"
            badge={approval.files.length}
          >
            <div style={{ margin: '-8px -10px' }}>
              {approval.files.map((f, i) => (
                <div key={f} style={{
                  padding: '10px 14px', fontSize: 12,
                  fontFamily: theme.monoFont, color: theme.fg,
                  borderBottom: i < approval.files.length - 1 ? `1px solid ${theme.panelBorder}55` : 'none',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{ color: theme.fgSubtle }}>{isRetro ? '$' : '📄'}</span>
                  <span>{f}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{
                    fontSize: 10, color: i === 0 ? theme.success : theme.warning,
                    fontFamily: theme.monoFont, letterSpacing: 1, fontWeight: 700,
                  }}>{i === 0 ? '+22 / -8' : '+45 / -0'}</span>
                </div>
              ))}
            </div>
          </DashCard>
        )}

        <DashCard
          theme={theme}
          title="변경 미리보기"
          asciiTitle="./diff      "
          iconWarm="🧩"
          iconLine="code"
        >
          <div style={{
            margin: '-2px 0 0',
            background: theme.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${theme.panelBorder}`,
            borderRadius: theme.themeKey === 'warm' ? 8 : 0,
            padding: '12px 14px',
            fontFamily: theme.monoFont, fontSize: 11,
            lineHeight: 1.6, color: theme.fg,
            clipPath: theme.themeKey === 'tactical'
              ? 'polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%)'
              : 'none',
          }}>
            <div style={{ color: theme.fgSubtle, marginBottom: 4 }}>// src/repositories/post-repository.ts</div>
            <div style={{ color: theme.danger }}>- const posts = await prisma.post.findMany();</div>
            <div style={{ color: theme.success }}>+ const posts = await prisma.post.findMany({'{'} include: {'{'} author: true {'}'} {'}'});</div>
            <div style={{ color: theme.fgSubtle, marginTop: 10 }}>// tests/post-repository.test.ts</div>
            <div style={{ color: theme.success }}>+ expect(queries).toHaveLength(1); {'//'} no N+1</div>
          </div>
        </DashCard>

        <DashCard
          theme={theme}
          title="합의 맥락"
          asciiTitle="./context   "
          iconWarm="🗳"
          iconLine="chat"
        >
          <div style={{ fontSize: 12, color: theme.fg, lineHeight: 1.6 }}>
            <div><span style={{ color: theme.success }}>✓</span> 민준 · 유나 찬성 (2/3)</div>
            <div><span style={{ color: theme.fgSubtle }}>·</span> "즉시 수정" 합의 도달 — 14:06</div>
            <div><span style={{ color: theme.fgSubtle }}>·</span> SSM 게이지 9/12 — 마감 가능 단계</div>
          </div>
        </DashCard>
      </div>

      {/* Action bar (pinned bottom) */}
      <div style={{ flex: 1 }} />
      <div style={{
        marginTop: 20, paddingTop: 14,
        borderTop: `1px solid ${theme.panelBorder}`,
        display: 'flex', gap: 8, alignItems: 'center',
        flexShrink: 0,
      }}>
        <DashMiniBtn theme={theme} tone="success" key1="Y" label="허가" />
        <DashMiniBtn theme={theme} tone="neutral" key1="C" label="조건부" />
        <DashMiniBtn theme={theme} tone="danger"  key1="N" label="거절" />
        <div style={{ flex: 1 }} />
        <div style={{
          fontSize: 11, color: theme.fgMuted,
          fontFamily: theme.monoFont,
        }}>{isRetro ? 'Y/C/N · J/K ↑↓' : 'Y · C · N 단축키'}</div>
      </div>
    </div>
  );
}

// ─── Variant ─────────────────────────────────────────────────────────
function ApvVariant({ theme }) {
  const selected = APPROVAL_LOG[0];
  return (
    <VariantFrame theme={theme}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
      `}</style>
      <NavRail theme={theme} active="approvals" />
      <ProjectRail theme={theme} activeId="p-blog" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ShellTopBar theme={theme} title="결재함"
          subtitle={`대기 ${APPROVAL_QUEUE.length}건 · 오늘 처리 15건`}
          showChips={false} />
        <ApvFilterBar theme={theme} active="pending" />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ApvListPane theme={theme} approvals={APPROVAL_LOG} activeId={selected.id} />
          <ApvDetail theme={theme} approval={selected} />
        </div>
      </div>
    </VariantFrame>
  );
}

function AV_WarmLight()     { return <ApvVariant theme={themeWarmLight} />; }
function AV_WarmDark()      { return <ApvVariant theme={themeWarmDark} />; }
function AV_TacticalLight() { return <ApvVariant theme={themeTacticalLight} />; }
function AV_TacticalDark()  { return <ApvVariant theme={themeTacticalDark} />; }
function AV_RetroLight()    { return <ApvVariant theme={themeRetroLight} />; }
function AV_RetroDark()     { return <ApvVariant theme={themeRetroDark} />; }

Object.assign(window, {
  AV_WarmLight, AV_WarmDark,
  AV_TacticalLight, AV_TacticalDark,
  AV_RetroLight, AV_RetroDark,
});
