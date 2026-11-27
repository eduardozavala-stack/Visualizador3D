# Tareas

## 1. Referencia y navegación

- [x] 1.1 Incorporar la vista Escenarios de slotting y reutilizar la escena con AS IS y TO BE. Verificar que la vista de ocupación sigue accesible y que ambos modos conservan filtros y cámara.
- [x] 1.2 Fijar la instantánea al crear el escenario y aplicar los cambios TO BE sobre ella. Probar que editar o reiniciar el escenario y recargar la ocupación principal conserva la referencia hasta iniciar una comparación nueva.

## 2. Historial EWM

- [x] 2.1 Añadir lectura local de XLSX en un worker, validación de estructura y límites, y cancelación. Verificar con archivos sintéticos válidos e inválidos que el archivo previo se conserva ante un error y que las filas no salen por solicitudes de red ni se persisten.
- [x] 2.2 Enlazar etapas por orden y cola, validar SKU, dirección y cronología, y calcular tiempos de canal, rack, intervalo y ciclo. Probar entradas RF de 0 s, salidas, cruces de fecha, discrepancias, combinaciones ambiguas y ubicaciones fuera del maestro.
- [x] 2.3 Mostrar cobertura, conteos de exclusiones y período del historial. Documentar las columnas requeridas y verificar que la demo inicia con un ejemplo sintético.

## 3. Mapas de calor

- [x] 3.1 Agregar vistas de actividad, ciclo completo y tiempo en rack con filtros compartidos. Probar agrupación por fecha de confirmación, flujo, cola, pasillo, módulo y nivel.
- [x] 3.2 Mostrar escala común, mediana, P90, tamaño de muestra y procedencia del dato al seleccionar una ubicación. Probar muestra directa, respaldo por tramo y estado «Sin datos». Verificar que la escena mantiene su estado al cambiar de modo.

## 4. Zonas de prueba y validación

- [x] 4.1 Implementar la clasificación inicial de ubicaciones por tiempo de despacho y capacidad necesaria para los SKU priorizados. Verificar con un caso sintético inspirado en PA-04 que un módulo cercano del nivel 2 puede tener prioridad y que cambiar clases no altera las áreas EWM.
- [x] 4.2 Añadir edición de clases por ubicación, módulo y nivel. Verificar que las ediciones actualizan el conteo de capacidad y el faltante sin cambiar la asignación de stock.
- [x] 4.3 Permitir ensayar movimientos y validar bloqueos, compatibilidad, peso, dimensiones y capacidad acumulada. Documentar la tabla local de límites con un ejemplo sintético y probar destinos faltantes, incompatibles y excedidos, y stock asignado dos veces.

## 5. Comparación y verificación integral

- [x] 5.1 Aplicar el mismo estimador a las mismas órdenes en AS IS y TO BE. Verificar diferencia cero en un escenario idéntico, cobertura común con datos incompletos y conservación de los tiempos al cambiar únicamente clases.
- [x] 5.2 Mostrar indicadores observados y estimados, diferencias de mediana y P90 de despacho, tiempo de almacenamiento, capacidad y reubicaciones. Verificar con un movimiento de prueba que los cambios se reflejan y que la cobertura acompaña los resultados.
- [x] 5.3 Recorrer el flujo completo con la demo sintética, ejecutar typecheck y build del frontend, y ejecutar la prueba de humo del backend para verificar el flujo actual de ocupación.
