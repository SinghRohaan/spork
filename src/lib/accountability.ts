/**
 * Accountability scores: a 1–10 score per meal and a 0–100 score per day,
 * worked out from the logged numbers and the user's goals (no AI call).
 * Scores are private — only ever shown to the meal's owner.
 */
import type { MealType } from './mealType'
import type { ItemDetail } from './parseEstimate'

export interface Goals { calories: number; protein: number; carbs: number; fat: number }

/** Daily targets — carbs/fat use the same 40% / 30% split shown on the plan screen. */
export function dailyGoals(calorieGoal: number | null | undefined, proteinGoal: number | null | undefined): Goals {
  const calories = calorieGoal || 2000
  return {
    calories,
    protein: proteinGoal || Math.round((calories * 0.25) / 4),
    carbs: Math.round((calories * 0.4) / 4),
    fat: Math.round((calories * 0.3) / 9),
  }
}

export interface ScoredMeal {
  id: string
  name: string | null
  meal_type: MealType
  created_at: string
  photo_url: string | null
  calories: number
  protein: number
  carbs: number
  fat: number
  /** What was in it, with grams and (newer posts) fibre / sugar / alcohol detail. */
  items?: ScoredItem[] | null
}

export interface ScoredItem extends ItemDetail {
  name: string
  quantity?: string | null
  grams: number | null
  calories: number
}

export type Tone = 'good' | 'mid' | 'low'
export interface Reason { tone: Tone; text: string; hint?: string; short?: string }

/** Rough share of the day each meal should take. */
/**
 * Every threshold the meal score uses, in one place (see docs/meal-score-matrix.md
 * for where each number comes from). Ranges are [zero points, full points] and
 * score linearly in between, the way the Healthy Eating Index does.
 */
export const SCORE_RULES = {
  /** Share of the day's calories each meal is planned for. */
  share: { breakfast: 0.25, lunch: 0.3, dinner: 0.3, snack: 0.15 } as Record<MealType, number>,
  /** A "snack" bigger than this share of the day is scored as a meal (share 25%). */
  mealSizedSnack: 0.2,
  /** Per-meal protein target clamps, g (ISSN: 20–40 g per meal). */
  proteinClamp: { main: [20, 40], snack: [10, 20] },
  /** Protein: 0 at 25% of target, full at 90%. */
  protein: [0.25, 0.9],
  /** Fibre density, g per 1,000 kcal (DRI adequate intake: 14). */
  fiberPer1000: [4, 14],
  /** Added sugar, share of calories (HEI-2020: full ≤ 6.5%, zero ≥ 26%). */
  addedSugar: [0.26, 0.065],
  /** Saturated fat, share of calories (HEI-2020: full ≤ 8%, zero ≥ 16%). */
  satFat: [0.16, 0.08],
  /** Energy density of the solid food, kcal/g (Rolls: low < 1.5, high > 4). */
  density: [4, 1.5],
  /** Share of calories from fried food. */
  fried: [0.6, 0],
  /** Fat and carbs as a share of macro calories (AMDR upper edges 35% / 65%). */
  fatShare: [0.55, 0.35],
  carbShare: [0.8, 0.65],
  /** Portion vs the meal's budget: full 0.8–1.2×, zero at 0.4× and 1.8×. Snacks: full ≤ 1×, zero at 1.67×. */
  portion: { low: [0.4, 0.8], high: [1.8, 1.2], snack: [1.67, 1] },
} as const
const MEAL_SHARE = SCORE_RULES.share

/** Everyday Indian protein top-ups, biggest first. */
const PROTEIN_FOODS: [string, number][] = [
  ['100 g paneer', 18],
  ['a cup of chana', 15],
  ['2 boiled eggs', 12],
  ['a bowl of curd', 10],
  ['a bowl of dal', 9],
]

