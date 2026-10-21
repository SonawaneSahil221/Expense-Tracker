import uuid

from sqlalchemy.orm import Session

from models import AuditLog, User


def log_audit(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    summary: str,
    entity_id: str | None = None,
    metadata: dict | None = None,
) -> AuditLog:
    entry = AuditLog(
        id=str(uuid.uuid4()),
        user_id=user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        metadata_json=metadata,
    )
    db.add(entry)
    return entry
