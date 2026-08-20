import json
from datetime import datetime, date
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, text, or_, func, case, distinct, and_
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.database import get_db
from app.config import get_settings
from app.models import Answer, Audit, AuditStatus, Employee, Region, Role, User, UserRegion, Visit, VisitTiming, QuestionSetting, ScoreSetting, ActivityLog
from app.questionnaire import QUESTION_MAP, QUESTIONS
from app.schemas import AnswerSave, AuditCreate, ProgressSave, VisitSave, BatchSyncIn
from app.security import current_user
from app.services.scoring import calculate
from app.cache import get_cache, set_cache, clear_cache


settings = get_settings()


def _legacy_visit_text(value):
    """Normalize current/legacy visit text values for reports."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()

def _legacy_visit_goal_and_comment(visit=None, audit=None):
    """
    Backward-compatible lookup for visit goal/comment.
    Current fields are preferred; then known legacy aliases / JSON containers.
    """
    goal = ""
    comment = ""

    def pick(obj, names):
        if obj is None:
            return ""
        for name in names:
            try:
                if isinstance(obj, dict):
                    v = obj.get(name)
                else:
                    v = getattr(obj, name, None)
            except Exception:
                v = None
            v = _legacy_visit_text(v)
            if v:
                return v
        return ""

    goal_names = (
        "goal", "visit_goal", "purpose", "visit_purpose",
        "goal_text", "purpose_text", "target", "visit_target",
    )
    comment_names = (
        "comment", "visit_comment", "goal_comment",
        "purpose_comment", "comment_text", "visit_notes", "notes",
    )

    goal = pick(visit, goal_names)
    comment = pick(visit, comment_names)

    # Search JSON-ish legacy containers, if present.
    containers = []
    for obj in (visit, audit):
        if obj is None:
            continue
        for name in ("data", "payload", "draft", "draft_data", "meta", "metadata", "visit_data", "extra"):
            try:
                value = obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)
            except Exception:
                value = None
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except Exception:
                    value = None
            if isinstance(value, dict):
                containers.append(value)

    for data in containers:
        if not goal:
            goal = pick(data, goal_names)
        if not comment:
            comment = pick(data, comment_names)
        # Common nested visit object
        nested = data.get("visit") if isinstance(data, dict) else None
        if isinstance(nested, dict):
            if not goal:
                goal = pick(nested, goal_names)
            if not comment:
                comment = pick(nested, comment_names)

    # Some old builds stored initial visit fields directly on Audit.
    if not goal:
        goal = pick(audit, goal_names)
    if not comment:
        comment = pick(audit, comment_names)

    return goal or "—", comment or "—"


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
    stmt = select(Audit).options(
        joinedload(Audit.employee), joinedload(Audit.region),
        joinedload(Audit.auditor), joinedload(Audit.leader), selectinload(Audit.visits)
    ).where(Audit.status != AuditStatus.cancelled).order_by(Audit.last_saved_at.desc())
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    rows = db.scalars(stmt.limit(min(max(limit, 1), 500))).all()
    return [{
        "id": a.id, "audit_date": a.audit_date, "status": a.status.value,
        "current_visit": a.current_visit, "current_step": a.current_step,
        "total_percent": a.total_percent, "level": a.level,
        "employee_name": a.employee.full_name if a.employee else "—", "region_name": a.region.name if a.region else "—",
        "last_saved_at": a.last_saved_at, "auditor_id": a.auditor_id,
        "auditor_name": a.auditor.full_name if a.auditor else "—", "leader_id": a.leader_id,
        "leader_name": a.leader.full_name if a.leader else (a.auditor.full_name if a.auditor else "—"),
        "is_mine": a.auditor_id == user.id,
        "visit_goals": "; ".join(
            f"{v.visit_number}. {v.goal.strip()}" for v in sorted(a.visits, key=lambda x: x.visit_number)
            if (v.goal or "").strip()
        ),
        "visit_comments": "; ".join(
            f"{v.visit_number}. {v.comment.strip()}" for v in sorted(a.visits, key=lambda x: x.visit_number)
            if (v.comment or "").strip()
        ),
    } for a in rows]


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
def dashboard(
    region_id: str | None = None,
    auditor_id: str | None = None,
    employee_id: str | None = None,
    month: str | None = None,
    include_options: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Low-load dashboard: aggregates stay in PostgreSQL; only recent 30 visits are materialized."""
    cache_key = f"dashboard:v660:{user.id}:{region_id or ''}:{auditor_id or ''}:{employee_id or ''}:{month or ''}:{int(include_options)}"
    cached = get_cache(cache_key)
    if cached is not None:
        return cached

    # Never allow a dashboard request to occupy a DB connection indefinitely.
    if not settings.database_url.startswith("sqlite"):
        db.execute(text("SET LOCAL statement_timeout = '7000ms'"))

    def apply_filters(stmt):
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
                start_date = date(year, month_num, 1)
                end_date = date(year + (month_num == 12), 1 if month_num == 12 else month_num + 1, 1)
                stmt = stmt.where(Audit.audit_date >= start_date, Audit.audit_date < end_date)
            except Exception as error:
                raise HTTPException(422, "Месяц должен быть в формате ГГГГ-ММ") from error
        return stmt

    completed = Audit.status == AuditStatus.completed

    # 1) KPI: one aggregate row instead of loading every audit into Python.
    kpi_stmt = select(
        func.count(Audit.id).label("total"),
        func.coalesce(func.avg(Audit.total_percent), 0).label("average"),
        func.count(Audit.id).filter(Audit.level == "Базовый").label("basic"),
        func.count(Audit.id).filter(Audit.level == "Уверенный").label("confident"),
        func.count(Audit.id).filter(Audit.level == "Мастер").label("master"),
    ).where(completed)
    kpi = db.execute(apply_filters(kpi_stmt)).one()
    total = int(kpi.total or 0)
    average = round(float(kpi.average or 0), 1)
    levels = {"Базовый": int(kpi.basic or 0), "Уверенный": int(kpi.confident or 0), "Мастер": int(kpi.master or 0)}

    # 2) Region / employee / month charts are grouped by PostgreSQL.
    region_stmt = (
        select(Region.name.label("name"), func.avg(Audit.total_percent).label("average"), func.count(Audit.id).label("count"))
        .join(Region, Region.id == Audit.region_id)
        .where(completed).group_by(Region.id, Region.name)
    )
    regions = [
        {"name": r.name, "average": round(float(r.average or 0), 1), "count": int(r.count or 0)}
        for r in db.execute(apply_filters(region_stmt)).all()
    ]
    regions.sort(key=lambda x: (-x["average"], x["name"]))

    employee_stmt = (
        select(Employee.full_name.label("name"), Region.name.label("region"),
               func.avg(Audit.total_percent).label("average"), func.count(Audit.id).label("count"))
        .join(Employee, Employee.id == Audit.employee_id)
        .join(Region, Region.id == Audit.region_id)
        .where(completed)
        .group_by(Employee.id, Employee.full_name, Region.name)
        .order_by(func.avg(Audit.total_percent).desc(), func.count(Audit.id).desc())
        .limit(10)
    )
    employees = [
        {"name": r.name, "region": r.region, "average": round(float(r.average or 0), 1), "count": int(r.count or 0)}
        for r in db.execute(apply_filters(employee_stmt)).all()
    ]

    month_stmt = (
        select(func.to_char(Audit.audit_date, 'YYYY-MM').label("month"),
               func.avg(Audit.total_percent).label("average"), func.count(Audit.id).label("count"))
        .where(completed)
        .group_by(func.to_char(Audit.audit_date, 'YYYY-MM'))
        .order_by(func.to_char(Audit.audit_date, 'YYYY-MM').desc())
        .limit(12)
    )
    months = [
        {"month": r.month, "average": round(float(r.average or 0), 1), "count": int(r.count or 0)}
        for r in db.execute(apply_filters(month_stmt)).all()
    ][::-1]

    # 3) Block chart stays aggregate-only; no Answer ORM objects are loaded.
    aliases = {
        "Подготовка к визиту": "Подготовка", "Вступление": "Представление",
        "Осмотр": "Осмотр", "Презентация": "Предложение",
        "Работа с возражениями": "Предложение", "Работа в точке": "Работа в точке",
        "Обучение персонала": "Работа в точке", "Завершение визита": "Завершение визита",
        "Анализ визита": "Анализ визита",
    }
    answer_stmt = (
        select(
            QuestionSetting.section,
            func.min(QuestionSetting.sort_order).label("sort_order"),
            func.sum(case((Answer.answer_value == "1", QuestionSetting.weight), else_=0.0)).label("earned"),
            func.sum(case((Answer.answer_value.in_(["0", "1"]), QuestionSetting.weight), else_=0.0)).label("possible"),
            func.count(distinct(func.concat(Answer.audit_id, ':', Answer.visit_number))).label("instances"),
        )
        .select_from(Answer)
        .join(Audit, Audit.id == Answer.audit_id)
        .join(QuestionSetting, QuestionSetting.key == Answer.question_key)
        .where(completed, QuestionSetting.is_active == True, QuestionSetting.step.notin_([0, 8]))
        .group_by(QuestionSetting.section)
    )
    merged = {}
    for row in db.execute(apply_filters(answer_stmt)).all():
        name = aliases.get(row.section, row.section)
        b = merged.setdefault(name, {"earned": 0.0, "possible": 0.0, "count": 0, "order": row.sort_order})
        b["earned"] += float(row.earned or 0)
        b["possible"] += float(row.possible or 0)
        b["count"] += int(row.instances or 0)
        b["order"] = min(b["order"], row.sort_order)
    blocks = [
        {"name": name, "count": b["count"], "average": round(b["earned"] / b["possible"] * 100, 1) if b["possible"] else 0}
        for name, b in sorted(merged.items(), key=lambda x: x[1]["order"])
    ]

    # 4) Recent table: fetch only the last 30 VISITS and only their answers.
    recent_stmt = (
        select(
            Audit.id.label("audit_id"), Audit.audit_date, Audit.total_percent.label("audit_percent"),
            Employee.full_name.label("employee_name"),
            Visit.visit_number, Visit.shop_code, Visit.latitude, Visit.longitude,
            VisitTiming.started_at,
        )
        .join(Employee, Employee.id == Audit.employee_id)
        .join(Visit, Visit.audit_id == Audit.id)
        .outerjoin(VisitTiming, and_(VisitTiming.audit_id == Audit.id, VisitTiming.visit_number == Visit.visit_number))
        .where(completed)
        .order_by(Audit.submitted_at.desc(), Visit.visit_number.asc())
        .limit(30)
    )
    recent_rows = db.execute(apply_filters(recent_stmt)).all()
    pairs = [(r.audit_id, r.visit_number) for r in recent_rows]

    score_map = {}
    growth_map = {}
    if pairs:
        audit_ids = list({a for a, _ in pairs})
        score_stmt = (
            select(
                Answer.audit_id, Answer.visit_number, QuestionSetting.section,
                func.sum(case((Answer.answer_value == "1", QuestionSetting.weight), else_=0.0)).label("earned"),
                func.sum(case((Answer.answer_value.in_(["0", "1"]), QuestionSetting.weight), else_=0.0)).label("possible"),
            )
            .join(QuestionSetting, QuestionSetting.key == Answer.question_key)
            .where(Answer.audit_id.in_(audit_ids), QuestionSetting.is_active == True, QuestionSetting.step.notin_([0, 8]))
            .group_by(Answer.audit_id, Answer.visit_number, QuestionSetting.section)
        )
        sections = {}
        for row in db.execute(score_stmt).all():
            key = (row.audit_id, row.visit_number)
            sec = aliases.get(row.section, row.section)
            bucket = sections.setdefault(key, [])
            bucket.append((sec, float(row.earned or 0), float(row.possible or 0)))
        for key, vals in sections.items():
            earned = sum(v[1] for v in vals); possible = sum(v[2] for v in vals)
            score_map[key] = round(earned / possible * 100, 1) if possible else 0
            valid = [v for v in vals if v[2] > 0]
            growth_map[key] = min(valid, key=lambda v: v[1]/v[2])[0] if valid else "—"

    from app.timezone_utils import to_tashkent_naive
    recent = []
    for row in recent_rows:
        key=(row.audit_id,row.visit_number)
        started_local=to_tashkent_naive(row.started_at) if row.started_at else None
        recent.append({
            "id": row.audit_id, "visit_number": row.visit_number, "audit_date": row.audit_date,
            "employee_name": row.employee_name or "—",
            "visit_started_at": started_local.isoformat() if started_local else None,
            "visit_start_time": started_local.strftime("%H:%M") if started_local else "—",
            "shop_code": row.shop_code or "—",
            "total_percent": score_map.get(key, 0),
            "audit_percent": row.audit_percent,
            "growth_zone": growth_map.get(key, "—"),
            "latitude": row.latitude, "longitude": row.longitude,
            "location_url": f"https://maps.google.com/?q={row.latitude},{row.longitude}" if row.latitude is not None and row.longitude is not None else None,
        })

    options = None
    if include_options:
        options_key = f"dashboard-options:v660:{user.id}:{region_id or ''}"
        options = get_cache(options_key)
        if options is None:
            region_q = select(Region).where(Region.is_active == True).order_by(Region.name)
            if user.role == Role.leader:
                region_q = region_q.where(Region.id.in_(allowed_regions(user)))
            option_regions = db.scalars(region_q).all()

            evaluator_roles = (Role.leader, Role.auditor, Role.manager)
            auditor_q = select(User).options(selectinload(User.regions)).where(
                User.is_active == True, User.role.in_(evaluator_roles)
            ).order_by(User.full_name)
            effective_region_id = region_id
            if user.role == Role.leader and not effective_region_id:
                own = sorted(allowed_regions(user))
                effective_region_id = own[0] if len(own) == 1 else None
            if effective_region_id:
                leader_ids = select(UserRegion.user_id).where(UserRegion.region_id == effective_region_id)
                auditor_q = auditor_q.where(or_(
                    User.role.in_((Role.auditor, Role.manager)),
                    and_(User.role == Role.leader, User.id.in_(leader_ids)),
                ))
            option_auditors = db.scalars(auditor_q).unique().all()

            employee_q = select(Employee).where(Employee.is_active == True).order_by(Employee.full_name)
            if user.role == Role.leader:
                employee_q = employee_q.where(Employee.region_id.in_(allowed_regions(user)))
            if region_id:
                employee_q = employee_q.where(Employee.region_id == region_id)
            option_employees = db.scalars(employee_q).all()

            month_options_stmt = select(distinct(func.to_char(Audit.audit_date, 'YYYY-MM'))).where(completed).order_by(distinct(func.to_char(Audit.audit_date, 'YYYY-MM')).desc())
            month_options = [x for x in db.scalars(month_options_stmt).all() if x]

            options = set_cache(options_key, {
                "regions": [{"id": x.id, "name": x.name} for x in option_regions],
                "auditors": [{"id": x.id, "name": x.full_name, "role": x.role.value,
                              "region_ids": [link.region_id for link in x.regions] if x.role == Role.leader else []}
                             for x in option_auditors],
                "employees": [{"id": x.id, "name": x.full_name, "region_id": x.region_id,
                               "leader_id": getattr(x, "leader_id", None)} for x in option_employees],
                "months": month_options,
            }, ttl=600)

    result = {
        "total": total, "average": average, "levels": levels, "regions": regions,
        "employees": employees, "months": months, "recent": recent, "blocks": blocks,
    }
    if include_options and options is not None:
        result["filters"] = {**options, "selected": {
            "region_id": region_id, "auditor_id": auditor_id,
            "employee_id": employee_id, "month": month,
        }}
    return set_cache(cache_key, result, ttl=30)







