# Hermes / Sylang Studio — One Shared Project

## Goal

Merge `hermes-studio` and `hermes-studio-sylang` into **one shared project** that
powers both Hermes Studio and Sylang Studio. Both apps run **the same code** — the
full feature set, including the Sylang editor, Jotx, spec-dash, the symbol cache, and
`/api/sylang`, ships in **both**.

They differ in only **four** things.

## The only differences between the two apps

| # | Difference | How it's handled |
|---|---|---|
| 1 | **Brand identity** — name ("Hermes Studio" vs "Sylang Studio"), logo, theme/colors, title, favicon, loading text. | One `brand.config.ts` per app. |
| 2 | **MBSE tools header** — the extra nav with Coverage analysis, Traceability, FMEA, etc. | Shown in Sylang, **off in Hermes**. One brand flag: `showMbseTools`. Code stays shared; Hermes just doesn't render those nav items. |
| 3 | **Workspace home page** — the home view inside the editor/workspace. | A per-brand `WorkspaceHome` component. Each brand has its own. |
| 4 | **Public landing / sign-in page** (`routes/index.tsx`). | A per-brand route. Each brand has its own. |

**That's the whole list.** Nothing else differs by design.

## What is explicitly NOT different (shared, in both apps)

- Sylang file editor (`.ftml` / `.varml` / etc.) and `isSylangFile` dispatch
- Jotx editor (`@sylang/jot-editor`)
- spec-dash (`.spec` / `.dash` viewers)
- The symbol cache / symbol manager and its file-lifecycle hooks
- `/api/sylang/*` routes (fmea, traceability, coverage, symbols, diagram, …)
- `/api/playground` (unless you decide otherwise)
- CodeMirror editor
- chat-v2 (promoted to shared core; both use it; v1 retired)
- Everything else (chat, files, projects, terminal, memory, skills, settings, auth,
  agent sessions, workspace APIs, UI library, hooks, stores, server logic)

> An earlier draft of this plan proposed extracting Sylang features into a "plugin
> registry." **That idea is dropped.** All features are shared and present in both
> apps. The apps differ only by the four items above.

## Structure

```
hermes-studio/                       # this repo, restructured (pnpm monorepo)
├── packages/
│   └── studio-core/                 # EVERYTHING — the whole shared app
│
└── apps/
    ├── hermes/                      # thin: brand + home + landing + deploy
    │   ├── brand.config.ts          # name/logo/theme + showMbseTools: false
    │   ├── src/WorkspaceHome.tsx     # Hermes workspace home
    │   ├── src/routes/index.tsx      # Hermes landing / sign-in
    │   ├── public/ (hermes-* assets)
    │   └── Dockerfile + docker-compose.prod.yml
    │
    └── sylang/                      # thin: brand + home + landing + deploy
        ├── brand.config.ts          # name/logo/theme + showMbseTools: true
        ├── src/WorkspaceHome.tsx     # Sylang workspace home
        ├── src/routes/index.tsx      # Sylang gateway
        ├── public/ (sylang-logo + @sylang/* synced assets)
        └── Dockerfile + docker-compose.prod.yml
```

Each app is essentially: **a name, a logo, a theme, one flag, a home page, and a
landing page.** Everything else is `studio-core`.

## Decisions (locked)

| Topic | Decision |
|---|---|
| Structure | pnpm monorepo: `packages/studio-core` (the whole app) + two thin `apps/{hermes,sylang}`. |
| Repo home | Restructure **this** `hermes-studio` repo in place. |
| Shared vs brand | Everything shared except the 4 differences above. No feature extraction. |
| Brand seam | One `brand.config.ts` per app: `appTitle`, `logo`, theme, `showMbseTools`, `WorkspaceHome`, landing route. |
| Chat | chat-v2 in shared core; both apps use it; v1 retired. |
| Deploy | Two apps, separate hosts/containers, one Dockerfile each (build context = repo root, `pnpm --filter`). |

## Status (as of this rewrite)

- This is **planning documentation only**. The migration itself is not yet executed.
- The execution steps are in **[01-migration-plan.md](01-migration-plan.md)**.
- Earlier in the session, attempts to set up an isolated working copy
  (`git worktree` / `git clone`) failed due to **sandbox filesystem instability on
  bulk operations**, so the heavy migration was deferred to a stable machine where
  each `pnpm build` can be verified. Light file writes (like these docs) work fine.
- A pre-existing corrupt/truncated packfile (dated May 12) was noticed in `.git` —
  run `git fsck` / re-fetch on a stable machine; the remote and PR are unaffected.
