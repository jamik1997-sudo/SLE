from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Employee, Region, Role, User, UserRegion
from app.schemas import UserCreate
from app.security import hash_password, require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def users(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    rows = db.scalars(select(User).order_by(User.full_name)).all()
    return [{"id":u.id,"full_name":u.full_name,"login":u.login,"role":u.role.value,"is_active":u.is_active,"regions":[{"id":r.region.id,"name":r.region.name} for r in u.regions]} for u in rows]


@router.post("/users")
def create_user(payload: UserCreate, db: Session = Depends(get_db), actor: User = Depends(require_roles(Role.admin, Role.manager))):
    if db.scalar(select(User).where(User.login == payload.login)):
        raise HTTPException(409, "Логин уже используется")
    if actor.role == Role.manager and payload.role == Role.admin:
        raise HTTPException(403, "Менеджер не может создавать администратора")
    user = User(full_name=payload.full_name, login=payload.login, password_hash=hash_password(payload.password), role=payload.role)
    db.add(user); db.flush()
    for region_id in payload.region_ids:
        db.add(UserRegion(user_id=user.id, region_id=region_id))
    db.commit()
    return {"id": user.id}


@router.get("/regions")
def regions(db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    return db.scalars(select(Region).where(Region.is_active == True).order_by(Region.name)).all()


@router.post("/regions")
def create_region(name: str, db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin))):
    region = Region(name=name.strip())
    db.add(region); db.commit(); db.refresh(region)
    return region


@router.post("/employees")
def create_employee(full_name: str, region_id: str, position: str | None = None, db: Session = Depends(get_db), _: User = Depends(require_roles(Role.admin, Role.manager))):
    item = Employee(full_name=full_name.strip(), region_id=region_id, position=position)
    db.add(item); db.commit(); db.refresh(item)
    return item
