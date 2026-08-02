from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, func
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import (ActivityLog, Answer, Audit, AuditStatus, Employee, QuestionSetting, Region, Role, ScoreSetting, User, VisitTiming)
from app.security import current_user, require_roles

router = APIRouter(prefix="/extras", tags=["extras"])

def allowed_regions(user): return {x.region_id for x in user.regions}

def scope(stmt, user):
    if user.role == Role.leader:
        stmt = stmt.where(Audit.region_id.in_(allowed_regions(user)))
    return stmt

def log(db, user, action, entity_type=None, entity_id=None, details=None):
    db.add(ActivityLog(user_id=user.id if user else None, action=action, entity_type=entity_type, entity_id=entity_id, details=details))

@router.get("/search")
def global_search(q: str = Query(min_length=1), db: Session = Depends(get_db), user: User = Depends(current_user)):
    term=f"%{q.strip()}%"
    estmt=select(Employee).options(selectinload(Employee.region)).where(Employee.is_active==True, or_(Employee.full_name.ilike(term), Employee.position.ilike(term)))
    if user.role==Role.leader: estmt=estmt.where(Employee.region_id.in_(allowed_regions(user)))
    employees=db.scalars(estmt.limit(20)).all()
    astmt=scope(select(Audit).options(selectinload(Audit.employee),selectinload(Audit.region),selectinload(Audit.auditor)).join(Audit.employee).join(Audit.region).where(or_(Employee.full_name.ilike(term),Region.name.ilike(term))),user)
    audits=db.scalars(astmt.limit(20)).all()
    return {"employees":[{"id":e.id,"name":e.full_name,"position":e.position,"region":e.region.name} for e in employees],"audits":[{"id":a.id,"date":a.audit_date,"employee":a.employee.full_name,"region":a.region.name,"percent":a.total_percent,"status":a.status.value} for a in audits]}

@router.get("/employees/{employee_id}")
def employee_card(employee_id: str, db: Session=Depends(get_db), user: User=Depends(current_user)):
    e=db.scalar(select(Employee).options(selectinload(Employee.region)).where(Employee.id==employee_id))
    if not e: raise HTTPException(404,"Сотрудник не найден")
    if user.role==Role.leader and e.region_id not in allowed_regions(user): raise HTTPException(403,"Нет доступа")
    rows=db.scalars(select(Audit).where(Audit.employee_id==employee_id,Audit.status==AuditStatus.completed).order_by(Audit.audit_date.desc())).all()
    avg=round(sum((a.total_percent or 0) for a in rows)/len(rows),1) if rows else 0
    trend=[{"date":str(a.audit_date),"percent":a.total_percent or 0,"level":a.level} for a in reversed(rows[:12])]
    return {"id":e.id,"full_name":e.full_name,"position":e.position,"region":e.region.name,"audits":len(rows),"average":avg,"last_result":rows[0].total_percent if rows else None,"trend":trend}

@router.get("/logs")
def logs(limit:int=100,db:Session=Depends(get_db),user:User=Depends(require_roles(Role.admin,Role.manager))):
    rows=db.scalars(select(ActivityLog).options(selectinload(ActivityLog.user)).order_by(ActivityLog.created_at.desc()).limit(min(limit,500))).all()
    return [{"id":x.id,"user":x.user.full_name if x.user else "Система","action":x.action,"entity_type":x.entity_type,"details":x.details,"created_at":x.created_at} for x in rows]

@router.get("/question-settings")
def questions(db:Session=Depends(get_db),user:User=Depends(current_user)):
    return db.scalars(select(QuestionSetting).order_by(QuestionSetting.sort_order)).all()

@router.put("/question-settings/{key}")
def update_question(key:str,payload:dict,db:Session=Depends(get_db),user:User=Depends(require_roles(Role.admin))):
    q=db.get(QuestionSetting,key)
    if not q: raise HTTPException(404,"Вопрос не найден")
    for f in ("text_ru","text_uz","section","step","weight","sort_order","is_active"):
        if f in payload: setattr(q,f,payload[f])
    log(db,user,"Изменил вопрос","question",key,q.text_ru)
    db.commit(); return {"saved":True}

@router.get("/score-settings")
def get_score_settings(db:Session=Depends(get_db),user:User=Depends(current_user)):
    s=db.get(ScoreSetting,1) or ScoreSetting(id=1)
    return {"confident_min":s.confident_min,"master_min":s.master_min}

