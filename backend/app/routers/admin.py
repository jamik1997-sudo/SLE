from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import Audit, Employee, Region, Role, User, UserRegion, ActivityLog
from app.schemas import UserCreate
from app.security import hash_password, require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def users(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    rows = db.scalars(
        select(User).options(selectinload(User.regions).selectinload(UserRegion.region)).order_by(User.full_name)
    ).all()
    return [
        {
            "id": u.id,
            "full_name": u.full_name,
            "login": u.login,
            "role": u.role.value,
            "is_active": u.is_active,
            "regions": [{"id": x.region.id, "name": x.region.name} for x in u.regions],
        }
        for u in rows
    ]


@router.post("/users")
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles(Role.admin, Role.manager)),
):
    login = payload.login.strip().lower()
    if db.scalar(select(User).where(User.login == login)):
        raise HTTPException(409, "Логин уже используется")
    if actor.role == Role.manager and payload.role == Role.admin:
        raise HTTPException(403, "Менеджер не может создавать администратора")
    if payload.role in (Role.admin, Role.manager) and payload.region_ids:
        raise HTTPException(422, "Для администратора и менеджера регион не назначается")
    if payload.role == Role.leader and len(set(payload.region_ids)) != 1:
        raise HTTPException(422, "Для руководителя необходимо выбрать один регион")
    if payload.region_ids:
        valid = set(db.scalars(select(Region.id).where(Region.id.in_(payload.region_ids), Region.is_active == True)).all())
        if valid != set(payload.region_ids):
            raise HTTPException(422, "Выбран недействительный регион")

    user = User(
        full_name=payload.full_name.strip(),
        login=login,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    if payload.role == Role.leader:
        db.add(UserRegion(user_id=user.id, region_id=payload.region_ids[0]))
    db.add(ActivityLog(user_id=actor.id,action="Создал пользователя",entity_type="user",entity_id=user.id,details=user.full_name))
    db.commit()
    return {"id": user.id}


@router.get("/regions")
def regions(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    return db.scalars(select(Region).where(Region.is_active == True).order_by(Region.name)).all()


@router.post("/regions")
def create_region(name: str, db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin))):
    clean = name.strip()
    if not clean:
        raise HTTPException(422, "Введите название региона")
    if db.scalar(select(Region).where(Region.name == clean)):
        raise HTTPException(409, "Такой регион уже существует")
    region = Region(name=clean)
    db.add(region)
    db.commit()
    db.refresh(region)
    return region


@router.get("/employees")
def employees(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    rows = db.scalars(
        select(Employee)
        .options(selectinload(Employee.region))
        .where(Employee.is_active == True)
        .order_by(Region.name, Employee.full_name)
        .join(Employee.region)
    ).all()
    return [
        {
            "id": item.id,
            "full_name": item.full_name,
            "position": item.position,
            "region_id": item.region_id,
            "region_name": item.region.name,
        }
        for item in rows
    ]


@router.post("/employees")
def create_employee(
    full_name: str,
    region_id: str,
    position: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(Role.admin, Role.manager)),
):
    if not db.get(Region, region_id):
        raise HTTPException(404, "Регион не найден")
    clean_name = full_name.strip()
    if not clean_name:
        raise HTTPException(422, "Введите ФИО сотрудника")
    item = Employee(full_name=clean_name, region_id=region_id, position=(position or "").strip() or None)
    db.add(item)
    db.add(ActivityLog(user_id=_.id,action="Добавил сотрудника",entity_type="employee",entity_id=item.id,details=item.full_name))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/employees/{employee_id}")
def delete_employee(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(Role.admin, Role.manager)),
):
    item = db.get(Employee, employee_id)
    if not item:
        raise HTTPException(404, "Сотрудник не найден")
    # Используется мягкое удаление, чтобы ранее проведённые аудиты сохранили сотрудника.
    item.is_active = False
    db.add(ActivityLog(user_id=_.id,action="Удалил сотрудника",entity_type="employee",entity_id=item.id,details=item.full_name))
    db.commit()
    return {"deleted": True, "id": employee_id}
