# Stage 1: Build Frontend
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy source and build
COPY frontend/ ./
COPY app-manifest.json ../
RUN npm run build

# Stage 2: Build Backend
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

# Copy package files and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy source and build
COPY backend/ ./
COPY app-manifest.json ../
RUN npm run build

# Stage 3: Production Image
FROM node:24-alpine

WORKDIR /app

# Install production dependencies for backend
# better-sqlite3 requires some build tools during install if no prebuilt binary is available for Alpine
RUN apk add --no-cache python3 make g++ bash amule --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing

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
