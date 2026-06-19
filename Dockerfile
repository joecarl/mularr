# Stage 1: Build Frontend
FROM node:24-trixie AS frontend-builder

WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy source and build
COPY frontend/ ./
COPY app-manifest.json ../
RUN npm run build

# Stage 2: Build Backend
FROM node:24-trixie AS backend-builder

WORKDIR /app/backend

# Copy package files and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy source and build
COPY backend/ ./
COPY app-manifest.json ../
RUN npm run build

# Remove devDependencies from node_modules before copying to production image
RUN npm prune --omit=dev

# Stage 3: Production Image
FROM node:24-trixie-slim

WORKDIR /app

# Config Locales to support UTF-8 (tildes, ñ, etc)
RUN apt-get update && apt-get install -y --no-install-recommends locales \
    && echo "en_US.UTF-8 UTF-8" > /etc/locale.gen \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# Install tini; install aMule 3.0.0 via shared script
COPY install-amule-gh-release.sh /tmp/install-amule.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
	tini \
	procps \
	&& bash /tmp/install-amule.sh 3.0.0 \
	&& rm /tmp/install-amule.sh \
	&& rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules

# Copy backend build results
COPY --from=backend-builder /app/backend/dist ./backend/dist
# Copy app-manifest.json for runtime use
COPY app-manifest.json ./
# Copy frontend build results to the backend's public directory
COPY --from=frontend-builder /app/frontend/dist ./backend/public

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create data directory for SQLite
RUN mkdir -p /app/data && chown node:node /app/data

# Set environment
ENV PORT=8940
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/database.sqlite
ENV AMULE_CONFIG_DIR=/app/data/amule

USER node

EXPOSE 8940

# Start the application
# tini is used as PID 1 to properly reap zombie child processes (e.g. amuled after restart)
ENTRYPOINT ["/usr/bin/tini", "--", "./entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
