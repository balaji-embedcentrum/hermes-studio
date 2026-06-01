import type { Brand } from './types'
import { hermesBrand, sylangBrand } from './configs'

export type { Brand } from './types'

/**
 * The active brand, chosen at build time by `VITE_BRAND` (set per app/Dockerfile).
 * Defaults to Sylang (the codebase's home brand) when unset, e.g. in plain dev.
 *
 *   VITE_BRAND=hermes  → Hermes Studio
 *   VITE_BRAND=sylang  → Sylang Studio  (default)
 */
export const brand: Brand =
  import.meta.env.VITE_BRAND === 'hermes' ? hermesBrand : sylangBrand
