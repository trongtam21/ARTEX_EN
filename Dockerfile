# syntax=docker/dockerfile:1
#
# Multi-stage build: static frontend export → embedded static Go binary → runtime image.
# The original Docker Hub image source (autumn27/artex) is unavailable; this repository
# supports building entirely from source:
#   docker compose build        # or docker build -t artex:local .
# TARGETARCH is injected by buildx (amd64/arm64), so Go cross-compilation needs no QEMU.
# Only tools are installed in the runtime layer; compilation happens in build stages.
# Override module sources for restricted networks (the defaults are network-friendly):
#   --build-arg GOPROXY=https://goproxy.cn,direct
#   --build-arg NPM_REGISTRY=https://registry.npmmirror.com

########## Stage 1: static frontend export ##########
FROM node:20-bookworm AS web
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /web
# --ignore-scripts skips prepare (husky), which would fail because the container has no .git.
# Next.js/Biome platform binaries come from optionalDependencies and need no lifecycle scripts.
COPY web/package.json web/package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci --ignore-scripts
COPY web/ ./
RUN NEXT_EXPORT=1 npm run build:static

########## Stage 2: Go backend (embedded frontend, static build) ##########
FROM golang:1.26-bookworm AS gobuild
ARG TARGETARCH
ARG GOPROXY=https://goproxy.cn,https://proxy.golang.org,direct
WORKDIR /src
COPY go.mod go.sum ./
COPY norma/go.mod norma/go.sum ./norma/
RUN go mod download
COPY . .
# Copy static frontend output from the web stage (.dockerignore excludes the host dist directory).
COPY --from=web /web/out/ server/webui/dist/
RUN CGO_ENABLED=0 GOARCH="${TARGETARCH}" go build -tags embedui -trimpath -o /out/artex ./cmd/artex

########## Stage 3: runtime image (tools + preinstalled Playwright) ##########
FROM python:3.12-slim-bookworm
ARG NPM_REGISTRY=https://registry.npmmirror.com
# Use the same registry for global npm packages and Chromium downloads.
ENV npm_config_registry=$NPM_REGISTRY \
    PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
# Common tools: ripgrep / curl / vim plus a selection of recon utilities.
# Install Node 20.x from NodeSource: Bookworm's apt nodejs is 18, while Playwright requires >=20.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ripgrep curl wget vim git jq unzip \
      dnsutils iputils-ping netcat-openbsd inetutils-telnet whois nmap \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
# Install Playwright MCP and CLI globally so runtime does not download them with npx.
# @playwright/mcp provides the browser MCP; @playwright/cli provides playwright-cli.
# Install Playwright with --with-deps so Chromium and its system dependencies are ready
# when MCP/CLI starts in the container.
RUN npm install -g @playwright/mcp@latest @playwright/cli@latest playwright@latest \
    && playwright-cli --help \
    && playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Single binary produced by the build stages (with the frontend embedded)
COPY --from=gobuild /out/artex /app/artex
# Supervisor script: it restarts the process based on its exit code, allowing one-click page updates to apply.
# It also forwards SIGTERM to artex because docker stop signals only PID 1;
# without forwarding, artex cannot shut down gracefully and is force-killed after 10 seconds.
COPY start.sh /app/start.sh
RUN chmod +x /app/artex /app/start.sh
COPY skills/ /app/skills/
# Persistent data location (SQLite + jwt.key)
VOLUME ["/app/data"]
EXPOSE 8787 8788
ENTRYPOINT ["/app/start.sh"]
CMD ["-addr", ":8787", "-proxy", ":8788"]
