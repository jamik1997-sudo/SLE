import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import admin, audits, auth, extras

settings = get_settings()
app = FastAPI(title="SLE Audit API", version="6.5.7")

app.add_middleware(GZipMiddleware, minimum_size=700)
# CORS добавляется последним: он становится внешним middleware Starlette,
# поэтому заголовки присутствуют также при необработанных ошибках.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_origin_regex=r"https://([a-zA-Z0-9-]+\.)*vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# ВАЖНО: структурные изменения БД больше не выполняются при startup.
# Все миграции выполняет Alembic до запуска Uvicorn.
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    return {"service": "SLE Audit API", "status": "ok"}
