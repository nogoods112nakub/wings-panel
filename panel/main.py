import os
import asyncio
import secrets
import uuid
import httpx
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from fastapi import FastAPI, Depends, HTTPException, status, Header, WebSocket, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from jose import jwt, JWTError
from passlib.hash import bcrypt

from panel.database import init_db, get_db, JWT_SECRET, JWT_ALGORITHM, JWT_EXPIRY_HOURS
from panel import models, schemas

security = HTTPBearer(auto_error=False)

PANEL_VERSION = "2.0.0"
DAEMON_TOKEN = os.getenv("DAEMON_TOKEN", "secure_default_wings_api_key_123456")
DAEMON_HOST = os.getenv("DAEMON_HOST", "daemon-node")
DAEMON_PORT = int(os.getenv("DAEMON_PORT", "8080"))
SERVER_MEMORY_MB = int(os.getenv("SERVER_MEMORY_MB", "16384"))
SERVER_CPU_COUNT = int(os.getenv("SERVER_CPU_COUNT", "4"))

PRECONFIGURED_ALLOCATIONS = [
    (25565, 10, "Minecraft Java"),
    (25575, 5, "Minecraft RCON"),
    (7777, 3, "Terraria"),
    (27015, 5, "Source Engine"),
    (25535, 3, "Bedrock Edition"),
    (27020, 3, "Garry's Mod"),
]


@asynccontextmanager
async def lifespan(app):
    init_db()
    run_startup_config()
    asyncio.create_task(_sync_all_server_statuses())
    asyncio.create_task(_run_due_schedules())
    yield


