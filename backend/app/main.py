import logging
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import Role, User, QuestionSetting, ScoreSetting
from app.routers import admin, audits, auth, extras
from app.security import hash_password

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
    Base.metadata.create_all(bind=engine)
    # Lightweight migration for existing installations.
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE visits ADD COLUMN IF NOT EXISTS shop_name VARCHAR(200)"))
        elif engine.dialect.name == "sqlite":
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(visits)"))}
            if "shop_name" not in cols:
                conn.execute(text("ALTER TABLE visits ADD COLUMN shop_name VARCHAR(200)"))
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.login == settings.seed_admin_login)):
            db.add(User(full_name="Администратор", login=settings.seed_admin_login, password_hash=hash_password(settings.seed_admin_password), role=Role.admin))
            db.commit()
        from app.questionnaire import QUESTIONS
        for i,q in enumerate(QUESTIONS):
            if not db.get(QuestionSetting,q["key"]):
                db.add(QuestionSetting(key=q["key"],section=q["section"],step=q["step"],weight=q["weight"],text_ru=q["text"],sort_order=i,is_active=True))
        if not db.get(ScoreSetting,1): db.add(ScoreSetting(id=1,confident_min=65,master_min=85))
        db.commit()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "SLE Audit API", "status": "ok"}
