from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float, Text, Boolean
from sqlalchemy.orm import relationship, declarative_base
import datetime
import uuid as uuid_module

Base = declarative_base()


class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), nullable=False, unique=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    root_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

    servers = relationship("Server", back_populates="owner", foreign_keys="Server.owner_id")
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")
    member_servers = relationship("ServerMember", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User username={self.username} admin={self.root_admin}>"


class Node(Base):
    __tablename__ = 'nodes'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    fqdn = Column(String(255), nullable=False, unique=True)
    ip_address = Column(String(45), nullable=False)
    daemon_port = Column(Integer, nullable=False, default=8080)
    daemon_token = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

    servers = relationship("Server", back_populates="node")
    allocations = relationship("Allocation", back_populates="node", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Node name={self.name} fqdn={self.fqdn}>"


class Allocation(Base):
    __tablename__ = 'allocations'

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(Integer, ForeignKey('nodes.id', ondelete='CASCADE'), nullable=False)
    ip_address = Column(String(45), nullable=False)
    port = Column(Integer, nullable=False)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='SET NULL'), nullable=True)

    node = relationship("Node", back_populates="allocations")
    server = relationship("Server", back_populates="allocations", foreign_keys=[server_id])

    def __repr__(self):
        return f"<Allocation ip={self.ip_address} port={self.port} server_id={self.server_id}>"


class Server(Base):
    __tablename__ = 'servers'

    id = Column(Integer, primary_key=True, index=True)
    uuid = Column(String(36), default=lambda: str(uuid_module.uuid4()), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    node_id = Column(Integer, ForeignKey('nodes.id', ondelete='RESTRICT'), nullable=False)
    primary_allocation_id = Column(Integer, ForeignKey('allocations.id', ondelete='RESTRICT'), nullable=True)
    group_id = Column(Integer, ForeignKey('server_groups.id', ondelete='SET NULL'), nullable=True)

    cpu_limit = Column(Float, nullable=False, default=100.0)
    memory_limit = Column(Integer, nullable=False, default=1024)
    disk_limit = Column(Integer, nullable=False, default=5120)
    docker_image = Column(String(255), nullable=False, default="itzg/minecraft-server")
    docker_network = Column(String(255), nullable=False, default="pterodactyl-net")
    startup_command = Column(Text, nullable=True, default="")
    status = Column(String(50), nullable=False, default="installing")
    installed = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

    node = relationship("Node", back_populates="servers")
    owner = relationship("User", back_populates="servers", foreign_keys=[owner_id])
    allocations = relationship("Allocation", back_populates="server", foreign_keys=[Allocation.server_id])
    activity_logs = relationship("ActivityLog", primaryjoin="Server.id == ActivityLog.server_id", foreign_keys="ActivityLog.server_id", viewonly=True)
    group = relationship("ServerGroup", back_populates="servers")
    schedules = relationship("ServerSchedule", back_populates="server", cascade="all, delete-orphan")
    members = relationship("ServerMember", back_populates="server", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Server uuid={self.uuid} name={self.name} status={self.status}>"


class ActivityLog(Base):
    __tablename__ = 'activity_logs'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    server_id = Column(Integer, nullable=True)
    action = Column(String(255), nullable=False)
    detail = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    user = relationship("User", foreign_keys=[user_id], primaryjoin="ActivityLog.user_id == User.id", viewonly=True)
    server = relationship("Server", foreign_keys=[server_id], primaryjoin="ActivityLog.server_id == Server.id", viewonly=True)

    def __repr__(self):
        return f"<ActivityLog action={self.action} user_id={self.user_id} server_id={self.server_id}>"


class ServerGroup(Base):
    __tablename__ = 'server_groups'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    color = Column(String(7), nullable=True, default="#38bdf8")
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    servers = relationship("Server", back_populates="group", foreign_keys="Server.group_id")

    def __repr__(self):
        return f"<ServerGroup name={self.name}>"


class ServerSchedule(Base):
    __tablename__ = 'server_schedules'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    action = Column(String(20), nullable=False)
    scheduled_time = Column(DateTime, nullable=False)
    recurring = Column(Boolean, default=False)
    recurring_pattern = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="schedules")

    def __repr__(self):
        return f"<ServerSchedule server_id={self.server_id} action={self.action} scheduled={self.scheduled_time}>"


class ServerMember(Base):
    __tablename__ = 'server_members'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    permissions = Column(Text, nullable=False, default="console,power,files,schedules,logs")
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="members")
    user = relationship("User", back_populates="member_servers")

    def permission_list(self) -> list:
        return [p.strip() for p in (self.permissions or "").split(",") if p.strip()]

    def has_permission(self, perm: str) -> bool:
        return perm in self.permission_list()

    def __repr__(self):
        return f"<ServerMember server_id={self.server_id} user_id={self.user_id} perms={self.permissions}>"


class ApiKey(Base):
    __tablename__ = 'api_keys'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    key_hash = Column(String(255), nullable=False, unique=True, index=True)
    permissions = Column(Text, nullable=True, default="")
    last_used = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    user = relationship("User", back_populates="api_keys")

    def __repr__(self):
        return f"<ApiKey name={self.name} user_id={self.user_id}>"


class BugReport(Base):
    __tablename__ = 'bug_reports'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=True)
    username = Column(String(255), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(20), nullable=True, default="medium")
    status = Column(String(20), nullable=False, default="open")
    screenshot_url = Column(Text, nullable=True)
    browser_info = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

    def __repr__(self):
        return f"<BugReport id={self.id} title={self.title} status={self.status}>"
