from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models import Employee, Region, Role, User, UserRegion
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

    # Менеджер и администратор работают по всей республике и не привязываются к регионам.
    if payload.role in (Role.admin, Role.manager) and payload.region_ids:
        raise HTTPException(422, "Для администратора и менеджера регион не назначается")

    # Руководитель обязательно закрепляется ровно за одним регионом.
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
    item = Employee(full_name=full_name.strip(), region_id=region_id, position=(position or "").strip() or None)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item
