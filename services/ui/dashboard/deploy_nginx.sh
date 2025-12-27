#!/usr/bin/env bash

set -euo pipefail

# Universal Nginx deploy script for Raspberry Pi (Debian/Ubuntu based)
# Modusauswahl beim Start:
#  1) Voller Rebuild: prüft/ installiert Dependencies (nginx, Node/npm), führt npm ci aus,
#     baut das Frontend und deployed + Nginx (aktiviert & reload).
#  2) Nur Website neu bauen: überspringt System/Node-Checks und npm ci, baut nur das Frontend
#     und deployed die statischen Dateien, dann Nginx reload.

# Defaults
SITE_NAME="ba-tap-dashboard"
SERVER_NAME="_"
LISTEN_PORT="80"
ENABLE_API_PROXY="true"
API_TARGET="http://127.0.0.1:8000"
WEB_ROOT="/var/www/dashboard"

# Auswahl: full|web
MODE=""

# Resolve project paths
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}"/../../.. && pwd)"
DASHBOARD_DIR="${SCRIPT_DIR}"
DIST_DIR="${DASHBOARD_DIR}/dist"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --site-name NAME          Nginx site name (default: ${SITE_NAME})
  --server-name NAME        server_name value (default: ${SERVER_NAME})
  --listen-port PORT        Port for nginx listen (default: ${LISTEN_PORT})
  --disable-api-proxy       Disable reverse proxy for /api (default: enabled)
  --api-target URL          Upstream for /api (default: ${API_TARGET})
  --web-root PATH           Target doc root for static files (default: ${WEB_ROOT})
  --help                    Show this help

Example:
  sudo $(basename "$0") --server-name _ --api-target http://127.0.0.1:8000
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-name) SITE_NAME="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --listen-port) LISTEN_PORT="$2"; shift 2 ;;
    --disable-api-proxy) ENABLE_API_PROXY="false"; shift 1 ;;
    --api-target) API_TARGET="$2"; shift 2 ;;
    --web-root) WEB_ROOT="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1
}

get_node_version() {
  if require_cmd node; then
    node -v 2>/dev/null | sed 's/^v//'
  fi
}

ask_mode() {
  local answer
  echo
  echo "Bitte Modus wählen:"
  echo "  [1] Voller Rebuild (prüfen/ installieren, npm ci, Build, Deploy)"
  echo "  [2] Nur Website neu bauen (nur Build & Deploy)"
  read -r -p "Auswahl [1/2]: " answer || true
  case "${answer}" in
    1)
      MODE="full"
      ;;
    2)
      MODE="web"
      ;;
    *)
      echo "Ungültige Auswahl" >&2
      exit 1
      ;;
  esac
  echo "Ausgewählter Modus: ${MODE}"
}

ensure_node_v22_or_newer() {
  if require_cmd node; then
    local current
    current="$(get_node_version || true)"
    if [[ -n "$current" ]] && dpkg --compare-versions "$current" ge "22.0.0"; then
      echo "Node.js $current bereits vorhanden (>=22). Überspringe Installation."
      return 0
    fi
  fi

  echo "Installiere/aktualisiere Node.js über NodeSource (22.x)..."
  install_pkg_if_missing curl
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

ensure_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Please run as root (use sudo)." >&2
    exit 1
  fi
}

install_pkg_if_missing() {
  local pkg="$1"
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg"
  fi
}

