#!/usr/bin/env bash

set -euo pipefail

# ========================================
# BA-TAP Setup Script
# ========================================
# Zentrales Setup-Skript für das BA-TAP System
# Vereint API-Start und Dashboard-Deployment mit interaktivem Menü

# Farben für Output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Pfade
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"
API_DIR="${REPO_ROOT}/services/api"
DASHBOARD_DIR="${REPO_ROOT}/services/ui/dashboard"

# Konfiguration
API_PORT=8000
NGINX_PORT=80
API_TARGET="http://127.0.0.1:${API_PORT}"

# ========================================
# Hilfsfunktionen
# ========================================

print_header() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  BA-TAP Setup & Management${NC}"
  echo -e "${BLUE}========================================${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}[OK] $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}[WARNUNG] $1${NC}"
}

print_error() {
  echo -e "${RED}[FEHLER] $1${NC}"
}

print_info() {
  echo -e "${BLUE}[INFO] $1${NC}"
}

check_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    print_error "Dieses Skript muss mit sudo ausgeführt werden."
    echo "Bitte verwende: sudo $0"
    exit 1
  fi
}

is_api_running() {
  if lsof -Pi :${API_PORT} -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

is_nginx_running() {
  if systemctl is-active --quiet nginx 2>/dev/null; then
    return 0
  else
    return 1
  fi
}

is_api_autostart_enabled() {
  if systemctl is-enabled ba-tap-api.service >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

is_nginx_autostart_enabled() {
  if systemctl is-enabled nginx >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

interface_exists() {
  local iface="$1"
  ip link show "$iface" >/dev/null 2>&1
}

disable_ipv6_iface() {
  local dev="$1"
  if [[ -d "/proc/sys/net/ipv6/conf/${dev}" ]]; then
    sysctl -w "net.ipv6.conf.${dev}.disable_ipv6=1" >/dev/null 2>&1 || \
      print_warning "Konnte IPv6 auf ${dev} nicht deaktivieren"
  fi
}

# ========================================
# TAP-Bridge Funktionen
# ========================================

check_tap_bridge_status() {
  echo ""
  echo -e "${BLUE}=== TAP-Bridge Status (RT0 <-> RT2) ===${NC}"

  if ! interface_exists "br0"; then
    print_warning "Bridge br0 existiert NICHT. RT0/RT2 sind aktuell nicht gebridget."
    return 1
  fi

  if ip link show br0 | grep -q "state UP"; then
    print_success "Bridge br0 ist UP."
  else
    print_warning "Bridge br0 ist NICHT UP."
  fi

  for IFACE in RT0 RT2; do
    if interface_exists "${IFACE}"; then
      if ip -o link show "${IFACE}" | grep -q "master br0"; then
        print_success "${IFACE} ist Member von br0."
      else
        print_warning "${IFACE} ist NICHT Member von br0."
      fi

      if ip link show "${IFACE}" | grep -q "state UP"; then
        print_success "${IFACE} ist UP."
      else
        print_warning "${IFACE} ist NICHT UP."
      fi
    else
      print_error "Interface ${IFACE} existiert nicht."
    fi
  done

  echo ""
  echo -e "${BLUE}=== IP-Konfiguration (br0 / RT0 / RT2) ===${NC}"
  for DEV in br0 RT0 RT2; do
    if ! interface_exists "${DEV}"; then
      continue
    fi

    if ip -4 addr show dev "${DEV}" | grep -q "inet "; then
      print_warning "${DEV} hat eine IPv4-Adresse."
    else
      print_success "${DEV} hat KEINE IPv4-Adresse."
    fi

    if ip -6 addr show dev "${DEV}" | grep -q "inet6 "; then
      print_warning "${DEV} hat eine IPv6-Adresse."
    else
      print_success "${DEV} hat KEINE IPv6-Adresse."
    fi
  done

  echo ""
  echo -e "${BLUE}=== IPv6-Flags (disable_ipv6) ===${NC}"
  for DEV in br0 RT0 RT2; do
    if [[ -r "/proc/sys/net/ipv6/conf/${DEV}/disable_ipv6" ]]; then
      local val
      val=$(cat "/proc/sys/net/ipv6/conf/${DEV}/disable_ipv6")
      if [[ "${val}" == "1" ]]; then
        print_success "IPv6 ist für ${DEV} deaktiviert (disable_ipv6=1)."
      else
        print_warning "IPv6 ist für ${DEV} NICHT deaktiviert (disable_ipv6=${val})."
      fi
    fi
  done

  echo ""
  echo -e "${BLUE}=== Bridge Netfilter (bridge-nf) ===${NC}"
  for key in net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables net.bridge.bridge-nf-call-arptables; do
    local val
    val=$(sysctl -n "${key}" 2>/dev/null || echo "n/a")
    if [[ "${val}" == "0" ]]; then
      print_success "${key} = 0"
    else
      print_warning "${key} = ${val}"
    fi
  done

  echo ""
  echo -e "${BLUE}=== Gelerntes MAC-Forwarding (br0) ===${NC}"
  if bridge fdb show br0 2>/dev/null | grep -q " master br0"; then
    bridge fdb show br0 2>/dev/null | grep " master br0" || true
  else
    print_warning "Keine MAC-Einträge mit master br0 gefunden (möglicherweise noch kein Verkehr)."
  fi

  echo ""
}

setup_tap_bridge() {
  echo ""
  print_info "Richte TAP-Bridge (RT0 <-> RT2) ein..."

  # Prüfe, ob RT0/RT2 vorhanden sind
  for IFACE in RT0 RT2; do
    if ! interface_exists "${IFACE}"; then
      print_error "Interface ${IFACE} wurde nicht gefunden. Ist der Real-Time HAT korrekt initialisiert?"
      return 1
    fi
  done

  # Kernel-Module laden (falls nötig)
  print_info "Lade Kernel-Module für Bridge..."
  modprobe br_netfilter 2>/dev/null || print_warning "Konnte br_netfilter nicht laden (evtl. bereits geladen)."
  modprobe bridge 2>/dev/null || print_warning "Konnte bridge-Modul nicht laden (evtl. bereits geladen)."

  # Bridge erstellen (falls noch nicht vorhanden)
  if interface_exists "br0"; then
    print_warning "Bridge br0 existiert bereits – verwende bestehende Bridge."
  else
    ip link add name br0 type bridge
    print_success "Bridge br0 angelegt."
  fi

  # RT0/RT2 in die Bridge hängen
  ip link set RT0 master br0
  ip link set RT2 master br0

  # Interfaces aktivieren
  ip link set dev RT0 up
  ip link set dev RT2 up
  ip link set dev br0 up

  # IP-Adressen von TAP-Interfaces entfernen
  ip addr flush dev br0 || true
  ip addr flush dev RT0 || true
  ip addr flush dev RT2 || true

  # IPv6 auf den TAP-relevanten Interfaces deaktivieren
  disable_ipv6_iface br0
  disable_ipv6_iface RT0
  disable_ipv6_iface RT2

  # Bridge-NF deaktivieren (keine Paketinspection via iptables/nftables)
  for key in net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables net.bridge.bridge-nf-call-arptables; do
    sysctl -w "${key}=0" >/dev/null 2>&1 || \
      print_warning "Konnte ${key} nicht auf 0 setzen (evtl. nicht vorhanden)."
  done

  print_success "TAP-Bridge (br0 mit RT0/RT2) erfolgreich eingerichtet."
  echo ""
  print_info "Aktueller Zustand von br0:"
  ip addr show br0
  echo ""
}

teardown_tap_bridge() {
  echo ""
  print_info "Entferne TAP-Bridge (br0, RT0, RT2)..."

  # Falls br0 existiert: Ports loslösen und Bridge entfernen
  if interface_exists "br0"; then
    for IFACE in RT0 RT2; do
      if interface_exists "${IFACE}"; then
        ip link set "${IFACE}" nomaster 2>/dev/null || true
      fi
    done

    ip addr flush dev br0 || true
    ip link set dev br0 down || true
    ip link delete br0 type bridge 2>/dev/null || ip link delete br0 2>/dev/null || true
    print_success "Bridge br0 entfernt."
  else
    print_warning "Bridge br0 existiert nicht – nichts zu entfernen."
  fi

  # RT0/RT2 aufräumen (IPs flushen, ggf. IPv6 wieder aktivieren, Interface down)
  for IFACE in RT0 RT2; do
    if interface_exists "${IFACE}"; then
      ip addr flush dev "${IFACE}" || true
      ip link set dev "${IFACE}" down || true

      if [[ -d "/proc/sys/net/ipv6/conf/${IFACE}" ]]; then
        sysctl -w "net.ipv6.conf.${IFACE}.disable_ipv6=0" >/dev/null 2>&1 || \
          print_warning "Konnte IPv6 auf ${IFACE} nicht wieder aktivieren"
      fi
    else
      print_warning "Interface ${IFACE} existiert nicht (wird übersprungen)."
    fi
  done

  # Bridge-Netfilter-Settings wieder auf Standard (1) setzen
  for key in net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables net.bridge.bridge-nf-call-arptables; do
    sysctl -w "${key}=1" >/dev/null 2>&1 || \
      print_warning "Konnte ${key} nicht auf 1 zurücksetzen (evtl. nicht vorhanden)."
  done

  print_success "TAP-Bridge-Konfiguration wurde entfernt."
  echo ""
}

# ========================================
# Autostart Funktionen
# ========================================

setup_api_autostart() {
  print_info "Erstelle systemd Service für BA-TAP API..."
  
  SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || id -un)}"
  SERVICE_FILE="/etc/systemd/system/ba-tap-api.service"
  
  cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=BA-TAP API Service
After=network.target
Wants=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${REPO_ROOT}
Environment=PYTHONPATH=${REPO_ROOT}
ExecStart=${REPO_ROOT}/.venv/bin/python -m uvicorn services.api.main:app --host 0.0.0.0 --port ${API_PORT}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ba-tap-api

[Install]
WantedBy=multi-user.target
EOF

  # Service aktivieren
  systemctl daemon-reload
  systemctl enable ba-tap-api.service
  
  print_success "API Autostart konfiguriert"
}

setup_nginx_autostart() {
  print_info "Aktiviere Nginx Autostart..."
  
  systemctl enable nginx
  
  print_success "Nginx Autostart aktiviert"
}

setup_autostart() {
  print_info "Konfiguriere Autostart für BA-TAP Services..."
  
  setup_api_autostart
  echo ""
  setup_nginx_autostart
  echo ""
  
  print_success "Autostart für alle Services konfiguriert!"
  echo ""
  echo "Services werden automatisch beim Systemstart gestartet:"
  echo "  - BA-TAP API (ba-tap-api.service)"
  echo "  - Nginx (nginx.service)"
  echo ""
}

# ========================================
# Installation & Setup Funktionen
# ========================================

setup_api() {
  local reload_flag=""
  if [[ "${1:-}" == "--reload" ]]; then
    reload_flag="--reload"
  fi

  print_info "API Setup wird gestartet..."
  
  cd "${REPO_ROOT}"
  
  # Zeitzone auf Berlin setzen
  echo "Zeitzone wird auf Europe/Berlin gesetzt..."
  timedatectl set-timezone Europe/Berlin 2>/dev/null || {
    print_warning "Zeitzone konnte nicht gesetzt werden."
  }

  # Verzeichnisse anlegen
  SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || id -un)}"
  CAPTURE_DIR="${REPO_ROOT}/capture/exports"
  RUNTIME_DIR="${REPO_ROOT}/capture/tmp/test_runtime"
  PROFILES_DIR="${REPO_ROOT}/capture/profiles"
  
  mkdir -p "${CAPTURE_DIR}" "${RUNTIME_DIR}" "${PROFILES_DIR}"
  
  # Besitzer und Rechte setzen
  if [[ -d "${REPO_ROOT}/capture" ]]; then
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "${REPO_ROOT}/capture" 2>/dev/null || true
    chmod -R u+rwX,go+rX "${REPO_ROOT}/capture" || true
  fi
  
  # tcpdump ohne root erlauben
  if command -v tcpdump >/dev-null 2>&1; then
    TCPDUMP_BIN="$(command -v tcpdump)"
    if command -v getcap >/dev/null 2>&1; then
      if ! getcap "${TCPDUMP_BIN}" | grep -q "cap_net_raw,cap_net_admin=eip"; then
        setcap cap_net_raw,cap_net_admin=eip "${TCPDUMP_BIN}" 2>/dev/null || true
      fi
    fi
  fi
  
  # Python venv als normaler Benutzer anlegen
  if [[ ! -d .venv ]]; then
    print_info "Erstelle Python Virtual Environment..."
    sudo -u "${SERVICE_USER}" python3 -m venv .venv
  fi
  
  # Installiere Dependencies
  print_info "Installiere Python Dependencies..."
  sudo -u "${SERVICE_USER}" bash <<EOF
