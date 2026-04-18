'use client'

import { createFileRoute } from '@tanstack/react-router'
import { GitFork, Bot, Terminal, FileCode, Folder, Sparkles } from 'lucide-react'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

const FEATURES = [
  { icon: Bot, title: 'AI Agent Chat', desc: 'Real-time SSE streaming with tool-call visibility. Bring your own Anthropic or OpenAI-compatible backend.' },
  { icon: FileCode, title: 'Code Editor', desc: 'CodeMirror 6 with syntax highlighting for 20+ languages. Rich Jotx editor for structured notes.' },
  { icon: Terminal, title: 'Terminal', desc: 'Full xterm terminal inside the browser, wired to your workspace shell.' },
  { icon: Folder, title: 'GitHub Workspaces', desc: 'Sign in with GitHub, clone any repo, and let the agent read, create, and modify files in place.' },
  { icon: Sparkles, title: 'Memory & Skills', desc: "Browse the agent's memory store and skill library. Agent behavior shaped by your context." },
  { icon: GitFork, title: 'Open Source', desc: 'MIT licensed. Built on Hermes Workspace by Eric (outsourc-e). Self-host or run locally.' },
]

function LandingPage() {
  function handleLogin() {
    window.location.href = '/api/auth/github'
  }

  const bg = '#0a0e17'
  const cardBg = '#111827'
  const borderColor = '#1e293b'
  const textPrimary = '#f1f5f9'
  const textSecondary = '#94a3b8'
  const textMuted = '#64748b'
  const accent = '#6366f1'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: bg, color: textPrimary, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(10,14,23,0.85)', backdropFilter: 'blur(12px)', borderBottom: `1px solid ${borderColor}` }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/hermes-crest.svg" alt="Hermes Studio" style={{ width: 26, height: 26 }} />
            <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.03em', color: textPrimary }}>Hermes Studio</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={handleLogin}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, background: textPrimary, color: bg, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              <GitFork style={{ width: 15, height: 15 }} />
              Sign in with GitHub
            </button>
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 900, margin: '0 auto', padding: '96px 24px 72px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 64px)', fontWeight: 900, lineHeight: 1.06, letterSpacing: '-0.04em', marginBottom: 24, color: textPrimary }}>
          {"Your AI agent's "}
          <span style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            command center
          </span>.
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: textSecondary, maxWidth: 600, margin: '0 auto 48px', lineHeight: 1.75 }}>
          Chat, files, terminal, memory, skills — one workspace for working with AI coding agents.
          Sign in with GitHub, open any repo, and collaborate.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleLogin}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '14px 28px', borderRadius: 10, background: accent, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: `0 4px 24px ${accent}50` }}>
            <GitFork style={{ width: 18, height: 18 }} />
            Sign in with GitHub
          </button>
        </div>
      </section>

      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px 96px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 12, padding: 24 }}>
              <Icon style={{ width: 24, height: 24, color: accent, marginBottom: 12 }} />
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: textPrimary }}>{title}</div>
              <div style={{ fontSize: 14, color: textMuted, lineHeight: 1.6 }}>{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ marginTop: 'auto', borderTop: `1px solid ${borderColor}`, padding: '32px 24px', textAlign: 'center', color: textMuted, fontSize: 13 }}>
        <div style={{ marginBottom: 6 }}>
          Hermes Studio — MIT licensed. Built on{' '}
          <a href="https://github.com/outsourc-e/hermes-agent" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none' }}>
            Hermes Workspace
          </a>{' '}by Eric (outsourc-e).
        </div>
      </footer>
    </div>
  )
}
