/**
 * Server-side WorkspaceSymbolCache
 *
 * Maintains one SylangSymbolManagerCore instance per repository, cached in
 * Node.js process memory. All server routes (diagrams, completions, hover,
 * navigation, traceability, sigma graph) share the same pre-parsed symbol
 * graph instead of re-scanning files on every request.
 *
 * Isolation: each { userId/login/repo } key gets its own instance — no
 * cross-user contamination.
 *
 * TTL: entries are evicted after 10 minutes of inactivity.
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

// Import the REAL core from sylang2.1 — same class used by the VSCode extension.
// configManager.ts / configParser.ts have been patched to use ISylangLogger so
// the vscode dep is gone from this import chain.
import { SylangSymbolManagerCore } from '@sylang/core'
import type { ISylangLogger } from '@sylang/core'
import type { FileOps } from '@sylang/core'

const WORKSPACE_ROOT = (
  process.env.HERMES_WORKSPACE_DIR || path.join(os.homedir(), '.hermes')
).trim()

const TTL_MS = 10 * 60 * 1000 // 10 minutes

// ─── Logger ────────────────────────────────────────────────────────────────

const serverLogger: ISylangLogger = {
  l1:   (m) => console.info('[SymCache]', m),
  l2:   (m) => console.debug('[SymCache]', m),
  l3:   (m) => console.debug('[SymCache]', m),
  debug:(m) => console.debug('[SymCache]', m),
  info: (m) => console.info('[SymCache]', m),
  warn: (m) => console.warn('[SymCache]', m),
  error:(m) => console.error('[SymCache]', m),
  show: () => {},
  hide: () => {},
  clear: () => {},
  refreshLogLevel: () => {},
  getCurrentLogLevel: () => 0 as ReturnType<ISylangLogger['getCurrentLogLevel']>,
  dispose: () => {},
}

// ─── Local FileOps ─────────────────────────────────────────────────────────

const SYLANG_EXTS = new Set([
  '.req', '.agt', '.blk', '.fml', '.fun', '.haz',
  '.ifc', '.itm', '.ple', '.sam', '.seq', '.sgl',
  '.smd', '.spec', '.spr', '.tst', '.ucd', '.vcf', '.vml', '.fta', '.flr', '.dash',
])

/**
 * True if `filePath` ends in a Sylang extension the symbol manager cares about.
 * Used by API route handlers to skip cache invalidation for non-Sylang writes
 * (.json/.md/.png etc.) — those can't change the symbol graph anyway, and
 * parsing them would just bloat the documents map with empty entries.
 */
export function isSylangFile(filePath: string): boolean {
  return SYLANG_EXTS.has(path.extname(filePath).toLowerCase())
}
const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', '.turbo', '.cache'])

async function walkDirForExts(dir: string, exts: Set<string>, results: string[], depth = 0): Promise<void> {
  if (depth > 6) return
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walkDirForExts(full, exts, results, depth + 1)
      } else if (e.isFile()) {
        const ext = path.extname(e.name)
        if (exts.has(ext)) results.push(full)
      }
    }
  } catch { /* skip */ }
}

class NodeFileOps implements FileOps {
  constructor(private workspaceRoot: string) {}

  readFile(fsPath: string): Promise<string> {
    return fs.readFile(fsPath, 'utf8')
  }

  async readDirectory(fsPath: string): Promise<string[]> {
    try {
      return await fs.readdir(fsPath)
    } catch { return [] }
  }

  async fileExists(fsPath: string): Promise<boolean> {
    try { await fs.access(fsPath); return true } catch { return false }
  }

  async findFiles(pattern: string): Promise<string[]> {
    const exts = parseExtensions(pattern)
    const results: string[] = []
    await walkDirForExts(this.workspaceRoot, exts, results)
    return results
  }
}

// ─── Remote FileOps — batch fetch via GET /ws/{repo}/symbols ──────────────
//
// Option B: the Python agent on Machine 2 walks all Sylang files locally and
// returns their contents in one HTTP call. This class caches that response,
// making findFiles() and readFile() O(1) lookups with zero extra network calls.

