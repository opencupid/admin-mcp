FROM node:24-trixie-slim AS builder

WORKDIR /app
ENV CI=true
ENV PNPM_UPDATE_NOTIFIER=false

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:24-trixie-slim
LABEL org.opencontainers.image.source=https://github.com/opencupid/admin-mcp
LABEL org.opencontainers.image.description="Read-only MCP server for OpenCupid admin KPIs and moderation queue"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/index.js"]
