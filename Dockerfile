# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Build tools needed to compile better-sqlite3 during npm ci
RUN apk add --no-cache python3 make g++

# Install all deps (devDeps needed for Vite + tsc builds)
COPY package*.json ./
RUN npm ci

# Copy source files
COPY . .

# Build the React frontend → dist-web/
RUN npm run build:web

# Compile the Express server + core → dist-web-server/
RUN npx tsc -p tsconfig.web.json


# ── Stage 2: Production runtime ──────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Build tools needed to compile better-sqlite3 for this platform
RUN apk add --no-cache python3 make g++

# Install only production dependencies (recompiles native modules for Linux)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist-web ./dist-web
COPY --from=builder /app/dist-web-server ./dist-web-server

# Data directory (override with FLUX_PROJECTS_DIR env var)
RUN mkdir -p /data/projects

EXPOSE 3001

ENV PORT=3001
ENV FLUX_PROJECTS_DIR=/data/projects

CMD ["node", "dist-web-server/web-server/server.js"]
