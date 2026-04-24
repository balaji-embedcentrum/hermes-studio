import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/terms')({
  component: TermsPage,
})

function TermsPage() {
  const bg = '#0A0E1A'
  const cardBg = '#10141F'
  const borderColor = '#1f2937'
  const textPrimary = '#f3f4f6'
  const textSecondary = '#9ca3af'
  const accent = '#6366f1'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: bg,
        color: textPrimary,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <nav
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,14,23,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: '0 24px',
            height: 62,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            to="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              color: textPrimary,
            }}
          >
            <img
              src="/hermes-crest.svg"
              alt="Hermes Studio"
              style={{ width: 26, height: 26 }}
            />
            <span
              style={{
                fontWeight: 800,
                fontSize: 18,
                letterSpacing: '-0.03em',
              }}
            >
              Hermes Studio
            </span>
          </Link>
        </div>
      </nav>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '64px 24px' }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            marginBottom: 8,
          }}
        >
          Terms & Conditions
        </h1>
        <p style={{ fontSize: 14, color: textSecondary, marginBottom: 40 }}>
          Last updated: April 2026
        </p>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              marginBottom: 16,
              color: '#fbbf24',
            }}
          >
            ⚠ Experimental software
          </h2>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.7,
              color: textPrimary,
              marginBottom: 0,
            }}
          >
            Hermes Studio is an open playground for trying AI coding agents.
            It is provided <strong>AS IS</strong>, without warranties of any
            kind. By signing in, you acknowledge that this is experimental
            software and you use it at your own risk.
          </p>
        </div>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            What the cloud playground is for
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: textSecondary,
              marginBottom: 12,
            }}
          >
            The "Cloud Playground Agents" listed on the Agents page are{' '}
            <strong style={{ color: textPrimary }}>shared, public</strong>{' '}
            infrastructure intended for evaluation. They let you try out
            Hermes agents end-to-end without setting up your own machine.
          </p>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: textSecondary,
              marginBottom: 0,
            }}
          >
            They are <strong style={{ color: '#ef4444' }}>not</strong>{' '}
            intended for proprietary code, secrets, or anything you wouldn't
            post publicly.
          </p>
        </div>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            What you should NOT do on the cloud playground
          </h2>
          <ul
            style={{
              fontSize: 14,
              lineHeight: 1.9,
              color: textSecondary,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Push private or proprietary repositories</li>
            <li>Paste API keys, credentials, or secrets into chat or files</li>
            <li>Store sensitive personal or customer data</li>
            <li>Treat your workspace files as private or persistent</li>
          </ul>
        </div>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            What we don't promise
          </h2>
          <ul
            style={{
              fontSize: 14,
              lineHeight: 1.9,
              color: textSecondary,
              paddingLeft: 20,
              margin: 0,
            }}
          >
            <li>Uptime — agents may be unavailable at any time</li>
            <li>
              Data retention — workspaces and chat history may be reset
              without notice
            </li>
            <li>
              Privacy — operators may access infrastructure for debugging or
              maintenance
            </li>
            <li>
              Isolation — sessions are scoped per user, but the underlying
              fleet is shared
            </li>
          </ul>
        </div>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${accent}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              marginBottom: 16,
              color: accent,
            }}
          >
            Want privacy and control? Run your own.
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: textSecondary,
              marginBottom: 0,
            }}
          >
            On the Agents page, choose <strong>Your VPS</strong> or{' '}
            <strong>Local Direct</strong> instead. Those run entirely on
            infrastructure you own, with files that never leave your
            environment. The cloud playground exists so you can{' '}
            <em>try</em> Hermes — host your own when you want to{' '}
            <em>use</em> it.
          </p>
        </div>

        <div
          style={{
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: 12,
            padding: 28,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            Liability
          </h2>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.7,
              color: textSecondary,
              marginBottom: 0,
            }}
          >
            To the maximum extent permitted by law, the operators of Hermes
            Studio are not liable for any direct, indirect, incidental, or
            consequential damages arising from your use of this service,
            including but not limited to data loss, downtime, or unauthorised
            access to content you place into the playground.
          </p>
        </div>

        <p
          style={{
            fontSize: 13,
            color: textSecondary,
            marginTop: 32,
            textAlign: 'center',
          }}
        >
          Questions? Open an issue at{' '}
          <a
            href="https://github.com/balaji-embedcentrum/hermes-studio"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: accent }}
          >
            github.com/balaji-embedcentrum/hermes-studio
          </a>
          .
        </p>

        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <Link
            to="/"
            style={{
              display: 'inline-block',
              padding: '10px 24px',
              borderRadius: 8,
              background: accent,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            ← Back to Sign in
          </Link>
        </div>
      </main>
    </div>
  )
}
