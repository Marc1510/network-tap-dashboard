# Network TAP Dashboard

Ein webbasiertes Monitoring- und Management-System für Network TAP (Test Access Point) Aufzeichnungen. Das System ermöglicht die Steuerung, Überwachung und Analyse von Netzwerkverkehr über eine moderne Weboberfläche.

## Projektbeschreibung

Das Network TAP Dashboard ist eine integrierte Lösung zur Verwaltung von Netzwerk-Traffic-Captures auf einem Raspberry Pi oder ähnlichen Linux-Systemen. Es kombiniert ein Python-basiertes Backend mit einer modernen React-Oberfläche und bietet:

- Webbasierte Steuerung von tcpdump-Captures
- Echtzeit-Überwachung laufender Aufzeichnungen
- Verwaltung von Test-Profilen und Konfigurationen
- Zeitgesteuerte Aufzeichnungen (Scheduler)
- Analyse und Download von Capture-Dateien
- System-Ressourcen-Monitoring
- SSH-Terminal-Integration
- Bridge-Konfiguration für TAP-Interfaces (RT0/RT2)

Das System wurde speziell für den Einsatz mit Real-Time HAT Hardware entwickelt und unterstützt die Konfiguration von Bridge-Interfaces zur transparenten Netzwerk-Überwachung.

## Systemanforderungen

- Debian-basiertes Linux-System (z.B. Raspberry Pi OS)
- Python 3.8 oder höher
- Node.js 22.x oder höher
- Root-Rechte für die Installation
- tcpdump installiert
- Nginx Webserver

## Installation

### 1. Repository klonen

```bash
git clone <repository-url>
cd network-tap-dashboard
```

### 2. Setup-Skript ausführen

Das Setup-Skript muss mit Root-Rechten (sudo) ausgeführt werden:

```bash
sudo ./setup.sh
```

Das interaktive Menü bietet folgende Optionen:

1. **Vollständige Neuinstallation** - Installiert und konfiguriert das gesamte System:
   - Erstellt Python Virtual Environment
   - Installiert Backend-Abhängigkeiten
   - Installiert Node.js 22.x (falls erforderlich)
   - Baut das Frontend
   - Konfiguriert Nginx
   - Startet alle Services

2. **Dashboard neu bauen** - Aktualisiert nur das Frontend
3. **API/Backend neu bauen** - Aktualisiert nur das Backend
4. **Services starten** - Startet API und Nginx
5. **Services stoppen** - Stoppt API und Nginx
6. **Services neu starten** - Startet Services neu
7. **Status anzeigen** - Zeigt Status aller Komponenten
8. **Autostart einrichten** - Konfiguriert systemd Services für automatischen Start
9. **TAP-Bridge einrichten** - Konfiguriert Bridge br0 für RT0/RT2 Interfaces
10. **TAP-Bridge Status** - Zeigt Bridge-Konfiguration und Status
11. **Beenden**

### 3. Erste Installation

Für eine Erstinstallation wähle Option 1 (Vollständige Neuinstallation). Das Skript wird:

- Alle erforderlichen Verzeichnisse anlegen (`capture/exports`, `capture/tmp/test_runtime`)
- Python Virtual Environment erstellen
- Backend-Abhängigkeiten installieren (FastAPI, uvicorn, etc.)
- Node.js und npm installieren
- Frontend bauen und deployen
- Nginx konfigurieren und starten
- API-Server starten

### 4. Zugriff auf das System

Nach erfolgreicher Installation ist das Dashboard erreichbar unter:

- **Dashboard**: `http://<raspberry-pi-ip>:80`
- **API Dokumentation**: `http://<raspberry-pi-ip>:8000/docs`

### 5. Autostart konfigurieren (optional)

Um das System beim Booten automatisch zu starten:

```bash
sudo ./setup.sh
# Wähle Option 8: Autostart einrichten
```

Dies erstellt systemd Services für:
- `ba-tap-api.service` - Backend API
- `nginx.service` - Webserver

## Projektstruktur

