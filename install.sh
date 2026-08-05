#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

SCRIPT_ARGS=("$@")

AUTO_YES=""
SKIP_WAIT="${SKIP_WAIT:-}"
for _arg in "$@"; do
    case "$_arg" in
        -y|--yes) AUTO_YES="yes" ;;
        -s|--skip-wait|--no-wait) SKIP_WAIT="yes" ;;
    esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   Game Server Management Platform Installer   ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

as_root() {
    if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

confirm() {
    local msg="$1"
    if [ -n "${AUTO_YES:-}" ] || [ ! -t 0 ]; then return 0; fi
    local ans
    read -rp "$msg [Y/n] " ans
    case "$ans" in
        n|N|no) return 1 ;;
        *) return 0 ;;
    esac
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_NAME="${PRETTY_NAME:-$NAME}"
        [ -n "${OS_NAME:-}" ] || OS_NAME="$OS_ID"
    else
        OS_ID="unknown"; OS_NAME="$(uname -s)"
    fi

    case "$OS_ID" in
        macos)
            fail "Wings Panel installer supports Linux only (macOS is not supported)." ;;
        unknown|"")
            if [ "$(uname -s)" != "Linux" ]; then
                fail "Wings Panel installer supports Linux only. Detected: $OS_NAME"
            fi
            warn "Could not detect the Linux distribution; continuing with generic defaults." ;;
    esac

    ok "OS detected: $OS_NAME"
}

install_curl() {
    warn "curl not found, installing..."
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            as_root apt-get update -y
            as_root apt-get install -y curl ;;
        fedora|rhel|centos|rocky|almalinux)
            as_root dnf install -y curl ;;
        arch|manjaro)
            as_root pacman -S --noconfirm curl ;;
        alpine)
            as_root apk add --no-cache curl ;;
        opensuse*|suse)
            as_root zypper --non-interactive install curl ;;
        *)
            fail "curl is required. Install it manually for $OS_NAME." ;;
    esac
    ok "curl: $(curl --version | head -1)"
}

install_pkg_docker() {
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop)
            as_root apt-get update -y
            as_root apt-get install -y docker.io docker-compose-v2 ;;
        fedora|rhel|centos|rocky|almalinux)
            as_root dnf install -y docker docker-compose-plugin
            as_root systemctl enable --now docker 2>/dev/null || true ;;
        arch|manjaro)
            as_root pacman -S --noconfirm docker docker-compose
            as_root systemctl enable --now docker 2>/dev/null || true ;;
        alpine)
            as_root apk add --no-cache docker docker-compose
            as_root rc-update add docker default 2>/dev/null || true
            as_root service docker start 2>/dev/null || true ;;
        opensuse*|suse)
            as_root zypper --non-interactive install docker docker-compose
            as_root systemctl enable --now docker 2>/dev/null || true ;;
        *)
            warn "No package recipe for $OS_NAME, trying the official Docker install script..."
            as_root sh -c 'curl -fsSL https://get.docker.com | sh'
            return 0 ;;
    esac
}

install_docker() {
    warn "Docker is not installed."
    if ! confirm "Install Docker automatically for $OS_NAME?"; then
        fail "Docker is required. Install it first: https://docs.docker.com/engine/install/"
    fi
    install_pkg_docker
    if command -v systemctl &>/dev/null; then
        as_root systemctl start docker 2>/dev/null || true
    fi
    command -v docker &>/dev/null || fail "Docker install failed. Install it manually: https://docs.docker.com/engine/install/"
    ok "Docker installed: $(docker --version)"
}

install_compose() {
    warn "Docker Compose is not installed."
    if ! confirm "Install Docker Compose automatically?"; then
        fail "Docker Compose is required. Install it first: https://docs.docker.com/compose/install/"
    fi
    local url="https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)"
    as_root curl -fsSL "$url" -o /usr/local/bin/docker-compose
    as_root chmod +x /usr/local/bin/docker-compose
    COMPOSE="docker-compose"
    ok "Docker Compose installed: $(docker-compose --version)"
}

REPO_URL="${WINGS_PANEL_REPO:-https://github.com/nogoods112nakub/wings-panel.git}"
REPO_BRANCH="${WINGS_PANEL_BRANCH:-main}"

