# Multi-stage build for Shorts Story Generator
# Uses linuxserver/ffmpeg as base for FFmpeg support

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Prune dev dependencies
RUN npm prune --production


# Stage 2: Production
FROM linuxserver/ffmpeg:latest

# Install Node.js 20
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public

# Create storage directories
RUN mkdir -p /app/storage/tmp \
    /app/storage/videos \
    /app/storage/subtitles \
    /app/storage/images \
    /app/storage/audio

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/dev.db
ENV VIDEO_TMP_DIR=/app/storage/tmp
ENV VIDEO_OUTPUT_DIR=/app/storage/videos
ENV SRT_OUTPUT_DIR=/app/storage/subtitles
ENV IMAGE_OUTPUT_DIR=/app/storage/images
ENV AUDIO_OUTPUT_DIR=/app/storage/audio
ENV PORT=3000

# Create data directory for SQLite
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api || exit 1

# Start command - run migrations then start app
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
