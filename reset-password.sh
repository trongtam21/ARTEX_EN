#!/usr/bin/env bash
# =============================================================================
# ARTEX administrator password reset script
#
# The login username is fixed as ARTEX; the password is stored as a bcrypt hash in the
# auth.password_hash key in the settings table. After connecting, this script uses pgcrypto to generate the bcrypt hash
# and writes it back to that key, matching the backend login validation (golang.org/x/crypto/bcrypt).
#
# Deployment modes:
#   local (default) — connect to the database with psql on the host. Connection details use this priority:
#                    command-line arguments > --dsn/$ARTEX_PG_DSN > database.* in config.json
#   docker        — run psql inside the postgres container through `docker compose exec` (or `docker exec`)
#                    (Compose does not expose port 5432 to the host by default, so it runs inside the container).
#
# Examples:
#   ./reset-password.sh                          # 本地，自动读 config.json/环境，交互输入新密码
#   ./reset-password.sh -p 'NewPass!'            # 本地，直接给定新密码
#   ./reset-password.sh --dsn postgres://u:p@h:5432/artex
#   ./reset-password.sh -H 127.0.0.1 -P 5433 -U autopentest -W pass -d artex
#   ./reset-password.sh -m docker                # docker 部署（读 .env 的 POSTGRES_*）
#   ./reset-password.sh -m docker -c postgres-container --exec docker
#
# Security: the new password is passed through an environment variable + psql \getenv (not in process argv), and :'var'
# performs escaping automatically (preventing SQL injection); the database password uses PGPASSWORD and also stays out of argv.
# =============================================================================
set -euo pipefail

PASS_KEY="auth.password_hash"
BCRYPT_COST=10

MODE=""            # local | docker (blank = auto-detect)
DSN=""
HOST="" PORT="" USER="" DBPASS="" DBNAME="" SSLMODE=""
CONFIG=""
CONTAINER=""       # postgres service/container name in docker mode (default: postgres)
EXEC_KIND=""       # compose | docker (exec method in docker mode; blank = auto-detect)
NEWPASS=""
ASSUME_YES=0

die() { echo "错误：$*" >&2; exit 1; }
info() { echo "· $*" >&2; }

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

# ---- 参数解析 -------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--mode)        MODE="${2:-}"; shift 2 ;;
    --dsn)            DSN="${2:-}"; shift 2 ;;
    -H|--host)        HOST="${2:-}"; shift 2 ;;
    -P|--port)        PORT="${2:-}"; shift 2 ;;
    -U|--user)        USER="${2:-}"; shift 2 ;;
    -W|--db-password) DBPASS="${2:-}"; shift 2 ;;
    -d|--dbname)      DBNAME="${2:-}"; shift 2 ;;
    --sslmode)        SSLMODE="${2:-}"; shift 2 ;;
    --config)         CONFIG="${2:-}"; shift 2 ;;
    -c|--container)   CONTAINER="${2:-}"; shift 2 ;;
    --exec)           EXEC_KIND="${2:-}"; shift 2 ;;
    -p|--new-password) NEWPASS="${2:-}"; shift 2 ;;
    -y|--yes)         ASSUME_YES=1; shift ;;
    -h|--help)        usage ;;
    *) die "Unknown option: $1 (use -h for help)" ;;
  esac
done

# ---- Read database.* from config.json (local mode only, when no connection was supplied) -----
# Prefer python3 for robust parsing; fall back to grep when python3 is unavailable (config.json uses separate fields).
read_config_json() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1])).get("database", {})
except Exception:
    sys.exit(1)
# 支持直接给 dsn，或分字段
if d.get("dsn"):
    print("DSN\t" + d["dsn"]); sys.exit(0)
for k in ("host","port","user","password","dbname","sslmode"):
    if d.get(k) is not None:
        print(k.upper() + "\t" + str(d[k]))
PY
  else
    # Minimal fallback: grep each key (values are strings or numbers)
    local k
    for k in host port user password dbname sslmode; do
      local v
      v=$(grep -oE "\"$k\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[0-9]+)" "$path" 2>/dev/null \
            | head -1 | sed -E "s/.*:[[:space:]]*//; s/^\"//; s/\"$//") || true
      [[ -n "$v" ]] && echo -e "${k^^}\t$v"
    done
  fi
}

apply_config_fields() {
  local line key val
  while IFS=$'\t' read -r key val; do
    [[ -z "$key" ]] && continue
    case "$key" in
      DSN)      [[ -z "$DSN" ]] && DSN="$val" ;;
      HOST)     [[ -z "$HOST" ]] && HOST="$val" ;;
      PORT)     [[ -z "$PORT" ]] && PORT="$val" ;;
      USER)     [[ -z "$USER" ]] && USER="$val" ;;
      PASSWORD) [[ -z "$DBPASS" ]] && DBPASS="$val" ;;
      DBNAME)   [[ -z "$DBNAME" ]] && DBNAME="$val" ;;
      SSLMODE)  [[ -z "$SSLMODE" ]] && SSLMODE="$val" ;;
    esac
  done
}

# ---- Auto-detect the deployment mode ------------------------------------
if [[ -z "$MODE" ]]; then
  if [[ -n "$DSN$HOST$USER$DBNAME" || -n "${ARTEX_PG_DSN:-}" || -f "${CONFIG:-config.json}" ]]; then
    MODE="local"
  elif command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
    MODE="docker"
  else
    MODE="local"
  fi
fi
info "Deployment mode: $MODE"

# ---- Collect the new password -------------------------------------------
if [[ -z "$NEWPASS" ]]; then
  read -r -s -p "Enter the new password (username is fixed as ARTEX): " NEWPASS; echo >&2
  [[ -n "$NEWPASS" ]] || die "Password cannot be empty"
  read -r -s -p "Enter it again to confirm: " NEWPASS2; echo >&2
  [[ "$NEWPASS" == "$NEWPASS2" ]] || die "The passwords do not match"