source .venv/bin/activate
python3 -m pip install -U pip -q
python3 -m pip install -r services/api/requirements.txt -q
EOF

  print_success "API Setup abgeschlossen"
}

setup_dashboard_full() {
  print_info "Dashboard Full Setup wird gestartet..."
  
  # Nginx installieren
  if ! command -v nginx >/dev/null 2>&1; then
    print_info "Installiere Nginx..."
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx
  fi
  
  # Node.js prüfen/installieren
  if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node -v 2>/dev/null | sed 's/^v//' || echo "0")
    if dpkg --compare-versions "$NODE_VERSION" ge "22.0.0"; then
      print_success "Node.js $NODE_VERSION bereits vorhanden"
    else
      install_nodejs
    fi
  else
    install_nodejs
  fi
  
  # npm Pakete installieren
  cd "${DASHBOARD_DIR}"
  print_info "Installiere npm Dependencies (npm ci)..."
  npm ci --no-audit --no-fund
  
  # Frontend bauen
  build_and_deploy_frontend
  
  # Nginx konfigurieren
  configure_nginx
  
  print_success "Dashboard Full Setup abgeschlossen"
}

install_nodejs() {
  print_info "Installiere Node.js 22.x..."
  if ! command -v curl >/dev/null 2>&1; then
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl
  fi
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
}

