from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from app.config import get_settings

settings = get_settings()
is_sqlite = settings.database_url.startswith("sqlite")
DB_POOL_SIZE = 3
DB_MAX_OVERFLOW = 1
connect_args = {"check_same_thread": False} if is_sqlite else {
    "connect_timeout": 10,
    # Supabase pooler / PgBouncer can reuse a server connection between clients.
    # Disable psycopg 3 automatic prepared statements to prevent
    # DuplicatePreparedStatement: prepared statement "_pg3_0" already exists.
    "prepare_threshold": None,
}
engine_kwargs = {
    "pool_pre_ping": True,
    "connect_args": connect_args,
}
if not is_sqlite:
    engine_kwargs.update({
        "pool_size": DB_POOL_SIZE,
        "max_overflow": DB_MAX_OVERFLOW,
        "pool_recycle": 600,
        "pool_timeout": 3,
        "pool_use_lifo": True,
    })
engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
