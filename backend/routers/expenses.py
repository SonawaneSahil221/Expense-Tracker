import time
import random
import string

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import get_current_user
from database import get_db
from models import Expense, User
from schemas import (
    BulkDeleteRequest,
    ExpenseCreate,
    ExpenseResponse,
    ExpenseUpdate,
)

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


def _gen_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
    return f"exp_{int(time.time() * 1000)}_{suffix}"


def _to_response(expense: Expense) -> ExpenseResponse:
    return ExpenseResponse(
        id=expense.id,
        desc=expense.description,
        amount=float(expense.amount),
        cat=expense.category,
        date=expense.date,
        currency=expense.currency,
        source=expense.source,
    )


def _get_user_expense(db: Session, expense_id: str, user: User) -> Expense | None:
    return (
        db.query(Expense)
        .filter(Expense.id == expense_id, Expense.user_id == user.id)
        .first()
    )


@router.get("", response_model=list[ExpenseResponse])
def list_expenses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Expense)
        .filter(Expense.user_id == current_user.id)
        .order_by(Expense.date.desc(), Expense.created_at.desc())
        .all()
    )
    return [_to_response(e) for e in rows]


@router.post("", response_model=ExpenseResponse, status_code=201)
def create_expense(
    payload: ExpenseCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expense_id = payload.id or _gen_id()
    existing = db.get(Expense, expense_id)
    if existing:
        raise HTTPException(status_code=409, detail="Expense ID already exists")

    expense = Expense(
        id=expense_id,
        user_id=current_user.id,
        description=payload.desc,
        amount=payload.amount,
        category=payload.cat,
        date=payload.date,
        currency=payload.currency,
    )
    db.add(expense)
    log_audit(
        db,
        current_user,
        action="create",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"Created expense: {payload.desc} ({payload.amount} {payload.currency})",
        metadata={"desc": payload.desc, "amount": payload.amount, "cat": payload.cat},
    )
    db.commit()
    db.refresh(expense)
    return _to_response(expense)


@router.delete("/bulk")
def bulk_delete_expenses(
    payload: BulkDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expenses = (
        db.query(Expense)
        .filter(Expense.id.in_(payload.ids), Expense.user_id == current_user.id)
        .all()
    )
    deleted = len(expenses)
    for expense in expenses:
        log_audit(
            db,
            current_user,
            action="delete",
            entity_type="expense",
            entity_id=expense.id,
            summary=f"Deleted expense: {expense.description}",
        )
        db.delete(expense)
    db.commit()
    return {"deleted": deleted}


@router.put("/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: str,
    payload: ExpenseUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expense = _get_user_expense(db, expense_id, current_user)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    expense.description = payload.desc
    expense.amount = payload.amount
    expense.category = payload.cat
    expense.date = payload.date
    expense.currency = payload.currency
    log_audit(
        db,
        current_user,
        action="update",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"Updated expense: {payload.desc} ({payload.amount} {payload.currency})",
    )
    db.commit()
    db.refresh(expense)
    return _to_response(expense)


@router.delete("/{expense_id}")
def delete_expense(
    expense_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    expense = _get_user_expense(db, expense_id, current_user)
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")

    log_audit(
        db,
        current_user,
        action="delete",
        entity_type="expense",
        entity_id=expense.id,
        summary=f"Deleted expense: {expense.description}",
    )
    db.delete(expense)
    db.commit()
    return {"deleted": True}
