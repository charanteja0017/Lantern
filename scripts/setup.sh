#!/usr/bin/env bash
# NovaHunter — one-shot installer for the full backend + frontend stack.
#
# Designed for a fresh Ubuntu / Debian VPS with nothing more than a public IP.
# No domain, no TLS cert, no LLM key, no Clerk account required up front —
# those are configured later through the admin dashboard.
#
#   Usage (run from inside a checkout of this repository):
#       sudo bash scripts/setup.sh
#
# This script assumes you have ALREADY cloned the repo yourself (git, scp,
# rsync, ...). It will NOT attempt to fetch, clone, or git-reset anything.
# The current checkout — the directory containing this script's parent — is
# used in place as the source tree, and all state (deploy/.env, backups,
# compose project) lives inside that checkout.
#
# Flags:
#   --dry-run    Print every mutating action instead of executing it.
#                Safe to run against a live deployment.
#   --no-backup  Skip the pre-deploy backup of deploy/.env and postgres.
#   --yes        Don't prompt; assume confirmation for destructive steps.
#   --help       Show this message.
#
# Environment overrides:
#   NOVA_HTTP_PORT, STRIX_IMAGE
#   STRIX_SETUP_DRY_RUN=1  (equivalent to --dry-run for CI smoke tests)

set -euo pipefail

# Keep apt/apt-get fully non-interactive for the whole script. Exporting once
# here is both simpler and more portable than the `VAR=val cmd` prefix form,
# which bash does not always honour after an empty variable expansion (e.g.
# when `$SUDO` is empty because the user already ran the script via
# `sudo bash scripts/setup.sh`).
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# --- Pretty logging ----------------------------------------------------------
if [[ -t 1 ]]; then
    RED=$'\033[0;31m'; GREEN=$'\033[0;32m'
    YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'
else
    RED=""; GREEN=""; YELLOW=""; CYAN=""; NC=""
fi
log()  { printf "%s[novahunter]%s %s\n" "${CYAN}"   "${NC}" "$*"; }
warn() { printf "%s[novahunter]%s %s\n" "${YELLOW}" "${NC}" "$*"; }
ok()   { printf "%s[novahunter]%s %s\n" "${GREEN}"  "${NC}" "$*"; }
die()  { printf "%s[novahunter]%s %s\n" "${RED}"    "${NC}" "$*" >&2; exit 1; }

# --- Resolve the source tree from the script's own location ----------------
# setup.sh always lives at <repo>/scripts/setup.sh, so we can derive the repo
# root unambiguously without relying on $PWD or an install-dir flag.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -f "${INSTALL_DIR}/deploy/docker-compose.yml" ]]; then
    die "Could not find deploy/docker-compose.yml under ${INSTALL_DIR}. \
This script must be run from inside a full NovaHunter checkout."
fi

HTTP_PORT="${NOVA_HTTP_PORT:-80}"

DRY_RUN="${STRIX_SETUP_DRY_RUN:-0}"
DO_BACKUP=1
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)       DRY_RUN=1 ;;
        --no-backup)     DO_BACKUP=0 ;;
        --yes|-y)        ASSUME_YES=1 ;;
        --help|-h)
            sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            die "Unknown argument: $1 (try --help)"
            ;;
    esac
    shift
done

# --- Sudo helper -------------------------------------------------------------
if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        if [[ "$DRY_RUN" == "1" ]]; then
            # Dry runs don't actually need root; just warn and continue so
            # CI smoke tests can validate this script on stock runners.
            warn "not root; continuing in --dry-run mode."
            SUDO=""
        else
            die "This script needs root privileges (re-run with sudo, or install sudo)."
        fi
    fi
else
    SUDO=""
fi

# --- Dry-run plumbing --------------------------------------------------------
# run_cmd is the single choke-point for any command that mutates the host.
# When --dry-run is set we print the fully-resolved command line instead of
# executing it, so an operator can review the plan before committing.
run_cmd() {
    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s %s\n" "${YELLOW}" "${NC}" "$*"
        return 0
    else
        "$@"
    fi
}

run_shell() {
    # Variant for commands that need word-splitting / redirection done by a
    # subshell; the caller passes a single string.
    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s %s\n" "${YELLOW}" "${NC}" "$1"
        return 0
    else
        bash -c "$1"
    fi
}

