@echo off
REM Runs one scan (inbox intake, evaluation, alerts, digest) and appends the output to data\scan.log.
cd /d "%~dp0"
if not exist "data" mkdir data
".venv\Scripts\python.exe" scripts\run_scan.py >> data\scan.log 2>&1
