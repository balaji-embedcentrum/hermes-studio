import type { Brand } from './types'
import { hermesBrand, sylangBrand, sampleBrand } from './configs'

export type { Brand } from './types'

/**
 * The active brand, chosen at build time by `VITE_BRAND` (set per app/Dockerfile).
 * Defaults to Sylang (the codebase's home brand) when unset, e.g. in plain dev.
 *
 *   VITE_BRAND=hermes  → Hermes Studio
 *   VITE_BRAND=sylang  → Sylang Studio  (default)
 *   VITE_BRAND=sample  → Sample Studio  (reference brand — copy it to make your own)
 */
const BRANDS: Record<string, Brand> = {
  hermes: hermesBrand,
  sylang: sylangBrand,
  sample: sampleBrand,
}

export const brand: Brand = BRANDS[import.meta.env.VITE_BRAND ?? ''] ?? sylangBrand
