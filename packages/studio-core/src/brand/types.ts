import type { ComponentType } from 'react'
// During the Phase 1 move, `lib/theme.ts` lands in studio-core; this import resolves then.
import type { ThemeId } from '../lib/theme'

/**
 * The single seam between the shared app and a brand.
 *
 * Both Hermes Studio and Sylang Studio run the *same* code from @studio/core.
 * They differ in exactly four ways, all expressed here:
 *
 *   1. Identity   — appTitle / logo / theme / favicon / loading text
 *   2. showMbseTools — whether the Coverage/Traceability/FMEA nav is rendered
 *   3. WorkspaceHome — the home view shown inside the editor/workspace
 *   4. (the public landing page is a per-app route, not in this object)
 *
 * Provide one `brand.config.ts` per app and pass it to <BrandProvider>.
 */
export interface Brand {
  /** Stable id; used for the rare brand-gated branch (e.g. the Sylang theme migration). */
  id: 'hermes' | 'sylang'

  // --- 1. Identity ---
  appTitle: string
  legalName: string
  description: string
  /** Path under the app's own public/ (e.g. '/hermes-crest.svg', '/sylang-logo.svg'). */
  logo: string
  /** Favicon / app icon href. */
  iconHref: string
  /** Themes offered in Settings for this brand. */
  themes: ThemeId[]
  defaultTheme: ThemeId
  /** Rotating phrases on the loading screen. */
  loadingQuips: string[]

  // --- 2. MBSE tools header ---
  /** true → render Coverage / Traceability / FMEA nav. Sylang: true, Hermes: false. */
  showMbseTools: boolean

  // --- 3. Workspace home ---
  /** The home view rendered in the editor area when no file is selected. */
  WorkspaceHome: ComponentType
}