/** One or two everyday foods that roughly cover a protein gap. */
export function proteinFix(gapG: number): string {
  const picks: [string, number][] = []
  let left = gapG
  for (const food of PROTEIN_FOODS) {
    if (picks.length === 2 || left <= 3) break
    if (food[1] <= left + 4) { picks.push(food); left -= food[1] }
  }
  if (!picks.length) picks.push(PROTEIN_FOODS[PROTEIN_FOODS.length - 1])
  return `${picks.map(([f]) => f).join(' + ')} ≈ ${picks.reduce((t, [, g]) => t + g, 0)} g`
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export interface MealScore {
  /** 1–10, or null for something too small to judge (water, black coffee). */
  score: number | null
  tone: Tone
  headline: string
  reasons: Reason[]
  /** True when the meal has no fibre / sugar / food-group detail (older posts): those parts are scored as neutral. */
  basic: boolean
  /** Extra context, e.g. a big snack that was scored as a meal. */
  note?: string
}

const ALCOHOL_WORDS = /\b(vodka|whiske?y|scotch|bourbon|rum|gin|tequila|brandy|cognac|beer|lager|ale|stout|wine|champagne|prosecco|cider|sake|soju|cocktail|margarita|mojito|martini|sangria|breezer|liquor|alcohol|feni|toddy|daru)\b/i
const PLANT_GROUPS = new Set(['vegetable', 'fruit', 'pulse'])
const DRINK_GROUPS = new Set(['sugary_drink', 'alcohol'])
const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0)

/**
 * Grams of alcohol in a meal: what the AI reported per item, or — for older
 * posts — the calories protein, carbs and fat can't explain (alcohol is 7 kcal/g),
 * but only when the meal is clearly a drink (its name or an item says so).
 */
export function mealAlcoholG(meal: ScoredMeal): number {
  const items = meal.items ?? []
  const reported = sumBy(items, (i) => i.alcohol_g ?? 0)
  const drinkItems = items.filter((i) => i.group === 'alcohol' || ALCOHOL_WORDS.test(i.name))
  // The AI measured every drink in the meal — trust it.
  if (drinkItems.length && drinkItems.every((i) => i.alcohol_g != null)) return Math.round(reported)
  const looksAlcoholic = drinkItems.length > 0 || ALCOHOL_WORDS.test(meal.name ?? '')
  const gapKcal = meal.calories - (meal.protein * 4 + meal.carbs * 4 + meal.fat * 9)
  const inferred = looksAlcoholic && gapKcal > Math.max(30, meal.calories * 0.15) ? gapKcal / 7 : 0
  return Math.round(Math.max(reported, inferred))
}

/** Standard drinks (WHO: 10 g pure alcohol each). */
const drinks = (g: number) => Math.max(1, Math.round(g / 10))
const drinksText = (g: number) => `${drinks(g)} standard drink${drinks(g) === 1 ? '' : 's'}`

/** 0 at `zero`, 1 at `full`, straight line in between (works in either direction). */
export const lin = (x: number, [zero, full]: readonly [number, number]) =>
  Math.min(1, Math.max(0, (x - zero) / (full - zero)))
const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, x))

/**
 * Meal score out of 10 — a dietitian's read of the plate, every part scored
 * on a sliding scale against published standards (SCORE_RULES):
 *
 *   Main meal: protein 3 · portion 2 · fibre 2 · food quality 2 · balance 1
 *   Snack:     protein-or-plants 4 · size 3 · food quality 3
 *   Food quality = added sugar ½ · saturated fat ¼ · fried / calorie-dense ¼
 *
 * Quantity: grams drive every number; fibre, sugar and fat are judged per
 * calorie so size can't distort them; an over-sized meal only earns protein
 * for the part that fits its budget, and is capped (1.5× → 6, 2× → 4).
 * Hard rules: mostly alcohol → 1–2 · some alcohol → −2, max 5 · mostly sugar
 * → max 3 · mostly fried/sweets → snack max 3, meal max 5 (4 if 80%+) · under 40 kcal or
 * no macros → not scored. Meals without AI detail score fibre and quality at
 * half marks ("basic score").
 */