app = FastAPI(
    title="Wings Panel — Game Server Management",
    description="Self-hosted game server management panel built on Pterodactyl-inspired architecture. Wings Panel × Pterodactyl Panel © 2026.",
    version=PANEL_VERSION,
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def run_startup_config() -> bool:
    from panel.database import SessionLocal
    db = SessionLocal()
    try:
        fresh = create_default_admin(db)
        node = create_default_node(db)
        if node:
            create_default_allocations(db, node)
        return fresh
    finally:
        db.close()


def create_default_admin(db: Session) -> bool:
    admin = db.query(models.User).filter(models.User.username == "admin").first()
    if not admin:
        admin = models.User(
            username="admin",
            email="admin@panel.local",
            password_hash=bcrypt.hash("admin12345"),
            root_admin=True
        )
        db.add(admin)
        db.commit()
        print("[PANEL] Default admin created — admin / admin12345")
        return True
    else:
        print("[PANEL] Admin user exists, skipping")
        return False


def create_default_node(db: Session) -> models.Node:
    existing = db.query(models.Node).filter(models.Node.fqdn == DAEMON_HOST).first()
    if existing:
        print(f"[PANEL] Node '{DAEMON_HOST}' already registered")
        return existing

    node = models.Node(
        name="Primary Node",
        fqdn=DAEMON_HOST,
        ip_address=DAEMON_HOST,
        daemon_port=DAEMON_PORT,
        daemon_token=DAEMON_TOKEN,
        is_active=True,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    print(f"[PANEL] Default node created → {DAEMON_HOST}:{DAEMON_PORT}")
    return node


def create_default_allocations(db: Session, node: models.Node):
    existing_count = db.query(models.Allocation).filter(
        models.Allocation.node_id == node.id
    ).count()
    if existing_count > 0:
        print(f"[PANEL] Node already has {existing_count} allocations, skipping")
        return

    created = 0
    for port_start, count, label in PRECONFIGURED_ALLOCATIONS:
        for i in range(count):
            port = port_start + i
            dup = db.query(models.Allocation).filter(
                models.Allocation.node_id == node.id,
                models.Allocation.ip_address == "0.0.0.0",
                models.Allocation.port == port,
            ).first()
            if not dup:
                alloc = models.Allocation(
                    node_id=node.id,
                    ip_address="0.0.0.0",
                    port=port,
                )
                db.add(alloc)
                created += 1
    db.commit()
    print(f"[PANEL] {created} default allocations ready (Minecraft, Terraria, Source, Bedrock)")


# --- Activity Log Helper ---
def log_activity(db: Session, user_id: Optional[int] = None, server_id: Optional[int] = None,
                 action: str = "", detail: str = "", ip_address: Optional[str] = None):
    entry = models.ActivityLog(
        user_id=user_id,
        server_id=server_id,
        action=action,
        detail=detail,
        ip_address=ip_address,
    )
    db.add(entry)
    db.commit()


# --- Auth Helpers ---
def create_token(user_id: int, username: str) -> str:
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> models.User:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[models.User]:
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            return None
    except JWTError:
        return None
    return db.query(models.User).filter(models.User.id == user_id).first()


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.root_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


# =============================================================================
# CLOUDFLARE DNS ENDPOINTS
# =============================================================================
@app.get("/api/cloudflare/dns/list")
async def list_cloudflare_dns(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/cloudflare/dns/list")


@app.post("/api/cloudflare/dns/create")
async def create_cloudflare_dns(body: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/cloudflare/dns/create", method="POST", json_data=body)


@app.delete("/api/cloudflare/dns/delete/{record_id}")
async def delete_cloudflare_dns(record_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    try:
        return await call_daemon(node, f"/api/cloudflare/dns/delete/{record_id}", method="DELETE")
    except HTTPException:
        pass
    return Response(status_code=204)


# =============================================================================
# PLAYIT.GG TUNNEL ENDPOINTS
# =============================================================================
@app.get("/api/playit/tunnel/list")
async def list_playit_tunnels(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/playit/tunnel/list")


@app.post("/api/playit/tunnel/create")
async def create_playit_tunnel(body: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/playit/tunnel/create", method="POST", json_data=body)


@app.delete("/api/playit/tunnel/delete/{tunnel_id}")
async def delete_playit_tunnel(tunnel_id: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    try:
        return await call_daemon(node, f"/api/playit/tunnel/delete/{tunnel_id}", method="DELETE")
    except HTTPException:
        pass
    return Response(status_code=204)


def get_server_or_404(server_id: int, db: Session) -> models.Server:
    srv = db.query(models.Server).filter(models.Server.id == server_id).first()
    if not srv:
        raise HTTPException(status_code=404, detail="Server not found")
    return srv


def check_server_access(user: models.User, srv: models.Server, perm: Optional[str] = None):
    if user.root_admin or srv.owner_id == user.id:
        return
    member = None
    for m in srv.members:
        if m.user_id == user.id:
            member = m
            break
    if not member:
        raise HTTPException(status_code=403, detail="Access denied")
    if perm and not member.has_permission(perm):
        raise HTTPException(status_code=403, detail=f"Missing permission: {perm}")


def require_owner_or_root(user: models.User, srv: models.Server):
    if user.root_admin or srv.owner_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Only the server owner can perform this action")


# --- System Endpoints ---
@app.get("/api/system/status", response_model=schemas.SystemStatusResponse)
async def system_status(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    total_nodes = db.query(func.count(models.Node.id)).scalar() or 0
    active_nodes = db.query(func.count(models.Node.id)).filter(models.Node.is_active == True).scalar() or 0
    total_servers = db.query(func.count(models.Server.id)).scalar() or 0
    running_servers = db.query(func.count(models.Server.id)).filter(models.Server.status == "running").scalar() or 0
    total_allocations = db.query(func.count(models.Allocation.id)).scalar() or 0
    used_allocations = db.query(func.count(models.Allocation.id)).filter(models.Allocation.server_id.isnot(None)).scalar() or 0
    total_users = db.query(func.count(models.User.id)).scalar() or 0

    daemon_reachable = False
    daemon_version = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"http://{DAEMON_HOST}:{DAEMON_PORT}/api/system",
                headers={"X-Daemon-Token": DAEMON_TOKEN},
            )
            if resp.status_code == 200:
                daemon_reachable = True
                data = resp.json()
                daemon_version = data.get("version")
    except Exception:
        pass

    return schemas.SystemStatusResponse(
        panel_version=PANEL_VERSION,
        daemon_reachable=daemon_reachable,
        daemon_version=daemon_version,
        total_nodes=total_nodes,
        active_nodes=active_nodes,
        total_servers=total_servers,
        running_servers=running_servers,
        total_allocations=total_allocations,
        used_allocations=used_allocations,
        total_users=total_users,
    )


@app.get("/api/system/health")
async def system_health(db: Session = Depends(get_db)):
    daemon_reachable = False
    daemon_version = None
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"http://{DAEMON_HOST}:{DAEMON_PORT}/api/system",
                headers={"X-Daemon-Token": DAEMON_TOKEN},
            )
            if resp.status_code == 200:
                daemon_reachable = True
                data = resp.json()
                daemon_version = data.get("version")
    except Exception:
        pass

    return {
        "panel": "ok",
        "daemon": "ok" if daemon_reachable else "unreachable",
        "daemon_version": daemon_version,
    }


@app.get("/api/system/nodes-summary", response_model=List[schemas.NodeAllocationSummary])
def nodes_summary(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    nodes = db.query(models.Node).all()
    result = []
    for node in nodes:
        total = db.query(func.count(models.Allocation.id)).filter(
            models.Allocation.node_id == node.id
        ).scalar() or 0
        used = db.query(func.count(models.Allocation.id)).filter(
            models.Allocation.node_id == node.id,
            models.Allocation.server_id.isnot(None),
        ).scalar() or 0
        srv_count = db.query(func.count(models.Server.id)).filter(
            models.Server.node_id == node.id
        ).scalar() or 0
        result.append(schemas.NodeAllocationSummary(
            node_id=node.id,
            node_name=node.name,
            total_allocations=total,
            used_allocations=used,
            total_servers=srv_count,
        ))
    return result


@app.get("/api/system/docker-networks")
async def list_docker_networks(db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/system/networks")


@app.post("/api/system/docker-build")
async def build_docker_image(body: dict, db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/system/build", method="POST", json_data=body)


# --- Auth Endpoints ---
@app.post("/api/auth/register", response_model=schemas.TokenResponse, status_code=201)
def register(body: schemas.UserCreate, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    _check_login_throttle(db, body.username, ip)
    reg_setting = db.query(models.PanelSetting).filter(models.PanelSetting.key == "registration_enabled").first()
    if reg_setting and reg_setting.value == "false":
        raise HTTPException(status_code=403, detail="Registration is disabled by the administrator")
    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(models.User).filter(models.User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(
        username=body.username,
        email=body.email,
        password_hash=bcrypt.hash(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity(db, user_id=user.id, action="user.register", detail=f"User {user.username} registered")
    token = create_token(user.id, user.username)
    return schemas.TokenResponse(token=token, user=schemas.UserResponse.model_validate(user))


LOGIN_MAX_ATTEMPTS = 5
LOGIN_LOCKOUT_SECONDS = 600


def _login_attempt_count(db: Session, username: str, ip: str) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
    username_count = db.query(func.count(models.LoginAttempt.id)).filter(
        models.LoginAttempt.username == username,
        models.LoginAttempt.created_at >= cutoff,
    ).scalar()
    ip_count = db.query(func.count(models.LoginAttempt.id)).filter(
        models.LoginAttempt.ip_address == ip,
        models.LoginAttempt.created_at >= cutoff,
    ).scalar()
    return max(username_count, ip_count)


def _check_login_throttle(db: Session, username: str, ip: str) -> None:
    if _login_attempt_count(db, username, ip) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait 10 minutes.",
        )


def _record_login_failure(db: Session, username: str, ip: str) -> None:
    db.add(models.LoginAttempt(username=username, ip_address=ip))
    db.commit()


def _clear_login_throttle(db: Session, username: str, ip: str) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
    db.query(models.LoginAttempt).filter(
        or_(models.LoginAttempt.username == username, models.LoginAttempt.ip_address == ip),
        models.LoginAttempt.created_at >= cutoff,
    ).delete(synchronize_session=False)
    db.commit()


@app.post("/api/auth/login", response_model=schemas.TokenResponse)
def login(body: schemas.UserLogin, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    _check_login_throttle(db, body.username, ip)
    user = db.query(models.User).filter(models.User.username == body.username).first()
    if not user or not bcrypt.verify(body.password, user.password_hash):
        _record_login_failure(db, body.username, ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    _clear_login_throttle(db, body.username, ip)
    log_activity(db, user_id=user.id, action="user.login", detail=f"User {user.username} logged in")
    token = create_token(user.id, user.username)
    return schemas.TokenResponse(token=token, user=schemas.UserResponse.model_validate(user))


@app.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(user: models.User = Depends(get_current_user)):
    return user


# --- User Management (Admin) ---
@app.get("/api/users", response_model=List[schemas.UserResponse])
def list_users(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return db.query(models.User).order_by(models.User.id).all()


@app.post("/api/users", response_model=schemas.UserResponse, status_code=201)
def create_user(body: schemas.UserCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if db.query(models.User).filter(models.User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(models.User).filter(models.User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = models.User(
        username=body.username,
        email=body.email,
        password_hash=bcrypt.hash(body.password),
        root_admin=body.root_admin or False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_activity(db, user_id=admin.id, action="user.create", detail=f"Admin created user '{user.username}'")
    return user


@app.put("/api/users/{user_id}", response_model=schemas.UserResponse)
def update_user(user_id: int, body: schemas.UserUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.email is not None:
        existing = db.query(models.User).filter(models.User.email == body.email, models.User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = body.email
    if body.password and body.password.strip():
        user.password_hash = bcrypt.hash(body.password)
    if body.root_admin is not None:
        user.root_admin = body.root_admin
    db.commit()
    db.refresh(user)
    log_activity(db, user_id=admin.id, action="user.update", detail=f"Admin updated user '{user.username}'")
    return user


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    db.delete(user)
    db.commit()
    return None


@app.post("/api/users/{user_id}/reset-password")
def reset_password(user_id: int, body: schemas.UserPasswordReset, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = bcrypt.hash(body.password)
    db.commit()
    log_activity(db, user_id=admin.id, action="user.password_reset", detail=f"Admin reset password for '{user.username}'")
    return {"status": "success"}


# --- Node Endpoints (Admin) ---
@app.post("/api/nodes", response_model=schemas.NodeResponse, status_code=201)
def create_node(node: schemas.NodeCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if db.query(models.Node).filter(models.Node.fqdn == node.fqdn).first():
        raise HTTPException(status_code=400, detail="FQDN already registered")
    new_node = models.Node(**node.model_dump())
    db.add(new_node)
    db.commit()
    db.refresh(new_node)
    return new_node


@app.get("/api/nodes", response_model=List[schemas.NodeResponse])
def list_nodes(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return db.query(models.Node).all()


@app.get("/api/nodes/{node_id}", response_model=schemas.NodeDetailResponse)
def get_node(node_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@app.delete("/api/nodes/{node_id}", status_code=204)
def delete_node(node_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.servers:
        raise HTTPException(status_code=400, detail="Cannot delete node with active servers")
    db.delete(node)
    db.commit()
    return None


@app.get("/api/nodes/{node_id}/ping")
async def ping_node(node_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).filter(models.Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"http://{node.fqdn}:{node.daemon_port}/api/system",
                headers={"X-Daemon-Token": node.daemon_token}
            )
            if resp.status_code == 200:
                return {"status": "online", "data": resp.json()}
            return {"status": "error", "code": resp.status_code}
    except Exception as e:
        return {"status": "offline", "error": str(e)}


# --- Allocation Endpoints (Admin) ---
@app.post("/api/allocations", response_model=List[schemas.AllocationResponse], status_code=201)
def create_allocations(body: schemas.AllocationCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).filter(models.Node.id == body.node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    created = []
    for i in range(body.count):
        port = body.port_start + i
        dup = db.query(models.Allocation).filter(
            models.Allocation.node_id == body.node_id,
            models.Allocation.ip_address == body.ip_address,
            models.Allocation.port == port
        ).first()
        if dup:
            continue
        alloc = models.Allocation(node_id=body.node_id, ip_address=body.ip_address, port=port)
        db.add(alloc)
        created.append(alloc)
    db.commit()
    for a in created:
        db.refresh(a)
    return created


@app.get("/api/allocations", response_model=List[schemas.AllocationResponse])
def list_allocations(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return db.query(models.Allocation).all()


@app.delete("/api/allocations/{alloc_id}", status_code=204)
def delete_allocation(alloc_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    alloc = db.query(models.Allocation).filter(models.Allocation.id == alloc_id).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found")
    if alloc.server_id is not None:
        raise HTTPException(status_code=400, detail="Allocation is in use by a server")
    db.delete(alloc)
    db.commit()
    return None


# --- Internal Daemon Communication ---
async def call_daemon(node: models.Node, path: str, method: str = "GET", json_data: dict = None) -> dict:
    url = f"http://{node.fqdn}:{node.daemon_port}{path}"
    headers = {"X-Daemon-Token": node.daemon_token, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            if method.upper() == "POST":
                response = await client.post(url, json=json_data, headers=headers)
            elif method.upper() == "DELETE":
                response = await client.delete(url, headers=headers)
            elif method.upper() == "PUT":
                response = await client.put(url, json=json_data, headers=headers)
            else:
                response = await client.get(url, headers=headers)
            if response.status_code >= 400:
                detail = f"Daemon error: {response.text}"
                if response.status_code in (404, 405):
                    detail += " (this daemon version may not support the feature)"
                raise HTTPException(
                    status_code=response.status_code,
                    detail=detail
                )
            if not response.content:
                return {}
            try:
                return response.json()
            except Exception:
                return {"raw": response.text}
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Daemon unreachable at {url}: {exc}"
            )


# --- Server Endpoints ---
@app.post("/api/servers", response_model=schemas.ServerResponse, status_code=201)
async def create_server(server: schemas.ServerCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    node = db.query(models.Node).filter(models.Node.id == server.node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    docker_image = server.docker_image
    startup_command = server.startup_command or ""

    if not docker_image or not docker_image.strip():
        raise HTTPException(status_code=400, detail="Docker image is required")

    all_allocs = []
    primary_alloc = None
    primary_port = 0
    use_host_network = False

    if server.primary_allocation_id and server.primary_allocation_id != 0:
        primary_alloc = db.query(models.Allocation).filter(
            models.Allocation.id == server.primary_allocation_id,
            models.Allocation.node_id == server.node_id
        ).first()
        if not primary_alloc:
            raise HTTPException(status_code=404, detail="Primary allocation not found on node")
        if primary_alloc.server_id is not None:
            raise HTTPException(status_code=400, detail="Primary allocation is already in use")
        primary_port = primary_alloc.port
    else:
        use_host_network = True

    new_server = models.Server(
        name=server.name,
        description=server.description,
        owner_id=user.id,
        node_id=server.node_id,
        primary_allocation_id=server.primary_allocation_id if server.primary_allocation_id else None,
        cpu_limit=server.cpu_limit,
        memory_limit=server.memory_limit,
        disk_limit=server.disk_limit,
        docker_image=docker_image,
        docker_network=server.docker_network,
        startup_command=startup_command,
        env_vars=server.env_vars or {},
        status="installing"
    )
    db.add(new_server)
    db.flush()

    if primary_alloc:
        primary_alloc.server_id = new_server.id
        all_allocs.append(primary_alloc)

    for alloc_id in (server.allocation_ids or []):
        if primary_alloc is not None and alloc_id == primary_alloc.id:
            continue
        alloc = db.query(models.Allocation).filter(
            models.Allocation.id == alloc_id,
            models.Allocation.node_id == server.node_id
        ).first()
        if not alloc:
            db.rollback()
            raise HTTPException(status_code=404, detail=f"Allocation {alloc_id} not found on node")
        if alloc.server_id is not None:
            db.rollback()
            raise HTTPException(status_code=400, detail=f"Allocation {alloc_id} already in use")
        alloc.server_id = new_server.id
        all_allocs.append(alloc)

    db.commit()
    db.refresh(new_server)

    log_activity(db, user_id=user.id, server_id=new_server.id, action="server.create", detail=f"Server '{new_server.name}' created")

    daemon_payload = {
        "uuid": new_server.uuid,
        "docker_image": new_server.docker_image,
        "docker_network": new_server.docker_network,
        "cpu_limit": new_server.cpu_limit,
        "memory_limit": new_server.memory_limit,
        "disk_limit": new_server.disk_limit,
        "primary_port": primary_port,
        "allocations": [{"ip_address": a.ip_address, "port": a.port} for a in all_allocs],
        "startup_command": new_server.startup_command or "",
        "env": new_server.env_vars or {},
        "host_network": use_host_network,
    }

    try:
        resp = await call_daemon(node, "/api/servers", method="POST", json_data=daemon_payload)
        new_server.status = "installing"
    except HTTPException as e:
        new_server.status = "install_failed"
    db.commit()
    db.refresh(new_server)

    _fire_webhooks("server.created", {"server_id": new_server.id, "name": new_server.name, "uuid": new_server.uuid, "image": new_server.docker_image})

    asyncio.create_task(_poll_install_complete(new_server.id, node.id))

    return new_server


async def _poll_install_complete(server_id: int, node_id: int):
    from panel.database import SessionLocal
    for i in range(90):
        await asyncio.sleep(3)
        db = SessionLocal()
        try:
            srv = db.query(models.Server).filter(models.Server.id == server_id).first()
            if not srv:
                return
            node = db.query(models.Node).filter(models.Node.id == node_id).first()
            if not node:
                return
            try:
                install = await call_daemon(node, f"/api/servers/{srv.uuid}/install-status")
                exists = install.get("exists", False)
                if install.get("installing", False):
                    # Install still in progress (e.g. slow image pull); keep waiting.
                    continue
                if not exists:
                    if i > 5:
                        srv.status = "install_failed"
                        srv.installed = True
                        db.commit()
                        print(f"[POLL] Server {server_id} — container not found after {(i+1)*3}s, marked install_failed")
                        return
                    continue
                running = install.get("running", False)
                container_status = install.get("status", "")
                if running:
                    srv.status = "running"
                    srv.installed = True
                    db.commit()
                    print(f"[POLL] Server {server_id} install complete — running")
                    return
                elif container_status in ("exited", "dead"):
                    srv.status = "stopped"
                    srv.installed = True
                    db.commit()
                    print(f"[POLL] Server {server_id} installed but exited")
                    return
                elif container_status in ("created", "restarting"):
                    pass
            except Exception as e:
                print(f"[POLL] Server {server_id} daemon error (attempt {i+1}): {e}")
        finally:
            db.close()
    db = SessionLocal()
    try:
        srv = db.query(models.Server).filter(models.Server.id == server_id).first()
        if srv:
            srv.installed = True
            if srv.status == "installing":
                srv.status = "install_failed"
                print(f"[POLL] Server {server_id} install poll timed out — marked install_failed")
            else:
                print(f"[POLL] Server {server_id} install poll timed out — marked installed")
            db.commit()
    finally:
        db.close()


def _acquire_loop_lock(name: str):
    from panel.database import DATABASE_URL, engine
    if DATABASE_URL.startswith("postgres"):
        from sqlalchemy import text
        conn = engine.connect()
        try:
            row = conn.execute(text("SELECT pg_try_advisory_lock(hashtext(:n))"), {"n": name}).fetchone()
            if row and row[0]:
                return ("pg", conn)
        except Exception:
            pass
        conn.close()
        return None
    import fcntl, os
    fd = os.open(f"/tmp/wings_loop_{name}.lock", os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return ("file", fd)
    except OSError:
        os.close(fd)
        return None


def _release_loop_lock(lock):
    if not lock:
        return
    kind, handle = lock
    if kind == "pg":
        handle.close()
    else:
        import fcntl, os
        try:
            fcntl.flock(handle, fcntl.LOCK_UN)
        finally:
            os.close(handle)


async def _sync_all_server_statuses():
    from panel.database import SessionLocal
    lock = _acquire_loop_lock("status_sync")
    if lock is None:
        while True:
            await asyncio.sleep(60)
            lock = _acquire_loop_lock("status_sync")
            if lock is not None:
                break
    try:
        while True:
            await asyncio.sleep(10)
            db = SessionLocal()
            try:
                servers = db.query(models.Server).filter(models.Server.installed == True).all()
                for srv in servers:
                    if srv.status == "suspended":
                        continue
                    node = srv.node
                    if not node:
                        continue
                    try:
                        stats = await call_daemon(node, f"/api/servers/{srv.uuid}/resources")
                        daemon_status = stats.get("status", "")
                        status_map = {"running": "running", "exited": "stopped", "dead": "stopped", "created": "stopped"}
                        new_status = status_map.get(daemon_status)
                        if new_status and srv.status != new_status:
                            srv.status = new_status
                            db.commit()
                    except Exception:
                        pass
            finally:
                db.close()
    finally:
        _release_loop_lock(lock)


# --- Schedule Executor ---
CRON_POWER_ACTIONS = ("start", "stop", "kill", "restart")


def _cron_field_range(field: int):
    return {
        0: range(0, 60),
        1: range(0, 24),
        2: range(1, 32),
        3: range(1, 13),
        4: range(0, 7),
    }.get(field, range(0))


def _parse_cron(expr: str):
    parts = expr.split()
    if len(parts) != 5:
        return None
    fields = []
    for i, part in enumerate(parts):
        allowed = set(_cron_field_range(i))
        values = set()
        for token in part.split(","):
            token = token.strip()
            if not token:
                continue
            if token == "*":
                values.update(allowed)
            elif "/" in token:
                base, step = token.split("/", 1)
                try:
                    step = int(step)
                except ValueError:
                    continue
                rng = set(allowed) if base == "*" else _cron_range(base, i)
                values.update(x for x in sorted(rng) if x % step == 0)
            elif "-" in token:
                lo, _, hi = token.partition("-")
                try:
                    values.update(x for x in range(int(lo), int(hi) + 1) if x in allowed)
                except ValueError:
                    pass
            else:
                try:
                    v = int(token)
                    if v in allowed:
                        values.add(v)
                except ValueError:
                    pass
        fields.append(values)
    if any(not f for f in fields):
        return None
    return {"minute": fields[0], "hour": fields[1], "dom": fields[2], "month": fields[3], "dow": fields[4]}


def _cron_range(token: str, field: int):
    allowed = set(_cron_field_range(field))
    if "-" in token:
        lo, _, hi = token.partition("-")
        try:
            return {x for x in range(int(lo), int(hi) + 1) if x in allowed}
        except ValueError:
            return set()
    try:
        v = int(token)
        return {v} if v in allowed else set()
    except ValueError:
        return set()


def _cron_matches(dt, cron):
    return (
        dt.minute in cron["minute"]
        and dt.hour in cron["hour"]
        and dt.day in cron["dom"]
        and dt.month in cron["month"]
        and dt.weekday() in cron["dow"]
    )


def _next_cron(dt, cron):
    cur = dt.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(525600):
        if _cron_matches(cur, cron):
            return cur
        cur += timedelta(minutes=1)
    return None


async def _run_due_schedules():
    from panel.database import SessionLocal
    lock = _acquire_loop_lock("schedules")
    if lock is None:
        while True:
            await asyncio.sleep(60)
            lock = _acquire_loop_lock("schedules")
            if lock is not None:
                break
    try:
        while True:
            await asyncio.sleep(30)
            db = SessionLocal()
            try:
                now = datetime.now(timezone.utc)
                schedules = db.query(models.ServerSchedule).filter(models.ServerSchedule.is_active == True).all()
                for sched in schedules:
                    srv = sched.server
                    node = srv.node if srv else None
                    if not srv or not node:
                        continue
                    if sched.recurring and sched.recurring_pattern:
                        cron = _parse_cron(sched.recurring_pattern)
                        if not cron:
                            continue
                        if sched.scheduled_time is None:
                            sched.scheduled_time = _next_cron(now, cron)
                            db.commit()
                            continue
                        st = sched.scheduled_time
                        if st.tzinfo is None:
                            st = st.replace(tzinfo=timezone.utc)
                        if now >= st and (now - st) <= timedelta(minutes=5):
                            await _fire_schedule(db, sched, srv, node, now)
                    elif sched.scheduled_time is not None:
                        st = sched.scheduled_time
                        if st.tzinfo is None:
                            st = st.replace(tzinfo=timezone.utc)
                        if now >= st and (now - st) <= timedelta(seconds=120):
                            await _fire_schedule(db, sched, srv, node, now)
            finally:
                db.close()
    finally:
        _release_loop_lock(lock)


async def _fire_schedule(db, sched, srv, node, now):
    action = (sched.action or "").lower().strip()
    try:
        if action in CRON_POWER_ACTIONS:
            await call_daemon(node, f"/api/servers/{srv.uuid}/power", method="POST", json_data={"action": action})
            status_map = {"start": "running", "stop": "stopped", "kill": "stopped", "restart": "running"}
            srv.status = status_map.get(action, srv.status)
            db.commit()
            log_activity(db, user_id=None, server_id=srv.id, action=f"schedule.power.{action}",
                         detail=f"Scheduled {action} fired for '{srv.name}'")
        else:
            log_activity(db, user_id=None, server_id=srv.id, action="schedule.skip",
                         detail=f"Unsupported schedule action '{action}' on '{srv.name}'")
    except Exception as e:
        print(f"[SCHED] Schedule {sched.id} ({action}) failed for '{srv.name}': {e}")
    if sched.recurring and sched.recurring_pattern:
        cron = _parse_cron(sched.recurring_pattern)
        if cron:
            nxt = _next_cron(now, cron)
            if nxt:
                sched.scheduled_time = nxt
        db.commit()
    else:
        sched.is_active = False
        db.commit()


@app.get("/api/servers", response_model=List[schemas.ServerResponse])
def list_servers(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if user.root_admin:
        return db.query(models.Server).all()
    owned = db.query(models.Server).filter(models.Server.owner_id == user.id).all()
    member_server_ids = [m.server_id for m in db.query(models.ServerMember).filter(models.ServerMember.user_id == user.id).all()]
    if member_server_ids:
        member_servers = db.query(models.Server).filter(models.Server.id.in_(member_server_ids)).all()
        seen = {s.id for s in owned}
        owned.extend(s for s in member_servers if s.id not in seen)
    return owned


# --- Bulk Server Power Actions (must be before {server_id} routes) ---
@app.post("/api/servers/bulk/power")
async def bulk_power_action(body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    action = body.get("action", "").lower()
    if action not in ["start", "stop", "kill", "restart"]:
        raise HTTPException(status_code=400, detail="Invalid action")

    server_ids = body.get("server_ids", [])
    if not server_ids:
        raise HTTPException(status_code=400, detail="No server IDs provided")

    results = []
    for sid in server_ids:
        srv = db.query(models.Server).filter(models.Server.id == sid).first()
        if not srv:
            results.append({"server_id": sid, "status": "not_found"})
            continue
        if not user.root_admin and srv.owner_id != user.id:
            try:
                check_server_access(user, srv, perm="power")
            except HTTPException:
                results.append({"server_id": sid, "status": "access_denied"})
                continue
        try:
            node = srv.node
            if not node:
                results.append({"server_id": sid, "status": "no_node"})
                continue
            await call_daemon(node, f"/api/servers/{srv.uuid}/power", method="POST", json_data={"action": action})
            status_map = {"start": "running", "stop": "stopped", "kill": "stopped", "restart": "running"}
            srv.status = status_map.get(action, srv.status)
            db.commit()
            results.append({"server_id": sid, "status": "success"})
        except Exception as e:
            results.append({"server_id": sid, "status": "error", "error": str(e)})

    log_activity(db, user_id=user.id, action="server.bulk_power",
                 detail=f"Bulk {action} on {len(server_ids)} servers")

    return {"results": results}


@app.get("/api/servers/{server_id}", response_model=schemas.ServerResponse)
def get_server(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv)
    return srv


# --- Server Sharing / Members ---
def _require_owner_or_admin(user: models.User, srv: models.Server):
    if not user.root_admin and srv.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Admin or owner privileges required")


def _member_payload(member: models.ServerMember) -> dict:
    return {
        "id": member.id,
        "server_id": member.server_id,
        "user_id": member.user_id,
        "permissions": member.permissions,
        "username": member.user.username if member.user else "",
        "email": member.user.email if member.user else "",
        "root_admin": member.user.root_admin if member.user else False,
        "created_at": member.created_at,
    }


@app.get("/api/servers/{server_id}/members", response_model=List[schemas.ServerMemberResponse])
def list_server_members(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    _require_owner_or_admin(user, srv)
    return [_member_payload(m) for m in srv.members]


@app.post("/api/servers/{server_id}/members", response_model=schemas.ServerMemberResponse, status_code=201)
def add_server_member(server_id: int, body: schemas.ServerMemberCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    _require_owner_or_admin(user, srv)

    target = None
    if body.user_id:
        target = db.query(models.User).filter(models.User.id == body.user_id).first()
    elif body.username:
        target = db.query(models.User).filter(models.User.username == body.username).first()
    elif body.email:
        target = db.query(models.User).filter(models.User.email == body.email).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == srv.owner_id:
        raise HTTPException(status_code=400, detail="Server owner already has full access")

    member = db.query(models.ServerMember).filter(
        models.ServerMember.server_id == srv.id,
        models.ServerMember.user_id == target.id,
    ).first()
    if member:
        member.permissions = body.permissions
        db.commit()
        db.refresh(member)
    else:
        member = models.ServerMember(server_id=srv.id, user_id=target.id, permissions=body.permissions)
        db.add(member)
        db.commit()
        db.refresh(member)

    log_activity(db, user_id=user.id, server_id=srv.id, action="server.share",
                 detail=f"'{user.username}' shared '{srv.name}' with {target.username}")
    return _member_payload(member)


@app.post("/api/servers/{server_id}/members/{member_id}/permissions", response_model=schemas.ServerMemberResponse)
def update_server_member_permissions(server_id: int, member_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    _require_owner_or_admin(user, srv)
    member = db.query(models.ServerMember).filter(
        models.ServerMember.id == member_id,
        models.ServerMember.server_id == server_id,
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.permissions = body.get("permissions", member.permissions)
    db.commit()
    db.refresh(member)
    log_activity(db, user_id=user.id, server_id=srv.id, action="server.unshare_permissions",
                 detail=f"Updated permissions for {member.user.username if member.user else 'member'} on '{srv.name}'")
    return _member_payload(member)


@app.delete("/api/servers/{server_id}/members/{member_id}", status_code=204)
def remove_server_member(server_id: int, member_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    _require_owner_or_admin(user, srv)
    member = db.query(models.ServerMember).filter(
        models.ServerMember.id == member_id,
        models.ServerMember.server_id == server_id,
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    name = member.user.username if member.user else "member"
    db.delete(member)
    db.commit()
    log_activity(db, user_id=user.id, server_id=srv.id, action="server.unshare",
                 detail=f"Removed {name} from '{srv.name}'")
    return None


@app.patch("/api/servers/{server_id}", response_model=schemas.ServerResponse)
def update_server(server_id: int, body: schemas.ServerUpdate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    require_owner_or_root(user, srv)
    for key, val in body.model_dump(exclude_unset=True).items():
        if key == "status" and not user.root_admin:
            continue
        setattr(srv, key, val)
    db.commit()
    db.refresh(srv)
    return srv


@app.post("/api/servers/{server_id}/power")
async def send_power_action(server_id: int, action: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    action = action.lower()
    if action not in ["start", "stop", "kill", "restart"]:
        raise HTTPException(status_code=400, detail="Invalid action")

    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="power")

    node = srv.node
    response = await call_daemon(node, f"/api/servers/{srv.uuid}/power", method="POST", json_data={"action": action})

    status_map = {"start": "running", "stop": "stopped", "kill": "stopped", "restart": "running"}
    srv.status = status_map.get(action, srv.status)
    srv.installed = True
    db.commit()

    log_activity(db, user_id=user.id, server_id=srv.id, action=f"server.power.{action}", detail=f"Server '{srv.name}' {action} action dispatched")
    _fire_webhooks(f"server.power.{action}", {"server_id": srv.id, "name": srv.name, "uuid": srv.uuid})

    return {"message": f"Power action '{action}' dispatched", "daemon_response": response}


# --- Server Transfer (Pterodactyl-style) ---
@app.post("/api/servers/{server_id}/transfer")
async def transfer_server(server_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    if not user.root_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")

    target_node_id = body.get("node_id")
    if not target_node_id:
        raise HTTPException(status_code=400, detail="target node_id is required")

    target_node = db.query(models.Node).filter(models.Node.id == target_node_id).first()
    if not target_node:
        raise HTTPException(status_code=404, detail="Target node not found")

    if target_node.id == srv.node_id:
        raise HTTPException(status_code=400, detail="Server is already on this node")

    old_node = srv.node
    old_uuid = srv.uuid

    # Stop and delete container on old node
    try:
        await call_daemon(old_node, f"/api/servers/{old_uuid}", method="DELETE")
    except Exception:
        pass

    # Update server node
    srv.node_id = target_node.id
    srv.status = "installing"
    srv.installed = False
    db.commit()

    # Deploy on new node
    daemon_payload = {
        "uuid": srv.uuid,
        "docker_image": srv.docker_image,
        "docker_network": srv.docker_network,
        "cpu_limit": srv.cpu_limit,
        "memory_limit": srv.memory_limit,
        "disk_limit": srv.disk_limit,
        "primary_port": 0,
        "allocations": [],
        "startup_command": srv.startup_command or "",
        "host_network": True,
    }

    try:
        resp = await call_daemon(target_node, "/api/servers", method="POST", json_data=daemon_payload)
        srv.status = "installing"
    except HTTPException as e:
        srv.status = "install_failed"
    db.commit()

    log_activity(db, user_id=user.id, server_id=srv.id, action="server.transfer",
                 detail=f"Server '{srv.name}' transferred from node '{old_node.name}' to '{target_node.name}'")

    asyncio.create_task(_poll_install_complete(srv.id, target_node.id))

    return {"message": f"Server transfer initiated to node '{target_node.name}'"}


# --- Server Reinstall ---
@app.post("/api/servers/{server_id}/reinstall")
async def reinstall_server(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    if not user.root_admin and srv.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    node = srv.node
    if not node:
        raise HTTPException(status_code=400, detail="No node assigned")

    # Stop and remove existing container
    try:
        await call_daemon(node, f"/api/servers/{srv.uuid}", method="DELETE")
    except Exception:
        pass

    # Reset status
    srv.status = "installing"
    srv.installed = False
    db.commit()

    # Redeploy
    daemon_payload = {
        "uuid": srv.uuid,
        "docker_image": srv.docker_image,
        "docker_network": srv.docker_network,
        "cpu_limit": srv.cpu_limit,
        "memory_limit": srv.memory_limit,
        "disk_limit": srv.disk_limit,
        "primary_port": 0,
        "allocations": [],
        "startup_command": srv.startup_command or "",
        "env": srv.env_vars or {},
        "host_network": True,
    }

    try:
        await call_daemon(node, "/api/servers", method="POST", json_data=daemon_payload)
    except HTTPException:
        srv.status = "install_failed"
    db.commit()

    log_activity(db, user_id=user.id, server_id=srv.id, action="server.reinstall",
                 detail=f"Server '{srv.name}' reinstall initiated")

    asyncio.create_task(_poll_install_complete(srv.id, node.id))

    return {"message": "Server reinstall initiated"}


# --- Server Suspend/Unsuspend ---
@app.post("/api/servers/{server_id}/suspend")
async def suspend_server(server_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    srv = get_server_or_404(server_id, db)
    srv.status = "suspended"
    db.commit()

    # Stop container if running
    node = srv.node
    if node:
        try:
            await call_daemon(node, f"/api/servers/{srv.uuid}/power", method="POST", json_data={"action": "stop"})
        except Exception:
            pass

    log_activity(db, user_id=admin.id, server_id=srv.id, action="server.suspend",
                 detail=f"Server '{srv.name}' suspended by admin")
    return {"message": "Server suspended"}


@app.post("/api/servers/{server_id}/unsuspend")
async def unsuspend_server(server_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    srv = get_server_or_404(server_id, db)
    srv.status = "stopped"
    db.commit()

    log_activity(db, user_id=admin.id, server_id=srv.id, action="server.unsuspend",
                 detail=f"Server '{srv.name}' unsuspended by admin")
    return {"message": "Server unsuspended"}


# --- User Settings (Change Password) ---
@app.put("/api/auth/settings")
def update_user_settings(body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if "password" in body and body["password"]:
        if len(body["password"]) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        user.password_hash = bcrypt.hash(body["password"])
    if "email" in body and body["email"]:
        existing = db.query(models.User).filter(models.User.email == body["email"], models.User.id != user.id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = body["email"]
    db.commit()
    log_activity(db, user_id=user.id, action="user.settings_update", detail="User updated account settings")
    return {"message": "Settings updated successfully"}


@app.delete("/api/servers/{server_id}", status_code=204)
async def delete_server(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    if not user.root_admin and srv.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    server_name = srv.name
    server_uuid = srv.uuid
    node = srv.node
    try:
        await call_daemon(node, f"/api/servers/{srv.uuid}", method="DELETE")
    except Exception:
        pass

    log_activity(db, user_id=user.id, server_id=srv.id, action="server.delete", detail=f"Server '{server_name}' deleted")
    _fire_webhooks("server.deleted", {"server_id": srv.id, "name": server_name, "uuid": server_uuid})

    db.query(models.Allocation).filter(models.Allocation.server_id == srv.id).update({"server_id": None})
    db.delete(srv)
    db.commit()
    return None


# --- Proxy Endpoints ---
@app.get("/api/servers/{server_id}/stats")
async def proxy_server_stats(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv)
    node = srv.node
    stats = await call_daemon(node, f"/api/servers/{srv.uuid}/resources")
    daemon_status = stats.get("status", "")
    status_map = {"running": "running", "exited": "stopped", "dead": "stopped"}
    new_status = status_map.get(daemon_status)
    if srv.status == "suspended":
        stats["status"] = "suspended"
        return stats
    if new_status and srv.status != new_status:
        srv.status = new_status
        if srv.installed is False and daemon_status == "running":
            srv.installed = True
        db.commit()
    elif srv.installed is False and daemon_status in ("running", "exited"):
        srv.installed = True
        db.commit()
    if new_status and stats.get("status") != new_status:
        stats["status"] = new_status
    return stats


@app.get("/api/servers/{server_id}/files/list")
async def proxy_file_list(server_id: int, path: str = "", db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/list?path={quote(path, safe='/')}")


@app.get("/api/servers/{server_id}/files/read")
async def proxy_file_read(server_id: int, path: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/read?path={quote(path, safe='/')}")


@app.post("/api/servers/{server_id}/files/write")
async def proxy_file_write(server_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/write", method="POST", json_data=body)


@app.post("/api/servers/{server_id}/files/folder")
async def proxy_file_folder(server_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/folder", method="POST", json_data=body)


@app.delete("/api/servers/{server_id}/files/delete")
async def proxy_file_delete(server_id: int, path: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/delete?path={quote(path, safe='/')}", method="DELETE")


@app.post("/api/servers/{server_id}/files/rename")
async def proxy_file_rename(server_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="files")
    node = srv.node
    return await call_daemon(node, f"/api/servers/{srv.uuid}/files/rename", method="POST", json_data=body)


# --- Console (ttyd) Management ---
@app.post("/api/servers/{server_id}/console/start")
async def start_console(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="console")
    node = srv.node
    resp = await call_daemon(node, f"/api/console/{srv.uuid}/start", method="POST")
    return resp

@app.delete("/api/servers/{server_id}/console/stop")
async def stop_console(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="console")
    node = srv.node
    resp = await call_daemon(node, f"/api/console/{srv.uuid}/stop", method="DELETE")
    return resp

@app.get("/api/servers/{server_id}/console/url")
async def get_console_url(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="console")
    node = srv.node
    resp = await call_daemon(node, f"/api/console/{srv.uuid}/url", method="GET")
    port = resp.get("port", 0)
    if not port:
        raise HTTPException(status_code=404, detail="Console not running")
    return {"port": port, "url": f"http://localhost:{port}/{srv.uuid}/"}


# --- Backups ---
@app.get("/api/servers/{server_id}/backups")
async def list_server_backups(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv)
    return await call_daemon(srv.node, f"/api/servers/{srv.uuid}/backups", method="GET")


@app.post("/api/servers/{server_id}/backups")
async def create_server_backup(server_id: int, body: dict, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    require_owner_or_root(user, srv)
    backup_id = body.get("backup_id") or str(uuid.uuid4())
    resp = await call_daemon(srv.node, f"/api/servers/{srv.uuid}/backups", method="POST",
                             json_data={"backup_id": backup_id, "name": body.get("name", "")})
    return resp


@app.delete("/api/servers/{server_id}/backups/{backup_id}", status_code=204)
async def delete_server_backup(server_id: int, backup_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    require_owner_or_root(user, srv)
    await call_daemon(srv.node, f"/api/servers/{srv.uuid}/backups/{backup_id}", method="DELETE")
    return Response(status_code=204)


@app.post("/api/servers/{server_id}/backups/{backup_id}/restore")
async def restore_server_backup(server_id: int, backup_id: str, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    require_owner_or_root(user, srv)
    return await call_daemon(srv.node, f"/api/servers/{srv.uuid}/backups/{backup_id}/restore", method="POST")


# --- WebSocket Console Proxy ---
@app.websocket("/ws/servers/{server_id}/console")
async def ws_console_proxy(websocket: WebSocket, server_id: int, token: str = Query(None)):
    print(f"[WS] Console connection attempt for server {server_id}")

    from panel.database import SessionLocal
    db = SessionLocal()
    try:
        srv = db.query(models.Server).filter(models.Server.id == server_id).first()
        if not srv:
            await websocket.accept()
            await websocket.close(code=4004, reason="Server not found")
            return

        # Authenticate via JWT token
        if not token:
            await websocket.accept()
            await websocket.close(code=4001, reason="Missing token")
            return

        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("user_id")
            if user_id is None:
                await websocket.accept()
                await websocket.close(code=4001, reason="Invalid token")
                return
        except JWTError:
            await websocket.accept()
            await websocket.close(code=4001, reason="Invalid or expired token")
            return

        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            await websocket.accept()
            await websocket.close(code=4001, reason="User not found")
            return

        # Check server access
        if not user.root_admin and srv.owner_id != user.id:
            member = db.query(models.ServerMember).filter(
                models.ServerMember.server_id == srv.id,
                models.ServerMember.user_id == user.id,
            ).first()
            if not member or not member.has_permission("console"):
                await websocket.accept()
                await websocket.close(code=4003, reason="Access denied")
                return

        print(f"[WS] JWT auth verified for server {server_id} (user {user.username})")

        node = srv.node
        if not node:
            await websocket.accept()
            await websocket.close(code=4002, reason="No node assigned")
            return

        daemon_ws_url = f"ws://{node.fqdn}:{node.daemon_port}/api/servers/{srv.uuid}/console?token={node.daemon_token}"

        import websockets as ws_lib

        try:
            daemon_ws = await ws_lib.connect(daemon_ws_url, open_timeout=5, close_timeout=3)
        except Exception as e:
            await websocket.accept()
            await websocket.close(code=4002, reason=f"Daemon unreachable: {e}")
            return

        await websocket.accept()
        connected = True

        async def forward_to_daemon():
            nonlocal connected
            try:
                while connected:
                    data = await websocket.receive()
                    if data["type"] == "websocket.receive":
                        if "text" in data:
                            await daemon_ws.send(data["text"])
                        elif "bytes" in data:
                            await daemon_ws.send(data["bytes"])
            except Exception:
                connected = False

        async def forward_from_daemon():
            nonlocal connected
            try:
                async for msg in daemon_ws:
                    if isinstance(msg, str):
                        await websocket.send_text(msg)
                    else:
                        await websocket.send_bytes(msg)
            except Exception:
                connected = False

        t1 = asyncio.create_task(forward_to_daemon())
        t2 = asyncio.create_task(forward_from_daemon())
        done, pending = await asyncio.wait([t1, t2], return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        try:
            await daemon_ws.close()
        except Exception:
            pass
    finally:
        db.close()


# =============================================================================
# ACTIVITY LOG ENDPOINTS
# =============================================================================
@app.get("/api/activity", response_model=List[schemas.ActivityLogResponse])
def list_activity(
    server_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user)
):
    query = db.query(models.ActivityLog)

    if not user.root_admin:
        member_server_ids = [m.server_id for m in db.query(models.ServerMember).filter(models.ServerMember.user_id == user.id).all()]
        owned_ids = [sid for (sid,) in db.query(models.Server.id).filter(models.Server.owner_id == user.id).all()]
        visible_ids = list(set(owned_ids + member_server_ids))
        query = query.filter(
            (models.ActivityLog.user_id == user.id) |
            (models.ActivityLog.server_id.in_(visible_ids)) if visible_ids else (models.ActivityLog.user_id == user.id)
        )

    if server_id:
        query = query.filter(models.ActivityLog.server_id == server_id)

    logs = query.order_by(models.ActivityLog.created_at.desc()).offset(offset).limit(limit).all()

    result = []
    user_ids = {log_entry.user_id for log_entry in logs if log_entry.user_id}
    users = {}
    if user_ids:
        for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
            users[u.id] = u.username
    for log_entry in logs:
        resp = schemas.ActivityLogResponse.model_validate(log_entry)
        if log_entry.user_id and log_entry.user_id in users:
            resp.username = users[log_entry.user_id]
        result.append(resp)
    return result


@app.get("/api/servers/{server_id}/activity", response_model=List[schemas.ActivityLogResponse])
def list_server_activity(
    server_id: int,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user)
):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv)

    logs = db.query(models.ActivityLog).filter(
        models.ActivityLog.server_id == srv.id
    ).order_by(models.ActivityLog.created_at.desc()).offset(offset).limit(limit).all()

    result = []
    user_ids = {log_entry.user_id for log_entry in logs if log_entry.user_id}
    users = {}
    if user_ids:
        for u in db.query(models.User).filter(models.User.id.in_(user_ids)).all():
            users[u.id] = u.username
    for log_entry in logs:
        resp = schemas.ActivityLogResponse.model_validate(log_entry)
        if log_entry.user_id and log_entry.user_id in users:
            resp.username = users[log_entry.user_id]
        result.append(resp)
    return result


# =============================================================================
# API KEY ENDPOINTS
# =============================================================================
@app.post("/api/keys", status_code=201)
def create_api_key(body: schemas.ApiKeyCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    raw_key = f"px_{secrets.token_hex(32)}"
    key_hash = bcrypt.hash(raw_key)

    api_key = models.ApiKey(
        user_id=user.id,
        name=body.name,
        key_hash=key_hash,
        permissions=body.permissions,
        expires_at=body.expires_at,
    )
    db.add(api_key)
    db.commit()
    db.refresh(api_key)

    log_activity(db, user_id=user.id, action="apikey.create", detail=f"API key '{body.name}' created")

    return {
        "id": api_key.id,
        "name": api_key.name,
        "key": raw_key,
        "permissions": api_key.permissions,
        "expires_at": api_key.expires_at,
        "created_at": api_key.created_at,
        "message": "Save this key now. It will not be shown again.",
    }


@app.get("/api/keys", response_model=List[schemas.ApiKeyResponse])
def list_api_keys(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.ApiKey).filter(models.ApiKey.user_id == user.id).all()


@app.delete("/api/keys/{key_id}", status_code=204)
def delete_api_key(key_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    api_key = db.query(models.ApiKey).filter(
        models.ApiKey.id == key_id,
        models.ApiKey.user_id == user.id
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")

    key_name = api_key.name
    db.delete(api_key)
    db.commit()

    log_activity(db, user_id=user.id, action="apikey.delete", detail=f"API key '{key_name}' deleted")

    return None


# =============================================================================
# CONTAINER LOGS ENDPOINTS
# =============================================================================
@app.get("/api/servers/{server_id}/logs", response_model=schemas.ContainerLogsResponse)
async def proxy_server_logs(server_id: int, tail: int = Query(100, ge=1, le=1000), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv)
    node = srv.node
    if not node:
        raise HTTPException(status_code=404, detail="No node assigned")
    result = await call_daemon(node, f"/api/servers/{srv.uuid}/logs?tail={tail}")
    return schemas.ContainerLogsResponse(logs=result.get("logs", ""), container_status=result.get("status"))


# =============================================================================
# SERVER CLONE ENDPOINTS
# =============================================================================
@app.post("/api/servers/{server_id}/clone", response_model=schemas.ServerResponse, status_code=201)
async def clone_server(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    if not user.root_admin and srv.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    node = srv.node
    if not node:
        raise HTTPException(status_code=404, detail="No node assigned")

    # Find free allocations for the cloned server
    free_allocs = db.query(models.Allocation).filter(
        models.Allocation.node_id == srv.node_id,
        models.Allocation.server_id.is_(None),
    ).order_by(models.Allocation.id).all()
    if not free_allocs:
        raise HTTPException(status_code=400, detail="No free allocations available for cloning")

    last_err = None
    alloc = None
    new_uuid = None
    for alloc in free_allocs:
        clone_payload = {
            "source_uuid": srv.uuid,
            "docker_image": srv.docker_image,
            "docker_network": srv.docker_network,
            "cpu_limit": srv.cpu_limit,
            "memory_limit": srv.memory_limit,
            "disk_limit": srv.disk_limit,
            "startup_command": srv.startup_command or "",
            "port": alloc.port,
        }
        try:
            resp = await call_daemon(node, f"/api/servers/{srv.uuid}/clone", method="POST", json_data=clone_payload)
            new_uuid = resp.get("new_uuid")
            if not new_uuid:
                raise HTTPException(status_code=500, detail="Daemon did not return a new UUID")
            break
        except HTTPException as e:
            last_err = e
            err_text = str(e.detail or "").lower()
            if "already in use" not in err_text and "port is already allocated" not in err_text:
                raise e
            # The chosen allocation's port is occupied on the host; try the next one.
            continue
    else:
        raise last_err

    new_server = models.Server(
        name=f"{srv.name} (Clone)",
        description=f"Cloned from {srv.name}",
        owner_id=user.id,
        node_id=srv.node_id,
        uuid=new_uuid,
        primary_allocation_id=alloc.id if alloc else None,
        cpu_limit=srv.cpu_limit,
        memory_limit=srv.memory_limit,
        disk_limit=srv.disk_limit,
        docker_image=srv.docker_image,
        docker_network=srv.docker_network,
        startup_command=srv.startup_command or "",
        group_id=srv.group_id,
        env_vars=srv.env_vars or {},
        status="installing",
    )
    db.add(new_server)
    db.flush()

    if alloc:
        alloc.server_id = new_server.id

    db.commit()
    db.refresh(new_server)

    log_activity(db, user_id=user.id, server_id=new_server.id, action="server.clone", detail=f"Server cloned from '{srv.name}' to '{new_server.name}'")

    asyncio.create_task(_poll_install_complete(new_server.id, node.id))

    return new_server


# =============================================================================
# DOCKER NETWORK MANAGEMENT ENDPOINTS
# =============================================================================
@app.post("/api/system/networks", response_model=dict)
async def create_docker_network(body: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    return await call_daemon(node, "/api/system/networks", method="POST", json_data=body)


@app.delete("/api/system/networks/{network_name}", status_code=204)
async def delete_docker_network(network_name: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No nodes registered")
    try:
        await call_daemon(node, f"/api/system/networks/{network_name}", method="DELETE")
    except HTTPException:
        pass
    return Response(status_code=204)


# =============================================================================
# SERVER SCHEDULE ENDPOINTS
# =============================================================================
@app.get("/api/servers/{server_id}/schedules", response_model=List[schemas.ServerScheduleResponse])
def list_server_schedules(server_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="schedules")
    return db.query(models.ServerSchedule).filter(models.ServerSchedule.server_id == server_id).order_by(models.ServerSchedule.scheduled_time).all()


@app.post("/api/servers/{server_id}/schedules", response_model=schemas.ServerScheduleResponse, status_code=201)
def create_server_schedule(server_id: int, body: schemas.ServerScheduleCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="schedules")
    scheduled_time = body.scheduled_time
    if body.recurring and body.recurring_pattern:
        cron = _parse_cron(body.recurring_pattern)
        if cron:
            scheduled_time = _next_cron(datetime.now(timezone.utc), cron)
    schedule = models.ServerSchedule(
        server_id=server_id,
        action=body.action,
        scheduled_time=scheduled_time,
        recurring=body.recurring,
        recurring_pattern=body.recurring_pattern,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    log_activity(db, user_id=user.id, server_id=server_id, action="schedule.create", detail=f"Schedule created for '{srv.name}': {body.action} at {scheduled_time}")
    return schedule


@app.delete("/api/servers/{server_id}/schedules/{schedule_id}", status_code=204)
def delete_server_schedule(server_id: int, schedule_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="schedules")
    schedule = db.query(models.ServerSchedule).filter(
        models.ServerSchedule.id == schedule_id,
        models.ServerSchedule.server_id == server_id,
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    db.delete(schedule)
    db.commit()
    return None


@app.post("/api/servers/{server_id}/schedules/{schedule_id}/toggle")
def toggle_server_schedule(server_id: int, schedule_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    srv = get_server_or_404(server_id, db)
    check_server_access(user, srv, perm="schedules")
    schedule = db.query(models.ServerSchedule).filter(
        models.ServerSchedule.id == schedule_id,
        models.ServerSchedule.server_id == server_id,
    ).first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    schedule.is_active = not schedule.is_active
    db.commit()
    db.refresh(schedule)
    return {"status": "success", "is_active": schedule.is_active}


# =============================================================================
# SERVER GROUP ENDPOINTS
# =============================================================================
@app.get("/api/server-groups", response_model=List[schemas.ServerGroupResponse])
def list_server_groups(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.ServerGroup).order_by(models.ServerGroup.name).all()


@app.post("/api/server-groups", response_model=schemas.ServerGroupResponse, status_code=201)
def create_server_group(body: schemas.ServerGroupCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if db.query(models.ServerGroup).filter(models.ServerGroup.name == body.name).first():
        raise HTTPException(status_code=400, detail="Group name already exists")
    group = models.ServerGroup(
        name=body.name,
        description=body.description,
        color=body.color,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@app.put("/api/server-groups/{group_id}", response_model=schemas.ServerGroupResponse)
def update_server_group(group_id: int, body: schemas.ServerGroupBase, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    group = db.query(models.ServerGroup).filter(models.ServerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    group.name = body.name or group.name
    group.description = body.description if body.description is not None else group.description
    group.color = body.color or group.color
    db.commit()
    db.refresh(group)
    return group


@app.delete("/api/server-groups/{group_id}", status_code=204)
def delete_server_group(group_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    group = db.query(models.ServerGroup).filter(models.ServerGroup.id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.query(models.Server).filter(models.Server.group_id == group_id).update({"group_id": None})
    db.delete(group)
    db.commit()
    return None


# =============================================================================
# BUG REPORT ENDPOINTS
# =============================================================================
@app.post("/api/bug-reports", response_model=schemas.BugReportResponse, status_code=201)
def create_bug_report(body: schemas.BugReportCreate, request: Request, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    report = models.BugReport(
        user_id=user.id,
        username=user.username,
        title=body.title,
        description=body.description,
        severity=body.severity,
        screenshot_url=body.screenshot_url,
        browser_info=body.browser_info,
        ip_address=client_ip,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    log_activity(db, user_id=user.id, action="bug_report.create", detail=f"Bug report '{body.title}' submitted")
    return report


@app.get("/api/bug-reports", response_model=List[schemas.BugReportResponse])
def list_bug_reports(
    status: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user)
):
    if not user.root_admin:
        query = db.query(models.BugReport).filter(models.BugReport.user_id == user.id)
    else:
        query = db.query(models.BugReport)

    if status:
        query = query.filter(models.BugReport.status == status)

    return query.order_by(models.BugReport.created_at.desc()).offset(offset).limit(limit).all()


@app.patch("/api/bug-reports/{report_id}", response_model=schemas.BugReportResponse)
def update_bug_report(report_id: int, body: dict, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    report = db.query(models.BugReport).filter(models.BugReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Bug report not found")
    if "status" in body:
        report.status = body["status"]
    if "severity" in body:
        report.severity = body["severity"]
    db.commit()
    db.refresh(report)
    log_activity(db, user_id=admin.id, action="bug_report.update", detail=f"Bug report #{report_id} updated to status '{report.status}'")
    return report


@app.delete("/api/bug-reports/{report_id}", status_code=204)
def delete_bug_report(report_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    report = db.query(models.BugReport).filter(models.BugReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Bug report not found")
    db.delete(report)
    db.commit()
    return None


# =============================================================================
# WEBHOOK DELIVERY
# =============================================================================
async def _deliver_webhooks(event: str, payload: dict):
    from panel.database import SessionLocal
    db = SessionLocal()
    try:
        hooks = db.query(models.Webhook).filter(models.Webhook.is_active == True).all()
        matched = [h for h in hooks if event in h.event_list()]
        if not matched:
            return
        async with httpx.AsyncClient(timeout=10.0) as client:
            for h in matched:
                try:
                    await client.post(
                        h.url,
                        json={"event": event, "data": payload, "timestamp": datetime.now(timezone.utc).isoformat()},
                        headers={"Content-Type": "application/json", "User-Agent": "wings-panel-webhook/1.0"},
                    )
                except Exception:
                    continue
    finally:
        db.close()


def _fire_webhooks(event: str, payload: dict):
    try:
        asyncio.create_task(_deliver_webhooks(event, payload))
    except Exception:
        pass


# =============================================================================
# SERVER TEMPLATE ENDPOINTS
# =============================================================================
@app.get("/api/templates", response_model=List[schemas.ServerTemplateResponse])
def list_server_templates(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return db.query(models.ServerTemplate).order_by(models.ServerTemplate.featured.desc(), models.ServerTemplate.name).all()


@app.post("/api/templates", response_model=schemas.ServerTemplateResponse, status_code=201)
def create_server_template(body: schemas.ServerTemplateCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if db.query(models.ServerTemplate).filter(models.ServerTemplate.name == body.name).first():
        raise HTTPException(status_code=400, detail="Template name already exists")
    template = models.ServerTemplate(
        name=body.name,
        description=body.description,
        docker_image=body.docker_image,
        docker_network=body.docker_network,
        startup_command=body.startup_command,
        cpu_limit=body.cpu_limit,
        memory_limit=body.memory_limit,
        disk_limit=body.disk_limit,
        alloc_port=body.alloc_port,
        featured=body.featured,
        created_by=admin.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    log_activity(db, user_id=admin.id, action="template.create", detail=f"Template '{template.name}' created")
    return template


@app.put("/api/templates/{template_id}", response_model=schemas.ServerTemplateResponse)
def update_server_template(template_id: int, body: schemas.ServerTemplateUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    template = db.query(models.ServerTemplate).filter(models.ServerTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    for field in ("name", "description", "docker_image", "docker_network", "startup_command", "cpu_limit", "memory_limit", "disk_limit", "alloc_port", "featured"):
        value = getattr(body, field, None)
        if value is not None:
            setattr(template, field, value)
    db.commit()
    db.refresh(template)
    log_activity(db, user_id=admin.id, action="template.update", detail=f"Template '{template.name}' updated")
    return template


@app.delete("/api/templates/{template_id}", status_code=204)
def delete_server_template(template_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    template = db.query(models.ServerTemplate).filter(models.ServerTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    log_activity(db, user_id=admin.id, action="template.delete", detail=f"Template '{template.name}' deleted")
    db.delete(template)
    db.commit()
    return None


# =============================================================================
# WEBHOOK ENDPOINTS
# =============================================================================
@app.get("/api/webhooks", response_model=List[schemas.WebhookResponse])
def list_webhooks(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    return db.query(models.Webhook).order_by(models.Webhook.created_at.desc()).all()


@app.post("/api/webhooks", response_model=schemas.WebhookResponse, status_code=201)
def create_webhook(body: schemas.WebhookCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    webhook = models.Webhook(
        name=body.name,
        url=body.url,
        events=",".join(body.events),
        is_active=body.is_active,
        created_by=admin.id,
    )
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    log_activity(db, user_id=admin.id, action="webhook.create", detail=f"Webhook '{webhook.name}' created")
    return webhook


@app.put("/api/webhooks/{webhook_id}", response_model=schemas.WebhookResponse)
def update_webhook(webhook_id: int, body: schemas.WebhookUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    webhook = db.query(models.Webhook).filter(models.Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    for field in ("name", "url", "is_active"):
        value = getattr(body, field, None)
        if value is not None:
            setattr(webhook, field, value)
    if body.events is not None:
        webhook.events = ",".join(body.events)
    db.commit()
    db.refresh(webhook)
    return webhook


@app.delete("/api/webhooks/{webhook_id}", status_code=204)
def delete_webhook(webhook_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    webhook = db.query(models.Webhook).filter(models.Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    log_activity(db, user_id=admin.id, action="webhook.delete", detail=f"Webhook '{webhook.name}' deleted")
    db.delete(webhook)
    db.commit()
    return None


@app.post("/api/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    webhook = db.query(models.Webhook).filter(models.Webhook.id == webhook_id).first()
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                webhook.url,
                json={"event": "webhook.test", "data": {"message": "Webhook test ping from Wings Panel"}, "timestamp": datetime.now(timezone.utc).isoformat()},
                headers={"Content-Type": "application/json", "User-Agent": "wings-panel-webhook/1.0"},
            )
            return {"status": resp.status_code, "ok": resp.status_code < 400, "detail": resp.text[:500]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Webhook delivery failed: {e}")


# =============================================================================
# ANNOUNCEMENT ENDPOINTS
# =============================================================================
@app.get("/api/announcements", response_model=List[schemas.AnnouncementResponse])
def list_announcements(
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    query = db.query(models.Announcement)
    if not include_inactive or not user.root_admin:
        query = query.filter(models.Announcement.is_active == True)
    return query.order_by(models.Announcement.created_at.desc()).all()


@app.post("/api/announcements", response_model=schemas.AnnouncementResponse, status_code=201)
def create_announcement(body: schemas.AnnouncementCreate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    announcement = models.Announcement(
        title=body.title,
        content=body.content,
        color=body.color,
        is_active=body.is_active,
        created_by=admin.id,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    log_activity(db, user_id=admin.id, action="announcement.create", detail=f"Announcement '{announcement.title}' created")
    return announcement


@app.put("/api/announcements/{announcement_id}", response_model=schemas.AnnouncementResponse)
def update_announcement(announcement_id: int, body: schemas.AnnouncementUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    announcement = db.query(models.Announcement).filter(models.Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    for field in ("title", "content", "color", "is_active"):
        value = getattr(body, field, None)
        if value is not None:
            setattr(announcement, field, value)
    db.commit()
    db.refresh(announcement)
    return announcement


@app.delete("/api/announcements/{announcement_id}", status_code=204)
def delete_announcement(announcement_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    announcement = db.query(models.Announcement).filter(models.Announcement.id == announcement_id).first()
    if not announcement:
        raise HTTPException(status_code=404, detail="Announcement not found")
    log_activity(db, user_id=admin.id, action="announcement.delete", detail=f"Announcement '{announcement.title}' deleted")
    db.delete(announcement)
    db.commit()
    return None


# =============================================================================
# PANEL SETTINGS ENDPOINTS
# =============================================================================
def _get_setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(models.PanelSetting).filter(models.PanelSetting.key == key).first()
    return row.value if row else default


def _set_setting(db: Session, key: str, value: str):
    row = db.query(models.PanelSetting).filter(models.PanelSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(models.PanelSetting(key=key, value=value))
    db.commit()


@app.get("/api/settings")
def get_panel_settings(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return {
        "site_name": _get_setting(db, "site_name", "Wings Panel"),
        "maintenance_mode": _get_setting(db, "maintenance_mode", "false") == "true",
        "registration_enabled": _get_setting(db, "registration_enabled", "true") == "true",
        "default_theme": _get_setting(db, "default_theme", "dark"),
    }


@app.put("/api/settings", response_model=dict)
def update_panel_settings(body: schemas.PanelSettingsUpdate, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if body.site_name is not None:
        _set_setting(db, "site_name", body.site_name)
    if body.maintenance_mode is not None:
        _set_setting(db, "maintenance_mode", "true" if body.maintenance_mode else "false")
    if body.registration_enabled is not None:
        _set_setting(db, "registration_enabled", "true" if body.registration_enabled else "false")
    if body.default_theme is not None:
        _set_setting(db, "default_theme", body.default_theme)
    log_activity(db, user_id=admin.id, action="panel.settings_update", detail="Panel settings updated")
    return get_panel_settings(db, admin)


# =============================================================================
# DOCKER IMAGES (proxied to daemon)
# =============================================================================
@app.get("/api/system/images")
async def list_docker_images(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No node configured")
    return await call_daemon(node, "/api/system/images", method="GET")


@app.delete("/api/system/images/{image_name:path}", status_code=204)
async def remove_docker_image(image_name: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    node = db.query(models.Node).first()
    if not node:
        raise HTTPException(status_code=404, detail="No node configured")
    await call_daemon(node, f"/api/system/images/{quote(image_name, safe='')}", method="DELETE")
    log_activity(db, user_id=admin.id, action="docker.image_remove", detail=f"Docker image '{image_name}' removed")
    return None
