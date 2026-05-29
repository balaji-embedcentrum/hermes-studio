# Phase 0 — Drift Classification Report

Comparison of `hermes-studio/src` vs `hermes-studio-sylang/src`, measured 2026-05-29.
**64 shared source files differ** (excluding the generated `routeTree.gen.ts`), plus
**7 net-new sylang paths**. Every differing file is classified into one of three
buckets, each with a distinct resolution.

## The three buckets

| Bucket | Meaning | Resolution in the monorepo |
|---|---|---|
| **A — Brand** | Difference is purely branding/copy/theme/logo. | Parameterize via `brand.config.ts` + `useBrand()`, or keep the file app-local. **Do not reconcile** — both versions are "correct" for their brand. |
| **B — Sylang-feature bleed** | A shared file has Sylang-only feature code embedded in it (editor dispatch, symbol cache, playground). | Core keeps a **generic** version exposing a hook/registry; Sylang registers its behavior via `brand.plugins`. Extract, don't fork. |
| **C — Functional drift** | A generic improvement/bugfix landed in sylang (or hermes) but not the other. | **Forward-port** the winning version into `studio-core` so both behave identically. Sylang is generally ahead. |

> Heuristic note: the auto-scan flagged some files "BRAND?" because they reference
> CSS `--theme-*` variables (not branding). Those are corrected below by reading the
> actual diffs. Files marked **(confirm)** were classified by churn + location and
> should be eyeballed during execution.

---

## Bucket A — Brand (parameterize / app-local)

| File | Δ | What differs | Resolution |
|---|---|---|---|
| `routes/index.tsx` | 467 | Entirely different homepage: Hermes marketing landing vs Sylang sign-in gateway (+ OAuth error copy). | **App-local route.** Each app keeps its own `routes/index.tsx`. Core exports nothing here. |
| `routes/__root.tsx` | 37 | `DEFAULT_THEME`, theme allow-list, theme migration, `<title>`/description, icon href (`hermes-crest.svg` vs `sylang-logo.svg`), loading quips. | Core `__root` reads from `useBrand()`. Brand supplies `defaultTheme`, `themes`, `title`, `description`, `iconHref`, `loadingQuips`. |
| `lib/theme.ts` | 19 | Sylang adds `sylang-studio` + `sylang-studio-light` to the registry and makes the latter default. | **Core holds all theme definitions**; brand config picks `defaultTheme` + the visible list. (Or core exports a base set and each app augments.) |
| `routes/terms.tsx` | 12 | Brand name in ToS copy. | App-local route (or core component taking `brand.legalName`). |
| `components/auth/login-screen.tsx` | 6 | Logo + product name. | Read from `useBrand()` (`logo`, `appTitle`). |
| `components/onboarding/hermes-onboarding.tsx` | 10 | Brand copy. | Brand-supplied onboarding content; component generic. **(confirm)** |
| `components/onboarding/tour-steps.tsx` | 10 | Brand copy in tour steps. | Brand-supplied step copy. **(confirm)** |
| `components/onboarding/onboarding-wizard.tsx` | 2 | Brand copy. | Brand-supplied. |
| `components/connection-startup-screen.tsx` | 9 | Brand logo/copy on the connect screen. | Read from `useBrand()`. **(confirm)** |
| `hooks/use-page-title.ts` | 4 | Title string. | Title from `useBrand().appTitle`. |
| `routes/settings/index.tsx` | 14 | Theme picker visibility / brand-specific settings entries. | Brand-gated settings sections. **(confirm — may be partly drift)** |
| `screens/dashboard/dashboard-screen.tsx` | 8 | Brand copy. | Brand-supplied. **(confirm)** |

---

## Bucket B — Sylang-feature bleed (extract to plugin / apps/sylang)

