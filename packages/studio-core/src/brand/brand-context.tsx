import { createContext, useContext, type ReactNode } from 'react'
import type { Brand } from './types'

const BrandContext = createContext<Brand | null>(null)

/**
 * Wrap the app once (in each app's `routes/__root.tsx`) with its own brand:
 *
 *   import { brand } from '../brand.config'
 *   <BrandProvider brand={brand}>{children}</BrandProvider>
 */
export function BrandProvider({ brand, children }: { brand: Brand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>
}

/** Read the active brand. Throws if used outside <BrandProvider>. */
export function useBrand(): Brand {
  const brand = useContext(BrandContext)
  if (!brand) {
    throw new Error('useBrand() must be used within a <BrandProvider>')
  }
  return brand
}