build_and_deploy_frontend() {
  cd "${DASHBOARD_DIR}"
  print_info "Baue Frontend (npm run build)..."
  npm run build
  
  DIST_DIR="${DASHBOARD_DIR}/dist"
  WEB_ROOT="/var/www/dashboard"
  
  if [[ ! -d "${DIST_DIR}" ]]; then
    print_error "Build fehlgeschlagen: dist Verzeichnis nicht gefunden"
    exit 1
  fi
  
  print_info "Deploye statische Dateien nach ${WEB_ROOT}..."
  mkdir -p "${WEB_ROOT}"
  rsync -a --delete --chown=www-data:www-data "${DIST_DIR}/" "${WEB_ROOT}/"
  
  print_success "Frontend Build & Deploy abgeschlossen"
}

configure_nginx() {
  SITE_NAME="ba-tap-dashboard"
  WEB_ROOT="/var/www/dashboard"
  
  print_info "Konfiguriere Nginx..."
  
  cat > "/etc/nginx/sites-available/${SITE_NAME}" <<'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/dashboard;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINX

  ln -sf "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
  [[ -e /etc/nginx/sites-enabled/default ]] && rm -f /etc/nginx/sites-enabled/default
  
  nginx -t
  systemctl enable nginx
  
  print_success "Nginx konfiguriert"
}

