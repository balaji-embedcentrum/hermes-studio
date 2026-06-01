/**
 * The brand seam. studio-core is one shared app; Hermes Studio and Sylang Studio
 * are the same code with a different `Brand`, selected at build time by
 * `VITE_BRAND` (see ./index.ts). Everything else is identical between the two.
 *
 * The four brand differences (and nothing else):
 *   1. Identity      — appTitle / description / logo / themes / loading text
 *   2. showMbseTools — whether the Coverage/Traceability/FMEA tools are surfaced
 *   3. WorkspaceHome — the home view inside the editor (gated/branded in files route)
 *   4. Landing       — the public sign-in / landing page (routes/index.tsx)
 *
 * Identity + showMbseTools are plain serializable values usable at build time
 * (in __root's head + inline theme scripts). The two brand views (3, 4) are
 * resolved separately in their route files via `brand.id` to keep this module
 * import-light.
 */
export interface Brand {
  id: 'hermes' | 'sylang'

  appTitle: string
  description: string
  /** Logo path under public/ (favicon + loading screen). */
  logo: string
  /** Subtitle under the logo on the loading screen. */
  loadingTagline: string
  loadingQuips: string[]
  /** Themes selectable in Settings for this brand. */
  themes: string[]
  defaultTheme: string

  /** true → surface Coverage / Traceability / FMEA. Sylang: true, Hermes: false. */
  showMbseTools: boolean
}
