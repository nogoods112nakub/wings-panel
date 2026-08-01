# Wings Panel

A self-hosted Game Server Management Platform inspired by the Pterodactyl architecture, featuring a Panel (FastAPI), a Daemon (Wings, Go), and a Next.js Frontend.

**Wings Panel × Pterodactyl Panel © 2026 — Not affiliated with Pterodactyl.**

## Features

- **JWT Authentication** - Register/login with role-based access (admin/user)
- **Node Management** - Register daemon hosts, health checks, allocate ports
- **Server Deployment** - Deploy Docker game servers with CPU/memory/disk limits
- **Power Controls** - Start, stop, kill, restart containers
- **Real-time Console** - WebSocket-based log streaming and command input
- **File Manager** - Browse, edit, create, delete files on game servers
- **Resource Monitoring** - Live CPU, memory, and disk usage stats
- **Allocation System** - Batch IP:port allocation across nodes
- **Activity Log** - Track recent actions across the panel
- **API Keys** - Token-based access for external automation

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│    Panel     │────▶│    Daemon    │
│  (Next.js)   │     │  (FastAPI)   │     │   (Go/Wings) │
│  port 3000   │     │  port 8000   │     │  port 8080   │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                     ┌──────▼───────┐     ┌──────▼───────┐
                     │  PostgreSQL  │     │    Docker    │
                     │  port 5432   │     │   Engine     │
                     └──────────────┘     └──────────────┘
```

## Quick Start

### 1. Run the installer

```bash
./install.sh
```

Pick an option from the menu, or use a command directly:

```bash
./install.sh install       # full stack (db, panel, frontend, daemon)
./install.sh panel         # panel only (db, panel, frontend)
./install.sh daemon        # daemon only
./install.sh update        # rebuild and restart everything
./install.sh uninstall     # stop and remove all services
```

The installer detects your OS and will install missing prerequisites
(Docker, Docker Compose) automatically when you approve.

> **Linux only.** The installer supports Linux distributions only (Ubuntu,
> Debian, Fedora, Arch, Alpine, openSUSE, etc.). macOS and other platforms
> are not supported.

> **Docker permission denied?** If you see `permission denied ... /var/run/docker.sock`,
> your user is not in the `docker` group. The installer will detect this and offer to
> fix it for you (`sudo usermod -aG docker $USER`), then re-run itself under `sudo`.
> To fix it manually:
>
> ```bash
> sudo usermod -aG docker $USER
> sudo systemctl start docker
> # then log out and back in (or run: sudo ./install.sh install)
> ```

Set `HOST_SERVERS_DIR` beforehand to change where game server files live:

```bash
export HOST_SERVERS_DIR="$(pwd)/servers"
```

### 2. Access the panel

- **Frontend**: http://localhost:3000 (or :3001 when using docker-compose)
- **Panel API**: http://localhost:8000/docs
- **Default login**: `admin` / `admin12345`

## Setup Instructions

### Windows (PowerShell)
```powershell
$env:HOST_SERVERS_DIR = "$(Get-Location)\servers"
docker-compose up --build
```

### Linux (Bash)
```bash
export HOST_SERVERS_DIR="$(pwd)/servers"
docker-compose up --build
```

## API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Sign in |
| GET | `/api/auth/me` | Current user info |
| POST | `/api/auth/settings` | Update profile/password |

### Nodes (Admin)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/nodes` | Register daemon node |
| GET | `/api/nodes` | List all nodes |
| GET | `/api/nodes/{id}` | Node details + allocations |
| DELETE | `/api/nodes/{id}` | Remove node |
| GET | `/api/nodes/{id}/ping` | Health check daemon |

### Allocations (Admin)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/allocations` | Batch create ports |
| GET | `/api/allocations` | List all allocations |
| DELETE | `/api/allocations/{id}` | Remove allocation |

