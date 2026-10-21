from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text

from config import settings
from database import Base, engine
from routers import audit, auth, expenses, imports, income, settings as settings_router, users

FRONTEND_DIR = Path(__file__).resolve().parent.parent


def _run_migrations() -> None:
    # create_all() does not add columns to tables that already exist.
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source VARCHAR(20)"))
        conn.execute(text(
            "ALTER TABLE imported_transactions ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'expense'"
        ))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    yield


app = FastAPI(title="ExpenseIQ API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(audit.router)
app.include_router(expenses.router)
app.include_router(imports.router)
app.include_router(income.router)
app.include_router(settings_router.router)


@app.get("/api/config")
def get_public_config():
    return {"google_client_id": settings.google_client_id}


@app.get("/health")
def health_check():
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        return {"status": "error", "database": str(exc)}


@app.get("/")
def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/Style.css")
def serve_css():
    return FileResponse(FRONTEND_DIR / "Style.css", media_type="text/css")


@app.get("/script.js")
def serve_js():
    return FileResponse(FRONTEND_DIR / "script.js", media_type="application/javascript")


@app.get("/importer.js")
def serve_importer_js():
    return FileResponse(FRONTEND_DIR / "importer.js", media_type="application/javascript")