export function mealScore(meal: ScoredMeal, goals: Goals): MealScore {
  const cal = meal.calories
  const items = meal.items ?? []
  const itemKcal = sumBy(items, (i) => i.calories)
  const detailed = items.filter((i) => i.fiber_g != null)
  // Enough of the meal (by calories) has AI detail to judge fibre and quality.
  const basic = !detailed.length || sumBy(detailed, (i) => i.calories) < itemKcal * 0.8
  const alcoholG = mealAlcoholG(meal)
  const macroKcal = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9
  const unscored = (headline: string, text: string): MealScore => ({ score: null, tone: 'mid', headline, reasons: [{ tone: 'mid', text }], basic })

  if (cal < 40 && !alcoholG) return unscored('Too light to score', `${Math.round(cal)} kcal — too little to score`)
  // Calories typed in with no protein / carbs / fat: nothing to judge.
  if (!alcoholG && macroKcal < cal * 0.2) return unscored('Not enough detail to score', 'Add protein, carbs and fat to get a score')

  // ── Role, budget and targets ─────────────────────────────────────────────
  const mealSized = meal.meal_type === 'snack' && cal > goals.calories * SCORE_RULES.mealSizedSnack
  const snack = meal.meal_type === 'snack' && !mealSized
  const share = mealSized ? 0.25 : MEAL_SHARE[meal.meal_type]
  const kind = mealSized ? 'meal' : meal.meal_type
  const label = kind.charAt(0).toUpperCase() + kind.slice(1)
  const sizeRatio = cal / (goals.calories * share)
  const dayShare = cal / goals.calories
  // Eating double doesn't earn double credit: protein counts for the part within budget.
  const fit = Math.min(1, (snack ? 1 : 1.2) / sizeRatio)
  const proteinTarget = clamp(goals.protein * share, snack ? SCORE_RULES.proteinClamp.snack : SCORE_RULES.proteinClamp.main)
  const reasons: Reason[] = []

  // ── Detail sums (newer posts) ────────────────────────────────────────────
  const fiber = sumBy(detailed, (i) => i.fiber_g ?? 0)
  const fiberPer1000 = cal ? (fiber / cal) * 1000 : 0
  const sugarShare = cal ? Math.min(1, (sumBy(detailed, (i) => i.added_sugar_g ?? 0) * 4) / cal) : 0
  const satShare = cal ? Math.min(1, (sumBy(detailed, (i) => i.sat_fat_g ?? 0) * 9) / cal) : 0
  const kcalWhere = (f: (i: ScoredItem) => boolean) => (cal ? sumBy(detailed.filter(f), (i) => i.calories) / cal : 0)
  const plantShare = kcalWhere((i) => PLANT_GROUPS.has(i.group ?? '') || (snack && i.group === 'nuts_seeds'))
  const friedShare = kcalWhere((i) => Boolean(i.fried) || i.group === 'fried_snack')
  const junkShare = kcalWhere((i) => Boolean(i.fried) || ['fried_snack', 'sweet', 'sugary_drink'].includes(i.group ?? ''))
  // Calories per gram of the solid food — drinks and nuts are left out (beverages
  // always are in energy-density work; nuts are dense but nourishing).
  const solid = detailed.filter((i) => i.grams && !DRINK_GROUPS.has(i.group ?? '') && i.group !== 'nuts_seeds' && !/\bml\b/i.test(i.quantity ?? ''))
  const solidGrams = sumBy(solid, (i) => i.grams ?? 0)
  const solidKcal = sumBy(solid, (i) => i.calories)
  const density = solidGrams >= 50 && solidKcal >= cal * 0.5 ? solidKcal / solidGrams : 0

  // ── Part scores, each 0–1 ────────────────────────────────────────────────
  const proteinS = lin(meal.protein * fit, [proteinTarget * SCORE_RULES.protein[0], proteinTarget * SCORE_RULES.protein[1]])
  const fiberS = basic ? 0.5 : lin(fiberPer1000, SCORE_RULES.fiberPer1000)
  const sugarS = basic ? 0.5 : lin(sugarShare, SCORE_RULES.addedSugar)
  const satS = basic ? 0.5 : lin(satShare, SCORE_RULES.satFat)
  const friedDenseS = basic ? 0.5 : Math.min(density ? lin(density, SCORE_RULES.density) : 1, lin(friedShare, SCORE_RULES.fried))
  const qualityS = 0.5 * sugarS + 0.25 * satS + 0.25 * friedDenseS
  const fatShare = macroKcal ? (meal.fat * 9) / macroKcal : 0
  const carbShare = macroKcal ? (meal.carbs * 4) / macroKcal : 0
  const balanceS = Math.min(lin(fatShare, SCORE_RULES.fatShare), lin(carbShare, SCORE_RULES.carbShare))
  const portionS = snack ? lin(sizeRatio, SCORE_RULES.portion.snack)
    : sizeRatio < 0.8 ? lin(sizeRatio, SCORE_RULES.portion.low) : lin(sizeRatio, SCORE_RULES.portion.high)

  // ── Reasons ──────────────────────────────────────────────────────────────
  const proteinGap = Math.max(0, Math.round(proteinTarget - meal.protein))
  const proteinReason = () => {
    if (proteinS >= 0.9) reasons.push({ tone: 'good', text: `${snack ? 'Protein-rich snack' : 'Good protein'}: ${Math.round(meal.protein)} g` })
    else reasons.push({ tone: proteinS >= 0.5 ? 'mid' : 'low', short: 'light on protein', text: `Protein ${Math.round(meal.protein)} g — aim for about ${Math.round(proteinTarget)} g in a ${kind}`, hint: proteinGap > 3 ? `Add ${proteinFix(proteinGap)}` : undefined })
  }
  if (!basic) {
    if (sugarS < 0.9) reasons.push({ tone: sugarS < 0.5 ? 'low' : 'mid', short: 'sugary', text: sugarShare >= 0.95 ? 'Almost all added sugar' : `Added sugar: ${pct(sugarShare)} of the calories`, hint: 'WHO: keep added sugar under 10% — unsweetened or fruit instead' })
    if (satS < 0.6) reasons.push({ tone: 'mid', short: 'rich', text: `High in saturated fat: ${pct(satShare)} of the calories`, hint: 'Less ghee, butter, cream or cheese' })
    if (friedDenseS < 0.6) reasons.push({ tone: 'mid', short: friedShare >= 0.3 ? 'fried' : 'calorie-dense', text: friedShare >= 0.3 ? 'Fried or very oily food' : `Calorie-dense: ${density.toFixed(1)} kcal per gram`, hint: friedShare >= 0.3 ? 'Grilled, roasted or air-fried next time' : 'Bulk it up with salad, sabzi or curd' })
  }

  let total: number
  if (!snack) {
    proteinReason()
    if (portionS >= 0.9) reasons.push({ tone: 'good', text: `Good size: ${pct(dayShare)} of your daily calories`, hint: `${label} budget ≈ ${pct(share)}` })
    else if (sizeRatio < 0.8) reasons.push({ tone: portionS >= 0.5 ? 'mid' : 'low', short: portionS >= 0.5 ? 'on the light side' : 'very light', text: `${portionS >= 0.5 ? 'Light' : 'Very light'} ${kind}: ${pct(dayShare)} of your daily calories`, hint: portionS >= 0.5 ? `${label} budget ≈ ${pct(share)}` : 'Was anything left out of the log?' })
    else reasons.push({ tone: sizeRatio > 1.5 ? 'low' : 'mid', short: sizeRatio > 1.5 ? 'quite heavy' : 'a bit big', text: sizeRatio > 1.5 ? `Heavy: ${pct(dayShare)} of your daily calories in one meal` : `A bit big: ${pct(dayShare)} of your daily calories`, hint: sizeRatio > 1.5 ? 'Go lighter on the next one' : `${label} budget ≈ ${pct(share)}` })
    if (!basic) {
      if (fiberS >= 0.9) reasons.push({ tone: 'good', text: `Good fibre: ${Math.round(fiber)} g` })
      else reasons.push({ tone: fiberS >= 0.4 ? 'mid' : 'low', short: 'low on veg', text: `${fiberS >= 0.4 ? 'Some' : 'Low'} fibre: ${Math.round(fiber)} g${sizeRatio > 1.2 ? ` in ${Math.round(cal).toLocaleString()} kcal` : ''}`, hint: 'Add vegetables, salad, dal or fruit' })
    }
    if (balanceS < 0.6) reasons.push(fatShare > 0.4
      ? { tone: 'mid', short: 'fat-heavy', text: `Fat-heavy: ${pct(fatShare)} of this meal's calories` }
      : { tone: 'mid', short: 'carb-heavy', text: `Carb-heavy: ${pct(carbShare)} of this meal's calories` })
    total = 3 * proteinS + 2 * portionS + 2 * fiberS + 2 * qualityS + balanceS
  } else {
    // A protein snack (curd, eggs, whey) and a plant snack (fruit, nuts, sprouts) both count.
    const plantS = basic ? 0.5 : Math.max(fiberS, lin(plantShare, [0.2, 0.5]))
    const nourishS = Math.max(proteinS, plantS)
    if (proteinS >= 0.9) proteinReason()
    else if (plantS >= 0.9) reasons.push({ tone: 'good', text: 'Fruit, veg or nuts — a nourishing snack' })
    else if (nourishS < 0.5) reasons.push({ tone: 'low', short: 'not very filling', text: 'Little protein or fibre', hint: 'Try curd, fruit, sprouts, nuts or eggs' })
    if (portionS < 0.9) reasons.push({ tone: 'mid', short: 'a big snack', text: `A big snack: ${pct(dayShare)} of your daily calories`, hint: 'Snacks work best around 10–15% of the day' })
    total = 4 * nourishS + 3 * portionS + 3 * qualityS
  }

  let score = Math.min(10, Math.max(1, Math.round(total)))
  let override: string | null = null
  // Far too much in one sitting can't score well, whatever's in it.
  if (!snack && sizeRatio > 2) score = Math.min(score, 4)
  else if (!snack && sizeRatio > 1.5) score = Math.min(score, 6)

  // ── Hard rules ───────────────────────────────────────────────────────────
  const alcoholShare = cal ? Math.min(1, (alcoholG * 7) / cal) : 0
  if (alcoholShare >= 0.5) {
    score = alcoholG <= 20 ? 2 : 1
    override = 'Mostly alcohol'
    reasons.length = 0
    reasons.push({
      tone: 'low',
      text: `≈${drinksText(alcoholG)} — ${Math.round(alcoholG * 7).toLocaleString()} kcal from alcohol`,
      hint: alcoholG >= 60 ? 'That’s heavy drinking for one sitting — alternate with water' : 'Alcohol adds calories but no protein, fibre or vitamins',
    })
  } else if (alcoholShare >= 0.2) {
    score = Math.max(1, Math.min(score - 2, 5))
    reasons.unshift({ tone: 'low', short: 'with alcohol', text: `Includes ≈${drinksText(alcoholG)} (${Math.round(alcoholG * 7)} kcal)`, hint: 'Alcohol adds empty calories' })
  } else if (alcoholG >= 20) {
    score = Math.max(1, score - 1)
    reasons.unshift({ tone: 'mid', short: 'with alcohol', text: `Includes ≈${drinksText(alcoholG)}` })
  }
  if (!basic && !override && sugarShare >= 0.5) { score = Math.min(score, 3); override = 'Mostly sugar' }
  else if (!basic && !override && junkShare >= 0.6) score = Math.min(score, snack ? 3 : junkShare >= 0.8 ? 4 : 5)

  const tone: Tone = score >= 7 ? 'good' : score >= 5 ? 'mid' : 'low'
  // One thing that went well, then the fixes (worst first); at most three lines.
  const good = reasons.filter((r) => r.tone === 'good')
  const fixes = reasons.filter((r) => r.tone !== 'good').sort((x, y) => order(y.tone) - order(x.tone))
  const shown = [...good.slice(0, fixes.length ? 1 : 3), ...fixes].slice(0, 3)
  const weakest = fixes[0]?.short
  const band = score >= 9 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5 ? 'Okay' : score >= 3 ? 'Needs work' : 'Poor'
  const headline = override ?? (score >= 9 || !weakest ? band : `${band}, ${weakest}`)
  const note = mealSized ? 'Meal-sized snack — scored as a meal' : undefined
  return { score, tone, headline, reasons: shown, basic, note }
}
const order = (t: Tone) => (t === 'good' ? 0 : t === 'mid' ? 1 : 2)

