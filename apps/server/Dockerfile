# Boni Calendar server. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t boni-calendar-server .
# It runs TypeScript directly (Node 24) and reuses packages/core, the web app's vault loader and the
# desktop shell's vault access, so the server applies exactly the apps' rules. Data: /data (SQLite);
# the vault is mounted where the account says (see docs/servidor.md).
FROM node:24-alpine
RUN corepack enable && apk add --no-cache tini
WORKDIR /app
COPY . .
# Only what the server and the web build need (no Electron, no Playwright).
RUN pnpm install --frozen-lockfile --filter "boni-calendar-server..." --filter "@boni-calendar/web..." \
  && pnpm --filter @boni-calendar/web build \
  && rm -rf /root/.cache /root/.local/share/pnpm
ENV NODE_ENV=production \
    BONI_DB=/data/boni-calendar.db \
    BONI_WEB=/app/apps/web/dist \
    BONI_HOST=0.0.0.0 \
    BONI_PORT=8787
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/main.ts"]