confirm_or_abort() {
    local prompt="$1"
    if [[ "$ASSUME_YES" == "1" || "$DRY_RUN" == "1" ]]; then
        return 0
    fi
    if [[ ! -t 0 ]]; then
        # Non-interactive shell (curl | bash) — refuse to do destructive
        # things silently.
        die "$prompt (re-run with --yes to confirm non-interactively)"
    fi
    printf "%s[novahunter]%s %s [y/N]: " "${YELLOW}" "${NC}" "$prompt"
    local reply
    read -r reply || reply=""
    [[ "$reply" =~ ^[Yy]$ ]] || die "Aborted by user."
}

# --- Utility helpers ---------------------------------------------------------
random_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
    else
        head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

detect_public_ip() {
    local ip
    for url in \
        https://ifconfig.me \
        https://api.ipify.org \
        https://ipv4.icanhazip.com \
        https://checkip.amazonaws.com; do
        ip="$(curl -fsSL --max-time 3 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
        if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
            printf "%s" "$ip"
            return 0
        fi
    done
    # Fallback: first non-loopback IPv4 on the host.
    ip="$(hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+\./ && $i != "127.0.0.1"){print $i; exit}}')"
    if [[ -n "$ip" ]]; then printf "%s" "$ip"; return 0; fi
    printf "localhost"
}

# --- Step 0: preflight summary ----------------------------------------------
# Print everything we intend to do *before* touching the host. This lets an
# operator catch mis-detected values (wrong checkout, wrong revision, etc.)
# before we start mutating containers or Postgres.
preflight_ports() {
    # The compose stack listens on :${HTTP_PORT} (frontend+API via Caddy) and
    # proxies side-channels for the sandbox through the same port. If another
    # service has already bound the port we want to fail loudly *before* any
    # apt install — an unrecoverable "address already in use" an hour into
    # the deploy is the worst-possible UX. We only check the host port here;
    # sandbox side-channel ports are randomized per-run, not fixed.
    local port="$HTTP_PORT"
    if ! command -v ss >/dev/null 2>&1; then
        return 0
    fi
    if $SUDO ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq ":${port}$"; then
        warn "Port :${port} is already in use on this host."
        warn "Either stop the conflicting service or set NOVA_HTTP_PORT to a free port."
    fi
}

preflight_summary() {
    log "Preflight summary"
    printf "    Source tree    : %s\n" "$INSTALL_DIR"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
        local rev branch
        rev="$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
        branch="$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
        printf "    Checkout       : branch=%s rev=%s\n" "$branch" "$rev"
    else
        printf "    Checkout       : (not a git repo; using tree as-is)\n"
    fi
    printf "    HTTP port      : %s\n" "$HTTP_PORT"
    printf "    Sudo           : %s\n" "${SUDO:-(already root)}"
    printf "    Dry run        : %s\n" "$DRY_RUN"
    printf "    Pre-deploy backup: %s\n" "$DO_BACKUP"

    if command -v docker >/dev/null 2>&1; then
        printf "    Docker         : %s\n" "$(docker --version 2>/dev/null || echo unknown)"
        if [[ -f "$INSTALL_DIR/deploy/docker-compose.yml" ]]; then
            local running
            running="$($SUDO docker compose \
                --project-directory "$INSTALL_DIR/deploy" \
                --env-file "$INSTALL_DIR/deploy/.env" \
                ps --format '{{.Service}}' 2>/dev/null | tr '\n' ' ' || true)"
            if [[ -n "${running// }" ]]; then
                printf "    Running stack  : %s\n" "$running"
            else
                printf "    Running stack  : (none)\n"
            fi
        fi
    else
        printf "    Docker         : (will install)\n"
    fi
    printf "    Published ports: %s (published by Caddy/compose)\n" "$HTTP_PORT"
    printf "\n"
}

