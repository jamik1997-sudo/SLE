import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from app.config import get_settings
from app.routers import admin, audits, auth, extras
from app.database import engine
from sqlalchemy import text

settings = get_settings()
app = FastAPI(title="SLE Audit API", version="1.0.1")
# CORS добавляется внешним middleware, чтобы заголовки присутствовали
# даже в ответах на необработанные серверные ошибки.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_origin_regex=r"https://([a-zA-Z0-9-]+\.)*vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=700)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(audits.router)
app.include_router(extras.router)


logger = logging.getLogger("sle")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера", "path": request.url.path},
    )


@app.on_event("startup")
def startup():
    # Lightweight compatibility migration for existing Supabase databases.
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE employees ADD COLUMN IF NOT EXISTS leader_id VARCHAR(36)"))
            conn.execute(text("ALTER TABLE audits ADD COLUMN IF NOT EXISTS leader_id VARCHAR(36)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_employees_leader_id ON employees(leader_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_audits_leader_id ON audits(leader_id)"))
    # Database schema creation and seeding are disabled during normal starts.
    # This removes dozens of Supabase round-trips from every Render Free cold start.
    # On a fresh installation set INIT_DB_ON_START=true once, or run:
    #   python -m app.init_db
    if settings.init_db_on_start:
        from app.init_db import initialize_database
        initialize_database()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "SLE Audit API", "status": "ok"}
