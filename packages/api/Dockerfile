FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy api package (admin/ is the /setup UI, served as static files)
COPY packages/api/package.json packages/api/
COPY packages/api/src packages/api/src/
COPY packages/api/tsconfig.json packages/api/
COPY packages/api/admin packages/api/admin/

# Copy the web app (served by the API at /)
COPY apps/web/package.json apps/web/
COPY apps/web/index.html apps/web/vite.config.ts apps/web/tsconfig.json apps/web/postcss.config.js apps/web/tailwind.config.js apps/web/
COPY apps/web/src apps/web/src/

# Install dependencies (only the workspaces copied above exist in the image)
RUN npm install --workspaces --include-workspace-root --legacy-peer-deps

# Build shared types
RUN cd packages/shared && npx tsc

# Build api
RUN cd packages/api && npx tsc

# Build web. vite only: the image installs just these three workspaces, so the
# root @types/react that apps/mobile normally brings is absent and react-router's
# types degrade, which fails `tsc --noEmit`. Type-checking is CI's job (it
# installs the full workspace); the image only needs the bundle.
RUN cd apps/web && npx vite build

# ── Production image ──
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/shared/package.json packages/shared/
COPY --from=builder /app/packages/shared/dist packages/shared/dist/
COPY --from=builder /app/packages/api/package.json packages/api/
COPY --from=builder /app/packages/api/dist packages/api/dist/
COPY --from=builder /app/packages/api/admin packages/api/admin/
# index.ts looks for the web build at <cwd>/web
COPY --from=builder /app/apps/web/dist packages/api/web/

RUN npm install --workspaces --include-workspace-root --omit=dev --legacy-peer-deps

# Create data directory for tracked items
RUN mkdir -p /app/packages/api/data

WORKDIR /app/packages/api

EXPOSE 3001

ENV PORT=3001
ENV DATA_DIR=/app/packages/api/data

CMD ["node", "dist/index.js"]
