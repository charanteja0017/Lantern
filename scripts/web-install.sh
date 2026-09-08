#!/usr/bin/env bash
# Strix web dashboard — one-command installer for Linux VPS hosts.
#
# Usage:
#     curl -sSL https://raw.githubusercontent.com/usestrix/strix/main/scripts/web-install.sh | bash
#
# or:
#     curl -sSL https://strix.ai/web-install | bash
#
# Environment overrides (optional — otherwise the script prompts):
#     STRIX_DOMAIN=strix.example.com
#     STRIX_TLS_EMAIL=admin@example.com
#     STRIX_ADMIN_EMAILS=you@example.com,teammate@example.com
#     LLM_MODEL=openrouter/anthropic/claude-sonnet-4
#     LLM_API_KEY=sk-...
#     CLERK_ISSUER=...
#     CLERK_JWKS_URL=...
#     CLERK_AUDIENCE=...
#     NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
#     CLERK_SECRET_KEY=...
#     STRIX_BRANCH=main
#     STRIX_INSTALL_DIR=/opt/strix
#     NONINTERACTIVE=1

set -euo pipefail

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; CYAN=$'\033[0;36m'; NC=$'\033[0m'

log()   { printf "%s[strix]%s %s\n" "${CYAN}" "${NC}" "$*"; }
warn()  { printf "%s[strix]%s %s\n" "${YELLOW}" "${NC}" "$*"; }
die()   { printf "%s[strix]%s %s\n" "${RED}"   "${NC}" "$*" >&2; exit 1; }
ok()    { printf "%s[strix]%s %s\n" "${GREEN}" "${NC}" "$*"; }

REPO_URL="${REPO_URL:-https://github.com/usestrix/strix.git}"
BRANCH="${STRIX_BRANCH:-main}"
INSTALL_DIR="${STRIX_INSTALL_DIR:-/opt/strix}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"

need_sudo() {
    if [ "$(id -u)" -ne 0 ]; then
        if command -v sudo >/dev/null 2>&1; then echo sudo; else echo ""; fi
    fi
}
SUDO="$(need_sudo)"

ensure_prereqs() {
    log "Checking prerequisites..."
    for cmd in git curl; do
        command -v "$cmd" >/dev/null 2>&1 || die "Missing prerequisite: $cmd"
    done
    if ! command -v docker >/dev/null 2>&1; then
        warn "Docker not found — installing via get.docker.com"
        curl -fsSL https://get.docker.com | $SUDO sh
    fi
    if ! docker compose version >/dev/null 2>&1; then
        die "Docker Compose plugin not available. Install 'docker-compose-plugin'."
    fi
    ok "Prerequisites OK."
}

clone_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        log "Updating existing checkout at $INSTALL_DIR"
        $SUDO git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
        $SUDO git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
    else
        log "Cloning $REPO_URL → $INSTALL_DIR ($BRANCH)"
        $SUDO mkdir -p "$INSTALL_DIR"
        $SUDO git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
}

prompt_if_empty() {
    local var="$1"; local msg="$2"; local default="${3:-}"
    local cur="${!var:-}"
    if [ -n "$cur" ]; then return 0; fi
    if [ "$NONINTERACTIVE" = "1" ]; then
        printf -v "$var" "%s" "$default"
        return 0
    fi
    if [ -n "$default" ]; then
        read -r -p "$msg [$default]: " ans || true
        ans="${ans:-$default}"
    else
        read -r -p "$msg: " ans || true
    fi
    printf -v "$var" "%s" "$ans"
}

random_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
    else
        head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

