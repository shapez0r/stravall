#!/usr/bin/env sh
# Installs a locally built eurofish binary as a systemd service on any Linux
# host or VM.  Usage:  make build && sudo ./scripts/install.sh [path/to/eurofish]
set -eu

BIN="${1:-./bin/eurofish}"
[ -x "$BIN" ] || { echo "binary not found: $BIN (run 'make build' first)" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

install -m 0755 "$BIN" /usr/local/bin/eurofish
install -d -m 0755 /etc/eurofish
[ -f /etc/eurofish/eurofish.env ] || cat > /etc/eurofish/eurofish.env <<'ENV'
# eurofish settings (see README). Restart the service after changes.
EUROFISH_ALLOW_SIGNUP=true
EUROFISH_SIGNUP_CIDRS=192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,127.0.0.0/8,fc00::/7,fe80::/10,::1/128
EUROFISH_COOKIE_SECURE=false
ENV
install -m 0644 "$(dirname "$0")/../deploy/systemd/eurofish.service" /etc/systemd/system/eurofish.service
systemctl daemon-reload
systemctl enable --now eurofish
echo "eurofish is running on port 8080. Data: /var/lib/eurofish  Config: /etc/eurofish/eurofish.env"
