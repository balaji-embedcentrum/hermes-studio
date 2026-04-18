/**
 * Workspace detection API.
 * In remote mode: returns the remote workspace dir from env (no local FS scan).
 * In local mode: auto-detects from Hermes config, env, or default paths.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { IS_REMOTE_AGENT } from '../../server/gateway-capabilities'

function extractFolderName(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || 'workspace'
}

async function isValidDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function detectWorkspace(savedPath?: string): Promise<{
  path: string
  folderName: string
  source: string
  isValid: boolean
}> {
  // In remote mode — workspace lives on the agent VPS, not here.
  // Return the HERMES_WORKSPACE_DIR as a virtual root (may not be a local dir).
  if (IS_REMOTE_AGENT) {
    const remoteRoot = process.env.HERMES_WORKSPACE_DIR?.trim() || '/workspaces'
    return {
      path: remoteRoot,
      folderName: extractFolderName(remoteRoot),
      source: 'remote',
      isValid: true,
    }
  }

  // Priority 1: Saved path from localStorage (passed via query param)
  if (savedPath) {
    const isValid = await isValidDirectory(savedPath)
    if (isValid) {
      return {
        path: savedPath,
        folderName: extractFolderName(savedPath),
        source: 'localStorage',
        isValid: true,
      }
    }
    // Saved path is stale, fall through to auto-detect
  }

  // Priority 2: Environment variable
  const envWorkspace = process.env.HERMES_WORKSPACE_DIR?.trim()
  if (envWorkspace) {
    const isValid = await isValidDirectory(envWorkspace)
    if (isValid) {
      return {
        path: envWorkspace,
        folderName: extractFolderName(envWorkspace),
        source: 'hermes',
        isValid: true,
      }
    }
  }

  // Priority 3: Default Hermes workspace path
  const defaultPath = path.join(os.homedir(), '.hermes')
  const defaultValid = await isValidDirectory(defaultPath)
  if (defaultValid) {
    return {
      path: defaultPath,
      folderName: extractFolderName(defaultPath),
      source: 'default',
      isValid: true,
    }
  }

  // Nothing found
  return {
    path: '',
    folderName: '',
    source: 'none',
    isValid: false,
  }
}

export const Route = createFileRoute('/api/workspace')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const savedPath = url.searchParams.get('saved') || undefined

          const result = await detectWorkspace(savedPath)

          return json(result)
        } catch (err) {
          return json(
            {
              path: '',
              folderName: '',
              source: 'error',
              isValid: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
