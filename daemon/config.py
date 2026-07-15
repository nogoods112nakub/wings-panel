import os

# Secure token used to authenticate incoming REST API and WebSocket requests from the Panel
DAEMON_TOKEN = os.getenv("DAEMON_TOKEN", "secure_default_wings_api_key_123456")

# Root directory on the host where all game server directories are stored
SERVERS_DIR = os.getenv("SERVERS_DIR", "/srv/daemon/servers")

# Docker socket or host URL. Defaults to standard Unix socket, fallback to Windows named pipe
DOCKER_URL = os.getenv("DOCKER_URL", "unix://var/run/docker.sock")

# Network bridge name used for Docker containers
DOCKER_NETWORK = os.getenv("DOCKER_NETWORK", "bridge")

# Ensure base servers directory exists
os.makedirs(SERVERS_DIR, exist_ok=True)
