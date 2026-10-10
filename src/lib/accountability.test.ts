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

  it('dal, rice, sabzi and salad → Good, a protein nudge', () => {
    const s = score({ calories: 650, protein: 22, carbs: 100, fat: 16, items: [
      food('Dal', 150, 180, { group: 'pulse', fiber_g: 6 }), food('Rice', 150, 200, { group: 'refined_grain', fiber_g: 1 }),
      food('Aloo gobi', 150, 200, { group: 'vegetable', fiber_g: 4, sat_fat_g: 2 }), food('Salad', 100, 70, { group: 'vegetable', fiber_g: 2 })] })
    expect(s).toMatchObject({ score: 8, headline: 'Good, light on protein' })
    expect(s.reasons.some((r) => r.hint?.startsWith('Add'))).toBe(true)
  })

  it('a whey shake and a fruit bowl are both great snacks', () => {
    expect(score({ meal_type: 'snack', calories: 120, protein: 27, carbs: 2, fat: 1, items: [food('Whey isolate', 300, 120, { group: 'protein_supplement' })] }).score).toBe(10)
    expect(score({ meal_type: 'snack', calories: 150, protein: 2, carbs: 36, fat: 1, items: [food('Fruit bowl', 250, 150, { group: 'fruit', fiber_g: 5 })] }).score).toBe(10)
  })

  it('a huge biryani: good protein, but far too big → Okay', () => {
    const s = score({ meal_type: 'dinner', calories: 1100, protein: 45, carbs: 120, fat: 45, items: [
      food('Chicken biryani', 550, 1000, { group: 'refined_grain', fiber_g: 3, sat_fat_g: 15 }), food('Raita', 100, 100, { group: 'dairy' })] })
    expect(s.score).toBe(5)
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
    expect(s.reasons.some((r) => r.text.startsWith('Calorie-dense: 5.4 kcal per gram'))).toBe(true)
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