# ========================================
# Start Funktionen
# ========================================

start_api() {
  local reload_flag="${1:-}"
  
  if is_api_running; then
    print_warning "API läuft bereits auf Port ${API_PORT}"
    return 0
  fi
  
  print_info "Starte API auf Port ${API_PORT}..."
  
  SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || id -un)}"
  LOG_FILE="/var/log/ba-tap-api.log"
  
  cd "${REPO_ROOT}"
  
  # Starte API im Hintergrund als normaler Benutzer mit Log-Umleitung
  nohup sudo -u "${SERVICE_USER}" bash -c "
    source ${REPO_ROOT}/.venv/bin/activate
    export PYTHONPATH='${REPO_ROOT}'
    cd '${REPO_ROOT}'
    python3 -m uvicorn services.api.main:app --host 0.0.0.0 --port ${API_PORT} ${reload_flag}
  " > "${LOG_FILE}" 2>&1 &
  
  local api_pid=$!
  disown
  
  print_info "API wird gestartet (PID: ${api_pid})..."
  print_info "Logs: ${LOG_FILE}"
  
  # Warte länger und prüfe mehrmals ob API gestartet ist
  local max_attempts=10
  local attempt=0
  while [[ $attempt -lt $max_attempts ]]; do
    sleep 1
    if is_api_running; then
      print_success "API erfolgreich gestartet"
      return 0
    fi
    attempt=$((attempt + 1))
  done
  
  print_error "API konnte nicht innerhalb von ${max_attempts} Sekunden gestartet werden"
  print_info "Prüfe die Logs: tail -f ${LOG_FILE}"
  return 1
}

