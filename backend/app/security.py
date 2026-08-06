from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.config import get_settings
from app.database import get_db
from app.models import Role, User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
settings = get_settings()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_token(user: User, device_id: str | None = None) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload = {"sub": user.id, "role": user.role.value, "exp": exp}
    if device_id:
        payload["did"] = device_id
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется авторизация")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id = payload.get("sub")
        token_device_id = payload.get("did")
    except JWTError as error:
        raise exc from error
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise exc
    # Руководитель и аудитор могут использовать учетную запись только на привязанном устройстве.
    if user.role in (Role.leader, Role.auditor):
        if not user.device_id or not token_device_id or token_device_id != user.device_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Устройство не зарегистрировано или привязка была сброшена")
    return user


def require_roles(*roles):
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Недостаточно прав")
        return user
    return dependency
