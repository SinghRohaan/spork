import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { signMealPhotos } from '../lib/mealPhotos'
import { localDateKey } from '../lib/progress'
import { dailyGoals, mealsByDay, weekStart, type ScoredMeal } from '../lib/accountability'
import { postedItems } from '../lib/mealItems'
import { useCurrentUser } from './useCurrentUser'

/** The viewer's meals for the last 7 days (today last), bucketed by day, plus their goals. */
export function useWeekMeals({ withPhotos = false } = {}) {
  const { data: user } = useCurrentUser()
  const userId = user?.id
  const dayKey = localDateKey(new Date())

  const query = useQuery({
    queryKey: ['weekMeals', userId, dayKey, withPhotos],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('logs')
        .select('id, name, meal_type, created_at, photo_url, items, calories_final, calories_estimate, protein_final_g, protein_estimate_g, carbs_final_g, carbs_estimate_g, fat_final_g, fat_estimate_g')
        .eq('user_id', userId!).gte('created_at', weekStart().toISOString())
      if (error) throw error
      const meals = (data ?? []).map((l): ScoredMeal => ({
        id: l.id, name: l.name, meal_type: l.meal_type, created_at: l.created_at, photo_url: l.photo_url,
        calories: Number(l.calories_final ?? l.calories_estimate ?? 0),
        protein: Number(l.protein_final_g ?? l.protein_estimate_g ?? 0),
        carbs: Number(l.carbs_final_g ?? l.carbs_estimate_g ?? 0),
        fat: Number(l.fat_final_g ?? l.fat_estimate_g ?? 0),
        items: postedItems({ ...l, ai_raw_response: null }),
      }))
      const photos = withPhotos ? await signMealPhotos(meals.map((m) => m.photo_url).filter((p): p is string => Boolean(p))) : new Map<string, string>()
      return { days: mealsByDay(meals), photos }
    },
  })

  return { ...query, goals: user ? dailyGoals(user.calorie_goal, user.protein_goal) : null }
}
