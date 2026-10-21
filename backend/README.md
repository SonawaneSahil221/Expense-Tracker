# ExpenseIQ Backend

FastAPI + PostgreSQL API for the ExpenseIQ expense tracker with JWT authentication, per-user data, and audit logging.

## Architecture

```
Browser (index.html + script.js)  →  HTTP REST + JWT  →  FastAPI  →  PostgreSQL
```

The backend serves both the API and the frontend static files on port **8000**.

## Prerequisites

- **Python 3.11+** (3.13 works)
- **PostgreSQL** installed and running
- **pgAdmin** or **psql** (optional, for creating the database)

## 1. Create the database

In pgAdmin or psql:

```sql
CREATE DATABASE expenseiq;
```

If upgrading from the pre-auth version, **drop existing tables** so the new schema can be created:

```sql
DROP TABLE IF EXISTS audit_logs, expenses, user_settings, users CASCADE;
```

Or recreate the whole database:

```sql
DROP DATABASE IF EXISTS expenseiq;
CREATE DATABASE expenseiq;
```

## 2. Configure environment

```bash
cd backend
copy .env.example .env
```

Edit `.env` and set your PostgreSQL password and a secure JWT secret:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/expenseiq
CORS_ORIGINS=http://localhost:8000,http://127.0.0.1:8000,http://localhost:5500
JWT_SECRET=your-long-random-secret-string
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
```

## 3. Install dependencies

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

## 4. Run the server

```bash
uvicorn main:app --reload --port 8000
```

Open the app: **http://localhost:8000**

API docs (Swagger): **http://localhost:8000/docs**

Health check: **http://localhost:8000/health**

## Authentication

All `/api/*` endpoints except register and login require a **Bearer token** in the `Authorization` header.

1. **Register** at the login screen (Create Account tab) or via `POST /api/auth/register`
2. **Sign in** via the login screen or `POST /api/auth/login`
3. The frontend stores the JWT in `localStorage` as `expenseiq_token`

## API Endpoints

### Auth (public)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account `{ email, password, full_name }` |
| POST | `/api/auth/login` | Sign in `{ email, password }` |
| POST | `/api/auth/logout` | Log out (requires token; writes audit entry) |

### User profile (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me` | Get current user profile |
| PUT | `/api/users/me` | Update profile `{ full_name }` |

### Audit log (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/audit-logs?limit=50&offset=0` | List current user's activity |

### Expenses (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/expenses` | List current user's expenses |
| POST | `/api/expenses` | Create expense |
| PUT | `/api/expenses/{id}` | Update expense |
| DELETE | `/api/expenses/{id}` | Delete one expense |
| DELETE | `/api/expenses/bulk` | Delete multiple `{ "ids": [...] }` |

### Settings (authenticated)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get currency + monthly budget |
| PUT | `/api/settings` | Update currency and/or budget |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Database connectivity check |

## Frontend integration

- Click the **white logo dot** in the header to open the navigation sidebar (Home, Audit Log, Profile, Log Out).
- Hash routing: `#/home`, `#/profile`, `#/audit`, `#/login`
- Theme preference stays in browser `localStorage`.
- If you had data in `localStorage` before connecting the backend, it is **automatically imported** on first authenticated load when the database is empty.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Cannot connect to server` in UI | Start uvicorn from the `backend` folder |
| `connection refused` on port 5432 | Start PostgreSQL service |
| `database "expenseiq" does not exist` | Run `CREATE DATABASE expenseiq;` |
| `password authentication failed` | Check `DATABASE_URL` in `.env` |
| `column "user_id" does not exist` | Drop old tables (see step 1) and restart the server |
| `401 Not authenticated` | Sign in again; token may have expired |

## Project structure

```
backend/
├── main.py              # FastAPI app, CORS, static file routes
├── config.py            # Settings from .env (DB, JWT, CORS)
├── database.py          # SQLAlchemy engine + sessions
├── auth.py              # JWT + password hashing + get_current_user
├── audit_service.py     # Audit log writer
├── models.py            # User, Expense, UserSettings, AuditLog
├── schemas.py           # Pydantic request/response models
├── routers/
│   ├── auth.py          # Register, login, logout
│   ├── users.py         # Profile endpoints
│   ├── audit.py         # Audit log listing
│   ├── expenses.py      # Expense CRUD (per-user)
│   └── settings.py      # Budget + currency (per-user)
├── requirements.txt
├── .env.example
└── README.md
```
