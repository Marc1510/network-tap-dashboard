# Network TAP Dashboard

A web-based monitoring and management system for Network TAP (Test Access Point) recordings. The system allows controlling, monitoring, and analyzing network traffic through a modern web interface.

## Project Description

The Network TAP Dashboard is an integrated solution for managing network traffic captures on a Raspberry Pi or similar Linux systems. It combines a Python-based backend with a modern React frontend and offers:

- Web-based control of tcpdump captures
- Real-time monitoring of active recordings
- Management of test profiles and configurations
- Scheduled recordings (scheduler)
- Analysis and downloading of capture files
- System resource monitoring
- SSH terminal integration
- Bridge configuration for TAP interfaces (RT0/RT2)

The system was specifically developed for use with Real-Time HAT hardware and supports the configuration of bridge interfaces for transparent network monitoring.

## System Requirements

- Debian-based Linux system (e.g., Raspberry Pi OS)
- Python 3.8 or higher
- Node.js 22.x or higher
- Root privileges for installation
- tcpdump installed
- Nginx web server

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd network-tap-dashboard
```

### 2. Run the Setup Script

The setup script must be executed with root privileges (sudo):

```bash
sudo ./setup.sh
```

The interactive menu provides the following options:

1. **Full Fresh Installation** - Installs and configures the entire system:
   - Creates a Python virtual environment
   - Installs backend dependencies
   - Installs Node.js 22.x (if required)
   - Builds the frontend
   - Configures Nginx
   - Starts all services

2. **Rebuild Dashboard** - Updates only the frontend
3. **Rebuild API/Backend** - Updates only the backend
4. **Start Services** - Starts API and Nginx
5. **Stop Services** - Stops API and Nginx
6. **Restart Services** - Restarts services
7. **Show Status** - Displays the status of all components
8. **Configure Autostart** - Configures systemd services for automatic startup
9. **Setup TAP Bridge** - Configures bridge br0 for RT0/RT2 interfaces
10. **TAP Bridge Status** - Displays bridge configuration and status
11. **Exit**

### 3. Initial Installation

For a first-time installation, select Option 1 (Full Fresh Installation). The script will:

- Create all required directories (`capture/exports`, `capture/tmp/test_runtime`)
- Create a Python virtual environment
- Install backend dependencies (FastAPI, uvicorn, etc.)
- Install Node.js and npm
- Build and deploy the frontend
- Configure and start Nginx
- Start the API server

### 4. Accessing the System

After a successful installation, the dashboard is accessible at:

- **Dashboard**: `http://<raspberry-pi-ip>:80`
- **API Documentation**: `http://<raspberry-pi-ip>:8000/docs`

### 5. Configure Autostart (Optional)

To automatically start the system during boot:

```bash
sudo ./setup.sh
# Select Option 8: Configure Autostart
```

This creates systemd services for:
- `ba-tap-api.service` - Backend API
- `nginx.service` - Webserver

## Project Structure

```
network-tap-dashboard/
├── setup.sh                      # Main setup script with interactive menu
├── capture/                      # Directory for captures and configurations
│   ├── exports/                  # Saved capture files
│   │   └── captures_meta.jsonl   # Metadata for all captures
│   ├── profiles/                 # Test profiles (JSON)
│   │   ├── default.json
│   │   └── tsn-traffic.json
│   └── tmp/
│       └── test_runtime/         # Runtime state for active tests
├── services/
│   ├── api/                      # Python backend (FastAPI)
│   │   ├── main.py               # API entry point
│   │   ├── config.py             # Configuration
│   │   ├── deps.py               # Dependency injection
│   │   ├── schemas.py            # Pydantic schemas
│   │   ├── profile_service.py    # Test profile service
│   │   ├── ssh_service.py        # SSH terminal service
│   │   ├── scheduling.py         # Scheduled tests
│   │   ├── requirements.txt      # Python dependencies
│   │   ├── routes/               # API endpoints
│   │   │   ├── captures.py       # Capture management
│   │   │   ├── profiles.py       # Profile management
│   │   │   ├── tabs.py           # Test tab management
│   │   │   ├── ssh.py            # SSH terminal
│   │   │   ├── system.py         # System information
│   │   │   └── license.py        # License information
│   │   └── utils/                # Helper functions
│   │       ├── capture_utils.py
│   │       ├── file_operations.py
│   │       ├── metadata.py
│   │       └── process_utils.py
│   ├── agent/                    # Test execution agent
│   │   ├── test_manager.py       # Main test manager
│   │   ├── capture_manager.py    # tcpdump control
│   │   ├── tab_manager.py        # Tab management
│   │   ├── run_executor.py       # Test execution
│   │   ├── process_manager.py    # Process lifecycle
│   │   └── filter_builder.py     # BPF filter generator
│   └── ui/
│       └── dashboard/            # React frontend (Vite)
│           ├── package.json      # npm dependencies
│           ├── vite.config.ts    # Vite configuration
│           ├── index.html        # HTML template
│           ├── src/
│           │   ├── main.tsx      # React entry point
│           │   ├── App.tsx       # Main component
│           │   ├── api/          # API client
│           │   │   ├── client.ts
│           │   │   ├── captures.ts
│           │   │   ├── schedules.ts
│           │   │   └── system.ts
│           │   ├── components/   # React components
│           │   │   ├── CapturesList.tsx
│           │   │   ├── CaptureDetail.tsx
│           │   │   ├── TestStarter.tsx
│           │   │   ├── TestProfilesList.tsx
│           │   │   ├── Schedule.tsx
│           │   │   ├── SystemResources.tsx
│           │   │   ├── SshTerminal.tsx
│           │   │   └── common/
│           │   ├── hooks/        # React hooks
│           │   ├── types/        # TypeScript types
│           │   └── utils/        # Helper functions
│           └── dist/             # Built frontend (after npm run build)
└── README.md                     # This file
```