class BatchAgentFileOps implements FileOps {
  /** Virtual path → file content. Populated on first findFiles() call. */
  private contentCache = new Map<string, string>()
  private fetchPromise: Promise<void> | null = null

  constructor(
    private hermesUrl: string,
    private repo: string,
    private workspacePrefix: string,  // e.g. "userId/login/repo"
    private apiKey?: string,
  ) {}

  /**
   * Replace the cached content for a single file. Called after a successful
   * write so downstream consumers that read raw text via `readFile()` —
   * WebDiagramTransformer, variant-matrix compute, anything else — see the
   * new content instead of the stale batch-loaded copy.
   */
  setContent(filePath: string, content: string): void {
    this.contentCache.set(filePath, content)
  }

  /** Drop a cached file (after delete / move-source). */
  deleteContent(filePath: string): void {
    this.contentCache.delete(filePath)
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
  }

  /** Fetch all Sylang file contents in a single HTTP call and cache them. */
  private async fetchAll(): Promise<void> {
    if (this.fetchPromise) return this.fetchPromise
    this.fetchPromise = (async () => {
      // The adapter caches its own /symbols response. Direct disk writes
      // — which is what the agent's write_file tool does — DO NOT bust
      // that cache (see hermes-adapter/tests/test_symbols_cache.py). So
      // we always POST /symbols/invalidate first to force the adapter to
      // rebuild from whatever is on disk RIGHT NOW. Without this step the
      // GET below returns the same bytes the adapter had at first load
      // and the studio reparses stale content.
      const invalidateResp = await fetch(
        `${this.hermesUrl}/ws/${encodeURIComponent(this.repo)}/symbols/invalidate`,
        { method: 'POST', headers: this.headers() },
      ).catch((e) => {
        // Older adapter builds (pre-cache-invalidate) won't have this
        // endpoint. Log and continue — the GET below still returns
        // whatever cached state the adapter has, which is the current
        // behaviour without this PR.
        console.warn(
          `[BatchAgentFileOps] /symbols/invalidate POST failed (${e}). Adapter may be on an older build.`,
        )
        return null
      })
      if (invalidateResp && !invalidateResp.ok && invalidateResp.status !== 404) {
        console.warn(
          `[BatchAgentFileOps] /symbols/invalidate returned HTTP ${invalidateResp.status} — adapter cache may be stale`,
        )
      }

      const r = await fetch(
        `${this.hermesUrl}/ws/${encodeURIComponent(this.repo)}/symbols`,
        { headers: this.headers() },
      )
      if (!r.ok) throw new Error(`BatchAgentFileOps: HTTP ${r.status} from /ws/${this.repo}/symbols`)
      const d = await r.json() as { files?: Array<{ path: string; content: string }>; fileCount?: number }
      const files = d.files ?? []
      console.info(`[BatchAgentFileOps] Loaded ${files.length} Sylang files for repo "${this.repo}" in one batch call`)
      for (const f of files) {
        // Normalise to virtual path: "userId/login/repo/relative/path.req"
        const rel = f.path.replace(/\\/g, '/')
        const virtualPath = `${this.workspacePrefix}/${rel}`
        this.contentCache.set(virtualPath, f.content)
      }
    })()
    return this.fetchPromise
  }

  /** Returns all virtual paths for Sylang files in the repo. */
  async findFiles(_pattern: string): Promise<string[]> {
    await this.fetchAll()
    return [...this.contentCache.keys()]
  }

