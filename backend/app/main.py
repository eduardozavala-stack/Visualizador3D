from __future__ import annotations

import base64
import gzip
import json
import os
import secrets
import shutil
import tempfile
from pathlib import Path
from threading import RLock

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .processor import build_snapshot
from .security import save_upload_safely

BASE_DIR = Path(__file__).resolve().parents[1]
DEMO_DIR = Path(os.getenv("DEMO_DATA_DIR", BASE_DIR / "demo_data"))
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
SNAPSHOT_FILE = DEMO_DIR / "warehouse_snapshot.json.gz"
MASTER_FILE = DEMO_DIR / "Maestro_Ubicaciones_EWM_DEMO.xlsx"
OCCUPANCY_FILE = DEMO_DIR / "Ocupacion_Almacen_EWM_DEMO.xlsx"
ENABLE_UPLOADS = os.getenv("ENABLE_UPLOADS", "false").lower() == "true"
DEMO_USERNAME = os.getenv("DEMO_USERNAME", "").strip()
DEMO_PASSWORD = os.getenv("DEMO_PASSWORD", "").strip()

app = FastAPI(title="Visualizador 3D de Ocupación EWM", version="5.2-render-demo", docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1000)

_lock = RLock()
_snapshot: dict | None = None
_master_path: Path = MASTER_FILE
_occupancy_path: Path = OCCUPANCY_FILE


def _load_snapshot() -> dict:
    global _snapshot
    with _lock:
        if _snapshot is not None:
            return _snapshot
        if SNAPSHOT_FILE.exists():
            with gzip.open(SNAPSHOT_FILE, "rt", encoding="utf-8") as fh:
                _snapshot = json.load(fh)
        else:
            _snapshot = build_snapshot(_master_path, _occupancy_path)
        return _snapshot


def _authorized(request: Request) -> bool:
    if not DEMO_USERNAME or not DEMO_PASSWORD:
        return True
    header = request.headers.get("authorization", "")
    if not header.startswith("Basic "):
        return False
    try:
        decoded = base64.b64decode(header[6:]).decode("utf-8")
        username, password = decoded.split(":", 1)
    except Exception:
        return False
    return secrets.compare_digest(username, DEMO_USERNAME) and secrets.compare_digest(password, DEMO_PASSWORD)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # Health check público para Render. El resto puede quedar protegido con Basic Auth si se configuran credenciales.
    if request.url.path != "/api/health" and not _authorized(request):
        return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Visualizador 3D EWM"'})
    try:
        response = await call_next(request)
    except HTTPException:
        raise
    except Exception:
        # No filtrar stack traces o detalles de librerías al usuario.
        return JSONResponse(status_code=500, content={"detail": "Ocurrió un error interno al procesar la solicitud."})
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "5.2-render-demo"}


@app.get("/api/warehouse/status")
def warehouse_status():
    data = _load_snapshot()
    return {
        "ready": True,
        "demo": bool(data.get("metadata", {}).get("demoAnonymized")),
        "uploadsEnabled": ENABLE_UPLOADS,
        "metadata": data.get("metadata", {}),
        "kpis": data.get("kpis", {}),
    }


@app.get("/api/warehouse/latest")
def warehouse_latest():
    return _load_snapshot()


@app.post("/api/admin/upload/master")
async def upload_master(file: UploadFile = File(...)):
    global _master_path, _snapshot
    if not ENABLE_UPLOADS:
        raise HTTPException(status_code=403, detail="Las cargas están deshabilitadas en esta demo pública.")
    temp = await save_upload_safely(file)
    try:
        with _lock:
            staged = Path(tempfile.mkstemp(prefix="master_current_", suffix=".xlsx")[1])
            shutil.copy2(temp, staged)
            try:
                new_snapshot = build_snapshot(staged, _occupancy_path)
            except ValueError as exc:
                staged.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            _master_path = staged
            _snapshot = new_snapshot
        return {"ok": True, "kpis": new_snapshot["kpis"], "validation": new_snapshot["validation"]}
    finally:
        temp.unlink(missing_ok=True)


@app.post("/api/admin/upload/occupancy")
async def upload_occupancy(file: UploadFile = File(...)):
    global _occupancy_path, _snapshot
    if not ENABLE_UPLOADS:
        raise HTTPException(status_code=403, detail="Las cargas están deshabilitadas en esta demo pública.")
    temp = await save_upload_safely(file)
    try:
        with _lock:
            staged = Path(tempfile.mkstemp(prefix="occupancy_current_", suffix=".xlsx")[1])
            shutil.copy2(temp, staged)
            try:
                new_snapshot = build_snapshot(_master_path, staged)
            except ValueError as exc:
                staged.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            _occupancy_path = staged
            _snapshot = new_snapshot
        return {"ok": True, "kpis": new_snapshot["kpis"], "validation": new_snapshot["validation"]}
    finally:
        temp.unlink(missing_ok=True)


# Servir frontend compilado en el mismo servicio/hostname.
if FRONTEND_DIST.exists():
    assets = FRONTEND_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Endpoint no encontrado.")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

