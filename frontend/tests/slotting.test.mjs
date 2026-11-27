import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseHistory } from '../src/slotting/history.ts'
import {
  classifyZones, countActivity, filterCycles, heatmap, parseLimits, prioritizedDemand, replay, summarize,
  validateMove, zoneCapacity,
} from '../src/slotting/scenario.ts'

const a = 'PA-04-007-2'
const b = 'PA-04-089-1'
const header = ['Orden de almacén', 'Producto', 'Ubic.procedencia', 'Ubicación de destino', 'Cl.proceso almacén',
  'Fecha confirmación', 'Hora de confirmación', 'Fe.inicio', 'Hora inicio', 'Cola', 'Un.medida alternat.', 'Ctd.real dest.UMA']
const entry = (id, location = a, sku = 'SKU') => [
  [id, 'SKU', 'CNL-INB-1', '', 'P112', '25/11/2026', '23:59:59', '25/11/2026', '23:59:59', 'ENTRAPERF', 'PAL', 1],
  [id, sku, '', location, 3060, '26/11/2026', '00:00:37', '26/11/2026', 0, 'ENTRAPERF', 'PAL', 1],
]
const exit = id => [
  [id, 'SKU', '', 'CNL-OUT-1', 'P284', '2026-11-26', '11:01:53', '2026-11-26', '11:01:49', 'SALIDAPERF'],
  [id, 'SKU', b, '', 'P284', '2026-11-26', '11:01:47', '2026-11-26', '11:00:00', 'SALIDAPERF'],
]

test('enlaza por orden y cola con secuencia por etapa, RF de 0 s y cruce de fecha', () => {
  const result = parseHistory([header, ...exit('1'), ...entry('1')], new Set([a, b]))
  assert.deepEqual(result.cycles.map(({ location, cycle, rack, channel, gap, date }) => [location, cycle, rack, channel, gap, date]),
    [[b, 113, 107, 4, 2, '2026-11-26'], [a, 38, 37, 0, 1, '2026-11-26']])
})

test('distingue ciclos inválidos y conserva advertencias de unidad y cantidad', () => {
  const chronology = exit('5')
  chronology[0][8] = '11:01:46'
  const discrepancy = entry('6')
  discrepancy[1][10] = 'BOX'
  discrepancy[1][11] = 2
  const result = parseHistory([header, ...entry('1', 'PA-90-007-2'), ...entry('2', a, 'OTHER'), ...entry('3').slice(0, 1),
    ...entry('4'), entry('4')[1], ...chronology, ...discrepancy], new Set([a, b]))
  assert.deepEqual(result.excluded, {
    'Ubicación fuera del maestro': 1, 'Productos distintos o ausentes': 1, 'Una sola etapa': 1,
    'Combinación ambigua': 1, 'Cronología inválida': 1,
  })
  assert.equal(result.mismatchedQuantities, 1)
  assert.equal(result.mismatchedUnits, 1)
  assert.throws(() => parseHistory([['Cola']], new Set()), /Faltan columnas/)
})

const load = { product: 'SKU', weight: 100 }
const location = (code, module, level, stock = []) => ({
  code, prefix: 'PA', aisle: 4, module, level, storageType: 'A1PA', storageArea: 'A001',
  status: stock.length ? 'OCUPADA' : 'LIBRE', blockedIn: false, blockedOut: false, stock,
})
const near = location(a, 4, 2)
const far = location(b, 45, 1, [load])
const neighbor = location('PA-04-009-2', 5, 2)
const unknown = location('PA-04-037-3', 19, 3)
const loc = new Map([near, far, neighbor, unknown].map(item => [item.code, item]))
const orders = [near, far].flatMap((item, index) => Array.from({ length: 10 }, () => ({
  flow: 'Salida', queue: 'SALIDAPERF', sku: 'SKU', location: item.code, cycle: index ? 98 : 80, rack: index ? 67 : 75,
  date: '2026-11-26',
})))

test('agrupa por filtros, respalda por tramo y prioriza el módulo cercano del nivel 2', () => {
  const filters = { flow: 'Salida', queue: 'SALIDAPERF', aisle: '4', level: '2', module: '4', from: '2026-11-26', to: '2026-11-26' }
  assert.equal(countActivity(filterCycles(orders, filters, loc)).get(a), 10)
  assert.equal(filterCycles(orders, { ...filters, to: '2026-11-25' }, loc).length, 0)
  const score = heatmap(orders, loc, 'cycle', 10)
  assert.equal(score(near).source, 'Ubicación')
  assert.match(score(neighbor).source, /módulos 1–10/)
  assert.equal(score(unknown), null)
  const demand = prioritizedDemand(orders, loc, 1)
  const zones = classifyZones([near, far], score, demand.slots, 1)
  assert.deepEqual([...zones], [[a, 'A'], [b, 'B']])
  assert.deepEqual(zoneCapacity(zones, loc), { A: 1, B: 1, C: 0 })
  zones.set(b, 'A')
  assert.equal(zoneCapacity(zones, loc).A, 2)
  assert.equal(far.storageArea, 'A001')
})

const move = { sku: 'SKU', from: b, to: a }
const constraints = (allowedSkus = ['SKU'], maxLoads = 1, maxWeightKg = 150, dimensionsCm = [130, 100, 120]) => parseLimits(JSON.stringify({
  products: [{ sku: 'SKU', dimensionsCm: [120, 100, 100] }],
  locations: [{ code: a, dimensionsCm, maxWeightKg, maxLoads, allowedSkus }],
}))

test('valida restricciones, acumulación, datos ausentes y stock duplicado', () => {
  assert.equal(validateMove(move, [], loc, constraints()), null)
  assert.match(validateMove(move, [move], loc, constraints()), /ya está asignado/)
  assert.match(validateMove(move, [], loc, null), /Pendiente/)
  assert.match(validateMove(move, [], loc, constraints([])), /compatible/)
  assert.match(validateMove(move, [], loc, constraints(['SKU'], 1, 90)), /peso acumulado/)
  assert.match(validateMove(move, [], loc, constraints(['SKU'], 1, 150, [110, 100, 120])), /dimensiones/)
  const second = location('PA-04-093-1', 47, 1, [load])
  const withStock = new Map(loc).set(second.code, second)
  assert.match(validateMove(move, [{ ...move, from: second.code }], withStock, constraints()), /capacidad de cargas acumulada/)
  assert.match(validateMove(move, [], new Map(loc).set(a, { ...near, blockedIn: true }), constraints()), /bloqueado/)
})

test('compara las mismas órdenes, excluye ambos lados si un destino carece de evidencia', () => {
  const sample = orders.filter(order => order.location === b)
  const identical = replay(sample, orders, loc, [], 'cycle', 10)
  assert.deepEqual(identical.before, identical.after)
  const changed = replay(sample, orders, loc, [move], 'cycle', 10)
  assert.equal(changed.before.length, changed.after.length)
  assert.equal(summarize(changed.after.map(item => item.estimate)).median - summarize(changed.before.map(item => item.estimate)).median, -18)
  const unavailable = replay(sample, orders, loc, [{ ...move, to: unknown.code }], 'cycle', 10)
  assert.deepEqual(unavailable, { before: [], after: [] })
})
