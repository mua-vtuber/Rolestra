// Rest of views — approval, queue, settings, onboarding, member profile, + design canvas directions

// ─── Approval Inbox (full view) ─────────────────────────
function ApprovalView() {
  const [filter, setFilter] = React.useState('all');
  const filtered = APPROVAL_QUEUE.filter(a => filter === 'all' || a.kind === filter);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="승인함" subtitle={`${APPROVAL_QUEUE.length}건 결재 대기`}
        right={<div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant={filter==='all'?'primary':'ghost'} onClick={()=>setFilter('all')}>전체</Button>
          <Button size="sm" variant={filter==='cli_permission'?'primary':'ghost'} onClick={()=>setFilter('cli_permission')}>CLI 권한</Button>
          <Button size="sm" variant={filter==='mode_transition'?'primary':'ghost'} onClick={()=>setFilter('mode_transition')}>모드 전환</Button>
          <Button size="sm" variant={filter==='consensus_decision'?'primary':'ghost'} onClick={()=>setFilter('consensus_decision')}>합의 결정</Button>
        </div>} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.map(a => <ApprovalCardInline key={a.id} approval={a} />)}
          <RejectExample />
        </div>
      </div>
    </div>
  );
}

function RejectExample() {
  return (
    <div style={{
      border: '1px solid var(--border)', background: 'var(--bg-sunk)',
      borderRadius: 'var(--radius-lg)', padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 0.4, color: 'var(--fg-subtle)' }}>
        거절 다이얼로그 (예시)
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
        거절 시 자연어 코멘트를 입력하면, 다음 턴에 해당 직원에게 시스템 메시지로 주입됩니다.
      </div>
      <textarea rows={3} defaultValue="package.json 건드리지 마세요. 의존성 변경은 별도 PR로 올려주세요."
        style={{
          width: '100%', padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--bg-elev)', color: 'var(--fg)',
          fontFamily: 'inherit', fontSize: 'var(--text-sm)', resize: 'vertical',
        }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost">취소</Button>
        <Button variant="danger">거절 확정</Button>
      </div>
    </div>
  );
}

// ─── Queue View ────────────────────────────────────────
function QueueView({ activeProjectId }) {
  const project = PROJECTS.find(p => p.id === activeProjectId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="할 일 큐" subtitle={`${project?.icon} ${project?.name} · 큐 모드 자율`}
        right={<div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="default" icon="⏸">일시정지</Button>
          <Button size="sm" variant="primary" icon="+">항목 추가</Button>
        </div>} />
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <CircuitBreakerBanner />
          <Panel pad={false} style={{ marginTop: 16 }}>
            {QUEUE_ITEMS.map((q, i) => <QueueRow key={q.id} item={q} index={i+1} last={i===QUEUE_ITEMS.length-1}/>)}
          </Panel>
          <AddToQueueBox />
        </div>
      </div>
    </div>
  );
}

function CircuitBreakerBanner() {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '12px 14px', background: 'var(--bg-elev)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{ fontSize: 22 }}>🛡️</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>Circuit Breaker 활성</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
          연속 실행 2/5 · 턴당 파일 ≤ 20 · 회의당 ≤ 30분 · 동일 에러 3회 시 자동 중단
        </div>
      </div>
      <Button size="sm" variant="ghost">설정…</Button>
    </div>
  );
}