```
network-tap-dashboard/
├── setup.sh                      # Haupt-Setup-Skript mit interaktivem Menü
├── capture/                      # Verzeichnis für Captures und Konfigurationen
│   ├── exports/                  # Gespeicherte Capture-Dateien
│   │   └── captures_meta.jsonl   # Metadata aller Captures
│   ├── profiles/                 # Test-Profile (JSON)
│   │   ├── default.json
│   │   └── tsn-traffic.json
│   └── tmp/
│       └── test_runtime/         # Runtime-State für laufende Tests
├── services/
│   ├── api/                      # Python Backend (FastAPI)
│   │   ├── main.py               # API Einstiegspunkt
│   │   ├── config.py             # Konfiguration
│   │   ├── deps.py               # Dependency Injection
│   │   ├── schemas.py            # Pydantic Schemas
│   │   ├── profile_service.py    # Test-Profile Service
│   │   ├── ssh_service.py        # SSH-Terminal Service
│   │   ├── scheduling.py         # Zeitgesteuerte Tests
│   │   ├── requirements.txt      # Python Abhängigkeiten
│   │   ├── routes/               # API Endpunkte
│   │   │   ├── captures.py       # Capture-Verwaltung
│   │   │   ├── profiles.py       # Profile-Verwaltung
│   │   │   ├── tabs.py           # Test-Tab-Verwaltung
│   │   │   ├── ssh.py            # SSH-Terminal
│   │   │   ├── system.py         # System-Informationen
│   │   │   └── license.py        # Lizenz-Informationen
│   │   └── utils/                # Hilfsfunktionen
│   │       ├── capture_utils.py
│   │       ├── file_operations.py
│   │       ├── metadata.py
│   │       └── process_utils.py
│   ├── agent/                    # Test-Execution Agent
│   │   ├── test_manager.py       # Haupt-Test-Manager
│   │   ├── capture_manager.py    # tcpdump-Steuerung
│   │   ├── tab_manager.py        # Tab-Verwaltung
│   │   ├── run_executor.py       # Test-Ausführung
│   │   ├── process_manager.py    # Prozess-Lifecycle
│   │   └── filter_builder.py     # BPF-Filter-Generator
│   └── ui/
│       └── dashboard/            # React Frontend (Vite)
│           ├── package.json      # npm Abhängigkeiten
│           ├── vite.config.ts    # Vite Konfiguration
│           ├── index.html        # HTML Template
│           ├── src/
│           │   ├── main.tsx      # React Einstiegspunkt
│           │   ├── App.tsx       # Haupt-Komponente
│           │   ├── api/          # API Client
│           │   │   ├── client.ts
│           │   │   ├── captures.ts
│           │   │   ├── schedules.ts
│           │   │   └── system.ts
│           │   ├── components/   # React Komponenten
│           │   │   ├── CapturesList.tsx
│           │   │   ├── CaptureDetail.tsx
│           │   │   ├── TestStarter.tsx
│           │   │   ├── TestProfilesList.tsx
│           │   │   ├── Schedule.tsx
│           │   │   ├── SystemResources.tsx
│           │   │   ├── SshTerminal.tsx
│           │   │   └── common/
│           │   ├── hooks/        # React Hooks
│           │   ├── types/        # TypeScript Typen
│           │   └── utils/        # Hilfsfunktionen
│           └── dist/             # Gebautes Frontend (nach npm build)
└── README.md                     # Diese Datei
```

## Technologie-Stack

### Backend (API)

- **Framework**: FastAPI (Python)
- **ASGI Server**: Uvicorn
- **Validierung**: Pydantic v2
- **Scheduling**: APScheduler
- **SSH**: asyncssh
- **Prozess-Management**: psutil
- **Capture-Tool**: tcpdump

Die API läuft standardmäßig auf Port 8000 und bietet:
- RESTful API Endpunkte
- WebSocket Support für Echtzeit-Updates
- Automatische API-Dokumentation (OpenAPI/Swagger)
- Asynchrone Request-Verarbeitung

### Frontend (Dashboard)

- **Framework**: React 19
- **Build-Tool**: Vite 7
- **Sprache**: TypeScript
- **UI-Library**: Material-UI (MUI)
- **Icons**: Lucide React, MUI Icons
- **Terminal**: xterm.js
- **Routing**: React Router v6
- **State Management**: React Hooks

Das Frontend wird als statische Single-Page-Application (SPA) gebaut und von Nginx ausgeliefert.

### Webserver & Proxy

- **Nginx**: Reverse Proxy für API und statisches Hosting
  - Port 80: Dashboard (statische Dateien)
  - `/api/*` wird zu `http://127.0.0.1:8000/` weitergeleitet

### System-Integration

- **systemd**: Services für Autostart
- **tcpdump**: Netzwerk-Capture mit Capabilities (`cap_net_raw`, `cap_net_admin`)
- **Bridge-Utils**: Verwaltung von Linux-Bridge-Interfaces

## Verwendung

