import type { WarehouseLocation } from '../types'
import type { Flow, History, OrderCycle } from './history'

export type Zone = 'A' | 'B' | 'C'
export type Layer = 'activity' | 'cycle' | 'rack' | 'zones'
export type Zones = ReadonlyMap<string, Zone>
export type Move = { sku: string; from: string; to: string }
export type Locations = ReadonlyMap<string, WarehouseLocation>
export const MIN_SAMPLE = 10

export interface Filters {
  flow: Flow
  queue: string
  from: string
  to: string
  aisle: string
  level: string
  module: string
}

export interface Sample {
  count: number
  median: number
  p90: number
}

export function summarize(values: number[]): Sample | null {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const percentile = (p: number) => {
    const index = (sorted.length - 1) * p
    const floor = Math.floor(index)
    return sorted[floor] + (sorted[Math.ceil(index)] - sorted[floor]) * (index - floor)
  }
  return { count: values.length, median: percentile(.5), p90: percentile(.9) }
}

export function matchesLocation(location: WarehouseLocation, filters: Filters) {
  return (!filters.aisle || Number(filters.aisle) === location.aisle)
    && (!filters.level || Number(filters.level) === location.level)
    && (!filters.module || Number(filters.module) === location.module)
}

export function filterCycles(cycles: OrderCycle[], filters: Filters, locations: Locations, bothFlows = false) {
  return cycles.filter(cycle => {
    const location = locations.get(cycle.location)
    return location && matchesLocation(location, filters)
      && (bothFlows || cycle.flow === filters.flow)
      && (!filters.queue || cycle.flow !== filters.flow || cycle.queue === filters.queue)
      && (!filters.from || cycle.date >= filters.from)
      && (!filters.to || cycle.date <= filters.to)
  })
}

function append<K, V>(map: Map<K, V[]>, key: K, item: V) {
  let list = map.get(key)
  if (!list) map.set(key, list = [])
  list.push(item)
}

function tranche(location: WarehouseLocation, span: number) {
  const first = Math.floor((Math.max(1, location.module) - 1) / span) * span + 1
  return {
    key: JSON.stringify([location.prefix, location.aisle, location.level, location.storageType, location.storageArea, first]),
    label: `módulos ${first}–${first + span - 1}, nivel ${location.level}`,
  }
}

export function heatmap(cycles: OrderCycle[], locations: Locations, metric: 'cycle' | 'rack' | 'channel' | 'gap', span: number) {
  const direct = new Map<string, number[]>()
  const nearby = new Map<string, number[]>()
  for (const cycle of cycles) {
    const location = locations.get(cycle.location)
    if (!location) continue
    append(direct, location.code, cycle[metric])
    append(nearby, tranche(location, span).key, cycle[metric])
  }
  const summaries = new Map([...direct].map(([key, durations]) => [key, summarize(durations)!]))
  const tranches = new Map([...nearby].map(([key, durations]) => [key, summarize(durations)!]))
  return (location: WarehouseLocation) => {
    const directSample = summaries.get(location.code)
    if (directSample && directSample.count >= MIN_SAMPLE) return { ...directSample, source: 'Ubicación' }
    const group = tranche(location, span)
    const sample = tranches.get(group.key)
    return sample && sample.count >= MIN_SAMPLE ? { ...sample, source: group.label } : null
  }
}

export function countActivity(cycles: OrderCycle[]) {
  const counts = new Map<string, number>()
  for (const cycle of cycles) counts.set(cycle.location, (counts.get(cycle.location) ?? 0) + 1)
  return counts
}

export function isEligible(location: WarehouseLocation) {
  return location.status !== 'BLOQUEADA' && location.status !== 'NO_DISPONIBLE' && !location.blockedIn && !location.blockedOut
}

export function prioritizedDemand(cycles: OrderCycle[], locations: Locations, top: number) {
  const count = new Map<string, number>()
  for (const cycle of cycles) {
    if (cycle.flow === 'Salida') count.set(cycle.sku, (count.get(cycle.sku) ?? 0) + 1)
  }
  const priority = new Set([...count].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).slice(0, top).map(([sku]) => sku))
  const slots = [...locations.values()].filter(location => location.stock.some(stock => stock.product && priority.has(stock.product.toUpperCase()))).length
  return { priority, slots }
}

