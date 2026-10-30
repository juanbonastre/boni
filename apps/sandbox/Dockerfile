# The box where an extension's functions run (docs/extensiones.md §11.6, E1). Build from the repository root:
#   docker build -f apps/sandbox/Dockerfile -t boni-sandbox .
# It runs TypeScript directly (Node 24). Run it with no network, a read-only root, no capabilities and its memory
# bounded; its only volume is the folder of its socket, shared with Boni's server (both run as `node`, uid 1000).
FROM node:24-alpine
RUN corepack enable && apk add --no-cache tini
WORKDIR /app
COPY . .
# Only the box and what it needs (QuickJS in WebAssembly): no server, no web, no development tools.
RUN pnpm install --frozen-lockfile --prod --filter "@boni/sandbox-runner..." \
  && rm -rf /root/.cache /root/.local/share/pnpm
ENV NODE_ENV=production \
    BONI_SANDBOX_SOCKET=/run/boni-sandbox/sandbox.sock
RUN mkdir -p /run/boni-sandbox && chown node:node /run/boni-sandbox
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/sandbox/src/main.ts"]
