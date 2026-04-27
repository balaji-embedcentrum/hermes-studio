'use client'

import { createFileRoute, Link } from '@tanstack/react-router'
import {
  GitFork,
  GitBranch,
  Server,
  Lock,
  ExternalLink,
  ChevronRight,
} from 'lucide-react'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

function LandingPage() {
  function handleLogin() {
    window.location.href = '/api/auth/github'
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface text-ink antialiased">
      {/* ──────────────────── Header ──────────────────── */}
      <header className="border-b border-primary-200/60 sticky top-0 z-20 bg-surface/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/hermes-crest.svg"
              alt=""
              className="w-6 h-6"
              aria-hidden="true"
            />
            <span className="text-[15px] font-semibold tracking-tight">
              Hermes Studio
            </span>
          </div>
          <nav className="flex items-center gap-5 text-sm text-primary-600">
            <Link to="/agents" className="hover:text-ink transition-colors">
              Agents
            </Link>
            <a
              href="https://github.com/balaji-embedcentrum/hermes-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors inline-flex items-center gap-1"
            >
              GitHub
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
            <Link to="/terms" className="hover:text-ink transition-colors">
              Terms
            </Link>
            <button
              onClick={handleLogin}
              className="ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-500 text-white text-xs font-medium hover:bg-accent-600 transition-colors"
            >
              <GitFork className="w-3.5 h-3.5" aria-hidden="true" />
              Sign in
            </button>
          </nav>
        </div>
      </header>

      {/* ──────────────────── Hero ──────────────────── */}
      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10 text-center">
        <div
          className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full text-[11px] font-medium border border-primary-200/60"
          style={{ color: 'var(--color-accent-500, #6366f1)' }}
        >
          <span className="size-1.5 rounded-full bg-accent-500" />
          Cloud Playground is live · experimental
        </div>
        <h1 className="text-[36px] sm:text-[48px] leading-[1.1] font-semibold tracking-tight text-ink">
          Hosted / Self-hostable
          <br className="hidden sm:block" />{' '}
          browser IDE for Hermes Agents.
        </h1>
        <p className="mt-5 text-base sm:text-[17px] text-primary-600 max-w-xl mx-auto leading-relaxed">
          Sign in with GitHub. Open any repo. Watch the agent edit files,
          run shell commands, and commit — in a workspace scoped to you.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            onClick={handleLogin}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-accent-500 text-white text-sm font-medium hover:bg-accent-600 transition-colors"
          >
            <GitFork className="w-4 h-4" aria-hidden="true" />
            Sign in with GitHub
          </button>
          <a
            href="https://github.com/balaji-embedcentrum/hermes-studio#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary-600 hover:text-ink transition-colors inline-flex items-center gap-1"
          >
            Read the docs
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* ──────────────────── Hero screenshot ──────────────────── */}
      <section className="mx-auto max-w-6xl w-full px-4 sm:px-6 pb-20">
        <ScreenshotFrame
          src="/screenshots/landing_workspace.png"
          fallback="/landing-hero.svg"
          alt="Hermes Studio workspace — file explorer on the left, project view in the centre, real-time agent chat on the right."
          caption="Inside a session: file explorer + git, project view, live agent chat with tool-call visibility."
        />
      </section>

      {/* ──────────────────── How it works (2 steps) ──────────────────── */}
      <section className="mx-auto max-w-6xl w-full px-6 pb-20">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-primary-500 mb-2 text-center">
          How it works
        </h2>
        <p className="text-center text-primary-600 mb-10 text-[15px]">
          Two clicks from sign-in to working with an agent.
        </p>
        <div className="grid lg:grid-cols-2 gap-6 lg:gap-8 items-start">
          <Step
            number="1"
            title="Pick an agent"
            body="Try one from the cloud playground, point at your own VPS, tunnel from your laptop, or run hermes-agent locally. Each agent has its own model + provider config."
            screenshot="/screenshots/landing_agents.png"
            screenshotAlt="The Choose Your Agent screen — four source modes (Cloud Playground, Your VPS, Local via Tunnel, Local Direct) and a roster of named agents to pick from."
          />
          <Step
            number="2"
            title="Pick a project"
            body="Choose any GitHub repo you have access to. Studio clones it into a per-user workspace on the agent host — the agent only sees that directory, and your edits commit back to your GitHub."
            screenshot="/screenshots/landing_projects.png"
            screenshotAlt="The Projects screen — pick a GitHub repository to open in the workspace."
          />
        </div>
      </section>

      {/* ──────────────────── What it is (3 paragraphs) ──────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-20">
        <div className="space-y-10">
          <Block
            icon={GitBranch}
            heading="A workspace per user, scoped to one repo at a time."
          >
            When a session starts, Studio clones the GitHub repo of your
            choice into a per-user directory on the agent host. The agent
            only sees that directory — kernel-enforced, not prompt-enforced.
            Every tool call and file edit streams back to the chat in real
            time. Commits push to your GitHub.
          </Block>

          <Block
            icon={Server}
            heading="Backed by hermes-agent. Choose your runtime."
          >
            The chat tier runs the open-source{' '}
            <a
              href="https://github.com/NousResearch/hermes-agent"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-500 hover:underline"
            >
              hermes-agent
            </a>{' '}
            from NousResearch. Try it on the shared Cloud Playground,
            install hermes-adapter on your own VPS, or tunnel from your
            laptop. Provider keys live on the adapter, not in the agent.
          </Block>

          <Block
            icon={Lock}
            heading="Open source. Your data stays where you put it."
          >
            MIT licensed. GitHub OAuth via your own Supabase project — JWTs
            in HttpOnly cookies, no client-side token exposure. Filesystem
            APIs are scoped to a workspace root with no path-traversal
            escape. Self-host the entire stack with one docker-compose.
          </Block>
        </div>
      </section>

      {/* ──────────────────── Two things you do ──────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-20">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-primary-500 mb-5">
          Two things you do
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="border-l-2 border-primary-200/60 pl-4">
            <h3 className="text-[15px] font-semibold text-ink">Projects</h3>
            <p className="mt-1.5 text-[14px] text-primary-600 leading-relaxed">
              Each project is one of your GitHub repos cloned into a per-user
              workspace on the agent host. Pick a project, hand it to an
              agent, and watch the work happen in your repo.
            </p>
          </div>
          <div className="border-l-2 border-primary-200/60 pl-4">
            <h3 className="text-[15px] font-semibold text-ink">Agents</h3>
            <p className="mt-1.5 text-[14px] text-primary-600 leading-relaxed">
              Pick from the roster on the cloud playground, or register your
              own (BYO VPS, BYO tunnel). Each agent has its own personality
              and runtime config, and only sees the project you've handed it.
            </p>
          </div>
        </div>
      </section>

      {/* ──────────────────── Three ways to run ──────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-primary-500 mb-5">
          Three ways to run it
        </h2>
        <div className="space-y-5">
          <RunMode
            label="Cloud Playground"
            who="Trying it out, no setup"
            what="Shared infrastructure on our cloud fleet. Experimental, no SLA. Pick from a roster of named agents."
          />
          <RunMode
            label="Your VPS"
            who="Private, persistent"
            what="Install hermes-adapter on your server, point Studio at the URL. Your repos and sessions stay on your hardware."
          />
          <RunMode
            label="Local via Tunnel"
            who="Air-gapped or behind a corporate firewall"
            what="Cloudflare tunnel from your laptop. Studio reaches your local dev box without exposing a public port."
          />
        </div>
      </section>

      {/* ──────────────────── Footer ──────────────────── */}
      <footer className="mt-auto border-t border-primary-200/60">
        <div className="mx-auto max-w-6xl px-6 py-6 flex items-center justify-between text-xs text-primary-500">
          <span>MIT licensed.</span>
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/balaji-embedcentrum/hermes-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://github.com/balaji-embedcentrum/hermes-studio/blob/main/CREDITS.md"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              Credits
            </a>
            <Link to="/terms" className="hover:text-ink transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

/**
 * Wrap a screenshot in a faux-window frame with a subtle traffic-light row,
 * a soft glow, and a caption underneath. The fallback path renders if the
 * primary PNG isn't on disk yet — useful during initial deploy before the
 * operator drops in real screenshots.
 */
function ScreenshotFrame({
  src,
  fallback,
  alt,
  caption,
}: {
  src: string
  fallback?: string
  alt: string
  caption?: string
}) {
  return (
    <figure className="mx-auto">
      <div
        className="relative rounded-xl overflow-hidden border border-primary-200/60"
        style={{
          // Subtle accent glow under the screenshot so it lifts off the page
          // without resorting to gradient hero backgrounds.
          boxShadow:
            '0 30px 80px -30px rgba(99,102,241,0.35), 0 8px 24px -8px rgba(0,0,0,0.4)',
        }}
      >
        <div className="flex items-center gap-1.5 px-3 py-2 bg-primary-100 border-b border-primary-200/60">
          <span className="size-2.5 rounded-full bg-primary-300/70" />
          <span className="size-2.5 rounded-full bg-primary-300/70" />
          <span className="size-2.5 rounded-full bg-primary-300/70" />
        </div>
        <img
          src={src}
          alt={alt}
          className="w-full block"
          loading="eager"
          onError={(e) => {
            if (fallback && e.currentTarget.src !== fallback) {
              e.currentTarget.src = fallback
            }
          }}
        />
      </div>
      {caption && (
        <figcaption className="mt-3 text-center text-xs text-primary-500">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/**
 * One numbered step in the "How it works" section. Big numeral, screenshot
 * in a small frame, prose underneath. Restrained — no animation, no fade,
 * no marketing icon-grid.
 */
function Step({
  number,
  title,
  body,
  screenshot,
  screenshotAlt,
}: {
  number: string
  title: string
  body: string
  screenshot: string
  screenshotAlt: string
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span
          className="inline-flex items-center justify-center size-7 rounded-full bg-accent-500/10 text-accent-500 text-sm font-semibold"
          aria-hidden="true"
        >
          {number}
        </span>
        <h3 className="text-lg font-semibold text-ink leading-snug">{title}</h3>
        <ChevronRight
          className="hidden lg:block w-4 h-4 text-primary-400"
          aria-hidden="true"
        />
      </div>
      <div
        className="rounded-lg overflow-hidden border border-primary-200/60 mb-3"
        style={{
          boxShadow: '0 12px 32px -16px rgba(0,0,0,0.4)',
        }}
      >
        <img src={screenshot} alt={screenshotAlt} className="w-full block" />
      </div>
      <p className="text-[14px] text-primary-600 leading-relaxed">{body}</p>
    </div>
  )
}

function Block({
  icon: Icon,
  heading,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  heading: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 mt-1">
        <Icon className="w-5 h-5 text-accent-500" aria-hidden={true} />
      </div>
      <div>
        <h3 className="text-[17px] font-semibold text-ink leading-snug">
          {heading}
        </h3>
        <p className="mt-2 text-[15px] text-primary-600 leading-relaxed">
          {children}
        </p>
      </div>
    </div>
  )
}

function RunMode({
  label,
  who,
  what,
}: {
  label: string
  who: string
  what: string
}) {
  return (
    <div className="border-l-2 border-primary-200/60 pl-4">
      <div className="flex items-baseline gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{label}</h3>
        <span className="text-xs text-primary-500">{who}</span>
      </div>
      <p className="mt-1.5 text-[14px] text-primary-600 leading-relaxed">
        {what}
      </p>
    </div>
  )
}
