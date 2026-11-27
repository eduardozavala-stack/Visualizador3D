# Especificación de escenarios de slotting

## Purpose

Permitir evaluar cambios lógicos de distribución y reubicación de productos sobre el almacén existente usando la actividad y los tiempos de las órdenes EWM.

## ADDED Requirements

### Requirement: Referencia AS IS y escenario independiente

El módulo SHALL fijar una instantánea identificable del maestro y la ocupación como referencia AS IS de solo lectura y permitir crear y reiniciar un TO BE asociado a esa versión durante la sesión.

#### Scenario: Editar una zona de prueba
- **WHEN** el usuario cambia de clase de acceso un módulo en TO BE y vuelve a AS IS
- **THEN** AS IS presenta las ubicaciones, áreas EWM, ocupación y bloqueos originales.

#### Scenario: Actualizar la ocupación durante la prueba
- **WHEN** el visor principal recibe una instantánea nueva mientras hay un TO BE abierto
- **THEN** la comparación conserva el identificador y los datos de su referencia hasta que el usuario inicia otra comparación.

### Requirement: Historial EWM procesado localmente

El módulo SHALL procesar el XLSX EWM dentro de la sesión local del navegador y agrupar las etapas por orden de almacén y cola. El ejemplo de la demo SHALL usar datos sintéticos.

#### Scenario: Enlazar una entrada
- **WHEN** una orden y cola de entrada tienen una etapa de canal y una de destino en rack con el mismo SKU y una secuencia válida
- **THEN** el ciclo va del inicio del canal a la confirmación del rack y el tramo de rack se atribuye al destino.
- **AND** si la etapa de canal empieza y termina en el mismo segundo, se conserva el par si el ciclo total es positivo.

#### Scenario: Enlazar una salida
- **WHEN** una orden y cola de salida tienen una etapa con origen en rack y otra de canal de despacho con el mismo SKU y una secuencia válida
- **THEN** el ciclo va del inicio en rack a la confirmación del canal y el tramo de rack se atribuye al origen.

#### Scenario: Detectar órdenes fuera del análisis espacial
- **WHEN** falta una etapa, hay más de una combinación, los SKU difieren, la secuencia es inválida o la ubicación queda fuera del maestro
- **THEN** el módulo informa los conteos por motivo y conserva los indicadores espaciales sobre pares válidos y ubicables.

#### Scenario: Cargar un archivo real
- **WHEN** el usuario abre un XLSX válido o inválido en la vista de escenarios
- **THEN** ninguna fila, identificador de orden o producto ni el archivo original se envían al servidor, al registro de diagnóstico o al almacenamiento persistente del navegador.
- **AND** un archivo inválido genera un error visible y conserva el análisis previo.

### Requirement: Capas de calor con cobertura visible

El visor SHALL ofrecer capas de actividad, ciclo completo y tiempo en rack con filtros comunes de período, flujo, cola, pasillo y nivel. Las capas de tiempos SHALL mostrar mediana, P90 y tamaño de muestra con una leyenda común para cada comparación.

#### Scenario: Consultar una muestra escasa
- **WHEN** el usuario selecciona una ubicación sin muestra suficiente para la métrica elegida
- **THEN** el detalle muestra el tramo y nivel de referencia, con el número de observaciones, o el estado «Sin datos» si el tramo tampoco tiene evidencia suficiente.

#### Scenario: Cambiar de escenario
- **WHEN** el usuario alterna entre AS IS y TO BE
- **THEN** se mantienen filtros, vista de cámara y escala de colores.
- **AND** los tiempos observados y los estimados se identifican explícitamente.

### Requirement: Zonas A, B y C y reubicaciones compatibles

TO BE SHALL proponer clases de acceso A, B y C por ubicación según el tiempo típico de despacho y la capacidad para la demanda priorizada. El usuario SHALL poder ajustar las clases por ubicación, módulo y nivel y probar reubicaciones sujetas a restricciones operativas.

#### Scenario: Proponer una zona rápida con distinta profundidad por nivel
- **WHEN** una ubicación compatible del nivel 2 tiene menor tiempo de ciclo que una del nivel 1 más adentro
- **THEN** la clasificación puede priorizar la del nivel 2 y conserva el tipo y el área EWM de ambas ubicaciones.

#### Scenario: Ajustar una clase de acceso
- **WHEN** el usuario asigna la clase A a un conjunto de ubicaciones seleccionadas
- **THEN** TO BE actualiza la capacidad por clase y muestra el faltante para los productos priorizados cuando corresponda.

#### Scenario: Validar una reubicación
- **WHEN** un destino está bloqueado, excede su capacidad, es incompatible por tipo, peso o dimensiones, o carece de datos para verificar una restricción
- **THEN** la interfaz explica qué impide considerar factible el movimiento y lo excluye de la comparación de reubicaciones factibles.

### Requirement: Comparación de escenarios con demanda equivalente

El módulo SHALL comparar ambos escenarios sobre las mismas órdenes elegibles mediante un método de estimación común. SHALL mostrar mediana y P90 de despacho, tiempo de almacenamiento, cobertura de la muestra, capacidad por zona y cantidad de reubicaciones propuestas.

#### Scenario: Aplicar un movimiento simulado
- **WHEN** una reubicación factible modifica la asignación de órdenes a ubicaciones
- **THEN** la comparación usa la misma cohorte de órdenes con una estimación disponible en ambos escenarios y muestra su cobertura.
- **AND** distingue las diferencias estimadas de los indicadores históricos observados.

#### Scenario: Comparar una copia de AS IS
- **WHEN** TO BE conserva las mismas ubicaciones y asignaciones de AS IS
- **THEN** las diferencias estimadas de tiempos y capacidad son cero para la cohorte comparable.

#### Scenario: Editar solo el color de una zona
- **WHEN** el usuario reclasifica una zona sin cambiar la asignación de ninguna orden a una ubicación
- **THEN** la capacidad por clase puede cambiar y los indicadores de tiempo comparables conservan sus valores.
