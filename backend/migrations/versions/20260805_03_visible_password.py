"""Add privileged password display field.

Revision ID: 20260805_03
Revises: 20260804_02
Create Date: 2026-08-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260805_03"
down_revision: Union[str, None] = "20260804_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" in inspector.get_table_names():
        columns = {c["name"] for c in inspector.get_columns("users")}
        if "password_visible" not in columns:
            op.add_column("users", sa.Column("password_visible", sa.String(255), nullable=True))


def downgrade() -> None:
    # Intentionally keep the column to avoid losing credentials set in production.
    pass
