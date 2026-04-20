// Messenger view — channel header + meeting banner + message thread + composer

function MessengerView({ activeProjectId, activeChannelId, setView }) {
  const project = PROJECTS.find(p => p.id === activeProjectId);
  const channels = CHANNELS_BY_PROJECT[activeProjectId] || [];
  let channel = channels.find(c => c.id === activeChannelId);
  let isDm = false;
  let dmMember = null;
  if (!channel) {
    const dm = DMS.find(d => d.id === activeChannelId);
    if (dm) {
      isDm = true;
      dmMember = MEMBERS.find(x => x.id === dm.memberId);
      channel = { id: dm.id, name: dmMember.name, kind: 'dm' };
    }
  }
  if (!channel) channel = channels[0];

  // If this is the "리팩토링" channel, show the full meeting thread. Otherwise show a simple starter convo.
  const showMeeting = channel?.id === 'c-blog-refactor';
  const isApprovalChannel = channel?.kind === 'system_approval';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <ChannelHeader channel={channel} project={project} isDm={isDm} dmMember={dmMember} />
      {showMeeting && <MeetingBanner />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
            {isApprovalChannel ? (
              <ApprovalChannelThread />
            ) : showMeeting ? (
              <MeetingThread />
            ) : (
              <SimpleThread channel={channel} isDm={isDm} dmMember={dmMember} />
            )}
          </div>
          <Composer channel={channel} readOnly={channel?.readOnly} />
        </div>
        <MembersSidebar project={project} />
      </div>
    </div>
  );
}

function ChannelHeader({ channel, project, isDm, dmMember }) {
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      minHeight: 56,
    }}>
      {isDm ? (
        <>
          <Avatar member={dmMember} size={32} avatarStyle={avatarStyle} showStatus />
          <div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>
              {dmMember.name}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
              {dmMember.role} · {STATUS_META[dmMember.status].label}
            </div>
          </div>
        </>
      ) : (
        <>
          <span style={{ fontSize: 22, color: 'var(--fg-subtle)' }}>#</span>
          <div>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              {channel?.name || '채널'}
              {channel?.readOnly && <Badge>읽기 전용</Badge>}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
              {project?.icon} {project?.name} · {project?.members.length}명 참여
            </div>
          </div>
        </>
      )}
      <div style={{ flex: 1 }} />
      {!isDm && channel?.kind === 'user' && !channel?.active && (
        <Button variant="primary" icon="🗣">회의 시작</Button>
      )}
      <IconBtn title="검색">🔍</IconBtn>
      <IconBtn title="핀">📌</IconBtn>
      <IconBtn title="설정">⚙</IconBtn>
    </div>
  );
}

function MeetingBanner() {
  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(99,102,241,0.1), rgba(139,92,246,0.06))',
      borderBottom: '1px solid var(--border)',
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 14, background: 'var(--brand)',
        color: 'var(--brand-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>🗣</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--fg)' }}>
          회의 #17 진행 중 — "getPosts 쿼리 N+1 문제 해결"
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
          <span style={{ color: 'var(--success)', fontWeight: 600 }}>● WORKING</span>
          {' · '}경과 10분 · 지우가 작업 중
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="default">회의록</Button>
        <Button size="sm" variant="danger">회의 종료</Button>
      </div>
    </div>
  );
}

function MeetingThread() {
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <DateSeparator label="오늘, 2026년 4월 19일" />
      {MEETING_THREAD.map((msg, i) => {
        if (msg.kind === 'system') return <SystemMessage key={msg.id} message={msg} />;
        if (msg.kind === 'approval_request') return <InlineApproval key={msg.id} message={msg} />;
        const member = MEMBERS.find(x => x.id === msg.author);
        const prev = MEETING_THREAD[i - 1];
        const compact = prev && prev.author === msg.author && prev.kind === 'member';
        return <Message key={msg.id} member={member} message={msg} compact={compact} />;
      })}
      <TypingIndicator member={MEMBERS.find(m => m.id === 'yuna')} text="테스트 케이스 작성 중" />
    </div>
  );
}

