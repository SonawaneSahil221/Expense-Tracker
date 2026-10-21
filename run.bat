@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo.
echo  ExpenseIQ - Expense Tracker
echo  ===========================
echo.

if not exist "venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Could not create venv. Install Python 3.11+ and ensure "python" is on PATH.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat

if not exist "backend\.env" (
    echo ERROR: backend\.env not found.
    echo Copy backend\.env.example to backend\.env and set your database password.
    pause
    exit /b 1
)

echo Installing dependencies...
pip install -r backend\requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

cd backend

echo.
echo  App:     http://localhost:8000
echo  API docs: http://localhost:8000/docs
echo  Press Ctrl+C to stop the server.
echo.

uvicorn main:app --reload --port 8000

pause
