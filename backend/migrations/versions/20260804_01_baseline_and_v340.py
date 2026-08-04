"""Baseline existing schema and apply v3.4.0 compatibility changes safely.

Revision ID: 20260804_01
Revises: None
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.database import Base
from app import models  # noqa: F401

revision: str = "20260804_01"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCK_KEY = 734003401  # постоянный advisory-lock только для миграций SLE


def _column_names(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {item["name"] for item in inspector.get_columns(table)}


def _index_names(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {item["name"] for item in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Исключает параллельное выполнение DDL при двух одновременных деплоях.
    if dialect == "postgresql":
        bind.execute(sa.text("SELECT pg_advisory_lock(:key)"), {"key": LOCK_KEY})

    try:
        # Для новой установки создаёт отсутствующие таблицы. Для существующей БД — no-op.
        Base.metadata.create_all(bind=bind, checkfirst=True)

        inspector = sa.inspect(bind)

        employee_cols = _column_names(inspector, "employees")
        if "employees" in inspector.get_table_names() and "leader_id" not in employee_cols:
            op.add_column("employees", sa.Column("leader_id", sa.String(36), nullable=True))

        audit_cols = _column_names(inspector, "audits")
        if "audits" in inspector.get_table_names() and "leader_id" not in audit_cols:
            op.add_column("audits", sa.Column("leader_id", sa.String(36), nullable=True))

        user_cols = _column_names(inspector, "users")
        if "users" in inspector.get_table_names():
            if "device_id" not in user_cols:
                op.add_column("users", sa.Column("device_id", sa.String(120), nullable=True))
            if "device_name" not in user_cols:
                op.add_column("users", sa.Column("device_name", sa.String(240), nullable=True))
            if "device_bound_at" not in user_cols:
                op.add_column("users", sa.Column("device_bound_at", sa.DateTime(), nullable=True))

        visit_cols = _column_names(inspector, "visits")
        if "visits" in inspector.get_table_names() and "goal" not in visit_cols:
            op.add_column("visits", sa.Column("goal", sa.Text(), nullable=True))

        # PostgreSQL enum меняется в autocommit-блоке, чтобы значение можно было
        # сразу использовать после миграции и не держать DDL-транзакцию.
        if dialect == "postgresql":
            with op.get_context().autocommit_block():
                op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'auditor'")

        # После add_column инспектор создаётся заново.
        inspector = sa.inspect(bind)
        if "employees" in inspector.get_table_names() and "ix_employees_leader_id" not in _index_names(inspector, "employees"):
            op.create_index("ix_employees_leader_id", "employees", ["leader_id"], unique=False)
        if "audits" in inspector.get_table_names() and "ix_audits_leader_id" not in _index_names(inspector, "audits"):
            op.create_index("ix_audits_leader_id", "audits", ["leader_id"], unique=False)
        if "users" in inspector.get_table_names() and "ix_users_device_id" not in _index_names(inspector, "users"):
            op.create_index("ix_users_device_id", "users", ["device_id"], unique=False)
    finally:
        if dialect == "postgresql":
            bind.execute(sa.text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})


def downgrade() -> None:
    # Намеренно не удаляем рабочие данные и колонки при rollback baseline-миграции.
    pass
