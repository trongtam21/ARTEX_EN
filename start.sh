#!/bin/sh
# ARTEX supervisor script (Linux / macOS / Docker ENTRYPOINT)
#
# Usage:
#   ./start.sh                         Run in the foreground (Ctrl-C to stop)
#   nohup ./start.sh >artex.log 2>&1 & Run in the background
#   ./start.sh -addr :9000             Pass extra arguments to artex
#
# It starts artex and decides whether to restart it based on the exit code.
#
#   0      Normal user stop       → exit the loop
#   75     Restart requested      → restart immediately (update or rollback)
#   other  Crash                  → restart with backoff (1→2→4… up to 60 seconds)
#
# Downloads, SHA256 verification, and replacement stay in the Go selfupdate package
# so this script remains a simple supervisor.
set -u

cd "$(dirname "$0")" || exit 1

BIN=./artex
[ -x "$BIN" ] || { echo "[artex] executable not found: $BIN" >&2; exit 1; }

RESTART_CODE=75
MAX_DELAY=60

child=0
stopping=0

# Forward termination signals to artex.
# Docker sends SIGTERM to PID 1 (this script), not the child process. Forwarding
# the signal lets artex shut down gracefully instead of being killed after 10 seconds.
forward() {
	stopping=1
	if [ "$child" -ne 0 ]; then
		kill -TERM "$child" 2>/dev/null || true
	fi
}
trap forward INT TERM

delay=1
while :; do
	"$BIN" "$@" &
	child=$!

	# A signal interrupts wait and makes it return >128 while the child is still shutting down gracefully.
	# Wait once more to receive the child's actual exit code.
	wait "$child"
	code=$?
	if [ "$code" -gt 128 ]; then
		wait "$child"
		code=$?
	fi
	child=0

	if [ "$stopping" -eq 1 ]; then
		echo "[artex] stopped"
		exit 0
	fi

	case "$code" in
		0)
			echo "[artex] exited normally"
			exit 0
			;;
		"$RESTART_CODE")
			# Update/rollback is ready; artex completes the replacement on startup.
			echo "[artex] restart requested (applying the new version)…"
			delay=1
			;;
		*)
			echo "[artex] exited unexpectedly (code=$code); restarting in ${delay}s" >&2
			sleep "$delay"
			delay=$((delay * 2))
			[ "$delay" -gt "$MAX_DELAY" ] && delay=$MAX_DELAY
			;;
	esac
done
