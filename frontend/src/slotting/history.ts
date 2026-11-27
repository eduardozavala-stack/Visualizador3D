export type Flow = 'Entrada' | 'Salida'

export interface OrderCycle {
  queue: string
  flow: Flow
  sku: string
  location: string
  date: string
  cycle: number
  rack: number
  channel: number
  gap: number
}

export interface History {
  cycles: OrderCycle[]
  groups: number
  skippedRows: number
  mismatchedUnits: number
  mismatchedQuantities: number
  excluded: Record<string, number>
}

type Cell = string | number | boolean | Date | null | undefined
const DAY = 86400
const EXCEL_EPOCH = Date.UTC(1899, 11, 30) / 1000
export const MAX_ROWS = 120_000
export const MAX_COLUMNS = 64

const headers = {
  order: 'Orden de almacén',
  sku: 'Producto',
  origin: 'Ubic.procedencia',
  target: 'Ubicación de destino',
  process: 'Cl.proceso almacén',
  endDate: 'Fecha confirmación',
  endTime: 'Hora de confirmación',
  startDate: 'Fe.inicio',
  startTime: 'Hora inicio',
  queue: 'Cola',
  unit: 'Un.medida alternat.',
  quantity: 'Ctd.real dest.UMA',
} as const

function label(value: Cell) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim().toUpperCase() : ''
}

function datePart(value: Cell): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000 / DAY) * DAY
  if (typeof value === 'number' && value >= 61 && value < 2_958_466) return EXCEL_EPOCH + Math.floor(value) * DAY
  if (typeof value !== 'string') return NaN
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00(?::00)?)?$/.exec(text)
  const short = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  if (!iso && !short) return NaN
  const [year, month, day] = (iso ? iso.slice(1) : [short![3], short![2], short![1]]).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.getTime() / 1000
    : NaN
}

function timePart(value: Cell): number {
  if (value instanceof Date) return ((Math.round(value.getTime() / 1000) % DAY) + DAY) % DAY
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const seconds = Math.round(value * DAY)
    return seconds < DAY ? seconds : NaN
  }
  const match = typeof value === 'string' && /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim())
  if (!match) return NaN
  const [h, m, s = 0] = match.slice(1).filter(value => value !== undefined).map(Number)
  return h < 24 && m < 60 && s < 60 ? h * 3600 + m * 60 + s : NaN
}

interface StageRow {
  sku: string
  stage: 'rack' | 'channel' | 'other'
  location: string
  start: number
  end: number
  quantity: string
  unit: string
}

interface OrderGroup {
  queue: string
  flow: Flow
  rows: StageRow[]
}

export function parseHistory(sheet: readonly (readonly Cell[])[], masterCodes: ReadonlySet<string>): History {
  const [header, ...rows] = sheet
  if (!header || rows.length > MAX_ROWS || header.length > MAX_COLUMNS) throw new Error('El archivo supera las dimensiones admitidas o la hoja Data está vacía.')
  const columns = new Map(header.map((value, index) => [label(value), index]))
  const required = ['order', 'sku', 'origin', 'target', 'process', 'endDate', 'endTime', 'startDate', 'startTime', 'queue'] as const
  if (required.some(key => !columns.has(label(headers[key])))) throw new Error('Faltan columnas EWM requeridas en la hoja Data.')

  const history: History = { cycles: [], groups: 0, skippedRows: 0, mismatchedUnits: 0, mismatchedQuantities: 0, excluded: {} }
  const grouped = new Map<string, OrderGroup>()
  for (const row of rows) {
    if (row.every(value => value == null || value === '')) continue
    const cell = (key: keyof typeof headers) => row[columns.get(label(headers[key])) ?? -1]
    const order = label(cell('order'))
    const queue = label(cell('queue'))
    const flow = queue.startsWith('ENTRA') ? 'Entrada' : queue.startsWith('SALID') ? 'Salida' : null
    if (!order || !flow) {
      history.skippedRows++
      continue
    }
    const process = label(cell('process'))
    const origin = label(cell('origin'))
    const target = label(cell('target'))
    const location = flow === 'Entrada' ? target : origin
    const isChannel = flow === 'Entrada'
      ? process === 'P112' && origin.startsWith('CNL-')
      : process === 'P284' && target.startsWith('CNL-OUT-')
    const isRack = (flow === 'Entrada' ? ['1015', '3060'].includes(process) : process === 'P284')
      && (masterCodes.has(location) || /^[A-Z]+-\d+-\d+-\d+$/.test(location))
    const stage = isRack === isChannel ? 'other' : isRack ? 'rack' : 'channel'
    const id = JSON.stringify([order, queue])
    let group = grouped.get(id)
    if (!group) {
      group = { queue, flow, rows: [] }
      grouped.set(id, group)
    }
    group.rows.push({
      stage, location, sku: label(cell('sku')), quantity: label(cell('quantity')), unit: label(cell('unit')),
      start: datePart(cell('startDate')) + timePart(cell('startTime')),
      end: datePart(cell('endDate')) + timePart(cell('endTime')),
    })
  }

  const exclude = (reason: string) => { history.excluded[reason] = (history.excluded[reason] ?? 0) + 1 }
  history.groups = grouped.size
  for (const { queue, flow, rows: stages } of grouped.values()) {
    if (stages.length !== 2) {
      exclude(stages.length < 2 ? 'Una sola etapa' : 'Combinación ambigua')
      continue
    }
    const rack = stages.find(row => row.stage === 'rack')
    const channel = stages.find(row => row.stage === 'channel')
    if (!rack || !channel) {
      exclude(stages.some(row => row.stage === 'other') ? 'Etapa sin reconocer' : 'Combinación ambigua')
      continue
    }
    if (!rack.sku || rack.sku !== channel.sku) {
      exclude('Productos distintos o ausentes')
      continue
    }
    const [first, second] = flow === 'Entrada' ? [channel, rack] : [rack, channel]
    if (!(first.start <= first.end && first.end <= second.start && second.start <= second.end && first.start < second.end)) {
      exclude('Cronología inválida')
      continue
    }
    if (!masterCodes.has(rack.location)) {
      exclude('Ubicación fuera del maestro')
      continue
    }
    if (rack.unit && channel.unit && rack.unit !== channel.unit) history.mismatchedUnits++
    if (rack.quantity && channel.quantity && rack.quantity !== channel.quantity) history.mismatchedQuantities++
    history.cycles.push({
      queue, flow, sku: rack.sku, location: rack.location, date: new Date(second.end * 1000).toISOString().slice(0, 10),
      cycle: second.end - first.start, rack: rack.end - rack.start, channel: channel.end - channel.start,
      gap: second.start - first.end,
    })
  }
  return history
}
