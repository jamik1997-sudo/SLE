from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import Answer, Audit, AuditStatus, Employee, Role, User, Visit, QuestionSetting, ScoreSetting, ActivityLog
from app.questionnaire import QUESTION_MAP, QUESTIONS
from app.schemas import AnswerSave, AuditCreate, ProgressSave, VisitSave, BatchSyncIn
from app.security import current_user
from app.services.scoring import calculate

router = APIRouter(prefix="/audits", tags=["audits"])


def allowed_regions(user: User) -> set[str]:
    return {x.region_id for x in user.regions}


def load_audit(db: Session, audit_id: str) -> Audit:
    audit = db.scalar(select(Audit).where(Audit.id == audit_id).options(selectinload(Audit.visits), selectinload(Audit.answers), selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor)))
    if not audit:
        raise HTTPException(404, "Аудит не найден")
    return audit


def load_audit_basic(db: Session, audit_id: str) -> Audit:
    audit = db.get(Audit, audit_id)
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
def questionnaire(db: Session = Depends(get_db), _: User = Depends(current_user)):
    rows=db.scalars(select(QuestionSetting).where(QuestionSetting.is_active==True).order_by(QuestionSetting.sort_order)).all()
    if not rows: return QUESTIONS
    return [{"key":q.key,"section":q.section,"step":q.step,"weight":q.weight,"allow_na":False,"text":q.text_ru,"text_uz":q.text_uz,"is_active":q.is_active} for q in rows]


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
def list_audits(limit: int = 100, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = select(Audit).options(selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor)).order_by(Audit.last_saved_at.desc())
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    rows = db.scalars(stmt.limit(min(max(limit, 1), 500))).all()
    return [{"id":a.id,"audit_date":a.audit_date,"status":a.status.value,"current_visit":a.current_visit,"current_step":a.current_step,"total_percent":a.total_percent,"level":a.level,"employee_name":a.employee.full_name,"region_name":a.region.name,"last_saved_at":a.last_saved_at,"auditor_id":a.auditor_id,"auditor_name":a.auditor.full_name,"is_mine":a.auditor_id == user.id} for a in rows]


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(current_user)):
    stmt = (
        select(Audit)
        .options(selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor))
        .where(Audit.status == AuditStatus.completed)
        .order_by(Audit.submitted_at.desc())
    )
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    rows = db.scalars(stmt).all()

    total = len(rows)
    average = round(sum((a.total_percent or 0) for a in rows) / total, 1) if total else 0
    levels = {"Базовый": 0, "Уверенный": 0, "Мастер": 0}
    region_map = {}
    employee_map = {}
    month_map = {}
    for a in rows:
        levels[a.level or "Базовый"] = levels.get(a.level or "Базовый", 0) + 1
        region = region_map.setdefault(a.region.name, {"sum": 0.0, "count": 0})
        region["sum"] += a.total_percent or 0
        region["count"] += 1
        employee = employee_map.setdefault(a.employee.full_name, {"sum": 0.0, "count": 0, "region": a.region.name})
        employee["sum"] += a.total_percent or 0
        employee["count"] += 1
        month_key = a.audit_date.strftime("%Y-%m")
        month = month_map.setdefault(month_key, {"sum": 0.0, "count": 0})
        month["sum"] += a.total_percent or 0
        month["count"] += 1

    regions = sorted([
        {"name": name, "average": round(v["sum"] / v["count"], 1), "count": v["count"]}
        for name, v in region_map.items()
    ], key=lambda x: (-x["average"], x["name"]))
    employees = sorted([
        {"name": name, "region": v["region"], "average": round(v["sum"] / v["count"], 1), "count": v["count"]}
        for name, v in employee_map.items()
    ], key=lambda x: (-x["average"], -x["count"], x["name"]))[:10]
    months = sorted([
        {"month": name, "average": round(v["sum"] / v["count"], 1), "count": v["count"]}
        for name, v in month_map.items()
    ], key=lambda x: x["month"])[-12:]
    recent = [
        {
            "id": a.id, "audit_date": a.audit_date, "employee_name": a.employee.full_name,
            "region_name": a.region.name, "auditor_name": a.auditor.full_name,
            "total_percent": a.total_percent, "level": a.level,
        } for a in rows[:10]
    ]
    return {
        "total": total, "average": average, "levels": levels, "regions": regions,
        "employees": employees, "months": months, "recent": recent,
    }


