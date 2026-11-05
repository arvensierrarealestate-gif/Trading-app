@echo off
REM Creates (or replaces) a Windows scheduled task that runs run_scan.bat every weekday at 7:30 AM.
REM Double-click once. Remove later with:  schtasks /delete /tn "Maryland Contract Scout scan" /f
cd /d "%~dp0"
schtasks /create /f /sc weekly /d MON,TUE,WED,THU,FRI /st 07:30 /tn "Maryland Contract Scout scan" /tr "\"%~dp0run_scan.bat\""
if errorlevel 1 (
  echo Could not create the scheduled task. Right-click this file and choose "Run as administrator".
) else (
  echo Scheduled: weekdays 7:30 AM. Output goes to data\scan.log. The computer must be on at that time.
)
pause