export function classifyZones(locations: WarehouseLocation[], score: (location: WarehouseLocation) => Sample | null, required: number, middleSlots: number) {
  const ranked = locations.filter(isEligible).flatMap(location => {
    const sample = score(location)
    return sample ? [{ code: location.code, median: sample.median }] : []
  }).sort((a, b) => a.median - b.median || a.code.localeCompare(b.code))
  return new Map(ranked.map(({ code }, index): [string, Zone] =>
    [code, index < required ? 'A' : index < required + middleSlots ? 'B' : 'C']))
}

export function zoneCapacity(zones: Zones, locations: Locations) {
  const count = { A: 0, B: 0, C: 0 }
  for (const [code, zone] of zones) {
    const location = locations.get(code)
    if (location && isEligible(location)) count[zone]++
  }
  return count
}

type Limits = {
  products: Map<string, [number, number, number]>
  locations: Map<string, {
    dimensions: [number, number, number]
    maxWeightKg: number
    maxLoads: number
    allowedSkus: Set<string>
  }>
}

export function parseLimits(text: string): Limits {
  const raw = JSON.parse(text) as { products?: unknown; locations?: unknown } | null
  if (!Array.isArray(raw?.products) || !Array.isArray(raw.locations)) throw new Error('La tabla requiere listas products y locations.')
  const limits: Limits = { products: new Map(), locations: new Map() }
  const dimensions = (values: unknown): [number, number, number] => {
    if (!Array.isArray(values) || values.length !== 3 || !values.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) {
      throw new Error('Cada medida debe indicar largo, ancho y alto positivos en centímetros.')
    }
    return [values[0], values[1], values[2]]
  }
  for (const product of raw.products) {
    const sku = typeof product?.sku === 'string' && product.sku.trim().toUpperCase()
    if (!sku || limits.products.has(sku)) throw new Error('La tabla contiene SKU de producto ausentes o repetidos.')
    limits.products.set(sku, dimensions(product.dimensionsCm))
  }
  for (const location of raw.locations) {
    const code = typeof location?.code === 'string' && location.code.trim().toUpperCase()
    if (!code || limits.locations.has(code)) throw new Error('La tabla contiene ubicaciones ausentes o repetidas.')
    if (!Number.isFinite(location.maxWeightKg) || location.maxWeightKg <= 0
      || !Number.isSafeInteger(location.maxLoads) || location.maxLoads <= 0
      || !Array.isArray(location.allowedSkus)
      || !location.allowedSkus.every((sku: unknown) => typeof sku === 'string' && sku.trim())) {
      throw new Error('Cada ubicación requiere peso máximo, capacidad de cargas enteras y SKU permitidos.')
    }
    limits.locations.set(code, {
      dimensions: dimensions(location.dimensionsCm), maxWeightKg: location.maxWeightKg, maxLoads: location.maxLoads,
      allowedSkus: new Set(location.allowedSkus.map((sku: string) => sku.trim().toUpperCase())),
    })
  }
  return limits
}

function stockFor(move: Move, locations: Locations) {
  return locations.get(move.from)?.stock.filter(stock => stock.product?.toUpperCase() === move.sku) ?? []
}

export function validateMove(move: Move, others: Move[], locations: Locations, limits: Limits | null): string | null {
  const source = locations.get(move.from)
  const target = locations.get(move.to)
  if (!source || !target || !move.sku || source.code === target.code) return 'Selecciona un SKU y ubicaciones distintas del maestro.'
  if (!isEligible(source) || !isEligible(target)) return 'El origen o destino está bloqueado o no disponible.'
  if (others.some(other => other.from === move.from && other.sku === move.sku)) return 'Ese stock ya está asignado a un movimiento.'
  const stock = stockFor(move, locations)
  if (!stock.length) return 'El SKU no tiene stock en ese origen.'
  const product = limits?.products.get(move.sku)
  const destination = limits?.locations.get(target.code)
  if (!product || !destination) return 'Pendiente de verificación. Faltan límites del SKU o de la ubicación.'
  if (!destination.allowedSkus.has(move.sku)) return 'El SKU no es compatible con el tipo de almacenamiento del destino según la tabla de límites.'
  if (product.some((value, index) => value > destination.dimensions[index])) return 'Las dimensiones del producto exceden el espacio disponible.'
  const loads = [...target.stock, ...stock, ...others.filter(other => other.to === move.to).flatMap(other => stockFor(other, locations))]
  if (loads.length > destination.maxLoads) return 'El destino supera la capacidad de cargas acumulada.'
  if (loads.some(load => load.weight === null || !Number.isFinite(load.weight) || load.weight <= 0)) {
    return 'Pendiente de verificación. Falta peso válido para una carga.'
  }
  if (loads.reduce((total, load) => total + load.weight!, 0) > destination.maxWeightKg) return 'El peso acumulado supera el máximo del destino.'
  return null
}

