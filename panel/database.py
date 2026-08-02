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
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

JWT_SECRET = os.getenv("JWT_SECRET", "super-secret-pterodactyl-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

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

def init_db():
    Base.metadata.create_all(bind=engine)
    run_migrations()
