/** Main food group of an item — what the meal score uses to judge plants, fried food, sweets and alcohol. */
export const FOOD_GROUPS = [
  'vegetable', 'fruit', 'pulse', 'whole_grain', 'refined_grain', 'dairy', 'egg', 'meat', 'fish',
  'nuts_seeds', 'fat_oil', 'sweet', 'fried_snack', 'sugary_drink', 'alcohol', 'protein_supplement', 'other',
] as const
export type FoodGroup = typeof FOOD_GROUPS[number]

/**
 * Nutrition detail the AI adds per item (newer estimates only). Missing on
 * older posts and hand-added items — the score then treats them as unknown.
 */
export interface ItemDetail {
  fiber_g?: number | null
  /** Free/added sugar only — not the natural sugar in whole fruit, vegetables or plain milk. */
  added_sugar_g?: number | null
  sat_fat_g?: number | null
  /** Grams of pure alcohol (7 kcal/g, not part of protein/carbs/fat). */
  alcohol_g?: number | null
  group?: FoodGroup | null
  /** Deep-fried or cooked in a lot of oil. */
  fried?: boolean | null
}

export interface ParsedEstimateItem extends ItemDetail {
  name: string
  /** Human-readable amount the AI assumed, e.g. "1 cup cooked" (null from older responses). */
  quantity: string | null
  /** Estimated cooked / as-served weight in grams (null from older responses). */
  grams: number | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: 'low' | 'medium' | 'high' | null
}

export interface ParsedEstimate {
  items: ParsedEstimateItem[]
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: 'low' | 'medium' | 'high'
  /** The AI's biggest assumptions, for the user to sanity-check. */
  assumptions: string[]
  /** Set when the AI says the photo isn't something you eat (a balm, soap…) — what it saw. */
  notFood?: string
}

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high'])
const GROUPS = new Set<string>(FOOD_GROUPS)

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Keeps only the detail fields that are present and valid; a bad field is dropped, not the item. */
function parseDetail(d: Record<string, unknown>): ItemDetail {
  const out: ItemDetail = {}
  for (const k of ['fiber_g', 'added_sugar_g', 'sat_fat_g', 'alcohol_g'] as const) {
    const v = d[k]
    if (isFiniteNonNegativeNumber(v)) out[k] = Math.round(v * 10) / 10
  }
  if (typeof d.group === 'string' && GROUPS.has(d.group)) out.group = d.group as FoodGroup
  if (typeof d.fried === 'boolean') out.fried = d.fried
  return out
}

export function parseItems(raw: unknown): ParsedEstimateItem[] {
  if (!Array.isArray(raw)) return []
  const items: ParsedEstimateItem[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { name, quantity, grams, calories, protein_g, carbs_g, fat_g, confidence, fiber_g, added_sugar_g, sat_fat_g, alcohol_g, group, fried } = item as Record<string, unknown>
    if (
      typeof name !== 'string' ||
      !isFiniteNonNegativeNumber(calories) ||
      !isFiniteNonNegativeNumber(protein_g) ||
      !isFiniteNonNegativeNumber(carbs_g) ||
      !isFiniteNonNegativeNumber(fat_g)
    ) continue
    items.push({
      name: name.trim(),
      quantity: typeof quantity === 'string' && quantity.trim() ? quantity.trim() : null,
      grams: isFiniteNonNegativeNumber(grams) && grams > 0 ? Math.round(grams) : null,
      calories: Math.round(calories),
      protein_g: Math.round(protein_g),
      carbs_g: Math.round(carbs_g),
      fat_g: Math.round(fat_g),
      confidence: typeof confidence === 'string' && CONFIDENCE_LEVELS.has(confidence)
        ? (confidence as 'low' | 'medium' | 'high')
        : null,
      ...parseDetail({ fiber_g, added_sugar_g, sat_fat_g, alcohol_g, group, fried }),
    })
  }
  return items
}

/**
 * Validates/normalizes whatever the estimate-meal Edge Function returned.
 * Returns null on anything malformed. Items array is parsed leniently —
 * a malformed item is silently skipped, not used to invalidate the whole response.
 */
export function parseEstimateResponse(raw: unknown): ParsedEstimate | null {
  if (typeof raw !== 'object' || raw === null) return null

  const { calories, protein_g, carbs_g, fat_g, confidence, items, assumptions, is_food, not_food_reason } = raw as Record<string, unknown>

  if (
    !isFiniteNonNegativeNumber(calories) ||
    !isFiniteNonNegativeNumber(protein_g) ||
    !isFiniteNonNegativeNumber(carbs_g) ||
    !isFiniteNonNegativeNumber(fat_g) ||
    typeof confidence !== 'string' ||
    !CONFIDENCE_LEVELS.has(confidence)
  ) {
    return null
  }

  return {
    items: parseItems(items),
    calories: Math.round(calories),
    protein_g: Math.round(protein_g),
    carbs_g: Math.round(carbs_g),
    fat_g: Math.round(fat_g),
    confidence: confidence as 'low' | 'medium' | 'high',
    assumptions: Array.isArray(assumptions)
      ? assumptions.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim()).slice(0, 3)
      : [],
    ...(is_food === false
      ? { notFood: typeof not_food_reason === 'string' && not_food_reason.trim() ? not_food_reason.trim().slice(0, 80) : 'This doesn’t look like food' }
      : {}),
  }
}

/** "1 cup cooked · ~150 g" — what the review screen shows under an item's name. */
export function formatItemQuantity(item: Pick<ParsedEstimateItem, 'quantity' | 'grams'>): string | null {
  const q = item.quantity?.trim() || null
  const g = item.grams ? `~${item.grams} g` : null
  if (q && g && !q.includes(`${item.grams}`)) return `${q} · ${g}`
  return q ?? g
}
