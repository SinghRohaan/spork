import { describe, expect, it } from 'vitest'
import { computeBadges } from './badges'
import type { ScoredMeal } from './accountability'

const goals = { calories: 2000, protein: 120, carbs: 200, fat: 67 }
const now = new Date(2026, 9, 20, 21, 0)
let id = 0
/** A meal `daysAgo` days before `now`, at `hour`. */
function meal(daysAgo: number, hour: number, calories: number, protein: number, meal_type: ScoredMeal['meal_type'] = 'lunch'): ScoredMeal {
  const at = new Date(2026, 9, 20 - daysAgo, hour, 0)
  return { id: String(id++), name: null, meal_type, created_at: at.toISOString(), photo_url: null, calories, protein, carbs: 0, fat: 0 }
}
/** Three meals that score 100: calories and protein on target. */
const perfect = (daysAgo: number) => [meal(daysAgo, 8, 600, 40, 'breakfast'), meal(daysAgo, 13, 700, 40), meal(daysAgo, 20, 700, 40, 'dinner')]
const get = (badges: ReturnType<typeof computeBadges>, badgeId: string) => badges.find((b) => b.id === badgeId)!

describe('computeBadges', () => {
  it('earns nothing with no history', () => {
    const badges = computeBadges({ meals: [], water: [], goals, waterGoalMl: 2500, now })
    expect(badges.every((b) => b.earnedOn === null)).toBe(true)
  })

  it('earns First Bite and Perfect Day today', () => {
    const badges = computeBadges({ meals: perfect(0), water: [], goals, waterGoalMl: 2500, now })
    expect(get(badges, 'first_bite').earnedOn).toBe('2026-10-20')
    expect(get(badges, 'perfect_day')).toMatchObject({ earnedOn: '2026-10-20', times: 1 })
  })

  it('counts a 7-day streak and dates it on the 7th day', () => {
    const meals = [6, 5, 4, 3, 2, 1, 0].map((d) => meal(d, 13, 500, 20))
    const badges = computeBadges({ meals, water: [], goals, waterGoalMl: 2500, now })
    expect(get(badges, 'streak_7').earnedOn).toBe('2026-10-20')
    expect(get(badges, 'streak_30')).toMatchObject({ earnedOn: null, progress: 7 })
  })

  it('breaks a streak on a missed day', () => {
    const meals = [7, 6, 5, 3, 2, 1, 0].map((d) => meal(d, 13, 500, 20))
    expect(get(computeBadges({ meals, water: [], goals, waterGoalMl: 2500, now }), 'streak_7')).toMatchObject({ earnedOn: null, progress: 4 })
  })

  it('earns Clean Week for 7 days in a row scored 80+', () => {
    const meals = [6, 5, 4, 3, 2, 1, 0].flatMap(perfect)
    expect(get(computeBadges({ meals, water: [], goals, waterGoalMl: 2500, now }), 'clean_week').earnedOn).toBe('2026-10-20')
  })

  it('earns water and early-bird badges', () => {
    const water = [{ logged_on: '2026-10-19', ml: 2500 }, { logged_on: '2026-10-20', ml: 1000 }]
    const meals = [4, 3, 2, 1, 0].map((d) => meal(d, 8, 400, 20, 'breakfast'))
    const badges = computeBadges({ meals, water, goals, waterGoalMl: 2500, now })
    expect(get(badges, 'hydrated').earnedOn).toBe('2026-10-19')
    expect(get(badges, 'hydration_hero').progress).toBe(1)
    expect(get(badges, 'early_bird').earnedOn).toBe('2026-10-20')
  })
})
