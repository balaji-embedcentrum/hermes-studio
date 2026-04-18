# Hermes Studio — Deployment

Single-box production deploy targeting an Ubuntu 22/24 VPS behind
Cloudflare. Web tier only — the agent gateway (OpenAI-compatible) runs
separately.

## Architecture

```
Client
  └─ Cloudflare DNS (proxy OFF) ─→ VPS public IP
       └─ Caddy (:80, :443, TLS via Let's Encrypt HTTP-01)
            └─ web container (:3000, Node SSR)
                 └─ Supabase (auth + DB + realtime, external)
                 └─ Agent gateway via HERMES_API_URL (external)
```

## Prerequisites

1. **VPS** — Ubuntu 22.04 or 24.04, ≥4GB RAM, ≥40GB disk, root SSH
2. **Domain** on Cloudflare (`hermes-studio.com` in this guide)
3. **Supabase project** with:
   - `profiles`, `agent_instances`, `agent_sessions` tables
   - GitHub provider enabled in Auth → Providers
   - Tables in `supabase_realtime` publication:
     ```sql
     ALTER PUBLICATION supabase_realtime ADD TABLE agent_sessions;
     ALTER PUBLICATION supabase_realtime ADD TABLE agent_instances;
     ```
4. **Anthropic API key** (or other provider for the agent)
5. **Agent gateway URL** reachable from the VPS over HTTPS with a
   shared bearer token (`HERMES_API_TOKEN`)

## Cloudflare DNS — configure first

Before running setup on the VPS, add these DNS records in Cloudflare:

| Type  | Name                    | Content            | Proxy status |
|-------|-------------------------|--------------------|--------------|
| A     | `hermes-studio.com`     | `<your VPS IP>`    | **DNS only** (grey cloud) |
| CNAME | `www.hermes-studio.com` | `hermes-studio.com`| **DNS only** (grey cloud) |

> Proxy must be OFF initially so Caddy's Let's Encrypt HTTP-01 challenge
> can hit port 80 directly. Once the cert is issued (after first start),
> you can turn proxy ON — but then switch Caddy to DNS-01 or use a
> Cloudflare Origin certificate; see "Enabling Cloudflare proxy" below.

After the deploy is working, also:
- **SSL/TLS mode**: Full (strict)
- **Always use HTTPS**: On
- **Auto minify** (optional): On

## One-command bootstrap

SSH to the VPS as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/balaji-embedcentrum/hermes-studio/main/deploy/setup.sh | bash
```

This will:
1. Install Docker + Compose plugin
2. Configure UFW firewall (22/80/443 only)
3. Add a 4GB swap file (prevents OOM during `pnpm build`)
4. Clone the repo to `/opt/hermes/hermes-studio`
5. Create `/opt/hermes/workspace` for user repo clones
6. Copy `.env.example` → `.env` for you to fill in

No services start yet — you fill in `.env` next.

## Fill in `.env`

```bash
nano /opt/hermes/hermes-studio/.env
```

| Key | Where to get it |
|-----|-----------------|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → `service_role` **secret** key |
| `HERMES_API_URL` | Your agent gateway URL (e.g. `https://agent.hermes-studio.com`) |
| `HERMES_API_TOKEN` | Generate: `openssl rand -hex 32` — must match the agent's config |
| `ANTHROPIC_API_KEY` | console.anthropic.com → Settings → API Keys |

## Start services

```bash
cd /opt/hermes/hermes-studio
docker compose -f docker-compose.prod.yml up -d --build
```

First build: **5–10 minutes** (downloads Node 22, installs pnpm deps,
builds Vite client + server bundles). Swap makes this possible on a 4GB
VPS but CPU will peak.

Watch logs:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

You want to see:
- `web`: `Listening on http://0.0.0.0:3000`
- `caddy`: `certificate obtained successfully` (first start only)

## Verify

Open `https://hermes-studio.com`. You should see:
- Landing page with "Sign in with GitHub" button
- Certificate valid (green padlock)
- No console errors in browser devtools

Then:
1. Click "Sign in with GitHub"
2. Authorize the app
3. You land at `/agents`

## Supabase callback URL

After first successful login attempt, Supabase will complain about the
redirect URL. Add it:

**Supabase → Authentication → URL Configuration → Redirect URLs:**

```
https://hermes-studio.com/api/auth/callback
```

## Enabling Cloudflare proxy (later)

Once HTTPS works end-to-end with DNS-only mode, you can turn on
Cloudflare's proxy (orange cloud) for DDoS protection and hidden origin
IP. But then Let's Encrypt HTTP-01 stops working for renewals. Two
options:

**Option A — Cloudflare Origin certificate** (simpler)
1. Cloudflare → SSL/TLS → Origin Server → Create Certificate (15 years)
2. Download cert + key, place on VPS at `/opt/hermes/caddy-certs/`
3. Edit `deploy/Caddyfile`:
   ```
   hermes-studio.com {
     tls /opt/hermes/caddy-certs/cert.pem /opt/hermes/caddy-certs/key.pem
     ...
   }
   ```
4. `docker compose -f docker-compose.prod.yml restart caddy`

**Option B — DNS-01 challenge via Cloudflare API**
1. Cloudflare → My Profile → API Tokens → Create Token
   - Permissions: `Zone:DNS:Edit`, `Zone:Zone:Read` for `hermes-studio.com` only
2. Add `CLOUDFLARE_API_TOKEN=...` to `.env`
3. Use the Caddy Cloudflare module build (requires custom image build)

Option A is easier. Do it after launch.

## Common operations

```bash
# App status
docker compose -f docker-compose.prod.yml ps

# App logs (live)
docker compose -f docker-compose.prod.yml logs -f web

# Restart just the app
docker compose -f docker-compose.prod.yml restart web

# Update to latest main branch
cd /opt/hermes/hermes-studio
git pull
docker compose -f docker-compose.prod.yml up -d --build

# Stop everything
docker compose -f docker-compose.prod.yml down

# Nuke & restart (keeps data volumes)
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d --build

# Backup user workspaces
tar czf workspace-$(date +%F).tar.gz /opt/hermes/workspace/
```

## Post-deploy security hardening

These are on the day-one todo list but not blocking:

1. **Disable root SSH login after adding a non-root user + SSH key**:
   ```bash
   adduser deploy
   usermod -aG sudo,docker deploy
   mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
   # paste your pubkey into /home/deploy/.ssh/authorized_keys
   # then: PermitRootLogin no + PasswordAuthentication no in /etc/ssh/sshd_config
   systemctl restart sshd
   ```
2. **Change VPS root password** (and any root password that may have
   been exposed during bootstrap).
3. **Enable fail2ban** for SSH brute-force protection:
   ```bash
   apt-get install -y fail2ban
   systemctl enable --now fail2ban
   ```
4. **Point Cloudflare orange-cloud on** (see "Enabling Cloudflare proxy"
   above) to hide the origin IP.
5. **Enable Supabase RLS** on every table the app writes to — don't
   rely solely on service-role-key trust.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 Bad Gateway | `docker compose logs web` — app crashed or failed to start |
| Caddy "no certificate" | Cloudflare proxy ON? Turn OFF until cert issued. |
| GitHub sign-in loops | Supabase redirect URL not added (see above) |
| `pnpm build` OOM | Swap not active — check `swapon --show` |
| Agent calls fail | `HERMES_API_URL` unreachable from VPS? `HERMES_API_TOKEN` mismatch? |
| Realtime events missing | Tables not in `supabase_realtime` publication |
