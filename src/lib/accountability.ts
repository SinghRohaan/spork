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
const MEAL_SHARE: Record<MealType, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 }

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

/**
 * Meal score, built the way a dietitian reads a plate (Healthy Eating Index,
 * Nutri-Score, ICMR-NIN "My Plate", WHO limits):
 *
 * Main meals (10): protein 3 · portion 2 · fibre & plants 2 · food quality 2 · balance 1
 * Snacks (10):     protein-or-plants 4 · size 3 · food quality 3
 * Quantity counts everywhere: the AI turns "1 bowl" into grams, grams drive
 * every number, and calories-per-gram flags dense food (chips, sweets, fried).
 *
 * Hard rules first: mostly alcohol → 1–2; some alcohol → −2 and at most 5;
 * mostly added sugar → at most 3; under 40 kcal → not scored.
 */
export function mealScore(meal: ScoredMeal, goals: Goals): MealScore {
  const cal = meal.calories
  const items = meal.items ?? []
  const itemKcal = sumBy(items, (i) => i.calories)
  const detailed = items.filter((i) => i.fiber_g != null)
  // Enough of the meal (by calories) has AI detail to judge fibre and quality.
  const basic = !detailed.length || sumBy(detailed, (i) => i.calories) < itemKcal * 0.8
  const alcoholG = mealAlcoholG(meal)

  if (cal < 40 && !alcoholG) {
    return { score: null, tone: 'mid', headline: 'Too light to score', reasons: [{ tone: 'mid', text: `${Math.round(cal)} kcal — too little to score` }], basic }
  }

  const share = MEAL_SHARE[meal.meal_type]
  const snack = meal.meal_type === 'snack'
  const label = meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)
  const sizeRatio = cal / (goals.calories * share)
  const dayShare = cal / goals.calories
  const proteinTarget = goals.protein * share
  const proteinGap = Math.round(proteinTarget - meal.protein)
  const macroKcal = meal.protein * 4 + meal.carbs * 4 + meal.fat * 9
  const reasons: Reason[] = []
  // Quantity: eating double doesn't earn double credit. Protein and fibre only
  // count for the part of the meal that fits its calorie budget.
  const fit = Math.min(1, (snack ? 1.5 : 1.25) / sizeRatio)
  const proteinRatio = proteinTarget ? (meal.protein * fit) / proteinTarget : 1

  // ── Detail (newer posts) ─────────────────────────────────────────────────
  const fiber = sumBy(detailed, (i) => i.fiber_g ?? 0)
  const fiberFit = fiber * fit
  const sugarShare = cal ? (sumBy(detailed, (i) => i.added_sugar_g ?? 0) * 4) / cal : 0
  const satShare = cal ? (sumBy(detailed, (i) => i.sat_fat_g ?? 0) * 9) / cal : 0
  const kcalWhere = (f: (i: ScoredItem) => boolean) => (cal ? sumBy(detailed.filter(f), (i) => i.calories) / cal : 0)
  const plantShare = kcalWhere((i) => PLANT_GROUPS.has(i.group ?? '') || (snack && i.group === 'nuts_seeds'))
  const friedShare = kcalWhere((i) => Boolean(i.fried) || i.group === 'fried_snack')
  // Fried snacks, sweets and sugary drinks — mostly "empty" calories.
  const junkShare = kcalWhere((i) => Boolean(i.fried) || ['fried_snack', 'sweet', 'sugary_drink'].includes(i.group ?? ''))
  // Calories per gram of the solid food — drinks and nuts don't count (beverages
  // are always left out of energy density; nuts are dense but nourishing).
  const solid = detailed.filter((i) => i.grams && !DRINK_GROUPS.has(i.group ?? '') && i.group !== 'nuts_seeds' && !/\bml\b/i.test(i.quantity ?? ''))
  const solidGrams = sumBy(solid, (i) => i.grams ?? 0)
  const density = solidGrams >= 50 && sumBy(solid, (i) => i.calories) >= cal * 0.5 ? sumBy(solid, (i) => i.calories) / solidGrams : 0

  /** Food-quality penalties: added sugar, fried / saturated fat, very dense food. `w` weighs them (snacks 1.5×). */
  function qualityPenalty(w: number): number {
    let pen = 0
    if (sugarShare > 0.25) { pen += 2 * w; reasons.push({ tone: 'low', short: 'sugary', text: sugarShare >= 0.95 ? 'Almost all added sugar' : `High in added sugar: ${pct(sugarShare)} of the calories`, hint: 'Go for unsweetened, or fruit instead' }) }
    else if (sugarShare > 0.1) { pen += 1 * w; reasons.push({ tone: 'mid', short: 'some added sugar', text: `Some added sugar: ${pct(sugarShare)} of the calories`, hint: 'WHO suggests under 10%' }) }
    if (friedShare >= 0.3 || satShare > 0.1) { pen += 1 * w; reasons.push({ tone: 'mid', short: friedShare >= 0.3 ? 'fried' : 'rich', text: friedShare >= 0.3 ? 'Fried or very oily food' : `High in saturated fat: ${pct(satShare)} of the calories`, hint: 'Grilled, roasted or less ghee/oil next time' }) }
    if (density > 3) { pen += 1; reasons.push({ tone: 'mid', short: 'calorie-dense', text: `Calorie-dense: ${density.toFixed(1)} kcal per gram`, hint: 'Bulk it up with salad, sabzi or curd' }) }
    return pen
  }

  let total: number
  if (!snack) {
    // Protein — 3
    let protein: number
    if (proteinRatio >= 0.9) { protein = 3; reasons.push({ tone: 'good', text: `Good protein: ${Math.round(meal.protein)} g` }) }
    else {
      protein = proteinRatio >= 0.7 ? 2 : proteinRatio >= 0.4 ? 1 : 0
      reasons.push({ tone: protein >= 2 ? 'mid' : 'low', short: 'light on protein', text: `Protein ${Math.round(meal.protein)} g, about ${proteinGap} g under target for a ${meal.meal_type}`, hint: `Add ${proteinFix(proteinGap)}` })
    }
    // Portion — 2
    let portion: number
    if (sizeRatio >= 0.75 && sizeRatio <= 1.25) { portion = 2; reasons.push({ tone: 'good', text: `Good size: ${pct(dayShare)} of your daily calories`, hint: `${label} budget ≈ ${pct(share)}` }) }
    else if (sizeRatio >= 0.5 && sizeRatio < 0.75) { portion = 1; reasons.push({ tone: 'mid', short: 'on the light side', text: `Light ${meal.meal_type}: ${pct(dayShare)} of your daily calories`, hint: `${label} budget ≈ ${pct(share)}` }) }
    else if (sizeRatio < 0.5) { portion = 0; reasons.push({ tone: 'low', short: 'very light', text: `Very light ${meal.meal_type}: ${pct(dayShare)} of your daily calories`, hint: 'Was anything left out of the log?' }) }
    else if (sizeRatio <= 1.5) { portion = 1; reasons.push({ tone: 'mid', short: 'a bit big', text: `A bit big: ${pct(dayShare)} of your daily calories`, hint: `${label} budget ≈ ${pct(share)}` }) }
    else { portion = 0; reasons.push({ tone: 'low', short: 'quite heavy', text: `Heavy: ${pct(dayShare)} of your daily calories in one meal`, hint: 'Go lighter on the next one' }) }
    // Fibre & plants — 2 (neutral 1 without detail)
    let plants = 1
    if (!basic) {
      if (fiberFit >= 8) { plants = 2; reasons.push({ tone: 'good', text: `Good fibre: ${Math.round(fiber)} g` }) }
      else if (fiberFit >= 4 || plantShare >= 0.25) { plants = 1; reasons.push({ tone: 'mid', short: 'low on veg', text: `Some fibre: ${Math.round(fiber)} g`, hint: 'Add a sabzi, salad or dal' }) }
      else { plants = 0; reasons.push({ tone: 'low', short: 'no veg', text: fit < 1 ? `Low fibre for the size: ${Math.round(fiber)} g in ${Math.round(cal).toLocaleString()} kcal` : `Low fibre: ${Math.round(fiber)} g`, hint: 'Add vegetables, salad, dal or fruit' }) }
    }
    // Food quality — 2 (neutral 1 without detail)
    const quality = basic ? 1 : Math.max(0, 2 - qualityPenalty(1))
    // Balance — 1: carbs ≤ 65% and fat ≤ 40% of macro calories
    let balance = 0
    const carbShare = macroKcal ? (meal.carbs * 4) / macroKcal : 0
    const fatShare = macroKcal ? (meal.fat * 9) / macroKcal : 0
    if (macroKcal && carbShare <= 0.65 && fatShare <= 0.4) balance = 1
    else if (fatShare > 0.4) reasons.push({ tone: 'mid', short: 'fat-heavy', text: `Fat-heavy: ${pct(fatShare)} of this meal's calories` })
    else if (carbShare > 0.65) reasons.push({ tone: 'mid', short: 'carb-heavy', text: `Carb-heavy: ${pct(carbShare)} of this meal's calories` })
    total = protein + portion + plants + quality + balance
  } else {
    // Protein or plants — 4: a curd, egg or whey snack and a fruit or nuts snack both count
    const proteinPts = proteinRatio >= 0.9 ? 4 : proteinRatio >= 0.5 ? 2.5 : proteinRatio >= 0.25 ? 1 : 0
    const plantPts = basic ? 2 : plantShare >= 0.5 ? 4 : fiberFit >= 3 ? 2 : fiberFit >= 1.5 ? 1 : 0
    const nourish = Math.max(proteinPts, plantPts)
    if (proteinPts >= 4) reasons.push({ tone: 'good', text: `Protein-rich snack: ${Math.round(meal.protein)} g` })
    else if (plantPts >= 4) reasons.push({ tone: 'good', text: 'Fruit, veg or nuts — a nourishing snack' })
    else if (nourish < 2.5) reasons.push({ tone: 'low', short: 'not very filling', text: 'Little protein or fibre', hint: 'Try curd, fruit, sprouts, nuts or eggs' })
    // Size — 3: snacks are only marked down when they turn into a meal
    let size: number
    if (sizeRatio <= 1.5) size = 3
    else if (sizeRatio <= 2.5) { size = 1.5; reasons.push({ tone: 'mid', short: 'a big snack', text: `A big snack: ${pct(dayShare)} of your daily calories`, hint: 'Snacks work best around 10% of the day' }) }
    else { size = 0; reasons.push({ tone: 'low', short: 'meal-sized', text: `Meal-sized snack: ${pct(dayShare)} of your daily calories`, hint: 'Count it as a meal or go lighter' }) }
    // Food quality — 3 (neutral 1.5 without detail)
    const quality = basic ? 1.5 : Math.max(0, 3 - qualityPenalty(1.5))
    total = nourish + size + quality
  }

  let score = Math.min(10, Math.max(1, Math.round(total)))
  let override: string | null = null
  // Far too much in one sitting can't score well, whatever's in it.
  if (sizeRatio > (snack ? 2.5 : 2)) score = Math.min(score, 4)
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
  if (!basic && sugarShare >= 0.5 && !override) { score = Math.min(score, 3); override = 'Mostly sugar' }
  else if (!basic && junkShare >= 0.6 && !override) score = Math.min(score, snack ? 3 : 5)

  const tone: Tone = score >= 7 ? 'good' : score >= 5 ? 'mid' : 'low'
  // One thing that went well, then the fixes (worst first); at most three lines.
  const good = reasons.filter((r) => r.tone === 'good')
  const fixes = reasons.filter((r) => r.tone !== 'good').sort((a, b) => order(b.tone) - order(a.tone))
  const shown = [...good.slice(0, fixes.length ? 1 : 3), ...fixes].slice(0, 3)
  const weakest = fixes[0]?.short
  const band = score >= 9 ? 'Excellent' : score >= 7 ? 'Good' : score >= 5 ? 'Okay' : score >= 3 ? 'Needs work' : 'Poor'
  const headline = override ?? (score >= 9 || !weakest ? band : `${band}, ${weakest}`)
  return { score, tone, headline, reasons: shown, basic }
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
