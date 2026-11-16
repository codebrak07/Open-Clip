# ========================================================
# OpenClip AI — Unified Production Container (CPU Default)
# ========================================================

FROM python:3.11-slim AS base

# Install system dependencies (FFmpeg, git, build-essential, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python engine dependencies
COPY backend/python-engine/requirements.txt ./backend/python-engine/
RUN pip install --no-cache-dir -r ./backend/python-engine/requirements.txt

# Copy package manifests & install Node dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm install

# Copy application sources
COPY backend ./backend
COPY frontend ./frontend

# Install python-engine in editable mode
RUN pip install --no-cache-dir -e ./backend/python-engine

# Build TypeScript backend and Vite frontend
RUN npm run build:backend
RUN npm run build:frontend

EXPOSE 5001 5173

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

CMD ["npm", "run", "dev"]
