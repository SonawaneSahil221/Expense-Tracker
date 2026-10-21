import random
import string
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import get_current_user
from database import get_db
from models import Income, User
from schemas import IncomeResponse

router = APIRouter(prefix="/api/income", tags=["income"])


def gen_income_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"inc_{int(time.time() * 1000)}_{suffix}"


def income_to_response(row: Income) -> IncomeResponse:
    return IncomeResponse(
        id=row.id,
        desc=row.description,
        amount=float(row.amount),
        date=row.date,
        currency=row.currency,
        source=row.source,
    )


@router.get("", response_model=list[IncomeResponse])
def list_income(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Income)
        .filter(Income.user_id == current_user.id)
        .order_by(Income.date.desc(), Income.created_at.desc())
        .all()
    )
    return [income_to_response(r) for r in rows]


@router.delete("/{income_id}")
def delete_income(
    income_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Income).filter(Income.id == income_id, Income.user_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Income entry not found")
    log_audit(
        db,
        current_user,
        action="delete",
        entity_type="income",
        entity_id=row.id,
        summary=f"Deleted income: {row.description} ({float(row.amount):.2f} {row.currency})",
    )
    db.delete(row)
    db.commit()
    return {"deleted": True}
