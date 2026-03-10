FROM node:22-bookworm-slim AS nodebase
FROM docker:28-cli AS dockercli

FROM elixir:1.19.1-otp-28-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=nodebase /usr/local/ /usr/local/

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
ARG CODEX_CLI_VERSION=0.112.0
ENV PORT=3000
ENV OVERTURE_BIND_HOST=0.0.0.0
ENV OVERTURE_ROOT=/app
ENV CODEX_HOME=/app/.overture/codex-home
ENV OVERTURE_MIX_BIN=/usr/local/bin/mix
ENV OVERTURE_SYMPHONY_BIN=/app/vendor/symphony/elixir/bin/symphony
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git curl \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --gid 1000 node \
  && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash node
RUN npm install -g @openai/codex@${CODEX_CLI_VERSION} \
  && codex --version
COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/docker-compose.yml ./docker-compose.yml
COPY --from=builder /app/deploy.sh ./deploy.sh
COPY --from=builder /app/.env.example ./.env.example
COPY --from=builder /app/README.md ./README.md
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/infra ./infra
COPY --from=builder /app/plan.md ./plan.md
COPY --from=builder /app/src ./src
COPY --from=builder /app/vendor ./vendor
COPY --from=builder /app/playwright.config.ts ./playwright.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/vitest.config.ts ./vitest.config.ts
RUN rm -rf /app/vendor/symphony/elixir/_build /app/vendor/symphony/elixir/deps \
  && rm -f /app/vendor/symphony/elixir/bin/symphony \
  && cd /app/vendor/symphony/elixir \
  && mix local.hex --force \
  && mix local.rebar --force \
  && HEX_HTTP_CONCURRENCY=1 HEX_HTTP_TIMEOUT=120 mix setup \
  && mix build
RUN mkdir -p /app/.overture && chown -R node:node /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
EXPOSE 3000
USER node
CMD ["sh", "scripts/docker/start-overture.sh"]