@router.post("")
def create_audit(payload: AuditCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    employee = db.get(Employee, payload.employee_id)
    if not employee:
        raise HTTPException(404, "Сотрудник не найден")
    region_id = payload.region_id or employee.region_id
    if employee.region_id != region_id:
        raise HTTPException(400, "Сотрудник относится к другому региону")
    ensure_region_access(user, region_id)
    audit = Audit(audit_date=payload.audit_date, employee_id=employee.id, region_id=region_id, auditor_id=user.id)
    db.add(audit); db.flush()
    for n in range(1, 6):
        db.add(Visit(audit_id=audit.id, visit_number=n))
    db.add(ActivityLog(user_id=user.id,action="Создал аудит",entity_type="audit",entity_id=audit.id,details=employee.full_name))
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
    audit = load_audit_basic(db, audit_id); ensure_access(user, audit, write=True)
    if audit.status == AuditStatus.completed: raise HTTPException(400, "Аудит завершён")
    visit = db.scalar(select(Visit).where(Visit.audit_id == audit.id, Visit.visit_number == visit_number))
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(visit, key, value)
    if payload.latitude is not None: visit.location_received_at = datetime.utcnow()
    audit.status = AuditStatus.in_progress; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.put("/{audit_id}/answer")
def save_answer(audit_id: str, payload: AnswerSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit_basic(db, audit_id); ensure_access(user, audit, write=True)
    q = QUESTION_MAP.get(payload.question_key)
    if not q: raise HTTPException(400, "Неизвестный вопрос")
    if payload.answer_value not in ["1", "0"]: raise HTTPException(400, "Недопустимый ответ")
    answer = db.scalar(select(Answer).where(Answer.audit_id == audit.id, Answer.visit_number == payload.visit_number, Answer.question_key == payload.question_key))
    if not answer:
        answer = Answer(audit_id=audit.id, visit_number=payload.visit_number, question_key=payload.question_key, answer_value=payload.answer_value)
        db.add(answer)
    answer.answer_value = payload.answer_value; answer.comment = payload.comment
    audit.status = AuditStatus.in_progress; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.put("/{audit_id}/progress")
def progress(audit_id: str, payload: ProgressSave, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit_basic(db, audit_id); ensure_access(user, audit, write=True)
    audit.current_visit = payload.current_visit; audit.current_step = payload.current_step; audit.last_saved_at = datetime.utcnow()
    db.commit(); return {"saved": True}


@router.put("/{audit_id}/sync")
def batch_sync(audit_id: str, payload: BatchSyncIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit_basic(db, audit_id); ensure_access(user, audit, write=True)
    if audit.status == AuditStatus.completed:
        raise HTTPException(400, "Аудит завершён")

    if payload.answers:
        keys = [(a.visit_number, a.question_key) for a in payload.answers]
        existing = db.scalars(select(Answer).where(Answer.audit_id == audit.id)).all()
        answer_map = {(a.visit_number, a.question_key): a for a in existing}
        for item in payload.answers:
            q = QUESTION_MAP.get(item.question_key)
            if not q:
                raise HTTPException(400, f"Неизвестный вопрос: {item.question_key}")
            if item.answer_value not in ["1", "0"]:
                raise HTTPException(400, "Недопустимый ответ")
            obj = answer_map.get((item.visit_number, item.question_key))
            if not obj:
                obj = Answer(audit_id=audit.id, visit_number=item.visit_number, question_key=item.question_key, answer_value=item.answer_value)
                db.add(obj)
                answer_map[(item.visit_number, item.question_key)] = obj
            obj.answer_value = item.answer_value
            obj.comment = item.comment

    if payload.visit_number is not None and payload.visit is not None:
        visit = db.scalar(select(Visit).where(Visit.audit_id == audit.id, Visit.visit_number == payload.visit_number))
        if not visit:
            raise HTTPException(404, "Визит не найден")
        for key, value in payload.visit.model_dump(exclude_unset=True).items():
            setattr(visit, key, value)
        if payload.visit.latitude is not None:
            visit.location_received_at = datetime.utcnow()

    if payload.current_visit is not None:
        audit.current_visit = payload.current_visit
    if payload.current_step is not None:
        audit.current_step = payload.current_step
    audit.status = AuditStatus.in_progress
    audit.last_saved_at = datetime.utcnow()
    db.commit()
    return {"saved": True, "at": audit.last_saved_at}


@router.post("/{audit_id}/submit")
def submit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    audit = load_audit(db, audit_id); ensure_access(user, audit, write=True)
    qrows = db.scalars(select(QuestionSetting).where(QuestionSetting.is_active == True).order_by(QuestionSetting.sort_order)).all()
    questions = [{"key":q.key,"section":q.section,"step":q.step,"weight":q.weight,"is_active":q.is_active} for q in qrows] or QUESTIONS
    answer_map = {(a.visit_number, a.question_key): a for a in audit.answers}
    missing = []
    for q in questions:
        visits = [0] if q["step"] in (0, 8) else range(1, 6)
        for n in visits:
            if (n, q["key"]) not in answer_map: missing.append(f"{n}:{q['key']}")
    for v in audit.visits:
        if not v.shop_code: missing.append(f"visit:{v.visit_number}")
    if missing: raise HTTPException(422, detail={"message":"Аудит заполнен не полностью","missing":missing})
    ss = db.get(ScoreSetting, 1) or ScoreSetting(id=1)
    total, percent, level, sections = calculate(audit, questions, ss.confident_min, ss.master_min)
    audit.total_score=total; audit.total_percent=percent; audit.level=level; audit.status=AuditStatus.completed; audit.submitted_at=datetime.utcnow(); audit.last_saved_at=datetime.utcnow()
    db.add(ActivityLog(user_id=user.id,action="Завершил аудит",entity_type="audit",entity_id=audit.id,details=f"{percent}% {level}"))
    db.commit(); return {"total_score":total,"total_percent":percent,"level":level,"sections":sections}