start_nginx() {
  if is_nginx_running; then
    print_warning "Nginx läuft bereits"
    return 0
  fi
  
  print_info "Starte Nginx..."
  systemctl start nginx
  
  if is_nginx_running; then
    print_success "Nginx erfolgreich gestartet"
  else
    print_error "Nginx konnte nicht gestartet werden"
    return 1
  fi
}

restart_nginx() {
  print_info "Starte Nginx neu..."
  systemctl restart nginx
  
  if is_nginx_running; then
    print_success "Nginx erfolgreich neu gestartet"
  else
    print_error "Nginx konnte nicht neu gestartet werden"
    return 1
  fi
}

# ========================================
# Stop Funktionen
# ========================================

stop_api() {
  if ! is_api_running; then
    print_warning "API läuft nicht"
    return 0
  fi
  
  print_info "Stoppe API..."
  
  # Finde alle Python-Prozesse, die uvicorn mit der API ausführen
  local pids
  pids=$(lsof -ti :${API_PORT} 2>/dev/null || true)
  
  if [[ -n "${pids}" ]]; then
    for pid in $pids; do
      print_info "Beende Prozess $pid..."
      kill -TERM "$pid" 2>/dev/null || true
    done
    
    # Warte bis zu 5 Sekunden auf sauberes Herunterfahren
    local max_attempts=5
    local attempt=0
    while [[ $attempt -lt $max_attempts ]]; do
      sleep 1
      if ! is_api_running; then
        print_success "API erfolgreich gestoppt"
        return 0
      fi
      attempt=$((attempt + 1))
    done
    
    # Falls noch läuft, force kill
    pids=$(lsof -ti :${API_PORT} 2>/dev/null || true)
    if [[ -n "${pids}" ]]; then
      print_warning "API reagiert nicht, erzwinge Beendigung..."
      for pid in $pids; do
        kill -9 "$pid" 2>/dev/null || true
      done
      sleep 1
    fi
  fi
  
  if ! is_api_running; then
    print_success "API gestoppt"
  else
    print_error "API konnte nicht gestoppt werden"
    return 1
  fi
}

stop_nginx() {
  if ! is_nginx_running; then
    print_warning "Nginx läuft nicht"
    return 0
  fi
  
  print_info "Stoppe Nginx..."
  systemctl stop nginx
  
  sleep 1
  
  if ! is_nginx_running; then
    print_success "Nginx erfolgreich gestoppt"
  else
    print_error "Nginx konnte nicht gestoppt werden"
    return 1
  fi
}

# ========================================
# Menü Funktionen
# ========================================

