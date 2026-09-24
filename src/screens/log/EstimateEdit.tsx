import { useEffect, useMemo, useRef, useState } from 'react'
import { useLogDraftStore, type MealType, type Satiety } from '../../store/logDraft'
import { useTodayStats } from '../../hooks/useTodayStats'
import { formatItemQuantity, type ParsedEstimateItem } from '../../lib/parseEstimate'
import type { ConfirmedItem } from '../../lib/estimateMeal'

const MEAL_TYPE_OPTIONS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch',     label: 'Lunch' },
  { value: 'dinner',    label: 'Dinner' },
  { value: 'snack',     label: 'Snack' },
]

const PORTION_OPTIONS: { value: number; label: string }[] = [
  { value: 0.5, label: '½' },
  { value: 1,   label: '1×' },
  { value: 1.5, label: '1.5×' },
  { value: 2,   label: '2×' },
]

const SATIETY_OPTIONS: { value: Satiety; label: string }[] = [
  { value: 'loved_it',  label: 'Loved it' },
  { value: 'good',      label: 'Good' },
  { value: 'okay',      label: 'Okay' },
  { value: 'not_great', label: 'Not great' },
]

const CONFIDENCE_LABELS = {
  high:   'High confidence',
  medium: 'Medium confidence',
  low:    'Low confidence',
}

interface EstimateEditProps {
  onBack: () => void
  onPost: () => void
  posting: boolean
  postError: string | null
  /** Present when there's a photo to re-analyse. Resolves false if the AI call failed. */
  onReestimate?: (items: ConfirmedItem[]) => Promise<boolean>
}

