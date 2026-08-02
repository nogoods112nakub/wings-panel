from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

# --- Auth Schemas ---
class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=255)
    email: str = Field(..., min_length=5)
    password: str = Field(..., min_length=8)
    root_admin: Optional[bool] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    root_admin: bool
    created_at: datetime
    class Config:
        from_attributes = True

class UserUpdate(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    root_admin: Optional[bool] = None

class UserPasswordReset(BaseModel):
    password: str = Field(..., min_length=8)

class TokenResponse(BaseModel):
    token: str
    user: UserResponse

# --- Allocation Schemas ---
class AllocationBase(BaseModel):
    ip_address: str
    port: int = Field(..., ge=1, le=65535)

class AllocationCreate(BaseModel):
    node_id: int
    ip_address: str
    port_start: int = Field(25565, ge=1024, le=65535)
    count: int = Field(1, ge=1, le=256)

class AllocationResponse(AllocationBase):
    id: int
    node_id: int
    server_id: Optional[int] = None
    class Config:
        from_attributes = True

# --- Node Schemas ---
class NodeBase(BaseModel):
    name: str = Field(..., max_length=255)
    fqdn: str = Field(..., max_length=255)
    ip_address: str
    daemon_port: int = Field(8080, ge=1, le=65535)

class NodeCreate(NodeBase):
    daemon_token: str = Field(..., min_length=16)

class NodeUpdate(BaseModel):
    name: Optional[str] = None
    fqdn: Optional[str] = None
    ip_address: Optional[str] = None
    daemon_port: Optional[int] = None
    daemon_token: Optional[str] = None
    is_active: Optional[bool] = None

class NodeResponse(NodeBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True

class NodeDetailResponse(NodeResponse):
    allocations: List[AllocationResponse] = []

# --- Server Schemas ---
class ServerBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    cpu_limit: float = Field(100.0, ge=0.0)
    memory_limit: int = Field(1024, ge=128)
    disk_limit: int = Field(5120, ge=512)
    docker_image: str = "itzg/minecraft-server"
    docker_network: str = "pterodactyl-net"
    startup_command: str = ""

class ServerCreate(ServerBase):
    node_id: int
    primary_allocation_id: Optional[int] = 0
    allocation_ids: Optional[List[int]] = Field(default=[])

class ServerUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cpu_limit: Optional[float] = None
    memory_limit: Optional[int] = None
    disk_limit: Optional[int] = None
    docker_image: Optional[str] = None
    startup_command: Optional[str] = None
    status: Optional[str] = None

class ServerResponse(ServerBase):
    id: int
    uuid: str
    owner_id: int
    node_id: int
    primary_allocation_id: Optional[int]
    status: str
    installed: bool
    created_at: datetime
    updated_at: datetime
    allocations: List[AllocationResponse] = []
    class Config:
        from_attributes = True

# --- Panel-Daemon Interaction Schemas ---
class DaemonServerInstall(BaseModel):
    uuid: str
    docker_image: str
    cpu_limit: float
    memory_limit: int
    disk_limit: int
    primary_port: int
    allocations: List[AllocationBase]
    startup_command: str

class DaemonServerStatusUpdate(BaseModel):
    status: str

class ServerStats(BaseModel):
    status: str
    cpu_percentage: float = 0.0
    memory_bytes: int = 0
    memory_mb: float = 0.0
    disk_mb: float = 0.0

class SystemStatusResponse(BaseModel):
    panel_version: str = "1.0.0"
    daemon_reachable: bool = False
    daemon_version: Optional[str] = None
    total_nodes: int = 0
    active_nodes: int = 0
    total_servers: int = 0
    running_servers: int = 0
    total_allocations: int = 0
    used_allocations: int = 0
    total_users: int = 0
    host_memory_total_mb: float = 0.0
    host_memory_used_mb: float = 0.0
    host_disk_total_gb: float = 0.0
    host_disk_used_gb: float = 0.0

class NodeAllocationSummary(BaseModel):
    node_id: int
    node_name: str
    total_allocations: int = 0
    used_allocations: int = 0
    total_servers: int = 0

# --- Activity Log Schemas ---
class ActivityLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    server_id: Optional[int] = None
    action: str
    detail: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    username: Optional[str] = None
    class Config:
        from_attributes = True

# --- API Key Schemas ---
class ApiKeyCreate(BaseModel):
    name: str = Field(..., max_length=255)
    permissions: str = ""
    expires_at: Optional[datetime] = None

class ApiKeyResponse(BaseModel):
    id: int
    name: str
    permissions: str
    last_used: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    class Config:
        from_attributes = True


# --- Bug Report Schemas ---
class BugReportBase(BaseModel):
    title: str = Field(..., max_length=500)
    description: Optional[str] = None
    severity: Optional[str] = Field("medium", max_length=20)
    screenshot_url: Optional[str] = None
    browser_info: Optional[str] = None

class BugReportCreate(BugReportBase):
    pass

class BugReportResponse(BugReportBase):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    status: str
    ip_address: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True


# --- Server Group Schemas ---
class ServerGroupBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field("#38bdf8", max_length=7)

class ServerGroupCreate(ServerGroupBase):
    pass

class ServerGroupResponse(ServerGroupBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True


# --- Server Schedule Schemas ---
class ServerScheduleBase(BaseModel):
    action: str = Field(..., pattern=r"^(start|stop|kill|restart)$")
    scheduled_time: Optional[datetime] = None
    recurring: bool = False
    recurring_pattern: Optional[str] = None

class ServerScheduleCreate(ServerScheduleBase):
    pass

class ServerScheduleResponse(ServerScheduleBase):
    id: int
    is_active: bool
    created_at: datetime
    class Config:
        from_attributes = True


# --- Server Sharing / Members Schema ---
class ServerMemberBase(BaseModel):
    permissions: Optional[str] = "console,power,files,schedules,logs"

class ServerMemberCreate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    user_id: Optional[int] = None
    permissions: str = "console,power,files,schedules,logs"

class ServerMemberResponse(BaseModel):
    id: int
    server_id: int
    user_id: int
    permissions: str
    username: str
    email: str
    root_admin: bool = False
    created_at: datetime
    class Config:
        from_attributes = True


# --- Container Logs Schema ---
class ContainerLogsResponse(BaseModel):
    logs: str
    container_status: Optional[str] = None
