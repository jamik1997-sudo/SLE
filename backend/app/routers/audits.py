from datetime import datetime, date
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, text
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.database import get_db
from app.models import Answer, Audit, AuditStatus, Employee, Region, Role, User, Visit, VisitTiming, QuestionSetting, ScoreSetting, ActivityLog
from app.questionnaire import QUESTION_MAP, QUESTIONS
from app.schemas import AnswerSave, AuditCreate, ProgressSave, VisitSave, BatchSyncIn
from app.security import current_user
from app.services.scoring import calculate
from app.cache import get_cache, set_cache, clear_cache

router = APIRouter(prefix="/audits", tags=["audits"])
sync_logger = logging.getLogger("sle.sync")


def allowed_regions(user: User) -> set[str]:
    return {x.region_id for x in user.regions}


def load_audit(db: Session, audit_id: str) -> Audit:
    audit = db.scalar(select(Audit).where(Audit.id == audit_id).options(selectinload(Audit.visits), selectinload(Audit.answers), selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor), selectinload(Audit.leader)))
    if not audit:
        raise HTTPException(404, "Аудит не найден")
    return audit


def load_audit_basic(db: Session, audit_id: str) -> Audit:
    audit = db.get(Audit, audit_id)
    if not audit:
        raise HTTPException(404, "Аудит не найден")
    return audit


def purge_stale_drafts(db: Session) -> list[str]:
    """Полностью удаляет незавершённые аудиты прошлых дней по времени Ташкента."""
    from zoneinfo import ZoneInfo

    today = datetime.now(ZoneInfo("Asia/Tashkent")).date()
    stale_ids = list(db.scalars(
        select(Audit.id).where(
            Audit.status.in_([AuditStatus.draft, AuditStatus.in_progress]),
            Audit.audit_date < today,
        )
    ).all())
    if not stale_ids:
        return []

    db.execute(delete(Answer).where(Answer.audit_id.in_(stale_ids)))
    db.execute(delete(VisitTiming).where(VisitTiming.audit_id.in_(stale_ids)))
    db.execute(delete(Visit).where(Visit.audit_id.in_(stale_ids)))
    db.execute(delete(Audit).where(Audit.id.in_(stale_ids)))
    db.commit()
    clear_cache()
    return stale_ids


def ensure_region_access(user: User, region_id: str):
    if user.role == Role.leader and region_id not in allowed_regions(user):
        raise HTTPException(403, "Нет доступа к региону")


def ensure_access(user: User, audit: Audit, *, write: bool = False):
    # Администратор и менеджер имеют доступ по всей республике.
    ensure_region_access(user, audit.region_id)
    # Руководитель может просматривать данные своего региона, но менять только собственный аудит.
    if write and user.role in (Role.leader, Role.auditor) and audit.auditor_id != user.id:
        raise HTTPException(403, "Можно изменять только собственный аудит")


@router.get("/questionnaire")
def questionnaire(db: Session = Depends(get_db), _: User = Depends(current_user)):
    cached = get_cache("questionnaire")
    if cached is not None:
        return cached
    rows=db.scalars(select(QuestionSetting).where(QuestionSetting.is_active==True).order_by(QuestionSetting.sort_order)).all()
    result = QUESTIONS if not rows else [{"key":q.key,"section":q.section,"step":q.step,"weight":q.weight,"allow_na":False,"text":q.text_ru,"text_uz":q.text_uz,"is_active":q.is_active} for q in rows]
    return set_cache("questionnaire", result, ttl=300)


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
    purge_stale_drafts(db)
    stmt = select(Audit).options(selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor), selectinload(Audit.leader)).where(Audit.status != AuditStatus.cancelled).order_by(Audit.last_saved_at.desc())
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    rows = db.scalars(stmt.limit(min(max(limit, 1), 500))).all()
    return [{"id":a.id,"audit_date":a.audit_date,"status":a.status.value,"current_visit":a.current_visit,"current_step":a.current_step,"total_percent":a.total_percent,"level":a.level,"employee_name":a.employee.full_name,"region_name":a.region.name,"last_saved_at":a.last_saved_at,"auditor_id":a.auditor_id,"auditor_name":a.auditor.full_name,"leader_id":a.leader_id,"leader_name":a.leader.full_name if a.leader else a.auditor.full_name,"is_mine":a.auditor_id == user.id} for a in rows]


