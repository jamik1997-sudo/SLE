from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ActivityLog, User
from app.schemas import ChangePasswordIn, LoginIn, TokenOut
from app.security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.login == payload.login))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    user.last_login_at = datetime.utcnow()
    db.commit()
    return TokenOut(access_token=create_token(user))


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "full_name": user.full_name,
        "login": user.login,
        "role": user.role.value,
        "regions": [{"id": x.region.id, "name": x.region.name} for x in user.regions],
    }


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=422, detail="Текущий пароль указан неверно")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="Новый пароль должен отличаться от текущего")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    db.add(ActivityLog(user_id=user.id, action="Изменил пароль", entity_type="user", entity_id=user.id))
    db.commit()
    return {"changed": True}
