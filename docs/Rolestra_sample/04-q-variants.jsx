// 04-q-variants.jsx — Task queue / work list in 6 theme flavors

const QUEUE_STATUS_COLOR = (theme, status) => {
  if (status === 'done')        return theme.success;
  if (status === 'in_progress') return theme.warning;
  if (status === 'failed')      return theme.danger;
  return theme.fgSubtle;
};
const QUEUE_STATUS_LABEL = {
  done: '완료', in_progress: '진행중', pending: '대기', failed: '실패',
};
const QUEUE_STATUS_ASCII = {
  done: '[✓]', in_progress: '[→]', pending: '[ ]', failed: '[✗]',
};

const QUEUE_STAGE = {
  done: 12,
  in_progress: 8,
  pending: 3,
  failed: 4,
};

function QProgressGauge({ theme, status, compact = false }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const filled = QUEUE_STAGE[status];
  const color = QUEUE_STATUS_COLOR(theme, status);

  if (isRetro) {
    const total = compact ? 10 : 12;
    const count = Math.min(total, Math.max(0, Math.round((filled / 12) * total)));
    return (
      <div style={{
        fontFamily: theme.monoFont,
        fontSize: compact ? 10 : 11,
        color,
        lineHeight: 1.2,
      }}>
        [{'█'.repeat(count)}{'░'.repeat(total - count)}]
      </div>
    );
  }

  if (isTactical) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(12, 1fr)',
        gap: compact ? 2 : 3,
        height: compact ? 8 : 10,
      }}>
        {Array.from({ length: 12 }).map((_, idx) => {
          const active = idx < filled;
          return (
            <div key={idx} style={{
              background: active ? color : theme.bgSunk,
              boxShadow: active ? `0 0 ${compact ? 5 : 8}px ${color}80` : 'none',
              clipPath: 'polygon(0 0, calc(100% - 3px) 0, 100% 50%, calc(100% - 3px) 100%, 0 100%, 3px 50%)',
            }} />
          );
        })}
      </div>
    );
  }

  const width = status === 'done' ? '100%' : status === 'in_progress' ? '62%' : status === 'failed' ? '34%' : '18%';
  return (
    <div style={{
      height: compact ? 8 : 10,
      background: theme.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.05)',
      borderRadius: 999,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        width,
        background: color,
      }} />
    </div>
  );
}

// ─── Summary bar (top) ───────────────────────────────────────────────
function QStatBar({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const counts = QUEUE_ITEMS.reduce((acc, i) => (acc[i.status] = (acc[i.status] || 0) + 1, acc), {});
  const stats = [
    { label: '대기', value: counts.pending || 0, color: theme.fgSubtle },
    { label: '진행중', value: counts.in_progress || 0, color: theme.warning },
    { label: '완료 (오늘)', value: counts.done || 0, color: theme.success },
    { label: '실패', value: counts.failed || 0, color: theme.danger },
  ];
  if (isRetro) {
    const summaryText = `done[${counts.done || 0}] | active[${counts.in_progress || 0}] | wait[${counts.pending || 0}] | fail[${counts.failed || 0}]`;
    return (
      <div style={{
        margin: '14px 18px 0',
        padding: '14px 18px',
        background: theme.heroBg,
        border: `1px solid ${theme.heroBorder}`,
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        fontFamily: theme.monoFont,
      }}>
        <div style={{ minWidth: 180, color: theme.fg }}>
          <div style={{ fontSize: 11, color: theme.fgMuted }}>$ queue --summary</div>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.65 }}>
            {summaryText}
            <span style={{
              display: 'inline-block', width: 8, height: 14, marginLeft: 6,
              background: theme.brand, verticalAlign: 'text-bottom',
              boxShadow: theme.mode === 'dark' ? `0 0 6px ${theme.brand}55` : 'none',
              animation: 'dashCursor 1.06s infinite step-end',
            }} />
          </div>
        </div>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'center',
          paddingLeft: 18, borderLeft: `1px solid ${theme.heroBorder}`,
        }}>
          <DashMiniBtn theme={theme} tone="success" key1="R" label="재실행 전체" />
          <DashMiniBtn theme={theme} tone="neutral" key1="P" label="일시정지" />
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '14px 18px', display: 'flex', gap: 14,
      background: theme.heroBg,
      border: `1px solid ${theme.heroBorder}`,
      borderRadius: isWarm ? 10 : 0,
      clipPath: isTactical ? theme.panelClip : 'none',
      margin: '14px 18px 0', flexShrink: 0,
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          flex: 1, padding: '6px 10px',
          borderLeft: i > 0 ? `1px solid ${theme.heroBorder}` : 'none',
        }}>
          <div style={{
            fontSize: 30, fontWeight: 700, color: theme.heroValue, lineHeight: 1,
            fontFamily: isTactical || isRetro ? theme.monoFont : (theme.displayFont || theme.font),
          }}>{s.value}</div>
          <div style={{
            marginTop: 5, fontSize: 11, fontWeight: 700,
            color: theme.heroLabel,
            fontFamily: theme.monoFont, letterSpacing: isTactical ? 1.3 : 0,
          }}>{s.label}</div>
        </div>
      ))}
      <div style={{ flex: 2, borderLeft: `1px solid ${theme.heroBorder}`, paddingLeft: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        <DashMiniBtn theme={theme} tone="success" key1="R" label="재실행 전체" />
        <DashMiniBtn theme={theme} tone="neutral" key1="P" label="일시정지" />
      </div>
    </div>
  );
}

