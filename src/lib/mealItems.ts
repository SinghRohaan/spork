/**
 * The items shown when you swipe a post: what was in the meal, with each
 * item's calories and macros.
 */
import { parseEstimateResponse, parseItems, type ParsedEstimateItem } from './parseEstimate'

export interface MealItem {
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
}

function toItem(i: ParsedEstimateItem): MealItem {
  return { name: i.name, quantity: i.quantity, grams: i.grams, calories: i.calories, protein_g: i.protein_g, carbs_g: i.carbs_g, fat_g: i.fat_g }
}

/**
 * The post's items, or [] when we can't show them truthfully. Saved items
 * (migration 0018) win; older posts fall back to the AI's list. Either way
 * the items must add up to the posted calories (within 5%) — if the user
 * typed different totals, a list that doesn't match would mislead.
 */
export function postedItems(log: LogLike): MealItem[] {
  const total = log.calories_final ?? log.calories_estimate ?? 0
  const saved = parseItems(log.items)
  const items = saved.length ? saved : (parseEstimateResponse(log.ai_raw_response)?.items ?? [])
  if (!items.length || total <= 0) return []
  const sum = items.reduce((t, i) => t + i.calories, 0)
  return Math.abs(sum - total) <= Math.max(10, total * 0.05) ? items.map(toItem) : []
}

/** Items to save with a new post: the review screen's list, scaled by the portion picked. */
export function itemsForPost(items: ParsedEstimateItem[], multiplier: number): MealItem[] | null {
  if (!items.length) return null
  const k = (n: number) => Math.round(n * multiplier)
  return items.map((i) => ({ ...toItem(i), grams: i.grams == null ? null : k(i.grams), calories: k(i.calories), protein_g: k(i.protein_g), carbs_g: k(i.carbs_g), fat_g: k(i.fat_g) }))
}

// First match wins, so specific words come before general ones.
const EMOJI: [RegExp, string][] = [
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