# --- Step 0b: backup deployment-critical state ------------------------------
backup_state() {
    if [[ "$DO_BACKUP" != "1" ]]; then
        warn "Skipping backup (--no-backup)."
        return 0
    fi

    local env_file="$INSTALL_DIR/deploy/.env"
    local compose_file="$INSTALL_DIR/deploy/docker-compose.yml"
    local backup_dir="$INSTALL_DIR/backups/$(date -u +%Y%m%dT%H%M%SZ)"

    if [[ ! -f "$env_file" ]] && [[ ! -f "$compose_file" ]]; then
        log "No existing deployment detected; skipping backup."
        return 0
    fi

    log "Backing up deployment state to $backup_dir"
    run_cmd $SUDO mkdir -p "$backup_dir"
    if [[ -f "$env_file" ]]; then
        run_cmd $SUDO cp -a "$env_file" "$backup_dir/env.backup"
    fi
    if [[ -f "$compose_file" ]]; then
        run_cmd $SUDO cp -a "$compose_file" "$backup_dir/docker-compose.yml"
        if command -v sha256sum >/dev/null 2>&1; then
            run_shell "sha256sum '$compose_file' | $SUDO tee '$backup_dir/compose.sha256' >/dev/null"
        fi
    fi

    # Optional Postgres logical dump. We look for the expected compose service
    # name first; if the container is down we simply skip — stopped Postgres
    # means the data is already at rest on the volume.
    if command -v docker >/dev/null 2>&1; then
        local pg_container
        pg_container="$($SUDO docker compose \
            --project-directory "$INSTALL_DIR/deploy" \
            --env-file "$env_file" \
            ps --status running --format '{{.Service}}' 2>/dev/null | grep -E '^(postgres|db)$' | head -n1 || true)"
        if [[ -n "$pg_container" ]]; then
            log "Running pg_dumpall against $pg_container (best-effort)"
            run_shell "set -euo pipefail
                # Load values from deploy/.env so POSTGRES_USER overrides apply.
                set -a; . '$env_file' 2>/dev/null || true; set +a
                $SUDO docker compose \
                    --project-directory '$INSTALL_DIR/deploy' \
                    --env-file '$env_file' \
                    exec -T '$pg_container' pg_dumpall -U \"\${POSTGRES_USER:-strix}\" \
                    > '$backup_dir/postgres.sql' || \
                    printf '%s[novahunter]%s pg_dumpall skipped\n' '${YELLOW}' '${NC}'"
        fi
    fi

    ok "Backup snapshot stored at $backup_dir"
}

# --- Step 1: OS prerequisites ------------------------------------------------
# `as_root` runs the given command with root privileges, using `sudo -E` when
# available so env vars like DEBIAN_FRONTEND are preserved through sudo's
# `env_reset`. When we are already root (SUDO="") the command runs directly.
as_root() {
    if [[ -n "$SUDO" ]]; then
        $SUDO -E "$@"
    else
        "$@"
    fi
}

install_prereqs() {
    log "Refreshing apt index and installing base packages..."
    run_cmd as_root apt-get update -y -qq
    # weasyprint (server-side PDF export for /api/runs/{id}/report.pdf) needs
    # the Cairo + Pango + GDK-PixBuf system libs. Installing them on the host
    # is harmless if the API container already ships them — apt is a no-op in
    # that case — and avoids a class of "PDF export returned HTTP 501" tickets.
    run_cmd as_root apt-get install -y -qq --no-install-recommends \
        ca-certificates curl gnupg lsb-release openssl iproute2 \
        libcairo2 libpango-1.0-0 libpangoft2-1.0-0 libgdk-pixbuf-2.0-0 libffi8 \
        shared-mime-info fonts-liberation

    if ! command -v docker >/dev/null 2>&1; then
        log "Installing Docker Engine via get.docker.com ..."
        if [[ "$DRY_RUN" == "1" ]]; then
            printf "%s[dry-run]%s curl -fsSL https://get.docker.com | sh\n" "${YELLOW}" "${NC}"
        elif [[ -n "$SUDO" ]]; then
            curl -fsSL https://get.docker.com | $SUDO sh
        else
            curl -fsSL https://get.docker.com | sh
        fi
    else
        ok "Docker already installed: $(docker --version)"
    fi

    if ! docker compose version >/dev/null 2>&1; then
        log "Installing the Docker Compose plugin ..."
        run_cmd as_root apt-get install -y -qq --no-install-recommends \
            docker-compose-plugin || die "Failed to install docker-compose-plugin"
    fi

    run_cmd as_root systemctl enable --now docker || true

    if [[ "$DRY_RUN" != "1" ]]; then
        ok "Prerequisites OK  ($(docker --version) / $(docker compose version))"
    fi
}

