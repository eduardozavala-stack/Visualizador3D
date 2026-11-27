import { Unzip, UnzipInflate } from 'fflate'
import { read, utils } from '@e965/xlsx'
import { MAX_COLUMNS, MAX_ROWS, parseHistory } from './history'

const MAX_FILE_BYTES = 24 * 1024 * 1024
const MAX_EXPANDED_BYTES = 140 * 1024 * 1024

function validateArchive(bytes: Uint8Array) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('Selecciona un archivo XLSX válido.')
  let expanded = 0
  let entries = 0
  const unzip = new Unzip(file => {
    if (++entries > 500 || file.originalSize !== undefined && expanded + file.originalSize > MAX_EXPANDED_BYTES) {
      throw new Error('El XLSX supera el límite de expansión.')
    }
    const worksheet = /^xl\/worksheets\/[^/]+\.xml$/.test(file.name)
    const decoder = new TextDecoder()
    let remainder = ''
    file.ondata = (error, data, final) => {
      if (error) throw new Error('No se pudo descomprimir el XLSX.')
      expanded += data.length
      if (expanded > MAX_EXPANDED_BYTES) throw new Error('El XLSX supera el límite de expansión.')
      if (!worksheet) return
      const text = remainder + decoder.decode(data, { stream: !final })
      const lastCompleteTag = text.lastIndexOf('>')
      remainder = text.slice(lastCompleteTag + 1)
      if (remainder.length > 65_536) throw new Error('Etiqueta XLSX demasiado extensa.')
      for (const tag of text.slice(0, lastCompleteTag + 1).matchAll(/<(row|c)\s[^>]*?\br\s*=\s*["']([A-Z]*)(\d+)["']/g)) {
        const column = [...tag[2]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0)
        if (Number(tag[3]) > MAX_ROWS + 1 || column > MAX_COLUMNS) throw new Error('El XLSX supera el límite de filas o columnas.')
      }
    }
    file.start()
  })
  unzip.register(UnzipInflate)
  for (let index = 0; index < bytes.length; index += 16_384) {
    unzip.push(bytes.subarray(index, index + 16_384), index + 16_384 >= bytes.length)
  }
}

self.onmessage = async ({ data }: MessageEvent<{ file: File; codes: string[] }>) => {
  try {
    const { file, codes } = data
    if (!/\.xlsx$/i.test(file.name) || file.size > MAX_FILE_BYTES) throw new Error('Selecciona un archivo XLSX de hasta 24 MB.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    validateArchive(bytes)
    let sheet
    try {
      const workbook = read(bytes, { type: 'array', sheets: 'Data', dense: true, cellDates: true, cellFormula: false, cellHTML: false })
      const source = workbook.Sheets.Data
      if (!source) throw new Error('Falta la hoja Data.')
      const range = source['!ref'] && utils.decode_range(source['!ref'])
      if (!range || range.e.r > MAX_ROWS || range.e.c >= MAX_COLUMNS) throw new Error('Dimensiones inválidas.')
      sheet = utils.sheet_to_json<(string | number | boolean | Date | null)[]>(source, {
        header: 1, raw: true, UTC: true, defval: null, range: { s: { r: 0, c: 0 }, e: range.e },
      })
    } catch {
      throw new Error('No se pudo leer la hoja Data del XLSX.')
    }
    const history = parseHistory(sheet, new Set(codes))
    self.postMessage({ history })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'No se pudo procesar el historial EWM.' })
  }
}