export default function EstimateEdit({ onBack, onPost, posting, postError, onReestimate }: EstimateEditProps) {
  const photoFile   = useLogDraftStore((s) => s.photoFile)
  const mealName    = useLogDraftStore((s) => s.mealName)
  const caption     = useLogDraftStore((s) => s.caption)
  const calories    = useLogDraftStore((s) => s.calories)
  const proteinG    = useLogDraftStore((s) => s.proteinG)
  const carbsG      = useLogDraftStore((s) => s.carbsG)
  const fatG        = useLogDraftStore((s) => s.fatG)
  const mealType    = useLogDraftStore((s) => s.mealType)
  const visibility  = useLogDraftStore((s) => s.visibility)
  const satiety     = useLogDraftStore((s) => s.satiety)
  const estimate    = useLogDraftStore((s) => s.estimate)
  const portionMultiplier = useLogDraftStore((s) => s.portionMultiplier)

  const setMealName    = useLogDraftStore((s) => s.setMealName)
  const setCaption     = useLogDraftStore((s) => s.setCaption)
  const setField       = useLogDraftStore((s) => s.setField)
  const setMealType    = useLogDraftStore((s) => s.setMealType)
  const setVisibility  = useLogDraftStore((s) => s.setVisibility)
  const setSatiety     = useLogDraftStore((s) => s.setSatiety)
  const setPortionMultiplier = useLogDraftStore((s) => s.setPortionMultiplier)
  const setPhoto       = useLogDraftStore((s) => s.setPhoto)
  const photoInputRef  = useRef<HTMLInputElement>(null)

  const { data: stats } = useTodayStats()

  const [showItemBreakdown, setShowItemBreakdown] = useState(true)

  const previewUrl = useMemo(() => (photoFile ? URL.createObjectURL(photoFile) : null), [photoFile])
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const confidenceLabel = estimate?.parsed.confidence ? CONFIDENCE_LABELS[estimate.parsed.confidence] : null
  const kcalAfterThisMeal = (stats?.caloriesLogged ?? 0) + (calories ?? 0)
  const goal = stats?.calorieGoal ?? 0
  const willExceedGoal = goal > 0 && kcalAfterThisMeal > goal
  const items = useLogDraftStore((s) => s.items)
  const assumptions = estimate?.parsed.assumptions ?? []
  const fromBarcode = (estimate?.raw as { source?: string } | undefined)?.source === 'barcode'

  return (
    <div>
      {/* Top bar */}
      <div className="topbar">
        <button type="button" onClick={onBack} aria-label="Back" className="circle">←</button>
        <span className="clay">{estimate ? 'Review meal' : 'Add details'}</span>
        <span style={{ width: 42 }} />
      </div>

      {/* Photo preview */}
      {previewUrl && <img src={previewUrl} alt="" className="photo natural" style={{ maxHeight: 260 }} />}

      {/* Barcode logs start without a photo — let the user add one of the pack */}
      {fromBarcode && (
        <>
          {previewUrl ? (
            <button type="button" onClick={() => photoInputRef.current?.click()} className="small font-semibold" style={{ margin: '8px 0 4px' }}>
              Change photo
            </button>
          ) : (
            <button type="button" onClick={() => photoInputRef.current?.click()} className="card w-full text-left">
              <b className="block font-semibold">📷 Add a photo · optional</b>
              <small className="muted">Snap the bar, pack or drink for your post</small>
            </button>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="sr-only"
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) setPhoto(file) }} />
        </>
      )}

      {/* Estimate summary */}
      <div className="card tint">
        <div className="flex items-center justify-between">
          <span>
            <span className="caps">{estimate ? 'Estimated calories' : 'Calories'}</span>
            <h3>{calories != null ? `${calories.toLocaleString()} kcal` : '—'}</h3>
          </span>
          <span className="pill">{confidenceLabel ?? 'Editable'}</span>
        </div>
        <div className="divider" />
        <div className="flex items-center justify-between small">
          <span>Protein <b className="protein-total">{proteinG ?? '—'}g</b></span>
          <span>Carbs <b>{carbsG ?? '—'}g</b></span>
          <span>Fat <b>{fatG ?? '—'}g</b></span>
        </div>
        {stats && goal > 0 && (
          <p className={`tiny ${willExceedGoal ? 'text-error' : 'muted'}`} style={{ marginTop: 10 }}>
            {willExceedGoal
              ? `${(kcalAfterThisMeal - goal).toLocaleString()} kcal over today’s goal`
              : `${(goal - kcalAfterThisMeal).toLocaleString()} kcal left today after this meal`}
          </p>
        )}
      </div>

      {/* AI item breakdown — tap an item to correct it */}
      {(items.length > 0 || (estimate && onReestimate)) && (
        <div className="card" style={{ marginTop: 0 }}>
          <button type="button" onClick={() => setShowItemBreakdown((v) => !v)} className="flex w-full items-center justify-between gap-3 text-left">
            <span className="min-w-0">
              <b className="block font-semibold">
                {fromBarcode ? 'From the barcode' : `AI detected ${items.length} item${items.length === 1 ? '' : 's'}`}
              </b>
              <small className="muted block truncate">
                {items.length ? 'Tap an item to fix the dish or amount' : 'Add what’s on the plate'}
              </small>
            </span>
            <span className="muted">{showItemBreakdown ? '▴' : '▾'}</span>
          </button>
          {showItemBreakdown && (
            <ItemBreakdown items={items} assumptions={assumptions} onReestimate={onReestimate} fromBarcode={fromBarcode} />
          )}
        </div>
      )}

      {/* Editable macro fields */}
      <div className="inline-fields">
        {([
          { key: 'calories' as const, label: 'Calories (kcal)', val: calories },
          { key: 'proteinG' as const, label: 'Protein · g',     val: proteinG },
          { key: 'carbsG'   as const, label: 'Carbs · g',       val: carbsG },
          { key: 'fatG'     as const, label: 'Fat · g',         val: fatG },
        ] as const).map(({ key, label, val }) => (
          <div key={key} className="field">
            <label htmlFor={`f-${key}`}>{label}</label>
            <input id={`f-${key}`} type="number" min="0" step="1" inputMode="numeric"
              value={val ?? ''}
              onChange={(e) => setField(key, e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        ))}
      </div>

      {/* Meal name */}
      <div className="field">
        <label htmlFor="meal-name">Meal name</label>
        <input id="meal-name" placeholder="e.g. Chicken curry with roti" value={mealName} onChange={(e) => setMealName(e.target.value)} />
      </div>

      {/* Social caption */}
      <div className="field">
        <label htmlFor="caption">Caption · optional</label>
        <input id="caption" placeholder="Add a caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </div>

      {/* Meal type */}
      <div className="section">
        <span className="caps">Meal type</span>
        <div className="num-pills">
          {MEAL_TYPE_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" onClick={() => setMealType(opt.value)}
              className={`num-pill ${mealType === opt.value ? 'sel' : ''}`} aria-pressed={mealType === opt.value}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Portion multiplier */}
      {estimate && (
        <div className="section">
          <span className="caps">Portion</span>
          <div className="num-pills">
            {PORTION_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setPortionMultiplier(opt.value)}
                className={`num-pill ${portionMultiplier === opt.value ? 'sel' : ''}`} aria-pressed={portionMultiplier === opt.value}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* How was it? */}
      <div className="section">
        <span className="caps">How was it? · optional</span>
        <div className="num-pills">
          {SATIETY_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" onClick={() => setSatiety(satiety === opt.value ? null : opt.value)}
              className={`num-pill ${satiety === opt.value ? 'sel' : ''}`} aria-pressed={satiety === opt.value}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Visibility */}
      <div className="card">
        <div className="flex items-center justify-between">
          <span>
            <span className="block">Visible to friends</span>
            <small className="muted">{visibility === 'public' ? 'Appears on the feed' : 'Only you can see this'}</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={visibility === 'public'}
            aria-label="Visible to friends"
            onClick={() => setVisibility(visibility === 'public' ? 'private' : 'public')}
            className={`switch ${visibility === 'public' ? '' : 'off'}`}
          />
        </div>
      </div>

      {postError && <p className="error-text">{postError}</p>}

      {/* Post button */}
      <button type="button" disabled={posting || calories === null} onClick={onPost} className="btn">
        {posting ? 'Posting…' : postError ? 'Retry' : 'Post meal'}
      </button>
    </div>
  )
}

// ── Item breakdown with inline editing ──────────────────────────────────────

type EditTarget = number | 'new' | null

interface ItemForm {
  name: string
  quantity: string
  grams: string
  calories: string
  protein_g: string
  carbs_g: string
  fat_g: string
}

const EMPTY_FORM: ItemForm = { name: '', quantity: '', grams: '', calories: '', protein_g: '', carbs_g: '', fat_g: '' }

function toForm(item: ParsedEstimateItem): ItemForm {
  return {
    name: item.name,
    quantity: item.quantity ?? '',
    grams: item.grams ? String(item.grams) : '',
    calories: String(item.calories),
    protein_g: String(item.protein_g),
    carbs_g: String(item.carbs_g),
    fat_g: String(item.fat_g),
  }
}

const num = (v: string) => (v.trim() === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)))

