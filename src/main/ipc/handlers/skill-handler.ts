/**
 * Handler for 'skill:*' IPC channels — R12-S 능력 카탈로그 조회.
 *
 * Renderer 가 직원 편집 모달 (Task 8) / 회의 prompt 미리보기 등에서
 * 카탈로그를 읽을 때 사용. 본 handler 는 read-only — write 는
 * provider:updateRoles 가 담당.
 */

import type { IpcRequest, IpcResponse } from '../../../shared/ipc-types';
import {
  getSkillTemplate,
  listEmployeeRoles,
} from '../../../shared/skill-catalog';

/** skill:list — 9 직원 능력 (meeting-summary 시스템 능력 제외). */
export function handleSkillList(): IpcResponse<'skill:list'> {
  return { skills: listEmployeeRoles() };
}

/** skill:getTemplate — 단일 능력 lookup. unknown id 는 throw. */
export function handleSkillGetTemplate(
  data: IpcRequest<'skill:getTemplate'>,
): IpcResponse<'skill:getTemplate'> {
  return { skill: getSkillTemplate(data.id) };
}
