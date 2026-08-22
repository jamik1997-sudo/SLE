"""Add indexes used by dashboard and audit lists.

Revision ID: 20260806_04
Revises: 20260805_03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "20260806_04"
down_revision: Union[str, None] = "20260805_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = {item["name"] for item in inspector.get_indexes("audits")}
    indexes = [
        ("ix_audits_status_submitted", ["status", "submitted_at"]),
        ("ix_audits_status_date", ["status", "audit_date"]),
        ("ix_audits_region_status_date", ["region_id", "status", "audit_date"]),
        ("ix_audits_auditor_status", ["auditor_id", "status"]),
        ("ix_audits_employee_status", ["employee_id", "status"]),
        ("ix_audits_last_saved_at", ["last_saved_at"]),
    ]
    for name, columns in indexes:
        if name not in existing:
            op.create_index(name, "audits", columns, unique=False)

    answer_existing = {item["name"] for item in inspector.get_indexes("answers")}
    if "ix_answers_audit_question_visit" not in answer_existing:
        op.create_index("ix_answers_audit_question_visit", "answers", ["audit_id", "question_key", "visit_number"], unique=False)


def downgrade() -> None:
    for name in [
        "ix_answers_audit_question_visit", "ix_audits_last_saved_at",
        "ix_audits_employee_status", "ix_audits_auditor_status",
        "ix_audits_region_status_date", "ix_audits_status_date",
        "ix_audits_status_submitted",
    ]:
        try:
            op.drop_index(name)
        except Exception:
            pass