# --- Step 2: render deploy/.env ---------------------------------------------
# Resolve the host's docker group GID so the API container (which runs as an
# unprivileged user) can read/write /var/run/docker.sock. Falls back to 999 —
# the Debian/Ubuntu default — if the group is missing for any reason.
detect_docker_gid() {
    local gid=""
    if command -v getent >/dev/null 2>&1; then
        gid="$(getent group docker 2>/dev/null | cut -d: -f3 || true)"
    fi
    if [[ -z "$gid" ]] && [[ -e /var/run/docker.sock ]]; then
        gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
    fi
    [[ -z "$gid" ]] && gid="999"
    printf "%s" "$gid"
}

# Ensure the .env file carries a ``KEY=value`` pair, appending if missing and
# replacing in place if present. Idempotent so re-running setup.sh keeps the
# file current without clobbering any operator edits.
upsert_env_var() {
    local env_file="$1" key="$2" value="$3"
    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s upsert %s=%s in %s\n" \
            "${YELLOW}" "${NC}" "$key" "$value" "$env_file"
        return 0
    fi
    if $SUDO grep -q "^${key}=" "$env_file" 2>/dev/null; then
        # sed -i with a delimiter that won't collide with GID/paths.
        $SUDO sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
    else
        printf '%s=%s\n' "$key" "$value" | $SUDO tee -a "$env_file" >/dev/null
    fi
}

write_env() {
    local env_file="$INSTALL_DIR/deploy/.env"
    local docker_gid; docker_gid="$(detect_docker_gid)"

    if [[ -f "$env_file" ]]; then
        warn ".env already exists at $env_file — leaving your settings untouched."
        # Still reconcile the runtime-derived values (docker group GID) so a
        # re-run picks up a reinstalled Docker with a different group id.
        upsert_env_var "$env_file" "DOCKER_GID" "$docker_gid"
        # Ensure the configured host HTTP port persists across sudo/docker compose.
        # Compose variable expansion for ports happens on the host, not in the container.
        upsert_env_var "$env_file" "NOVA_HTTP_PORT" "$HTTP_PORT"
        return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s would render fresh %s (Postgres password auto-generated, DOCKER_GID=%s)\n" \
            "${YELLOW}" "${NC}" "$env_file" "$docker_gid"
        return 0
    fi

    local pg_pw; pg_pw="$(random_secret)"
    local public_ip; public_ip="$(detect_public_ip)"
    # STRIX_MASTER_KEY is a 32-byte key (hex) that unlocks the encrypted
    # secret store used by the LLM role router. Generating one up front means
    # the API can persist LLM API keys / webhook secrets from day one; rotate
    # by replacing the value and re-adding each secret via the admin UI.
    local master_key; master_key="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

    $SUDO mkdir -p "$(dirname "$env_file")"
    $SUDO tee "$env_file" >/dev/null <<EOF
# NovaHunter deployment config (generated by scripts/setup.sh on $(date -u +%FT%TZ)).
# This file contains only the minimum needed to boot the stack on a bare IP.
# LLM providers, Clerk auth and any other integrations are configured later
# from the admin UI at http://${public_ip}/admin/settings.

# --- Core infrastructure -----------------------------------------------------
STRIX_ENV=development
STRIX_LOG_LEVEL=INFO
STRIX_ALLOWED_ORIGINS=*
STRIX_TRUSTED_HOSTS=*

# Host port to publish Caddy on (see deploy/docker-compose.yml).
NOVA_HTTP_PORT=${HTTP_PORT}

# Caddy reverse proxy (HTTP only — serves on :80 for any hostname or IP).
STRIX_DOMAIN=
STRIX_TLS_EMAIL=internal

# --- Postgres (auto-generated strong password, do not edit) -----------------
POSTGRES_USER=strix
POSTGRES_PASSWORD=${pg_pw}
POSTGRES_DB=strix

# --- Frontend ---------------------------------------------------------------
NEXT_PUBLIC_APP_NAME=NovaHunter
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_DEMO=false

# --- Clerk (fill from https://dashboard.clerk.com) ---------------------------
# Optional on first boot: with STRIX_ENV=development and these empty, the API
# uses a demo principal until you add keys and rebuild the frontend image.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_ISSUER=
CLERK_JWKS_URL=

# --- Platform-admin elevation ---------------------------------------------
# After Clerk works, set your email and/or Clerk user id (Users in dashboard).
STRIX_ADMIN_EMAILS=
STRIX_ADMIN_USER_IDS=

# --- Host docker group (auto-detected) -------------------------------------
# Passed to the api service via docker-compose ``group_add`` so the container
# can use /var/run/docker.sock to spawn sandbox sibling containers.
DOCKER_GID=${docker_gid}

# --- Encrypted secret store -------------------------------------------------
# 32-byte AES-GCM master key used by strix.api.services.secrets. API keys for
# LLM providers (OpenAI, Anthropic, etc.) stored via the admin UI are
# encrypted at rest with this key. DO NOT regenerate blindly — doing so makes
# every stored secret unreadable. Rotate by re-adding each secret after
# updating the value below.
STRIX_MASTER_KEY=${master_key}

# --- Sandbox image (used by every scan) -------------------------------------
# NovaHunter ships its own Kali-based sandbox image that bundles Burp CE,
# Caido, a headless browser, shellinabox, noVNC/tightvnc, openvpn, netcat-
# manager, and the curated pentest toolbelt. The agent inside the sandbox
# container decides whether to use Burp or Caido per-task. Override this
# variable to pin a custom build:
#
#    STRIX_IMAGE=ghcr.io/you/novahunter-sandbox:tag sudo bash scripts/setup.sh
STRIX_IMAGE=ghcr.io/maramharsha/novahunter-sandbox:latest
EOF
    $SUDO chmod 600 "$env_file"
    ok "Wrote $env_file (Postgres password auto-generated, DOCKER_GID=${docker_gid})."
}

