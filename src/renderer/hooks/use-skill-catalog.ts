/**
 * `useSkillCatalog` — R12-S 능력 카탈로그 read-only hook.
 *
 * 직원 편집 모달의 "역할 + 스킬" 탭 / 회의 prompt 미리보기 / 채널 wire 등
 * 카탈로그가 필요한 surface 전반에서 공유. 첫 호출 시 `skill:list` IPC
 * 1 회 fetch 후 zustand store 에 cache — 이후 호출은 in-memory 즉시 반환.
 *
 * 카탈로그는 build-time constant 라 invalidation 이 필요 없음 (R12-S 안에서
 * 변경되지 않음). 추가 능력 / catalog 갱신은 후속 phase 에서 별도 신호.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

import { invoke } from '../ipc/invoke';
import type { SkillTemplate } from '../../shared/role-types';

interface SkillCatalogStore {
  list: SkillTemplate[] | null;
  loading: boolean;
  error: Error | null;
  fetch: () => Promise<void>;
}

const useStore = create<SkillCatalogStore>((set, get) => ({
  list: null,
  loading: false,
  error: null,
  async fetch() {
    if (get().list !== null || get().loading) return;
    set({ loading: true, error: null });
    try {
      const { skills } = await invoke('skill:list', undefined);
      set({ list: skills, loading: false });
    } catch (reason) {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      set({ error: err, loading: false });
    }
  },
}));

export interface UseSkillCatalogResult {
  /** 9 직원 능력. fetch 전에는 빈 배열. */
  catalog: SkillTemplate[];
  loading: boolean;
  error: Error | null;
}

export function useSkillCatalog(): UseSkillCatalogResult {
  const list = useStore((s) => s.list);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const fetch = useStore((s) => s.fetch);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { catalog: list ?? [], loading, error };
}