  /** Returns pre-fetched content. Falls back to individual file fetch if not in cache. */
  async readFile(fsPath: string): Promise<string> {
    await this.fetchAll()
    const content = this.contentCache.get(fsPath)
    if (content !== undefined) return content

    // Fallback: fetch individually (file extension might not be in batch set)
    const relInRepo = fsPath.replace(`${this.workspacePrefix}/`, '')
    try {
      const r = await fetch(
        `${this.hermesUrl}/ws/${encodeURIComponent(this.repo)}/file?path=${encodeURIComponent(relInRepo)}`,
        { headers: this.headers() },
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json() as { content?: string }
      const text = d.content ?? ''
      this.contentCache.set(fsPath, text) // cache for next time
      return text
    } catch {
      throw new Error(`BatchAgentFileOps: "${fsPath}" not in batch cache and individual fetch failed`)
    }
  }

  async readDirectory(_fsPath: string): Promise<string[]> { return [] }

  async fileExists(fsPath: string): Promise<boolean> {
    await this.fetchAll()
    return this.contentCache.has(fsPath)
  }
}

// ─── Parse extensions from glob pattern ────────────────────────────────────

function parseExtensions(pattern: string): Set<string> {
  // "**/*.{req,fun,blk,...}" → Set(['.req', '.fun', '.blk'])
  const braceMatch = pattern.match(/\*\.\{([^}]+)\}/)
  if (braceMatch) {
    return new Set(braceMatch[1].split(',').map(e => '.' + e.trim()))
  }
  // "**/*.req" → Set(['.req'])
  const singleMatch = pattern.match(/\*\.(\w+)$/)
  if (singleMatch) return new Set(['.' + singleMatch[1]])
  // "*" or no extension → all sylang exts
  return SYLANG_EXTS
}

// ─── ServerSymbolManager ───────────────────────────────────────────────────

export class ServerSymbolManager extends SylangSymbolManagerCore {
  constructor(fileOps: FileOps) {
    super(serverLogger, fileOps)
  }

  /** Expose protected maps as public for route handlers */
  get allDocuments() { return this.documents }
  get allGlobalIdentifiers() { return this.globalIdentifiers }

  /** Expose protected parseDocumentContent for single-file updates */
  async parseContent(filePath: string, content: string): Promise<void> {
    return this.parseDocumentContent(filePath, content)
  }

  /** Read a file via the same FileOps used during init (works for both local and remote) */
  readFile(filePath: string): Promise<string> {
    return this.fileOps.readFile(filePath)
  }

  /**
   * After a successful write, sync the underlying FileOps content cache so
   * that downstream consumers (diagram transformer, variant-matrix compute)
   * which read raw text via `readFile()` see the fresh content. For
   * `BatchAgentFileOps` this updates its in-memory Map; for `NodeFileOps`
   * there is no cache to update — reads go straight to disk.
   */
  syncFileContent(filePath: string, content: string): void {
    if (this.fileOps instanceof BatchAgentFileOps) {
      this.fileOps.setContent(filePath, content)
    }
  }

  /** Mirror of `syncFileContent` for the delete / move-source path. */
  forgetFileContent(filePath: string): void {
    if (this.fileOps instanceof BatchAgentFileOps) {
      this.fileOps.deleteContent(filePath)
    }
  }

  /**
   * Drop all knowledge of `filePath` from the manager — document entry,
   * global identifiers, and cross-file dependency edges.
   *
   * Callers should follow with `clearImportResolutions()` + `resolveAllImports()`
   * if the deleted file was a header that other docs `use`d.
   */
  removeDocument(filePath: string): void {
    this.documents.delete(filePath)
    this.removeGlobalIdentifiersForFile(filePath)
    this.removeDependenciesForFile(filePath)
  }

  /**
   * Clear cached `use`-import resolutions across every document so the next
   * `resolveAllImports()` call rebuilds them from scratch. Needed after an
   * incremental update or remove, because any document that imported the
   * changed file still holds references to its OLD symbol objects.
   */
  clearImportResolutions(): void {
    for (const doc of this.documents.values()) {
      for (const imp of doc.importedSymbols) {
        imp.importedSymbols = []
      }
    }
  }

