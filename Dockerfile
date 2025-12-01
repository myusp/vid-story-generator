# Shorts Story Generator with Bun
FROM oven/bun:latest

# Install FFmpeg and minimal dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
COPY prisma ./prisma/

# Install dependencies
RUN bun install --frozen-lockfile

# Generate Prisma client
RUN bunx prisma generate

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Create storage directories
RUN mkdir -p /app/storage/tmp \
    /app/storage/videos \
    /app/storage/subtitles \
    /app/storage/images \
    /app/storage/audio \
    /app/data

# Set environment variables
ENV NODE_ENV=production \
    DATABASE_URL=file:/app/data/dev.db \
    VIDEO_TMP_DIR=/app/storage/tmp \
    VIDEO_OUTPUT_DIR=/app/storage/videos \
    SRT_OUTPUT_DIR=/app/storage/subtitles \
    IMAGE_OUTPUT_DIR=/app/storage/images \
    AUDIO_OUTPUT_DIR=/app/storage/audio \
    PORT=3000 \
    PATH="/usr/bin:${PATH}" \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api || exit 1

# Start command - run migrations then start app
CMD ["sh", "-c", "bunx prisma migrate deploy && bun run dist/main.js"]