### Servers
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/servers` | Create server |
| GET | `/api/servers` | List servers (user-scoped) |
| GET | `/api/servers/{id}` | Server details |
| PATCH | `/api/servers/{id}` | Update server |
| DELETE | `/api/servers/{id}` | Delete server |
| POST | `/api/servers/bulk/power` | Bulk power action |
| POST | `/api/servers/{id}/power` | Power action (start/stop/restart/kill) |
| GET | `/api/servers/{id}/stats` | Real-time stats |
| POST | `/api/servers/{id}/suspend` | Suspend server |
| POST | `/api/servers/{id}/unsuspend` | Unsuspend server |
| POST | `/api/servers/{id}/transfer` | Transfer server |
| POST | `/api/servers/{id}/reinstall` | Reinstall server |
| GET | `/api/servers/{id}/console/url` | Get console URL |
| POST | `/api/servers/{id}/console/start` | Open console (ttyd) |
| POST | `/api/servers/{id}/console/stop` | Close console (ttyd) |
| WS | `/api/servers/{uuid}/console` | Console WebSocket (daemon) |
| GET | `/api/servers/{id}/files/list` | List files |
| GET | `/api/servers/{id}/files/read` | Read file |
| POST | `/api/servers/{id}/files/write` | Write file |
| POST | `/api/servers/{id}/files/folder` | Create folder |
| POST | `/api/servers/{id}/files/rename` | Rename file/folder |
| DELETE | `/api/servers/{id}/files/delete` | Delete file |

### System (Admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/system/status` | Panel status overview |
| GET | `/api/system/health` | Health check |
| GET | `/api/system/nodes-summary` | Per-node resource summary |
| GET | `/api/system/docker-networks` | List Docker networks |
| POST | `/api/system/docker-build` | Build a Docker image from a Dockerfile |

### Activity & API Keys
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/activity` | List activity log entries |
| GET | `/api/keys` | List API keys |
| POST | `/api/keys` | Create API key |
| DELETE | `/api/keys/{id}` | Delete API key |

## Testing with curl

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}' | jq -r '.token')

# Register a node
curl -X POST http://localhost:8000/api/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Node Alpha","fqdn":"localhost","ip_address":"127.0.0.1","daemon_port":8080,"daemon_token":"secure_default_wings_api_key_123456"}'

# Create allocations
curl -X POST http://localhost:8000/api/allocations \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"node_id":1,"ip_address":"0.0.0.0","port_start":25565,"count":10}'

# Deploy a server
curl -X POST http://localhost:8000/api/servers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Minecraft Server","node_id":1,"primary_allocation_id":1,"docker_image":"itzg/minecraft-server","startup_command":"java -Xmx1024M -jar server.jar nogui"}'

# Deploy a ready-made demo server (no config needed)
curl -X POST http://localhost:8000/api/servers/demo \
  -H "Authorization: Bearer $TOKEN"
```

## What happens on first boot

On a fresh install the panel automatically sets everything up for you:

- **Admin account**: `admin` / `admin12345`
- **Primary Node**: registered and pointing at the daemon
- **Allocations**: 34 ready-to-use ports (Minecraft, Terraria, Source, Bedrock, RCON, Garry's Mod)
- **Demo Server**: a small `alpine:latest` demo server is deployed automatically (or click **Deploy Demo Server** on the empty Servers page anytime)

The top bar shows the logged-in user with an **ADMIN** badge plus **Sign Out**, **Report**, and **Donate** buttons, and the footer brand (`Wings Panel × Pterodactyl Panel © 2026`) is shown on every page.

## Env Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST_SERVERS_DIR` | `./servers` | Where game server files live on the host |
| `WINGS_PANEL_REPO` | `https://github.com/nogoods112nakub/wings-panel.git` | Repo used for downloads |
| `WINGS_PANEL_BRANCH` | `main` | Branch used for downloads |
| `DEMO_IMAGE` | `alpine:latest` | Image used for the auto demo server |
# about-no-web
# about-no-web
# about-no-web