export interface TargetRow { key: keyof Goals; label: string; planned: number; eaten: number; gap: number; tone: Tone }
export interface DayReview {
  score: number | null
  tone: Tone
  label: string
  summary: string
  rows: TargetRow[]
  missing: Reason[]
  meals: (ScoredMeal & { score: number | null; tone: Tone })[]
  /** Calories still available today (0 for past days). */
  roomKcal: number
}

/** Review of one day's meals against the goals. `isToday` softens "under" — the day isn't over. */
export function dayReview(meals: ScoredMeal[], goals: Goals, isToday: boolean): DayReview {
  const eaten = meals.reduce((t, m) => ({ calories: t.calories + m.calories, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  const ratio = (k: keyof Goals) => (goals[k] ? eaten[k] / goals[k] : 1)
  const off = (k: keyof Goals) => Math.abs(ratio(k) - 1)

  const rows: TargetRow[] = (['calories', 'protein', 'carbs', 'fat'] as const).map((key) => {
    const r = ratio(key)
    const tone: Tone = key === 'calories' ? (off(key) <= 0.1 ? 'good' : off(key) <= 0.2 ? 'mid' : 'low')
      : key === 'protein' ? (r >= 0.9 ? 'good' : r >= 0.7 ? 'mid' : 'low')
      : off(key) <= 0.2 ? 'good' : off(key) <= 0.35 ? 'mid' : 'low'
    return { key, label: key.charAt(0).toUpperCase() + key.slice(1), planned: goals[key], eaten: Math.round(eaten[key]), gap: Math.round(eaten[key] - goals[key]), tone }
  })
  const scored = meals.map((m) => { const s = mealScore(m, goals); return { ...m, score: s.score, tone: s.tone } })
  const roomKcal = isToday ? Math.max(0, Math.round(goals.calories - eaten.calories)) : 0

  if (!meals.length) {
    return { score: null, tone: 'low', label: isToday ? 'Nothing logged yet' : 'Nothing logged', summary: isToday ? 'Log a meal to see how today is going.' : 'No meals were logged this day.', rows, missing: [], meals: [], roomKcal }
  }

  // Calories 40 · protein 40 · meals logged 20, minus a drinking penalty.
  const cal = off('calories') <= 0.1 ? 40 : off('calories') <= 0.2 ? 25 : 10
  const pr = ratio('protein') >= 0.9 ? 40 : ratio('protein') >= 0.7 ? 25 : ratio('protein') >= 0.5 ? 15 : 5
  const mealPts = meals.length >= 3 ? 20 : meals.length === 2 ? 12 : 6
  const alcoholG = meals.reduce((t, m) => t + mealAlcoholG(m), 0)
  const alcoholPen = alcoholG >= 60 ? 25 : alcoholG >= 20 ? 10 : 0
  const score = Math.max(0, cal + pr + mealPts - alcoholPen)
  const tone: Tone = score >= 80 ? 'good' : score >= 60 ? 'mid' : 'low'
  const label = score === 100 ? 'Nailed it' : score >= 75 ? 'Mostly on track' : score >= 55 ? 'Getting there' : 'Off track'

  const calOk = off('calories') <= 0.1
  const proteinOk = ratio('protein') >= 0.9
  const summary = calOk && proteinOk ? 'Calories and protein both on target.'
    : calOk ? 'Calories were right, protein fell short.'
    : proteinOk ? `Protein was right, calories were ${eaten.calories > goals.calories ? 'over' : 'under'}.`
    : `Calories ${eaten.calories > goals.calories ? 'over' : 'under'} and protein short.`

  const missing: Reason[] = []
  if (alcoholPen) missing.push({ tone: 'low', text: `≈${drinksText(alcoholG)} today`, hint: alcoholG >= 60 ? 'A heavy drinking day — it also slows recovery and fat loss' : 'Alcohol adds empty calories' })
  const proteinGap = Math.round(goals.protein - eaten.protein)
  if (proteinGap > 5) missing.push({ tone: 'low', text: `${proteinGap} g protein short`, hint: proteinFix(proteinGap) })
  const calGap = Math.round(eaten.calories - goals.calories)
  if (calGap > goals.calories * 0.1) missing.push({ tone: 'low', text: `${calGap.toLocaleString()} kcal over`, hint: 'Keep the next meals lighter' })
  else if (calGap < -goals.calories * 0.1) missing.push(isToday
    ? { tone: 'mid', text: `${(-calGap).toLocaleString()} kcal left today`, hint: 'Room for one more meal' }
    : { tone: 'mid', text: `${(-calGap).toLocaleString()} kcal under`, hint: 'Eating too little can stall progress too' })
  else missing.push({ tone: 'good', text: 'Calories within range', hint: `${pct(ratio('calories'))} of goal` })
  const fatRow = rows.find((r) => r.key === 'fat')!
  if (fatRow.tone === 'low' && fatRow.gap > 0) missing.push({ tone: 'mid', text: `Fat ran high (+${fatRow.gap} g)`, hint: 'Go easy on oil, ghee and fried food' })
  if (proteinOk) missing.push({ tone: 'good', text: 'Protein target hit', hint: `${Math.round(eaten.protein)} of ${goals.protein} g` })

  return { score, tone, label, summary, rows, missing: missing.slice(0, 3), meals: scored, roomKcal }
}

/** Local midnight six days before `now` — the start of the last-7-days window. */
export function weekStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
}

/** The last 7 days (oldest first, today last), each day's meals bucketed by local date. */
export function mealsByDay(meals: ScoredMeal[], now = new Date()): ScoredMeal[][] {
  const start = weekStart(now)
  const days: ScoredMeal[][] = Array.from({ length: 7 }, () => [])
  for (const m of meals) {
    const at = new Date(m.created_at)
    const i = Math.round((Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000)
    if (i >= 0 && i <= 6) days[i].push(m)
  }
  for (const d of days) d.sort((a, b) => a.created_at.localeCompare(b.created_at))
  return days
}

export function weekSummary(days: ScoredMeal[][], goals: Goals) {
  const reviews = days.map((d, i) => dayReview(d, goals, i === days.length - 1))
  const scored = reviews.filter((r) => r.score != null)
  return {
    scores: reviews.map((r) => r.score),
    avgScore: scored.length ? Math.round(scored.reduce((t, r) => t + r.score!, 0) / scored.length) : null,
    mealsPerDay: scored.length ? Math.round((scored.reduce((t, r) => t + r.meals.length, 0) / scored.length) * 10) / 10 : null,
    proteinHit: scored.filter((r) => r.rows[1].tone === 'good').length,
    daysOnTarget: scored.filter((r) => r.score! >= 80).length,
    daysLogged: scored.length,
  }
}