# --- Step 3: pre-pull the agent sandbox image ------------------------------
# The web dashboard runs scans by spawning a sibling Docker container from
# the Strix sandbox image (same image the CLI uses — it's the one that
# actually carries nmap, caido, the browser, and the rest of the tools).
# Pulling it up front means the first scan kicked off from the UI starts
# instantly instead of stalling for a multi-hundred-MB download.
prepull_sandbox() {
    # Keep the default aligned with deploy/docker-compose.yml (STRIX_IMAGE).
    local image="${STRIX_IMAGE:-ghcr.io/maramharsha/novahunter-sandbox:latest}"
    log "Pulling agent sandbox image: ${image} ..."
    if run_cmd as_root docker pull "$image"; then
        if [[ "$DRY_RUN" != "1" ]]; then
            ok "Sandbox image ready."
        fi
    else
        warn "Failed to pull ${image}. Scans launched from the UI will retry the pull on first use."
    fi
    return 0
}

# --- Step 4: build and start -------------------------------------------------
compose_up() {
    log "Building and starting the full stack (this can take 3–8 min on first run)..."
    run_shell "cd '$INSTALL_DIR/deploy' && $SUDO docker compose --env-file .env pull --ignore-pull-failures 2>/dev/null || true"
    run_shell "cd '$INSTALL_DIR/deploy' && $SUDO docker compose --env-file .env up -d --build"
    if [[ "$DRY_RUN" != "1" ]]; then
        ok "Stack launched."
    fi
    return 0
}

# --- Step 5: wait for healthy ------------------------------------------------
dump_unhealthy_logs() {
    # When a container is stuck at `starting` or `unhealthy`, showing the tail
    # of its logs is far more useful than just printing `ps`. We inspect the
    # service list and dump the last 60 lines for anything not healthy.
    local status_line; status_line="$($SUDO docker compose \
        --project-directory "$INSTALL_DIR/deploy" \
        --env-file "$INSTALL_DIR/deploy/.env" \
        ps --format '{{.Service}}={{.Health}}' 2>/dev/null || true)"
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local svc="${line%%=*}" health="${line##*=}"
        if [[ -n "$health" && "$health" != "healthy" ]]; then
            warn "--- logs for $svc ($health, last 80 lines) ---"
            $SUDO docker compose \
                --project-directory "$INSTALL_DIR/deploy" \
                --env-file "$INSTALL_DIR/deploy/.env" \
                logs --tail=80 --no-color "$svc" 2>/dev/null | sed 's/^/    /' || true
        fi
    done <<< "$status_line"
}