@router.put("/score-settings")
def put_score_settings(payload:dict,db:Session=Depends(get_db),user:User=Depends(require_roles(Role.admin))):
    s=db.get(ScoreSetting,1)
    if not s: s=ScoreSetting(id=1); db.add(s)
    c=float(payload.get("confident_min",65)); m=float(payload.get("master_min",85))
    if not 0<c<m<=100: raise HTTPException(422,"Проверьте границы уровней")
    s.confident_min=c;s.master_min=m;log(db,user,"Изменил уровни оценки","settings","score",f"{c}/{m}");db.commit();return {"saved":True}

@router.post("/audit/{audit_id}/visit/{visit_number}/start")
def start_visit(audit_id:str,visit_number:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    a=db.get(Audit,audit_id)
    if not a: raise HTTPException(404,"Аудит не найден")
    if user.role==Role.leader and a.auditor_id!=user.id: raise HTTPException(403,"Нет доступа")
    t=db.scalar(select(VisitTiming).where(VisitTiming.audit_id==audit_id,VisitTiming.visit_number==visit_number))
    if not t: t=VisitTiming(audit_id=audit_id,visit_number=visit_number);db.add(t)
    if not t.started_at:t.started_at=datetime.utcnow()
    db.commit();return {"started_at":t.started_at}

@router.post("/audit/{audit_id}/visit/{visit_number}/end")
def end_visit(audit_id:str,visit_number:int,db:Session=Depends(get_db),user:User=Depends(current_user)):
    t=db.scalar(select(VisitTiming).where(VisitTiming.audit_id==audit_id,VisitTiming.visit_number==visit_number))
    if not t: t=VisitTiming(audit_id=audit_id,visit_number=visit_number,started_at=datetime.utcnow());db.add(t)
    t.ended_at=datetime.utcnow();db.commit();return {"ended_at":t.ended_at}

@router.get("/audit/{audit_id}/timings")
def timings(audit_id:str,db:Session=Depends(get_db),user:User=Depends(current_user)):
    rows=db.scalars(select(VisitTiming).where(VisitTiming.audit_id==audit_id).order_by(VisitTiming.visit_number)).all()
    return [{"visit_number":x.visit_number,"started_at":x.started_at,"ended_at":x.ended_at,"minutes":round((x.ended_at-x.started_at).total_seconds()/60,1) if x.started_at and x.ended_at else None} for x in rows]


@router.get("/questionnaire-report")
def questionnaire_report(
    include_details: bool = False,
    limit: int = 1000,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    stmt = (
        select(Audit)
        .options(
            selectinload(Audit.employee),
            selectinload(Audit.region),
            selectinload(Audit.auditor),
            selectinload(Audit.answers),
        )
        .order_by(Audit.audit_date.desc(), Audit.last_saved_at.desc())
    )
    stmt = scope(stmt, user)
    audits = db.scalars(stmt.limit(min(max(limit, 1), 3000))).all()
    qrows = db.scalars(select(QuestionSetting).where(QuestionSetting.is_active == True).order_by(QuestionSetting.sort_order)).all()
    questions = [{
        "key": q.key, "section": q.section, "step": q.step, "weight": q.weight, "text": q.text_ru
    } for q in qrows]
    stats = {q["key"]: {**q, "filled": 0, "ones": 0, "zeros": 0} for q in questions}
    status_counts = {"draft": 0, "in_progress": 0, "completed": 0, "cancelled": 0}
    details = []
    total_answers = 0
    for audit in audits:
        status_counts[audit.status.value] = status_counts.get(audit.status.value, 0) + 1
        for answer in audit.answers:
            item = stats.get(answer.question_key)
            if not item:
                continue
            item["filled"] += 1
            total_answers += 1
            if answer.answer_value == "1": item["ones"] += 1
            elif answer.answer_value == "0": item["zeros"] += 1
            if include_details and len(details) < 30000:
                details.append({
                    "audit_id": audit.id,
                    "audit_date": str(audit.audit_date),
                    "status": audit.status.value,
                    "region": audit.region.name,
                    "employee": audit.employee.full_name,
                    "auditor": audit.auditor.full_name,
                    "visit_number": answer.visit_number,
                    "section": item["section"],
                    "question": item["text"],
                    "answer": answer.answer_value,
                    "updated_at": answer.updated_at.isoformat() if answer.updated_at else None,
                })
    summary = []
    audit_count = len(audits)
    for q in questions:
        item = stats[q["key"]]
        expected_per_audit = 1 if q["step"] in (0, 8) else 5
        expected = audit_count * expected_per_audit
        item["expected"] = expected
        item["completion_percent"] = round(item["filled"] / expected * 100, 1) if expected else 0
        item["success_percent"] = round(item["ones"] / item["filled"] * 100, 1) if item["filled"] else 0
        summary.append(item)
    return {
        "audit_count": audit_count,
        "total_answers": total_answers,
        "status_counts": status_counts,
        "questions": summary,
        "details": details if include_details else [],
    }
