from __future__ import annotations

from fastapi import HTTPException, UploadFile
from pathlib import Path
import os
import tempfile
import zipfile

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
MAX_ZIP_ENTRIES = int(os.getenv("MAX_ZIP_ENTRIES", "2500"))
MAX_UNCOMPRESSED_BYTES = int(os.getenv("MAX_UNCOMPRESSED_BYTES", str(250 * 1024 * 1024)))
MAX_COMPRESSION_RATIO = float(os.getenv("MAX_COMPRESSION_RATIO", "200"))


def validate_xlsx_zip(path: Path) -> None:
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_ZIP_ENTRIES:
                raise ValueError("demasiadas entradas")
            total_uncompressed = sum(i.file_size for i in infos)
            total_compressed = sum(max(i.compress_size, 1) for i in infos)
            if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("tamaño descomprimido excedido")
            if total_uncompressed / total_compressed > MAX_COMPRESSION_RATIO:
                raise ValueError("ratio de compresión anómalo")
            required = {"[Content_Types].xml", "xl/workbook.xml"}
            if not required.issubset(set(zf.namelist())):
                raise ValueError("estructura XLSX no válida")
    except (zipfile.BadZipFile, ValueError) as exc:
        raise HTTPException(status_code=400, detail="El archivo XLSX no es válido o no cumple los límites de seguridad.") from exc


async def save_upload_safely(upload: UploadFile) -> Path:
    filename = (upload.filename or "").strip()
    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Solo se permiten archivos .xlsx.")

    fd, raw_path = tempfile.mkstemp(prefix="ewm_", suffix=".xlsx")
    os.close(fd)
    path = Path(raw_path)
    total = 0
    try:
        with path.open("wb") as target:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="El archivo excede el tamaño máximo permitido.")
                target.write(chunk)
        validate_xlsx_zip(path)
        return path
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
