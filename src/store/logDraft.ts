import { create } from 'zustand'
import type { ParsedEstimate, ParsedEstimateItem } from '../lib/parseEstimate'
import { generateMealName } from '../lib/generateMealName'

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type Visibility = 'public' | 'private'
export type Satiety = 'loved_it' | 'good' | 'okay' | 'not_great'

export interface EstimateResult {
  parsed: ParsedEstimate
  raw: unknown
}

/**
 * Pulls a fun default meal name from the AI's items array using
 * generateMealName. Falls back to '' when no items exist so manual
 * logging still starts with an empty field.
 */
function defaultMealNameFromRaw(raw: unknown, mealType: MealType): string {
  const items = (() => {
    if (typeof raw !== 'object' || raw === null) return []
    const arr = (raw as Record<string, unknown>).items
    if (!Array.isArray(arr)) return []
    return arr.filter((i): i is { name: string } =>
      typeof i === 'object' && i !== null && typeof (i as { name?: unknown }).name === 'string'
    )
  })()
  return generateMealName(items, mealType)
}

/** An item on the review screen: the AI's guess, possibly corrected by the user. */
export type DraftItem = ParsedEstimateItem & { edited?: boolean }

function sumItems(items: DraftItem[]) {
  return items.reduce(
    (t, i) => ({
      calories: t.calories + i.calories,
      protein_g: t.protein_g + i.protein_g,
      carbs_g: t.carbs_g + i.carbs_g,
      fat_g: t.fat_g + i.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  )
}

/**
 * Totals at 1× portion: the item sum when we have items, otherwise the
 * estimate's own totals (older responses sometimes have no items).
 */
function baseTotals(items: DraftItem[], estimate: EstimateResult | null) {
  if (items.length > 0) return sumItems(items)
  if (estimate) {
    const { calories, protein_g, carbs_g, fat_g } = estimate.parsed
    return { calories, protein_g, carbs_g, fat_g }
  }
  return null
}

function scaledTotals(items: DraftItem[], estimate: EstimateResult | null, multiplier: number) {
  const base = baseTotals(items, estimate)
  if (!base) return {}
  return {
    calories: Math.round(base.calories * multiplier),
    proteinG: Math.round(base.protein_g * multiplier),
    carbsG:   Math.round(base.carbs_g * multiplier),
    fatG:     Math.round(base.fat_g * multiplier),
  }
}

interface LogDraftState {
  photoFile: File | null
  description: string           // AI description / accuracy hint
  caption: string               // social caption shown on feed
  estimate: EstimateResult | null
  /** Detected items, editable on the review screen; totals are derived from these. */
  items: DraftItem[]
  /** The name we generated — so a re-estimate can refresh it unless the user typed their own. */
  autoMealName: string
  /** Portion multiplier applied on top of estimate (0.5 / 1 / 1.5 / 2) */
  portionMultiplier: number
  mealName: string
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  mealType: MealType
  visibility: Visibility
  satiety: Satiety | null

  setPhoto: (file: File) => void
  setDescription: (value: string) => void
  setCaption: (value: string) => void
  applyEstimate: (estimate: EstimateResult | null, mealType: MealType, visibility: Visibility) => void
  setPortionMultiplier: (multiplier: number) => void
  updateItem: (index: number, patch: Partial<ParsedEstimateItem>) => void
  removeItem: (index: number) => void
  addItem: (item: ParsedEstimateItem) => void
  /** Replace the estimate after "Recalculate with AI", keeping the user's other edits. */
  applyReestimate: (estimate: EstimateResult) => void
  setMealName: (value: string) => void
  setField: (field: 'calories' | 'proteinG' | 'carbsG' | 'fatG', value: number | null) => void
  setMealType: (value: MealType) => void
  setVisibility: (value: Visibility) => void
  setSatiety: (value: Satiety | null) => void
  reset: () => void
}

const initialState = {
  photoFile: null as File | null,
  description: '',
  caption: '',
  estimate: null as EstimateResult | null,
  items: [] as DraftItem[],
  autoMealName: '',
  portionMultiplier: 1,
  mealName: '',
  calories: null as number | null,
  proteinG: null as number | null,
  carbsG: null as number | null,
  fatG: null as number | null,
  mealType: 'snack' as MealType,
  visibility: 'public' as Visibility,
  satiety: null as Satiety | null,
}

export const useLogDraftStore = create<LogDraftState>((set, get) => ({
  ...initialState,

  setPhoto: (file) => set({ photoFile: file }),
  setDescription: (value) => set({ description: value }),
  setCaption: (value) => set({ caption: value }),

  applyEstimate: (estimate, mealType, visibility) => {
    const name = defaultMealNameFromRaw(estimate?.raw, mealType)
    set({
      estimate,
      items: estimate?.parsed.items ?? [],
      mealType,
      visibility,
      portionMultiplier: 1,
      mealName: name,
      autoMealName: name,
      calories: estimate?.parsed.calories ?? null,
      proteinG: estimate?.parsed.protein_g ?? null,
      carbsG: estimate?.parsed.carbs_g ?? null,
      fatG: estimate?.parsed.fat_g ?? null,
    })
  },

  applyReestimate: (estimate) => {
    const { mealName, autoMealName, mealType, portionMultiplier } = get()
    const items = estimate.parsed.items
    const name = defaultMealNameFromRaw(estimate.raw, mealType)
    set({
      estimate,
      items,
      // Keep a name the user typed; refresh one we generated.
      mealName: mealName === autoMealName ? name : mealName,
      autoMealName: name,
      ...scaledTotals(items, estimate, portionMultiplier),
    })
  },

  setPortionMultiplier: (multiplier) => {
    const { estimate, items } = get()
    set({ portionMultiplier: multiplier, ...scaledTotals(items, estimate, multiplier) })
  },

  updateItem: (index, patch) => {
    const { items, estimate, portionMultiplier } = get()
    if (!items[index]) return
    const next = items.map((item, i) => (i === index ? { ...item, ...patch, edited: true } : item))
    set({ items: next, ...scaledTotals(next, estimate, portionMultiplier) })
  },

  removeItem: (index) => {
    const { items, estimate, portionMultiplier } = get()
    const next = items.filter((_, i) => i !== index)
    // Removing the last item leaves nothing to sum — keep the current totals.
    set(next.length ? { items: next, ...scaledTotals(next, estimate, portionMultiplier) } : { items: next })
  },

  addItem: (item) => {
    const { items, estimate, portionMultiplier } = get()
    const next = [...items, { ...item, edited: true }]
    set({ items: next, ...scaledTotals(next, estimate, portionMultiplier) })
  },

  setMealName: (value) => set({ mealName: value }),
  setField: (field, value) => set({ [field]: value === null ? null : Math.max(0, Math.round(value)) }),
  setMealType: (value) => set({ mealType: value }),
  setVisibility: (value) => set({ visibility: value }),
  setSatiety: (value) => set({ satiety: value }),
  reset: () => set(initialState),
}))