@router.delete("/{audit_id}")
def delete_audit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Полное удаление аудита доступно только администратору."""
    if user.role != Role.admin:
        raise HTTPException(403, "Удалять аудиты может только администратор")

    audit = load_audit_basic(db, audit_id)
    employee = db.get(Employee, audit.employee_id)
    employee_name = employee.full_name if employee else "—"
    audit_date = str(audit.audit_date)

    try:
        # Явное удаление дочерних записей работает и для старых баз,
        # где внешние ключи могли быть созданы без ON DELETE CASCADE.
        db.execute(delete(Answer).where(Answer.audit_id == audit_id))
        db.execute(delete(VisitTiming).where(VisitTiming.audit_id == audit_id))
        db.execute(delete(Visit).where(Visit.audit_id == audit_id))
        db.execute(delete(Audit).where(Audit.id == audit_id))

        db.add(ActivityLog(
            user_id=user.id,
            action="Удалил аудит",
            entity_type="audit",
            entity_id=audit_id,
            details=f"{audit_date} · {employee_name}",
        ))
        db.commit()
        clear_cache()
        return {"deleted": True, "id": audit_id}
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(500, "Не удалось удалить аудит") from exc


@router.get("/dashboard")
def dashboard(region_id: str | None = None, auditor_id: str | None = None, employee_id: str | None = None, month: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    cache_key = f"dashboard:{user.id}:{region_id or ''}:{auditor_id or ''}:{employee_id or ''}:{month or ''}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached
    stmt = (
        select(Audit)
        .options(selectinload(Audit.employee), selectinload(Audit.region), selectinload(Audit.auditor), selectinload(Audit.leader), selectinload(Audit.answers), selectinload(Audit.visits))
        .where(Audit.status == AuditStatus.completed)
        .order_by(Audit.submitted_at.desc())
    )
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    if region_id:
        ensure_region_access(user, region_id)
        stmt = stmt.where(Audit.region_id == region_id)
    if auditor_id:
        stmt = stmt.where(Audit.auditor_id == auditor_id)
    if employee_id:
        stmt = stmt.where(Audit.employee_id == employee_id)
    if month:
        try:
            year, month_num = map(int, month.split("-"))
            from datetime import date
            start = date(year, month_num, 1)
            end = date(year + (month_num == 12), 1 if month_num == 12 else month_num + 1, 1)
            stmt = stmt.where(Audit.audit_date >= start, Audit.audit_date < end)
        except Exception as error:
            raise HTTPException(422, "Месяц должен быть в формате ГГГГ-ММ") from error
    rows = db.scalars(stmt).all()

    total = len(rows)
    average = round(sum((a.total_percent or 0) for a in rows) / total, 1) if total else 0
    levels = {"Базовый": 0, "Уверенный": 0, "Мастер": 0}
    region_map = {}
    employee_map = {}
    month_map = {}

    # Результаты по блокам. Для визитных блоков количество оценок —
    # число отдельных визитов, попавших под выбранные фильтры.
    qrows = db.scalars(
        select(QuestionSetting)
        .where(QuestionSetting.is_active == True)
        .order_by(QuestionSetting.sort_order)
    ).all()
    qmap = {q.key: q for q in qrows}
    def merged_section(name: str) -> str:
        # Короткие названия используются только в Dashboard/аналитике.
        # Исходные названия разделов в опроснике остаются без изменений.
        aliases = {
            "Подготовка к визиту": "Подготовка",
            "Вступление": "Представление",
            "Осмотр": "Осмотр",
            "Презентация": "Предложение",
            "Работа с возражениями": "Предложение",
            "Работа в точке": "Работа в точке",
            "Обучение персонала": "Работа в точке",
            "Завершение визита": "Завершение визита",
            "Анализ визита": "Анализ визита",
        }
        return aliases.get(name, name)
    block_map = {}
    for q in qrows:
        if q.step in (0, 8):
            continue
        section = merged_section(q.section)
        block_map.setdefault(section, {
            "section": section,
            "order": q.sort_order,
            "earned": 0.0,
            "possible": 0.0,
            "instances": set(),
        })

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

        for answer in a.answers:
            q = qmap.get(answer.question_key)
            if not q or q.step in (0, 8):
                continue
            section = merged_section(q.section)
            block = block_map.setdefault(section, {
                "section": section,
                "order": q.sort_order,
                "earned": 0.0,
                "possible": 0.0,
                "instances": set(),
            })
            weight = float(q.weight or 0)
            block["possible"] += weight
            if answer.answer_value == "1":
                block["earned"] += weight
            block["instances"].add((a.id, answer.visit_number))

    blocks = sorted([
        {
            "name": item["section"],
            "count": len(item["instances"]),
            "average": round(item["earned"] / item["possible"] * 100, 1) if item["possible"] else 0,
        }
        for item in block_map.values()
    ], key=lambda x: next((v["order"] for v in block_map.values() if v["section"] == x["name"]), 9999))

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
    # Each trading point is returned as a separate row in the recent audits table.
    recent = []
    for a in rows[:10]:
        answers_by_visit = {}
        for ans in a.answers:
            answers_by_visit.setdefault(ans.visit_number, []).append(ans)

        for visit in sorted(a.visits, key=lambda item: item.visit_number):
            visit_answers = answers_by_visit.get(visit.visit_number, [])
            section_scores = {}
            earned = 0.0
            possible = 0.0

            for ans in visit_answers:
                q = qmap.get(ans.question_key)
                if not q or q.step in (0, 8):
                    continue
                weight = float(q.weight or 0)
                section_name = merged_section(q.section)
                bucket = section_scores.setdefault(section_name, {"earned": 0.0, "possible": 0.0})
                bucket["possible"] += weight
                possible += weight
                if ans.answer_value == "1":
                    bucket["earned"] += weight
                    earned += weight

            growth = "—"
            if section_scores:
                growth = min(
                    section_scores.items(),
                    key=lambda item: (
                        item[1]["earned"] / item[1]["possible"]
                        if item[1]["possible"] else 1
                    ),
                )[0]

            visit_percent = round(earned / possible * 100, 1) if possible else 0
            location_url = (
                f"https://maps.google.com/?q={visit.latitude},{visit.longitude}"
                if visit.latitude is not None and visit.longitude is not None
                else None
            )
            recent.append({
                "id": a.id,
                "visit_number": visit.visit_number,
                "audit_date": a.audit_date,
                "shop_code": visit.shop_code or "—",
                "total_percent": visit_percent,
                "audit_percent": a.total_percent,
                "growth_zone": growth,
                "latitude": visit.latitude,
                "longitude": visit.longitude,
                "location_url": location_url,
            })
    region_stmt = select(Region).where(Region.is_active == True).order_by(Region.name)
    if user.role == Role.leader:
        region_stmt = region_stmt.where(Region.id.in_(allowed_regions(user)))
    option_regions = db.scalars(region_stmt).all()
    auditor_stmt = select(User).where(User.is_active == True, User.role.in_([Role.leader, Role.auditor, Role.manager, Role.admin])).order_by(User.full_name)
    if user.role == Role.leader:
        auditor_stmt = auditor_stmt.where(User.id == user.id)
    option_auditors = db.scalars(auditor_stmt).all()
    employee_stmt = select(Employee).where(Employee.is_active == True).order_by(Employee.full_name)
    if user.role == Role.leader:
        employee_stmt = employee_stmt.where(Employee.region_id.in_(allowed_regions(user)))
    if region_id:
        employee_stmt = employee_stmt.where(Employee.region_id == region_id)
    option_employees = db.scalars(employee_stmt).all()
    month_stmt = select(Audit).where(Audit.status == AuditStatus.completed)
    if user.role == Role.leader:
        month_stmt = month_stmt.where(Audit.region_id.in_(allowed_regions(user)))
    month_options = sorted({a.audit_date.strftime("%Y-%m") for a in db.scalars(month_stmt).all()}, reverse=True)
    result = {
        "total": total, "average": average, "levels": levels, "regions": regions,
        "employees": employees, "months": months, "recent": recent, "blocks": blocks,
        "filters": {
            "regions": [{"id": x.id, "name": x.name} for x in option_regions],
            "auditors": [{"id": x.id, "name": x.full_name} for x in option_auditors],
            "employees": [{"id": x.id, "name": x.full_name, "region_id": x.region_id} for x in option_employees],
            "months": month_options,
            "selected": {"region_id": region_id, "auditor_id": auditor_id, "employee_id": employee_id, "month": month},
        },
    }
    return set_cache(cache_key, result, ttl=30)


@router.post("")
def create_audit(payload: AuditCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    purge_stale_drafts(db)
    employee=db.get(Employee,payload.employee_id)
    if not employee or not employee.is_active: raise HTTPException(404,"Сотрудник не найден")
    region_id=payload.region_id or employee.region_id
    if employee.region_id!=region_id: raise HTTPException(400,"Сотрудник относится к другому региону")
    ensure_region_access(user,region_id)
    if user.role==Role.leader:
        leader_id=user.id
        if employee.leader_id and employee.leader_id!=user.id: raise HTTPException(403,"Сотрудник закреплён за другим руководителем")
    else:
        # Руководитель сотрудника определяется автоматически; отдельного выбора в форме нет.
        leader_id=employee.leader_id
    leader=db.get(User,leader_id) if leader_id else None
    if leader and (leader.role!=Role.leader or not leader.is_active): raise HTTPException(422,"У сотрудника указан недействительный руководитель")
    # Дата всегда устанавливается сервером по часовому поясу Узбекистана.
    from zoneinfo import ZoneInfo
    today_tashkent=datetime.now(ZoneInfo("Asia/Tashkent")).date()
    audit=Audit(audit_date=today_tashkent,employee_id=employee.id,region_id=region_id,auditor_id=user.id,leader_id=leader_id)
    db.add(audit);db.flush()
    for n in range(1,6): db.add(Visit(audit_id=audit.id,visit_number=n))
    db.add(ActivityLog(user_id=user.id,action="Создал аудит",entity_type="audit",entity_id=audit.id,details=employee.full_name));db.commit();clear_cache("dashboard:");return {"id":audit.id}


@router.get("/{audit_id}")
def get_audit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    deleted_ids = purge_stale_drafts(db)
    if audit_id in deleted_ids:
        raise HTTPException(410, "Незавершённый аудит прошлого дня удалён автоматически")
    audit = load_audit(db, audit_id); ensure_access(user, audit)
    return {
        "id":audit.id,"audit_date":audit.audit_date,"region_id":audit.region_id,"region_name":audit.region.name,
        "employee_id":audit.employee_id,"employee_name":audit.employee.full_name,"leader_id":audit.leader_id,"leader_name":audit.leader.full_name if audit.leader else None,"status":audit.status.value,
        "current_visit":audit.current_visit,"current_step":audit.current_step,"total_score":audit.total_score,
        "total_percent":audit.total_percent,"level":audit.level,
        "visits":[{"visit_number":v.visit_number,"shop_code":v.shop_code,"goal":v.goal,"latitude":v.latitude,"longitude":v.longitude,"gps_accuracy":v.gps_accuracy,"comment":v.comment} for v in audit.visits],
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
    """Safely persist one audit step without relying on a PostgreSQL ON CONFLICT index.

    Some production databases were created by older project versions and do not
    have the composite unique constraint expected by ``ON CONFLICT``.  A plain
    select/update/insert path is compatible with every previous schema and also
    keeps repeated autosave requests idempotent.
    """
    audit = load_audit_basic(db, audit_id)
    ensure_access(user, audit, write=True)
    if audit.status == AuditStatus.completed:
        raise HTTPException(400, "Аудит завершён")

    try:
        # Serialize autosave requests for the same audit. Mobile browsers can
        # dispatch answer and visit-field saves almost simultaneously. Without
        # a per-audit transaction lock, two requests may both decide that an
        # answer does not exist and then collide on the unique constraint.
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:audit_id))"),
                {"audit_id": str(audit_id)},
            )

        # Deduplicate the incoming batch defensively. The last value wins.
        incoming = {}
        for item in payload.answers or []:
            q = QUESTION_MAP.get(item.question_key)
            if not q:
                raise HTTPException(400, f"Неизвестный вопрос: {item.question_key}")
            if item.answer_value not in ("1", "0"):
                raise HTTPException(400, "Недопустимый ответ")
            incoming[(item.visit_number, item.question_key)] = item

        if incoming:
            visit_numbers = {key[0] for key in incoming}
            question_keys = {key[1] for key in incoming}
            existing_rows = db.scalars(
                select(Answer).where(
                    Answer.audit_id == audit.id,
                    Answer.visit_number.in_(visit_numbers),
                    Answer.question_key.in_(question_keys),
                )
            ).all()
            existing = {(row.visit_number, row.question_key): row for row in existing_rows}
            now = datetime.utcnow()

            for key, item in incoming.items():
                answer = existing.get(key)
                if answer is None:
                    answer = Answer(
                        audit_id=audit.id,
                        visit_number=item.visit_number,
                        question_key=item.question_key,
                        answer_value=item.answer_value,
                        comment=item.comment,
                    )
                    db.add(answer)
                    existing[key] = answer
                else:
                    answer.answer_value = item.answer_value
                    answer.comment = item.comment
                answer.updated_at = now

        if payload.visit_number is not None and payload.visit is not None:
            visit = db.scalar(
                select(Visit).where(
                    Visit.audit_id == audit.id,
                    Visit.visit_number == payload.visit_number,
                )
            )
            if not visit:
                raise HTTPException(404, "Визит не найден")

            allowed_visit_fields = {
                "shop_code", "goal", "latitude", "longitude",
                "gps_accuracy", "comment",
            }
            visit_data = payload.visit.model_dump(exclude_unset=True)
            for key, value in visit_data.items():
                if key in allowed_visit_fields:
                    setattr(visit, key, value)
            if "latitude" in visit_data or "longitude" in visit_data:
                if visit.latitude is not None and visit.longitude is not None:
                    visit.location_received_at = datetime.utcnow()

        if payload.current_visit is not None:
            audit.current_visit = payload.current_visit
        if payload.current_step is not None:
            audit.current_step = payload.current_step
        audit.status = AuditStatus.in_progress
        audit.last_saved_at = datetime.utcnow()

        db.commit()
        return {"saved": True, "at": audit.last_saved_at}
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        sync_logger.exception("Integrity error during sync for audit %s", audit_id)
        raise HTTPException(409, "Конфликт сохранения. Обновите аудит и повторите действие") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        sync_logger.exception("Database sync failed for audit %s", audit_id)
        raise HTTPException(500, "Ошибка базы данных при сохранении") from exc
    except Exception as exc:
        db.rollback()
        sync_logger.exception("Unexpected sync failure for audit %s", audit_id)
        raise HTTPException(500, "Не удалось сохранить данные визита") from exc



@router.post("/{audit_id}/submit")
def submit(audit_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # Загружаем аудит и затем читаем ответы/визиты отдельными запросами.
    # Это исключает устаревшие relationship-коллекции после автосохранения.
    audit = load_audit_basic(db, audit_id)
    ensure_access(user, audit, write=True)

    qrows = db.scalars(
        select(QuestionSetting)
        .where(QuestionSetting.is_active == True)
        .order_by(QuestionSetting.sort_order)
    ).all()
    questions = [
        {"key": q.key, "section": q.section, "step": q.step, "weight": q.weight, "is_active": q.is_active}
        for q in qrows
    ] or QUESTIONS

    answers = db.scalars(select(Answer).where(Answer.audit_id == audit.id)).all()
    visits_rows = db.scalars(
        select(Visit).where(Visit.audit_id == audit.id).order_by(Visit.visit_number)
    ).all()
    answer_map = {(a.visit_number, a.question_key): a for a in answers}
    question_by_key = {q["key"]: q for q in questions}

    missing = []
    missing_labels = []
    for q in questions:
        required_visits = [0] if q["step"] in (0, 8) else range(1, 6)
        for visit_number in required_visits:
            answer = answer_map.get((visit_number, q["key"]))
            if answer is None or str(answer.answer_value) not in ("0", "1"):
                missing.append(f"{visit_number}:{q['key']}")
                where = "Общая информация" if visit_number == 0 and q["step"] == 0 else (
                    "Завершение дня" if visit_number == 0 else f"Визит {visit_number}, шаг {q['step']}"
                )
                missing_labels.append(f"{where}: {q['section']}")

    existing_visit_numbers = {v.visit_number for v in visits_rows}
    for visit_number in range(1, 6):
        if visit_number not in existing_visit_numbers:
            missing.append(f"visit:{visit_number}:missing")
            missing_labels.append(f"Визит {visit_number}: данные визита отсутствуют")
            continue
        v = next(x for x in visits_rows if x.visit_number == visit_number)
        if not (v.shop_code or "").strip():
            missing.append(f"visit:{visit_number}:shop_code")
            missing_labels.append(f"Визит {visit_number}: код ТТ")
        if not (v.goal or "").strip():
            missing.append(f"visit:{visit_number}:goal")
            missing_labels.append(f"Визит {visit_number}: цель визита")
        if v.latitude is None or v.longitude is None:
            missing.append(f"visit:{visit_number}:gps")
            missing_labels.append(f"Визит {visit_number}: GPS")

    if missing:
        # Убираем повторы, сохраняя порядок, чтобы сообщение было читаемым.
        labels = list(dict.fromkeys(missing_labels))
        raise HTTPException(
            422,
            detail={
                "message": "Аудит заполнен не полностью",
                "missing": missing,
                "missing_labels": labels,
            },
        )

    # calculate() использует relationship-коллекции. Обновляем их из БД
    # перед расчётом, чтобы результат соответствовал последнему sync.
    db.expire(audit, ["answers", "visits"])
    audit = load_audit(db, audit_id)
    ss = db.get(ScoreSetting, 1) or ScoreSetting(id=1)
    total, percent, level, sections = calculate(audit, questions, ss.confident_min, ss.master_min)
    audit.total_score = total
    audit.total_percent = percent
    audit.level = level
    audit.status = AuditStatus.completed
    audit.submitted_at = datetime.utcnow()
    audit.last_saved_at = datetime.utcnow()
    db.add(ActivityLog(
        user_id=user.id,
        action="Завершил аудит",
        entity_type="audit",
        entity_id=audit.id,
        details=f"{percent}% {level}",
    ))
    db.commit()
    return {"total_score": total, "total_percent": percent, "level": level, "sections": sections}
