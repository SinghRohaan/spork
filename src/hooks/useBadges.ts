import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { dailyGoals, type ScoredMeal } from '../lib/accountability'
import { computeBadges } from '../lib/badges'
import { DEFAULT_WATER_GOAL_ML } from '../lib/water'
import { useCurrentUser } from './useCurrentUser'

/** The viewer's badges, worked out from all their meals and water days. */
export function useBadges() {
  const { data: user } = useCurrentUser()
  const userId = user?.id

  const query = useQuery({
    queryKey: ['badges', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const [logs, water] = await Promise.all([
        supabase.from('logs')
          .select('id, meal_type, created_at, calories_final, calories_estimate, protein_final_g, protein_estimate_g, carbs_final_g, carbs_estimate_g, fat_final_g, fat_estimate_g')
          .eq('user_id', userId!).order('created_at').limit(5000),
        // Before migration 0016 there's no water table — water badges just stay locked.
        supabase.from('water_logs').select('logged_on, ml').eq('user_id', userId!),
      ])
      if (logs.error) throw logs.error
      const meals = (logs.data ?? []).map((l): ScoredMeal => ({
        id: l.id, name: null, meal_type: l.meal_type, created_at: l.created_at, photo_url: null,
        calories: Number(l.calories_final ?? l.calories_estimate ?? 0),
        protein: Number(l.protein_final_g ?? l.protein_estimate_g ?? 0),
        carbs: Number(l.carbs_final_g ?? l.carbs_estimate_g ?? 0),
        fat: Number(l.fat_final_g ?? l.fat_estimate_g ?? 0),
      }))
      return { meals, water: water.error ? [] : (water.data ?? []) }
    },
  })

  const badges = query.data && user
    ? computeBadges({ ...query.data, goals: dailyGoals(user.calorie_goal, user.protein_goal), waterGoalMl: user.water_goal_ml ?? DEFAULT_WATER_GOAL_ML })
    : null
  return { ...query, badges }
}