hash_sources() {
  find "${DASHBOARD_DIR}" \
    -path "${DASHBOARD_DIR}/node_modules" -prune -o \
    -path "${DASHBOARD_DIR}/dist" -prune -o \
    -type f \( -name "package.json" -o -name "package-lock.json" -o -name "vite.config.*" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.css" -o -name "*.scss" -o -name "*.html" \) \
    -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
}

needs_npm_install() {
  if [[ ! -d "${DASHBOARD_DIR}/node_modules" ]]; then
    return 0
  fi
  if [[ ! -f "${DASHBOARD_DIR}/node_modules/.last_lock_sha" ]]; then
    return 0
  fi
  local cur prev
  cur="$(sha256sum "${DASHBOARD_DIR}/package-lock.json" 2>/dev/null | awk '{print $1}')"
  prev="$(cat "${DASHBOARD_DIR}/node_modules/.last_lock_sha" 2>/dev/null || true)"
  [[ "$cur" != "$prev" ]]
}

write_lock_fingerprint() {
  sha256sum "${DASHBOARD_DIR}/package-lock.json" 2>/dev/null | awk '{print $1}' > "${DASHBOARD_DIR}/node_modules/.last_lock_sha" || true
}

deploy_needed() {
  local cur_hash prev_hash hash_file
  hash_file="/var/www/.${SITE_NAME}_source_sha"
  cur_hash="$(hash_sources)"
  if [[ -f "$hash_file" ]]; then
    prev_hash="$(cat "$hash_file" 2>/dev/null || true)"
  fi
  if [[ "$cur_hash" == "$prev_hash" ]] && [[ -d "${WEB_ROOT}" ]]; then
    echo "no"
  else
    echo "$cur_hash" > "$hash_file"
    echo "yes"
  fi
}

main() {
  ensure_root

  if ! require_cmd apt-get; then
    echo "This script expects a Debian-based system with apt-get." >&2
    exit 1
  fi

  ask_mode

  if [[ "${MODE}" == "full" ]]; then
    install_pkg_if_missing nginx
    ensure_node_v22_or_newer
    if ! require_cmd npm; then
      echo "Warnung: npm wurde nicht gefunden, sollte aber mit NodeSource-Nodejs mitkommen."
    fi
    cd "${DASHBOARD_DIR}"
    echo "Lockfile geändert oder node_modules fehlt -> npm ci"
    npm ci --no-audit --no-fund || {
      echo "npm ci fehlgeschlagen" >&2
      exit 1
    }
    write_lock_fingerprint
    echo "Baue Frontend (npm run build)"
    npm run build
    if [[ ! -d "${DIST_DIR}" ]]; then
      echo "Build failed: dist directory not found at ${DIST_DIR}" >&2
      exit 1
    fi
    mkdir -p "${WEB_ROOT}"
    rsync -a --delete --chown=www-data:www-data "${DIST_DIR}/" "${WEB_ROOT}/"
  else
    cd "${DASHBOARD_DIR}"
    echo "Nur Website neu bauen -> überspringe System-/Node-Prüfungen und npm ci"
    npm run build
    if [[ ! -d "${DIST_DIR}" ]]; then
      echo "Build failed: dist directory not found at ${DIST_DIR}" >&2
      exit 1
    fi
    mkdir -p "${WEB_ROOT}"
    rsync -a --delete --chown=www-data:www-data "${DIST_DIR}/" "${WEB_ROOT}/"
  fi

  local site_path="/etc/nginx/sites-available/${SITE_NAME}"
  local enabled_link="/etc/nginx/sites-enabled/${SITE_NAME}"

  cat > "${site_path}" <<NGINX
server {
    listen ${LISTEN_PORT};
    server_name ${SERVER_NAME};

    root ${WEB_ROOT};
    index index.html;

    location / {
        try_files \$uri /index.html;
    }
$(if [[ "${ENABLE_API_PROXY}" == "true" ]]; then cat <<'PROXY'
    location /api/ {
        proxy_pass __API_TARGET__/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
PROXY
fi)
}
NGINX

  if [[ "${ENABLE_API_PROXY}" == "true" ]]; then
    sed -i "s#__API_TARGET__#${API_TARGET}#g" "${site_path}"
  fi

  ln -sf "${site_path}" "${enabled_link}"
  [[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  echo
  echo "Deployment complete."
  echo "- Site: ${SITE_NAME}"
  echo "- Root: ${WEB_ROOT}"
  echo "- Listen: ${LISTEN_PORT}"
  echo "- Server name: ${SERVER_NAME}"
  [[ "${ENABLE_API_PROXY}" == "true" ]] && echo "- API proxy: ${API_TARGET}"
}

main "$@"
