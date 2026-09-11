import type { Snapshot } from './types'

export interface WarehouseStatus {
  ready: boolean
  demo: boolean
  uploadsEnabled: boolean
  metadata?: Snapshot['metadata']
  kpis?: Snapshot['kpis']
}

async function parseError(response: Response, fallback: string): Promise<never> {
  try {
    const body = await response.json()
    throw new Error(body?.detail || fallback)
  } catch (error) {
    if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error
    throw new Error(fallback)
  }
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch('/api/warehouse/latest', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) return parseError(response, 'No se pudo cargar la última ocupación.')
  return response.json()
}

export async function fetchWarehouseStatus(): Promise<WarehouseStatus> {
  const response = await fetch('/api/warehouse/status', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) return parseError(response, 'No se pudo consultar el estado del almacén.')
  return response.json()
}

async function uploadExcel(url: string, file: File): Promise<void> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(url, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  if (!response.ok) return parseError(response, 'No se pudo procesar el archivo.')
}

export async function uploadMaster(file: File): Promise<void> {
  return uploadExcel('/api/admin/upload/master', file)
}

export async function uploadOccupancy(file: File): Promise<void> {
  return uploadExcel('/api/admin/upload/occupancy', file)
}
