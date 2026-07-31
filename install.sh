#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$INSTALL_DIR"

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
    elif [ "$(uname -s)" = "Darwin" ]; then
        OS_ID="macos"; OS_NAME="macOS"
    else
        OS_ID="unknown"; OS_NAME="$(uname -s)"
    fi
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
        macos)
            : ;; # curl is built into macOS
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
        macos)
            if command -v brew &>/dev/null; then
                brew install --cask docker
            else
                fail "macOS requires Homebrew. Install it first: https://brew.sh/"
            fi ;;
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

preflight() {
    info "Checking prerequisites..."

    detect_os

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
    if ! docker network inspect pterodactyl-net &>/dev/null; then
        info "Creating Docker network: pterodactyl-net"
        docker network create pterodactyl-net 2>/dev/null || true
    fi
    ok "Docker network: pterodactyl-net"
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
    local panel_ready=false
    local daemon_ready=false
    local max_attempts=90

    info "Waiting for services to become healthy..."

    local frontend_port="${FRONTEND_PORT:-3001}"

    for i in $(seq 1 $max_attempts); do
        if [ "$mode" != "daemon" ] && ! $panel_ready; then
            if curl -sf http://localhost:8000/docs >/dev/null 2>&1; then
                panel_ready=true
                ok "Panel API ready (port 8000)"
            fi
        fi

        if [ "$mode" != "panel" ] && ! $daemon_ready; then
            if curl -sf http://localhost:8080/api/system >/dev/null 2>&1; then
                daemon_ready=true
                ok "Daemon API ready (port 8080)"
            fi
        fi

        if { [ "$mode" = "all" ] && $panel_ready && $daemon_ready; } \
            || { [ "$mode" = "panel" ] && $panel_ready; } \
            || { [ "$mode" = "daemon" ] && $daemon_ready; }; then
            break
        fi

        if [ "$i" -eq "$max_attempts" ]; then
            warn "Timed out waiting for services. Check logs with: $COMPOSE logs"
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
    echo "  install    Full install (db, panel, frontend, daemon)"
    echo "  panel      Install Panel only (db, panel, frontend)"
    echo "  daemon     Install Daemon only"
    echo "  update     Update images and restart"
    echo "  uninstall  Stop and remove all services (with confirmation)"
    echo "  help       Show this help"
    echo ""
    echo "With no command, an interactive menu is shown."
    exit 0
}

menu() {
    while true; do
        echo ""
        echo -e "${CYAN}  ┌──────────────────────────────────────────┐${NC}"
        echo -e "${CYAN}  │            Select an option              │${NC}"
        echo -e "${CYAN}  ├──────────────────────────────────────────┤${NC}"
        echo -e "${CYAN}  │  ${NC}1) Install (everything)                    ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}2) Install Panel only                     ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}3) Install Daemon only                    ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}4) Update                                ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}5) Uninstall                             ${CYAN}│${NC}"
        echo -e "${CYAN}  │  ${NC}0) Exit                                 ${CYAN}│${NC}"
        echo -e "${CYAN}  └──────────────────────────────────────────┘${NC}"
        read -rp "  Choice: " choice
        echo ""
        case "$choice" in
            1) stop_all; install_full; wait_for_services all; show_logs; summary ;;
            2) install_panel; wait_for_services panel; summary ;;
            3) install_daemon; wait_for_services daemon ;;
            4) update; summary ;;
            5) uninstall ;;
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

AUTO_YES=""
for _arg in "$@"; do
    case "$_arg" in
        -y|--yes) AUTO_YES="yes" ;;
    esac
done

case "${1:-menu}" in
    install)   stop_all; install_full; wait_for_services all; show_logs; summary ;;
    panel)     install_panel; wait_for_services panel; summary ;;
    daemon)    install_daemon; wait_for_services daemon ;;
    update)    update; summary ;;
    uninstall) uninstall ;;
    help|-h|--help) usage ;;
    menu|"")   menu ;;
    *)         warn "Unknown command: $1"; usage ;;
esac
