import { useEffect, useRef, useState } from 'react'
import { TopBar } from '../../components/TopBar'
import { getBarcodeDetector, detectInImage } from '../../lib/barcodeDetector'
import { extractGtin, lookupBarcode } from '../../lib/packagedFood'
import type { EstimateResult } from '../../store/logDraft'

interface Props {
  onBack: () => void
  /** Barcode matched a product with nutrition → straight to the review screen. */
  onProduct: (estimate: EstimateResult) => void
  /** No usable barcode data → let the AI read the photographed pack/label. */
  onReadLabel: (photo: File, productHint?: string) => void
}

type Status =
  | { kind: 'scanning' }
  | { kind: 'looking-up'; code: string }
  | { kind: 'not-in-database'; code: string; name?: string }
  | { kind: 'not-a-product' }
  | { kind: 'not-food'; name: string }
  | { kind: 'lookup-failed'; code: string }

/**
 * Packaged food: live barcode scan (EAN/UPC, or a GS1 QR) → Open Food Facts.
 * Anything that doesn't end in real numbers falls back to one photo of the
 * pack or its nutrition table, which the AI reads (and we also try to find a
 * barcode in that photo first).
 */
export default function PackagedScanner({ onBack, onProduct, onReadLabel }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const photoRef   = useRef<HTMLInputElement>(null)
  const handledRef = useRef(false)

  const [status, setStatus]       = useState<Status>({ kind: 'scanning' })
  const [cameraOk, setCameraOk]   = useState<boolean | null>(null)
  const [manual, setManual]       = useState('')
  const [readingPhoto, setReadingPhoto] = useState(false)
  const productHint = status.kind === 'not-in-database' ? status.name : undefined

  async function handleCode(raw: string) {
    if (handledRef.current) return
    const gtin = extractGtin(raw)
    if (!gtin) { setStatus({ kind: 'not-a-product' }); return }
    handledRef.current = true
    setStatus({ kind: 'looking-up', code: gtin })
    const result = await lookupBarcode(gtin)
    if (result.kind === 'found') { onProduct(result.estimate); return }
    handledRef.current = false
    if (result.kind === 'not-food') setStatus({ kind: 'not-food', name: result.name })
    else if (result.kind === 'error') setStatus({ kind: 'lookup-failed', code: gtin })
    else setStatus({ kind: 'not-in-database', code: gtin, name: result.kind === 'no-nutrition' ? result.name : undefined })
  }

  // Live camera + detection loop.
  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setCameraOk(true)
        const detector = await getBarcodeDetector()
        const tick = async () => {
          if (cancelled) return
          if (!handledRef.current && video.readyState >= 2) {
            try {
              const [code] = await detector.detect(video)
              if (code && !cancelled) await handleCode(code.rawValue)
            } catch { /* frame not ready — try again */ }
          }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch {
        if (!cancelled) setCameraOk(false)
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReadingPhoto(true)
    // A barcode in the photo beats reading the label — try that first.
    const code = await detectInImage(file)
    const gtin = code ? extractGtin(code.rawValue) : null
    if (gtin && gtin !== (status.kind === 'not-in-database' ? status.code : '')) {
      const result = await lookupBarcode(gtin)
      if (result.kind === 'found') { onProduct(result.estimate); return }
      if (result.kind === 'not-food') { setReadingPhoto(false); setStatus({ kind: 'not-food', name: result.name }); return }
      onReadLabel(file, result.kind === 'no-nutrition' ? result.name : productHint)
      return
    }
    onReadLabel(file, productHint)
  }

  const message = (() => {
    switch (status.kind) {
      case 'scanning':        return cameraOk === false ? null : 'Point at the barcode on the pack'
      case 'looking-up':      return `Found ${status.code} · looking it up…`
      case 'not-in-database': return status.name
        ? `${status.name} has no nutrition info in the database yet. Snap the nutrition table and we’ll read it.`
        : 'This product isn’t in the food database yet. Snap the nutrition table or the front of the pack.'
      case 'not-a-product':   return 'That code isn’t a product barcode. Try the barcode on the back, or snap the label.'
      case 'not-food':        return `${status.name} isn’t food. Spork only logs things you eat or drink.`
      case 'lookup-failed':   return 'Couldn’t reach the food database. Check your connection, or snap the label instead.'
    }
  })()

  const needsPhoto = status.kind === 'not-in-database' || status.kind === 'lookup-failed' || cameraOk === false

  return (
    <div className="animate-fade-in">
      <TopBar title="Packaged food" back={null} right={
        <button type="button" onClick={onBack} className="circle" aria-label="Close">✕</button>
      } />

      {cameraOk !== false && (
        <div className="scanner">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
          <div className="scanner-frame" aria-hidden="true" />
          {cameraOk === null && <span className="scanner-note">Starting camera…</span>}
        </div>
      )}

      {cameraOk === false && (
        <div className="card tint">
          <b className="block">Camera unavailable</b>
          <p className="small muted" style={{ marginTop: 4 }}>
            Allow camera access in your browser settings, or use a photo below.
          </p>
        </div>
      )}

      {message && <p className={`small ${status.kind === 'scanning' ? 'muted' : status.kind === 'not-food' ? 'text-error' : ''} text-center`} style={{ margin: '14px 0' }}>{message}</p>}

      <button type="button" onClick={() => photoRef.current?.click()} disabled={readingPhoto}
        className={needsPhoto ? 'btn' : 'btn light'}>
        {readingPhoto ? 'Reading photo…' : needsPhoto ? 'Snap the label or pack →' : 'No barcode? Snap the label or pack'}
      </button>
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handlePhoto} />

      <form className="flex items-center gap-2" style={{ marginTop: 14 }}
        onSubmit={(e) => { e.preventDefault(); if (manual.trim()) handleCode(manual.trim()) }}>
        <input value={manual} onChange={(e) => setManual(e.target.value.replace(/[^\d]/g, ''))}
          inputMode="numeric" placeholder="Or type the barcode number" className="input flex-1" aria-label="Barcode number" />
        <button type="submit" disabled={manual.length < 8 || status.kind === 'looking-up'} className="pill sel" style={{ padding: '12px 16px' }}>
          Look up
        </button>
      </form>

      <p className="tiny muted" style={{ marginTop: 14 }}>
        Barcodes are matched against Open Food Facts, a free open food database. Labels and packs are read by AI.
      </p>
    </div>
  )
}
