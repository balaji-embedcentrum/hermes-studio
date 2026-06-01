import { useEffect } from 'react'
import { brand } from '@/brand'

const BASE_TITLE = brand.appTitle

/**
 * Sets document.title for the current page.
 * Usage: usePageTitle('Sessions') → "Sessions — Sylang Studio"
 */
export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = page ? `${page} — ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [page])
}