write_env() {
    local env_file="$INSTALL_DIR/deploy/.env"
    if [ -f "$env_file" ]; then
        warn ".env already exists, leaving it in place"
        return 0
    fi

    prompt_if_empty STRIX_DOMAIN "Public hostname (DNS A-record pointing here)" "localhost"
    prompt_if_empty STRIX_TLS_EMAIL "Email for Let's Encrypt TLS cert" "admin@${STRIX_DOMAIN}"
    prompt_if_empty STRIX_ADMIN_EMAILS "Platform admin email(s), comma-separated" ""
    prompt_if_empty LLM_MODEL "LLM model id (e.g. openrouter/anthropic/claude-sonnet-4)" ""
    prompt_if_empty LLM_API_KEY "LLM API key" ""
    prompt_if_empty CLERK_ISSUER "Clerk issuer URL (blank to disable auth, dev only)" ""
    prompt_if_empty CLERK_JWKS_URL "Clerk JWKS URL" ""
    prompt_if_empty CLERK_AUDIENCE "Clerk audience" ""
    prompt_if_empty NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "Clerk publishable key" ""
    prompt_if_empty CLERK_SECRET_KEY "Clerk secret key" ""

    local pg_pw; pg_pw="$(random_secret)"

    $SUDO tee "$env_file" >/dev/null <<EOF
STRIX_DOMAIN=${STRIX_DOMAIN}
STRIX_TLS_EMAIL=${STRIX_TLS_EMAIL}
STRIX_ENV=production
STRIX_LOG_LEVEL=INFO
STRIX_ALLOWED_ORIGINS=https://${STRIX_DOMAIN}
STRIX_TRUSTED_HOSTS=${STRIX_DOMAIN}
POSTGRES_USER=strix
POSTGRES_PASSWORD=${pg_pw}
POSTGRES_DB=strix
CLERK_ISSUER=${CLERK_ISSUER}
CLERK_AUDIENCE=${CLERK_AUDIENCE}
CLERK_JWKS_URL=${CLERK_JWKS_URL}
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
STRIX_ADMIN_EMAILS=${STRIX_ADMIN_EMAILS}
STRIX_LLM_RPM_DEFAULT=50
STRIX_LLM_TPM_DEFAULT=30000
STRIX_LLM_CONCURRENCY_DEFAULT=4
STRIX_CHECKPOINT_INTERVAL=15
LLM_MODEL=${LLM_MODEL}
LLM_API_KEY=${LLM_API_KEY}
NEXT_PUBLIC_APP_NAME=Strix
NEXT_PUBLIC_API_BASE_URL=/api
EOF
    $SUDO chmod 600 "$env_file"
    ok "Wrote $env_file (Postgres password auto-generated)."
}

compose_up() {
    log "Building and starting the stack (this may take a few minutes)..."
    (cd "$INSTALL_DIR/deploy" && $SUDO docker compose --env-file .env up -d --build)
    ok "Stack started."
}

wait_for_health() {
    log "Waiting for services to report healthy..."
    local deadline=$((SECONDS + 600))
    while [ $SECONDS -lt $deadline ]; do
        local unhealthy
        unhealthy="$($SUDO docker compose --project-directory "$INSTALL_DIR/deploy" \
            --env-file "$INSTALL_DIR/deploy/.env" ps --format '{{.Service}} {{.Health}}' \
            | awk '$2 != "healthy" && $2 != ""' || true)"
        if [ -z "$unhealthy" ]; then
            ok "All services healthy."
            return 0
        fi
        sleep 5
    done
    die "Timed out waiting for services to become healthy. Run 'docker compose logs' for details."
}

print_summary() {
    local domain
    domain="$(grep -E '^STRIX_DOMAIN=' "$INSTALL_DIR/deploy/.env" | cut -d= -f2-)"
    echo
    ok "Strix web dashboard is live:"
    echo "    https://${domain}"
    echo
    echo "  Management commands:"
    echo "    docker compose --project-directory $INSTALL_DIR/deploy logs -f"
    echo "    docker compose --project-directory $INSTALL_DIR/deploy restart api"
    echo "    docker compose --project-directory $INSTALL_DIR/deploy down"
    echo
}

main() {
    ensure_prereqs
    clone_repo
    write_env
    compose_up
    wait_for_health
    print_summary
}

main "$@"
