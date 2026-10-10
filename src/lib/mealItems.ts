/**
 * The items shown when you swipe a post: what was in the meal, with each
 * item's calories and macros.
 */
import { parseEstimateResponse, parseItems, type ItemDetail, type ParsedEstimateItem } from './parseEstimate'

export interface MealItem extends ItemDetail {
  name: string
  quantity: string | null
  grams: number | null
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

interface LogLike {
  items?: unknown
  ai_raw_response: unknown
  calories_final: number | null
  calories_estimate: number | null
  protein_final_g?: number | null
  protein_estimate_g?: number | null
  carbs_final_g?: number | null
  carbs_estimate_g?: number | null
  fat_final_g?: number | null
  fat_estimate_g?: number | null
}

const DETAIL_KEYS = ['fiber_g', 'added_sugar_g', 'sat_fat_g', 'alcohol_g', 'group', 'fried'] as const

function toItem(i: ParsedEstimateItem): MealItem {
  const item: MealItem = { name: i.name, quantity: i.quantity, grams: i.grams, calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g }
  for (const k of DETAIL_KEYS) if (i[k] != null) Object.assign(item, { [k]: i[k] })
  return item
}

/** Scales an item's gram-based detail (fibre, sugar, sat fat, alcohol) by `k`. */
export function scaleDetail<T extends ItemDetail>(item: T, k: number): T {
  const r1 = (n: number | null | undefined) => (n == null ? n : Math.round(n * k * 10) / 10)
  return { ...item, fiber_g: r1(item.fiber_g), added_sugar_g: r1(item.added_sugar_g), sat_fat_g: r1(item.sat_fat_g), alcohol_g: r1(item.alcohol_g) }
}

/** Whether the items' sum is close enough to the posted total to show both. */
const adds = (sum: number, total: number, slack: number) => Math.abs(sum - total) <= Math.max(slack, total * 0.05)

/**
 * The post's items, or [] when we can't show them truthfully. Saved items
 * (migration 0018) win; older posts fall back to the AI's list. Either way
 * the items must add up to the posted calories, protein, carbs and fat
 * (within 5%) — if the totals were typed differently, a list that doesn't
 * match would mislead.
 */
export function postedItems(log: LogLike): MealItem[] {
  const total = log.calories_final ?? log.calories_estimate ?? 0
  const saved = parseItems(log.items)
  const items = saved.length ? saved : (parseEstimateResponse(log.ai_raw_response)?.items ?? [])
  if (!items.length || total <= 0) return []
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => items.reduce((t, i) => t + i[k], 0)
  const macro = (final: number | null | undefined, estimate: number | null | undefined) => final ?? estimate
  const checks: [number, number | null | undefined][] = [
    [sum('protein_g'), macro(log.protein_final_g, log.protein_estimate_g)],
    [sum('carbs_g'), macro(log.carbs_final_g, log.carbs_estimate_g)],
    [sum('fat_g'), macro(log.fat_final_g, log.fat_estimate_g)],
  ]
  const matches = adds(sum('calories'), total, 10) && checks.every(([s, t]) => t == null || adds(s, t, 1))
  return matches ? items.map(toItem) : []
}

/** Items to save with a new post: the review screen's list, scaled by the portion picked. */
export function itemsForPost(items: ParsedEstimateItem[], multiplier: number): MealItem[] | null {
  if (!items.length) return null
  const k = (n: number) => Math.round(n * multiplier)
  return items.map((i) => {
    const scaled = { ...scaleDetail(toItem(i), multiplier), grams: i.grams == null ? null : k(i.grams), calories: k(i.calories), protein_g: k(i.protein_g), carbs_g: k(i.carbs_g), fat_g: k(i.fat_g) }
    for (const key of DETAIL_KEYS) if (scaled[key] == null) delete scaled[key]
    return scaled
  })
}

// First match wins, so specific words come before general ones.
const EMOJI: [RegExp, string][] = [
  [/\b(beer|lager|ale|stout|cider)\b/, '🍺'],
  [/\b(wine|champagne|prosecco|sangria)\b/, '🍷'],
  [/\b(vodka|whiske?y|scotch|bourbon|rum|gin|tequila|brandy|cognac|cocktail|margarita|mojito|martini|liquor|breezer|shot)\b/, '🍸'],
  [/egg|omelet|bhurji/, '🥚'],
  [/chicken|tikka|tandoori|wing/, '🍗'],
  [/fish|salmon|tuna|prawn|shrimp/, '🐟'],
  [/mutton|lamb|beef|pork|steak|keema|meat|bacon|sausage/, '🥩'],
  [/paneer|tofu|cheese/, '🧀'],
  [/curd|dahi|yogurt|yoghurt|raita|lassi|muesli|oats|cereal|granola/, '🥣'],
  [/milk|shake|smoothie|whey|protein powder|scoop/, '🥛'],
  [/coffee|latte|cappuccino|espresso/, '☕'],
  [/tea|chai/, '🍵'],
  [/rice|biryani|pulao|khichdi/, '🍚'],
  [/roti|chapati|naan|paratha|bread|toast|sandwich|wrap|kulcha|bhatura|puri/, '🫓'],
  [/dosa|idli|uttapam|appam/, '🥞'],
  [/dal|sambar|rajma|chana|chole|lentil|beans/, '🍲'],
  [/curry|sabzi|gravy|masala|korma|stew/, '🍛'],
  [/noodle|ramen|maggi|pasta|spaghetti/, '🍝'],
  [/pizza/, '🍕'],
  [/burger/, '🍔'],
  [/fries|chips/, '🍟'],
  [/salad|lettuce|spinach|cucumber|sprout/, '🥗'],
  [/banana/, '🍌'],
  [/apple/, '🍎'],
  [/mango/, '🥭'],
  [/fruit|berry|grape|orange|papaya|melon/, '🍓'],
  [/nut|almond|cashew|peanut|walnut|seed/, '🥜'],
  [/chocolate|cake|cookie|sweet|dessert|ice cream|gulab|laddu|halwa|mithai/, '🍫'],
  [/juice|soda|cola|drink/, '🧃'],
  [/potato|aloo/, '🥔'],
]

export function foodEmoji(name: string): string {
  const n = name.toLowerCase()
  // Words must start at a word boundary, so "steamed" isn't "tea".
  return EMOJI.find(([re]) => new RegExp(`\\b(?:${re.source})`).test(n))?.[1] ?? '🍽️'
}