show_status() {
  echo ""
  echo -e "${BLUE}=== Aktueller Status ===${NC}"
  
  if is_api_running; then
    print_success "API läuft auf Port ${API_PORT}"
  else
    print_warning "API läuft NICHT"
  fi
  
  if is_nginx_running; then
    print_success "Nginx läuft"
  else
    print_warning "Nginx läuft NICHT"
  fi
  
  echo ""
  echo -e "${BLUE}=== Autostart Status ===${NC}"
  
  if is_api_autostart_enabled; then
    print_success "API Autostart ist AKTIVIERT"
  else
    print_warning "API Autostart ist NICHT aktiviert"
  fi
  
  if is_nginx_autostart_enabled; then
    print_success "Nginx Autostart ist AKTIVIERT"
  else
    print_warning "Nginx Autostart ist NICHT aktiviert"
  fi
  echo ""
}

show_menu() {
  print_header
  show_status
  
  echo -e "${BLUE}Bitte wähle eine Option:${NC}"
  echo ""
  echo "  [1] Komplett (neu) installieren"
  echo "      (API Setup + Dashboard Full Setup + Start)"
  echo ""
  echo "  [2] Nur Dashboard neu bauen"
  echo "      (Frontend Build & Deploy + Nginx Restart)"
  echo ""
  echo "  [3] Nur API/Backend neu bauen"
  echo "      (API Dependencies neu installieren + API neu starten)"
  echo ""
  echo "  [4] Services starten"
  echo "      (API + Nginx starten, falls nicht läuft)"
  echo ""
  echo "  [5] Services stoppen"
  echo "      (API + Nginx stoppen)"
  echo ""
  echo "  [6] Autostart konfigurieren"
  echo "      (API + Nginx für automatischen Start registrieren)"
  echo ""
  echo "  [7] Status anzeigen"
  echo ""
  echo "  [8] Software TAP-Bridge Status prüfen"
  echo "      (br0/RT0/RT2 Konfiguration prüfen)"
  echo ""
  echo "  [9] Software TAP-Bridge einrichten/aktualisieren"
  echo "      (RT0 <-> RT2 Bridge konfigurieren)"
  echo ""
  echo "  [10] Software TAP-Bridge entfernen"
  echo "       (br0/RT0/RT2 und zugehörige Einstellungen zurücksetzen)"
  echo ""
  echo "  [11] Beenden"
  echo ""
  read -r -p "Auswahl [1-11]: " choice
  
  case "${choice}" in
    1)
      option_full_install
      ;;
    2)
      option_rebuild_dashboard
      ;;
    3)
      option_rebuild_api
      ;;
    4)
      option_start_services
      ;;
    5)
      option_stop_services
      ;;
    6)
      option_setup_autostart
      ;;
    7)
      show_status
      echo ""
      read -r -p "Drücke Enter um fortzufahren..."
      show_menu
      ;;
    8)
      check_tap_bridge_status
      echo ""
      read -r -p "Drücke Enter um fortzufahren..."
      show_menu
      ;;
    9)
      setup_tap_bridge
      echo ""
      read -r -p "Drücke Enter um fortzufahren..."
      show_menu
      ;;
    10)
      teardown_tap_bridge
      echo ""
      read -r -p "Drücke Enter um fortzufahren..."
      show_menu
      ;;
    11)
      print_info "Beende..."
      exit 0
      ;;
    *)
      print_error "Ungültige Auswahl"
      sleep 2
      show_menu
      ;;
  esac
}

option_full_install() {
  echo ""
  print_info "Starte vollständige Neuinstallation..."
  echo ""
  
  setup_api
  echo ""
  setup_dashboard_full
  echo ""
  start_api
  echo ""
  start_nginx
  echo ""
  
  print_success "Installation abgeschlossen!"
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  BA-TAP erfolgreich installiert!      ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
  echo ""
  echo "Zugriff über:"
  echo "  Dashboard: http://$(hostname -I | awk '{print $1}'):${NGINX_PORT}"
  echo "  API Docs:  http://$(hostname -I | awk '{print $1}'):${API_PORT}/docs"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
}

