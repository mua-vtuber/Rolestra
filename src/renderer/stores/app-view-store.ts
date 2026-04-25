/**
 * App-view store (zustand, **no persist**) — 최상위 뷰 (dashboard / messenger
 * 등) 전환을 전역 상태로 공유한다. App.tsx 가 `view` 로컬 state 를 써왔지만
 * R7-Task10 부터 ApprovalsWidget(대시보드 내부 깊은 위젯)이 "#승인-대기 채널로
 * 이동" 동작을 수행하려면 App 밖에서 setView 를 호출할 필요가 있어 store 로
 * 승격했다.
 *
 * 상태는 ephemeral — 새 세션에서 항상 dashboard 로 시작한다(persist 하지
 * 않음). persist 가 필요해지면 active-channel-store 의 partialize 패턴을
 * 따르면 된다.
 *
 * `AppView` 유니온은 App.tsx 의 `ROUTED_VIEWS` 와 동일한 값만 받는다.
 * approval/queue/settings 등 아직 라우팅되지 않은 섹션은 R10 이 뷰를 붙이면서
 * 이 유니온에 합쳐진다.
 */
import { create } from 'zustand';

export type AppView = 'dashboard' | 'messenger' | 'settings' | 'onboarding';

export const DEFAULT_APP_VIEW: AppView = 'dashboard';

export interface AppViewState {
  view: AppView;
  setView: (view: AppView) => void;
}

export const useAppViewStore = create<AppViewState>()((set) => ({
  view: DEFAULT_APP_VIEW,
  setView: (view) =>
    set((state) => (state.view === view ? state : { view })),
}));
