from pathlib import Path
from app.processor import build_snapshot

base = Path(__file__).resolve().parent
snap = build_snapshot(base/'demo_data'/'Maestro_Ubicaciones_EWM_DEMO.xlsx', base/'demo_data'/'Ocupacion_Almacen_EWM_DEMO.xlsx')
assert snap['kpis']['totalLocations'] == 17180
assert snap['kpis']['occupiedLocations'] == 10915
assert snap['kpis']['blockedLocations'] == 4716
assert snap['options']['aisles'][0] == 1
assert snap['options']['aisles'][-1] == 23
print('OK', snap['kpis'])
