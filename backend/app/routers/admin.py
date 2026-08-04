from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import Employee, Region, Role, User, UserRegion, ActivityLog
from app.schemas import UserCreate
from app.security import hash_password, require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


def _ensure_can_manage(actor: User, target: User):
    if actor.role == Role.manager and target.role == Role.admin:
        raise HTTPException(403, "Менеджер не может изменять администратора")
    if actor.id == target.id:
        raise HTTPException(400, "Нельзя удалить собственную учетную запись")


@router.get("/users")
def users(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    rows = db.scalars(select(User).options(selectinload(User.regions).selectinload(UserRegion.region)).where(User.is_active == True).order_by(User.full_name)).all()
    return [{"id":u.id,"full_name":u.full_name,"login":u.login,"role":u.role.value,"is_active":u.is_active,"regions":[{"id":x.region.id,"name":x.region.name} for x in u.regions],"device_bound":bool(u.device_id) if u.role==Role.leader else False,"device_name":u.device_name if u.role==Role.leader else None,"device_bound_at":u.device_bound_at.isoformat() if u.device_bound_at else None,"can_change_credentials": not (_.role==Role.manager and u.role==Role.admin)} for u in rows]


@router.post("/users")
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    login = payload.login.strip().lower()
    if db.scalar(select(User).where(func.lower(User.login) == login)): raise HTTPException(409, "Логин уже используется")
    if actor.role == Role.manager and payload.role == Role.admin: raise HTTPException(403, "Менеджер не может создавать администратора")
    if payload.role in (Role.admin, Role.manager, Role.auditor) and payload.region_ids: raise HTTPException(422, "Для администратора, менеджера и аудитора регион не назначается")
    if payload.role == Role.leader and len(set(payload.region_ids)) != 1: raise HTTPException(422, "Для руководителя необходимо выбрать один регион")
    if payload.region_ids:
        valid=set(db.scalars(select(Region.id).where(Region.id.in_(payload.region_ids),Region.is_active==True)).all())
        if valid != set(payload.region_ids): raise HTTPException(422,"Выбран недействительный регион")
    user=User(full_name=payload.full_name.strip(),login=login,password_hash=hash_password(payload.password),role=payload.role)
    db.add(user);db.flush()
    if payload.role==Role.leader: db.add(UserRegion(user_id=user.id,region_id=payload.region_ids[0]))
    db.add(ActivityLog(user_id=actor.id,action="Создал пользователя",entity_type="user",entity_id=user.id,details=user.full_name));db.commit()
    return {"id":user.id}


@router.put("/users/{user_id}")
def update_user(user_id: str, payload: dict, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    target=db.get(User,user_id)
    if not target: raise HTTPException(404,"Пользователь не найден")
    if actor.role==Role.manager and target.role==Role.admin: raise HTTPException(403,"Менеджер не может изменять администратора")
    role=Role(payload.get("role",target.role.value))
    if actor.role==Role.manager and role==Role.admin: raise HTTPException(403,"Менеджер не может назначать администратора")
    full_name=str(payload.get("full_name",target.full_name)).strip()
    login=str(payload.get("login",target.login)).strip().lower()
    duplicate=db.scalar(select(User).where(func.lower(User.login)==login,User.id!=target.id))
    if duplicate: raise HTTPException(409,"Логин уже используется")
    region_id=payload.get("region_id")
    if role==Role.leader:
        if not region_id or not db.get(Region,region_id): raise HTTPException(422,"Для руководителя выберите регион")
    target.full_name=full_name;target.login=login;target.role=role
    if role != Role.leader:
        target.device_id=None;target.device_name=None;target.device_bound_at=None
    if payload.get("password"): target.password_hash=hash_password(str(payload["password"]));target.must_change_password=True
    for ur in list(target.regions): db.delete(ur)
    if role==Role.leader: db.add(UserRegion(user_id=target.id,region_id=region_id))
    db.add(ActivityLog(user_id=actor.id,action="Изменил пользователя",entity_type="user",entity_id=target.id,details=target.full_name));db.commit()
    return {"saved":True}


@router.post("/users/{user_id}/reset-device")
def reset_user_device(user_id: str, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "Пользователь не найден")
    if actor.role == Role.manager and target.role == Role.admin:
        raise HTTPException(403, "Менеджер не может изменять администратора")
    if target.role != Role.leader:
        raise HTTPException(422, "Привязка устройства используется только для руководителей")
    target.device_id = None
    target.device_name = None
    target.device_bound_at = None
    db.add(ActivityLog(user_id=actor.id, action="Сбросил привязку устройства", entity_type="user", entity_id=target.id, details=target.full_name))
    db.commit()
    return {"reset": True}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    target=db.get(User,user_id)
    if not target: raise HTTPException(404,"Пользователь не найден")
    _ensure_can_manage(actor,target)
    target.is_active=False
    db.add(ActivityLog(user_id=actor.id,action="Удалил пользователя",entity_type="user",entity_id=target.id,details=target.full_name));db.commit()
    return {"deleted":True}


@router.get("/regions")
def regions(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    return db.scalars(select(Region).where(Region.is_active==True).order_by(Region.name)).all()


@router.post("/regions")
def create_region(name: str, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    clean=name.strip()
    if not clean: raise HTTPException(422,"Введите название региона")
    if db.scalar(select(Region).where(func.lower(Region.name)==clean.lower())): raise HTTPException(409,"Такой регион уже существует")
    region=Region(name=clean);db.add(region);db.flush();db.add(ActivityLog(user_id=actor.id,action="Добавил регион",entity_type="region",entity_id=region.id,details=region.name));db.commit();db.refresh(region);return region


@router.get("/employees")
def employees(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    rows=db.scalars(select(Employee).options(selectinload(Employee.region),selectinload(Employee.leader)).where(Employee.is_active==True).join(Employee.region).order_by(Region.name,Employee.full_name)).all()
    return [{"id":x.id,"full_name":x.full_name,"position":x.position,"region_id":x.region_id,"region_name":x.region.name,"leader_id":x.leader_id,"leader_name":x.leader.full_name if x.leader else None} for x in rows]


def _validate_employee(db: Session, full_name: str, region_id: str, leader_id: str, exclude_id: str | None = None):
    clean=" ".join(full_name.split())
    if not clean: raise HTTPException(422,"Введите ФИО сотрудника")
    if not db.get(Region,region_id): raise HTTPException(404,"Регион не найден")
    leader=db.get(User,leader_id)
    if not leader or leader.role!=Role.leader or not leader.is_active: raise HTTPException(422,"Выберите действующего руководителя")
    leader_regions={x.region_id for x in leader.regions}
    if region_id not in leader_regions: raise HTTPException(422,"Руководитель относится к другому региону")
    stmt=select(Employee).where(func.lower(Employee.full_name)==clean.lower(),Employee.is_active==True)
    if exclude_id: stmt=stmt.where(Employee.id!=exclude_id)
    if db.scalar(stmt): raise HTTPException(409,"Такой сотрудник уже существует")
    return clean


@router.post("/employees")
def create_employee(full_name: str, region_id: str, leader_id: str, position: str | None=None, db: Session=Depends(get_db), actor:User=Depends(require_roles(Role.admin,Role.manager))):
    clean=_validate_employee(db,full_name,region_id,leader_id)
    item=Employee(full_name=clean,region_id=region_id,leader_id=leader_id,position=(position or "").strip() or None);db.add(item);db.flush();db.add(ActivityLog(user_id=actor.id,action="Добавил сотрудника",entity_type="employee",entity_id=item.id,details=item.full_name));db.commit();return {"id":item.id}


@router.put("/employees/{employee_id}")
def update_employee(employee_id:str,payload:dict,db:Session=Depends(get_db),actor:User=Depends(require_roles(Role.admin,Role.manager))):
    item=db.get(Employee,employee_id)
    if not item: raise HTTPException(404,"Сотрудник не найден")
    full_name=str(payload.get("full_name",item.full_name));region_id=str(payload.get("region_id",item.region_id));leader_id=str(payload.get("leader_id",item.leader_id or ""))
    clean=_validate_employee(db,full_name,region_id,leader_id,item.id)
    item.full_name=clean;item.region_id=region_id;item.leader_id=leader_id;item.position=(str(payload.get("position",item.position or "")).strip() or None)
    db.add(ActivityLog(user_id=actor.id,action="Изменил сотрудника",entity_type="employee",entity_id=item.id,details=item.full_name));db.commit();return {"saved":True}


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id:str,db:Session=Depends(get_db),actor:User=Depends(require_roles(Role.admin,Role.manager))):
    item=db.get(Employee,employee_id)
    if not item: raise HTTPException(404,"Сотрудник не найден")
    item.is_active=False;db.add(ActivityLog(user_id=actor.id,action="Удалил сотрудника",entity_type="employee",entity_id=item.id,details=item.full_name));db.commit();return {"deleted":True}
