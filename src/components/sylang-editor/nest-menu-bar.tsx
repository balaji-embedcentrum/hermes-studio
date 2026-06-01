/**
 * NestMenuBar — dropdown menu mounted in the sylang editor's title row.
 *
 * Ported from sylang-hermes/src/components/sylang-editor/nest-menu-bar.tsx
 * with two host-specific changes:
 *   1. **Git dropdown stripped.** This host already has a full git panel
 *      (src/components/git-panel/) with stage/discard/diff/commit/push/
 *      pull/log/branch UI driven by /api/git. The legacy nest-menu Git
 *      subset would duplicate it.
 *   2. **Process menu items route to a "coming soon" view.** ISO 26262
 *      and ASPICE aren't implemented yet in sylang-hermes either; we
 *      keep the entries so the menu shape matches but the click lands
 *      on a placeholder InlineView the parent renders.
 *
 * Clicking an analysis item calls `onViewChange(key)` so the parent
 * SylangFileEditor can swap the editor body for an inline view (FMEA,
 * Coverage, Traceability, …).
 */
'use client'

import { useState } from 'react'
import { MenuContent, MenuRoot, MenuTrigger } from '@/components/ui/menu'

type Props = {
  workspacePath: string
  onViewChange?: (view: string | null) => void
}

/**
 * Maps the legacy `/analysis/<x>` paths to inline-view keys the parent
 * understands. Kept as a string-string map so adding new views (coverage,
 * traceability, …) is a one-line change.
 */
const VIEW_MAP: Record<string, string> = {
  '/analysis/coverage': 'coverage',
  '/analysis/traceability': 'traceability',
  '/analysis/fmea': 'fmea',
  '/analysis/iso26262': 'iso26262',
  '/analysis/aspice': 'aspice',
}

export function NestMenuBar({ onViewChange }: Props) {
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [processOpen, setProcessOpen] = useState(false)

  const goTo = (path: string) => {
    const viewKey = VIEW_MAP[path]
    if (onViewChange && viewKey) onViewChange(viewKey)
  }

  const itemStyle: React.CSSProperties = {
    color: 'var(--theme-text)',
  }
  const itemHover = (e: React.MouseEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLDivElement).style.background = 'var(--theme-card2)'
  }
  const itemUnhover = (e: React.MouseEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
  }

  return (
    <div className="flex items-center gap-0.5">
      <MenuRoot open={analysisOpen} onOpenChange={setAnalysisOpen}>
        <MenuTrigger
          type="button"
          className="px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10"
          style={{ color: 'var(--theme-muted)' }}
        >
          Analysis ▾
        </MenuTrigger>
        <MenuContent side="bottom" align="start">
          <div
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-[450] cursor-pointer"
            style={itemStyle}
            onClick={() => {
              setAnalysisOpen(false)
              goTo('/analysis/coverage')
            }}
            onMouseEnter={itemHover}
            onMouseLeave={itemUnhover}
          >
            Coverage Report
          </div>
          <div
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-[450] cursor-pointer"
            style={itemStyle}
            onClick={() => {
              setAnalysisOpen(false)
              goTo('/analysis/traceability')
            }}
            onMouseEnter={itemHover}
            onMouseLeave={itemUnhover}
          >
            Traceability Graph
          </div>
          <div
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-[450] cursor-pointer"
            style={itemStyle}
            onClick={() => {
              setAnalysisOpen(false)
              goTo('/analysis/fmea')
            }}
            onMouseEnter={itemHover}
            onMouseLeave={itemUnhover}
          >
            FMEA AIAG/VDA
          </div>
        </MenuContent>
      </MenuRoot>

      <MenuRoot open={processOpen} onOpenChange={setProcessOpen}>
        <MenuTrigger
          type="button"
          className="px-2 py-1 rounded text-xs font-medium transition-colors hover:bg-white/10"
          style={{ color: 'var(--theme-muted)' }}
        >
          Process ▾
        </MenuTrigger>
        <MenuContent side="bottom" align="start">
          <div
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-[450] cursor-pointer"
            style={itemStyle}
            onClick={() => {
              setProcessOpen(false)
              goTo('/analysis/iso26262')
            }}
            onMouseEnter={itemHover}
            onMouseLeave={itemUnhover}
          >
            ISO 26262
          </div>
          <div
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-[450] cursor-pointer"
            style={itemStyle}
            onClick={() => {
              setProcessOpen(false)
              goTo('/analysis/aspice')
            }}
            onMouseEnter={itemHover}
            onMouseLeave={itemUnhover}
          >
            ASPICE Workbench
          </div>
        </MenuContent>
      </MenuRoot>
    </div>
  )
}