| File | Δ | Sylang-only code embedded | Resolution |
|---|---|---|---|
| `routes/files.tsx` | 382 | Imports `SylangFileEditor`, `SpecViewer`, `DashViewer`, `isSylangFile`; dispatches `.ftml/.varml/.spec/.dash`; adds WorkspaceHome inline views (coverage/traceability/fmea). | Core `files.tsx` gets an **editor registry**: `registerEditor({ match, component, ownsIO })`. Default = CodeMirror. Sylang registers Sylang/Spec/Dash editors + the home "Quick Action" views via `brand.plugins`. |
| `routes/projects.tsx` | 484 | The **Playground tab** (`'playground'` TabId, `PlaygroundProject`, `/api/playground/list`) — the curated public-projects feature. | Core `projects.tsx` keeps `github`/`local`/`public` tabs and supports brand-injected extra tabs. Sylang registers the Playground tab + `/api/playground`. |
| `routes/api/files.ts` | 68 | Imports `workspaceSymbolCache`; calls `invalidateWorkspace`/`updateCachedDocument`/`removeCachedDocument` on write/move/rename/delete/pull. | Core fires generic lifecycle hooks (`onFileWritten`, `onFileMoved`, `onFileDeleted`, `onWorkspacePulled`). Sylang subscribes to update the symbol cache. |
| `routes/api/send-stream.ts` | 137 (mixed) | Sylang bits: `invalidateWorkspace` after file-mutating tools; "Sylang and Jot skills" prompt injection. Generic bits: `FILE_MUTATING_TOOLS` set, `getChatMode`, SSE tool-frame tracking. | **Split.** Port the generic file-mutating-tool detection + SSE tracking to core (Bucket C part). Expose an `onAgentMutatedFiles` hook + a system-prompt-contributions API; Sylang registers symbol invalidation + its skill-prompt text. |
| `components/jotx-editor/JotxFileEditor.tsx` | 233 | Jotx editor wraps `@sylang/jot-editor`; sylang version is substantially enhanced. | Likely **sylang feature** (the `.jot` editor depends on a `@sylang/*` pkg). Move to `apps/sylang/features` + register as an editor. If Hermes also ships `.jot`, keep a thin core version. **(confirm whether Hermes wants Jotx)** |
| `components/code-editor/CodeMirrorEditor.tsx` | 115 | Sylang **re-exports** it from the published `@sylang/code-editor` package (the editor moved to "sylang-core" npm). | **Decision required.** Option 1: core keeps its own inline CodeMirror (Hermes stays free of `@sylang/*`); Sylang app overrides with a re-export. Option 2: both adopt `@sylang/code-editor`. Recommend Option 1 to avoid coupling Hermes to Sylang packages. |

### Net-new sylang paths

| Path | Resolution |
|---|---|
| `components/sylang-editor/` (SylangFileEditor) | → `apps/sylang/features/sylang-editor/`; registered as an editor plugin. |
| `components/spec-dash/` (SpecViewer, DashViewer) | → `apps/sylang/features/spec-dash/`; registered as editors + home views. |
| `sylang/` (symbolManager / workspaceSymbolCache) | → `apps/sylang/features/symbols/`; subscribes to core file-lifecycle hooks. |
| `routes/api/sylang/` (fmea, traceability, coverage, symbols, diagram, spec-render, …) | → `apps/sylang/src/routes/api/sylang/` (app-local API routes). |
| `routes/api/playground/` | → `apps/sylang/src/routes/api/playground/`. |
| `screens/chat-v2/` | → `packages/studio-core/src/screens/chat-v2/` (Phase 4 — shared by both). |
| `routes/api/workspaces/delete.ts` | **Generic** — forward-port to core (Bucket C). |
| `hooks/use-reset-chat-on-context-change.ts` | **Generic** chat hook — forward-port to core. |

---

## Bucket C — Functional drift (forward-port into studio-core)

Sylang is generally ahead; port the sylang version into `studio-core` unless noted.
Inspect each diff during execution — these are bugfixes/improvements, not brand.