function SimpleThread({ channel, isDm, dmMember }) {
  // Generic channel convo — light content based on channel name
  const generic = [
    { author: 'seoyeon', content: '오늘 스프린트 리뷰 2시에 시작할게요.', time: '09:14' },
    { author: 'harin',   content: '알겠습니다. 피그마 링크 공유드릴게요.', time: '09:15' },
    { author: 'jiwoo',   content: '리팩토링 브랜치 올려두셨나요? 머지 먼저 해야 프리뷰가 정상으로 뜰 듯.', time: '09:22' },
    { author: 'minjun',  content: '머지함. 디플로이 러닝 중.', time: '09:24' },
  ];
  const dmConvo = dmMember ? [
    { author: dmMember.id, content: `안녕하세요 대표님, ${dmMember.name}입니다. 오늘 제가 봐야 할 작업 있을까요?`, time: '어제 18:30' },
    { author: dmMember.id, content: '아 그리고 Friday 1시 팀 싱크 제가 못 갑니다. 회의록만 남겨주세요.', time: '어제 18:32' },
  ] : [];

  const convo = isDm ? dmConvo : generic;
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <DateSeparator label={isDm ? '어제' : '오늘, 2026년 4월 19일'} />
      {isDm ? null : (
        <SystemMessage message={{ content: `📣 #${channel?.name} 채널이 개설되었습니다.`, time: '09:00' }} />
      )}
      {convo.map((m, i) => {
        const member = MEMBERS.find(x => x.id === m.author);
        if (!member) return null;
        const prev = convo[i - 1];
        const compact = prev && prev.author === m.author;
        return <Message key={i} member={member} message={m} compact={compact} />;
      })}
    </div>
  );
}

function ApprovalChannelThread() {
  return (
    <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <DateSeparator label="승인함 — 결재 대기 항목만 표시됩니다" />
      {APPROVAL_QUEUE.map(a => <ApprovalCardInline key={a.id} approval={a} />)}
    </div>
  );
}

function DateSeparator({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)',
                    padding: '2px 10px', borderRadius: 999, background: 'var(--bg-sunk)',
                    fontWeight: 600 }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function Message({ member, message, compact }) {
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <div style={{ display: 'flex', gap: 10, padding: compact ? '1px 0' : '6px 0' }}>
      <div style={{ width: 36, flexShrink: 0 }}>
        {!compact && <Avatar member={member} size={36} avatarStyle={avatarStyle} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 700, color: 'var(--fg)', fontSize: 'var(--text-sm)' }}>
              {member.name}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
              {member.role} · {member.cli}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
              {message.time}
            </span>
          </div>
        )}
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg)', lineHeight: 1.5, textWrap: 'pretty' }}>
          {message.content}
        </div>
        {message.voteStatus && (
          <VoteTally vote={message.voteStatus} />
        )}
      </div>
    </div>
  );
}

function SystemMessage({ message }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', margin: '4px 48px',
      background: 'var(--bg-sunk)',
      borderRadius: 'var(--radius)',
      fontSize: 'var(--text-sm)', color: 'var(--fg-muted)',
    }}>
      <span style={{ flex: 1 }}>{message.content}</span>
      {message.time && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>{message.time}</span>}
      {message.voteStatus && <VoteTally vote={message.voteStatus} inline />}
    </div>
  );
}

function VoteTally({ vote, inline }) {
  return (
    <div style={{
      marginLeft: inline ? 8 : 0, marginTop: inline ? 0 : 4,
      display: 'inline-flex', gap: 6, fontSize: 'var(--text-xs)',
    }}>
      <Badge variant="success">✓ {vote.yes}</Badge>
      <Badge>○ {vote.pending} 대기</Badge>
    </div>
  );
}

