from functools import lru_cache
import json
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sle.db"
    jwt_secret: str = "change-me"
    access_token_minutes: int = 720
    cors_origins: str = "http://localhost:3000,https://sle-xi.vercel.app"
    seed_admin_login: str = "admin"
    seed_admin_password: str = "ChangeMe123!"
    init_db_on_start: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_list(self) -> list[str]:
        raw = (self.cors_origins or "").strip()
        if not raw:
            return []
        if raw.startswith("["):
            try:
                values = json.loads(raw)
                return [str(x).strip().rstrip("/") for x in values if str(x).strip()]
            except json.JSONDecodeError:
                pass
        return [x.strip().rstrip("/") for x in raw.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
