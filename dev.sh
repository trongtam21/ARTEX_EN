#!/usr/bin/env bash
# Development mode: run the backend (:8787), traffic proxy (:8788), and Next dev server (:5173) together.
# The frontend proxies /api to the backend; Ctrl-C stops everything.
#
# For the single binary with an embedded frontend, see the corresponding README section instead.
set -euo pipefail
cd "$(dirname "$0")"

# Stop all child processes in this process group on exit (backend + frontend).
cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Backend (regular go run without an embedded frontend); configure concurrent work-agent count in System Settings.
go run ./cmd/artex -addr :8787 -proxy 127.0.0.1:8788 &

# Frontend hot reload (Vite/Next dev server, /api proxied to :8787).
( cd web && npm run dev ) &

echo "[dev] backend :8787 / proxy :8788 / frontend http://localhost:5173  (Ctrl-C to stop)"
wait
