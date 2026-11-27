# Diseño

## Context

El frontend React carga una instantánea con `/api/warehouse/latest` y concentra filtros y selección en `App.tsx`. `WarehouseScene.tsx` dibuja ubicaciones mediante instancias de Three.js y colorea por estado. El backend FastAPI activa las cargas administrativas del maestro y la ocupación mediante una opción de despliegue. El procesador deduce la posición a partir del pasillo, módulo y nivel, con separaciones fijas para la escena.

El historial disponible tiene un registro de canal y otro de rack por orden y cola en los pares completos. El maestro actual describe ubicaciones y bloqueos, y la instantánea incorpora el stock. El proyecto no dispone de un plano medido ni de un catálogo completo de límites de carga y dimensiones.

## Goals / Non-Goals

**Goals**

- Reutilizar el visor 3D y preservar una referencia reproducible con cambios de escenario reversibles.
- Mostrar la procedencia de los tiempos, las exclusiones del historial y la cobertura de cada comparación.

**Non-Goals**

- Crear un optimizador global de asignación, intervenir la operación de EWM o generar rutas físicas y modificaciones de racks.
- Persistir historiales reales o compartir escenarios entre sesiones en esta primera versión.

## Decisions

1. **Instantánea fijada y cambios por ubicación.** Crear una vista React separada dentro de la aplicación y pasarle la instantánea cargada por el flujo actual, con una copia estable y un identificador derivado de la instantánea. Guardar en memoria de sesión las clases por código y las reubicaciones como cambios sobre esa referencia. Reusar una escena con modos AS IS y TO BE y conservar cámara, selección compatible y filtros. Una escena compartida evita mantener dos renderizados de todos los racks. La ocupación mantiene su color actual al volver a su vista.

2. **Carga local y datos sintéticos.** Leer la hoja `Data` en un worker del navegador con un lector XLSX mantenido. Verificar tipo, tamaño, columnas y límites de expansión y filas antes de incorporar datos. Terminar el worker al cancelar, reemplazar el archivo o cerrar el módulo. Validar encabezados y fechas sin convertir las horas locales del Excel a UTC. Usar un ejemplo sintético incluido en el proyecto para la demo. Reutilizar las cargas del backend implicaría mover el historial al servidor y aplicar una vida útil distinta a la requerida.

3. **Emparejamiento explícito.** Agrupar por orden y cola y asignar las etapas mediante clase de proceso y códigos de canal, origen o destino. Para entradas, identificar P112 de canal y 1015/3060 de destino. Para salidas, distinguir la fila P284 con origen en rack de la fila con destino CNL-OUT. Aceptar un par con el mismo SKU, una sola fila por etapa, intervalos individuales válidos, fin de la primera etapa anterior o igual al inicio de la segunda, y ciclo positivo. Registrar discrepancias de unidad y cantidad como indicadores de calidad. Mantener el conteo de pares fuera del maestro y de filas o grupos excluidos, con motivos.

4. **Mapa y clasificación independientes.** Agregar actividad y tiempos por flujo, cola, ubicación y fecha de confirmación. Para tiempos, comenzar con un mínimo de 10 observaciones por ubicación y usar un tramo del mismo pasillo, nivel, tipo y área EWM como respaldo cuando alcanza la misma cobertura. Usar tramos de 10 módulos para el piloto y dejar el valor como parámetro de análisis, sin convertir las distancias de la escena en metros transitados. La actividad usa conteos directos. El color de la zona de slotting representa la clase A/B/C y se consulta por separado del color de calor. Los estados sin datos, bloqueado y excluido tienen texto en la leyenda y el detalle.

5. **Demanda y capacidad.** Priorizar SKU por frecuencia de órdenes de salida. Dimensionar A por las posiciones necesarias de los SKU priorizados y ordenar el resto por el costo de despacho para distribuir B y C. Pedir el tamaño del grupo prioritario y el límite de B como parámetros del escenario. Usar los datos de stock para estimar cuántas posiciones se deben trasladar y validar cada propuesta con la capacidad vigente y reglas de compatibilidad. Para el piloto, permitir aportar límites verificados de producto y ubicación mediante una tabla local. Marcar como pendiente de verificación cualquier movimiento con datos incompletos. Rechazar asignaciones acumuladas que excedan el espacio disponible o reutilicen el mismo stock. Los cambios de clase pueden evaluarse sin reubicar productos.

6. **Comparación por orden.** Aplicar los filtros al conjunto histórico de referencia y proyectar esas mismas órdenes con y sin los cambios, para evitar que un filtro espacial altere la demanda entre vistas. Estimar cada orden con el mismo método de medianas históricas por ubicación o tramo y cola. Los movimientos vinculan un SKU y un origen concretos a un destino, y las órdenes sin reubicación mantienen la asignación de referencia. Calcular P50 y P90 sobre los tiempos estimados por orden y mostrar la cobertura de la intersección de órdenes con estimaciones en ambas vistas. Esos percentiles describen el escenario estimado. Para evaluar la variabilidad de una ubicación, mostrar aparte el P90 observado. Mantener una comparación temporal de calibración y validación cuando el historial lo permita, e identificar el período utilizado. Comparar con el tiempo observado como referencia de control, y calcular el delta entre los dos escenarios con el mismo estimador.

## Risks / Trade-offs

- Pocas órdenes por ubicación → mostrar cobertura y origen de la estimación. Excluir de ambos lados las órdenes sin evidencia comparable.
- Tiempos EWM influidos por carga y maniobra → publicar los tiempos por etapa, mantener identificados los resultados estimados y probar el piloto por separado antes de aplicar movimientos reales.
- El maestro puede tener datos de capacidad incompletos → permitir la clasificación de zonas y dejar las reubicaciones afectadas pendientes de verificación.
- Exportaciones grandes → limitar recursos, mantener la interacción disponible durante el análisis y preservar la sesión anterior ante un error.

## Migration Plan

Publicar el módulo como una vista adicional con la demo sintética. Mantener el contrato actual de la API y las cargas de ocupación. El despliegue puede revertirse retirando la vista y sus recursos asociados, sin migraciones ni datos de escenarios que restaurar.
