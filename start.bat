@echo off
rem Switch the console to UTF-8 so this file renders correctly in GBK terminals.
chcp 65001 >nul 2>&1
rem ARTEX supervisor script (Windows)
rem
rem Usage:
rem   start.bat                  Run in the foreground (Ctrl-C to stop)
rem   start.bat -addr :9000      Pass extra arguments through to artex
rem
rem It starts artex.exe and decides whether to restart it based on the exit code.
rem
rem   0      Normal user stop       -> exit the loop
rem   75     Restart requested       -> restart immediately (one-click update or rollback)
rem   other  Crash                  -> restart with backoff (1->2->4…up to 60 seconds)
rem
rem Downloads, SHA256 verification, and replacement are handled by artex at startup
rem (the selfupdate package). This script stays simple; see the start.sh header for details.

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "BIN=artex.exe"
if not exist "%BIN%" (
	echo [artex] executable not found: %BIN% 1>&2
	exit /b 1
)

set "RESTART_CODE=75"
set "MAX_DELAY=60"
set /a delay=1

:loop
"%BIN%" %*
set "code=!ERRORLEVEL!"

if "!code!"=="0" (
	echo [artex] exited normally
	exit /b 0
)

if "!code!"=="%RESTART_CODE%" (
	rem The update/rollback is ready; artex applies it during the next startup.
	echo [artex] restart requested (applying the new version)…
	set /a delay=1
	goto loop
)

echo [artex] exited unexpectedly ^(code=!code!^); restarting in !delay!s 1>&2
rem timeout can fail on redirected consoles, so use ping as a fallback (N+1 pings for an N-second delay).
set /a pings=!delay!+1
ping -n !pings! 127.0.0.1 >nul 2>&1
set /a delay=!delay!*2
if !delay! gtr %MAX_DELAY% set /a delay=%MAX_DELAY%
goto loop
