/**
 * ProjectEntryView — R12-C T10 프로젝트 entry "할 일 작성" 카드.
 *
 * spec §11.4 — 프로젝트 진입 화면 entry. 사용자가 "할 일" 을 textarea
 * 에 입력하고 시작 부서를 선택하면, 그 부서 채널로 active 전환 + entry
 * 메시지 INSERT (= auto-trigger 가 회의 시작) + messenger view 전환.
 *
 * 디폴트 시작 부서 = 아이디어 (idea). 사용자가 이미 기획안 보유 시
 * "기획" 으로 선택. 디자인 / 구현 / 검토는 인계 전용 부서라 entry 시점
 * 직접 시작은 옵션에서 제외 (spec §4.1 — 인계 trigger 만 진입).
 *
 * R12-C 단계의 단순화: project:startWorkflow IPC 신규 wrapper 는 본
 * task 에서 placeholder 만 작성한다. T13~T17 에서 각 부서 워크플로우가
 * land 하면 그 service 로 dispatching 한다. 현재는 message:append 로
 * 메시지 send → meeting-auto-trigger 가 처리.
 */
import { clsx } from 'clsx';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveChannelStore } from '../../stores/active-channel-store';
import { useAppViewStore } from '../../stores/app-view-store';
import { useChannels } from '../../hooks/use-channels';
import { invoke } from '../../ipc/invoke';
import { getSkillTemplate } from '../../../shared/skill-catalog';
import type { Channel } from '../../../shared/channel-types';
import type { RoleId } from '../../../shared/role-types';

/**
 * entry view 에서 직접 시작 가능한 부서. 디자인 / 구현 / 검토 는
 * 인계 trigger 만 받으므로 라디오에서 제외 (spec §4.1).
 */
const ENTRY_DEPARTMENTS: ReadonlyArray<RoleId> = ['idea', 'planning'];

const DEFAULT_DEPARTMENT: RoleId = 'idea';

const ROLE_ICON: Record<string, string> = {
  idea: '💡',
  planning: '📋',
};

export interface ProjectEntryViewProps {
  projectId: string;
  className?: string;
}

export function ProjectEntryView({
  projectId,
  className,
}: ProjectEntryViewProps): ReactElement {
  const { t } = useTranslation();
  const { channels, error: channelsError } = useChannels(projectId);
  const setActiveChannelId = useActiveChannelStore(
    (s) => s.setActiveChannelId,
  );
  const setView = useAppViewStore((s) => s.setView);

  const [taskText, setTaskText] = useState<string>('');
  const [department, setDepartment] = useState<RoleId>(DEFAULT_DEPARTMENT);
  const [pending, setPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const departmentChannelByRole = useMemo<Map<RoleId, Channel>>(() => {
    const map = new Map<RoleId, Channel>();
    if (channels === null) return map;
    for (const channel of channels) {
      if (channel.role !== null && channel.role !== 'general') {
        map.set(channel.role, channel);
      }
    }
    return map;
  }, [channels]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (pending) return;
    const content = taskText.trim();
    if (content.length === 0) {
      setErrorMessage(
        t('project.entry.errorEmpty', {
          defaultValue: '할 일을 입력하세요.',
        }),
      );
      return;
    }
    const channel = departmentChannelByRole.get(department);
    if (!channel) {
      setErrorMessage(
        t('project.entry.errorNoChannel', {
          defaultValue:
            '선택한 부서 채널을 찾을 수 없습니다. 프로젝트가 부서 채널 자동 생성을 마쳤는지 확인하세요.',
          department: getSkillTemplate(department).label.ko,
        }),
      );
      return;
    }
    setPending(true);
    setErrorMessage(null);
    try {
      await invoke('message:append', {
        channelId: channel.id,
        content,
      });
      setTaskText('');
      setActiveChannelId(projectId, channel.id);
      setView('messenger');
    } catch (reason) {
      setErrorMessage(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setPending(false);
    }
  }, [
    department,
    departmentChannelByRole,
    pending,
    projectId,
    setActiveChannelId,
    setView,
    t,
    taskText,
  ]);

  return (
    <section
      data-testid="project-entry-view"
      data-project-id={projectId}
      className={clsx(
        'flex flex-col gap-3 border border-panel-border bg-panel-bg rounded-panel p-4',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <span aria-hidden="true" className="text-base">
          {'📥'}
        </span>
        <h3 className="text-sm font-bold text-fg">
          {t('project.entry.title', { defaultValue: '할 일 작성' })}
        </h3>
      </header>

      <p className="text-xs text-fg-muted">
        {t('project.entry.hint', {
          defaultValue:
            '여기에 작성한 할 일은 선택한 부서 채널에서 자동으로 워크플로우를 시작합니다.',
        })}
      </p>

      <textarea
        data-testid="project-entry-textarea"
        value={taskText}
        onChange={(e) => setTaskText(e.target.value)}
        rows={3}
        placeholder={t('project.entry.placeholder', {
          defaultValue: '예: "퍼즐 게임 컨셉을 잡아보자"',
        })}
        disabled={pending}
        className={clsx(
          'w-full resize-y border border-panel-border bg-canvas px-3 py-2 text-sm text-fg',
          'rounded-panel focus:outline-none focus:ring-1 focus:ring-brand',
          'disabled:opacity-60',
        )}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-bold uppercase tracking-wide text-fg-subtle">
          {t('project.entry.departmentLabel', {
            defaultValue: '시작 부서',
          })}
        </legend>
        <div role="radiogroup" className="flex flex-wrap gap-2">
          {ENTRY_DEPARTMENTS.map((role) => {
            const checked = role === department;
            const labelKo = getSkillTemplate(role).label.ko;
            const icon = ROLE_ICON[role] ?? '•';
            return (
              <label
                key={role}
                data-testid={`project-entry-radio-${role}`}
                data-checked={checked ? 'true' : 'false'}
                className={clsx(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-panel px-2.5 py-1.5 text-sm',
                  'border transition-colors',
                  checked
                    ? 'bg-sunk border-panel-border text-fg font-bold'
                    : 'border-transparent text-fg-muted hover:bg-sunk',
                )}
              >
                <input
                  type="radio"
                  name="project-entry-department"
                  value={role}
                  checked={checked}
                  onChange={() => setDepartment(role)}
                  disabled={pending}
                  className="sr-only"
                />
                <span aria-hidden="true">{icon}</span>
                <span>{labelKo}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {channelsError !== null ? (
        <p
          data-testid="project-entry-channels-error"
          role="alert"
          className="text-xs text-danger"
        >
          {t('project.entry.channelsError', {
            defaultValue: '부서 채널 목록을 불러오지 못했습니다.',
          })}
        </p>
      ) : null}

      {errorMessage !== null ? (
        <p
          data-testid="project-entry-error"
          role="alert"
          className="text-xs text-danger"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="project-entry-submit"
          onClick={handleSubmit}
          disabled={pending || taskText.trim().length === 0}
          className={clsx(
            'inline-flex items-center px-3 py-1.5 text-sm font-bold rounded-panel',
            'bg-brand text-brand-fg hover:opacity-90',
            'transition-opacity disabled:opacity-50 disabled:pointer-events-none',
          )}
        >
          {pending
            ? t('project.entry.submitPending', {
                defaultValue: '시작 중…',
              })
            : t('project.entry.submitAction', {
                defaultValue: '워크플로우 시작',
              })}
        </button>
      </div>
    </section>
  );
}
