from datetime import date, datetime
from pydantic import BaseModel, Field
from app.models import Role


class LoginIn(BaseModel):
    login: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class RegionOut(BaseModel):
    id: str
    name: str
    model_config = {"from_attributes": True}


class UserOut(BaseModel):
    id: str
    full_name: str
    login: str
    role: Role
    is_active: bool
    regions: list[RegionOut] = []


class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    login: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8)
    role: Role
    region_ids: list[str] = []


class EmployeeOut(BaseModel):
    id: str
    full_name: str
    position: str | None
    region_id: str
    model_config = {"from_attributes": True}


class AuditCreate(BaseModel):
    audit_date: date
    employee_id: str
    region_id: str | None = None


class VisitSave(BaseModel):
    shop_code: str | None = None
    shop_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    gps_accuracy: float | None = None
    comment: str | None = None


class AnswerSave(BaseModel):
    visit_number: int = 0
    question_key: str
    answer_value: str
    comment: str | None = None


class ProgressSave(BaseModel):
    current_visit: int
    current_step: int


class AuditListOut(BaseModel):
    id: str
    audit_date: date
    status: str
    current_visit: int
    current_step: int
    total_percent: float | None
    level: str | None
    employee_name: str
    region_name: str
    last_saved_at: datetime


class BatchSyncIn(BaseModel):
    answers: list[AnswerSave] = []
    visit_number: int | None = None
    visit: VisitSave | None = None
    current_visit: int | None = None
    current_step: int | None = None
