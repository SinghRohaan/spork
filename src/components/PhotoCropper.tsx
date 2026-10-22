import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { Check, RotateCcw, RotateCw, X } from 'lucide-react'

const ASPECTS = [
  { label: '1:1', value: 1 },
  { label: '4:5', value: 4 / 5 },
  { label: 'Original', value: 0 },
] as const

/** Draws the chosen area (after rotation) onto a canvas and returns it as a JPEG file. */
export async function cropToFile(src: string, area: Area, rotation: number, name: string): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not read the photo'))
    i.src = src
  })
  const rad = (rotation * Math.PI) / 180
  const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad))
  // The rotated photo's bounding box — react-easy-crop measures the crop area in it.
  const bw = img.naturalWidth * cos + img.naturalHeight * sin
  const bh = img.naturalWidth * sin + img.naturalHeight * cos
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(area.width)
  canvas.height = Math.round(area.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.translate(-area.x, -area.y)
  ctx.translate(bw / 2, bh / 2)
  ctx.rotate(rad)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the photo'))), 'image/jpeg', 0.92))
  return new File([blob], name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}

/**
 * Full-screen crop step after picking a meal photo (Hevy-style): pinch or drag
 * to frame, choose a shape, rotate in 90° steps. "✕" keeps the photo as it was.
 */
export function PhotoCropper({ file, onDone, onCancel }: { file: File; onDone: (file: File) => void; onCancel: () => void }) {
  // Created and revoked in the same effect, so it stays valid for as long as the cropper is open.
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const [natural, setNatural] = useState(1)
  const [aspectIndex, setAspectIndex] = useState(0)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [area, setArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)

  // "Original" follows the photo's own shape, swapped when it's turned sideways.
  const aspect = ASPECTS[aspectIndex].value || (rotation % 180 ? 1 / natural : natural)

  function reset() {
    setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0)
  }

  async function done() {
    if (!src || !area || saving) return
    setSaving(true)
    try {
      onDone(await cropToFile(src, area, rotation, file.name || 'meal.jpg'))
    } catch {
      onDone(file) // never lose the photo over a crop hiccup
    }
  }

  return createPortal(
    <div className="cropper animate-fade-in" role="dialog" aria-label="Crop photo">
      <div className="cropper-top">
        <button type="button" className="circle" onClick={onCancel} aria-label="Keep the photo as it is"><X size={20} /></button>
        <span className="clay" style={{ color: '#fff' }}>Crop</span>
        <button type="button" className="circle cropper-done" onClick={done} disabled={!src || !area || saving} aria-label="Use this crop"><Check size={22} strokeWidth={2.6} /></button>
      </div>

      <div className="cropper-area">
        {src && <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={aspect}
          minZoom={1}
          maxZoom={4}
          showGrid
          objectFit="contain"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, px) => setArea(px)}
          onMediaLoaded={(m) => setNatural(m.naturalWidth / m.naturalHeight || 1)}
        />}
      </div>

      <div className="cropper-tools">
        <div className="flex items-center gap-3">
          <button type="button" className="cropper-icon" onClick={() => setRotation((r) => (r + 270) % 360)} aria-label="Rotate left"><RotateCcw size={20} /></button>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="cropper-zoom" />
          <button type="button" className="cropper-icon" onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate right"><RotateCw size={20} /></button>
        </div>
        <div className="flex items-center justify-center gap-2" style={{ marginTop: 14 }}>
          {ASPECTS.map((a, i) => (
            <button key={a.label} type="button" onClick={() => setAspectIndex(i)} className={`cropper-chip ${i === aspectIndex ? 'on' : ''}`}>{a.label}</button>
          ))}
          <button type="button" onClick={reset} className="cropper-chip">Reset</button>
        </div>
        <p className="tiny text-center" style={{ color: 'rgba(255,255,255,0.55)', marginTop: 10 }}>Pinch or drag to frame your meal</p>
      </div>
    </div>,
    document.body,
  )
}
