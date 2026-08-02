"""One-time database initialization.

Run manually on a fresh installation:
    python -m app.init_db

The web process intentionally does not run migrations/seeding on every cold start,
which makes Render Free wake up noticeably faster.
"""
from sqlalchemy import select, text

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import Role, User, QuestionSetting, ScoreSetting
from app.security import hash_password
from app.questionnaire import QUESTIONS


def initialize_database() -> None:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE visits ADD COLUMN IF NOT EXISTS shop_name VARCHAR(200)"))
        elif engine.dialect.name == "sqlite":
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(visits)"))}
            if "shop_name" not in cols:
                conn.execute(text("ALTER TABLE visits ADD COLUMN shop_name VARCHAR(200)"))

    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.login == settings.seed_admin_login)):
            db.add(User(
                full_name="Администратор",
                login=settings.seed_admin_login,
                password_hash=hash_password(settings.seed_admin_password),
                role=Role.admin,
            ))
        for index, question in enumerate(QUESTIONS):
            if not db.get(QuestionSetting, question["key"]):
                db.add(QuestionSetting(
                    key=question["key"],
                    section=question["section"],
                    step=question["step"],
                    weight=question["weight"],
                    text_ru=question["text"],
                    sort_order=index,
                    is_active=True,
                ))
        if not db.get(ScoreSetting, 1):
            db.add(ScoreSetting(id=1, confident_min=65, master_min=85))
        db.commit()


if __name__ == "__main__":
    initialize_database()
    print("Database initialized successfully")
