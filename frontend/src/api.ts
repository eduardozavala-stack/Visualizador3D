import type { Snapshot } from './types'

export async function fetchSnapshot(): Promise<Snapshot> {
  const response = await fetch('/api/warehouse/latest', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('No se pudo cargar la última ocupación.')
  return response.json()
}
