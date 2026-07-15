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
    subusers = relationship("Subuser", back_populates="user")
    api_keys = relationship("ApiKey", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User username={self.username} admin={self.root_admin}>"


class Nest(Base):
    __tablename__ = 'nests'

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    eggs = relationship("Egg", back_populates="nest", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Nest name={self.name}>"


class Egg(Base):
    __tablename__ = 'eggs'

    id = Column(Integer, primary_key=True, index=True)
    nest_id = Column(Integer, ForeignKey('nests.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    docker_image = Column(String(255), nullable=False, default="quay.io/pterodactyl/core:java-17")
    startup_command = Column(Text, nullable=True, default="")
    install_script = Column(Text, nullable=True, default="")
    env_variables = Column(Text, nullable=True, default="{}")
    icon = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    nest = relationship("Nest", back_populates="eggs")
    server_eggs = relationship("ServerEgg", back_populates="egg")

    def __repr__(self):
        return f"<Egg name={self.name} nest_id={self.nest_id}>"


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
    egg_id = Column(Integer, ForeignKey('eggs.id', ondelete='SET NULL'), nullable=True)

    cpu_limit = Column(Float, nullable=False, default=100.0)
    memory_limit = Column(Integer, nullable=False, default=1024)
    disk_limit = Column(Integer, nullable=False, default=5120)
    docker_image = Column(String(255), nullable=False, default="quay.io/pterodactyl/core:java-17")
    docker_network = Column(String(255), nullable=False, default="pterodactyl-net")
    startup_command = Column(Text, nullable=True, default="")
    status = Column(String(50), nullable=False, default="installing")
    installed = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))

    node = relationship("Node", back_populates="servers")
    owner = relationship("User", back_populates="servers", foreign_keys=[owner_id])
    allocations = relationship("Allocation", back_populates="server", foreign_keys=[Allocation.server_id])
    egg = relationship("Egg", foreign_keys=[egg_id])
    subusers = relationship("Subuser", back_populates="server", cascade="all, delete-orphan")
    schedules = relationship("Schedule", back_populates="server", cascade="all, delete-orphan")
    backups = relationship("Backup", back_populates="server", cascade="all, delete-orphan")
    databases = relationship("ServerDatabase", back_populates="server", cascade="all, delete-orphan")
    activity_logs = relationship("ActivityLog", primaryjoin="Server.id == ActivityLog.server_id", foreign_keys="ActivityLog.server_id", viewonly=True)

    def __repr__(self):
        return f"<Server uuid={self.uuid} name={self.name} status={self.status}>"


class ServerEgg(Base):
    __tablename__ = 'server_eggs'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    egg_id = Column(Integer, ForeignKey('eggs.id', ondelete='CASCADE'), nullable=False)
    env_overrides = Column(Text, nullable=True, default="{}")

    server = relationship("Server")
    egg = relationship("Egg", back_populates="server_eggs")

    def __repr__(self):
        return f"<ServerEgg server_id={self.server_id} egg_id={self.egg_id}>"


class Subuser(Base):
    __tablename__ = 'subusers'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    permissions = Column(Text, nullable=False, default="console,start,stop")
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="subusers")
    user = relationship("User", back_populates="subusers")

    def __repr__(self):
        return f"<Subuser server_id={self.server_id} user_id={self.user_id} permissions={self.permissions}>"


class Schedule(Base):
    __tablename__ = 'schedules'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    cron = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="schedules")
    tasks = relationship("ScheduledTask", back_populates="schedule", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Schedule name={self.name} server_id={self.server_id} active={self.is_active}>"


class ScheduledTask(Base):
    __tablename__ = 'scheduled_tasks'

    id = Column(Integer, primary_key=True, index=True)
    schedule_id = Column(Integer, ForeignKey('schedules.id', ondelete='CASCADE'), nullable=False)
    action = Column(String(50), nullable=False)
    payload = Column(Text, nullable=True)
    time_offset = Column(Integer, nullable=False, default=0)
    enabled = Column(Boolean, default=True)

    schedule = relationship("Schedule", back_populates="tasks")

    def __repr__(self):
        return f"<ScheduledTask schedule_id={self.schedule_id} action={self.action}>"


class Backup(Base):
    __tablename__ = 'backups'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    name = Column(String(255), nullable=False)
    path = Column(String(255), nullable=True)
    size_bytes = Column(Integer, nullable=True, default=0)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="backups")

    def __repr__(self):
        return f"<Backup name={self.name} server_id={self.server_id} size={self.size_bytes}>"


class ServerDatabase(Base):
    __tablename__ = 'server_databases'

    id = Column(Integer, primary_key=True, index=True)
    server_id = Column(Integer, ForeignKey('servers.id', ondelete='CASCADE'), nullable=False)
    database_name = Column(String(255), nullable=False)
    database_user = Column(String(255), nullable=False)
    database_password = Column(String(255), nullable=False)
    host = Column(String(255), nullable=False, default="127.0.0.1")
    port = Column(Integer, nullable=False, default=3306)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    server = relationship("Server", back_populates="databases")

    def __repr__(self):
        return f"<ServerDatabase name={self.database_name} server_id={self.server_id}>"


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
