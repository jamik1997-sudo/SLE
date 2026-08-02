import enum
import uuid
from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def uid() -> str:
    return str(uuid.uuid4())


class Role(str, enum.Enum):
    admin = "admin"
    manager = "manager"
    leader = "leader"


class AuditStatus(str, enum.Enum):
    draft = "draft"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class Region(Base):
    __tablename__ = "regions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    login: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    regions: Mapped[list["UserRegion"]] = relationship(cascade="all, delete-orphan")


class UserRegion(Base):
    __tablename__ = "user_regions"
    __table_args__ = (UniqueConstraint("user_id", "region_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id", ondelete="CASCADE"), nullable=False)
    region: Mapped[Region] = relationship()


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[str | None] = mapped_column(String(160))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    region: Mapped[Region] = relationship()


class Audit(Base):
    __tablename__ = "audits"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    audit_date: Mapped[date] = mapped_column(Date, default=date.today)
    region_id: Mapped[str] = mapped_column(ForeignKey("regions.id"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id"), nullable=False)
    auditor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[AuditStatus] = mapped_column(Enum(AuditStatus), default=AuditStatus.draft)
    current_visit: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[int] = mapped_column(Integer, default=0)
    total_score: Mapped[float | None] = mapped_column(Float)
    total_percent: Mapped[float | None] = mapped_column(Float)
    level: Mapped[str | None] = mapped_column(String(40))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_saved_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    employee: Mapped[Employee] = relationship()
    auditor: Mapped[User] = relationship()
    region: Mapped[Region] = relationship()
    visits: Mapped[list["Visit"]] = relationship(cascade="all, delete-orphan", order_by="Visit.visit_number")
    answers: Mapped[list["Answer"]] = relationship(cascade="all, delete-orphan")


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (UniqueConstraint("audit_id", "visit_number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    audit_id: Mapped[str] = mapped_column(ForeignKey("audits.id", ondelete="CASCADE"), nullable=False)
    visit_number: Mapped[int] = mapped_column(Integer, nullable=False)
    shop_code: Mapped[str | None] = mapped_column(String(100))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    gps_accuracy: Mapped[float | None] = mapped_column(Float)
    location_received_at: Mapped[datetime | None] = mapped_column(DateTime)
    comment: Mapped[str | None] = mapped_column(Text)


class Answer(Base):
    __tablename__ = "answers"
    __table_args__ = (UniqueConstraint("audit_id", "visit_number", "question_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    audit_id: Mapped[str] = mapped_column(ForeignKey("audits.id", ondelete="CASCADE"), nullable=False)
    visit_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    question_key: Mapped[str] = mapped_column(String(80), nullable=False)
    answer_value: Mapped[str] = mapped_column(String(8), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(80))
    details: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    user: Mapped[User | None] = relationship()


class QuestionSetting(Base):
    __tablename__ = "question_settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    section: Mapped[str] = mapped_column(String(160), nullable=False)
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False)
    text_ru: Mapped[str] = mapped_column(Text, nullable=False)
    text_uz: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class ScoreSetting(Base):
    __tablename__ = "score_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    confident_min: Mapped[float] = mapped_column(Float, default=65.0)
    master_min: Mapped[float] = mapped_column(Float, default=85.0)


class VisitTiming(Base):
    __tablename__ = "visit_timings"
    __table_args__ = (UniqueConstraint("audit_id", "visit_number"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    audit_id: Mapped[str] = mapped_column(ForeignKey("audits.id", ondelete="CASCADE"), nullable=False, index=True)
    visit_number: Mapped[int] = mapped_column(Integer, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
