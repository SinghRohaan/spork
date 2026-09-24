import type { EstimateResult } from '../store/logDraft'
import type { ParsedEstimate } from './parseEstimate'

/**
 * Packaged food: barcode → Open Food Facts (free, open database of ~3M
 * products) → an EstimateResult the normal review screen can show.
 *
 * Coverage of Indian brands in Open Food Facts is patchy, so every path
 * that doesn't end in real label numbers falls back to photographing the
 * pack/label and letting the AI read it (estimate-meal, mode 'packaged').
 */

/**
 * Pulls a GTIN out of whatever the scanner read:
 *  - EAN-13 / EAN-8 / UPC-A / UPC-E → the digits themselves
 *  - QR codes → a GS1 Digital Link (…/01/<gtin>…) or a bare 8–14 digit code
 * Anything else (a website URL, a UPI QR) isn't a product id → null.
 */
export function extractGtin(raw: string): string | null {
  const text = raw.trim()
  if (/^\d{8,14}$/.test(text)) return text
  const link = text.match(/\/01\/(\d{8,14})(?:[/?#]|$)/)
  if (link) return link[1]
  return null
}

interface OffNutriments { [key: string]: number | string | undefined }

export interface OffProduct {
  code?: string
  product_name?: string
  product_name_en?: string
  brands?: string
  quantity?: string
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: OffNutriments
  /** 'food' | 'beauty' | 'petfood' | 'product' — Open Food Facts shares one barcode space across its sister databases. */
  product_type?: string
  categories_tags?: string[]
}

const OFF_FIELDS = 'code,product_name,product_name_en,brands,quantity,serving_size,serving_quantity,nutriments,product_type,categories_tags'

export type LookupResult =
  | { kind: 'found'; estimate: EstimateResult; name: string }
  | { kind: 'no-nutrition'; name: string }   // product known, nutrition missing → read the label
  | { kind: 'not-food'; name: string }       // balm, shampoo, pet food… → refuse to log
  | { kind: 'not-found' }
  | { kind: 'error' }

export async function lookupBarcode(gtin: string, fetchImpl: typeof fetch = fetch): Promise<LookupResult> {
  try {
    const res = await fetchImpl(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(gtin)}.json?fields=${OFF_FIELDS}`)
    if (res.status === 404) return { kind: 'not-found' }
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as { status?: number; product?: OffProduct }
    if (body.status !== 1 || !body.product) return { kind: 'not-found' }
    const name = productName(body.product)
    if (isNonFood(body.product)) return { kind: 'not-food', name }
    const estimate = productToEstimate(body.product, gtin)
    return estimate ? { kind: 'found', estimate, name } : { kind: 'no-nutrition', name }
  } catch {
    return { kind: 'error' }
  }
}

/** Cosmetics, pet food and household products that live in the same barcode database. */
export function isNonFood(p: OffProduct): boolean {
  if (p.product_type && p.product_type !== 'food') return true
  return (p.categories_tags ?? []).includes('en:non-food-products')
}

export function productName(p: OffProduct): string {
  const name = (p.product_name_en || p.product_name || '').trim()
  const brand = (p.brands || '').split(',')[0]?.trim() ?? ''
  if (!name) return brand || 'Packaged food'
  return brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
}

/** "60 g" / "60g" / "0.06 kg" → grams; ml treated as grams. */
export function parseGrams(text: string | undefined): number | null {
  if (!text) return null
  const m = text.toLowerCase().replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|grams?|ml|l)\b/)
  if (!m) return null
  const value = Number(m[1])
  const unit = m[2]
  return Math.round(unit === 'kg' || unit === 'l' ? value * 1000 : value)
}

/** A single-serve pack (bar, sachet, small bottle) is eaten whole; bigger packs aren't. */
const SINGLE_SERVE_MAX_G = 150

/**
 * Open Food Facts → our estimate shape. Prefers the label's per-serving
 * numbers; otherwise scales per-100 g to the serving size, or to the whole
 * pack when it's a single-serve item, or to 100 g as a last resort.
 * Returns null when the product has no usable calories.
 */
export function productToEstimate(p: OffProduct, gtin?: string): EstimateResult | null {
  const n = p.nutriments ?? {}
  const kcal = (suffix: '_serving' | '_100g') => {
    const direct = num(n[`energy-kcal${suffix}`])
    if (direct !== null) return direct
    const kj = num(n[`energy${suffix}`])
    return kj !== null ? kj / 4.184 : null
  }
  const macro = (key: string, suffix: '_serving' | '_100g') => num(n[`${key}${suffix}`]) ?? 0

  const servingG = num(p.serving_quantity) ?? parseGrams(p.serving_size)
  const packG = parseGrams(p.quantity)
  const name = productName(p)

  let calories: number, protein: number, carbs: number, fat: number
  let grams: number | null
  let quantity: string
  let basis: string

  const servingKcal = kcal('_serving')
  const per100Kcal = kcal('_100g')

  if (servingKcal !== null) {
    calories = servingKcal
    protein = macro('proteins', '_serving'); carbs = macro('carbohydrates', '_serving'); fat = macro('fat', '_serving')
    grams = servingG
    quantity = p.serving_size?.trim() ? `1 serving (${p.serving_size.trim()})` : '1 serving'
    basis = `per serving${servingG ? ` (${servingG} g)` : ''}`
  } else if (per100Kcal !== null) {
    const single = packG !== null && packG <= SINGLE_SERVE_MAX_G
    grams = servingG ?? (single ? packG : 100)
    const scale = grams / 100
    calories = per100Kcal * scale
    protein = macro('proteins', '_100g') * scale; carbs = macro('carbohydrates', '_100g') * scale; fat = macro('fat', '_100g') * scale
    quantity = servingG ? `1 serving (${servingG} g)` : single ? `1 pack (${packG} g)` : '100 g'
    basis = servingG ? `scaled from per-100 g to a ${servingG} g serving` : single ? `the whole ${packG} g pack` : 'per 100 g — change the amount if you had more or less'
  } else {
    return null
  }

  const r = (x: number) => Math.round(x)
  const item = {
    name, quantity, grams: grams ? r(grams) : null,
    calories: r(calories), protein_g: r(protein), carbs_g: r(carbs), fat_g: r(fat),
    confidence: 'high' as const,
  }
  const parsed: ParsedEstimate = {
    items: [item],
    calories: item.calories, protein_g: item.protein_g, carbs_g: item.carbs_g, fat_g: item.fat_g,
    confidence: 'high',
    assumptions: [`From the product's barcode (Open Food Facts) · ${basis}`],
  }
  return { parsed, raw: { source: 'barcode', gtin: gtin ?? p.code ?? null, product: name, ...parsed } }
}
