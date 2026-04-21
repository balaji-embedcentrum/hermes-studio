/**
 * Shared types for the git UI. Mirrors the JSON shape returned by
 * hermes-adapter's /ws/{repo}/git/* endpoints (both aiohttp and Starlette
 * layers return the same shape).
 *
 * The adapter wraps every response in { status: "ok", ...rest }. Client
 * fetchers unwrap that envelope; types below represent the unwrapped form.
 */

/**
 * Single-letter porcelain status code. Mirrors `git status --porcelain`
 * column 1 (or 2 for unstaged). Kept as a free-form string to allow for
 * combinations like "MM" that git emits.
 */
export type GitStatusCode = string

/**
 * Per-file status. Mirrors `git status --porcelain` columns X (index) and
 * Y (worktree). `status` is a back-compat convenience — the "most interesting"
 * single char (worktree prioritized over index) for callers that don't care
 * about the split.
 */
export interface GitFileStatus {
  path: string
  /** Staged column (X). Single char or ' ' when nothing staged for this path. */
  index: string
  /** Unstaged column (Y). Single char or ' ' when nothing unstaged for this path. */
  worktree: string
  /** @deprecated Use `index`/`worktree` for staged vs unstaged. */
  status: GitStatusCode
}

export interface GitStatus {
  changed: GitFileStatus[]
  ahead: number
  behind: number
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  email: string
  date: string
  message: string
  parents: string[]
}

export interface GitBranchInfo {
  name: string
  sha: string
  upstream?: string
}

export interface GitBranches {
  /** Current branch name, or null when HEAD is detached */
  current: string | null
  head_sha: string
  local: GitBranchInfo[]
  remote: string[]
}

export type GitFileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | string

export interface GitFileChange {
  status: GitFileChangeStatus
  path: string
}

export interface GitShowResult {
  commit: GitCommit
  files: GitFileChange[]
  diff: string
}

export interface GitDiffResult {
  diff: string
}

/** Query options for /git/diff. All fields optional — no path = whole tree. */
export interface GitDiffOptions {
  path?: string
  staged?: boolean
  /** Ref/SHA — when set, shows that commit's patch vs its parent */
  ref?: string
}

export interface GitCommitInput {
  message: string
  /** Default true on the adapter side; Studio UI passes false after selective staging. */
  autoStage?: boolean
}

export interface GitCheckoutInput {
  branch: string
  create?: boolean
}

export interface GitBranchInput {
  name: string
  from?: string
}
