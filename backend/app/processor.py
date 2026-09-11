from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any
import math
import re

import pandas as pd

LOCATION_RE = re.compile(r"^([A-Za-z0-9]{2})-(\d{2})-(\d{3})-(\d+)$")

REQUIRED_MASTER = ["Ubicación", "Tipo almacén"]
REQUIRED_OCC = ["Tipo almacén", "Ubicación", "Producto", "Fecha EM"]


def _json_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    try:
        return value.item()
    except Exception:
        return value


def _x(value: Any) -> bool:
    return False if pd.isna(value) else str(value).strip().upper() == "X"


def _clean_header(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()


def _find_data_sheet_and_header(path: Path, required: list[str]) -> tuple[str | int, int]:
    """Detecta automáticamente la hoja y la fila real de encabezados.

    Soporta tanto:
      1) Exportes directos EWM con encabezados en la primera fila.
      2) Plantillas V5 con hoja "Datos", título/descripcion y encabezados en fila 4.
    """
    excel = pd.ExcelFile(path, engine="openpyxl")
    # Priorizamos una hoja llamada Datos; luego revisamos las demás.
    sheet_order = sorted(excel.sheet_names, key=lambda s: (str(s).strip().lower() != "datos", excel.sheet_names.index(s)))
    required_set = set(required)

    for sheet in sheet_order:
        preview = pd.read_excel(
            path,
            sheet_name=sheet,
            header=None,
            nrows=20,
            engine="openpyxl",
            dtype=object,
        )
        for row_idx in range(len(preview)):
            values = {_clean_header(v) for v in preview.iloc[row_idx].tolist()}
            if required_set.issubset(values):
                return sheet, row_idx

    raise ValueError(
        "No se encontró una hoja con los encabezados requeridos: " + ", ".join(required)
    )


def _read_xlsx(path: Path, required: list[str]) -> pd.DataFrame:
    sheet, header_row = _find_data_sheet_and_header(path, required)
    df = pd.read_excel(path, sheet_name=sheet, header=header_row, engine="openpyxl")
    # Evita cabeceras con espacios accidentales sin alterar tildes/terminología EWM.
    df.columns = [str(c).strip() for c in df.columns]
    # Elimina filas completamente vacías que puedan existir al final de plantillas editadas.
    df = df.dropna(how="all").reset_index(drop=True)
    return df


def validate_columns(df: pd.DataFrame, required: list[str], label: str) -> None:
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"{label}: faltan columnas obligatorias: {', '.join(missing)}")