  /**
   * Resolve `use` imports: for each `importedSymbols` entry in every document,
   * find the referenced header document and populate the children (def symbols).
   *
   * The core parser only creates empty ImportedSymbol stubs during parsing.
   * This method fills them in after all files are parsed.
   */
  resolveAllImports(): void {
    // Build a lookup: headerName → DocumentSymbols for fast matching
    const headerIndex = new Map<string, import('@sylang/core').DocumentSymbols>()
    for (const doc of this.documents.values()) {
      if (doc.headerSymbol) {
        // Index by name (primary key for `use` resolution)
        headerIndex.set(doc.headerSymbol.name, doc)
      }
    }

    let resolved = 0
    for (const doc of this.documents.values()) {
      for (const imp of doc.importedSymbols) {
        if (imp.importedSymbols.length > 0) continue
        const targetDoc = headerIndex.get(imp.headerIdentifier)
        if (targetDoc) {
          imp.importedSymbols = [
            ...(targetDoc.headerSymbol ? [targetDoc.headerSymbol] : []),
            ...targetDoc.definitionSymbols,
          ]
          resolved++
        }
      }
    }
    console.info(`[SymCache] resolveAllImports: ${resolved} resolved across ${this.documents.size} documents`)
  }
}

// ─── Cache ─────────────────────────────────────────────────────────────────

type CacheEntry = {
  manager: ServerSymbolManager
  lastAccessed: number
  initializing: Promise<void> | null
}

const cache = new Map<string, CacheEntry>()

let cleanupTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCleanup() {
  if (cleanupTimer) return
  cleanupTimer = setTimeout(() => {
    cleanupTimer = null
    const now = Date.now()
    for (const [key, entry] of cache.entries()) {
      if (!entry.initializing && now - entry.lastAccessed > TTL_MS) {
        cache.delete(key)
        console.info('[SymCache] Evicted workspace:', key)
      }
    }
    if (cache.size > 0) scheduleCleanup()
  }, TTL_MS)
}

/**
 * workspacePath format: "{userId}/{login}/{repo}/{...relInRepo}"
 * Returns null if the path can't be parsed (< 3 segments).
 */
function parseCacheKey(workspacePath: string): { repo: string; workspacePrefix: string } | null {
  const parts = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3) return null
  return {
    repo: parts[2],
    workspacePrefix: `${parts[0]}/${parts[1]}/${parts[2]}`,
  }
}

/**
 * Build the cache key. Includes agent URL so a user switching between agents
 * (e.g. cloud playground → BYO) doesn't see stale symbols from the old agent.
 */
function buildCacheKey(workspacePrefix: string, agentUrl: string | null): string {
  return `${agentUrl ?? 'local'}|${workspacePrefix}`
}

export interface AgentLocator {
  /** Per-user agent URL from getAgentConfig() (Supabase agent_instances.api_url).
   *  Null means "no remote agent — read from local ~/.hermes". */
  url: string | null
  /** Optional bearer token for the agent. */
  apiKey?: string
}

/**
 * Get a fully-initialised workspace symbol manager.
 *
 * IMPORTANT — this function ALWAYS performs a fresh init. The cache below
 * exists only so that an in-flight init for the same workspace from a
 * concurrent request can share the work, not to memoize across requests.
 * Every call evicts any prior entry first; the rebuild then re-runs the
 * full /ws/{repo}/symbols fetch (the adapter cache is busted inside
 * BatchAgentFileOps.fetchAll) and reparses every file.
 *
 * This is intentional. Earlier versions kept the manager across requests
 * for performance, but all 9 consumer endpoints (diagrams, matrices,
 * traceability, FMEA, spec/dash render, coverage, symbols, symbol-details)
 * read through this single entry point — caching meant agent or editor
 * writes wouldn't surface to ANY view until a TTL eviction or logout.
 * Cost of fresh init is one /symbols HTTP call + parse, typically <1s
 * for a real workspace. Same cost a project switch already pays.
 */
