#!/usr/bin/env bash
# runtime/vm/bootstrap.sh - one-command bootstrap for a fresh Hetzner CX32 or Oracle Always-Free
# ARM box. STAGED: not run against any live host in this session (no VM exists yet - see
# ../../DEPLOY-RUNBOOK.md, this is the founder's one required action).
#
# What this does, in order:
#   1. Installs Docker Engine + the compose plugin (Debian/Ubuntu path; adjust for other distros).
#   2. Installs and brings up Tailscale for SSH/admin access (host-level, not a compose service -
#      Tailscale on the host, not sandboxed in a container, is how the blueprint's "Tailscale
#      (SSH/admin)" line is meant: it replaces exposing port 22 to the open internet).
#   3. Enables UFW, denies everything except Tailscale + Caddy's 80/443.
#   4. Copies .env.example to .env if missing (the operator fills in real values by hand or via a
#      secret manager - this script never writes a secret).
#   5. Runs `docker compose up -d`.
#
# Run as: sudo bash runtime/vm/bootstrap.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== Tamazia runtime VM bootstrap =="

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (sudo bash runtime/vm/bootstrap.sh)." >&2
  exit 1
fi

echo "-- Installing Docker Engine + compose plugin --"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "docker already installed, skipping"
fi

echo "-- Installing Tailscale (host-level SSH/admin access) --"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo "Run 'tailscale up' interactively to authenticate this box to the tailnet."
else
  echo "tailscale already installed, skipping"
fi

echo "-- Configuring UFW (deny by default, allow SSH-over-Tailscale + Caddy) --"
if command -v ufw >/dev/null 2>&1; then
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow in on tailscale0
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
else
  echo "ufw not found - install it manually (apt install ufw) before exposing this box to the internet." >&2
fi

echo "-- Installing fail2ban --"
if command -v apt-get >/dev/null 2>&1 && ! command -v fail2ban-client >/dev/null 2>&1; then
  apt-get update && apt-get install -y fail2ban
fi

echo "-- Preparing .env --"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "Created $SCRIPT_DIR/.env from .env.example - fill in real values before continuing."
  echo "Bootstrap stops here on first run so no service starts against placeholder secrets."
  exit 0
fi

echo "-- Bringing up the compose stack --"
cd "$SCRIPT_DIR"
docker compose --env-file .env up -d

echo "== Bootstrap complete. Check: docker compose ps, docker compose logs -f =="
