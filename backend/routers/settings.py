from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import get_current_user
from database import get_db
from models import User, UserSettings
from schemas import SettingsResponse, SettingsUpdate

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _get_or_create_settings(db: Session, user: User) -> UserSettings:
    settings = db.query(UserSettings).filter(UserSettings.user_id == user.id).first()
    if not settings:
        settings = UserSettings(user_id=user.id, currency="INR", monthly_budget=0)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("", response_model=SettingsResponse)
def get_settings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db, current_user)
    return SettingsResponse(
        currency=settings.currency,
        monthly_budget=float(settings.monthly_budget),
    )


@router.put("", response_model=SettingsResponse)
def update_settings(
    payload: SettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = _get_or_create_settings(db, current_user)
    changes = []
    if payload.currency is not None:
        changes.append(f"currency: {settings.currency} → {payload.currency}")
        settings.currency = payload.currency
    if payload.monthly_budget is not None:
        changes.append(f"budget: {settings.monthly_budget} → {payload.monthly_budget}")
        settings.monthly_budget = payload.monthly_budget

    if changes:
        log_audit(
            db,
            current_user,
            action="settings_update",
            entity_type="settings",
            entity_id=str(settings.id),
            summary="Updated settings: " + ", ".join(changes),
        )

    db.commit()
    db.refresh(settings)
    return SettingsResponse(
        currency=settings.currency,
        monthly_budget=float(settings.monthly_budget),
    )
