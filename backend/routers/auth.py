import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import create_access_token, hash_password, verify_password, get_current_user
from config import settings
from database import get_db
from models import User, UserSettings
from schemas import AuthResponse, GoogleAuthRequest, LoginRequest, RegisterRequest, UserResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        created_at=user.created_at,
    )


def _auth_response(user: User) -> AuthResponse:
    return AuthResponse(
        access_token=create_access_token(user.id),
        user=_user_response(user),
    )


def _create_default_settings(db: Session, user: User) -> None:
    settings = UserSettings(user_id=user.id, currency="INR", monthly_budget=0)
    db.add(settings)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
    )
    db.add(user)
    db.flush()
    _create_default_settings(db, user)
    log_audit(
        db,
        user,
        action="register",
        entity_type="auth",
        summary=f"Registered account: {user.email}",
    )
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    log_audit(
        db,
        user,
        action="login",
        entity_type="auth",
        summary=f"Logged in: {user.email}",
    )
    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/google", response_model=AuthResponse)
def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    if not settings.google_client_id:
        raise HTTPException(status_code=400, detail="Google authentication is not configured on this server")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        idinfo = id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            settings.google_client_id,
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid or expired Google token")

    if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=400, detail="Invalid token issuer")

    email = idinfo["email"].lower()
    full_name = idinfo.get("name") or email.split("@")[0]

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email,
            password_hash=hash_password(secrets.token_hex(32)),
            full_name=full_name,
        )
        db.add(user)
        db.flush()
        _create_default_settings(db, user)
        log_audit(db, user, action="register", entity_type="auth",
                  summary=f"Registered via Google: {email}")
    else:
        log_audit(db, user, action="login", entity_type="auth",
                  summary=f"Logged in via Google: {email}")

    db.commit()
    db.refresh(user)
    return _auth_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_audit(
        db,
        current_user,
        action="logout",
        entity_type="auth",
        summary=f"Logged out: {current_user.email}",
    )
    db.commit()