export function replay(cohort: OrderCycle[], training: OrderCycle[], locations: Locations, moves: Move[], metric: 'cycle' | 'rack', span: number) {
  const model = new Map<string, ReturnType<typeof heatmap>>()
  const queues = new Map<string, OrderCycle[]>()
  for (const order of training) append(queues, order.queue, order)
  const targets = new Map(moves.map(move => [JSON.stringify([move.sku, move.from]), move.to]))
  const before: { order: OrderCycle; estimate: number }[] = []
  const after: { order: OrderCycle; estimate: number }[] = []
  for (const order of cohort) {
    let predict = model.get(order.queue)
    if (!predict) {
      predict = heatmap(queues.get(order.queue) ?? [], locations, metric, span)
      model.set(order.queue, predict)
    }
    const destination = targets.get(JSON.stringify([order.sku, order.location])) ?? order.location
    const source = locations.get(order.location)
    const target = locations.get(destination)
    const a = source && predict(source)
    const b = target && predict(target)
    if (!a || !b) continue
    before.push({ order, estimate: a.median })
    after.push({ order: { ...order, location: destination }, estimate: b.median })
  }
  return { before, after }
}

export function historicalPeriods(cycles: OrderCycle[]) {
  const dates = [...new Set(cycles.map(order => order.date))].sort()
  const cutoff = dates.length >= 14 ? dates[Math.floor(dates.length * .75)] : null
  return { from: dates[0] ?? '', to: dates.at(-1) ?? '', cutoff }
}

export function demoHistory(locations: WarehouseLocation[]) {
  const pairable = locations.filter(location => isEligible(location) && location.prefix === 'PA')
  const source = pairable.find(location => location.aisle === 4 && location.level === 1 && location.module >= 41
    && location.stock.some(stock => stock.product && stock.weight && stock.weight > 0))
  const target = pairable.find(location => location.aisle === 4 && location.level === 2 && location.module <= 20 && !location.stock.length
    && (!source || source.storageType === location.storageType && source.storageArea === location.storageArea))
  const main = source?.stock.find(stock => stock.product && stock.weight && stock.weight > 0)?.product?.toUpperCase()
  const codes = new Set([source?.code, target?.code])
  const illustrative = [...(source ? [source] : []), ...(target ? [target] : []),
    ...pairable.filter(location => [4, 8].includes(location.aisle) && location.level <= 3 && !codes.has(location.code)).slice(0, 48)]
  const history: History = { cycles: [], groups: 0, skippedRows: 0, mismatchedQuantities: 0, mismatchedUnits: 0, excluded: {} }
  for (const [index, location] of illustrative.entries()) {
    const outgoing = location.code === target?.code ? 72 : location.code === source?.code ? 98 : 72 + location.level * 9 + Math.floor(location.module / 3)
    for (let day = 1; day <= 20; day++) {
      const date = `2026-11-${String(day).padStart(2, '0')}`
      const sku = location.code === source?.code && main ? main : `DEMO-${index + 1}`
      const rack = outgoing - 8 + day % 7
      const dispatch: OrderCycle = { queue: 'SALIDAPERF', flow: 'Salida', sku, location: location.code, date, cycle: rack + 8, rack, channel: 5, gap: 3 }
      history.cycles.push(dispatch)
      if (location.code === source?.code) history.cycles.push({ ...dispatch, cycle: dispatch.cycle + 2, rack: dispatch.rack + 2 })
      const entry = Math.round(outgoing / 2) + day % 4
      history.cycles.push({ queue: 'ENTRAPERF', flow: 'Entrada', sku, location: location.code, date, cycle: entry + 1, rack: entry, channel: 0, gap: 1 })
    }
  }
  history.groups = history.cycles.length
  const weight = source?.stock.filter(stock => stock.product?.toUpperCase() === main)
    .reduce((sum, stock) => sum + (stock.weight ?? 0), 0)
  const limits = target && main && weight ? parseLimits(JSON.stringify({
    products: [{ sku: main, dimensionsCm: [120, 100, 110] }],
    locations: [{ code: target.code, dimensionsCm: [140, 120, 150], maxWeightKg: weight * 1.25, maxLoads: 4, allowedSkus: [main] }],
  })) : null
  const move = source && target && main ? { sku: main, from: source.code, to: target.code } : null
  return { history, limits, move }
}

export type CompatibilityLimits = ReturnType<typeof parseLimits>
