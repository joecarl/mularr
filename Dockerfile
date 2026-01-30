# Stage 1: Build Frontend
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy source and build
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Backend
FROM node:24-alpine AS backend-builder

WORKDIR /app/backend

# Copy package files and install dependencies
COPY backend/package*.json ./
RUN npm install

# Copy source and build
COPY backend/ ./
RUN npm run build

# Stage 3: Production Image
FROM node:24-alpine

WORKDIR /app

# Install production dependencies for backend
# better-sqlite3 requires some build tools during install if no prebuilt binary is available for Alpine
RUN apk add --no-cache python3 make g++ bash

COPY install-amule.sh ./
RUN chmod +x install-amule.sh && ./install-amule.sh

COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy backend build results
COPY --from=backend-builder /app/backend/dist ./backend/dist
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

USER node

EXPOSE 8940

# Start the application
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "backend/dist/index.js"]
