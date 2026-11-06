@echo off
REM One-click launcher for Maryland Contract Scout (Windows).
REM Double-click this file. It sets up Python packages on first run, loads sample data if the
REM database is empty, starts the dashboard, and opens it in your browser. Keep this window open.
setlocal
cd /d "%~dp0"
title Maryland Contract Scout

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads and tick "Add python.exe to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating the Python environment, one-time step...
  python -m venv .venv
)
call ".venv\Scripts\activate.bat"

".venv\Scripts\python.exe" -c "import streamlit, pypdf, docx, anthropic" >nul 2>nul
if errorlevel 1 (
  echo Installing packages, one-time step, this takes a minute or two...
  ".venv\Scripts\python.exe" -m pip install --quiet -r requirements.txt
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
)
findstr /b /c:"ANTHROPIC_API_KEY=sk-ant" ".env" >nul 2>nul
if not errorlevel 1 goto keyok
echo.
echo No Anthropic API key found in .env.
echo Paste your key now (it starts with sk-ant-) and press Enter. Press Enter alone to skip and keep the offline reader.
set SCOUT_KEY=
set /p SCOUT_KEY=Key: 
if "%SCOUT_KEY%"=="" goto keyok
".venv\Scripts\python.exe" scripts\set_api_key.py "%SCOUT_KEY%"
:keyok

if exist "data\scout.db" (
  if not exist "data\backups" mkdir "data\backups"
  for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set D=%%c-%%a-%%b
  copy /y "data\scout.db" "data\backups\scout_launch_%D%.db" >nul
)

if not exist "data\scout.db" (
  echo Loading the two fictitious sample solicitations...
  ".venv\Scripts\python.exe" scripts\seed_sample_data.py
)

echo.
echo Starting the dashboard at http://localhost:8501
echo Keep this window open while you use it. Close it to stop the app.
echo.
start "" "http://localhost:8501"
".venv\Scripts\python.exe" -m streamlit run app.py --server.headless true --browser.gatherUsageStats false
pause