option_rebuild_dashboard() {
  echo ""
  print_info "Baue Dashboard neu..."
  echo ""
  
  build_and_deploy_frontend
  echo ""
  restart_nginx
  echo ""
  
  print_success "Dashboard neu gebaut und deployed!"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
  show_menu
}

option_rebuild_api() {
  echo ""
  print_info "Baue API/Backend neu..."
  echo ""
  
  # API stoppen falls läuft
  if is_api_running; then
    print_info "Stoppe laufende API..."
    stop_api
    echo ""
  fi
  
  # API Dependencies neu installieren
  print_info "Installiere API Dependencies neu..."
  SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || id -un)}"
  
  cd "${REPO_ROOT}"
  
  # Korrigiere Berechtigungen des venv falls existiert
  if [[ -d .venv ]]; then
    print_info "Korrigiere Berechtigungen des virtual environment..."
    chown -R "${SERVICE_USER}:${SERVICE_USER}" .venv
  else
    # Erstelle neues venv mit richtigen Berechtigungen
    print_info "Erstelle neues virtual environment..."
    sudo -u "${SERVICE_USER}" python3 -m venv .venv
  fi
  
  # Installiere Dependencies
  sudo -u "${SERVICE_USER}" bash <<EOF
source .venv/bin/activate
python3 -m pip install -U pip -q
python3 -m pip install -r services/api/requirements.txt -q
EOF

  echo ""
  
  # API neu starten
  print_info "Starte API neu..."
  start_api
  echo ""
  
  print_success "API/Backend neu gebaut und gestartet!"
  echo ""
  echo "API läuft auf: http://$(hostname -I | awk '{print $1}'):${API_PORT}"
  echo "API Docs: http://$(hostname -I | awk '{print $1}'):${API_PORT}/docs"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
  show_menu
}

option_start_services() {
  echo ""
  print_info "Starte Services..."
  echo ""
  
  start_api
  echo ""
  start_nginx
  echo ""
  
  print_success "Services gestartet!"
  echo ""
  echo "Zugriff über:"
  echo "  Dashboard: http://$(hostname -I | awk '{print $1}'):${NGINX_PORT}"
  echo "  API Docs:  http://$(hostname -I | awk '{print $1}'):${API_PORT}/docs"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
  show_menu
}

option_stop_services() {
  echo ""
  print_info "Stoppe Services..."
  echo ""
  
  stop_api
  echo ""
  stop_nginx
  echo ""
  
  print_success "Services gestoppt!"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
  show_menu
}

option_setup_autostart() {
  echo ""
  print_info "Konfiguriere Autostart für BA-TAP Services..."
  echo ""
  
  # Prüfe aktuellen Status
  if is_api_autostart_enabled; then
    print_warning "API Autostart ist bereits aktiviert"
  else
    print_info "API Autostart wird konfiguriert..."
  fi
  
  if is_nginx_autostart_enabled; then
    print_warning "Nginx Autostart ist bereits aktiviert"
  else
    print_info "Nginx Autostart wird konfiguriert..."
  fi
  
  echo ""
  setup_autostart
  
  print_success "Autostart-Konfiguration abgeschlossen!"
  echo ""
  echo "Services werden beim nächsten Systemstart automatisch gestartet."
  echo ""
  echo "Zum Testen kannst du die Services jetzt starten:"
  echo "  systemctl start ba-tap-api.service"
  echo "  systemctl start nginx"
  echo ""
  
  read -r -p "Drücke Enter um fortzufahren..."
  show_menu
}

# ========================================
# Main
# ========================================

main() {
  check_root
  
  # Prüfe ob auf Linux/Debian-basiert
  if ! command -v apt-get >/dev/null 2>&1; then
    print_error "Dieses Skript benötigt ein Debian-basiertes System (z.B. Raspberry Pi OS)"
    exit 1
  fi
  
  # Prüfe und installiere lsof falls nicht vorhanden
  if ! command -v lsof >/dev/null 2>&1; then
    print_info "Installiere lsof..."
    apt-get update -y -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y lsof -qq
  fi
  
  show_menu
}

main "$@"
