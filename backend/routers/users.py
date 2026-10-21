from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import get_current_user
from database import get_db
from models import User
from schemas import UserResponse, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_profile(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        created_at=current_user.created_at,
    )


@router.put("/me", response_model=UserResponse)
def update_profile(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.full_name is not None:
        old_name = current_user.full_name
        current_user.full_name = payload.full_name.strip()
        log_audit(
            db,
            current_user,
            action="update",
            entity_type="user",
            entity_id=current_user.id,
            summary=f"Updated profile name from '{old_name}' to '{current_user.full_name}'",
        )

    db.commit()
    db.refresh(current_user)
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        created_at=current_user.created_at,
    )
