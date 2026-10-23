# Boni Calendar server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t boni-calendar-server .
# It runs TypeScript directly (Node 24) and reuses packages/calendar, the web app's vault loader and the
# desktop shell's vault access, so the server applies exactly the apps' rules. Data: /data (SQLite);
# the vault is mounted where the account says (see docs/servidor.md).
FROM node:24-alpine
RUN corepack enable && apk add --no-cache tini
WORKDIR /app
COPY . .
# Only what the server and the web build need (no Electron, no Playwright).
RUN pnpm install --frozen-lockfile --filter "@boni/server..." --filter "@boni/calendar-web..." --filter "@boni/boni-web..." \
  && pnpm --filter @boni/calendar-web build \
  && pnpm --filter @boni/boni-web build \
  && rm -rf /root/.cache /root/.local/share/pnpm
ENV NODE_ENV=production \
    BONI_DB=/data/boni-calendar.db \
    BONI_WEB=/app/apps/calendar-web/dist \
    BONI_BONI_WEB=/app/apps/boni-web/dist \
    BONI_HOST=0.0.0.0 \
    BONI_PORT=8787
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
# --expose-gc: a long export or copy frees what it already sent (releaseSent in @boni/export): the attachments it
# reads one at a time otherwise wait for V8 and add up (measured 2026-10-23: 288 MB peak for 400 MB, 185 MB freed).
CMD ["node", "--expose-gc", "--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"]
