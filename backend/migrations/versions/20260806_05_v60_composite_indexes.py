"""Composite indexes for SLE v6 dashboard and recent visits.

Revision ID: 20260806_05
Revises: 20260806_04
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260806_05"
down_revision: Union[str, None] = "20260806_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_if_missing(inspector, table, name, columns):
    existing = {item["name"] for item in inspector.get_indexes(table)}
    if name not in existing:
        op.create_index(name, table, columns, unique=False)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    _create_if_missing(inspector, "audits", "ix_audits_dashboard_filter", ["status", "region_id", "auditor_id", "employee_id", "audit_date"])
    _create_if_missing(inspector, "visits", "ix_visits_audit_visit", ["audit_id", "visit_number"])
    _create_if_missing(inspector, "visit_timings", "ix_visit_timings_audit_visit", ["audit_id", "visit_number"])
    _create_if_missing(inspector, "user_regions", "ix_user_regions_region_user", ["region_id", "user_id"])
    _create_if_missing(inspector, "employees", "ix_employees_active_region_name", ["is_active", "region_id", "full_name"])


def downgrade() -> None:
    for table, name in [
        ("employees", "ix_employees_active_region_name"),
        ("user_regions", "ix_user_regions_region_user"),
        ("visit_timings", "ix_visit_timings_audit_visit"),
        ("visits", "ix_visits_audit_visit"),
        ("audits", "ix_audits_dashboard_filter"),
    ]:
        try:
            op.drop_index(name, table_name=table)
        except Exception:
            pass
