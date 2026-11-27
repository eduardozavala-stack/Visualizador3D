import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import WarehouseScene from '../components/WarehouseScene'
import type { Snapshot, WarehouseLocation } from '../types'
import type { Flow, History } from './history'
import {
  classifyZones, countActivity, demoHistory, filterCycles, heatmap, historicalPeriods, isEligible, matchesLocation,
  parseLimits, prioritizedDemand, replay, summarize, validateMove, zoneCapacity,
} from './scenario'
import type { CompatibilityLimits, Filters, Layer, Move, Sample, Zone } from './scenario'
import './slotting.css'

const CAMERAS = ['ISO', 'TOP', 'FRONT', 'SIDE'] as const
const LAYERS: Record<Layer, string> = { activity: 'Actividad', cycle: 'Ciclo completo', rack: 'Tiempo en rack', zones: 'Zonas A/B/C' }
const ZONE_COLORS = { A: '#0f8a72', B: '#d18a16', C: '#7848aa' }
const HEAT_COLORS = ['#a6dcff', '#54b9e3', '#267cae', '#3a5197', '#783c89']
const number = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 })
const seconds = (value: number | undefined) => value === undefined ? '—' : `${number.format(value)} s`

export default function SlottingView({ snapshot, active }: { snapshot: Snapshot; active: boolean }) {
  const [reference, setReference] = useState(() => snapshot)
  const locations = useMemo(() => new Map(reference.locations.map(location => [location.code, location])), [reference])
  const demo = useMemo(() => demoHistory(reference.metadata.demoAnonymized ? reference.locations : []), [reference])
  const [customHistory, setCustomHistory] = useState<History | null>(null)
  const history = customHistory ?? demo.history
  const periods = useMemo(() => historicalPeriods(history.cycles), [history])
  const [mode, setMode] = useState<'AS IS' | 'TO BE'>('AS IS')
  const [camera, setCamera] = useState<(typeof CAMERAS)[number]>('ISO')
  const [layer, setLayer] = useState<Layer>('cycle')
  const [estimateView, setEstimateView] = useState(false)
  const [selection, setSelection] = useState('')
  const [lookup, setLookup] = useState('')
  const [filters, setFilters] = useState<Filters>({ flow: 'Salida', queue: '', from: '', to: '', aisle: '', level: '', module: '' })
  const [span, setSpan] = useState(10)
  const [top, setTop] = useState(10)
  const [middle, setMiddle] = useState(30)
  const [zones, setZones] = useState(new Map<string, Zone>())
  const [zone, setZone] = useState<Zone>('A')
  const [scope, setScope] = useState<'location' | 'module' | 'level'>('location')
  const [moves, setMoves] = useState<Move[]>([])
  const [limits, setLimits] = useState<CompatibilityLimits | null>(null)
  const [move, setMove] = useState<Move>({ sku: '', from: '', to: '' })
  const [error, setError] = useState('')
  const [moveNotice, setMoveNotice] = useState('')
  const [reading, setReading] = useState(false)
  const [limitsBusy, setLimitsBusy] = useState(false)
  const [demoLimitsActive, setDemoLimitsActive] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const limitsToken = useRef(0)

  const cancelImport = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setReading(false)
  }, [])
  useEffect(() => {
    if (!active) {
      cancelImport()
      limitsToken.current++
      setLimitsBusy(false)
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null }
  }, [active, cancelImport])

  const importHistory = (file: File) => {
    cancelImport()
    setError('')
    setReading(true)
    let worker: Worker
    try {
      worker = new Worker(new URL('./history.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      setReading(false)
      setError('Este navegador no pudo iniciar el lector local.')
      return
    }
    workerRef.current = worker
    worker.onmessage = ({ data }: MessageEvent<{ history?: History; error?: string }>) => {
      if (workerRef.current !== worker) return
      cancelImport()
      if (!data.history) {
        setError(data.error ?? 'No se pudo leer el historial.')
        return
      }
      setCustomHistory(data.history)
      if (demoLimitsActive) {
        setDemoLimitsActive(false)
        setLimits(null)
        setMoves([])
        setMoveNotice('')
      }
      setFilters(previous => ({ ...previous, queue: '', from: '', to: '' }))
    }
    worker.onerror = () => {
      if (workerRef.current !== worker) return
      cancelImport()
      setError('No se pudo procesar el archivo en esta sesión.')
    }
    worker.postMessage({ file, codes: [...locations.keys()] })
  }

  const resetScenario = () => {
    setZones(new Map())
    setMoves([])
    setMove({ sku: '', from: '', to: '' })
    setMoveNotice('')
  }

  const newReference = () => {
    cancelImport()
    setReference(snapshot)
    setCustomHistory(null)
    limitsToken.current++
    setLimitsBusy(false)
    setDemoLimitsActive(false)
    setLimits(null)
    setFilters(previous => ({ ...previous, queue: '', from: '', to: '', aisle: '', module: '', level: '' }))
    setSelection('')
    setLookup('')
    setError('')
    setMode('AS IS')
    resetScenario()
  }

  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters(previous => ({ ...previous, [key]: value, ...(key === 'flow' ? { queue: '' } : {}) }))
  }

  const selected = locations.get(selection)
  const selectLocation = useCallback((location: WarehouseLocation | null) => {
    setSelection(location?.code ?? '')
    setLookup(location?.code ?? '')
  }, [])
  const visible = useMemo(() => reference.locations.filter(location => matchesLocation(location, filters)), [reference, filters])
  const queues = useMemo(() => [...new Set(history.cycles.filter(order => order.flow === filters.flow).map(order => order.queue))].sort(), [history, filters.flow])
  const observed = useMemo(() => filterCycles(history.cycles, filters, locations), [history, filters, locations])
  const activity = useMemo(() => countActivity(observed), [observed])
  const metric = layer === 'rack' ? 'rack' : 'cycle'
  const score = useMemo(() => heatmap(observed, locations, metric, span), [observed, locations, metric, span])
  const bothFlows = useMemo(() => filterCycles(history.cycles, filters, locations, true), [history, filters, locations])

  const useHoldout = !!periods.cutoff && bothFlows.some(order => order.date >= periods.cutoff!)
  const cohort = useMemo(() => useHoldout ? bothFlows.filter(order => order.date >= periods.cutoff!) : bothFlows, [bothFlows, useHoldout, periods.cutoff])
  const training = useMemo(() => useHoldout
    ? history.cycles.filter(order => order.date < periods.cutoff!)
    : history.cycles.filter(order => (!filters.from || order.date >= filters.from) && (!filters.to || order.date <= filters.to)),
  [history, useHoldout, periods.cutoff, filters.from, filters.to])
  const comparison = useMemo(() => replay(cohort, training, locations, moves, 'cycle', span), [cohort, training, locations, moves, span])
  const rackComparison = useMemo(() => layer === 'rack' ? replay(cohort, training, locations, moves, 'rack', span) : null,
    [layer, cohort, training, locations, moves, span])
  const estimated = useMemo(() => {
    const groups = new Map<string, number[]>()
    for (const item of (rackComparison ?? comparison).after) {
      if (item.order.flow !== filters.flow) continue
      const durations = groups.get(item.order.location) ?? []
      durations.push(item.estimate)
      groups.set(item.order.location, durations)
    }
    return new Map([...groups].map(([code, values]) => [code, summarize(values)!]))
  }, [comparison, rackComparison, filters.flow])
  const estimatesShown = mode === 'TO BE' && estimateView && (layer === 'cycle' || layer === 'rack')
  const scale = useMemo(() => {
    let max = 0
    for (const location of visible) {
      const observedValue = layer === 'activity' ? activity.get(location.code) : score(location)?.median
      max = Math.max(max, observedValue ?? 0, layer === 'activity' ? 0 : estimated.get(location.code)?.median ?? 0)
    }
    return max
  }, [layer, visible, activity, score, estimated])
  const color = useCallback((location: WarehouseLocation) => {
    if (!isEligible(location)) return '#425267'
    if (layer === 'zones') {
      const zoneClass = mode === 'TO BE' ? zones.get(location.code) : undefined
      return zoneClass ? ZONE_COLORS[zoneClass] : '#cbd5e1'
    }
    const value = layer === 'activity' ? activity.get(location.code)
      : estimatesShown ? estimated.get(location.code)?.median : score(location)?.median
    if (value === undefined) return '#cbd5e1'
    return HEAT_COLORS[Math.min(HEAT_COLORS.length - 1, Math.floor(value / Math.max(1, scale) * HEAT_COLORS.length))]
  }, [layer, mode, zones, activity, estimatesShown, estimated, score, scale])

  const demand = useMemo(() => prioritizedDemand(bothFlows, locations, top), [bothFlows, locations, top])
  const capacity = useMemo(() => zoneCapacity(zones, locations), [zones, locations])
  const proposeZones = () => {
    const ranked = heatmap(bothFlows.filter(order => order.flow === 'Salida'), locations, 'cycle', span)
    setZones(classifyZones(visible, ranked, demand.slots, middle))
    setLayer('zones')
  }
  const editZone = () => {
    if (!selected) return
    const edits = new Map(zones)
    for (const location of reference.locations) {
      const same = scope === 'location' ? location.code === selected.code : location.prefix === selected.prefix
        && location.aisle === selected.aisle
        && (scope === 'module' ? location.module === selected.module : location.level === selected.level)
      if (same && isEligible(location)) edits.set(location.code, zone)
    }
    setZones(edits)
    setLayer('zones')
  }

  const loadLimits = async (file: File) => {
    const token = ++limitsToken.current
    setLimitsBusy(true)
    try {
      if (file.size > 1_048_576) throw new Error('El archivo de límites admite hasta 1 MB.')
      const parsed = parseLimits(await file.text())
      if (token !== limitsToken.current) return
      const retained: Move[] = []
      for (const item of moves) {
        if (!validateMove(item, retained, locations, parsed)) retained.push(item)
      }
      setMoves(retained)
      setMoveNotice(retained.length < moves.length
        ? 'Se cargaron los límites y se retiraron movimientos que requieren otra verificación.'
        : 'Límites cargados para esta sesión.')
      setDemoLimitsActive(false)
      setLimits(parsed)
    } catch {
      if (token === limitsToken.current) setMoveNotice('No se pudo leer la tabla JSON. Revisa el tamaño y el formato documentado.')
    } finally {
      if (token === limitsToken.current) setLimitsBusy(false)
    }
  }

  const submitMove = (input: Move, rules = limits) => {
    const normalized = { sku: input.sku.trim().toUpperCase(), from: input.from.trim().toUpperCase(), to: input.to.trim().toUpperCase() }
    const problem = validateMove(normalized, moves, locations, rules)
    if (problem) {
      setMoveNotice(problem)
      return
    }
    setMoves(previous => [...previous, normalized])
    setMoveNotice('Movimiento agregado al escenario.')
    setLayer('cycle')
    setEstimateView(true)
  }

  const exampleMove = demo.move
  const detailSample = selected ? (estimatesShown ? estimated.get(selected.code) : score(selected)) : undefined
  const detailStages = useMemo(() => ({
    channel: heatmap(observed, locations, 'channel', span),
    gap: heatmap(observed, locations, 'gap', span),
  }), [observed, locations, span])
  const eligibleSlots = useMemo(() => reference.locations.filter(isEligible).length, [reference])
  const detailProvenance = detailSample && 'source' in detailSample ? String(detailSample.source) : 'Órdenes proyectadas'
  const unsupported = Object.entries(history.excluded)
  if (!active) return null

  return (
    <section className="slotting" aria-labelledby="slotting-title">
      <div className="panel slotting-heading">
        <div>
          <h2 id="slotting-title">Escenarios de slotting</h2>
          <p className="slotting-muted">Referencia · {reference.metadata.generatedAt} · {number.format(reference.locations.length)} ubicaciones</p>
        </div>
        <div className="slotting-actions">
          <button aria-pressed={mode === 'AS IS'} onClick={() => { setMode('AS IS'); if (layer === 'zones') setLayer('cycle') }}>AS IS · Actual</button>
          <button aria-pressed={mode === 'TO BE'} onClick={() => setMode('TO BE')}>TO BE · Prueba</button>
          {snapshot !== reference && <button onClick={newReference}>Usar la nueva instantánea</button>}
          {mode === 'TO BE' && <button disabled={limitsBusy} onClick={resetScenario}>Reiniciar TO BE</button>}
        </div>
      </div>

      <div className="panel slotting-source">
        <div>
          <h3>Historial de órdenes EWM</h3>
          <p>{customHistory ? 'Excel local' : demo.history.cycles.length ? 'Historial sintético' : 'Sin historial'} · {number.format(history.cycles.length)} pares válidos de {number.format(history.groups)} órdenes</p>
          {periods.from && <p className="slotting-muted">{periods.from} al {periods.to}</p>}
        </div>
        <div>
          <label>Importar XLSX (hoja Data)<input aria-label="Importar historial EWM" type="file" accept=".xlsx" onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) importHistory(file)
            event.currentTarget.value = ''
          }}/></label>
          <small className="slotting-muted">El historial se procesa en el navegador durante la sesión.</small>
          {reading && <p role="status">Leyendo historial… <button onClick={cancelImport}>Cancelar</button></p>}
          {error && <p role="alert" className="slotting-error">{error}</p>}
        </div>
        {customHistory && <details>
          <summary>Calidad y exclusiones del historial</summary>
          <ul>
            {unsupported.map(([reason, count]) => <li key={reason}>{reason} · {number.format(count)}</li>)}
            <li>Filas sin orden o cola admitida · {number.format(history.skippedRows)}</li>
            <li>Pares con unidad distinta · {number.format(history.mismatchedUnits)}</li>
            <li>Pares con cantidad distinta · {number.format(history.mismatchedQuantities)}</li>
          </ul>
        </details>}
      </div>

      <div className="panel slotting-filters">
        <label>Flujo<select aria-label="Flujo" value={filters.flow} onChange={event => updateFilter('flow', event.target.value as Flow)}>
          <option>Salida</option><option>Entrada</option>
        </select></label>
        <label>Cola<select aria-label="Cola" value={filters.queue} onChange={event => updateFilter('queue', event.target.value)}>
          <option value="">Todas</option>{queues.map(queue => <option key={queue}>{queue}</option>)}
        </select></label>
        <label>Desde<input type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)}/></label>
        <label>Hasta<input type="date" value={filters.to} onChange={event => updateFilter('to', event.target.value)}/></label>
        <label>Pasillo<select aria-label="Pasillo" value={filters.aisle} onChange={event => updateFilter('aisle', event.target.value)}>
          <option value="">Todos</option>{reference.options.aisles.map(aisle => <option key={aisle}>{aisle}</option>)}
        </select></label>
        <label>Nivel<select aria-label="Nivel" value={filters.level} onChange={event => updateFilter('level', event.target.value)}>
          <option value="">Todos</option>{reference.options.levels.map(level => <option key={level}>{level}</option>)}
        </select></label>
        <label>Módulo<input type="number" min="1" step="1" value={filters.module} onChange={event => updateFilter('module', event.target.value)}/></label>
        <label>Ancho de tramo<select aria-label="Ancho de tramo" value={span} onChange={event => setSpan(Number(event.target.value))}>
          {[5, 10, 20].map(width => <option key={width}>{width}</option>)}
        </select></label>
      </div>

      <div className="slotting-layout">
        <div className="viewer panel">
          <div className="viewer-toolbar slotting-toolbar">
            <div className="slotting-actions">
              {Object.entries(LAYERS).filter(([key]) => key !== 'zones' || mode === 'TO BE').map(([key, label]) =>
                <button aria-pressed={layer === key} key={key} onClick={() => setLayer(key as Layer)}>{label}</button>)}
              {mode === 'TO BE' && (layer === 'cycle' || layer === 'rack') &&
                <label><input type="checkbox" checked={estimateView} onChange={event => setEstimateView(event.target.checked)}/> Ver estimación</label>}
            </div>
            <div className="camera-buttons">
              {CAMERAS.map(option => <button key={option} aria-pressed={camera === option} onClick={() => setCamera(option)}>{option}</button>)}
            </div>
          </div>
          <div className="canvas-wrap">
            <WarehouseScene locations={visible} selectedCode={selected?.code ?? null} onSelect={selectLocation} cameraMode={camera} colorForLocation={color}/>
          </div>
          <div className="slotting-legend">
            {layer === 'zones' ? Object.entries(ZONE_COLORS).map(([label, chip]) =>
              <span key={label}><i style={{ background: chip }}/> Zona {label}</span>)
              : <><strong>{estimatesShown ? 'Estimado' : 'Observado'}</strong><span>0 {layer === 'activity' ? 'órdenes' : 's'}</span>
                <span className="slotting-gradient" style={{ background: `linear-gradient(to right, ${HEAT_COLORS.join(', ')})` }}/>
                <span>{number.format(scale)} {layer === 'activity' ? 'órdenes' : 's'}</span></>}
            <span><i style={{ background: '#cbd5e1' }}/> {layer === 'zones' ? 'Sin clase' : 'Sin datos'}</span>
            <span><i style={{ background: '#425267' }}/> Excluida o bloqueada</span>
          </div>
        </div>

        <aside className="panel slotting-side">
          <h3>Detalle de ubicación</h3>
          <form className="slotting-actions" onSubmit={event => { event.preventDefault(); setSelection(lookup.trim().toUpperCase()) }}>
            <label>Buscar código<input value={lookup} onChange={event => setLookup(event.target.value)} placeholder="PA-04-019-1"/></label>
            <button>Seleccionar</button>
          </form>
          {selected ? <>
            <p className="location-code">{selected.code}</p>
            <p>{selected.storageType ?? '—'} / {selected.storageArea ?? '—'} · Pasillo {selected.aisle} · Módulo {selected.module} · Nivel {selected.level}</p>
            <p>Estado de referencia · {isEligible(selected) ? selected.status : 'Ubicación excluida o bloqueada'}{mode === 'TO BE' && zones.has(selected.code) ? ` · Zona ${zones.get(selected.code)}` : ''}</p>
            {layer === 'activity' ? <p>{number.format(activity.get(selected.code) ?? 0)} órdenes observadas</p>
              : layer !== 'zones' && (detailSample ? <>
                <p>Mediana {seconds(detailSample.median)} · P90 {seconds(detailSample.p90)}</p>
                <p className="slotting-muted">{number.format(detailSample.count)} órdenes · {detailProvenance}</p>
              </> : <p>Sin datos suficientes</p>)}
            {layer === 'cycle' && !estimatesShown && detailSample &&
              <p className="slotting-muted">Medianas · Canal {seconds(detailStages.channel(selected)?.median)} · Intervalo {seconds(detailStages.gap(selected)?.median)}</p>}
            {mode === 'TO BE' && moves.filter(item => item.from === selected.code || item.to === selected.code).map(item =>
              <small key={item.sku + item.from}>{item.sku} · {item.from} → {item.to}</small>)}
          </> : <p className="slotting-muted">{selection ? 'Código fuera del maestro.' : 'Selecciona una ubicación en el visor o busca por código.'}</p>}
        </aside>
      </div>

      {mode === 'TO BE' && <div className="slotting-editors">
        <section className="panel slotting-side">
          <h3>Zonas de acceso</h3>
          <p>{demand.priority.size} SKU priorizados · {demand.slots} posiciones requeridas · {Math.max(0, demand.slots - capacity.A)} de faltante en A</p>
          <p>A {capacity.A} · B {capacity.B} · C {capacity.C}</p>
          <div className="slotting-actions">
            <label>SKU prioritarios<input type="number" min="1" max="1000" value={top} onChange={event => setTop(Math.max(1, Math.min(1000, Math.floor(Number(event.target.value)))) || 1)}/></label>
            <label>Posiciones en B<input type="number" min="0" max={locations.size} value={middle} onChange={event => setMiddle(Math.max(0, Math.min(locations.size, Math.floor(Number(event.target.value)))) || 0)}/></label>
            <button onClick={proposeZones}>Proponer zonas</button>
          </div>
          <div className="slotting-actions">
            <label>Clase<select value={zone} onChange={event => setZone(event.target.value as Zone)}>{Object.keys(ZONE_COLORS).map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Aplicar a<select value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
              <option value="location">Ubicación</option><option value="module">Módulo del pasillo</option><option value="level">Nivel del pasillo</option>
            </select></label>
            <button disabled={!selected || scope === 'location' && !isEligible(selected)} onClick={editZone}>Asignar clase</button>
          </div>
        </section>
        <section className="panel slotting-side">
          <h3>Reubicaciones simuladas</h3>
          <label>Tabla local de límites (JSON)<input type="file" accept=".json" onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file) void loadLimits(file)
            event.currentTarget.value = ''
          }}/></label>
          <form className="slotting-actions" onSubmit={event => { event.preventDefault(); submitMove(move) }}>
            <label>SKU<input value={move.sku} onChange={event => setMove({ ...move, sku: event.target.value })} required/></label>
            <label>Origen<input value={move.from} onChange={event => setMove({ ...move, from: event.target.value })} required/></label>
            <label>Destino<input value={move.to} onChange={event => setMove({ ...move, to: event.target.value })} required/></label>
            <button disabled={limitsBusy || reading}>Ensayar movimiento</button>
          </form>
          {!customHistory && !limits && exampleMove && demo.limits && <button disabled={limitsBusy || reading} onClick={() => {
            setLimits(demo.limits)
            setDemoLimitsActive(true)
            submitMove(exampleMove, demo.limits)
          }}>Probar movimiento de la demo</button>}
          {moveNotice && <p role="status">{moveNotice}</p>}
          <ul className="slotting-moves">{moves.map((item, index) =>
            <li key={JSON.stringify([item.sku, item.from])}>{item.sku} · {item.from} → {item.to} <button disabled={limitsBusy} aria-label={`Quitar movimiento de ${item.sku} desde ${item.from}`} onClick={() => setMoves(previous => previous.filter((_, i) => i !== index))}>Quitar</button></li>)}</ul>
        </section>
      </div>}

      <section className="panel slotting-summary">
        <h3>Comparación por orden</h3>
        <p className="slotting-muted">{useHoldout ? `Validación desde ${periods.cutoff} con tiempos calibrados antes de esa fecha.` : 'Estimación con el historial del período seleccionado.'}</p>
        <p>{number.format(comparison.before.length)} de {number.format(cohort.length)} órdenes comparables · {moves.length} reubicaciones · {number.format(eligibleSlots)} posiciones habilitadas en ambos escenarios</p>
        <p>Capacidad por clase en TO BE · A {capacity.A} · B {capacity.B} · C {capacity.C}</p>
        <div className="slotting-table-wrap"><table>
          <thead><tr><th>Indicador del ciclo</th><th>AS IS observado</th><th>AS IS estimado</th><th>TO BE estimado</th><th>Diferencia estimada</th></tr></thead>
          <tbody>{(['Salida', 'Entrada'] as const).flatMap(flow => {
            const before = comparison.before.filter(item => item.order.flow === flow)
            const after = comparison.after.filter(item => item.order.flow === flow)
            const observedStats = summarize(before.map(item => item.order.cycle))
            const asIs = summarize(before.map(item => item.estimate))
            const toBe = summarize(after.map(item => item.estimate))
            return (['median', 'p90'] as const).map(field => <ComparisonRow key={flow + field} flow={flow} field={field} observed={observedStats} before={asIs} after={toBe}/>)
          })}</tbody>
        </table></div>
      </section>
    </section>
  )
}

function ComparisonRow({ flow, field, observed, before, after }: { flow: Flow; field: 'median' | 'p90'; observed: Sample | null; before: Sample | null; after: Sample | null }) {
  const delta = before && after ? after[field] - before[field] : undefined
  return <tr><th scope="row">{flow === 'Salida' ? 'Despacho' : 'Almacenamiento'} · {field === 'median' ? 'Mediana' : 'P90'}</th>
    <td>{seconds(observed?.[field])}</td><td>{seconds(before?.[field])}</td><td>{seconds(after?.[field])}</td>
    <td>{delta !== undefined && delta > 0 ? '+' : ''}{seconds(delta)}</td></tr>
}