download_repo() {
    local dest="${1:-$INSTALL_DIR/wings-panel}"
    local repo_path="${REPO_URL#https://github.com/}"
    repo_path="${repo_path%.git}"

    if [ -d "$dest/.git" ]; then
        info "Updating existing Wings Panel in $dest..."
        if git -C "$dest" pull --ff-only >/dev/null 2>&1; then
            return 0
        fi
        warn "git pull failed; re-downloading a clean copy..."
        rm -rf "$dest"
    fi

    if command -v curl &>/dev/null; then
        info "Downloading Wings Panel from $REPO_URL (branch: $REPO_BRANCH)..."
        local tmpzip="/tmp/wings-panel-${RANDOM}.zip"
        local tmpext="/tmp/wings-panel-extract-${RANDOM}"
        curl -fsSL "https://codeload.github.com/$repo_path/zip/refs/heads/$REPO_BRANCH" -o "$tmpzip"
        command -v unzip &>/dev/null || fail "unzip is required to extract the download."
        mkdir -p "$tmpext" "$dest"
        unzip -q "$tmpzip" -d "$tmpext"
        shopt -s dotglob nullglob
        mv "$tmpext"/*/* "$dest"/ 2>/dev/null || mv "$tmpext"/*/*/* "$dest"/ 2>/dev/null
        shopt -u dotglob nullglob
        rm -rf "$tmpext" "$tmpzip"
    elif command -v git &>/dev/null; then
        info "curl not found, using git clone as fallback..."
        git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$dest"
    else
        fail "Need curl or git to download from GitHub."
    fi

    [ -f "$dest/docker-compose.yml" ] || fail "Download failed: docker-compose.yml not found in $dest."
    ok "Wings Panel downloaded to $dest"
}

# fetch_latest pulls the latest code from GitHub before installing.
# In a git checkout it updates in place; otherwise it downloads a fresh copy
# into ./wings-panel and re-runs the installer from there.
fetch_latest() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Pulling latest changes from GitHub (branch: $REPO_BRANCH)..."
        git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null \
            && ok "Code updated to latest" \
            || warn "git pull failed; using existing code."
    elif [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
        warn "Not a git checkout; skipping GitHub download and using local code."
    else
        download_repo "$INSTALL_DIR/wings-panel"
        info "Installing from the downloaded copy..."
        exec bash "$INSTALL_DIR/wings-panel/install.sh" "${SCRIPT_ARGS[@]}"
    fi
}

preflight() {
    info "Checking prerequisites..."

    detect_os

    if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
        if [ "${SCRIPT_ARGS[0]:-auto}" = "download" ]; then
            return 0
        fi
        warn "docker-compose.yml not found in $INSTALL_DIR."
        info "Auto-downloading Wings Panel from GitHub (branch: $REPO_BRANCH)..."
        download_repo "$INSTALL_DIR/wings-panel"
        info "Re-running the installer from the downloaded repo..."
        exec bash "$INSTALL_DIR/wings-panel/install.sh" "${SCRIPT_ARGS[@]}"
    fi

    if ! command -v curl &>/dev/null; then
        install_curl
    fi
    ok "curl: $(curl --version | head -1)"

    if ! command -v docker &>/dev/null; then
        install_docker
    else
        ok "Docker: $(docker --version)"
    fi

    if docker compose version &>/dev/null; then
        COMPOSE="docker compose"
    elif command -v docker-compose &>/dev/null; then
        COMPOSE="docker-compose"
    else
        install_compose
    fi
    ok "Docker Compose: $($COMPOSE version 2>/dev/null | head -1)"

    if ! docker info &>/dev/null; then
        warn "Cannot connect to the Docker daemon (permission denied on /var/run/docker.sock)."
        if [ "$(id -u)" -eq 0 ]; then
            fail "Docker socket is not accessible even as root. Make sure the Docker daemon is running: systemctl start docker"
        fi
        if groups 2>/dev/null | grep -qw docker; then
            fail "You are in the 'docker' group but the daemon socket is still blocked. Log out and back in, or start the daemon: sudo systemctl start docker"
        fi
        if confirm "Add user '$USER' to the 'docker' group so Docker works without sudo?"; then
            as_root usermod -aG docker "$USER" \
                || fail "Could not add '$USER' to the docker group."
            warn "'$USER' was added to the 'docker' group. A re-login is normally required."
            warn "Re-running the installer under sudo so the current session can access Docker now."
            exec sudo "$0" "$@"
        fi
        fail "Docker requires root access. Add yourself to the docker group (sudo usermod -aG docker \$USER, then log out/in) or run: sudo ./install.sh"
    fi
}

setup_env() {
    info "Setting up environment..."

    if [ -z "${HOST_SERVERS_DIR:-}" ]; then
        export HOST_SERVERS_DIR="$INSTALL_DIR/servers"
        warn "HOST_SERVERS_DIR not set, defaulting to: $HOST_SERVERS_DIR"
    fi

    mkdir -p "$HOST_SERVERS_DIR"
    ok "Server data directory: $HOST_SERVERS_DIR"
}

create_network() {
    if docker network inspect pterodactyl-net &>/dev/null; then
        local _lbl
        _lbl="$(docker network inspect pterodactyl-net --format '{{ index .Labels "com.docker.compose.network" }}' 2>/dev/null || true)"
        if [ -z "$_lbl" ]; then
            warn "Existing 'pterodactyl-net' has no Compose labels; removing it so Compose can create it correctly."
            docker network rm pterodactyl-net 2>/dev/null || fail "Could not remove stale network pterodactyl-net. Remove it manually: docker network rm pterodactyl-net"
        fi
    fi
    ok "Docker network: pterodactyl-net (created by Compose)"
}

stop_all() {
    info "Stopping any running services..."
    $COMPOSE down --remove-orphans 2>/dev/null || true
    ok "Stopped existing services"
}

install_full() {
    info "Building and starting all services..."
    info "This will take a few minutes on first run."
    echo ""
    $COMPOSE up --build -d
    echo ""
    ok "All services started"
}

install_panel() {
    info "Building and starting Panel services (db, panel, frontend)..."
    echo ""
    $COMPOSE up --build -d db panel frontend
    echo ""
    ok "Panel services started (daemon not included)"
}

install_daemon() {
    info "Building and starting the Daemon (Wings)..."
    echo ""
    $COMPOSE up --build -d --no-deps daemon
    echo ""
    ok "Daemon started (panel not included)"
}

update() {
    info "Updating images and rebuilding..."
    echo ""
    $COMPOSE build --pull 2>/dev/null || $COMPOSE pull
    $COMPOSE up -d --remove-orphans
    echo ""
    ok "Update complete"
}

uninstall() {
    local choice=""
    if [ "${AUTO_YES:-}" != "yes" ]; then
        echo -e "${RED}══════════════════════════════════════════════════${NC}"
        echo -e "${RED}  This will stop and remove ALL panel containers.${NC}"
        echo -e "${RED}  Docker volumes are NOT deleted unless you agree.${NC}"
        echo -e "${RED}══════════════════════════════════════════════════${NC}"
        read -rp "Type 'yes' to continue: " choice
        [ "$choice" = "yes" ] || { warn "Uninstall cancelled."; return; }
    fi

    stop_all

    echo -e ""
    info "Removing containers, networks and volumes..."
    $COMPOSE down -v 2>/dev/null || true
    ok "Volumes removed (server data wiped)"

    local keep=""
    if [ "${AUTO_YES:-}" != "yes" ]; then
        read -rp "Also delete the server data directory ($HOST_SERVERS_DIR)? [y/N] " keep
        case "$keep" in
            y|Y|yes) keep="yes" ;;
            *) keep="no" ;;
        esac
    else
        keep="no"
    fi
    if [ "$keep" = "yes" ]; then
        rm -rf "$HOST_SERVERS_DIR"
        ok "Deleted server data directory"
    else
        info "Keeping server data directory"
    fi

    echo -e ""
    info "Removing built panel images? This saves disk space."
    local rmimg=""
    if [ "${AUTO_YES:-}" != "yes" ]; then
        read -rp "Remove images? [y/N] " rmimg
    fi
    case "$rmimg" in
        y|Y|yes)
            $COMPOSE down --rmi all 2>/dev/null || true
            ok "Images removed"
            ;;
        *)
            info "Keeping images"
            ;;
    esac

    echo -e ""
    ok "Uninstall complete"
}

wait_for_services() {
    local mode="${1:-all}"

    if [ -n "$SKIP_WAIT" ]; then
        info "Skipping readiness wait (--skip-wait / SKIP_WAIT set)."
        return
    fi

    local panel_ready=false
    local daemon_ready=false
    local max_attempts=4
    local panel_port="${PANEL_PORT:-8000}"
    local daemon_port="${DAEMON_PORT:-8080}"
    local daemon_token="${DAEMON_TOKEN:-}"
    if [ -z "$daemon_token" ] && [ -f docker-compose.yml ]; then
        daemon_token="$(grep -oE 'DAEMON_TOKEN=[^ ]+' docker-compose.yml | head -1 | cut -d= -f2)"
    fi

    info "Waiting for services to become healthy..."

    local frontend_port="${FRONTEND_PORT:-3001}"

    for i in $(seq 1 $max_attempts); do
        if [ "$mode" != "daemon" ] && ! $panel_ready; then
            if curl -sf http://localhost:$panel_port/docs >/dev/null 2>&1; then
                panel_ready=true
                ok "Panel API ready (port $panel_port)"
            fi
        fi

        if [ "$mode" != "panel" ] && ! $daemon_ready; then
            if [ -n "$daemon_token" ] && curl -sf http://localhost:$daemon_port/api/system -H "X-Daemon-Token: $daemon_token" >/dev/null 2>&1; then
                daemon_ready=true
                ok "Daemon API ready (port $daemon_port)"
            fi
        fi

        if { [ "$mode" = "all" ] && $panel_ready && $daemon_ready; } \
            || { [ "$mode" = "panel" ] && $panel_ready; } \
            || { [ "$mode" = "daemon" ] && $daemon_ready; }; then
            break
        fi

        if [ "$i" -eq "$max_attempts" ]; then
            warn "Timed out waiting for services after ~${max_attempts}x3s. Continuing anyway — check logs later with: $COMPOSE logs"
            return
        fi
        sleep 3
    done
}

show_logs() {
    info "Checking service logs (last 5 lines each)..."
    echo ""
    for svc in db panel daemon frontend; do
        echo -e "${CYAN}--- $svc ---${NC}"
        $COMPOSE logs --tail=5 "$svc" 2>/dev/null || true
        echo ""
    done
}

summary() {
    local frontend_port="${FRONTEND_PORT:-3001}"
    local panel_port="${PANEL_PORT:-8000}"
    local daemon_port="${DAEMON_PORT:-8080}"
    local db_port="${DB_PORT:-5432}"

    local admin_user=""
    local admin_pass=""
    if curl -sf http://localhost:$panel_port/api/auth/login -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin12345"}' >/dev/null 2>&1; then
        admin_user="admin"
        admin_pass="admin12345"
    fi

    echo ""
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}           Installation Complete!${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo ""

    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}  URLs${NC}"
    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}Frontend:${NC}      http://localhost:${frontend_port}"
    echo -e "  ${CYAN}Panel API:${NC}     http://localhost:${panel_port}"
    echo -e "  ${CYAN}Panel Docs:${NC}    http://localhost:${panel_port}/docs"
    echo -e "  ${CYAN}Daemon API:${NC}    http://localhost:${daemon_port}"
    echo -e "  ${CYAN}PostgreSQL:${NC}    localhost:${db_port}"
    echo ""

    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    if [ -n "$admin_user" ]; then
        echo -e "  ${CYAN}  Default Admin Login${NC}"
        echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ${YELLOW}Username:${NC}      $admin_user"
        echo -e "  ${YELLOW}Password:${NC}      $admin_pass"
        echo -e "  ${YELLOW}Login at:${NC}      http://localhost:${frontend_port}"
    else
        echo -e "  ${YELLOW}  Admin account may already exist.${NC}"
        echo -e "  ${YELLOW}  Try login at:${NC} http://localhost:${frontend_port}"
    fi
    echo ""

    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}  Useful Commands${NC}"
    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "    $COMPOSE logs -f          View all logs"
    echo -e "    $COMPOSE ps               Service status"
    echo -e "    $COMPOSE stop             Stop all services"
    echo -e "    $COMPOSE down -v          Stop and delete volumes"
    echo -e "    $COMPOSE restart          Restart all services"
    echo ""

    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}  Daemon (Wings) Setup${NC}"
    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}Daemon API:${NC}     http://localhost:${daemon_port}"
    local daemon_token=""
    if [ -f docker-compose.yml ]; then
        daemon_token="$(grep -oE 'DAEMON_TOKEN=[^ ]+' docker-compose.yml | head -1 | cut -d= -f2)"
    fi
    if [ -n "$daemon_token" ]; then
        echo -e "  ${CYAN}Daemon Token:${NC}   $daemon_token"
    fi
    echo -e "  ${CYAN}Test daemon:${NC}    curl -s http://localhost:${daemon_port}/api/system -H \"X-Daemon-Token: <token>\""
    echo ""
    echo -e "  To register this node in the panel, create a Node in the"
    echo -e "  panel UI using the daemon address above and the same token."
    echo ""

    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${CYAN}  Service Status${NC}"
    echo -e "  ${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    $COMPOSE ps --format '{{.Name}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | while IFS=$'\t' read -r name status ports; do
        [ -z "$name" ] && continue
        case "$status" in
            Up*)
                echo -e "  ${GREEN}●${NC} $name  ${ports:-$status}"
                ;;
            *)
                echo -e "  ${RED}○${NC} $name  $status"
                ;;
        esac
    done
    echo ""

    echo -e "  ${YELLOW}Report bugs to:${NC} wingspanelsupport@gmail.com"
    echo ""
}

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  install    Pull latest from GitHub, then full install (db, panel, frontend, daemon)"
    echo "  panel      Install Panel only (db, panel, frontend)"
    echo "  daemon     Install Daemon only"
    echo "  update     Update images and restart"
    echo "  download   Download the source from GitHub (with docker-compose.yml)"
    echo "  menu       Show the interactive menu"
    echo "  uninstall  Stop and remove all services (with confirmation)"
    echo "  help       Show this help"
    echo ""
    echo "Env vars: WINGS_PANEL_REPO (default: $REPO_URL), WINGS_PANEL_BRANCH (default: $REPO_BRANCH)"
    echo "Flags: -y/--yes (no prompts), -s/--skip-wait (skip the readiness wait)"
    echo "       Env: SKIP_WAIT=1 also skips the readiness wait"
    echo ""
    echo "With no command: the first run downloads Wings Panel from GitHub and installs it."
    echo "Later runs show the management menu (reinstall / update / uninstall / logs)."
    echo "Use '$0 menu' at any time to show that menu."
    exit 0
}

# auto is the default action when no command is given.
# First run (no docker-compose.yml yet): download from GitHub, then install.
# Later runs: show the management menu (update / uninstall / reinstall / logs).
auto() {
    if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
        info "No existing installation found. Downloading Wings Panel from GitHub..."
        download_repo "$INSTALL_DIR/wings-panel"
        info "Installing from the downloaded copy..."
        exec bash "$INSTALL_DIR/wings-panel/install.sh" "${SCRIPT_ARGS[@]}"
    fi

    info "Existing installation detected."
    if $COMPOSE ps --format '{{.Name}}' 2>/dev/null | grep -q .; then
        info "Services are running."
    else
        info "Services are stopped."
    fi
    menu
}

menu() {
    if [ ! -t 0 ]; then
        warn "The interactive menu needs a terminal. Use a command instead: update, uninstall, panel, daemon, install, help"
        usage
    fi
    while true; do
        echo ""
        echo -e "${CYAN}  ┌──────────────────────────────────────────┐${NC}"
        echo -e "${CYAN}  │     Manage Wings Panel Installation     │${NC}"
        echo -e "${CYAN}  ├──────────────────────────────────────────┤${NC}"
        echo -e "${CYAN}  │  ${NC}1) Reinstall (pull + rebuild all)             ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}2) Install Panel only                     ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}3) Install Daemon only                    ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}4) Update images & restart                ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}5) Download from GitHub                  ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}6) Uninstall                             ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}7) Show service logs                      ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}0) Exit                                 ${CYAN}│${NC}"
        echo -e "${CYAN}  └──────────────────────────────────────────┘${NC}"
        read -rp "  Choice: " choice
        echo ""
        case "$choice" in
            1) fetch_latest; stop_all; install_full; wait_for_services all; show_logs; summary ;;
            2) install_panel; wait_for_services panel; summary ;;
            3) install_daemon; wait_for_services daemon ;;
            4) update; summary ;;
            5) download_repo; info "Next: run  ./wings-panel/install.sh  (or re-run this installer from that folder)" ;;
            6) uninstall ;;
            7) show_logs ;;
            0) info "Goodbye."; exit 0 ;;
            *) warn "Invalid choice: $choice" ;;
        esac
    done
}

trap 'echo -e "${RED}Operation interrupted.${NC}"; exit 1' INT TERM

banner
preflight
setup_env
create_network

_CMD="auto"
for _arg in "${SCRIPT_ARGS[@]}"; do
    case "$_arg" in
        -y|--yes|-s|--skip-wait|--no-wait) continue ;;
        -*) continue ;;
    esac
    _CMD="$_arg"
    break
done

case "$_CMD" in
    install)   fetch_latest; stop_all; install_full; wait_for_services all; show_logs; summary ;;
    panel)     install_panel; wait_for_services panel; summary ;;
    daemon)    install_daemon; wait_for_services daemon ;;
    update)    update; summary ;;
    download)  if [ -d "$INSTALL_DIR/wings-panel" ] && [ -f "$INSTALL_DIR/wings-panel/docker-compose.yml" ]; then
                   info "Already downloaded to $INSTALL_DIR/wings-panel"
               else
                   download_repo
               fi ;;
    uninstall) uninstall ;;
    help|-h|--help) usage ;;
    menu)      menu ;;
    auto|"")   auto ;;
    *)         warn "Unknown command: $1"; usage ;;
esac
