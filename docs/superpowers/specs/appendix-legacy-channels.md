# Appendix — Legacy v2 IPC Channels

> Origin: R2 Task 21 introduced `LEGACY_V2_CHANNELS` in `src/main/ipc/router.ts:248` to log a warn-once whenever v2 IPC channels were still invoked. R3 preserves the warning and this appendix documents the full removal plan for **R11 — 레거시 청소 + 릴리스**.

## Status at R3 tip

- Channel set is frozen — any new IPC surface added after R2 lands in `IpcChannelMap` (v3) only.
- Renderer callers live **only** in `_legacy/renderer-v1/` (Task 2 move). The new `src/renderer/` does not import any of them; `src/renderer/__tests__/legacy-channel-isolation.test.ts` pins this invariant.
- Each channel is still wired in `registerIpcHandlers()` so that a legacy renderer build (manual fallback during development) keeps working.

## Removal plan (R11)

| Channel | Current v2 caller | R11 Migration |
|---|---|---|
| `chat:send` | `_legacy/renderer-v1/stores/chat-store.ts`, `components/ChatView.tsx` | Replaced by `message:send` (spec §6) + meeting SSM event when inside a meeting. |
| `chat:pause` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `meeting:pause` (SSM v3 side-effect path). |
| `chat:resume` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `meeting:resume`. |
| `chat:stop` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `meeting:cancel`. |
| `chat:set-rounds` | `_legacy/renderer-v1/stores/chat-store.ts` | Moved into meeting creation params (`meeting:create`). |
| `chat:deep-debate` | `_legacy/renderer-v1/stores/chat-store.ts` | Collapses into `meeting:create` with `mode='deep-debate'`. |
| `chat:continue` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `approval:decide(kind='continue')` + QueueService.confirmContinue. |
| `chat:fork` | `_legacy/renderer-v1/stores/chat-store.ts` | Remove — v3 drops branching (superseded by project-scoped channels). |
| `chat:list-branches` | `_legacy/renderer-v1/stores/chat-store.ts` | Remove — same as above. |
| `chat:switch-branch` | `_legacy/renderer-v1/stores/chat-store.ts` | Remove — same as above. |
| `conversation:list` | `_legacy/renderer-v1/components/Layout.tsx`, `hooks/useConversationList.ts` | Replaced by `channel:list` + `message:listByChannel`. |
| `conversation:load` | `_legacy/renderer-v1/components/Layout.tsx` | Replaced by `channel:open` + `message:listByChannel`. |
| `conversation:new` | `_legacy/renderer-v1/components/Sidebar.tsx` | Replaced by `channel:create`. |
| `conversation:delete` | `_legacy/renderer-v1/components/Sidebar.tsx` | Replaced by `channel:archive`. |
| `workspace:pick-folder` | `_legacy/renderer-v1/components/settings/DatabaseTab.tsx` | Replaced by `project:create(kind='external')` selector modal. |
| `workspace:init` | `_legacy/renderer-v1/stores/app-store.ts` | Replaced by `arena:init` (ArenaRootService) — spec §5.1. |
| `workspace:status` | `_legacy/renderer-v1/hooks/useWorkspace.ts` | Replaced by `arena:status`. |
| `consensus-folder:status` | `_legacy/renderer-v1/stores/app-store.ts` | Replaced by `arena:status` (consensus lives under ArenaRoot, spec §5.1). |
| `consensus-folder:pick` | `_legacy/renderer-v1/components/settings/DatabaseTab.tsx` | Remove — consensus path is now derived from ArenaRoot, not user-picked. |
| `consensus-folder:init` | `_legacy/renderer-v1/stores/app-store.ts` | Replaced by `arena:init` (same bootstrap as workspace). |
| `consensus:respond` | `_legacy/renderer-v1/components/chat/ConsensusVoteCard.tsx` | Replaced by `meeting:vote` (SSM consensus phase). |
| `consensus:status` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `meeting:get` + `stream:meeting-state-changed`. |
| `consensus:set-facilitator` | `_legacy/renderer-v1/components/settings/GeneralTab.tsx` | Moved to project `member_profiles.role_at_project` — spec §5.2. |
| `session:mode-transition-respond` | `_legacy/renderer-v1/components/ModeTransitionDialog.tsx` | Replaced by `approval:decide(kind='mode_transition')`. |
| `session:select-worker` | `_legacy/renderer-v1/components/chat/WorkerPickDialog.tsx` | Replaced by `meeting:selectWorker`. |
| `session:user-decision` | `_legacy/renderer-v1/components/chat/ConsensusReviewCard.tsx` | Replaced by `approval:decide(kind='review_outcome')`. |
| `session:status` | `_legacy/renderer-v1/stores/chat-store.ts` | Replaced by `meeting:list` + `meeting:get`. |

**Total: 27 channels** across 5 prefixes (`chat:*`, `conversation:*`, `workspace:*`, `consensus-folder:*`, `consensus:*`, `session:*`).

> Caller paths point to `_legacy/renderer-v1/` — the v2 UI was moved there by R3 Task 2. Each R11 substitute is already registered in `v3ChannelSchemas` (router.ts), so R11 removal is a matter of deleting the legacy handler + deleting `_legacy/renderer-v1/` after the v3 renderer reaches parity.

## Verification invariants (R3)

- `src/main/ipc/router.ts:248` `LEGACY_V2_CHANNELS` keeps the exact 27-entry set; any addition/removal must be paired with a handler change.
- `src/renderer/__tests__/legacy-channel-isolation.test.ts` fails fast if any file under `src/renderer/**` (excluding `_legacy/**`) mentions a legacy channel literal — guarantees the v3 renderer stays legacy-free.
- `warnOnceLegacy()` in router logs once per channel per runtime to surface unexpected usage during manual testing with the legacy UI still shipped.
