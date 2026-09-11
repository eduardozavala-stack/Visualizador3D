export type LocationStatus = 'LIBRE' | 'OCUPADA' | 'PARCIAL' | 'BLOQUEADA' | 'NO_DISPONIBLE'

export interface StockItem {
  product: string | null
  description: string | null
  lot: string | null
  expiryDate: string | null
  stockType: string | null
  packedQty: number | null
  altUnit: string | null
  handlingUnit: string | null
  quantity: number | null
  entryDate: string | null
  entryTime: string | null
  weight: number | null
}

export interface WarehouseLocation {
  code: string
  prefix: string
  storageType: string | null
  storageArea: string | null
  locationType: string | null
  aisle: number
  position: number
  module: number
  level: number
  side: string
  x: number
  y: number
  z: number
  blockedIn: boolean
  blockedOut: boolean
  status: LocationStatus
  stockCount: number
  products: string[]
  descriptions: string[]
  lots: string[]
  stockTypes: string[]
  quantityTotal: number
  weightTotal: number
  oldestEntryDate: string | null
  ageDays: number | null
  nextExpiryDate: string | null
  stock: StockItem[]
}

export interface Snapshot {
  metadata: {
    generatedAt: string
    dataDate?: string
    masterFile: string
    occupancyFile: string
    demoAnonymized?: boolean
    note?: string
  }
  kpis: {
    totalLocations: number
    eligibleLocations: number
    occupiedLocations: number
    freeLocations: number
    blockedLocations: number
    unavailableLocations?: number
    occupancyPct: number
    stockRows: number
    uniqueProducts: number
  }
  validation?: Record<string, unknown>
  options: {
    storageTypes: string[]
    storageAreas: string[]
    aisles: number[]
    levels: number[]
    prefixes: string[]
    stockTypes: string[]
  }
  locations: WarehouseLocation[]
}
