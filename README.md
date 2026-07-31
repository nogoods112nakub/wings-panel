# Pterodactyl-Inspired Game Server Management Platform

A self-hosted Game Server Management Platform inspired by the Pterodactyl architecture, featuring a Panel (Master), Daemon (Wings), and Next.js Frontend.

## Features

- **JWT Authentication** - Register/login with role-based access (admin/user)
- **Node Management** - Register daemon hosts, health checks, allocate ports
- **Server Deployment** - Deploy Docker game servers with CPU/memory/disk limits
- **Power Controls** - Start, stop, kill, restart containers
- **Real-time Console** - WebSocket-based log streaming and command input
- **File Manager** - Browse, edit, create, delete files on game servers
- **Resource Monitoring** - Live CPU, memory, and disk usage stats
- **Allocation System** - Batch IP:port allocation across nodes

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│    Panel     │────▶│    Daemon    │
│  (Next.js)   │     │  (FastAPI)   │     │  (FastAPI)   │
│  port 3000   │     │  port 8000   │     │  port 8080   │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                     ┌──────▼───────┐     ┌──────▼───────┐
                     │  PostgreSQL  │     │    Docker    │
                     │  port 5432   │     │   Engine     │
                     └──────────────┘     └──────────────┘
```

## Quick Start

### 1. Set environment variables

```bash
export HOST_SERVERS_DIR="$(pwd)/servers"
```

### 2. Start all services

```bash
docker-compose up --build
```

### 3. Access the panel

- **Frontend**: http://localhost:3000
- **Panel API**: http://localhost:8000/docs
- **Default login**: `admin` / `admin12345`

## Setup Instructions

### Windows (PowerShell)
```powershell
$env:HOST_SERVERS_DIR = "$(Get-Location)\servers"
docker-compose up --build
```

### Linux / macOS (Bash)
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
| POST | `/api/servers/{id}/power?action=` | Power action |
| GET | `/api/servers/{id}/stats` | Real-time stats |
| WS | `/ws/servers/{id}/console` | Console WebSocket |
| GET | `/api/servers/{id}/files/list` | List files |
| GET | `/api/servers/{id}/files/read` | Read file |
| POST | `/api/servers/{id}/files/write` | Write file |
| POST | `/api/servers/{id}/files/folder` | Create folder |
| DELETE | `/api/servers/{id}/files/delete` | Delete file |

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
  -d '{"name":"Minecraft Server","node_id":1,"primary_allocation_id":1,"docker_image":"ubuntu:20.04","startup_command":"while true; do echo tick; sleep 5; done"}'
```
# wings-panel
# wings-panel
# wings-panel
# wings-panel
