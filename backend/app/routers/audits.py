from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import Answer, Audit, AuditStatus, Employee, Role, User, Visit
from app.questionnaire import QUESTION_MAP, QUESTIONS
from app.schemas import AnswerSave, AuditCreate, ProgressSave, VisitSave
from app.security import current_user
from app.services.scoring import calculate

router = APIRouter(prefix="/audits", tags=["audits"])


def allowed_regions(user: User) -> set[str]:
    return {x.region_id for x in user.regions}


def load_audit(db: Session, audit_id: str) -> Audit:
    audit = db.scalar(select(Audit).where(Audit.id == audit_id).options(selectinload(Audit.visits), selectinload(Audit.answers), selectinload(Audit.employee), selectinload(Audit.region)))
    if not audit:
        raise HTTPException(404, "Аудит не найден")
    return audit


def ensure_region_access(user: User, region_id: str):
    if user.role == Role.leader and region_id not in allowed_regions(user):
        raise HTTPException(403, "Нет доступа к региону")


def ensure_access(user: User, audit: Audit, *, write: bool = False):
    # Администратор и менеджер имеют доступ по всей республике.
    ensure_region_access(user, audit.region_id)
    # Руководитель может просматривать данные своего региона, но менять только собственный аудит.
    if write and user.role == Role.leader and audit.auditor_id != user.id:
        raise HTTPException(403, "Можно изменять только собственный аудит")


@router.get("/questionnaire")
def questionnaire(_: User = Depends(current_user)):
    return QUESTIONS


@router.get("/regions")
def regions(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.models import Region
    stmt = select(Region).where(Region.is_active == True).order_by(Region.name)
    if user.role == Role.leader:
        stmt = stmt.where(Region.id.in_(allowed_regions(user)))
    return db.scalars(stmt).all()


@router.get("/employees")
def employees(region_id: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ids = allowed_regions(user)
    if user.role == Role.leader:
        if region_id and region_id not in ids:
            raise HTTPException(403, "Регион не закреплён")
        region_ids = [region_id] if region_id else list(ids)
    else:
        # Администратор и менеджер могут выбирать любой регион.
        region_ids = [region_id] if region_id else []
    stmt = select(Employee).where(Employee.is_active == True)
    if region_ids:
        stmt = stmt.where(Employee.region_id.in_(region_ids))
    return db.scalars(stmt.order_by(Employee.full_name)).all()


@router.get("")
def list_audits(db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(Audit).options(selectinload(Audit.employee), selectinload(Audit.region)).order_by(Audit.last_saved_at.desc())
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    rows = db.scalars(stmt).all()
    return [{"id":a.id,"audit_date":a.audit_date,"status":a.status.value,"current_visit":a.current_visit,"current_step":a.current_step,"total_percent":a.total_percent,"level":a.level,"employee_name":a.employee.full_name,"region_name":a.region.name,"last_saved_at":a.last_saved_at,"auditor_id":a.auditor_id,"is_mine":a.auditor_id == user.id} for a in rows]


@router.post("")
def create_audit(payload: AuditCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    employee = db.get(Employee, payload.employee_id)
    if not employee:
        raise HTTPException(404, "Сотрудник не найден")
    region_id = payload.region_id or employee.region_id
    if employee.region_id != region_id:
        raise HTTPException(400, "Сотрудник относится к другому региону")
    ensure_region_access(user, region_id)
    existing = db.scalar(select(Audit).where(Audit.auditor_id == user.id, Audit.status.in_([AuditStatus.draft, AuditStatus.in_progress])))
    if existing:
        raise HTTPException(409, detail={"message":"Есть незавершённый аудит","audit_id":existing.id})
    audit = Audit(audit_date=payload.audit_date, employee_id=employee.id, region_id=region_id, auditor_id=user.id)
    db.add(audit); db.flush()
    for n in range(1, 6):
        db.add(Visit(audit_id=audit.id, visit_number=n))
    db.commit()
    return {"id": audit.id}


@router.get("/{audit_id}")
def get_audit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit)
    return {
        "id":audit.id,"audit_date":audit.audit_date,"region_id":audit.region_id,"region_name":audit.region.name,
        "employee_id":audit.employee_id,"employee_name":audit.employee.full_name,"status":audit.status.value,
        "current_visit":audit.current_visit,"current_step":audit.current_step,"total_score":audit.total_score,
        "total_percent":audit.total_percent,"level":audit.level,
        "visits":[{"visit_number":v.visit_number,"shop_code":v.shop_code,"latitude":v.latitude,"longitude":v.longitude,"gps_accuracy":v.gps_accuracy,"comment":v.comment} for v in audit.visits],
        "answers":[{"visit_number":a.visit_number,"question_key":a.question_key,"answer_value":a.answer_value,"comment":a.comment} for a in audit.answers],
    }


@router.put("/{audit_id}/visits/{visit_number}")
def save_visit(audit_id: str, visit_number: int, payload: VisitSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit, write=True)
    if audit.status == AuditStatus.completed: raise HTTPException(400, "Аудит завершён")
    visit = db.scalar(select(Visit).where(Visit.audit_id == audit.id, Visit.visit_number == visit_number))
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(visit, key, value)
    if payload.latitude is not None: visit.location_received_at = datetime.utcnow()
    audit.status = AuditStatus.in_progress; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.put("/{audit_id}/answer")
def save_answer(audit_id: str, payload: AnswerSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit, write=True)
    q = QUESTION_MAP.get(payload.question_key)
    if not q: raise HTTPException(400, "Неизвестный вопрос")
    if payload.answer_value not in (["1","0","N/A"] if q["allow_na"] else ["1","0"]): raise HTTPException(400, "Недопустимый ответ")
    if payload.answer_value in ["0","N/A"] and not (payload.comment or "").strip(): raise HTTPException(422, "Для ответа 0 или N/A обязателен комментарий")
    answer = db.scalar(select(Answer).where(Answer.audit_id == audit.id, Answer.visit_number == payload.visit_number, Answer.question_key == payload.question_key))
    if not answer:
        answer = Answer(audit_id=audit.id, visit_number=payload.visit_number, question_key=payload.question_key, answer_value=payload.answer_value)
        db.add(answer)
    answer.answer_value = payload.answer_value; answer.comment = payload.comment
    audit.status = AuditStatus.in_progress; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.put("/{audit_id}/progress")
def progress(audit_id: str, payload: ProgressSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit, write=True)
    audit.current_visit = payload.current_visit; audit.current_step = payload.current_step; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.post("/{audit_id}/submit")
def submit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit, write=True)
    answer_map = {(a.visit_number, a.question_key): a for a in audit.answers}
    missing = []
    for q in QUESTIONS:
        visits = [0] if q["step"] in (0, 8) else range(1, 6)
        for n in visits:
            if (n, q["key"]) not in answer_map: missing.append(f"{n}:{q['key']}")
    for v in audit.visits:
        if not v.shop_code or v.latitude is None or v.longitude is None: missing.append(f"visit:{v.visit_number}")
    if missing: raise HTTPException(422, detail={"message":"Аудит заполнен не полностью","missing":missing})
    total, percent, level, sections = calculate(audit)
    audit.total_score=total; audit.total_percent=percent; audit.level=level; audit.status=AuditStatus.completed; audit.submitted_at=datetime.utcnow(); audit.last_saved_at=datetime.utcnow()
    db.commit(); return {"total_score":total,"total_percent":percent,"level":level,"sections":sections}
