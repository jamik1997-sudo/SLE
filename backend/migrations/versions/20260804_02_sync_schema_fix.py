"""Ensure sync-related columns exist after v3.4.0.

Revision ID: 20260804_02
Revises: 20260804_01
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260804_02"
down_revision: Union[str, None] = "20260804_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LOCK_KEY = 734003402


def _tables(inspector: sa.Inspector) -> set[str]:
    return set(inspector.get_table_names())


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in _tables(inspector):
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in _tables(inspector):
        return set()
    return {index["name"] for index in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        bind.execute(sa.text("SELECT pg_advisory_lock(:key)"), {"key": LOCK_KEY})

    try:
        inspector = sa.inspect(bind)

        # The first baseline revision may already be marked as applied in an
        # existing database. This follow-up revision therefore re-checks every
        # column required by the current application instead of relying on a
        # modified old migration being executed again.
        if "visits" in _tables(inspector):
            visit_columns = _columns(inspector, "visits")
            if "shop_name" not in visit_columns:
                op.add_column("visits", sa.Column("shop_name", sa.String(200), nullable=True))
            if "goal" not in visit_columns:
                op.add_column("visits", sa.Column("goal", sa.Text(), nullable=True))

        if "employees" in _tables(inspector):
            employee_columns = _columns(inspector, "employees")
            if "leader_id" not in employee_columns:
                op.add_column("employees", sa.Column("leader_id", sa.String(36), nullable=True))

        if "audits" in _tables(inspector):
            audit_columns = _columns(inspector, "audits")
            if "leader_id" not in audit_columns:
                op.add_column("audits", sa.Column("leader_id", sa.String(36), nullable=True))

        if "users" in _tables(inspector):
            user_columns = _columns(inspector, "users")
            if "device_id" not in user_columns:
                op.add_column("users", sa.Column("device_id", sa.String(120), nullable=True))
            if "device_name" not in user_columns:
                op.add_column("users", sa.Column("device_name", sa.String(240), nullable=True))
            if "device_bound_at" not in user_columns:
                op.add_column("users", sa.Column("device_bound_at", sa.DateTime(), nullable=True))

        if dialect == "postgresql":
            # Safe whether or not the enum value was already added.
            with op.get_context().autocommit_block():
                op.execute("ALTER TYPE role ADD VALUE IF NOT EXISTS 'auditor'")

        inspector = sa.inspect(bind)
        if "employees" in _tables(inspector) and "ix_employees_leader_id" not in _indexes(inspector, "employees"):
            op.create_index("ix_employees_leader_id", "employees", ["leader_id"], unique=False)
        if "audits" in _tables(inspector) and "ix_audits_leader_id" not in _indexes(inspector, "audits"):
            op.create_index("ix_audits_leader_id", "audits", ["leader_id"], unique=False)
        if "users" in _tables(inspector) and "ix_users_device_id" not in _indexes(inspector, "users"):
            op.create_index("ix_users_device_id", "users", ["device_id"], unique=False)
    finally:
        if dialect == "postgresql":
            bind.execute(sa.text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})


def downgrade() -> None:
    # Compatibility migration intentionally keeps production data/columns.
    pass
