# Hermes/Sylang Studio Monorepo — Overview & Status

> **Goal:** unify `hermes-studio` and `hermes-studio-sylang` into one codebase so a
> single common project powers **both** Hermes Studio and Sylang Studio, while
> brand- and sylang-specific things (homepage, headers, themes, Sylang editor,
> spec-dash, symbol manager, `/api/sylang`) stay cleanly separated. Both brands
> use **chat-v2**.

## Decisions (locked with the user)

| Topic | Decision |
|---|---|
| Structure | **pnpm monorepo**: `packages/studio-core` (shared ~80%) imported by `apps/hermes` and `apps/sylang`. |
| Repo home | **Restructure the existing `hermes-studio` repo in place.** (`hermes-workspace` is a different project — do not use that name.) |
| Brand seam | A `Brand` config object + `useBrand()` React context, one `brand.config.ts` per app. |
| Sylang features | A **plugin registry** in core. Sylang registers editors/nav/api; Hermes registers none, so never bundles them. |
| Chat | Promote **chat-v2** into core; both apps use it; **deprecate chat v1** after a parity audit. |
| Deploy | Two apps, **separate hosts/containers**, one `Dockerfile` + `docker-compose.prod.yml` each. Build context = repo root; `pnpm --filter <app>`. |
| Build glue | `server-entry.js` + `vite.config.ts` **per-app**; shared logic factored into core to prevent drift. |

## Current state of the two repos (measured 2026-05-29)

- `hermes-studio-sylang` is a **git fork** of `hermes-studio` (same remote, shared
  initial commit `5075f73`).
- ~353 shared source files. **64 differ** in content (+ `routeTree.gen.ts`, which is
  generated). **7 net-new** sylang paths. **0** hermes-only paths.
- ~80% of the code is byte-identical. The brand surface is small. Sylang-only code
  is already well-clustered. This is an ideal monorepo candidate.

See **[01-phase0-drift-report.md](01-phase0-drift-report.md)** for the full per-file
classification, and **[02-migration-runbook.md](02-migration-runbook.md)** for the
step-by-step execution plan (Phases 1–5).

## Status of the autonomous run (2026-05-29, overnight)

The user authorized completing all phases unattended. During setup I hit a hard
blocker and made a deliberate safety call:

- **Blocker:** this sandbox's filesystem throws errors (`SIGBUS` / "No such file
  or directory") on **bulk** file operations. `git worktree add` and `git clone`
  both failed mid-checkout. A real migration needs exactly that kind of bulk FS
  work (move ~290 files, `pnpm install` of hundreds of packages, two builds) —
  any of which could fail **mid-operation** and corrupt the repo or entangle the
  user's **uncommitted WIP** (which is present on `feat/workspace-chat-polish`).
- **Decision:** do **not** run the destructive migration unattended on a flaky
  FS against a production repo with uncommitted WIP. Instead, deliver the full
  analysis + an exact execution runbook (light-write work, which is reliable),
  as a clean PR that touches **no existing files** and **no WIP**.

### What is done

- ✅ Complete Phase 0 drift analysis — every differing file classified into
  Brand / Functional-drift / Sylang-feature-bleed, with the resolution for each.
- ✅ Full execution runbook for Phases 1–5: target layout, `pnpm-workspace.yaml`,
  per-app `vite.config.ts` / `tsconfig.json` / `package.json` / `Dockerfile` /
  `docker-compose.prod.yml`, the `Brand` interface + `useBrand()` context, the
  plugin-registry design, the import-rewrite strategy, the chat-v2 promotion
  steps, and the v1 deprecation + parity-audit checklist.

### What remains (needs a stable FS + a human to verify builds)

- ⏳ Phases 1–5 execution. Each phase = one PR, stacked in order. The runbook is
  written so each phase ends at a **verifiable `pnpm build`** — do not merge a
  phase whose app(s) don't build.
- ⏳ The chat-v2 vs v1 parity audit (checklist is in the runbook) before deleting v1.

### Recommended next move when you're back

1. On a machine with a stable filesystem, follow `02-migration-runbook.md`
   Phase 1 to scaffold the workspace and get both apps building against an
   (initially small) `studio-core`.
2. Do Phase 0's reconciliation (forward-port the functional-drift files) either
   just before or as part of Phase 1 — the report lists exactly which files and
   which direction wins.
3. Proceed phase by phase, one PR each, verifying `pnpm build` at every step.

The user's working copy and uncommitted WIP were **not touched** by this run.
