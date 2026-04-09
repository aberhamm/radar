# Multi-stage build for radar CI image
# Published to GHCR for use in GitHub Actions and other CI platforms

FROM node:20-slim AS build

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy dependency files first for layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
COPY config/ config/
RUN pnpm build

# Prune dev dependencies
RUN pnpm prune --prod

# ── Production stage ─────────────────────────────────────────────────

FROM node:20-slim AS production

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=build /app/dist/ dist/
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/config/ config/
COPY src/rules/ src/rules/
COPY src/references/ src/references/

# Ensure the binary is executable
RUN chmod +x dist/index.js

ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/index.js"]
CMD ["analyze"]
