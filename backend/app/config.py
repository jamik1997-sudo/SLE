from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./sle.db"
    jwt_secret: str = "change-me"
    access_token_minutes: int = 720
    cors_origins: str = "http://localhost:3000"
    seed_admin_login: str = "admin"
    seed_admin_password: str = "ChangeMe123!"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_list(self) -> list[str]:
        return [x.strip() for x in self.cors_origins.split(",") if x.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