wait_for_health() {
    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s would wait for services to report healthy (10 min timeout)\n" \
            "${YELLOW}" "${NC}"
        return 0
    fi

    log "Waiting for services to report healthy (timeout 10 min) ..."
    local deadline=$((SECONDS + 600))
    while (( SECONDS < deadline )); do
        local status; status="$($SUDO docker compose \
            --project-directory "$INSTALL_DIR/deploy" \
            --env-file "$INSTALL_DIR/deploy/.env" \
            ps --format '{{.Service}}={{.Health}}' 2>/dev/null || true)"
        local unhealthy=0
        while IFS= read -r line; do
            [[ -z "$line" ]] && continue
            local health="${line##*=}"
            [[ -n "$health" && "$health" != "healthy" ]] && { unhealthy=1; break; }
        done <<< "$status"
        (( unhealthy == 0 )) && { ok "All services healthy."; return 0; }
        sleep 5
    done
    warn "Timed out waiting for healthy services. Current status:"
    $SUDO docker compose --project-directory "$INSTALL_DIR/deploy" \
        --env-file "$INSTALL_DIR/deploy/.env" ps || true
    dump_unhealthy_logs
    print_rollback_hint
    return 1
}

# Render a self-contained rollback recipe using the most recent backup.
print_rollback_hint() {
    local latest_backup
    latest_backup="$(ls -1dt "$INSTALL_DIR"/backups/* 2>/dev/null | head -n1 || true)"
    warn "Post-deploy health check failed. Recovery options:"
    echo "    # 1) Tail logs (often shows the cause in 5-10 seconds)"
    echo "    $SUDO docker compose -f $INSTALL_DIR/deploy/docker-compose.yml --env-file $INSTALL_DIR/deploy/.env logs -f"
    echo
    if [[ -n "$latest_backup" ]]; then
        echo "    # 2) Restore the .env from the pre-deploy backup and redeploy"
        echo "    $SUDO cp $latest_backup/env.backup $INSTALL_DIR/deploy/.env"
        echo "    $SUDO bash $INSTALL_DIR/scripts/setup.sh --no-backup"
        echo
        if [[ -f "$latest_backup/postgres.sql" ]]; then
            echo "    # 3) (Optional) restore Postgres from the logical dump"
            echo "    cat $latest_backup/postgres.sql | \\"
            echo "        $SUDO docker compose -f $INSTALL_DIR/deploy/docker-compose.yml --env-file $INSTALL_DIR/deploy/.env \\"
            echo "            exec -T postgres psql -U \${POSTGRES_USER:-strix}"
        fi
    else
        echo "    # (No pre-deploy backup available — next run will create one if --no-backup is not set.)"
    fi
    echo
}

# --- Step 5b: install the `strix` CLI --------------------------------------
# The web dashboard is one half of NovaHunter; the other half is the `strix`
# command-line binary that operators use to trigger scans from a shell.
# `scripts/install.sh` downloads the correct prebuilt binary for the host arch,
# drops it under ~/.strix/bin, and wires up $PATH for the caller. We run it
# here so a single `setup.sh` leaves the VPS with both the stack *and* the CLI
# ready to use. If the CLI fails to install the stack is still fully usable —
# we log a warning and move on.
install_cli() {
    local installer="$INSTALL_DIR/scripts/install.sh"
    if [[ ! -f "$installer" ]]; then
        warn "CLI installer not found at $installer — skipping strix CLI setup."
        return 0
    fi

    log "Installing the strix CLI (binary drop + PATH wire-up) ..."
    if [[ "$DRY_RUN" == "1" ]]; then
        printf "%s[dry-run]%s bash %s\n" "${YELLOW}" "${NC}" "$installer"
        return 0
    fi
    # Run as the invoking user (or root if setup.sh was invoked with sudo) so
    # the binary lands in a predictable $HOME. `bash` is invoked with `-e`
    # inherited from the installer's own `set -euo pipefail` — we intentionally
    # do NOT propagate failure here since the stack is the priority.
    if ! bash "$installer" </dev/null; then
        warn "strix CLI installer exited non-zero — skipping. The web dashboard is still live."
        return 0
    fi

    # Promote the binary to /usr/local/bin so every user (not just the one
    # running setup.sh) has it on PATH without sourcing a shell rc file.
    local cli_home="${HOME:-/root}/.strix/bin"
    local src="$cli_home/strix"
    if [[ -x "$src" ]]; then
        as_root ln -sf "$src" /usr/local/bin/strix
        ok "strix CLI installed → $(command -v strix || echo /usr/local/bin/strix)"
    else
        warn "strix binary missing at $src after install — check logs above."
    fi
}