fi
[[ -n "$NEWPASS" ]] || die "Password cannot be empty"

# Pass the password to psql through an environment variable (read by \getenv, not present in argv/ps)
export ARTEX_RESET_NEWPASS="$NEWPASS"

# Generate and upsert the bcrypt hash in the database; :'newpw' escapes the password automatically. CREATE EXTENSION is idempotent;
# a database role without permission to create extensions will fail here (see the failure message below).
SQL=$(cat <<SQL
\\set ON_ERROR_STOP on
\\getenv newpw ARTEX_RESET_NEWPASS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO settings(key, value)
VALUES ('$PASS_KEY', crypt(:'newpw', gen_salt('bf', $BCRYPT_COST)))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
SQL
)

# ---- Execute -------------------------------------------------------------
if [[ "$MODE" == "local" ]]; then
  # Connection priority: command line > --dsn/$ARTEX_PG_DSN > config.json
  if [[ -z "$DSN" && -z "$HOST$USER$DBNAME" ]]; then
    [[ -n "${ARTEX_PG_DSN:-}" ]] && DSN="$ARTEX_PG_DSN"
  fi
  if [[ -z "$DSN" && -z "$HOST$USER$DBNAME" ]]; then
    cfg="${CONFIG:-config.json}"
    if [[ -f "$cfg" ]]; then
      info "Reading database configuration from $cfg"
      apply_config_fields < <(read_config_json "$cfg")
    fi
  fi

  command -v psql >/dev/null 2>&1 || die "psql was not found locally (install postgresql-client or use -m docker)"

  declare -a PSQL_ARGS=()
  if [[ -n "$DSN" ]]; then
    PSQL_ARGS=("$DSN")
    target="$DSN"
  else
    [[ -n "$USER"   ]] || die "Database user (-U) or a valid config.json/DSN is required"
    [[ -n "$DBNAME" ]] || die "Database name (-d) or a valid config.json/DSN is required"
    HOST="${HOST:-127.0.0.1}"; PORT="${PORT:-5432}"; SSLMODE="${SSLMODE:-disable}"
    PSQL_ARGS=(-h "$HOST" -p "$PORT" -U "$USER" -d "$DBNAME")
    [[ -n "$SSLMODE" ]] && export PGSSLMODE="$SSLMODE"
    [[ -n "$DBPASS" ]] && export PGPASSWORD="$DBPASS"
    target="$USER@$HOST:$PORT/$DBNAME"
  fi

  info "目标数据库：$target"
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "确认在该库重置 ARTEX 密码？[y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "已取消"
  fi

  if ! printf '%s\n' "$SQL" | psql "${PSQL_ARGS[@]}" -v ON_ERROR_STOP=1 -q >/dev/null; then
    die "写入失败。若报 pgcrypto 权限/缺失，请用具备建扩展权限的角色，或先手动执行 CREATE EXTENSION pgcrypto。"
  fi

else
  # ---- docker ----
  command -v docker >/dev/null 2>&1 || die "未找到 docker"
  CONTAINER="${CONTAINER:-postgres}"

  # 选择 exec 方式：优先 docker compose exec（服务名），否则 docker exec（容器名）
  if [[ -z "$EXEC_KIND" ]]; then
    if docker compose version >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
      EXEC_KIND="compose"
    else
      EXEC_KIND="docker"
    fi
  fi

  # 容器内的 psql 凭据：优先命令行，其次 .env 的 POSTGRES_*，再退回 compose 默认(artex)
  if [[ -f .env ]]; then
    # shellcheck disable=SC1091
    set -a; . ./.env; set +a
  fi
  DUSER="${USER:-${POSTGRES_USER:-artex}}"
  DNAME="${DBNAME:-${POSTGRES_DB:-artex}}"
  [[ -n "$DBPASS" ]] && export PGPASSWORD="$DBPASS"
  [[ -z "${PGPASSWORD:-}" && -n "${POSTGRES_PASSWORD:-}" ]] && export PGPASSWORD="$POSTGRES_PASSWORD"

  info "目标：容器 $CONTAINER 内 psql -U $DUSER -d $DNAME（exec=$EXEC_KIND）"
  if [[ "$ASSUME_YES" -ne 1 ]]; then
    read -r -p "确认在该容器数据库重置 ARTEX 密码？[y/N] " ans
    [[ "$ans" == "y" || "$ans" == "Y" ]] || die "已取消"
  fi

  # -e 只带名字不带值 → 从当前环境继承，密码不出现在 docker 命令 argv 里。
  declare -a EXEC_CMD
  if [[ "$EXEC_KIND" == "compose" ]]; then
    EXEC_CMD=(docker compose exec -T -e ARTEX_RESET_NEWPASS -e PGPASSWORD "$CONTAINER"
              psql -U "$DUSER" -d "$DNAME" -v ON_ERROR_STOP=1 -q)
  else
    EXEC_CMD=(docker exec -i -e ARTEX_RESET_NEWPASS -e PGPASSWORD "$CONTAINER"
              psql -U "$DUSER" -d "$DNAME" -v ON_ERROR_STOP=1 -q)
  fi

  if ! printf '%s\n' "$SQL" | "${EXEC_CMD[@]}" >/dev/null; then
    die "写入失败。请确认容器名（-c）、数据库账号（.env 的 POSTGRES_*），以及角色有 pgcrypto 权限。"
  fi
fi

unset ARTEX_RESET_NEWPASS
echo "✓ 已重置 ARTEX 管理员密码。请用用户名 ARTEX + 新密码登录（无需重启服务）。"
