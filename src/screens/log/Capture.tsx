import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useLogDraftStore } from '../../store/logDraft'
import { useTodayStats } from '../../hooks/useTodayStats'
import { TopBar } from '../../components/TopBar'
import DailyProgress from './DailyProgress'
import { SporkOrb } from '../../components/brand/SporkOrb'
import type { PastMeal } from '../../lib/logAgain'

const PhotoCropper = lazy(() => import('../../components/PhotoCropper').then((m) => ({ default: m.PhotoCropper })))

interface CaptureProps {
  onGetEstimate: () => void
  onSkipPhoto: () => void
  onRepeat?: () => void
  recentMealName?: string
  onScanPackaged?: () => void
  /** Most-logged meals for the "Log again" row. */
  usualMeals?: { meal: PastMeal; photo: string | null }[]
  onLogAgain?: (meal: PastMeal) => void
}

export default function Capture({ onGetEstimate, onSkipPhoto, onRepeat, recentMealName, onScanPackaged, usualMeals, onLogAgain }: CaptureProps) {
  const { photoFile, description, setPhoto, setDescription } = useLogDraftStore()
  const { data: stats, isError, refetch } = useTodayStats()

  // Two separate file inputs: one forces camera, one opens gallery
  const cameraInputRef  = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const previewUrl = useMemo(() => photoFile ? URL.createObjectURL(photoFile) : null, [photoFile])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  // A new photo goes through the crop step first ("✕" keeps it uncropped).
  const [cropping, setCropping] = useState<File | null>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setCropping(file)
    // Reset so the same file can be re-selected if needed
    event.target.value = ''
  }

  return (
    <div>
      <TopBar title="Log a meal" back="/home/feed" />
      <p className="muted small">Photo or manual entry · Always editable</p>

      {stats && <DailyProgress stats={stats} />}
      {isError && (
        <button type="button" onClick={() => refetch()} className="small muted block" style={{ margin: '12px 0' }}>
          Today’s progress couldn’t load · Tap to retry
        </button>
      )}

      {/* ── Log again: one tap re-opens a usual meal on the review screen ── */}
      {!photoFile && onLogAgain && usualMeals && usualMeals.length > 0 && (
        <section style={{ margin: '16px 0 14px' }}>
          <div className="flex items-center justify-between">
            <span className="caps">Log again</span>
            <span className="tiny muted">Your usual meals</span>
          </div>
          <div className="scroll-hide -mx-5 flex gap-2.5 overflow-x-auto px-5" style={{ marginTop: 10, paddingBottom: 2 }}>
            {usualMeals.map(({ meal, photo }) => (
              <button key={meal.id} type="button" onClick={() => onLogAgain(meal)} className="logagain-card no-press"
                aria-label={`Log ${meal.name} again`}>
                <span className="logagain-thumb">
                  {photo ? <img src={photo} alt="" /> : <SporkOrb size={30} />}
                  <i aria-hidden="true">+</i>
                </span>
                <b className="block truncate">{meal.name}</b>
                <small className="muted block truncate">
                  {Math.round(meal.calories_final ?? meal.calories_estimate ?? 0)} kcal · {Math.round(meal.protein_final_g ?? meal.protein_estimate_g ?? 0)} g P
                </small>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Photo area ──────────────────────────────────────────── */}
      {previewUrl ? (
        <div className="relative">
          <img src={previewUrl} alt="Meal preview" className="photo natural" />
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
            <button type="button" onClick={() => cameraInputRef.current?.click()} className="pill photo-pill">Retake</button>
            <button type="button" onClick={() => galleryInputRef.current?.click()} className="pill photo-pill">Change</button>
            <button type="button" onClick={() => photoFile && setCropping(photoFile)} className="pill photo-pill">Crop</button>
          </div>
        </div>
      ) : (
        <div className="photo-placeholder scan-box">
          <span className="scan-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 8V6a2.5 2.5 0 0 1 2.5-2.5h2M16 3.5h2A2.5 2.5 0 0 1 20.5 6v2M20.5 16v2a2.5 2.5 0 0 1-2.5 2.5h-2M8 20.5H6A2.5 2.5 0 0 1 3.5 18v-2" />
              <circle cx="12" cy="12" r="3.6" />
              <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span>
            <h3>Add a meal photo</h3>
            <p className="small muted" style={{ marginTop: 4 }}>AI estimates the calories in seconds</p>
          </span>
          <div className="scan-actions">
            <button type="button" onClick={() => cameraInputRef.current?.click()} className="pill sel">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" /><circle cx="12" cy="12.5" r="3.2" />
              </svg>
              Camera
            </button>
            <button type="button" onClick={() => galleryInputRef.current?.click()} className="pill">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="m20.5 16-4.5-4.5L6 19.5" />
              </svg>
              Gallery
            </button>
          </div>
          <p className="tiny muted">or enter it manually below</p>
        </div>
      )}

      {/* ── Packaged food: barcode or label ─────────────────────── */}
      {onScanPackaged && (
        <button type="button" onClick={onScanPackaged} className="card block w-full text-left" style={{ marginTop: 10 }}>
          <span className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <path d="M7 8v8M10 8v8M13 8v8M17 8v8" />
            </svg>
            <span>
              <b className="block font-semibold">Packaged food</b>
              <span className="small muted">Scan the barcode, or snap the label · exact numbers</span>
            </span>
          </span>
        </button>
      )}

      {/* Hidden inputs — camera forces live capture, gallery opens picker */}
      {cropping && (
        <Suspense fallback={null}>
          <PhotoCropper file={cropping} onDone={(f) => { setPhoto(f); setCropping(null) }} onCancel={() => { setPhoto(cropping); setCropping(null) }} />
        </Suspense>
      )}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} />
      <input ref={galleryInputRef} type="file" accept="image/*" className="sr-only" onChange={handleFileChange} />

      {/* ── Optional description ────────────────────────────────── */}
      <label className="card block">
        {photoFile ? (
          <>
            <p>Add ingredients or quantities · optional</p>
            <p className="small muted">Help the estimate with more detail</p>
          </>
        ) : (
          <>
            <p>No photo? Type what you ate</p>
            <p className="small muted">We’ll estimate it · add amounts for better numbers</p>
          </>
        )}
        <input
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder={photoFile ? 'e.g. 200g chicken, 1 cup rice' : 'e.g. 2 rotis, 1 katori dal, curd'}
          className="input bg-soft"
          style={{ marginTop: 12 }}
        />
      </label>

      <p className="tiny muted">
        Photos and ingredient notes are sent for AI estimation · You choose visibility before saving
      </p>

      {/* ── Actions ─────────────────────────────────────────────── */}
      <button type="button" disabled={!photoFile && description.trim().length < 3} onClick={onGetEstimate} className="btn">
        {photoFile || !description.trim() ? 'Estimate nutrition' : 'Estimate from description'}
      </button>
      <button type="button" onClick={onSkipPhoto} className="btn light">
        Enter manually
      </button>
      {onRepeat && (
        <button type="button" onClick={onRepeat} className="card block w-full text-left">
          Repeat recent meal
          <span className="small muted block" style={{ marginTop: 4 }}>{recentMealName || 'Recent meal'} · review before saving</span>
        </button>
      )}
    </div>
  )
}
