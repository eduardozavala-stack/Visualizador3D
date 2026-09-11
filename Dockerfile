# ---------- Frontend build ----------
FROM node:22-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- Python runtime ----------
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000 \
    FRONTEND_DIST=/app/frontend/dist \
    DEMO_DATA_DIR=/app/backend/demo_data \
    ENABLE_UPLOADS=false

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY --from=frontend-builder /frontend/dist /app/frontend/dist

EXPOSE 10000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
