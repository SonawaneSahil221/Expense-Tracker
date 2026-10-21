from datetime import date, datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints


class ExpenseBase(BaseModel):
    desc: str = Field(min_length=1)
    amount: float = Field(gt=0)
    cat: str = Field(min_length=1)
    date: date
    currency: str = Field(min_length=3, max_length=3)


class ExpenseCreate(ExpenseBase):
    id: Optional[str] = None


class ExpenseUpdate(BaseModel):
    desc: str = Field(min_length=1)
    amount: float = Field(gt=0)
    cat: str = Field(min_length=1)
    date: date
    currency: str = Field(min_length=3, max_length=3)


class ExpenseResponse(ExpenseBase):
    id: str
    source: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


ImportSource = Literal["bhim", "gpay", "phonepe", "paytm"]
Sha256Hex = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class ImportCheckRequest(BaseModel):
    source: ImportSource
    file_hash: Sha256Hex
    file_name: str = Field(default="", max_length=255)
    ref_hashes: list[Sha256Hex] = Field(default_factory=list, max_length=5000)


class StatementImportInfo(BaseModel):
    id: str
    source: str
    file_name: str
    imported_count: int
    created_at: datetime


class ImportCheckResponse(BaseModel):
    already_imported: Optional[StatementImportInfo] = None
    ref_status: dict[str, str] = Field(default_factory=dict)
    linked: dict[str, str] = Field(default_factory=dict)


class ImportTransaction(BaseModel):
    ref_hash: Sha256Hex
    kind: Literal["expense", "income"] = "expense"
    date: date
    desc: str = Field(min_length=1, max_length=255)
    amount: float = Field(gt=0, le=100_000_000)
    cat: str = Field(default="Other", min_length=1, max_length=50)
    include: bool = True


class IncomeResponse(BaseModel):
    id: str
    desc: str
    amount: float
    date: date
    currency: str
    source: Optional[str] = None


class ImportCommitRequest(BaseModel):
    source: ImportSource
    file_hash: Sha256Hex
    file_name: str = Field(default="", max_length=255)
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    found_count: int = Field(default=0, ge=0)
    failed_count: int = Field(default=0, ge=0)
    transactions: list[ImportTransaction] = Field(max_length=5000)


class ImportCommitResponse(BaseModel):
    import_id: str
    imported: list[ExpenseResponse]
    income: list[IncomeResponse]
    duplicates: int
    skipped: int


class BulkDeleteRequest(BaseModel):
    ids: list[str] = Field(min_length=1)


class SettingsResponse(BaseModel):
    currency: str
    monthly_budget: float


class SettingsUpdate(BaseModel):
    currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    monthly_budget: Optional[float] = Field(default=None, ge=0)


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=255)


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class GoogleAuthRequest(BaseModel):
    credential: str


class AuditLogResponse(BaseModel):
    id: str
    action: str
    entity_type: str
    entity_id: Optional[str] = None
    summary: str
    metadata: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_model(cls, log) -> "AuditLogResponse":
        return cls(
            id=log.id,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            summary=log.summary,
            metadata=log.metadata_json,
            created_at=log.created_at,
        )