// ─── Queue row (swimlane style) ──────────────────────────────────────
function QRow({ theme, item, position }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const isWarm = theme.themeKey === 'warm';
  const color = QUEUE_STATUS_COLOR(theme, item.status);
  const isActive = item.status === 'in_progress';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '48px 120px 1fr 140px 100px 120px',
      alignItems: 'center', gap: 14,
      padding: '12px 16px',
      background: isActive
        ? (theme.mode === 'dark' ? `${theme.warning}10` : `${theme.warning}08`)
        : (position % 2 && isRetro ? theme.mode === 'dark' ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)' : 'transparent'),
      borderBottom: `1px solid ${theme.panelBorder}55`,
      borderLeft: isActive ? `3px solid ${theme.warning}` : '3px solid transparent',
    }}>
      <div style={{
        fontSize: 12, color: theme.fgSubtle, fontFamily: theme.monoFont,
        fontWeight: 700,
      }}>#{String(position + 1).padStart(2, '0')}</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {isRetro ? (
          <span style={{ fontFamily: theme.monoFont, color, fontSize: 12, fontWeight: 700 }}>
            {QUEUE_STATUS_ASCII[item.status]}
          </span>
        ) : (
          <span style={{
            width: 8, height: 8, borderRadius: 999, background: color,
            boxShadow: isActive
              ? `0 0 8px ${color}`
              : (isTactical && item.status === 'done' ? `0 0 5px ${color}60` : 'none'),
            animation: isActive ? 'dashPulse 1.6s infinite ease-in-out' : 'none',
            flexShrink: 0,
          }} />
        )}
        <span style={{
          fontSize: 11, fontWeight: 700, color,
          fontFamily: theme.monoFont, letterSpacing: 0.8,
          textTransform: 'uppercase',
        }}>{QUEUE_STATUS_LABEL[item.status]}</span>
      </div>

      <div style={{
        fontSize: 13, color: theme.fg,
        fontFamily: isRetro ? theme.monoFont : theme.font,
        lineHeight: 1.4,
      }}>{item.prompt}</div>

      <div style={{
        fontSize: 11, color: theme.fgMuted,
        fontFamily: theme.monoFont,
      }}>
        {item.status === 'done' && <>완료 {item.finishedAt}</>}
        {item.status === 'in_progress' && <>{item.progress}</>}
        {item.status === 'pending' && <>대기열</>}
        {item.status === 'failed' && <span style={{ color: theme.danger }}>{item.error}</span>}
      </div>

      <QProgressGauge theme={theme} status={item.status} compact />

      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {item.status === 'failed' && <DashMiniBtn theme={theme} tone="success" key1="R" label="재시도" />}
        {item.status === 'pending' && <DashMiniBtn theme={theme} tone="neutral" key1="S" label="시작" />}
        {item.status === 'in_progress' && <DashMiniBtn theme={theme} tone="danger" key1="X" label="중단" />}
        {item.status === 'done' && <DashMiniBtn theme={theme} tone="neutral" key1="V" label="보기" />}
      </div>
    </div>
  );
}

