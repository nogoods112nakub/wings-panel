import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from panel.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./panel.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args["check_same_thread"] = False

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_size=25,
    max_overflow=25,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

if not JWT_SECRET or JWT_SECRET == "super-secret-pterodactyl-key-change-in-production":
    raise RuntimeError(
        "JWT_SECRET must be set to a strong random value (run install.sh to generate .env)"
    )

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

MIGRATIONS = [
    ("servers", "installed", "BOOLEAN", "FALSE"),
    ("servers", "description", "TEXT", "NULL"),
    ("servers", "docker_network", "VARCHAR(255)", "'pterodactyl-net'"),
    ("servers", "group_id", "INTEGER", "NULL"),
]

def column_exists(conn, table, column):
    if DATABASE_URL.startswith("sqlite"):
        result = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
        for row in result:
            if row[1] == column:
                return True
        return False
    else:
        result = conn.execute(text(
            f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}' AND column_name='{column}'"
        )).fetchone()
        return result is not None

def run_migrations():
    with engine.begin() as conn:
        for table, column, col_type, default in MIGRATIONS:
            try:
                if not column_exists(conn, table, column):
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN {column} {col_type} DEFAULT {default}"
                    ))
            except Exception:
                pass
        try:
            if not column_exists(conn, "servers", "env_vars"):
                col_type = "JSON" if not DATABASE_URL.startswith("sqlite") else "TEXT"
                conn.execute(text(f"ALTER TABLE servers ADD COLUMN env_vars {col_type}"))
        except Exception:
            pass

INDEXES = [
    ("ix_servers_owner_id", "servers", "owner_id"),
    ("ix_servers_node_id", "servers", "node_id"),
    ("ix_activity_user_id", "activity_logs", "user_id"),
    ("ix_activity_server_id", "activity_logs", "server_id"),
    ("ix_server_members_user_id", "server_members", "user_id"),
    ("ix_server_members_server_id", "server_members", "server_id"),
    ("ix_server_schedules_server_id", "server_schedules", "server_id"),
    ("ix_allocations_server_id", "allocations", "server_id"),
    ("ix_api_keys_user_id", "api_keys", "user_id"),
]

def ensure_indexes():
    for name, table, column in INDEXES:
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({column})"
                ))
        except Exception:
            pass

def init_db():
    Base.metadata.create_all(bind=engine)
    run_migrations()
    ensure_indexes()