function ItemBreakdown({
  items,
  assumptions,
  onReestimate,
  fromBarcode = false,
}: {
  items: (ParsedEstimateItem & { edited?: boolean })[]
  assumptions: string[]
  onReestimate?: (items: ConfirmedItem[]) => Promise<boolean>
  fromBarcode?: boolean
}) {
  const updateItem = useLogDraftStore((s) => s.updateItem)
  const removeItem = useLogDraftStore((s) => s.removeItem)
  const addItem    = useLogDraftStore((s) => s.addItem)

  const [editing, setEditing]   = useState<EditTarget>(null)
  const [form, setForm]         = useState<ItemForm>(EMPTY_FORM)
  const [status, setStatus]     = useState<'idle' | 'working' | 'failed'>('idle')

  const hasEdits = items.some((i) => i.edited)

  function startEdit(target: EditTarget) {
    setEditing(target)
    setForm(typeof target === 'number' ? toForm(items[target]) : EMPTY_FORM)
  }

  function save() {
    const name = form.name.trim()
    if (!name) return
    const patch = {
      name,
      quantity: form.quantity.trim() || null,
      grams: num(form.grams) || null,
      calories: num(form.calories),
      protein_g: num(form.protein_g),
      carbs_g: num(form.carbs_g),
      fat_g: num(form.fat_g),
    }
    if (editing === 'new') addItem({ ...patch, confidence: null })
    else if (typeof editing === 'number') updateItem(editing, patch)
    setEditing(null)
    setStatus('idle')
  }

  async function recalculate() {
    if (!onReestimate) return
    setStatus('working')
    const ok = await onReestimate(items.map((i) => ({ name: i.name, quantity: i.quantity ?? undefined })))
    setStatus(ok ? 'idle' : 'failed')
  }

  /**
   * Changing the grams rescales the macros proportionally from the item as
   * it was when editing began — so "label says per 100 g, I had 30 g" is
   * one edit, no maths.
   */
  function setGrams(value: string) {
    const base = typeof editing === 'number' ? items[editing] : null
    const g = num(value)
    if (!base?.grams || !g) { setForm((f) => ({ ...f, grams: value })); return }
    const k = g / base.grams
    setForm((f) => ({
      ...f,
      grams: value,
      quantity: `${g} g`,
      calories: String(Math.round(base.calories * k)),
      protein_g: String(Math.round(base.protein_g * k)),
      carbs_g: String(Math.round(base.carbs_g * k)),
      fat_g: String(Math.round(base.fat_g * k)),
    }))
  }

  const field = (key: keyof ItemForm, label: string, numeric = false) => (
    <div className="field" style={{ margin: 0 }}>
      <label htmlFor={`item-${key}`}>{label}</label>
      <input
        id={`item-${key}`}
        value={form[key]}
        placeholder={key === 'quantity' ? 'e.g. 1 katori' : key === 'name' ? 'e.g. Prawn curry' : undefined}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...(numeric ? { type: 'number', min: 0, inputMode: 'numeric' as const } : {})}
      />
    </div>
  )

  const editor = (
    <div className="item-editor">
      {field('name', 'Dish')}
      <div className="inline-fields" style={{ marginTop: 10 }}>
        {field('quantity', 'Amount')}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="item-grams">Grams{typeof editing === 'number' && items[editing]?.grams ? ' · rescales' : ''}</label>
          <input id="item-grams" type="number" min={0} inputMode="numeric" value={form.grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
      </div>
      <div className="inline-fields" style={{ marginTop: 10 }}>
        {field('calories', 'kcal', true)}
        {field('protein_g', 'Protein · g', true)}
        {field('carbs_g', 'Carbs · g', true)}
        {field('fat_g', 'Fat · g', true)}
      </div>
      {onReestimate && (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Changed the dish or amount? Save, then tap <b>Recalculate with AI</b> for accurate numbers.
        </p>
      )}
      <div className="flex items-center gap-4" style={{ marginTop: 10 }}>
        <button type="button" onClick={save} disabled={!form.name.trim()} className="pill sel">Save</button>
        <button type="button" onClick={() => setEditing(null)} className="muted small">Cancel</button>
        {typeof editing === 'number' && (
          <button type="button" onClick={() => { removeItem(editing); setEditing(null) }} className="small text-error ml-auto">
            Remove
          </button>
        )}
      </div>
    </div>
  )

  return (
    <>
      {items.map((item, idx) =>
        editing === idx ? (
          <div key={idx}>{editor}</div>
        ) : (
          <button key={idx} type="button" onClick={() => startEdit(idx)} className="meal-row item-row w-full text-left" style={{ marginBottom: 0 }}>
            <span className="min-w-0 flex-1">
              <b className="block text-[13px] font-semibold">
                {item.name}
                {item.confidence === 'low' && !item.edited && <span className="item-flag" title="The AI isn’t sure — check this one">?</span>}
              </b>
              {formatItemQuantity(item) && <small className="block">{formatItemQuantity(item)}</small>}
              <small className="muted">P {item.protein_g}g · C {item.carbs_g}g · F {item.fat_g}g</small>
            </span>
            <span className="flex flex-none items-center gap-2">
              <b className="font-semibold">{item.calories} kcal</b>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="muted">
                <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
              </svg>
            </span>
          </button>
        ),
      )}

      {editing === 'new' ? editor : (
        <button type="button" onClick={() => startEdit('new')} className="small font-semibold" style={{ marginTop: 12 }}>
          {fromBarcode ? '+ Add something else you had' : '+ Add an item the AI missed'}
        </button>
      )}

      {assumptions.length > 0 && !hasEdits && (
        <ul className="tiny muted" style={{ marginTop: 12, paddingLeft: 16, listStyle: 'disc' }}>
          {assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}

      {hasEdits && onReestimate && editing === null && (
        <div style={{ marginTop: 14 }}>
          <button type="button" onClick={recalculate} disabled={status === 'working'} className="btn" style={{ margin: 0, background: 'var(--color-soft)', color: 'var(--color-ink)' }}>
            {status === 'working' ? 'Recalculating…' : '✦ Recalculate with AI'}
          </button>
          <p className={`tiny ${status === 'failed' ? 'text-error' : 'muted'}`} style={{ marginTop: 6 }}>
            {status === 'failed'
              ? 'Couldn’t reach the AI — your edits are kept, try again.'
              : 'Re-reads the photo using your corrections as fact.'}
          </p>
        </div>
      )}
    </>
  )
}
