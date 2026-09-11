import type { Snapshot } from './types'

export interface WarehouseStatus {
  ready: boolean
  demo: boolean
  uploadsEnabled: boolean
  metadata?: Snapshot['metadata']
  kpis?: Snapshot['kpis']
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(`${fallback} El servidor no devolvió contenido. Reintenta en unos segundos.`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${fallback} La respuesta del servidor llegó incompleta. Reintenta la operación.`)
  }
}

async function parseError(response: Response, fallback: string): Promise<never> {
  const text = await response.text()
  if (text.trim()) {
    try {
      const body = JSON.parse(text)
      throw new Error(body?.detail || fallback)
    } catch (error) {
      if (error instanceof Error && error.message !== 'Unexpected end of JSON input') throw error
    }
  }
  throw new Error(`${fallback} Código HTTP ${response.status}.`)
}

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch('/api/warehouse/latest', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) return parseError(response, 'No se pudo cargar la última ocupación.')
  return readJson<Snapshot>(response, 'No se pudo cargar la última ocupación.')
}

export async function fetchWarehouseStatus(): Promise<WarehouseStatus> {
  const response = await fetch('/api/warehouse/status', { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) return parseError(response, 'No se pudo consultar el estado del almacén.')
  return readJson<WarehouseStatus>(response, 'No se pudo consultar el estado del almacén.')
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
  // Consumimos la respuesta para detectar respuestas truncadas del servidor.
  await readJson<{ok: boolean}>(response, 'El archivo se procesó, pero no se pudo confirmar la respuesta.')
}

export async function uploadMaster(file: File): Promise<void> {
  return uploadExcel('/api/admin/upload/master', file)
}

export async function uploadOccupancy(file: File): Promise<void> {
  return uploadExcel('/api/admin/upload/occupancy', file)
}