function QueueRow({ item, index, last }) {
  const statusMap = {
    done:        { icon: '✓', color: 'var(--success)', label: '완료' },
    in_progress: { icon: '◐', color: 'var(--brand)',   label: '진행 중' },
    pending:     { icon: '○', color: 'var(--fg-subtle)', label: '대기' },
    failed:      { icon: '✕', color: 'var(--danger)',  label: '실패' },
    paused:      { icon: '⏸', color: 'var(--warning)', label: '일시정지' },
    cancelled:   { icon: '⊘', color: 'var(--fg-subtle)', label: '취소됨' },
  };
  const s = statusMap[item.status];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 16px',
      borderBottom: last ? 'none' : '1px solid var(--border)',
      background: item.status === 'in_progress' ? 'var(--brand-soft)' : 'transparent',
    }}>
      <div style={{ width: 28, color: 'var(--fg-subtle)', fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)' }}>#{String(index).padStart(2, '0')}</div>
      <div style={{
        width: 24, height: 24, borderRadius: 12, flexShrink: 0,
        background: s.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700,
      }}>{s.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg)', fontWeight: 600,
                      textDecoration: item.status === 'done' || item.status === 'cancelled' ? 'line-through' : 'none',
                      opacity: item.status === 'done' || item.status === 'cancelled' ? 0.6 : 1 }}>
          {item.prompt}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>
          {item.status === 'in_progress' && <>● {item.progress} · 시작 {item.startedAt}</>}
          {item.status === 'done' && <>완료 {item.finishedAt}</>}
          {item.status === 'failed' && <span style={{ color: 'var(--danger)' }}>⚠ {item.error}</span>}
          {item.status === 'pending' && <>대기 중</>}
        </div>
      </div>
      <Badge variant={
        item.status === 'done' ? 'success' :
        item.status === 'failed' ? 'danger' :
        item.status === 'in_progress' ? 'brand' : 'default'
      }>{s.label}</Badge>
      {(item.status === 'pending' || item.status === 'failed') && (
        <IconBtn title="순서 변경">↕</IconBtn>
      )}
      {item.status === 'in_progress' && <Button size="sm" variant="danger">취소</Button>}
      {item.status === 'failed' && <Button size="sm" variant="default">다시 시도</Button>}
    </div>
  );
}

function AddToQueueBox() {
  return (
    <div style={{
      marginTop: 16, padding: '14px 16px',
      border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-lg)',
      background: 'var(--bg-elev)',
    }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 8 }}>
        새 항목 추가 — 줄바꿈으로 여러 개
      </div>
      <textarea rows={3} placeholder={'예:\n설정 화면에 테마 토글 추가\nREADME에 스크린샷 삽입'}
        style={{
          width: '100%', padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--bg)', color: 'var(--fg)',
          fontFamily: 'inherit', fontSize: 'var(--text-sm)', resize: 'vertical',
        }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost">취소</Button>
        <Button variant="primary">큐에 추가</Button>
      </div>
    </div>
  );
}

// ─── Settings View ─────────────────────────────────────
function SettingsView({ tweaks, setTweaks }) {
  const [section, setSection] = React.useState('permissions');
  const sections = [
    { id: 'permissions', label: '권한 모드', icon: '🛡' },
    { id: 'autonomy',    label: '자율 모드', icon: '⚡' },
    { id: 'breaker',     label: 'Circuit Breaker', icon: '🛑' },
    { id: 'notifications', label: '알림', icon: '🔔' },
    { id: 'arena_root',  label: 'ArenaRoot', icon: '📁' },
    { id: 'appearance',  label: '외관', icon: '🎨' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar title="설정" subtitle="Rolestra 전역 설정" />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ width: 220, borderRight: '1px solid var(--border)',
                      background: 'var(--bg-elev)', padding: 8 }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', border: 'none', borderRadius: 'var(--radius)',
                background: section === s.id ? 'var(--brand-soft)' : 'transparent',
                color: section === s.id ? 'var(--brand-soft-fg)' : 'var(--fg)',
                fontWeight: section === s.id ? 600 : 500,
                fontFamily: 'inherit', fontSize: 'var(--text-sm)',
                cursor: 'pointer', textAlign: 'left',
              }}>
              <span>{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 780, margin: '0 auto' }}>
            {section === 'permissions' && <PermissionsSettings />}
            {section === 'autonomy' && <AutonomySettings />}
            {section === 'breaker' && <BreakerSettings />}
            {section === 'notifications' && <NotificationSettings />}
            {section === 'arena_root' && <ArenaRootSettings />}
            {section === 'appearance' && <AppearanceSettings tweaks={tweaks} setTweaks={setTweaks} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingSection({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

function PermissionsSettings() {
  const rows = [
    { cli: 'Claude Code', auto: '--permission-mode acceptEdits + allowedTools', hybrid: '+ Bash 제외', approval: 'Read/Glob/Grep만' },
    { cli: 'Codex',       auto: '-a never --sandbox danger-full-access',       hybrid: '--full-auto (workspace-write)', approval: '-a on-failure' },
    { cli: 'Gemini',      auto: '--approval-mode yolo',                         hybrid: 'auto_edit',                     approval: 'default' },
  ];
  return (
    <>
      <SettingSection title="권한 모드 매트릭스">
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--text-sm)', marginBottom: 16 }}>
          3개 CLI × 3개 모드. external 프로젝트에서는 자율(auto) 선택 불가합니다.
        </div>
        <Panel pad={false}>
          <div style={{
            display: 'grid', gridTemplateColumns: '140px 1fr 1fr 1fr',
            fontSize: 'var(--text-xs)', fontWeight: 700,
            color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: 0.4,
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
          }}>
            <div>CLI</div>
            <div style={{ color: 'var(--warning)' }}>⚡ 자율 (auto)</div>
            <div style={{ color: 'var(--brand)' }}>◐ 혼합 (hybrid)</div>
            <div>✓ 승인 (approval)</div>
          </div>
          {rows.map((r, i) => (
            <div key={r.cli} style={{
              display: 'grid', gridTemplateColumns: '140px 1fr 1fr 1fr',
              padding: '12px 14px', gap: 10,
              borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none',
              fontSize: 'var(--text-xs)',
            }}>
              <div style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 'var(--text-sm)' }}>{r.cli}</div>
              <code style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{r.auto}</code>
              <code style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{r.hybrid}</code>
              <code style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{r.approval}</code>
            </div>
          ))}
        </Panel>
      </SettingSection>
      <SettingSection title="위험한 자율 모드">
        <ToggleRow label="⚠ Claude --dangerously-skip-permissions 사용"
          desc="기본 off. 켜면 프로젝트 배지에 'Dangerous Auto' 표시."  />
        <ToggleRow label="⚠ Codex --dangerously-bypass-approvals-and-sandbox"
          desc="세션 전체 bypass. 극한 자율. 복구 포인트 확보 후 사용." />
      </SettingSection>
    </>
  );
}

