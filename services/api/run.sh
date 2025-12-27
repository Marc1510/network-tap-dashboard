#!/usr/bin/env bash

set -euo pipefail

# Standardwerte
PORT=8000
RELOAD=false

# Verzeichnis: Repo-Root (zwei Ebenen über diesem Skript)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${REPO_ROOT}"

usage() {
  echo "Usage: $0 [-p PORT] [--reload]"
  echo "  -p, --port     Port (default: 8000)"
  echo "      --reload  Uvicorn Reload aktivieren"
}

# Argumente parsen
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port)
      PORT="$2"; shift 2;;
    --reload)
      RELOAD=true; shift;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unbekanntes Argument: $1" >&2
      usage; exit 1;;
  esac
done

# Zeitzone auf Berlin setzen (falls auf dem Server falsch eingestellt)
# ------------------------------------------------------------
echo "Zeitzone wird auf Europe/Berlin gesetzt..."
sudo timedatectl set-timezone Europe/Berlin || {
  echo "Warnung: Zeitzone konnte nicht gesetzt werden. Möglicherweise fehlen sudo-Rechte oder timedatectl ist nicht verfügbar."
}

# Verzeichnisse, Rechte und Fähigkeiten für tcpdump vorbereiten
# ------------------------------------------------------------
# Hinweis: SERVICE_USER kann von außen gesetzt werden, sonst aktueller Nutzer
SERVICE_USER="${SERVICE_USER:-$(id -un)}"

CAPTURE_DIR="${REPO_ROOT}/capture/exports"
RUNTIME_DIR="${REPO_ROOT}/capture/tmp/test_runtime"
PROFILES_DIR="${REPO_ROOT}/capture/profiles"

# Ordner anlegen
mkdir -p "${CAPTURE_DIR}" "${RUNTIME_DIR}" "${PROFILES_DIR}"

# Besitzer und Rechte setzen (rekursiv für gesamten capture-Bereich)
if [[ -d "${REPO_ROOT}/capture" ]]; then
  # chown kann Root erfordern – erst ohne sudo versuchen, dann mit sudo als Fallback
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "${REPO_ROOT}/capture" 2>/dev/null || sudo chown -R "${SERVICE_USER}:${SERVICE_USER}" "${REPO_ROOT}/capture" || true
  chmod -R u+rwX,go+rX "${REPO_ROOT}/capture" || true
fi

# tcpdump ohne root erlauben (cap_net_raw, cap_net_admin)
if command -v tcpdump >/dev/null 2>&1; then
  TCPDUMP_BIN="$(command -v tcpdump)"
  # Bereits gesetzte Caps prüfen
  if command -v getcap >/dev/null 2>&1; then
    if ! getcap "${TCPDUMP_BIN}" | grep -q "cap_net_raw,cap_net_admin=eip"; then
      # erst ohne sudo, dann mit sudo versuchen
      setcap cap_net_raw,cap_net_admin=eip "${TCPDUMP_BIN}" 2>/dev/null || sudo setcap cap_net_raw,cap_net_admin=eip "${TCPDUMP_BIN}" || true
    fi
  fi
fi

# Python venv anlegen/aktivieren
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate

# Nur installieren, wenn sich requirements geändert haben (Hash-Cache)
REQ_FILE="services/api/requirements.txt"
REQ_HASH_FILE=".venv/.requirements.hash"

compute_hash() {
  python3 - "$1" <<'PY'
import hashlib, sys
p = sys.argv[1]
with open(p, 'rb') as f:
    print(hashlib.sha256(f.read()).hexdigest())
PY
}

NEED_INSTALL=true
if [[ -f "$REQ_HASH_FILE" && -f "$REQ_FILE" ]]; then
  CURRENT_HASH="$(compute_hash "$REQ_FILE")"
  SAVED_HASH="$(cat "$REQ_HASH_FILE" 2>/dev/null || true)"
  if [[ "$CURRENT_HASH" == "$SAVED_HASH" ]]; then
    NEED_INSTALL=false
  fi
fi

if [[ "$NEED_INSTALL" == true ]]; then
  python3 -m pip install -U pip
  python3 -m pip install -r "$REQ_FILE"
  if [[ -f "$REQ_FILE" ]]; then
    compute_hash "$REQ_FILE" > "$REQ_HASH_FILE"
  fi
fi

export PYTHONPATH="${REPO_ROOT}"

ARGS=("services.api.main:app" "--host" "0.0.0.0" "--port" "${PORT}")
if [[ "${RELOAD}" == "true" ]]; then
  ARGS+=("--reload")
fi

exec python3 -m uvicorn "${ARGS[@]}"


