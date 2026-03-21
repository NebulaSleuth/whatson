FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy api package
COPY packages/api/package.json packages/api/
COPY packages/api/src packages/api/src/
COPY packages/api/tsconfig.json packages/api/

# Install dependencies
RUN npm install --workspaces --include-workspace-root

# Build shared types
RUN cd packages/shared && npx tsc

# Build api
RUN cd packages/api && npx tsc

# ── Production image ──
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/api/dist packages/api/dist/

RUN npm install --workspaces --include-workspace-root --omit=dev

# Create data directory for tracked items
RUN mkdir -p /app/packages/api/data

WORKDIR /app/packages/api

EXPOSE 3001

ENV PORT=3001
ENV DATA_DIR=/app/packages/api/data

CMD ["node", "dist/index.js"]
