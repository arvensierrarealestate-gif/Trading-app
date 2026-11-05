@echo off
REM Prints setup facts for troubleshooting. Safe to screenshot: the API key is never shown.
cd /d "%~dp0"
echo Program folder : %CD%
if exist ".env" (echo .env file      : found) else (echo .env file      : NOT FOUND)
findstr /b /c:"ANTHROPIC_API_KEY=sk-ant" ".env" >nul 2>nul && (echo API key line   : present) || (echo API key line   : MISSING)
if exist ".venv\Scripts\python.exe" (echo Python env     : ready) else (echo Python env     : not created yet)
echo Running bots   :
tasklist /fi "imagename eq python.exe" | findstr /i python.exe
echo.
pause