def build_snapshot(master_path: Path, occupancy_path: Path, *, data_date: date | None = None) -> dict[str, Any]:
    master = _read_xlsx(master_path, REQUIRED_MASTER)
    occupancy = _read_xlsx(occupancy_path, REQUIRED_OCC)
    validate_columns(master, REQUIRED_MASTER, "Maestro")
    validate_columns(occupancy, REQUIRED_OCC, "Ocupación")

    # El maestro debe ser único por código. Conservamos la primera fila y reportamos duplicados.
    master["Ubicación"] = master["Ubicación"].astype(str).str.strip()
    occupancy["Ubicación"] = occupancy["Ubicación"].astype(str).str.strip()
    duplicate_master = int(master.duplicated(subset=["Ubicación"], keep="first").sum())
    master = master.drop_duplicates(subset=["Ubicación"], keep="first")

    master_codes = set(master["Ubicación"])
    unknown_locations = sorted(set(occupancy["Ubicación"]) - master_codes)
    occupancy = occupancy[occupancy["Ubicación"].isin(master_codes)].copy()

    # Duplicado operativo: misma ubicación + HU + producto + lote. No confundimos múltiples HUs válidas con duplicidad.
    dup_cols = [c for c in ["Ubicación", "Unidad manipulación", "Producto", "Lote"] if c in occupancy.columns]
    duplicate_occ = int(occupancy.duplicated(subset=dup_cols, keep="first").sum()) if dup_cols else 0
    if dup_cols:
        occupancy = occupancy.drop_duplicates(subset=dup_cols, keep="first")

    groups: dict[str, list[dict[str, Any]]] = {}
    for _, row in occupancy.iterrows():
        code = str(row.get("Ubicación", "")).strip()
        item = {
            "product": _json_value(row.get("Producto")),
            "description": _json_value(row.get("Descripción de producto")),
            "lot": _json_value(row.get("Lote")),
            "expiryDate": _json_value(pd.to_datetime(row.get("FeCaduc/FePreferCons"), errors="coerce")),
            "stockType": _json_value(row.get("Tipo de stocks")),
            "packedQty": _json_value(row.get("Ctd.embalada (UMA)")),
            "altUnit": _json_value(row.get("Un.medida alternat.")),
            "handlingUnit": _json_value(row.get("Unidad manipulación")),
            "quantity": _json_value(row.get("Ctd.")),
            "entryDate": _json_value(pd.to_datetime(row.get("Fecha EM"), errors="coerce")),
            "entryTime": _json_value(row.get("Hora EM")),
            "weight": _json_value(row.get("Peso de carga")),
        }
        groups.setdefault(code, []).append(item)

    now = pd.Timestamp(data_date or date.today())
    locations: list[dict[str, Any]] = []
    invalid_location_codes: list[str] = []

    for _, row in master.iterrows():
        code = str(row.get("Ubicación", "")).strip()
        parsed = LOCATION_RE.match(code)
        if parsed:
            prefix, aisle_s, position_s, level_s = parsed.groups()
            aisle, position, level = int(aisle_s), int(position_s), int(level_s)
        else:
            invalid_location_codes.append(code)
            prefix = code[:2] if len(code) >= 2 else "??"
            aisle = int(row.get("Pasillo")) if pd.notna(row.get("Pasillo")) else 0
            position = int(row.get("Col.")) if pd.notna(row.get("Col.")) else 0
            level = int(row.get("Nivel")) if pd.notna(row.get("Nivel")) else 1

        module = math.ceil(position / 2) if position else 0
        side = "IZQUIERDA" if position % 2 == 1 else "DERECHA"

        # V5: no hay desplazamiento por prefijo (AA/PA/ET/etc.).
        # La posición física depende de pasillo, posición y nivel.
        x = (module - 1) * 2.10 if module else 0.0
        y = (level - 1) * 1.55
        aisle_center = (aisle - 1) * 6.0 if aisle else 0.0
        z = aisle_center + (-1.90 if side == "IZQUIERDA" else 1.90)

        blocked_in = _x(row.get("Bloq.entrada stock"))
        blocked_out = _x(row.get("Bloq.salida stock"))
        blocked = blocked_in or blocked_out
        user_status = str(row.get("Status de usuario") or "").strip().upper()
        unavailable = user_status in {"NO DISPONIBLE", "INACTIVA", "INACTIVO"}
        stock = groups.get(code, [])

        if unavailable:
            status = "NO_DISPONIBLE"
        elif blocked:
            status = "BLOQUEADA"
        elif stock:
            status = "OCUPADA"
        else:
            status = "LIBRE"

        entry_dates: list[pd.Timestamp] = []
        expiry_dates: list[pd.Timestamp] = []
        quantity_total = 0.0
        weight_total = 0.0
        products: set[str] = set()
        lots: set[str] = set()
        stock_types: set[str] = set()
        descriptions: set[str] = set()

        for item in stock:
            if item["entryDate"]:
                try:
                    entry_dates.append(pd.Timestamp(item["entryDate"]))
                except Exception:
                    pass
            if item["expiryDate"]:
                try:
                    expiry_dates.append(pd.Timestamp(item["expiryDate"]))
                except Exception:
                    pass
            try:
                quantity_total += float(item["quantity"] or 0)
            except Exception:
                pass
            try:
                weight_total += float(item["weight"] or 0)
            except Exception:
                pass
            if item["product"]:
                products.add(str(item["product"]))
            if item["description"]:
                descriptions.add(str(item["description"]))
            if item["lot"]:
                lots.add(str(item["lot"]))
            if item["stockType"]:
                stock_types.add(str(item["stockType"]))

        oldest = min(entry_dates) if entry_dates else None
        age_days = int((now.normalize() - oldest.normalize()).days) if oldest is not None else None
        next_expiry = min(expiry_dates) if expiry_dates else None

        locations.append({
            "code": code,
            "prefix": prefix,
            "storageType": _json_value(row.get("Tipo almacén")),
            "storageArea": _json_value(row.get("Área almacenamiento")),
            "locationType": _json_value(row.get("Tipo de ubicación")),
            "aisle": aisle,
            "position": position,
            "module": module,
            "level": level,
            "side": side,
            "x": round(float(x), 3),
            "y": round(float(y), 3),
            "z": round(float(z), 3),
            "blockedIn": blocked_in,
            "blockedOut": blocked_out,
            "status": status,
            "stockCount": len(stock),
            "products": sorted(products),
            "descriptions": sorted(descriptions),
            "lots": sorted(lots),
            "stockTypes": sorted(stock_types),
            "quantityTotal": round(quantity_total, 3),
            "weightTotal": round(weight_total, 3),
            "oldestEntryDate": oldest.date().isoformat() if oldest is not None else None,
            "ageDays": age_days,
            "nextExpiryDate": next_expiry.date().isoformat() if next_expiry is not None else None,
            "stock": stock,
        })

    eligible = [x for x in locations if x["status"] not in {"BLOQUEADA", "NO_DISPONIBLE"}]
    occupied = [x for x in eligible if x["stockCount"] > 0]
    free = [x for x in eligible if x["stockCount"] == 0]
    blocked = [x for x in locations if x["status"] == "BLOQUEADA"]
    unavailable = [x for x in locations if x["status"] == "NO_DISPONIBLE"]

    storage_types = sorted({str(x["storageType"]) for x in locations if x["storageType"] is not None})
    areas = sorted({str(x["storageArea"]) for x in locations if x["storageArea"] is not None})
    aisles = sorted({int(x["aisle"]) for x in locations if x["aisle"]})
    levels = sorted({int(x["level"]) for x in locations if x["level"]})
    prefixes = sorted({str(x["prefix"]) for x in locations if x["prefix"]})
    stock_types = sorted({str(v) for x in locations for v in x["stockTypes"]})

    return {
        "metadata": {
            "generatedAt": datetime.now().isoformat(timespec="seconds"),
            "masterFile": master_path.name,
            "occupancyFile": occupancy_path.name,
            "demoAnonymized": "DEMO" in master_path.name.upper() or "DEMO" in occupancy_path.name.upper(),
        },
        "kpis": {
            "totalLocations": len(locations),
            "eligibleLocations": len(eligible),
            "occupiedLocations": len(occupied),
            "freeLocations": len(free),
            "blockedLocations": len(blocked),
            "unavailableLocations": len(unavailable),
            "occupancyPct": round((len(occupied) / len(eligible) * 100) if eligible else 0, 2),
            "stockRows": int(len(occupancy)),
            "uniqueProducts": int(occupancy["Producto"].nunique(dropna=True)),
        },
        "validation": {
            "masterRows": int(len(master)),
            "occupancyRows": int(len(occupancy)),
            "duplicateMasterCodes": duplicate_master,
            "duplicateOccupancyDetails": duplicate_occ,
            "unknownLocations": len(unknown_locations),
            "unknownLocationSamples": unknown_locations[:20],
            "invalidLocationCodes": len(invalid_location_codes),
            "invalidLocationCodeSamples": invalid_location_codes[:20],
        },
        "options": {
            "storageTypes": storage_types,
            "storageAreas": areas,
            "aisles": aisles,
            "levels": levels,
            "prefixes": prefixes,
            "stockTypes": stock_types,
        },
        "locations": locations,
    }

