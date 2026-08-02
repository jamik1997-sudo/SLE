from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import select
from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import Role, User
from app.routers import admin, audits, auth
from app.security import hash_password

settings = get_settings()
app = FastAPI(title="SLE Audit API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=700)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(audits.router)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.login == settings.seed_admin_login)):
            db.add(User(full_name="Администратор", login=settings.seed_admin_login, password_hash=hash_password(settings.seed_admin_password), role=Role.admin))
            db.commit()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "SLE Audit API", "status": "ok"}
