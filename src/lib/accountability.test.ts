import { describe, expect, it } from 'vitest'
import { dailyGoals, dayReview, mealScore, mealsByDay, proteinFix, weekSummary, type ScoredMeal } from './accountability'

const goals = dailyGoals(1940, 122) // carbs 194 g, fat 65 g
const meal = (over: Partial<ScoredMeal>): ScoredMeal => ({
  id: 'x', name: 'Meal', meal_type: 'lunch', created_at: new Date(2026, 8, 30, 13).toISOString(), photo_url: null,
  calories: 620, protein: 22, carbs: 90, fat: 14, ...over,
})

describe('dailyGoals', () => {
  it('derives carbs and fat like the plan screen', () => {
    expect(goals).toEqual({ calories: 1940, protein: 122, carbs: 194, fat: 65 })
    expect(dailyGoals(null, null).protein).toBe(125)
  })
})

describe('mealScore', () => {
  const g = dailyGoals(2200, 120) // dinner budget 660 kcal / 36 g protein; lunch 770 / 42; snack 220 / 12
  type It = NonNullable<ScoredMeal['items']>[number]
  const food = (name: string, grams: number, calories: number, d: Partial<It> = {}): It =>
    ({ name, grams, calories, fiber_g: 0, added_sugar_g: 0, sat_fat_g: 0, alcohol_g: 0, group: 'other', fried: false, ...d })
  const score = (over: Partial<ScoredMeal>) => mealScore(meal(over), g)

  it('half a bottle of vodka (older post, no detail) is mostly alcohol → 1', () => {
    const s = score({ name: 'Dinner time Grey goose vodka', meal_type: 'dinner', calories: 862, protein: 0, carbs: 0, fat: 0, items: [{ name: 'Grey Goose Vodka', grams: 375, calories: 862 }] })
    expect(s).toMatchObject({ score: 1, headline: 'Mostly alcohol', tone: 'low' })
    expect(s.reasons[0].text).toBe('≈12 standard drinks — 861 kcal from alcohol')
  })

  it('grilled chicken, rotis and salad → Excellent', () => {
    const s = score({ meal_type: 'dinner', calories: 620, protein: 45, carbs: 55, fat: 20, items: [
      food('Grilled chicken', 150, 280, { group: 'meat', sat_fat_g: 3 }), food('Roti', 80, 220, { group: 'whole_grain', fiber_g: 5 }), food('Salad', 150, 120, { group: 'vegetable', fiber_g: 4 })] })
    expect(s.score).toBeGreaterThanOrEqual(9)
    expect(s.headline).toBe('Excellent')
  })

  it('dal, rice, sabzi and salad: a balanced thali, with a protein nudge', () => {
    const s = score({ calories: 650, protein: 22, carbs: 100, fat: 16, items: [
      food('Dal', 150, 180, { group: 'pulse', fiber_g: 6 }), food('Rice', 150, 200, { group: 'refined_grain', fiber_g: 1 }),
      food('Aloo gobi', 150, 200, { group: 'vegetable', fiber_g: 4, sat_fat_g: 2 }), food('Salad', 100, 70, { group: 'vegetable', fiber_g: 2 })] })
    expect(s.score).toBe(9) // 22 g is inside the 20–40 g per-meal range; fibre, size and balance ideal
    expect(s.reasons.some((r) => r.hint?.startsWith('Add'))).toBe(true)
  })

  it('a whey shake and a fruit bowl are both great snacks', () => {
    expect(score({ meal_type: 'snack', calories: 120, protein: 27, carbs: 2, fat: 1, items: [food('Whey isolate', 300, 120, { group: 'protein_supplement' })] }).score).toBe(10)
    expect(score({ meal_type: 'snack', calories: 150, protein: 2, carbs: 36, fat: 1, items: [food('Fruit bowl', 250, 150, { group: 'fruit', fiber_g: 5 })] }).score).toBe(10)
  })

  it('a huge biryani: good protein, but far too big → capped at 6', () => {
    const s = score({ meal_type: 'dinner', calories: 1100, protein: 45, carbs: 120, fat: 45, items: [
      food('Chicken biryani', 550, 1000, { group: 'refined_grain', fiber_g: 3, sat_fat_g: 15 }), food('Raita', 100, 100, { group: 'dairy' })] })
    expect(s.score).toBe(6) // capped: over 1.5× the dinner budget
    expect(s.headline).toBe('Okay, quite heavy')
  })

  it('samosas with sweet chai: fried, sugary, dense and big → Needs work', () => {
    const s = score({ meal_type: 'snack', calories: 450, protein: 8, carbs: 55, fat: 22, items: [
      food('Samosa', 120, 360, { group: 'fried_snack', fried: true, fiber_g: 4, sat_fat_g: 6 }), food('Masala chai', 150, 90, { group: 'sugary_drink', added_sugar_g: 15 })] })
    expect(s.score).toBeLessThanOrEqual(4)
    expect(s.tone).toBe('low')
  })

  it('a can of cola is mostly sugar → at most 3', () => {
    const s = score({ meal_type: 'snack', calories: 139, protein: 0, carbs: 35, fat: 0, items: [food('Coca-Cola', 330, 139, { group: 'sugary_drink', added_sugar_g: 35 })] })
    expect(s.score).toBeLessThanOrEqual(3)
    expect(s.headline).toBe('Mostly sugar')
  })

  it('a good dinner with two beers loses 2 and is capped at 5', () => {
    const s = score({ meal_type: 'dinner', calories: 900, protein: 45, carbs: 80, fat: 22, items: [
      food('Chicken tikka', 200, 350, { group: 'meat' }), food('Roti', 80, 220, { group: 'whole_grain', fiber_g: 5 }), food('Salad', 150, 60, { group: 'vegetable', fiber_g: 4 }),
      food('Beer', 660, 270, { group: 'alcohol', alcohol_g: 26 })] })
    expect(s.score).toBeLessThanOrEqual(5)
    expect(s.reasons.some((r) => r.text === 'Includes ≈3 standard drinks (182 kcal)')).toBe(true) // the AI's 26 g, not a guess
  })

  it('quantity counts: one bowl of biryani vs three', () => {
    const bowl = (n: number) => score({ meal_type: 'dinner', calories: 450 * n, protein: 20 * n, carbs: 55 * n, fat: 16 * n, items: [food('Chicken biryani', 250 * n, 450 * n, { group: 'refined_grain', fiber_g: 2 * n, sat_fat_g: 4 * n })] })
    expect(bowl(1).score!).toBeGreaterThan(bowl(3).score!)
    expect(bowl(3).reasons.some((r) => r.text.startsWith('Heavy'))).toBe(true)
  })

  it('calorie-dense food is flagged per gram', () => {
    const s = score({ meal_type: 'snack', calories: 270, protein: 3, carbs: 27, fat: 17, items: [food('Potato chips', 50, 270, { group: 'fried_snack', fried: true, sat_fat_g: 7 })] })
    expect(s.reasons.some((r) => r.text === 'Fried or very oily food')).toBe(true)
    expect(s.score).toBeLessThanOrEqual(3) // mostly fried → junk-food cap
  })

  it('does not score black coffee', () => {
    expect(score({ meal_type: 'snack', calories: 5, protein: 0, carbs: 0, fat: 0 })).toMatchObject({ score: null, headline: 'Too light to score' })
  })

  it('older posts without detail get a basic score; rumali roti is not rum', () => {
    const s = score({ meal_type: 'dinner', name: 'Rumali roti and chicken', calories: 600, protein: 40, carbs: 50, fat: 22 })
    expect(s.basic).toBe(true)
    expect(s.score).toBe(8) // protein 3 + portion 2 + neutral 1 + neutral 1 + balance 1
    expect(s.headline).toBe('Good')
  })
})

