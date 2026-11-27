# Propuesta

## Why

Visualizador3D muestra la distribución y la ocupación, pero el equipo necesita comparar las ubicaciones actuales con alternativas de slotting antes de mover productos. Los ciclos EWM enlazados por orden de almacén y cola permiten usar tiempos observados como punto de partida.

## What Changes

- Agregar la vista **Escenarios de slotting**, con una referencia AS IS de solo lectura y un escenario TO BE editable sobre los racks existentes.
- Incorporar capas de actividad, ciclo completo y tiempo en rack para almacenamiento y despacho, con filtros compartidos y cobertura visible.
- Proponer zonas A, B y C por tiempo de acceso y capacidad necesaria. Permitir ajustar su composición por ubicación, módulo y nivel, y ensayar reubicaciones compatibles.
- Comparar escenarios sobre la misma demanda histórica mediante estimaciones, junto con capacidad por zona y cantidad de reubicaciones.
- Limitar esta versión a cambios lógicos en los racks existentes. El redimensionamiento físico y la ejecución de cambios en EWM quedan fuera del alcance.

## Capabilities

### New Capabilities

- `slotting-scenarios` — Comparación de distribuciones, mapas de calor EWM y simulación de zonas y reubicaciones.

### Modified Capabilities

## Impact

- Interfaz React y escena 3D existentes. La vista de ocupación conserva su flujo actual.
- Uso de la instantánea de almacén disponible y carga local de un historial EWM para el análisis durante la sesión.
- Pruebas con archivos sintéticos. La demo pública ofrece el escenario de ejemplo con datos sintéticos.
