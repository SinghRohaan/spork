import { Check, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSetWater, useWater, useWaterSettings } from '../hooks/useWater'
import { GLASS_SIZES, WATER_GOALS, formatLitres, mlAfterGlassTap, waterGlasses } from '../lib/water'
import { hapticLight } from '../lib/haptics'
import { WheelPicker } from './WheelPicker'
import { useToast } from './Toast'

const GLASS_PATH = 'M3 3h21l-2.2 26.2a2.6 2.6 0 0 1-2.6 2.4H7.8a2.6 2.6 0 0 1-2.6-2.4z'

/** One glass: full (water + wave), next (dashed with a +) or empty. */
function Glass({ state, id }: { state: 'full' | 'next' | 'empty'; id: string }) {
  return (
    <svg width="27" height="34" viewBox="0 0 27 34" aria-hidden="true">
      {state === 'full' && (
        <>
          <defs><clipPath id={id}><path d={GLASS_PATH} /></clipPath></defs>
          <g clipPath={`url(#${id})`}>
            <rect width="27" height="34" fill="var(--water-deep)" />
            <path d="M0 11 C4.5 9 9 13 13.5 11 S22.5 9 27 11 V34 H0z" fill="var(--water)" />
            <path d="M6 15v10" stroke="var(--water-shine)" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
          </g>
        </>
      )}
      <path d={GLASS_PATH} fill="none" strokeWidth="1.7" strokeLinejoin="round"
        stroke={state === 'full' ? 'var(--water-rim)' : state === 'next' ? 'var(--color-quiet)' : 'var(--color-soft2)'}
        strokeDasharray={state === 'next' ? '3 2.4' : undefined} />
      {state === 'next' && <path d="M13.5 13v8M9.5 17h8" stroke="var(--color-quiet)" strokeWidth="1.7" strokeLinecap="round" />}
    </svg>
  )
}

/** Home: today's water — tap a glass or + to add, − to undo. Hidden until the 0016 migration has run. */
export function WaterCard() {
  const { ml, goalMl, glassMl } = useWater()
  const setWater = useSetWater()
  const { toast } = useToast()
  const [showSettings, setShowSettings] = useState(false)
  if (ml == null) return null

  const { slots, filled } = waterGlasses(ml, goalMl, glassMl)
  const save = (next: number) => {
    hapticLight()
    setWater.mutate(Math.min(10000, Math.max(0, next)), { onError: () => toast('Couldn’t save water — try again', 'error') })
  }

  return (
    <div className="card water-card" style={{ marginTop: 0 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="water-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
              <path d="M12 3.5s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="caps">Water</span>
              <span className="tiny muted">· {filled} of {slots} glasses</span>
            </span>
            <span className="block font-display" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.15 }} aria-live="polite">
              {formatLitres(ml)} <small className="muted" style={{ font: '13px var(--font-sans)' }}>/ {formatLitres(goalMl)} L</small>
            </span>
          </span>
        </div>
        <span className="flex flex-none items-center gap-2">
          <button type="button" className="circle sm water-minus" aria-label={`Remove ${glassMl} ml`} disabled={ml === 0} onClick={() => save(ml - glassMl)}>−</button>
          <button type="button" className="circle sm water-plus" aria-label={`Add ${glassMl} ml`} onClick={() => save(ml + glassMl)}>+</button>
        </span>
      </div>

      <div className="water-glasses" role="group" aria-label="Glasses of water">
        {Array.from({ length: slots }, (_, i) => (
          <button key={i} type="button" className="no-press" onClick={() => save(mlAfterGlassTap(i, ml, goalMl, glassMl))}
            aria-label={i < filled ? `Glass ${i + 1}, full` : `Fill to glass ${i + 1}`}>
            <Glass id={`water-glass-${i}`} state={i < filled ? 'full' : i === filled ? 'next' : 'empty'} />
          </button>
        ))}
      </div>

      <div className="water-foot">
        {ml >= goalMl
          ? <span className="water-chip done"><Check size={15} strokeWidth={2.6} aria-hidden="true" />Goal reached</span>
          : <span className="tiny muted">Tap a glass or + to add {glassMl} ml</span>}
        <button type="button" onClick={() => setShowSettings(true)} className="water-chip">
          <SlidersHorizontal size={15} aria-hidden="true" />Goal &amp; glass
        </button>
      </div>

      {showSettings && <WaterSettings goalMl={goalMl} glassMl={glassMl} onClose={() => setShowSettings(false)} />}
    </div>
  )
}

function WaterSettings({ goalMl, glassMl, onClose }: { goalMl: number; glassMl: number; onClose: () => void }) {
  const saveSettings = useWaterSettings()
  const { toast } = useToast()
  const [glass, setGlass] = useState(glassMl)
  const [goal, setGoal] = useState(WATER_GOALS.includes(goalMl) ? goalMl : 2500)

  async function save() {
    try {
      await saveSettings.mutateAsync({ water_goal_ml: goal, water_glass_ml: glass })
      toast('Saved ✓')
      onClose()
    } catch {
      toast('Couldn’t save — try again', 'error')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-end bg-black/70 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-[430px] rounded-t-[36px] bg-canvas px-5 pb-8 pt-4 animate-slide-up" role="dialog" aria-label="Water settings">
        <div className="topbar" style={{ marginBottom: 6 }}>
          <span style={{ width: 42 }} />
          <span className="clay">Water settings</span>
          <button type="button" onClick={onClose} className="circle" aria-label="Close">✕</button>
        </div>
        <p className="caps" style={{ marginTop: 6 }}>One glass is</p>
        <div className="seg" role="group" aria-label="Glass size" style={{ margin: '8px 0 0' }}>
          {GLASS_SIZES.map((size) => (
            <button key={size} type="button" className={glass === size ? 'on' : ''} aria-pressed={glass === size} onClick={() => setGlass(size)}
              style={{ flex: 1 }}>{size} ml</button>
          ))}
        </div>
        <p className="caps" style={{ marginTop: 20 }}>Daily goal</p>
        <div className="flex justify-center" style={{ margin: '6px 0 4px' }}>
          <div style={{ width: 170 }}><WheelPicker label="Daily water goal" values={WATER_GOALS} value={goal} onChange={setGoal} format={(v) => `${formatLitres(v)} L`} /></div>
        </div>
        <p className="small muted text-center">Most adults need about 2–3 L a day, more on hot days or when you work out.</p>
        <button type="button" className="btn" disabled={saveSettings.isPending} onClick={save}>{saveSettings.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </div>,
    document.body,
  )
}
