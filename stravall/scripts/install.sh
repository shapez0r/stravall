#!/usr/bin/env sh
# Installs a locally built stravall binary as a systemd service on any Linux
# host or VM.  Usage:  make build && sudo ./scripts/install.sh [path/to/stravall]
set -eu

BIN="${1:-./bin/stravall}"
[ -x "$BIN" ] || { echo "binary not found: $BIN (run 'make build' first)" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

install -m 0755 "$BIN" /usr/local/bin/stravall
install -d -m 0755 /etc/stravall
[ -f /etc/stravall/stravall.env ] || cat > /etc/stravall/stravall.env <<'ENV'
# stravall settings (see README). Restart the service after changes.
STRAVALL_ALLOW_SIGNUP=true
STRAVALL_SIGNUP_CIDRS=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,127.0.0.0/8,fc00::/7,fe80::/10,::1/128
STRAVALL_COOKIE_SECURE=false
# Browser key for the Google Maps JavaScript API (empty = offline pixel map).
STRAVALL_GOOGLE_MAPS_KEY=
STRAVALL_MAX_UPLOAD_MB=512
ENV
install -m 0644 "$(dirname "$0")/../deploy/systemd/stravall.service" /etc/systemd/system/stravall.service
systemctl daemon-reload
systemctl enable --now stravall
echo "stravall is running on port 8082. Data: /var/lib/stravall  Config: /etc/stravall/stravall.env"