### Tests starten

1. Navigiere zu "Test starten" im Dashboard
2. Wähle ein Test-Profil oder erstelle eine neue Konfiguration
3. Konfiguriere:
   - Interface (z.B. eth0, RT0, RT2)
   - BPF-Filter (optional)
   - Ring-Buffer-Einstellungen
   - Stopp-Bedingungen
4. Starte den Test

### Test-Profile verwalten

- Test-Profile werden als JSON-Dateien in `capture/profiles/` gespeichert
- Profile können über das Dashboard erstellt, bearbeitet und gelöscht werden
- Jedes Profil enthält vordefinierte Capture-Einstellungen

### Captures verwalten

- Alle durchgeführten Tests erscheinen in "Aufzeichnungen"
- Captures können heruntergeladen werden (einzeln oder als ZIP)
- Metadaten werden automatisch erfasst (Start-/Endzeit, Interface, Filter, etc.)
- Status-Tracking für laufende und abgeschlossene Tests

### Zeitgesteuerte Tests

- Unter "Zeitplan" können Tests für bestimmte Zeitpunkte geplant werden
- Unterstützt einmalige und wiederkehrende Ausführungen
- Automatische Ausführung im Hintergrund

### System-Überwachung

- Dashboard zeigt Live-Informationen:
  - CPU-Auslastung
  - Speicher-Nutzung
  - Festplatten-Speicher
  - Netzwerk-Interfaces
  - Laufende Prozesse

### TAP-Bridge Konfiguration

Für transparente Netzwerk-Überwachung können RT0 und RT2 Interfaces gebridged werden:

```bash
sudo ./setup.sh
# Wähle Option 9: TAP-Bridge einrichten (RT0 <-> RT2)
```

Dies konfiguriert:
- Bridge-Interface `br0`
- RT0 und RT2 als Bridge-Mitglieder
- Deaktivierung von IPv6 und IP-Adressen auf TAP-Interfaces
- Bridge-Netfilter-Deaktivierung für transparenten L2-Traffic

Status prüfen:
```bash
sudo ./setup.sh
# Wähle Option 10: TAP-Bridge Status
```

## Entwicklung

### Backend-Entwicklung

```bash
# Virtual Environment aktivieren
source .venv/bin/activate

# API im Development-Modus starten (mit Auto-Reload)
cd /pfad/zum/projekt
export PYTHONPATH=$PWD
python -m uvicorn services.api.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend-Entwicklung

```bash
cd services/ui/dashboard

# Development-Server starten (mit Hot-Reload)
npm run dev

# Build für Produktion
npm run build
```

Der Development-Server läuft auf Port 5173 und proxied API-Requests an `http://localhost:8000`.

### API-Dokumentation

Die interaktive API-Dokumentation ist verfügbar unter:
- Swagger UI: `http://<ip>:8000/docs`
- ReDoc: `http://<ip>:8000/redoc`

## Logs und Fehlersuche

### API-Logs anzeigen

```bash
# Wenn API über systemd läuft
sudo journalctl -u ba-tap-api.service -f

# Wenn API manuell gestartet wurde
tail -f /var/log/ba-tap-api.log
```

### Nginx-Logs anzeigen

```bash
# Access Logs
sudo tail -f /var/log/nginx/access.log

# Error Logs
sudo tail -f /var/log/nginx/error.log
```

### Service-Status prüfen

```bash
# Via Setup-Skript
sudo ./setup.sh
# Wähle Option 7: Status anzeigen

# Oder manuell
sudo systemctl status ba-tap-api.service
sudo systemctl status nginx
```

## Wartung

### Services neu starten

```bash
sudo ./setup.sh
# Wähle Option 6: Services neu starten
```

### Backend-Updates einspielen

```bash
sudo ./setup.sh
# Wähle Option 3: API/Backend neu bauen
```

### Frontend-Updates einspielen

```bash
sudo ./setup.sh
# Wähle Option 2: Dashboard neu bauen
```

### Alte Captures aufräumen

Captures werden in `capture/exports/` gespeichert und sollten regelmäßig manuell aufgeräumt werden, um Speicherplatz freizugeben.

## Lizenz

Siehe LICENSE-Datei für Details.

## Unterstützung

Bei Problemen oder Fragen:
1. Prüfe die Logs (siehe Abschnitt "Logs und Fehlersuche")
2. Überprüfe den Service-Status mit dem Setup-Skript
3. Stelle sicher, dass alle Voraussetzungen erfüllt sind
