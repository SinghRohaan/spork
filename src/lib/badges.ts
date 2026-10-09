/**
 * Badges, worked out from the user's own history (meals + water) — nothing
 * extra is stored. Each badge records the day it was first earned, so it
 * stays earned even if goals change later.
 */
import { dayReview, type Goals, type ScoredMeal } from './accountability'
import { localDateKey } from './progress'

export interface BadgeDef {
  id: string
  name: string
  emoji: string
  /** Light → dark medal colours. */
  colors: [string, string]
  /** How to earn it, shown before it's unlocked. */
  how: string
  /** What you did, shown once it's unlocked. */
  done: string
  target: number
}

export interface Badge extends BadgeDef {
  /** Progress towards `target` (capped). */
  progress: number
  /** Local date key (YYYY-MM-DD) it was first earned, or null. */
  earnedOn: string | null
  /** How many times it's been earned (repeatable badges only). */
  times: number
}

const GOLD: [string, string] = ['#ffe28a', '#c9922a']
const PINK: [string, string] = ['#ff9bcb', '#c2477f']
const ORANGE: [string, string] = ['#ffb36b', '#d0581c']
const BLUE: [string, string] = ['#9ad0ff', '#2f74d0']
const TEAL: [string, string] = ['#8ff3e6', '#109b8d']
const PURPLE: [string, string] = ['#c9b3ff', '#6b4fd0']

export const BADGES: BadgeDef[] = [
  { id: 'first_bite', name: 'First Bite', emoji: '🍴', colors: TEAL, how: 'Log your first meal', done: 'Logged your first meal', target: 1 },
  { id: 'perfect_day', name: 'Perfect Day', emoji: '🎯', colors: GOLD, how: 'Score 100 on a day — calories and protein on target, 3+ meals', done: 'Scored a perfect 100 day', target: 1 },
  { id: 'protein_pro', name: 'Protein Pro', emoji: '💪', colors: PINK, how: 'Hit your protein goal on 7 days', done: 'Hit your protein goal on 7 days', target: 7 },
  { id: 'on_target', name: 'Bullseye', emoji: '🏹', colors: GOLD, how: 'Land within 10% of your calorie goal on 7 days', done: 'Landed on your calorie goal 7 times', target: 7 },
  { id: 'clean_week', name: 'Clean Week', emoji: '🏆', colors: PURPLE, how: 'Score 80+ seven days in a row', done: 'Scored 80+ seven days in a row', target: 7 },
  { id: 'streak_7', name: 'On Fire', emoji: '🔥', colors: ORANGE, how: 'Log meals 7 days in a row', done: 'Logged 7 days in a row', target: 7 },
  { id: 'streak_30', name: 'Unstoppable', emoji: '⚡', colors: ORANGE, how: 'Log meals 30 days in a row', done: 'Logged 30 days in a row', target: 30 },
  { id: 'streak_100', name: 'Centurion', emoji: '👑', colors: GOLD, how: 'Log meals 100 days in a row', done: 'Logged 100 days in a row', target: 100 },
  { id: 'hydrated', name: 'Hydrated', emoji: '💧', colors: BLUE, how: 'Hit your water goal for a day', done: 'Hit your water goal', target: 1 },
  { id: 'hydration_hero', name: 'Hydration Hero', emoji: '🌊', colors: BLUE, how: 'Hit your water goal on 7 days', done: 'Hit your water goal on 7 days', target: 7 },
  { id: 'early_bird', name: 'Early Bird', emoji: '🌅', colors: TEAL, how: 'Log breakfast before 9 am on 5 days', done: 'Logged breakfast before 9 am on 5 days', target: 5 },
  { id: 'century_club', name: 'Century Club', emoji: '💯', colors: PURPLE, how: 'Log 100 meals', done: 'Logged 100 meals', target: 100 },
]

export interface BadgeInput {
  meals: ScoredMeal[]
  water: { logged_on: string; ml: number }[]
  goals: Goals
  waterGoalMl: number
  now?: Date
}

/** The date key where a running count first reaches `target`, scanning days in order. */
function reachedOn(days: string[], target: number): string | null {
  return days.length >= target ? days[target - 1] : null
}

/** Longest run of consecutive calendar days, and the day each run length was first reached. */
function runs(days: string[]): { longest: number; firstReached: Map<number, string> } {
  const firstReached = new Map<number, string>()
  let longest = 0, run = 0, prev: string | null = null
  for (const day of days) {
    const next = prev && localDateKey(new Date(new Date(`${prev}T12:00`).getTime() + 86_400_000)) === day
    run = next ? run + 1 : 1
    if (!firstReached.has(run)) firstReached.set(run, day)
    longest = Math.max(longest, run)
    prev = day
  }
  return { longest, firstReached }
}

export function computeBadges({ meals, water, goals, waterGoalMl, now = new Date() }: BadgeInput): Badge[] {
  const today = localDateKey(now)
  const sorted = [...meals].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byDay = new Map<string, ScoredMeal[]>()
  for (const m of sorted) {
    const key = localDateKey(new Date(m.created_at))
    byDay.set(key, [...(byDay.get(key) ?? []), m])
  }
  const loggedDays = [...byDay.keys()].sort()

  const perfectDays: string[] = [], proteinDays: string[] = [], targetDays: string[] = [], goodDays: string[] = []
  for (const day of loggedDays) {
    const review = dayReview(byDay.get(day)!, goals, day === today)
    const row = (k: string) => review.rows.find((r) => r.key === k)!
    if (review.score === 100) perfectDays.push(day)
    if (row('protein').eaten >= goals.protein * 0.9) proteinDays.push(day)
    if (Math.abs(row('calories').eaten - goals.calories) <= goals.calories * 0.1) targetDays.push(day)
    if ((review.score ?? 0) >= 80) goodDays.push(day)
  }
  const waterDays = water.filter((w) => w.ml >= waterGoalMl).map((w) => w.logged_on).sort()
  const earlyDays = loggedDays.filter((day) => byDay.get(day)!.some((m) => m.meal_type === 'breakfast' && new Date(m.created_at).getHours() < 9))
  const streak = runs(loggedDays)
  const clean = runs(goodDays)

  const counted = (days: string[], target: number) => ({ progress: days.length, earnedOn: reachedOn(days, target), times: days.length })
  const ran = (r: ReturnType<typeof runs>, target: number) => ({ progress: r.longest, earnedOn: r.firstReached.get(target) ?? null, times: 0 })
  const mealDays = sorted.map((m) => localDateKey(new Date(m.created_at)))

  const state: Record<string, { progress: number; earnedOn: string | null; times: number }> = {
    first_bite: { ...counted(mealDays, 1), times: 0 },
    perfect_day: counted(perfectDays, 1),
    protein_pro: { ...counted(proteinDays, 7), times: 0 },
    on_target: { ...counted(targetDays, 7), times: 0 },
    clean_week: ran(clean, 7),
    streak_7: ran(streak, 7),
    streak_30: ran(streak, 30),
    streak_100: ran(streak, 100),
    hydrated: counted(waterDays, 1),
    hydration_hero: { ...counted(waterDays, 7), times: 0 },
    early_bird: { ...counted(earlyDays, 5), times: 0 },
    century_club: { ...counted(mealDays, 100), times: 0 },
  }
  return BADGES.map((def) => {
    const s = state[def.id]
    return { ...def, progress: Math.min(s.progress, def.target), earnedOn: s.earnedOn, times: s.times }
  })
}

/** "9 Oct" from a date key. */
export function badgeDate(key: string): string {
  return new Date(`${key}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