## Technology Stack

### Backend (API)

- **Framework**: FastAPI (Python)
- **ASGI Server**: Uvicorn
- **Validation**: Pydantic v2
- **Scheduling**: APScheduler
- **SSH**: asyncssh
- **Process Management**: psutil
- **Capture Tool**: tcpdump

The API runs by default on port 8000 and offers:
- RESTful API endpoints
- WebSocket support for real-time updates
- Automatic API documentation (OpenAPI/Swagger)
- Asynchronous request processing

### Frontend (Dashboard)

- **Framework**: React 19
- **Build Tool**: Vite 7
- **Language**: TypeScript
- **UI Library**: Material-UI (MUI)
- **Icons**: Lucide React, MUI Icons
- **Terminal**: xterm.js
- **Routing**: React Router v6
- **State Management**: React Hooks

The frontend is built as a static Single Page Application (SPA) and is served by Nginx.

### Web Server & Proxy

- **Nginx**: Reverse proxy for API and static hosting
  - Port 80: Dashboard (static files)
  - `/api/*` is forwarded to `http://127.0.0.1:8000/`

### System Integration

- **systemd**: Services for autostart
- **tcpdump**: Network capture with capabilities (`cap_net_raw`, `cap_net_admin`)
- **Bridge-Utils**: Management of Linux bridge interfaces

## Usage

### Starting Tests

1. Navigate to "Start Test" in the dashboard.
2. Select a test profile or create a new configuration.
3. Configure:
   - Interface (e.g., eth0, RT0, RT2)
   - BPF Filter (optional)
   - Ring buffer settings
   - Stop conditions
4. Start the test.

### Managing Test Profiles

- Test profiles are saved as JSON files in `capture/profiles/`.
- Profiles can be created, edited, and deleted via the dashboard.
- Each profile contains predefined capture settings.

### Managing Captures

- All conducted tests appear in "Captures".
- Captures can be downloaded (individually or as a ZIP archive).
- Metadata is automatically recorded (start/end time, interface, filter, etc.).
- Status tracking for active and completed tests.

### Scheduled Tests

- Under "Schedule", tests can be scheduled for specific times.
- Supports both one-time and recurring executions.
- Automatic execution in the background.

### System Monitoring

- The dashboard displays live information:
  - CPU load
  - Memory usage
  - Disk space
  - Network interfaces
  - Running processes

### TAP Bridge Configuration

For transparent network monitoring, the RT0 and RT2 interfaces can be bridged:

```bash
sudo ./setup.sh
# Select Option 9: Setup TAP Bridge (RT0 <-> RT2)
```

This configures:
- Bridge interface `br0`
- RT0 and RT2 as bridge members
- Disabling of IPv6 and IP addresses on TAP interfaces
- Disabling of bridge netfilter for transparent Layer 2 traffic

To check status:
```bash
sudo ./setup.sh
# Select Option 10: TAP Bridge Status
```

## Development

### Backend Development

```bash
# Activate virtual environment
source .venv/bin/activate

# Start API in development mode (with auto-reload)
cd /path/to/project
export PYTHONPATH=$PWD
python -m uvicorn services.api.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend Development

```bash
cd services/ui/dashboard

# Start development server (with hot-reload)
npm run dev

# Build for production
npm run build
```

The development server runs on port 5173 and proxies API requests to `http://localhost:8000`.

### API Documentation

Interactive API documentation is available at:
- Swagger UI: `http://<ip>:8000/docs`
- ReDoc: `http://<ip>:8000/redoc`

## Logs and Troubleshooting

### View API Logs

```bash
# If API runs via systemd
sudo journalctl -u ba-tap-api.service -f

# If API was started manually
tail -f /var/log/ba-tap-api.log
```

### View Nginx Logs

```bash
# Access logs
sudo tail -f /var/log/nginx/access.log

# Error logs
sudo tail -f /var/log/nginx/error.log
```

### Check Service Status

```bash
# Via setup script
sudo ./setup.sh
# Select Option 7: Show Status

# Or manually
sudo systemctl status ba-tap-api.service
sudo systemctl status nginx
```

## Maintenance

### Restarting Services

```bash
sudo ./setup.sh
# Select Option 6: Restart Services
```

### Applying Backend Updates

```bash
sudo ./setup.sh
# Select Option 3: Rebuild API/Backend
```

### Applying Frontend Updates

```bash
sudo ./setup.sh
# Select Option 2: Rebuild Dashboard
```

### Cleaning Up Old Captures

Captures are saved in `capture/exports/` and should be cleaned up manually on a regular basis to free up disk space.

## License

See the LICENSE file for details.

## Support

For issues or questions:
1. Check the logs (see the "Logs and Troubleshooting" section).
2. Check the service status using the setup script.
3. Ensure that all system requirements are met.
