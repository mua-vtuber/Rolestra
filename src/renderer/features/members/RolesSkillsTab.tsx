/**
 * RolesSkillsTab — R12-S 직원 편집 모달의 "역할 + 스킬" 탭.
 *
 * 9 RoleId chip 다중 선택 + 선택된 role 별 customize prompt textarea.
 * 카탈로그는 useSkillCatalog 가 1 회 fetch 후 cache. 변경 결과는
 * onChange 콜백으로 부모(MemberProfileEditModal) 에 전달 — 부모가
 * 저장 시점에 `provider:updateRoles` IPC 호출.
 */
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

import { useSkillCatalog } from '../../hooks/use-skill-catalog';
import type { RoleId } from '../../../shared/role-types';
import { isRoleId } from '../../../shared/role-types';

export interface RolesSkillsTabProps {
  /** 현재 부여된 능력. */
  roles: RoleId[];
  /** 능력별 customize prompt — null 이면 카탈로그 default 사용. */
  skillOverrides: Partial<Record<RoleId, string>> | null;
  /** 사용자 변경 시 호출. roles / overrides 둘 다 새 값. */
  onChange(
    roles: RoleId[],
    overrides: Partial<Record<RoleId, string>> | null,
  ): void;
  /** 저장 진행 중일 때 입력 잠금. */
  disabled?: boolean;
}

export function RolesSkillsTab({
  roles,
  skillOverrides,
  onChange,
  disabled,
}: RolesSkillsTabProps): ReactElement {
  const { t } = useTranslation();
  const { catalog, loading, error } = useSkillCatalog();

  // catalog 는 9 직원 능력 (meeting-summary 제외) — 카탈로그 자체가
  // listEmployeeRoles() 결과여서 추가 필터 불필요.

  function toggleRole(roleId: RoleId): void {
    const next = roles.includes(roleId)
      ? roles.filter((r) => r !== roleId)
      : [...roles, roleId];
    onChange(next, skillOverrides);
  }

  function updateOverride(roleId: RoleId, value: string): void {
    const isEmpty = value.trim().length === 0;
    // ESLint @typescript-eslint/no-dynamic-delete 회피: filter + Object.fromEntries
    // 로 새 객체 구성해 dynamic delete 없이 동일 결과.
    const previous = skillOverrides ?? {};
    const entries = (Object.entries(previous) as [RoleId, string][]).filter(
      ([k]) => k !== roleId,
    );
    const next: Partial<Record<RoleId, string>> = Object.fromEntries(entries);
    if (!isEmpty) {
      next[roleId] = value;
    }
    const hasAny = Object.keys(next).length > 0;
    onChange(roles, hasAny ? next : null);
  }

  return (
    <div
      data-testid="roles-skills-tab"
      className="flex flex-col gap-4"
    >
      <header>
        <h3 className="text-sm font-display font-semibold">
          {t('profile.editor.rolesSkillsTab.title')}
        </h3>
        <p className="text-xs text-fg-muted mt-0.5">
          {t('profile.editor.rolesSkillsTab.subtitle')}
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="roles-skills-load-error"
          className="text-xs text-danger border border-danger rounded-panel px-2 py-1 bg-sunk"
        >
          {t('profile.editor.rolesSkillsTab.loadError', { message: error.message })}
        </div>
      )}

      {loading && catalog.length === 0 ? (
        <p
          data-testid="roles-skills-loading"
          className="text-xs text-fg-muted italic"
        >
          {t('profile.editor.rolesSkillsTab.loading')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {catalog.map((tpl) => {
            if (!isRoleId(tpl.id)) return null;
            const roleId = tpl.id;
            const active = roles.includes(roleId);
            return (
              <button
                key={roleId}
                type="button"
                onClick={() => toggleRole(roleId)}
                disabled={disabled}
                aria-pressed={active}
                data-testid={`role-chip-${roleId}`}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                  active
                    ? 'bg-brand text-on-brand border-brand'
                    : 'bg-sunk text-fg border-panel-border hover:border-brand',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                {tpl.label.ko}
              </button>
            );
          })}
        </div>
      )}

      {roles.length > 0 && (
        <section>
          <h4 className="text-sm font-display font-semibold">
            {t('profile.editor.rolesSkillsTab.customizeTitle')}
          </h4>
          <div className="flex flex-col gap-3 mt-2">
            {roles.map((roleId) => {
              const tpl = catalog.find((c) => c.id === roleId);
              if (!tpl) return null;
              const value = skillOverrides?.[roleId] ?? '';
              return (
                <label
                  key={roleId}
                  className="flex flex-col gap-1 text-sm"
                  data-testid={`role-customize-${roleId}`}
                >
                  <span className="font-medium text-xs">{tpl.label.ko}</span>
                  <textarea
                    rows={4}
                    maxLength={8000}
                    placeholder={tpl.systemPromptKo}
                    value={value}
                    disabled={disabled}
                    onChange={(e) => updateOverride(roleId, e.target.value)}
                    className="resize-none rounded-panel border border-panel-border bg-sunk px-3 py-2 text-xs text-fg focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </label>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
