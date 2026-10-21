from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from audit_service import log_audit
from auth import get_current_user
from database import get_db
from models import Expense, ImportedTransaction, Income, StatementImport, User
from routers.expenses import _gen_id, _to_response
from routers.income import gen_income_id, income_to_response
from schemas import (
    ImportCheckRequest,
    ImportCheckResponse,
    ImportCommitRequest,
    ImportCommitResponse,
    StatementImportInfo,
)

router = APIRouter(prefix="/api/imports", tags=["imports"])

SOURCE_LABELS = {"bhim": "BHIM UPI", "gpay": "Google Pay", "phonepe": "PhonePe", "paytm": "Paytm"}


def _find_statement(db: Session, user: User, file_hash: str) -> StatementImport | None:
    return (
        db.query(StatementImport)
        .filter(StatementImport.user_id == user.id, StatementImport.file_hash == file_hash)
        .first()
    )


def _known_refs(db: Session, user: User, ref_hashes: set[str]) -> dict[str, ImportedTransaction]:
    if not ref_hashes:
        return {}
    rows = db.query(ImportedTransaction).filter(
        ImportedTransaction.user_id == user.id,
        ImportedTransaction.ref_hash.in_(ref_hashes),
    )
    return {row.ref_hash: row for row in rows}


def _live_refs(db: Session, user: User, known: dict[str, ImportedTransaction]) -> dict[str, str]:
    """ref_hash -> record id, only for imports whose expense/income is still in the list."""
    imported = [r for r in known.values() if r.status == "imported" and r.expense_id]
    if not imported:
        return {}
    ids = [r.expense_id for r in imported]
    live_ids = {i for (i,) in db.query(Expense.id).filter(Expense.user_id == user.id, Expense.id.in_(ids))}
    live_ids |= {i for (i,) in db.query(Income.id).filter(Income.user_id == user.id, Income.id.in_(ids))}
    return {r.ref_hash: r.expense_id for r in imported if r.expense_id in live_ids}


def _period_text(start, end) -> str:
    if start and end:
        return f"{start:%d %b %Y} – {end:%d %b %Y}"
    return "unknown period"