# --- Step 6: summary ---------------------------------------------------------
print_summary() {
    if [[ "$DRY_RUN" == "1" ]]; then
        ok "Dry run complete. Re-run without --dry-run to apply the plan above."
        return 0
    fi
    local public_ip; public_ip="$(detect_public_ip)"
    echo
    ok "NovaHunter is live!"
    echo "    Dashboard : http://${public_ip}/"
    echo "    API       : http://${public_ip}/api/"
    echo "    Health    : http://${public_ip}/api/health"
    if command -v strix >/dev/null 2>&1; then
        echo "    CLI       : $(command -v strix) ($(strix --version 2>/dev/null || echo 'installed'))"
    fi
    local sandbox_image="${STRIX_IMAGE:-ghcr.io/maramharsha/novahunter-sandbox:latest}"
    if $SUDO docker image inspect "$sandbox_image" >/dev/null 2>&1; then
        echo "    Sandbox   : ${sandbox_image} (ready — used by agents from web & CLI)"
    fi
    echo
    echo "  What's included in this build:"
    echo "    - LLM role router:   admin /admin/llm — separate model per"
    echo "                           role (planner/executor/reasoner/reporter/"
    echo "                           vision/memory/dedupe) + per-run overrides."
    echo "    - Encrypted secrets: admin /admin/llm secrets section — keys"
    echo "                           live in strix_secrets, unlocked by"
    echo "                           STRIX_MASTER_KEY from deploy/.env."
    echo "    - Server-side report exports (PDF/MD/HTML/TXT/JSON/SARIF/CSV)"
    echo "      via GET /api/runs/{id}/report.{fmt}."
    echo "    - HackerOne/Bugcrowd/OpenBugBounty-aligned report templates"
    echo "      under docs/report-templates/ + FindingReport pydantic schema."
    echo "    - Multimodal view_image tool + dangerous-command guardrail"
    echo "      + per-turn iteration cap."
    echo
    echo "  Next steps:"
    echo "    1. Open http://${public_ip}/admin in a browser."
    echo "    2. /admin/llm: pick a provider and add a key (global fallback)."
    echo "    3. Optional: /admin/llm → set per-role models (a cheaper"
    echo "       executor model alone usually cuts token spend by >50%)."
    echo "    4. /runs/new: launch a scan. Expand \"LLM overrides\" if you"
    echo "       want to pin specific models for this run."
    echo "    5. (Optional) point a DNS record at this host, then edit"
    echo "       ${INSTALL_DIR}/deploy/Caddyfile to enable HTTPS."
    echo
    echo "  Operating commands:"
    echo "    docker compose -f ${INSTALL_DIR}/deploy/docker-compose.yml ps"
    echo "    docker compose -f ${INSTALL_DIR}/deploy/docker-compose.yml logs -f"
    echo "    sudo bash ${INSTALL_DIR}/scripts/setup.sh --dry-run  # preview next redeploy"
    echo "    sudo bash ${INSTALL_DIR}/scripts/setup.sh            # apply redeploy"
    if command -v strix >/dev/null 2>&1; then
        echo "    strix --target https://example.com              # run a scan from the CLI"
    fi
    echo
}

main() {
    log "NovaHunter installer starting ..."
    preflight_summary
    preflight_ports
    install_prereqs
    backup_state
    write_env
    prepull_sandbox
    compose_up
    wait_for_health || true
    install_cli
    print_summary
}

main "$@"