@router.get("/dashboard/completed-audits")
def dashboard_completed_audits(
    level: str | None = None,
    region_id: str | None = None,
    auditor_id: str | None = None,
    employee_id: str | None = None,
    month: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """One row per completed audit for dashboard drill-down."""
    allowed_levels = {"Мастер", "Уверенный", "Базовый"}
    if level is not None and level not in allowed_levels:
        raise HTTPException(422, "Неизвестный уровень оценки")

    stmt = (
        select(Audit)
        .options(
            joinedload(Audit.employee),
            joinedload(Audit.region),
            joinedload(Audit.auditor),
        )
        .where(Audit.status == AuditStatus.completed)
        .order_by(Audit.audit_date.desc(), Audit.submitted_at.desc())
    )

    if level:
        stmt = stmt.where(Audit.level == level)
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
            start_date = date(year, month_num, 1)
            end_date = date(year + (month_num == 12), 1 if month_num == 12 else month_num + 1, 1)
            stmt = stmt.where(Audit.audit_date >= start_date, Audit.audit_date < end_date)
        except Exception as error:
            raise HTTPException(422, "Месяц должен быть в формате ГГГГ-ММ") from error

    rows = db.scalars(stmt.limit(500)).unique().all()

    from app.timezone_utils import to_tashkent_naive
    result = []
    for audit in rows:
        completed_local = to_tashkent_naive(audit.submitted_at) if audit.submitted_at else None
        result.append({
            "id": audit.id,
            "audit_date": audit.audit_date.isoformat() if audit.audit_date else None,
            "completed_at": completed_local.strftime("%d.%m.%Y %H:%M") if completed_local else "—",
            "employee_name": audit.employee.full_name if audit.employee else "—",
            "region_name": audit.region.name if audit.region else "—",
            "auditor_name": audit.auditor.full_name if audit.auditor else "—",
            "status": "Завершён",
            "result": audit.total_percent,
            "level": audit.level,
        })
    return result


def _comparison_allowed(user: User):
    if user.role != Role.admin:
        raise HTTPException(403, "Раздел сравнения доступен только администратору")


def _question_catalog(db: Session):
    rows = db.scalars(
        select(QuestionSetting)
        .where(QuestionSetting.is_active == True)
        .order_by(QuestionSetting.sort_order)
    ).all()
    if rows:
        return [{
            "key": q.key,
            "section": q.section,
            "step": q.step,
            "text": q.text_ru,
            "weight": float(q.weight or 0),
            "sort_order": q.sort_order,
        } for q in rows if q.step not in (0, 8)]
    return [{
        "key": q["key"],
        "section": q["section"],
        "step": q["step"],
        "text": q["text"],
        "weight": float(q.get("weight", 0) or 0),
        "sort_order": i,
    } for i, q in enumerate(QUESTIONS) if q["step"] not in (0, 8)]


def _visit_block_scores(answers, qmap):
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
    blocks = {}
    earned = possible = 0.0
    for a in answers:
        q = qmap.get(a.question_key)
        if not q:
            continue
        value = str(a.answer_value or "").upper()
        if value in ("NA", "N/A"):
            continue
        name = aliases.get(q["section"], q["section"])
        b = blocks.setdefault(name, {"earned": 0.0, "possible": 0.0})
        w = float(q["weight"] or 0)
        if value in ("0", "1"):
            b["possible"] += w
            possible += w
            if value == "1":
                b["earned"] += w
                earned += w
    block_rows = [{
        "name": name,
        "percent": round(v["earned"] / v["possible"] * 100, 1) if v["possible"] else 0
    } for name, v in blocks.items()]
    total = round(earned / possible * 100, 1) if possible else 0
    return total, block_rows


@router.get("/comparison/options")
def comparison_options(
    region_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _comparison_allowed(user)

    region_stmt = select(Region).where(Region.is_active == True).order_by(Region.name)
    regions = db.scalars(region_stmt).all()

    points_stmt = (
        select(Visit.shop_code, Audit.region_id, Region.name.label("region_name"))
        .join(Audit, Audit.id == Visit.audit_id)
        .join(Region, Region.id == Audit.region_id)
        .where(
            Audit.status == AuditStatus.completed,
            Visit.shop_code.is_not(None),
            Visit.shop_code != "",
        )
        .distinct()
        .order_by(Region.name, Visit.shop_code)
    )
    if region_id:
        points_stmt = points_stmt.where(Audit.region_id == region_id)

    point_rows = db.execute(points_stmt).all()
    return {
        "regions": [{"id": r.id, "name": r.name} for r in regions],
        "points": [{
            "shop_code": row.shop_code,
            "region_id": row.region_id,
            "region_name": row.region_name,
        } for row in point_rows],
    }


@router.get("/comparison/history")
def comparison_history(
    shop_code: str,
    region_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _comparison_allowed(user)
    code = (shop_code or "").strip()
    if not code:
        raise HTTPException(422, "Необходимо выбрать код ТТ")

    stmt = (
        select(Audit, Visit)
        .join(Visit, Visit.audit_id == Audit.id)
        .options(
            joinedload(Audit.employee),
            joinedload(Audit.auditor),
            joinedload(Audit.region),
            selectinload(Audit.answers),
        )
        .where(
            Audit.status == AuditStatus.completed,
            Visit.shop_code == code,
        )
        .order_by(Audit.audit_date.asc(), Audit.submitted_at.asc())
    )
    if region_id:
        stmt = stmt.where(Audit.region_id == region_id)
    if date_from:
        stmt = stmt.where(Audit.audit_date >= date_from)
    if date_to:
        stmt = stmt.where(Audit.audit_date <= date_to)

    pairs = db.execute(stmt).all()
    questions = _question_catalog(db)
    qmap = {q["key"]: q for q in questions}

    result = []
    for audit, visit in pairs:
        visit_answers = [a for a in audit.answers if a.visit_number == visit.visit_number]
        point_percent, blocks = _visit_block_scores(visit_answers, qmap)
        timing = db.scalar(
            select(VisitTiming).where(
                VisitTiming.audit_id == audit.id,
                VisitTiming.visit_number == visit.visit_number,
            )
        )
        from app.timezone_utils import to_tashkent_naive
        started_local = to_tashkent_naive(timing.started_at) if timing and timing.started_at else None

        result.append({
            "audit_id": audit.id,
            "visit_number": visit.visit_number,
            "audit_date": audit.audit_date,
            "visit_started_at": started_local.isoformat() if started_local else None,
            "employee_name": audit.employee.full_name,
            "auditor_name": audit.auditor.full_name,
            "region_id": audit.region_id,
            "region_name": audit.region.name,
            "shop_code": visit.shop_code,
            "goal": (visit.goal or "").strip() or "—",
            "comment": (visit.comment or "").strip() or "—",
            "latitude": visit.latitude,
            "longitude": visit.longitude,
            "point_percent": point_percent,
            "audit_percent": audit.total_percent,
            "level": audit.level,
            "blocks": blocks,
        })

    previous = None
    for row in result:
        row["delta"] = None if previous is None else round(row["point_percent"] - previous, 1)
        previous = row["point_percent"]

    return {"shop_code": code, "visits": result}


@router.get("/comparison/detail")
def comparison_detail(
    left_audit_id: str,
    left_visit_number: int,
    right_audit_id: str,
    right_visit_number: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    _comparison_allowed(user)

    left_audit = load_audit(db, left_audit_id)
    right_audit = load_audit(db, right_audit_id)
    if left_audit.status != AuditStatus.completed or right_audit.status != AuditStatus.completed:
        raise HTTPException(400, "Сравнивать можно только завершённые визиты")

    left_visit = next((v for v in left_audit.visits if v.visit_number == left_visit_number), None)
    right_visit = next((v for v in right_audit.visits if v.visit_number == right_visit_number), None)
    if not left_visit or not right_visit:
        raise HTTPException(404, "Один из визитов не найден")
    if (left_visit.shop_code or "").strip() != (right_visit.shop_code or "").strip():
        raise HTTPException(422, "Для детального сравнения выберите визиты одной ТТ")

    questions = _question_catalog(db)
    qmap = {q["key"]: q for q in questions}
    left_map = {a.question_key: a for a in left_audit.answers if a.visit_number == left_visit_number}
    right_map = {a.question_key: a for a in right_audit.answers if a.visit_number == right_visit_number}

    left_total, left_blocks = _visit_block_scores(list(left_map.values()), qmap)
    right_total, right_blocks = _visit_block_scores(list(right_map.values()), qmap)
    left_block_map = {x["name"]: x["percent"] for x in left_blocks}
    right_block_map = {x["name"]: x["percent"] for x in right_blocks}

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

    question_rows = []
    improved = worsened = unchanged = unresolved = 0
    for q in questions:
        la = left_map.get(q["key"])
        ra = right_map.get(q["key"])
        lv = str(la.answer_value).upper() if la and la.answer_value is not None else "—"
        rv = str(ra.answer_value).upper() if ra and ra.answer_value is not None else "—"

        if lv in ("NA", "N/A"):
            lv = "NA"
        if rv in ("NA", "N/A"):
            rv = "NA"

        status = "unchanged"
        if lv == "0" and rv == "1":
            status = "improved"; improved += 1
        elif lv == "1" and rv == "0":
            status = "worsened"; worsened += 1
        elif lv == rv:
            unchanged += 1
            if rv == "0":
                unresolved += 1
        else:
            # Changes involving N/A / missing values are shown but not treated as score improvement.
            status = "changed"

        question_rows.append({
            "question_key": q["key"],
            "step": q["step"],
            "section": q["section"],
            "block": aliases.get(q["section"], q["section"]),
            "text": q["text"],
            "left_value": lv,
            "right_value": rv,
            "left_comment": (la.comment or "—") if la else "—",
            "right_comment": (ra.comment or "—") if ra else "—",
            "status": status,
        })

    block_names = list(dict.fromkeys(
        [x["name"] for x in left_blocks] + [x["name"] for x in right_blocks]
    ))
    blocks = [{
        "name": name,
        "left_percent": left_block_map.get(name, 0),
        "right_percent": right_block_map.get(name, 0),
        "delta": round(right_block_map.get(name, 0) - left_block_map.get(name, 0), 1),
    } for name in block_names]

    return {
        "shop_code": left_visit.shop_code,
        "left": {
            "audit_id": left_audit.id,
            "visit_number": left_visit_number,
            "audit_date": left_audit.audit_date,
            "employee_name": left_audit.employee.full_name,
            "auditor_name": left_audit.auditor.full_name,
            "region_name": left_audit.region.name,
            "goal": (left_visit.goal or "").strip() or "—",
            "comment": (left_visit.comment or "").strip() or "—",
            "point_percent": left_total,
        },
        "right": {
            "audit_id": right_audit.id,
            "visit_number": right_visit_number,
            "audit_date": right_audit.audit_date,
            "employee_name": right_audit.employee.full_name,
            "auditor_name": right_audit.auditor.full_name,
            "region_name": right_audit.region.name,
            "goal": (right_visit.goal or "").strip() or "—",
            "comment": (right_visit.comment or "").strip() or "—",
            "point_percent": right_total,
        },
        "summary": {
            "delta": round(right_total - left_total, 1),
            "improved": improved,
            "worsened": worsened,
            "unchanged": unchanged,
            "unresolved": unresolved,
        },
        "blocks": blocks,
        "questions": question_rows,
    }




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

    # Защита от двойного/тройного нажатия на телефоне. Для PostgreSQL
    # сериализуем создание одного активного аудита пользователя по сотруднику и дате.
    if db.bind and db.bind.dialect.name == "postgresql":
        lock_key = f"audit-create:{user.id}:{employee.id}:{today_tashkent.isoformat()}"
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": lock_key})

    existing = db.scalar(
        select(Audit)
        .where(
            Audit.audit_date == today_tashkent,
            Audit.employee_id == employee.id,
            Audit.auditor_id == user.id,
            Audit.status.in_([AuditStatus.draft, AuditStatus.in_progress]),
        )
        .order_by(Audit.started_at.desc())
        .limit(1)
    )
    if existing:
        return {"id": existing.id, "reused": True}

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
    if payload.answer_value not in (["1", "0", "NA"] if q.get("section") in ("Работа с возражениями", "Обучение персонала") else ["1", "0"]): raise HTTPException(400, "Недопустимый ответ")
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
            allowed_values = ("1", "0", "NA") if q.get("section") in ("Работа с возражениями", "Обучение персонала") else ("1", "0")
            if item.answer_value not in allowed_values:
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
def submit(audit_id: str, force: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    # Загружаем аудит и затем читаем ответы/визиты отдельными запросами.
    # Это исключает устаревшие relationship-коллекции после автосохранения.
    audit = load_audit_basic(db, audit_id)
    ensure_access(user, audit, write=True)
    if force and user.role != Role.admin:
        raise HTTPException(403, "Принудительное завершение доступно только администратору")

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

    # v6.5.5: validate analysis_2 from freshly queried answers.
    # Admin may explicitly force-complete an incomplete audit.
    if not force:
        for visit_number in range(1, 6):
            analysis_answer = answer_map.get((visit_number, "analysis_2"))
            if analysis_answer is None or analysis_answer.answer_value not in ("0", "1"):
                raise HTTPException(
                    422,
                    f"Точка {visit_number}: заполните вопрос «Определяет, что помогло и что помешало достижению целей — навыки»",
                )
            if not (analysis_answer.comment or "").strip():
                raise HTTPException(
                    422,
                    f"Точка {visit_number}: обязательный комментарий к вопросу «Определяет, что помогло и что помешало достижению целей — навыки»",
                )
    question_by_key = {q["key"]: q for q in questions}

    missing = []
    missing_labels = []
    for q in questions:
        required_visits = [0] if q["step"] in (0, 8) else range(1, 6)
        for visit_number in required_visits:
            answer = answer_map.get((visit_number, q["key"]))
            allowed_values = ("0", "1", "NA") if q["section"] in ("Работа с возражениями", "Обучение персонала") else ("0", "1")
            if answer is None or str(answer.answer_value) not in allowed_values:
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

    if missing and not force:
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
        details=(f"{percent}% {level} · принудительно Admin" if force else f"{percent}% {level}"),
    ))
    db.commit()
    return {"total_score": total, "total_percent": percent, "level": level, "sections": sections}

@router.get("/{audit_id}/visit-view")
def audit_visit_view(
    audit_id: str,
    visit_number: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Readonly questionnaire for one completed visit shown from Dashboard."""
    audit = load_audit(db, audit_id)
    ensure_access(user, audit)

    if audit.status != AuditStatus.completed:
        raise HTTPException(400, "Просмотр доступен только для завершённого аудита")

    visit = next((v for v in audit.visits if v.visit_number == visit_number), None)
    if not visit:
        raise HTTPException(404, "Визит не найден")

    settings = db.scalars(
        select(QuestionSetting)
        .where(QuestionSetting.is_active == True)
        .order_by(QuestionSetting.sort_order)
    ).all()

    if settings:
        questions = [{
            "key": q.key,
            "section": q.section,
            "step": q.step,
            "text": q.text_ru,
            "sort_order": q.sort_order,
        } for q in settings if q.step not in (0, 8)]
    else:
        questions = [{
            "key": q["key"],
            "section": q["section"],
            "step": q["step"],
            "text": q["text"],
            "sort_order": i,
        } for i, q in enumerate(QUESTIONS) if q["step"] not in (0, 8)]

    answer_map = {
        a.question_key: a
        for a in audit.answers
        if a.visit_number == visit_number
    }

    rows = []
    for q in questions:
        answer = answer_map.get(q["key"])
        if answer is None:
            continue
        rows.append({
            "question_key": q["key"],
            "section": q["section"],
            "step": q["step"],
            "text": q["text"],
            "answer_value": answer.answer_value,
            "comment": answer.comment,
            "sort_order": q["sort_order"],
        })

    timing = db.scalar(
        select(VisitTiming).where(
            VisitTiming.audit_id == audit.id,
            VisitTiming.visit_number == visit_number,
        )
    )
    from app.timezone_utils import to_tashkent_naive
    started_local = to_tashkent_naive(timing.started_at) if timing and timing.started_at else None
    ended_local = to_tashkent_naive(timing.ended_at) if timing and timing.ended_at else None

    return {
        "audit_id": audit.id,
        "visit_number": visit.visit_number,
        "audit_date": audit.audit_date,
        "employee_name": audit.employee.full_name,
        "auditor_name": audit.auditor.full_name,
        "region_name": audit.region.name,
        "shop_code": visit.shop_code or "—",
        "goal": (visit.goal or "").strip() or "—",
        "visit_comment": (visit.comment or "").strip() or "—",
        "latitude": visit.latitude,
        "longitude": visit.longitude,
        "visit_started_at": started_local.isoformat() if started_local else None,
        "visit_ended_at": ended_local.isoformat() if ended_local else None,
        "total_percent": audit.total_percent,
        "level": audit.level,
        "answers": rows,
    }

