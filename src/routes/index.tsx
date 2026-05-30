'use client'

import { createFileRoute } from '@tanstack/react-router'
import { GitFork } from 'lucide-react'
import { brand } from '@/brand'

/**
 * Sylang Studio gateway.
 *
 * The marketing site is `sylang-visual-forge` (a separate Vite app served
 * from the project's public domain). Its "Sylang Playground" button links
 * here, but it can also link directly to `/api/auth/github` to skip this
 * page entirely. This route exists so that:
 *
 *   1. Users who type the sylang-studio URL directly still get a usable
 *      sign-in entry point instead of a 404.
 *   2. Failed OAuth round-trips that bounce back to `/?error=...` can show
 *      a recognisable error message (the callback handler redirects here
 *      on every error branch — see /api/auth/callback).
 *
 * Anything heavier (feature highlights, screenshots, file-type guides)
 * belongs in sylang-visual-forge.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  component: SignInGateway,
})

// Human-readable explanations for the error codes /api/auth/callback emits.
const ERROR_COPY: Record<string, string> = {
  no_code: 'GitHub did not return an authorization code. Please try again.',
  pkce_missing:
    'The sign-in session expired before completing. Please try again.',
  token_exchange_failed:
    'Could not exchange the GitHub code for a session token.',
  token_exchange_error: 'A network error occurred while signing in.',
  auth_failed: 'Sign-in failed. Please try again.',
}

function SignInGateway() {
  const { error } = Route.useSearch()
  const errorMessage = error ? (ERROR_COPY[error] ?? 'Sign-in failed.') : null

  function handleLogin() {
    window.location.href = '/api/auth/github'
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-surface text-ink antialiased px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <img
          src={brand.logo}
          alt=""
          aria-hidden="true"
          className="h-12 w-12"
          // Fallback: hide the image if the asset isn't present in public/
          // so we don't render a broken-image icon.
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
        />

        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">
            {brand.appTitle}
          </h1>
          <p className="text-sm text-primary-600 mt-1">
            Sign in with GitHub to open the playground.
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="w-full rounded-md px-3 py-2 text-xs"
            style={{ background: '#3f0f0f', color: '#fca5a5' }}
          >
            {errorMessage}
          </div>
        )}

        <button
          onClick={handleLogin}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
        >
          <GitFork className="w-4 h-4" aria-hidden="true" />
          Sign in with GitHub
        </button>

        <p className="text-[11px] text-primary-500 text-center">
          New here? Read more on{' '}
          <a
            href="https://sylang.dev"
            className="underline hover:text-ink"
            target="_blank"
            rel="noopener noreferrer"
          >
            sylang.dev
          </a>
          .
        </p>
      </div>
    </div>
  )
}
