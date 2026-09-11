import { useEffect, useMemo, useState } from 'react'
import { fetchSnapshot } from './api'
import type { Snapshot, WarehouseLocation } from './types'
import WarehouseScene from './components/WarehouseScene'
import MultiFilter from './components/MultiFilter'

const STATUS_LABEL: Record<string,string> = {
  LIBRE:'Libre', OCUPADA:'Ocupada', PARCIAL:'Parcial', BLOQUEADA:'Bloqueada', NO_DISPONIBLE:'No disponible'
}

function toggleSet<T>(set: Set<T>, value: T) {
  const next = new Set(set)
  next.has(value) ? next.delete(value) : next.add(value)
  return next
}

function Kpi({value,label,accent}: {value:string|number,label:string,accent:string}) {
  return <div className="kpi" style={{borderTopColor:accent}}><strong>{value}</strong><span>{label}</span></div>
}

export default function App() {
  const [data,setData]=useState<Snapshot|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  const [selected,setSelected]=useState<WarehouseLocation|null>(null)
  const [aisles,setAisles]=useState<Set<number>>(new Set())
  const [levels,setLevels]=useState<Set<number>>(new Set())
  const [storageTypes,setStorageTypes]=useState<Set<string>>(new Set())
  const [statuses,setStatuses]=useState<Set<string>>(new Set())
  const [prefixes,setPrefixes]=useState<Set<string>>(new Set())
  const [minAge,setMinAge]=useState(0)
  const [search,setSearch]=useState('')
  const [cameraMode,setCameraMode]=useState<'ISO'|'TOP'|'FRONT'|'SIDE'>('ISO')

  useEffect(()=>{
    fetchSnapshot().then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false))
  },[])

  const filtered = useMemo(()=>{
    if (!data) return []
    const q=search.trim().toLowerCase()
    return data.locations.filter(l => {
      if (aisles.size && !aisles.has(l.aisle)) return false
      if (levels.size && !levels.has(l.level)) return false
      if (storageTypes.size && !storageTypes.has(String(l.storageType))) return false
      if (statuses.size && !statuses.has(l.status)) return false
      if (prefixes.size && !prefixes.has(l.prefix)) return false
      if (minAge>0 && (l.ageDays===null || l.ageDays<minAge)) return false
      if (q) {
        const hay=[l.code,...l.products,...l.lots,...l.descriptions].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  },[data,aisles,levels,storageTypes,statuses,prefixes,minAge,search])

  const filteredKpis = useMemo(()=>{
    const eligible=filtered.filter(l=>!['BLOQUEADA','NO_DISPONIBLE'].includes(l.status))
    const occupied=eligible.filter(l=>l.stockCount>0)
    const free=eligible.filter(l=>l.stockCount===0)
    const blocked=filtered.filter(l=>l.status==='BLOQUEADA')
    return {total:filtered.length,eligible:eligible.length,occupied:occupied.length,free:free.length,blocked:blocked.length,pct:eligible.length?occupied.length/eligible.length*100:0}
  },[filtered])

  const reset=()=>{setAisles(new Set());setLevels(new Set());setStorageTypes(new Set());setStatuses(new Set());setPrefixes(new Set());setMinAge(0);setSearch('');setSelected(null)}

  if (loading) return <div className="splash"><div className="spinner"/><h2>Construyendo almacén 3D…</h2><p>Cargando más de 17 mil ubicaciones.</p></div>
  if (error || !data) return <div className="splash error"><h2>No se pudo abrir la demo</h2><p>{error}</p></div>

  return (
    <div className="app-shell">
      <header>
        <div><h1>Ocupación 3D del Almacén</h1><p>Digital Twin operativo · SAP EWM</p></div>
        <div className="header-meta"><span className="demo-badge">DEMO ANONIMIZADA</span><small>Generado: {new Date(data.metadata.generatedAt).toLocaleString('es-PE')}</small></div>
      </header>

      <section className="kpi-row">
        <Kpi value={`${filteredKpis.pct.toFixed(1)}%`} label="Ocupación operativa" accent="#ef4444"/>
        <Kpi value={filteredKpis.total.toLocaleString('es-PE')} label="Ubicaciones visibles" accent="#0f766e"/>
        <Kpi value={filteredKpis.occupied.toLocaleString('es-PE')} label="Ocupadas" accent="#ef4444"/>
        <Kpi value={filteredKpis.free.toLocaleString('es-PE')} label="Libres" accent="#22c55e"/>
        <Kpi value={filteredKpis.blocked.toLocaleString('es-PE')} label="Bloqueadas" accent="#64748b"/>
      </section>

      <main>
        <aside className="filters panel">
          <div className="panel-head"><h2>Filtros</h2><button onClick={reset}>Limpiar</button></div>
          <label className="search-label">Buscar ubicación, producto o lote<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ej. PA-02-006-2" /></label>
          <label className="search-label">Mercadería sin rotación: mínimo de días<input type="number" min="0" step="1" value={minAge} onChange={e=>setMinAge(Math.max(0,Number(e.target.value)||0))}/></label>
          <MultiFilter title="Pasillos" values={data.options.aisles} selected={aisles} onChange={v=>setAisles(toggleSet(aisles,v))} render={v=>`Pasillo ${String(v).padStart(2,'0')}`}/>
          <MultiFilter title="Niveles" values={data.options.levels} selected={levels} onChange={v=>setLevels(toggleSet(levels,v))} render={v=>`Nivel ${v}`}/>
          <MultiFilter title="Tipo de almacén" values={data.options.storageTypes} selected={storageTypes} onChange={v=>setStorageTypes(toggleSet(storageTypes,v))}/>
          <MultiFilter title="Identificador" values={data.options.prefixes} selected={prefixes} onChange={v=>setPrefixes(toggleSet(prefixes,v))}/>
          <MultiFilter title="Estado" values={Object.keys(STATUS_LABEL)} selected={statuses} onChange={v=>setStatuses(toggleSet(statuses,v))} render={v=>STATUS_LABEL[v]}/>
          <div className="legend"><h3>Leyenda</h3><span><i className="c free"/>Libre</span><span><i className="c occupied"/>Ocupada</span><span><i className="c partial"/>Parcial</span><span><i className="c blocked"/>Bloqueada</span><span><i className="c selected"/>Seleccionada</span></div>
        </aside>

        <section className="viewer panel">
          <div className="viewer-toolbar">
            <div><strong>{filtered.length.toLocaleString('es-PE')}</strong> ubicaciones visibles</div>
            <div className="camera-buttons">{(['ISO','TOP','FRONT','SIDE'] as const).map(m=><button className={cameraMode===m?'active':''} key={m} onClick={()=>setCameraMode(m)}>{m}</button>)}</div>
          </div>
          <div className="canvas-wrap"><WarehouseScene locations={filtered} selectedCode={selected?.code||null} onSelect={setSelected} cameraMode={cameraMode}/></div>
        </section>

        <aside className="details panel">
          <h2>Detalle de ubicación</h2>
          {!selected ? <div className="empty-detail"><strong>Selecciona un bloque</strong><p>Haz clic en una ubicación del modelo para revisar producto, lote y antigüedad.</p></div> : <>
            <div className="location-code">{selected.code}</div>
            <dl>
              <dt>Estado</dt><dd>{STATUS_LABEL[selected.status]}</dd>
              <dt>Tipo almacén</dt><dd>{selected.storageType || '—'}</dd>
              <dt>Área</dt><dd>{selected.storageArea || '—'}</dd>
              <dt>Pasillo</dt><dd>{String(selected.aisle).padStart(2,'0')}</dd>
              <dt>Posición</dt><dd>{String(selected.position).padStart(3,'0')}</dd>
              <dt>Nivel</dt><dd>{selected.level}</dd>
              <dt>Lado</dt><dd>{selected.side}</dd>
              <dt>Antigüedad máx.</dt><dd>{selected.ageDays===null?'—':`${selected.ageDays} días`}</dd>
              <dt>Fecha ingreso más antigua</dt><dd>{selected.oldestEntryDate || '—'}</dd>
              <dt>Peso total</dt><dd>{selected.weightTotal.toLocaleString('es-PE')} kg</dd>
            </dl>
            <h3>Stock ({selected.stock.length})</h3>
            <div className="stock-list">{selected.stock.slice(0,12).map((s,i)=><div className="stock-card" key={`${s.handlingUnit}-${i}`}><strong>{s.product || 'Sin producto'}</strong><span>{s.description || ''}</span><small>Lote: {s.lot || '—'} · HU: {s.handlingUnit || '—'}</small></div>)}</div>
          </>}
        </aside>
      </main>

      <section className="analysis panel">
        <div><h2>Lectura ejecutiva</h2><p>Esta demo utiliza datos anonimizados y conserva la geometría del almacén para demostrar navegación, filtros múltiples y mercadería sin rotación.</p></div>
        <div className="analysis-cards"><div><strong>{data.kpis.totalLocations.toLocaleString('es-PE')}</strong><span>ubicaciones del maestro</span></div><div><strong>{data.options.aisles.length}</strong><span>pasillos</span></div><div><strong>{Math.max(...data.options.levels)}</strong><span>niveles</span></div><div><strong>{data.kpis.uniqueProducts}</strong><span>productos demo</span></div></div>
      </section>
    </div>
  )
}