export async function getWorkspaceManager(
  workspacePath: string,
  agent: AgentLocator,
): Promise<ServerSymbolManager | null> {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return null

  // Force fresh state on every call. If a concurrent request is in the
  // middle of an init for the same workspace, the cache lookup below will
  // still find its in-flight `initializing` promise and share the work.
  invalidateWorkspace(workspacePath)

  const { repo, workspacePrefix } = parsed
  const cacheKey = buildCacheKey(workspacePrefix, agent.url)

  const existing = cache.get(cacheKey)
  if (existing) {
    existing.lastAccessed = Date.now()
    // If still initializing, wait for it
    if (existing.initializing) await existing.initializing
    console.info(`[SymCache] HIT (concurrent init) key="${cacheKey}"`)
    return existing.manager
  }
  console.info(`[SymCache] MISS key="${cacheKey}" — initialising (always-fresh mode)`)

  // Build the right FileOps:
  //   With agent URL: BatchAgentFileOps — one HTTP call to GET /ws/{repo}/symbols.
  //   No agent URL: NodeFileOps reading from local ~/.hermes.
  const fileOps: FileOps = agent.url
    ? new BatchAgentFileOps(agent.url, repo, workspacePrefix, agent.apiKey)
    : new NodeFileOps(path.join(WORKSPACE_ROOT, workspacePrefix))

  const manager = new ServerSymbolManager(fileOps)

  // Use the virtual workspace prefix as the project root for agent mode;
  // for local mode we resolve to the real fs path.
  const virtualRoot = agent.url
    ? workspacePrefix
    : path.join(WORKSPACE_ROOT, workspacePrefix)

  const initPromise = manager.initializeWorkspace(virtualRoot).then(() => {
    // After all files are parsed, resolve `use` imports so that
    // doc.importedSymbols[].importedSymbols contains the actual child symbols.
    // This is critical for relation completions, sigma graph, traceability, etc.
    manager.resolveAllImports()
    console.info('[SymCache] Imports resolved for', cacheKey)
  }).catch((e) => {
    console.error('[SymCache] Init failed for', cacheKey, e)
  }).finally(() => {
    const entry = cache.get(cacheKey)
    if (entry) entry.initializing = null
  })

  cache.set(cacheKey, { manager, lastAccessed: Date.now(), initializing: initPromise })
  scheduleCleanup()

  await initPromise
  return manager
}

/**
 * Update a single document in the cache after a file save.
 * Called from /api/files POST handler. Updates every cache entry for the
 * workspace prefix (covers any agent the user might have hit).
 *
 * After re-parsing, cross-file `use` imports are re-resolved so that other
 * documents that imported symbols from `filePath` see the fresh definitions
 * instead of holding references to the previous parse's symbol objects.
 */
export async function updateCachedDocument(
  workspacePath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return
  const suffix = `|${parsed.workspacePrefix}`
  for (const [key, entry] of cache.entries()) {
    if (!key.endsWith(suffix)) continue
    if (entry.initializing) continue
    // Update both layers: the parsed `documents` map (used for symbol
    // lookups) AND the underlying FileOps content cache (used by diagram
    // transformer + variant-matrix when they pull raw text). Skipping the
    // second layer was the Phase 1 miss — diagrams kept seeing stale text.
    entry.manager.syncFileContent(filePath, content)
    await entry.manager.parseContent(filePath, content)
    entry.manager.clearImportResolutions()
    entry.manager.resolveAllImports()
  }
}

/**
 * Drop a deleted file from the cache across all agents for the workspace.
 * Mirrors `updateCachedDocument` for the delete/move-source case: clears the
 * document, its globals, and its dependency edges, then re-resolves imports
 * so anything that `use`d the deleted file shows up as unresolved.
 */
export function removeCachedDocument(
  workspacePath: string,
  filePath: string,
): void {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return
  const suffix = `|${parsed.workspacePrefix}`
  for (const [key, entry] of cache.entries()) {
    if (!key.endsWith(suffix)) continue
    if (entry.initializing) continue
    entry.manager.forgetFileContent(filePath)
    entry.manager.removeDocument(filePath)
    entry.manager.clearImportResolutions()
    entry.manager.resolveAllImports()
  }
}

/**
 * Invalidate (evict) the cache for a workspace across all agents.
 * Call after destructive operations (clone, bulk write, git pull).
 */
export function invalidateWorkspace(workspacePath: string): void {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return
  const suffix = `|${parsed.workspacePrefix}`
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) cache.delete(key)
  }
}
