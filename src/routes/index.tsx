'use client'

import { createFileRoute, Link } from '@tanstack/react-router'
import {
  GitFork,
  GitBranch,
  Server,
  Lock,
  ExternalLink,
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
      {/* ---------- Header ---------- */}
      <header className="border-b border-primary-200/60">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
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
            <Link
              to="/agents"
              className="hover:text-ink transition-colors"
            >
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
            <Link
              to="/terms"
              className="hover:text-ink transition-colors"
            >
              Terms
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
        <h1 className="text-[34px] sm:text-[42px] leading-[1.15] font-semibold tracking-tight text-ink">
          A self-hostable browser IDE for working with
          <br className="hidden sm:block" />{' '}
          AI coding agents on real Git repositories.
        </h1>
        <p className="mt-6 text-[15px] sm:text-base text-primary-600 max-w-xl mx-auto leading-relaxed">
          Sign in with GitHub. Open any repo. The agent reads, edits, and runs
          shell commands in a workspace scoped to you — you watch the stream in
          real time.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
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

      {/* ---------- Hero screenshot ---------- */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-lg overflow-hidden border border-primary-200/60 shadow-2xl shadow-black/40">
          {/*
            Hero asset. Placeholder is /landing-hero.svg (a stylized
            two-pane mockup so the layout works out of the box). Drop a
            real PNG screenshot at /landing-hero.png and change the src
            below to swap it in.
          */}
          <img
            src="/landing-hero.svg"
            alt="Hermes Studio interface — chat with the agent on the left, code editor with the agent's edits on the right."
            className="w-full block"
            loading="eager"
          />
        </div>
      </section>

      {/* ---------- What it is ---------- */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="space-y-12">
          <Block
            icon={GitBranch}
            heading="A workspace per user, scoped to one repo at a time."
          >
            When you start a session, Studio clones the GitHub repo of your
            choice into a per-user directory on the agent host. The agent only
            sees that directory — kernel-enforced, not prompt-enforced. You see
            every tool call and file edit as it happens via SSE streaming.
            Commits push back to your GitHub.
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
            from NousResearch. Three ways to point Studio at one: try it on
            our shared Cloud Playground, install hermes-adapter on your own VPS,
            or tunnel from your laptop for air-gapped work.
          </Block>

          <Block
            icon={Lock}
            heading="Open source. Your data stays where you put it."
          >
            MIT licensed. Auth is GitHub OAuth via your own Supabase project —
            session JWTs in HttpOnly cookies, no client-side token exposure.
            Filesystem APIs are scoped to a workspace root with no
            path-traversal escape. Self-host the entire stack with one
            docker-compose.
          </Block>
        </div>
      </section>

      {/* ---------- What's in the workspace ---------- */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-primary-500 mb-5">
          Inside the workspace
        </h2>
        <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-[15px] text-primary-700 leading-relaxed">
          <li>Chat — SSE streaming with tool-call visibility</li>
          <li>Editor — CodeMirror 6, 20+ languages</li>
          <li>Terminal — xterm wired to the workspace shell</li>
          <li>Files — per-session repo browser</li>
          <li>Notes — structured Jotx editor for `.jot` files</li>
          <li>Git — clone, edit, commit, push from the UI</li>
        </ul>
      </section>

      {/* ---------- Three ways to run ---------- */}
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

      {/* ---------- Footer ---------- */}
      <footer className="mt-auto border-t border-primary-200/60">
        <div className="mx-auto max-w-5xl px-6 py-6 flex items-center justify-between text-xs text-primary-500">
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
            <Link
              to="/terms"
              className="hover:text-ink transition-colors"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
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
        <Icon
          className="w-5 h-5 text-accent-500"
          aria-hidden={true}
        />
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