describe('mealScore — edge cases', () => {
  type It = NonNullable<ScoredMeal['items']>[number]
  const food = (name: string, grams: number, calories: number, d: Partial<It> = {}): It =>
    ({ name, grams, calories, fiber_g: 0, added_sugar_g: 0, sat_fat_g: 0, alcohol_g: 0, group: 'other', fried: false, ...d })
  const m = (over: Partial<ScoredMeal>) => meal({ name: 'Meal', ...over })
  const high = dailyGoals(2500, 180) // a lifter with a big protein goal
  const small = dailyGoals(1500, 90)

  it('a protein-heavy "snack" that is really a meal is scored as a meal (feed: 528 kcal, 43 g)', () => {
    const s = mealScore(m({ meal_type: 'snack', calories: 528, protein: 43, carbs: 47, fat: 18 }), high)
    expect(s.note).toBe('Meal-sized snack — scored as a meal')
    expect(s.score).toBeGreaterThanOrEqual(7)
  })
  it('the same for a smaller goal (feed: 350 kcal, 26 g on 1,500 kcal/day)', () => {
    expect(mealScore(m({ meal_type: 'snack', calories: 350, protein: 26, carbs: 45, fat: 6 }), small).score).toBeGreaterThanOrEqual(7)
  })
  it('per-meal protein target is capped at 40 g, so a big daily goal does not sink normal meals', () => {
    const s = mealScore(m({ meal_type: 'lunch', calories: 480, protein: 24, carbs: 48, fat: 22 }), high)
    expect(s.score).toBeGreaterThanOrEqual(5)
    expect(s.reasons.some((r) => r.text === 'Protein 24 g — aim for about 40 g in a lunch')).toBe(true)
  })
  it('and floored at 20 g for small goals', () => {
    const s = mealScore(m({ meal_type: 'lunch', calories: 300, protein: 10, carbs: 40, fat: 8 }), dailyGoals(1200, 40))
    expect(s.reasons.some((r) => r.text.includes('aim for about 20 g'))).toBe(true)
  })
  it('does not score calories typed in without macros', () => {
    expect(mealScore(m({ calories: 500, protein: 0, carbs: 0, fat: 0 }), goals)).toMatchObject({ score: null, headline: 'Not enough detail to score' })
  })
  it('one small drink is still mostly alcohol, but 2 not 1', () => {
    const s = mealScore(m({ name: 'Whisky', meal_type: 'dinner', calories: 64, protein: 0, carbs: 0, fat: 0, items: [food('Whisky', 30, 64, { group: 'alcohol', alcohol_g: 9.5 })] }), goals)
    expect(s).toMatchObject({ score: 2, headline: 'Mostly alcohol' })
  })
  it('alcohol-free beer, ginger tea, rumali roti, kale and beer-battered fish are not drinks', () => {
    const noAlc = (name: string, c: number, p: number, cb: number, f: number) => mealScore(m({ name, meal_type: 'snack', calories: c, protein: p, carbs: cb, fat: f }), goals).headline
    expect(noAlc('Alcohol-free beer', 60, 1, 14, 0)).not.toBe('Mostly alcohol')
    expect(noAlc('Ginger tea', 60, 2, 10, 1)).not.toBe('Mostly alcohol')
    expect(noAlc('Rumali roti', 240, 7, 45, 3)).not.toBe('Mostly alcohol')
    expect(noAlc('Kale salad', 120, 4, 10, 7)).not.toBe('Mostly alcohol')
    expect(noAlc('Beer-battered fish', 400, 25, 30, 20)).not.toBe('Mostly alcohol')
  })
  it('fruit juice counts as free sugar', () => {
    const s = mealScore(m({ meal_type: 'snack', calories: 115, protein: 1, carbs: 28, fat: 0, items: [food('Orange juice', 250, 115, { group: 'sugary_drink', added_sugar_g: 21 })] }), goals)
    expect(s.headline).toBe('Mostly sugar')
  })
  it('nuts are dense but nourishing — not flagged as calorie-dense', () => {
    const s = mealScore(m({ meal_type: 'snack', calories: 175, protein: 6, carbs: 6, fat: 15, items: [food('Almonds', 30, 175, { group: 'nuts_seeds', fiber_g: 4, sat_fat_g: 1 })] }), goals)
    expect(s.score).toBeGreaterThanOrEqual(8)
    expect(s.reasons.some((r) => r.text.startsWith('Calorie-dense'))).toBe(false)
  })
  it('a keto plate is flagged as fat-heavy', () => {
    const s = mealScore(m({ meal_type: 'dinner', calories: 650, protein: 35, carbs: 8, fat: 53 }), goals)
    expect(s.reasons.some((r) => r.text.startsWith('Fat-heavy'))).toBe(true)
  })
  it('ghee-heavy food is flagged for saturated fat', () => {
    const s = mealScore(m({ meal_type: 'lunch', calories: 600, protein: 25, carbs: 70, fat: 24, items: [food('Dal makhani', 300, 450, { group: 'pulse', fiber_g: 9, sat_fat_g: 14 }), food('Jeera rice', 120, 150, { group: 'refined_grain' })] }), goals)
    expect(s.reasons.some((r) => r.text.startsWith('High in saturated fat'))).toBe(true)
  })
  it('a tiny lunch asks whether anything was left out', () => {
    const s = mealScore(m({ meal_type: 'lunch', calories: 150, protein: 6, carbs: 20, fat: 5 }), goals)
    expect(s.reasons.some((r) => r.hint === 'Was anything left out of the log?')).toBe(true)
  })
  it('a meal with a hand-added item (no AI detail) gets the basic score', () => {
    const s = mealScore(m({ calories: 600, protein: 30, carbs: 60, fat: 25, items: [food('Rice', 150, 200), { name: 'Mom’s special curry', grams: 250, calories: 400 }] }), goals)
    expect(s.basic).toBe(true)
  })
  it('more of the same food never scores better once past the budget', () => {
    const plate = (k: number) => mealScore(m({ meal_type: 'dinner', calories: 600 * k, protein: 35 * k, carbs: 60 * k, fat: 22 * k, items: [food('Chicken curry', 250 * k, 350 * k, { group: 'meat', fiber_g: 2 * k, sat_fat_g: 5 * k }), food('Roti', 80 * k, 250 * k, { group: 'whole_grain', fiber_g: 5 * k })] }), goals).score!
    const scores = [1, 1.25, 1.5, 2, 2.5, 3].map(plate)
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1])
  })
  it('always returns a whole 1–10 or null, for any input', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const types = ['breakfast', 'lunch', 'dinner', 'snack'] as const
    for (let n = 0; n < 500; n++) {
      const c = Math.round(rnd() * 2500), p = Math.round(rnd() * 120), cb = Math.round(rnd() * 250), f = Math.round(rnd() * 100)
      const items = rnd() > 0.5 ? [food('Thing', Math.round(rnd() * 600), c, { fiber_g: rnd() * 20, added_sugar_g: rnd() * 60, sat_fat_g: rnd() * 30, alcohol_g: rnd() > 0.9 ? rnd() * 80 : 0, fried: rnd() > 0.7 })] : undefined
      const s = mealScore(m({ meal_type: types[n % 4], calories: c, protein: p, carbs: cb, fat: f, items }), dailyGoals(1200 + Math.round(rnd() * 2300), Math.round(rnd() * 250)))
      if (s.score !== null) { expect(Number.isInteger(s.score)).toBe(true); expect(s.score).toBeGreaterThanOrEqual(1); expect(s.score).toBeLessThanOrEqual(10) }
      expect(s.headline.length).toBeGreaterThan(0)
      expect(s.reasons.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('proteinFix', () => {
  it('suggests everyday foods that roughly cover the gap', () => {
    expect(proteinFix(28)).toBe('100 g paneer + 2 boiled eggs ≈ 30 g')
    expect(proteinFix(10)).toBe('2 boiled eggs ≈ 12 g')
    expect(proteinFix(4)).toBe('a bowl of dal ≈ 9 g')
  })
})

describe('dayReview', () => {
  const meals = [meal({ meal_type: 'breakfast', calories: 380, protein: 24, carbs: 30, fat: 18 }), meal({ calories: 680 }), meal({ meal_type: 'dinner', calories: 720, protein: 48, carbs: 60, fat: 39 })]
  it('scores calories, protein and meals logged', () => {
    const r = dayReview(meals, goals, false)
    expect(r.rows[0]).toMatchObject({ planned: 1940, eaten: 1780, gap: -160, tone: 'good' })
    expect(r.rows[1]).toMatchObject({ eaten: 94, gap: -28, tone: 'mid' })
    expect(r.score).toBe(85) // 40 + 25 + 20
    expect(r.summary).toBe('Calories were right, protein fell short.')
    expect(r.missing[0].text).toBe('28 g protein short')
    expect(r.label).toBe('Mostly on track')
  })
  it('takes 25 points off a heavy drinking day and says why', () => {
    const vodka = meal({ name: 'Grey goose vodka', meal_type: 'dinner', calories: 862, protein: 0, carbs: 0, fat: 0 })
    const r = dayReview([...meals, vodka], goals, false)
    expect(r.missing[0].text).toBe('≈12 standard drinks today')
    expect(r.score).toBeLessThanOrEqual(75 - 25 + 20)
    expect(r.label).not.toBe('Nailed it')
  })
  it('handles an empty day and a day still in progress', () => {
    expect(dayReview([], goals, true)).toMatchObject({ score: null, label: 'Nothing logged yet', roomKcal: 1940 })
    const today = dayReview(meals.slice(0, 1), goals, true)
    expect(today.missing.some((m) => m.text === '1,560 kcal left today')).toBe(true)
  })
})

describe('last 7 days', () => {
  it('buckets by day (today last) and summarises logged days', () => {
    const now = new Date(2026, 8, 30, 20) // Wed 30 Sep → window Thu 24 – Wed 30
    const days = mealsByDay([meal({ created_at: new Date(2026, 8, 24, 9).toISOString() }), meal({ created_at: new Date(2026, 8, 30, 9).toISOString() }), meal({ created_at: new Date(2026, 8, 23, 9).toISOString() })], now)
    expect(days.map((d) => d.length)).toEqual([1, 0, 0, 0, 0, 0, 1])
    const w = weekSummary(days, goals)
    expect(w.scores.filter((s) => s != null)).toHaveLength(2)
    expect(w.daysLogged).toBe(2)
    expect(w.mealsPerDay).toBe(1)
  })
})