// ─── Active task spotlight ───────────────────────────────────────────
function QActiveCard({ theme }) {
  const isRetro = theme.themeKey === 'retro';
  const isTactical = theme.themeKey === 'tactical';
  const active = QUEUE_ITEMS.find((q) => q.status === 'in_progress');
  if (!active) return null;
  return (
    <DashCard
      theme={theme}
      title="현재 작업"
      asciiTitle="./live      "
      iconWarm="🎯"
      iconLine="spark"
      badge={isRetro ? 'LIVE' : '진행중'}
      badgeTone={theme.warning}
      style={{
        margin: '14px 18px',
        border: `1.5px solid ${theme.warning}`,
        clipPath: isTactical ? themeClip(theme) : 'none',
        boxShadow: isTactical ? `0 0 20px ${theme.warning}30` : theme.panelShadow,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: theme.warning,
          boxShadow: `0 0 10px ${theme.warning}`,
          animation: 'dashPulse 1.4s infinite ease-in-out',
        }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: theme.warning,
          fontFamily: theme.monoFont, letterSpacing: 1.2, textTransform: 'uppercase',
        }}>{isRetro ? '>> 현재 작업' : '현재 작업 중'}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: theme.fgMuted, fontFamily: theme.monoFont }}>
          시작 {active.startedAt} · 경과 8분 · 3명 참여
        </span>
      </div>
      <div style={{
        fontSize: 17, fontWeight: 600, color: theme.fg, lineHeight: 1.45,
        fontFamily: isRetro ? theme.monoFont : (theme.displayFont || theme.font),
      }}>{active.prompt}</div>
      <div style={{
        marginTop: 8, fontSize: 12, color: theme.fgMuted, lineHeight: 1.6,
      }}>
        {active.progress} · 담당 <b style={{ color: theme.fg }}>지우</b> · 디자인 리뷰 <b style={{ color: theme.fg }}>하린</b>
      </div>

      <div style={{ marginTop: 10 }}>
        <QProgressGauge theme={theme} status="in_progress" />
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: theme.fgMuted, fontFamily: theme.monoFont,
        display: 'flex', justifyContent: 'space-between' }}>
        <span>SSM 8/12 — 합의 단계</span>
        <span>다음: 리뷰어 선정</span>
      </div>
    </DashCard>
  );
}

// ─── Header row (for queue table) ────────────────────────────────────
function QHeaderRow({ theme }) {
  const headers = ['ID', '상태', '프롬프트', '타임스탬프', '진행도', ''];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '48px 120px 1fr 140px 100px 120px',
      gap: 14, padding: '8px 16px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      background: theme.mode === 'dark' ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.02)',
      fontSize: 10, fontWeight: 700, color: theme.fgMuted,
      fontFamily: theme.monoFont, letterSpacing: 1.2,
      textTransform: 'uppercase',
    }}>
      {headers.map((h, i) => <div key={i}>{h}</div>)}
    </div>
  );
}

// ─── Variant ─────────────────────────────────────────────────────────
function QVariant({ theme }) {
  return (
    <VariantFrame theme={theme}>
      <style>{`
        @keyframes dashPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.65; } }
        @keyframes dashCursor { 50% { opacity: 0; } }
      `}</style>
      <NavRail theme={theme} active="queue" />
      <ProjectRail theme={theme} activeId="p-blog" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <ShellTopBar theme={theme} title="작업 큐"
          subtitle={`${QUEUE_ITEMS.length}건 · 오늘 완료 ${QUEUE_ITEMS.filter((q) => q.status === 'done').length}`}
          showChips={false} />
        <QStatBar theme={theme} />
        <QActiveCard theme={theme} />
        <DashCard
          theme={theme}
          title="전체 큐"
          asciiTitle="./queue     "
          iconWarm="📋"
          iconLine="queue"
          badge={QUEUE_ITEMS.length}
          style={{
            margin: '0 18px 18px',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div style={{
            margin: '-8px -10px',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: `1px solid ${theme.panelBorder}`,
              display: 'flex', alignItems: 'center', gap: 8,
              background: theme.panelHeaderBg,
            }}>
              <span style={{ fontSize: 11, color: theme.fgMuted, fontFamily: theme.monoFont }}>
                자동 실행 · 최대 동시성 1건
              </span>
            </div>
            <QHeaderRow theme={theme} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {QUEUE_ITEMS.map((q, i) => <QRow key={q.id} theme={theme} item={q} position={i} />)}
            </div>
          </div>
        </DashCard>
      </div>
    </VariantFrame>
  );
}

function QV_WarmLight()     { return <QVariant theme={themeWarmLight} />; }
function QV_WarmDark()      { return <QVariant theme={themeWarmDark} />; }
function QV_TacticalLight() { return <QVariant theme={themeTacticalLight} />; }
function QV_TacticalDark()  { return <QVariant theme={themeTacticalDark} />; }
function QV_RetroLight()    { return <QVariant theme={themeRetroLight} />; }
function QV_RetroDark()     { return <QVariant theme={themeRetroDark} />; }

Object.assign(window, {
  QV_WarmLight, QV_WarmDark,
  QV_TacticalLight, QV_TacticalDark,
  QV_RetroLight, QV_RetroDark,
});