function AutonomySettings() {
  return (
    <>
      <SettingSection title="자율 모드">
        <RadioRow name="autonomy" value="manual" defaultChecked
          label="✋ 수동 (manual)" desc="각 단계마다 사용자 확인. 기본값." />
        <RadioRow name="autonomy" value="auto_toggle"
          label="🔁 자동 진행 (auto_toggle)" desc="AI끼리 합의 → 작업 → 리뷰 자동. 완료/실패 시 OS 알림." />
        <RadioRow name="autonomy" value="queue"
          label="▤ 큐 모드 (queue)" desc="할 일 목록을 순차 처리. 각 항목 완료 시 알림." />
      </SettingSection>
      <SettingSection title="자동 다운그레이드">
        <Panel>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
            Circuit Breaker 발동 / 리뷰 실패 / CLI 에러 시 자동으로 <strong style={{ color: 'var(--fg)' }}>수동(manual)</strong>으로 전환됩니다.
          </div>
        </Panel>
      </SettingSection>
    </>
  );
}

function BreakerSettings() {
  const limits = [
    { label: '턴당 파일 변경 수', value: 20, unit: '개' },
    { label: '누적 CLI 실행 시간', value: 30, unit: '분 / meeting' },
    { label: '큐 연속 실행', value: 5, unit: '항목' },
    { label: '같은 에러 반복', value: 3, unit: '연속 시' },
  ];
  return (
    <SettingSection title="Circuit Breaker 한계">
      <Panel pad={false}>
        {limits.map((l, i) => (
          <div key={l.label} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '14px 16px', borderBottom: i < limits.length - 1 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600 }}>{l.label}</div>
            <input type="number" defaultValue={l.value} style={{
              width: 80, padding: '6px 10px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'inherit',
              fontSize: 'var(--text-sm)', textAlign: 'right',
            }} />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', width: 120 }}>{l.unit}</span>
          </div>
        ))}
      </Panel>
    </SettingSection>
  );
}

function NotificationSettings() {
  const kinds = [
    ['new_message', '새 메시지'], ['approval_pending', '결재 대기'],
    ['work_done', '업무 완료'], ['error', '에러'],
    ['queue_progress', '큐 진행'], ['meeting_state', '회의 상태 변경'],
  ];
  return (
    <SettingSection title="OS 알림">
      {kinds.map(([k, label]) => (
        <ToggleRow key={k} label={label} desc={`${k} 이벤트에서 Windows/macOS 알림 발송`} defaultChecked={k !== 'meeting_state'} />
      ))}
    </SettingSection>
  );
}