| File | Δ | Note |
|---|---|---|
| `routes/api/workspaces/create.ts` | 256 | Workspace-creation improvements. High churn — review carefully. |
| `routes/chat/$sessionKey.tsx` | 194 | Chat route wiring. May interact with chat-v2 promotion (Phase 4). |
| `screens/chat/components/chat-message-list.tsx` | 173 | Chat rendering. **v1 file** — if v1 is deleted in Phase 4, this drift is moot. |
| `screens/chat/chat-screen.tsx` | 163 | **v1 file** — likely obsoleted by Phase 4 (chat-v2). Confirm before porting. |
| `components/prompt-kit/markdown.tsx` | 151 | Markdown rendering improvements. Shared by v1 + v2 → **port**. |
| `routes/api/send-stream.ts` | 137 | Generic half (see Bucket B split). |
| `components/file-explorer/file-explorer-sidebar.tsx` | 109 | File explorer improvements → port. |
| `components/prompt-kit/code-block/index.tsx` | 86 | Code-block rendering → port (used by chat-v2). |
| `screens/chat/components/message-item.tsx` | 74 | v1 file — see chat-screen note. |
| `screens/chat/pending-send.ts` | 69 | v1 file. |
| `components/chat-panel.tsx` | 69 | Floating chat panel → port (wraps chat). |
| `server/openai-compat-api.ts` | 49 | Backend API client → port. |
| `server/supabase-auth.ts` | 41 | Auth flow → port (also note WIP touches this in hermes). |
| `routes/api/auth/callback.ts` | 39 | OAuth callback → port. |
| `routes/api/workspaces/clone.ts` | 35 | → port. |
| `routes/api/history.ts` | 32 | → port. |
| `routes/api/agent-sessions/status.ts` | 26 | → port. |
| `components/session-timer.tsx` | 21 | → port. |
| `components/prompt-kit/prompt-input.tsx` | 21 | → port (used by chat-v2). |
| `screens/chat/hooks/use-chat-history.ts` | 17 | v1 file. |
| `hooks/use-active-session.ts` | 14 | → port. |
| `stores/chat-store.ts` | 11 | → port (verify chat-v2 still uses it). |
| `screens/chat/components/chat-sidebar.tsx` | 10 | v1 file. |
| `screens/chat/hooks/use-realtime-chat-history.ts` | 9 | v1 file. |
| `lib/active-users.ts` | 8 | → port. |
| `hooks/use-chat-settings.ts` | 8 | → port. |
| `components/mobile-prompt/MobileSetupModal.tsx` | 8 | → port. |
| `components/mobile-hamburger-menu.tsx` | 6 | → port. |
| `screens/chat/components/chat-empty-state.tsx` | 6 | v1 file. |
| `screens/chat/components/chat-composer.tsx` | 5 | v1 file. |
| `screens/skills/skills-screen.tsx` | 4 | → port. |
| `screens/chat/components/context-bar.tsx` | 4 | v1 file. |
| `routes/api/github/repos.ts` | 4 | → port. |
| `routes/api/agents/test.ts` | 4 | → port. |
| `components/workspace-shell.tsx` | 4 | → port (core shell). |
| `components/mobile-prompt/MobilePromptTrigger.tsx` | 4 | → port. |
| `routes/api/agents/add.ts` | 3 | → port. |
| `routes/api/agent-sessions/start.ts` | 2 | → port. |
| `routes/api/workspaces/list.ts` | 2 | → port. |
| `lib/local-file-ops.ts` | 2 | → port. |
| `lib/supabase.ts` | 1 | → port. |
| `components/settings-dialog/settings-dialog.tsx` | 2 | → port (verify not brand). |
| `components/dashboard-overflow-panel.tsx` | 2 | → port. |
| `components/avatars/assistant-avatar.tsx` | 2 | → port (verify not brand avatar). |
| `components/agent-avatar.tsx` | 2 | → port (verify not brand avatar). |
| `screens/chat/components/connection-status-message.tsx` | 2 | v1 file. |
| `screens/chat/components/chat-header.tsx` | 2 | v1 file. |

> **v1 files note:** ~12 of these live under `screens/chat/` (the v1 chat). Since
> Phase 4 deprecates v1, do **not** spend effort reconciling those — verify chat-v2
> covers the feature, then delete v1. They are listed only for completeness.

---

## Summary counts

- **Bucket A (brand):** ~12 files → config / app-local.
- **Bucket B (sylang bleed):** 6 shared files + 5 net-new paths → plugin registry / apps/sylang.
- **Bucket C (functional drift):** ~46 files → forward-port to core (≈12 are v1-chat files that Phase 4 makes moot).

**Practical effort:** the real reconciliation work is ~20–25 non-trivial Bucket-C
files (workspaces/create, markdown, file-explorer, code-block, prompt-input,
chat-panel, auth/callback, supabase-auth, openai-compat-api, history, etc.) plus
the 6 Bucket-B extractions. Everything else is small or made moot by chat-v2.
