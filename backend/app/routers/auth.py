from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import User
from app.schemas import LoginIn, TokenOut
from app.security import create_token, current_user, verify_password

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