function ArenaRootSettings() {
  return (
    <SettingSection title="ArenaRoot 위치">
      <Panel>
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', marginBottom: 8 }}>
          앱이 관리하는 루트 폴더. 모든 프로젝트·합의 문서·DB가 여기에 저장됩니다.
        </div>
        <div style={{
          padding: '12px 14px', background: 'var(--bg-sunk)',
          borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ flex: 1 }}>~/Documents/arena/</span>
          <Button size="sm" variant="default">변경…</Button>
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)', marginTop: 8 }}>
          경로 변경 시 앱 재시작 필요. 폴더 자동 이동은 하지 않습니다.
        </div>
      </Panel>
      <div style={{ height: 16 }} />
      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <StatBox value="5" label="프로젝트" accent="var(--brand)" />
          <StatBox value="128MB" label="사용 용량" accent="var(--fg)" />
          <StatBox value="2,341" label="합의 문서" accent="var(--success)" />
          <StatBox value="14" label="회의록" accent="var(--warning)" />
        </div>
      </Panel>
    </SettingSection>
  );
}

function AppearanceSettings({ tweaks, setTweaks }) {
  return (
    <SettingSection title="외관">
      <Panel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SegmentedControl label="테마"
            value={tweaks.mode} options={[['light','라이트'],['dark','다크']]}
            onChange={v => setTweaks({ ...tweaks, mode: v })} />
          <SegmentedControl label="밀도"
            value={tweaks.density} options={[['compact','Compact'],['comfortable','Comfortable']]}
            onChange={v => setTweaks({ ...tweaks, density: v })} />
          <SegmentedControl label="아바타 스타일"
            value={tweaks.avatarStyle} options={[['initials','이니셜 팔레트'],['emoji','이모지']]}
            onChange={v => setTweaks({ ...tweaks, avatarStyle: v })} />
        </div>
      </Panel>
    </SettingSection>
  );
}

function SegmentedControl({ label, value, options, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{
        display: 'inline-flex', padding: 3, gap: 2,
        background: 'var(--bg-sunk)', borderRadius: 'var(--radius)',
      }}>
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            style={{
              padding: '6px 14px', border: 'none', borderRadius: 'var(--radius)',
              background: value === v ? 'var(--bg-elev)' : 'transparent',
              color: value === v ? 'var(--fg)' : 'var(--fg-muted)',
              fontWeight: 600, fontSize: 'var(--text-sm)',
              boxShadow: value === v ? 'var(--shadow-sm)' : 'none',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, desc, defaultChecked }) {
  const [on, setOn] = React.useState(defaultChecked || false);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{label}</div>
        {desc && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{desc}</div>}
      </div>
      <button onClick={() => setOn(!on)} style={{
        width: 40, height: 24, borderRadius: 12, border: 'none',
        background: on ? 'var(--brand)' : 'var(--bg-sunk)',
        position: 'relative', cursor: 'pointer', transition: 'background 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 18 : 2,
          width: 20, height: 20, borderRadius: 10, background: '#fff',
          transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}

function RadioRow({ name, value, label, desc, defaultChecked }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '12px 14px',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      marginBottom: 8,
      cursor: 'pointer',
    }}>
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked}
        style={{ marginTop: 4, accentColor: 'var(--brand)' }} />
      <div>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{desc}</div>
      </div>
    </label>
  );
}

// ─── Onboarding ────────────────────────────────────────
function OnboardingView() {
  const [step, setStep] = React.useState(1);
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 40, background: 'var(--bg)', overflow: 'auto' }}>
      <div style={{ width: 640, maxWidth: '100%' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= step ? 'var(--brand)' : 'var(--bg-sunk)',
            }} />
          ))}
        </div>
        <Panel style={{ padding: 32 }}>
          {step === 1 && <OnboardStep1 next={()=>setStep(2)} />}
          {step === 2 && <OnboardStep2 next={()=>setStep(3)} back={()=>setStep(1)} />}
          {step === 3 && <OnboardStep3 next={()=>setStep(4)} back={()=>setStep(2)} />}
          {step === 4 && <OnboardStep4 back={()=>setStep(3)} />}
        </Panel>
        <div style={{ textAlign: 'center', marginTop: 12,
                      fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          스텝 {step} / 4
        </div>
      </div>
    </div>
  );
}