function InlineApproval({ message }) {
  const member = MEMBERS.find(x => x.id === message.author);
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
      <div style={{ width: 36 }}><Avatar member={member} size={36} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{member.name}</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>{message.time}</span>
        </div>
        <div style={{
          border: '1px solid var(--brand)',
          background: 'var(--brand-soft)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant="solid">결재 요청</Badge>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--brand-soft-fg)' }}>
              {message.content}
            </span>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
            <strong style={{ color: 'var(--fg)' }}>이유:</strong> {message.reason}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4,
                        padding: '8px 10px', background: 'var(--bg-elev)',
                        borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
            {message.files.map(f => (
              <div key={f}>📄 {f}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <Button variant="success" icon="✓">허가</Button>
            <Button variant="default">조건부 허가…</Button>
            <Button variant="danger">거절…</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalCardInline({ approval }) {
  const member = MEMBERS.find(x => x.id === approval.requester);
  const project = PROJECTS.find(x => x.id === approval.project);
  const kindLabels = {
    cli_permission: 'CLI 권한',
    mode_transition: '모드 전환',
    consensus_decision: '합의 결정',
    review_outcome: '리뷰 결과',
  };
  return (
    <div style={{
      border: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      borderRadius: 'var(--radius-lg)',
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatar member={member} size={28} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
            {member.name} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· {member.role}</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
            {project?.icon} {project?.name} {approval.channel && `· #${approval.channel.split('-').pop()}`}
          </div>
        </div>
        <Badge variant="brand">{kindLabels[approval.kind]}</Badge>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>{approval.time}</span>
      </div>
      <div style={{ fontSize: 'var(--text-base)', fontWeight: 600 }}>{approval.summary}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
        <strong style={{ color: 'var(--fg)' }}>이유:</strong> {approval.reason}
      </div>
      {approval.files && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4,
                      padding: '8px 10px', background: 'var(--bg-sunk)',
                      borderRadius: 'var(--radius)', fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)', color: 'var(--fg-muted)' }}>
          {approval.files.map(f => <div key={f}>📄 {f}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="success" icon="✓">허가</Button>
        <Button variant="default">조건부 허가…</Button>
        <Button variant="danger">거절…</Button>
      </div>
    </div>
  );
}

function TypingIndicator({ member, text }) {
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'center' }}>
      <div style={{ width: 36 }}><Avatar member={member} size={20} avatarStyle={avatarStyle} /></div>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', background: 'var(--bg-sunk)',
        borderRadius: 999, fontSize: 'var(--text-xs)', color: 'var(--fg-muted)',
      }}>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          <TypingDot delay={0} /><TypingDot delay={0.15} /><TypingDot delay={0.3} />
        </span>
        <span>{member.name} — {text}</span>
      </div>
    </div>
  );
}

function TypingDot({ delay }) {
  return (
    <span style={{
      width: 5, height: 5, borderRadius: '50%', background: 'var(--fg-muted)',
      animation: `rolestra-typing 1.2s ${delay}s infinite ease-in-out`,
    }} />
  );
}

function Composer({ channel, readOnly }) {
  if (readOnly) {
    return (
      <div style={{
        padding: '14px 20px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-sunk)', color: 'var(--fg-subtle)',
        fontSize: 'var(--text-sm)', textAlign: 'center',
      }}>
        이 채널은 읽기 전용입니다. 결재는 위 카드의 버튼으로 진행하세요.
      </div>
    );
  }
  return (
    <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-elev)' }}>
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '10px 12px',
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          <span>#{channel?.name || 'channel'}에 메시지 보내기</span>
          <div style={{ flex: 1 }} />
          <Badge>@ 멘션</Badge>
          <Badge>⌘ 명령</Badge>
        </div>
        <div style={{
          minHeight: 44, color: 'var(--fg-subtle)', fontSize: 'var(--text-base)',
          padding: '4px 0',
        }}>
          메시지를 입력하세요… (⌘↵로 전송)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconBtn title="첨부">📎</IconBtn>
          <IconBtn title="코드 블록">{'</>'}</IconBtn>
          <IconBtn title="이모지">😀</IconBtn>
          <div style={{ flex: 1 }} />
          <Button variant="default" size="sm">회의 시작</Button>
          <Button variant="primary" size="sm" icon="↵">보내기</Button>
        </div>
      </div>
    </div>
  );
}

function MembersSidebar({ project }) {
  const members = (project?.members || []).map(id => MEMBERS.find(m => m.id === id)).filter(Boolean);
  const avatarStyle = window.__tweaks?.avatarStyle || 'initials';
  return (
    <div style={{
      width: 240, flexShrink: 0,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-elev)',
      padding: '14px 12px',
      overflowY: 'auto',
    }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 0.4, color: 'var(--fg-subtle)', padding: '4px 6px 8px' }}>
        참여 직원 ({members.length})
      </div>
      {members.map(m => (
        <div key={m.id} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 6px', borderRadius: 'var(--radius)',
        }}>
          <Avatar member={m} size={32} avatarStyle={avatarStyle} showStatus />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              {m.name}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.role}
            </div>
          </div>
        </div>
      ))}
      <div style={{ height: 1, background: 'var(--border)', margin: '12px 4px' }} />
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: 0.4, color: 'var(--fg-subtle)', padding: '4px 6px 8px' }}>
        프로젝트 권한
      </div>
      <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--fg-muted)' }}>권한 모드</span>
          <PermissionPill mode={project?.permission || 'approval'} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--fg-muted)' }}>자율성</span>
          <AutonomyPill mode={project?.autonomy || 'manual'} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
          <span style={{ color: 'var(--fg-muted)' }}>프로젝트 타입</span>
          <span style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 'var(--text-xs)' }}>
            {project?.kind === 'external' ? '외부 연결' : project?.kind === 'imported' ? '가져옴' : '신규'}
          </span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { MessengerView });
