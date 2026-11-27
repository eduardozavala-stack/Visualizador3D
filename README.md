# Visualizador3D
Permite visualizar en 3D las dimesnciones del almacen segun un maestro y el archivo actualizado de ocupación

## Escenarios de slotting

Abre **Escenarios de slotting** para fijar una referencia **AS IS** y ensayar zonas y movimientos en **TO BE**. La demo incluye un historial sintético y un movimiento de ejemplo. Los cambios de escenario duran mientras la aplicación permanezca abierta.

### Historial EWM

Importa un archivo XLSX con la hoja `Data`. El navegador procesa el archivo localmente. El límite es 24 MB de archivo, 140 MB de contenido descomprimido y 120.000 filas de datos por hoja. La tabla indica los encabezados requeridos.

| Identificación y etapa | Fechas y horas |
| --- | --- |
| `Orden de almacén`, `Cola`, `Producto` | `Fe.inicio`, `Hora inicio` |
| `Ubic.procedencia`, `Ubicación de destino`, `Cl.proceso almacén` | `Fecha confirmación`, `Hora de confirmación` |

Las columnas opcionales `Un.medida alternat.` y `Ctd.real dest.UMA` permiten detectar discrepancias entre las dos etapas. En entradas se enlazan la etapa P112 de canal y el destino de proceso 1015 o 3060. En salidas se enlazan el origen de rack y el canal CNL-OUT de proceso P284. La fecha del ciclo es la confirmación de la última etapa. Revisa **Calidad y exclusiones del historial** para confirmar la cobertura.

### Límites para una reubicación

Carga una tabla JSON local con dimensiones de la carga por SKU, dimensiones admitidas por ubicación en centímetros, peso máximo en kilogramos, capacidad en cargas y SKU compatibles. Este es un ejemplo sintético.

```json
{
  "products": [{ "sku": "DEMO-1", "dimensionsCm": [120, 100, 110] }],
  "locations": [{
    "code": "PA-04-007-2",
    "dimensionsCm": [140, 120, 150],
    "maxWeightKg": 1000,
    "maxLoads": 2,
    "allowedSkus": ["DEMO-1"]
  }]
}
```

El escenario traslada el stock del SKU en el origen seleccionado. Para el piloto, cada fila de stock cuenta como una carga y aporta su peso registrado. El escenario calcula la capacidad del destino de manera conservadora, con el stock que ya contiene y las entradas propuestas. Usa límites verificados antes de considerar factible una reubicación. Los resultados de TO BE son estimaciones sobre las órdenes comparables.

### Verificación

Ejecuta `node --test frontend/tests/slotting.test.mjs` desde la raíz con Node 22.18 o posterior. Desde `frontend/`, ejecuta `npm run typecheck` y `npm run build`. Para comprobar la ocupación, ejecuta `python tests_smoke.py` desde `backend/`.
