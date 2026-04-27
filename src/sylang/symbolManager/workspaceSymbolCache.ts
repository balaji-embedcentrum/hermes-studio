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
import { SylangSymbolManagerCore } from '@sylang-core/core'
import type { ISylangLogger } from '@sylang-core/core'
import type { FileOps } from '@sylang-core/core'
import { IS_REMOTE_AGENT } from '../../server/gateway-capabilities'

const HERMES_API_URL = (process.env.HERMES_API_URL || '').trim().replace(/\/$/, '')
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
  ) {}

  /** Fetch all Sylang file contents in a single HTTP call and cache them. */
  private async fetchAll(): Promise<void> {
    if (this.fetchPromise) return this.fetchPromise
    this.fetchPromise = (async () => {
      const r = await fetch(
        `${this.hermesUrl}/ws/${encodeURIComponent(this.repo)}/symbols`
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
        `${this.hermesUrl}/ws/${encodeURIComponent(this.repo)}/file?path=${encodeURIComponent(relInRepo)}`
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
   * Resolve `use` imports: for each `importedSymbols` entry in every document,
   * find the referenced header document and populate the children (def symbols).
   *
   * The core parser only creates empty ImportedSymbol stubs during parsing.
   * This method fills them in after all files are parsed.
   */
  resolveAllImports(): void {
    // Build a lookup: headerName → DocumentSymbols for fast matching
    const headerIndex = new Map<string, import('@sylang-core/core').DocumentSymbols>()
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
function parseCacheKey(workspacePath: string): { cacheKey: string; repo: string; workspacePrefix: string } | null {
  const parts = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length < 3) return null
  return {
    cacheKey: `${parts[0]}/${parts[1]}/${parts[2]}`,
    repo: parts[2],
    workspacePrefix: `${parts[0]}/${parts[1]}/${parts[2]}`,
  }
}

/**
 * Get the cached workspace symbol manager, initialising it on first call.
 * All server routes should call this instead of creating their own managers.
 */
export async function getWorkspaceManager(workspacePath: string): Promise<ServerSymbolManager | null> {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return null

  const { cacheKey, repo, workspacePrefix } = parsed

  const existing = cache.get(cacheKey)
  if (existing) {
    existing.lastAccessed = Date.now()
    // If still initializing, wait for it
    if (existing.initializing) await existing.initializing
    return existing.manager
  }

  // Build the right FileOps for this environment:
  //   Remote (Machine 2): BatchAgentFileOps — one HTTP call fetches all file
  //     contents at once from GET /ws/{repo}/symbols. Zero per-file network I/O.
  //   Local (same machine): NodeFileOps — reads directly from fs.
  const fileOps: FileOps = IS_REMOTE_AGENT && HERMES_API_URL
    ? new BatchAgentFileOps(HERMES_API_URL, repo, workspacePrefix)
    : new NodeFileOps(path.join(WORKSPACE_ROOT, workspacePrefix))

  const manager = new ServerSymbolManager(fileOps)

  // Start initialization — use the virtual workspace prefix as the "project root"
  const virtualRoot = IS_REMOTE_AGENT
    ? workspacePrefix        // agent mode: virtual path prefix
    : path.join(WORKSPACE_ROOT, workspacePrefix)  // local: real fs path

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
 * Called from /api/files POST handler.
 */
export async function updateCachedDocument(
  workspacePath: string,
  filePath: string,
  content: string,
): Promise<void> {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return
  const entry = cache.get(parsed.cacheKey)
  if (!entry || entry.initializing) return
  await entry.manager.parseContent(filePath, content)
}

/**
 * Invalidate (evict) the cache for a workspace.
 * Call after destructive operations (clone, bulk write).
 */
export function invalidateWorkspace(workspacePath: string): void {
  const parsed = parseCacheKey(workspacePath)
  if (!parsed) return
  cache.delete(parsed.cacheKey)
}
