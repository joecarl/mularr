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

# Stage 3: Production Image
FROM node:24-trixie

WORKDIR /app

# Configurar Locales para soportar UTF-8 (tildes, ñ, etc)
RUN apt-get update && apt-get install -y --no-install-recommends locales \
    && echo "en_US.UTF-8 UTF-8" > /etc/locale.gen \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# Compile and install aMule from source (disabled: using apt install above)
# COPY build-amule.sh /tmp/build-amule.sh
# RUN chmod +x /tmp/build-amule.sh && /tmp/build-amule.sh && rm /tmp/build-amule.sh

# Install aMule from apt
RUN apt-get update && apt-get install -y --no-install-recommends \
    amule-daemon \
    amule-utils \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

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
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