@router.post("/check", response_model=ImportCheckResponse)
def check_import(
    payload: ImportCheckRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    known = _known_refs(db, current_user, set(payload.ref_hashes))
    linked = _live_refs(db, current_user, known)
    ref_status = {ref_hash: "imported" for ref_hash in linked}
    existing = _find_statement(db, current_user, payload.file_hash)
    if not existing:
        return ImportCheckResponse(ref_status=ref_status, linked=linked)

    nothing_new = all(h in linked for h in payload.ref_hashes)
    if nothing_new:
        log_audit(
            db,
            current_user,
            action="import_rejected",
            entity_type="statement",
            entity_id=existing.id,
            summary=(
                f"Blocked re-upload of {SOURCE_LABELS[payload.source]} statement '{payload.file_name}': "
                f"same file was already imported on {existing.created_at:%d %b %Y}"
            ),
            metadata={"source": payload.source, "file_name": payload.file_name, "original_import_id": existing.id},
        )
        db.commit()
    return ImportCheckResponse(
        already_imported=StatementImportInfo(
            id=existing.id,
            source=existing.source,
            file_name=existing.file_name,
            imported_count=existing.imported_count,
            created_at=existing.created_at,
        ),
        ref_status=ref_status,
        linked=linked,
    )


@router.post("", response_model=ImportCommitResponse, status_code=201)
def commit_import(
    payload: ImportCommitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    label = SOURCE_LABELS[payload.source]
    known = _known_refs(db, current_user, {t.ref_hash for t in payload.transactions})
    live = _live_refs(db, current_user, known)

    statement = _find_statement(db, current_user, payload.file_hash)
    reupload = statement is not None
    if reupload and all(t.ref_hash in live for t in payload.transactions if t.include):
        raise HTTPException(status_code=409, detail="Everything in this statement is already in your list.")
    if not statement:
        statement = StatementImport(
            user_id=current_user.id,
            source=payload.source,
            file_hash=payload.file_hash,
            file_name=payload.file_name,
            period_start=payload.period_start,
            period_end=payload.period_end,
            found_count=payload.found_count,
        )
        db.add(statement)
        db.flush()

    expenses: list[Expense] = []
    incomes: list[Income] = []
    duplicates = 0
    skipped = 0
    seen: set[str] = set()

    for txn in payload.transactions:
        if txn.ref_hash in seen:
            duplicates += 1
            continue
        seen.add(txn.ref_hash)
        prior = known.get(txn.ref_hash)

        if txn.ref_hash in live:
            duplicates += 1
            continue

        if not txn.include:
            skipped += 1
            if not prior:
                db.add(ImportedTransaction(
                    user_id=current_user.id,
                    ref_hash=txn.ref_hash,
                    import_id=statement.id,
                    status="skipped",
                    kind=txn.kind,
                ))
            continue

        if txn.kind == "income":
            record = Income(
                id=gen_income_id(),
                user_id=current_user.id,
                description=txn.desc,
                amount=txn.amount,
                date=txn.date,
                currency="INR",
                source=payload.source,
            )
            incomes.append(record)
            summary = f"Imported income from {label} statement: {txn.desc} (+{txn.amount:.2f} INR) · {txn.date:%d %b %Y}"
        else:
            record = Expense(
                id=_gen_id(),
                user_id=current_user.id,
                description=txn.desc,
                amount=txn.amount,
                category=txn.cat,
                date=txn.date,
                currency="INR",
                source=payload.source,
            )
            expenses.append(record)
            summary = f"Imported from {label} statement: {txn.desc} ({txn.amount:.2f} INR) · {txn.cat} · {txn.date:%d %b %Y}"
        db.add(record)

        if prior:
            prior.status = "imported"
            prior.kind = txn.kind
            prior.expense_id = record.id
            prior.import_id = statement.id
        else:
            db.add(ImportedTransaction(
                user_id=current_user.id,
                ref_hash=txn.ref_hash,
                import_id=statement.id,
                status="imported",
                kind=txn.kind,
                expense_id=record.id,
            ))
        log_audit(
            db,
            current_user,
            action="import",
            entity_type=txn.kind,
            entity_id=record.id,
            summary=summary,
            metadata={
                "import_id": statement.id,
                "source": payload.source,
                "date": txn.date.isoformat(),
                "amount": txn.amount,
                "cat": txn.cat if txn.kind == "expense" else "Income",
            },
        )

    statement.imported_count += len(expenses) + len(incomes)
    statement.duplicate_count += duplicates
    # Flush first so the summary's created_at is later and it lists above its rows.
    db.flush()

    log_audit(
        db,
        current_user,
        action="import",
        entity_type="statement",
        entity_id=statement.id,
        summary=(
            f"{'Re-imported' if reupload else 'Imported'} {label} statement '{payload.file_name}' "
            f"({_period_text(payload.period_start, payload.period_end)}): "
            f"{len(expenses)} expense(s), {len(incomes)} income entr{'y' if len(incomes) == 1 else 'ies'} — "
            f"{duplicates} duplicate(s) skipped, {skipped} not selected, {payload.failed_count} failed ignored"
        ),
        metadata={
            "source": payload.source,
            "file_name": payload.file_name,
            "reupload": reupload,
            "period_start": payload.period_start.isoformat() if payload.period_start else None,
            "period_end": payload.period_end.isoformat() if payload.period_end else None,
            "found": payload.found_count,
            "expenses": len(expenses),
            "income": len(incomes),
            "duplicates": duplicates,
            "not_selected": skipped,
            "failed_ignored": payload.failed_count,
            "expense_total": round(sum(float(e.amount) for e in expenses), 2),
            "income_total": round(sum(float(i.amount) for i in incomes), 2),
        },
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This statement is already being imported.")

    for row in [*expenses, *incomes]:
        db.refresh(row)
    return ImportCommitResponse(
        import_id=statement.id,
        imported=[_to_response(e) for e in expenses],
        income=[income_to_response(i) for i in incomes],
        duplicates=duplicates,
        skipped=skipped,
    )
