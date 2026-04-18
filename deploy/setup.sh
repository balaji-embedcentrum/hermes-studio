#!/usr/bin/env bash
#
# Hermes Studio — VPS bootstrap.
# Idempotent: safe to re-run.
#
# What it does:
#   1. Updates apt
#   2. Installs Docker + Compose + git + ufw
#   3. Configures firewall (SSH + HTTP + HTTPS only)
#   4. Sets up 4GB swap (so pnpm build doesn't OOM on small VPSes)
#   5. Clones or pulls hermes-studio into /opt/hermes/hermes-studio
#   6. Creates /opt/hermes/workspace (persistent volume for user repos)
#   7. Copies .env.example → .env if missing
#
# Does NOT start services — you fill in .env first, then run compose.

set -euo pipefail

REPO_URL="${HERMES_STUDIO_REPO:-https://github.com/balaji-embedcentrum/hermes-studio.git}"
APP_DIR="/opt/hermes"
REPO_DIR="${APP_DIR}/hermes-studio"
WORKSPACE_DIR="${APP_DIR}/workspace"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33m!!\033[0m  %s\n" "$*"; }
done_() { printf "\033[1;32m✓\033[0m  %s\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
	echo "Run as root (or with sudo)." >&2
	exit 1
fi

info "Updating apt & installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw

info "Installing Docker (if not already present)"
if ! command -v docker &>/dev/null; then
	curl -fsSL https://get.docker.com | sh
fi
# Compose plugin (usually pulled in by get.docker.com, verify anyway)
if ! docker compose version &>/dev/null; then
	apt-get install -y -qq docker-compose-plugin
fi
systemctl enable --now docker
done_ "Docker $(docker --version | awk '{print $3}' | tr -d ,) ready"

info "Configuring ufw firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP (Caddy ACME + redirect)'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable
done_ "Firewall: 22/80/443 open, everything else denied"

info "Setting up 4GB swap (avoids OOM on pnpm build)"
if ! swapon --show | grep -q /swapfile; then
	fallocate -l 4G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile >/dev/null
	swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
	done_ "4GB swap active"
else
	done_ "Swap already configured"
fi

info "Cloning hermes-studio"
mkdir -p "$APP_DIR"
if [[ -d "${REPO_DIR}/.git" ]]; then
	(cd "$REPO_DIR" && git pull --ff-only)
else
	git clone "$REPO_URL" "$REPO_DIR"
fi
mkdir -p "$WORKSPACE_DIR"
chmod 755 "$WORKSPACE_DIR"

info "Preparing .env"
if [[ ! -f "${REPO_DIR}/.env" ]]; then
	cp "${REPO_DIR}/.env.example" "${REPO_DIR}/.env"
	warn "Created ${REPO_DIR}/.env from template — edit it with real secrets before starting"
else
	done_ ".env already exists (not overwriting)"
fi

cat <<EOF

$(done_ "Bootstrap complete.")

NEXT STEPS
──────────

1. Point Cloudflare DNS at this box (proxy mode: OFF initially):

     Type   Name                     Content              Proxy
     A      hermes-studio.com        $(curl -4 -s https://api.ipify.org)     OFF
     CNAME  www.hermes-studio.com    hermes-studio.com    OFF

   (Turn Cloudflare orange cloud ON only AFTER Caddy has issued the cert
   on first start. Leaving it ON now blocks the ACME HTTP-01 challenge.)

2. Fill in secrets:

     nano ${REPO_DIR}/.env

   Required:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
              HERMES_API_URL, HERMES_API_TOKEN, ANTHROPIC_API_KEY

3. Add callback URL in Supabase:

     Supabase → Auth → URL Configuration → Redirect URLs:
       https://hermes-studio.com/api/auth/callback

4. Start services:

     cd ${REPO_DIR}
     docker compose -f docker-compose.prod.yml up -d --build

   First build takes 5–10 minutes (downloads Node, installs pnpm deps,
   builds Vite bundles). Subsequent starts are instant.

5. Watch logs until Caddy shows "certificate obtained":

     docker compose -f docker-compose.prod.yml logs -f caddy

6. Open https://hermes-studio.com

Management commands:
  docker compose -f docker-compose.prod.yml ps            # status
  docker compose -f docker-compose.prod.yml logs -f web   # app logs
  docker compose -f docker-compose.prod.yml restart web   # app only
  docker compose -f docker-compose.prod.yml down          # stop all
  docker compose -f docker-compose.prod.yml pull && \\
    docker compose -f docker-compose.prod.yml up -d       # update

EOF
