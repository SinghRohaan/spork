/**
 * One barcode reader for every platform. Android Chrome ships a native
 * BarcodeDetector; iOS Safari doesn't, so we fall back to the ZXing
 * WebAssembly ponyfill. Its ~1 MB .wasm is self-hosted (no third-party CDN)
 * and only downloaded the first time someone opens the scanner.
 */
export const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'] as const

export interface DetectedCode { rawValue: string; format: string }
export interface Detector { detect(source: ImageBitmapSource | HTMLVideoElement): Promise<DetectedCode[]> }

type NativeCtor = {
  new (opts: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

let detectorPromise: Promise<Detector> | null = null

export function getBarcodeDetector(): Promise<Detector> {
  detectorPromise ??= create().catch((err) => {
    detectorPromise = null   // allow a retry after a failed load
    throw err
  })
  return detectorPromise
}

async function create(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeCtor }).BarcodeDetector
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats()
      const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f))
      if (formats.includes('ean_13')) return new Native({ formats })
    } catch { /* fall through to the ponyfill */ }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
  })
  return new BarcodeDetector({ formats: [...PRODUCT_FORMATS] }) as unknown as Detector
}

/** Reads the first product code in a still photo, or null. Never throws. */
export async function detectInImage(file: Blob): Promise<DetectedCode | null> {
  try {
    const detector = await getBarcodeDetector()
    const bitmap = await createImageBitmap(file)
    try {
      const codes = await detector.detect(bitmap)
      return codes[0] ?? null
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}