function OnboardStep1({ next }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <RolestraLogo size={64} />
      </div>
      <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, textAlign: 'center',
                    letterSpacing: -0.5 }}>Rolestra에 오신 걸 환영합니다</div>
      <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-muted)', textAlign: 'center',
                    marginTop: 8, textWrap: 'pretty' }}>
        Role + Orchestra. AI 직원들과 합주하는 1인회사 사무실.<br/>
        몇 가지 설정만 마치면 바로 출근합니다.
      </div>
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
        <Button variant="primary" size="lg" onClick={next}>시작하기 →</Button>
      </div>
    </>
  );
}

function OnboardStep2({ next, back }) {
  return (
    <>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>📁 ArenaRoot 선택</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', marginTop: 4, marginBottom: 20 }}>
        프로젝트·합의 문서·DB가 저장될 루트 폴더. 나중에 변경 가능.
      </div>
      <div style={{
        padding: '14px 16px', background: 'var(--bg-sunk)', borderRadius: 'var(--radius)',
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
      }}>
        <span style={{ fontSize: 24 }}>📁</span>
        <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
          ~/Documents/arena/
        </code>
        <Button size="sm">변경…</Button>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
        이 경로는 <code>consensus/</code>, <code>projects/</code>, <code>db/</code>, <code>logs/</code> 하위를 생성합니다.
      </div>
      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={back}>← 뒤로</Button>
        <Button variant="primary" onClick={next}>다음 →</Button>
      </div>
    </>
  );
}

function OnboardStep3({ next, back }) {
  return (
    <>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>👥 첫 직원 초대</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', marginTop: 4, marginBottom: 20 }}>
        CLI 또는 API 키를 연결하고 페르소나를 설정합니다. 나중에 추가 가능.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {MEMBERS.slice(0, 4).map(m => (
          <label key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 14px', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', cursor: 'pointer',
          }}>
            <input type="checkbox" defaultChecked={m.cliId !== 'local'}
              style={{ accentColor: 'var(--brand)' }} />
            <Avatar member={m} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                {m.name} · {m.role}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
                {m.cli} · {m.expertise}
              </div>
            </div>
            <Badge>감지됨</Badge>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={back}>← 뒤로</Button>
        <Button variant="primary" onClick={next}>다음 →</Button>
      </div>
    </>
  );
}

function OnboardStep4({ back }) {
  const [kind, setKind] = React.useState('new');
  return (
    <>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>🚀 첫 프로젝트</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)', marginTop: 4, marginBottom: 20 }}>
        빈 프로젝트로 시작하거나 기존 폴더를 연결할 수 있습니다.
      </div>
      <input type="text" placeholder="프로젝트 이름" defaultValue="첫번째-프로젝트"
        style={{
          width: '100%', padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--bg)', color: 'var(--fg)',
          fontFamily: 'inherit', fontSize: 'var(--text-base)',
          marginBottom: 14,
        }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          ['new', '신규 빈 프로젝트', '~/Documents/arena/projects/<slug>/ 새 폴더'],
          ['external', '외부 폴더 연결', 'junction/symlink로 투명 연결. 원본 보존'],
          ['imported', '외부 폴더 가져오기', 'ArenaRoot로 복사. 원본은 건드리지 않음'],
        ].map(([v, l, d]) => (
          <label key={v} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '12px 14px',
            border: `1px solid ${kind === v ? 'var(--brand)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', cursor: 'pointer',
            background: kind === v ? 'var(--brand-soft)' : 'transparent',
          }}>
            <input type="radio" name="k" checked={kind === v} onChange={() => setKind(v)}
              style={{ marginTop: 3, accentColor: 'var(--brand)' }} />
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{l}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)', marginTop: 2 }}>{d}</div>
            </div>
          </label>
        ))}
      </div>
      <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" onClick={back}>← 뒤로</Button>
        <Button variant="primary" size="lg">사무실 출근 →</Button>
      </div>
    </>
  );
}

Object.assign(window, { ApprovalView, QueueView, SettingsView, OnboardingView });
