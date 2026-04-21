/**
 * Git panel — parent container with sub-tabs (Changes / Log / Branches).
 *
 * Only Changes is implemented in phase C. Log and Branches tabs show a
 * placeholder until phases E and F land respectively.
 */

import { useState } from 'react'
import { ChangesTab } from './changes-tab'

type SubTab = 'changes' | 'log' | 'branches'

const TABS: { key: SubTab; label: string }[] = [
  { key: 'changes', label: 'Changes' },
  { key: 'log', label: 'Log' },
  { key: 'branches', label: 'Branches' },
]

export function GitPanel() {
  const [tab, setTab] = useState<SubTab>('changes')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="flex items-center gap-0 border-b"
        style={{ borderColor: 'var(--theme-border)' }}
      >
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                color: active
                  ? 'var(--theme-text)'
                  : 'var(--theme-muted)',
                borderBottom: active
                  ? '2px solid var(--theme-accent)'
                  : '2px solid transparent',
                marginBottom: '-1px',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'changes' && <ChangesTab />}
        {tab === 'log' && <Placeholder name="Log" />}
        {tab === 'branches' && <Placeholder name="Branches" />}
      </div>
    </div>
  )
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-muted)]">
      {name} view — coming in a later phase.
    </div>
  )
}
