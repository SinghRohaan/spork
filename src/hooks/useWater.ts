import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { localDateKey } from '../lib/progress'
import { DEFAULT_GLASS_ML, DEFAULT_WATER_GOAL_ML } from '../lib/water'
import { useCurrentUser } from './useCurrentUser'

/** Today's water total (null = the 0016 migration hasn't run, so the card hides) plus goal and glass size. */
export function useWater() {
  const { data: user } = useCurrentUser()
  const userId = user?.id
  const day = localDateKey(new Date())
  const query = useQuery({
    queryKey: ['water', userId, day],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.from('water_logs').select('ml').eq('user_id', userId!).eq('logged_on', day).maybeSingle()
      if (error) return null
      return data?.ml ?? 0
    },
  })
  return {
    ml: query.data,
    goalMl: user?.water_goal_ml ?? DEFAULT_WATER_GOAL_ML,
    glassMl: user?.water_glass_ml ?? DEFAULT_GLASS_ML,
    isLoading: query.isLoading,
  }
}

/** Saves run one after another, so quick taps can't land out of order. */
let saveChain: Promise<unknown> = Promise.resolve()

/** Save today's total. Updates the card instantly; rolls back if the save fails. */
export function useSetWater() {
  const queryClient = useQueryClient()
  const { data: user } = useCurrentUser()
  return useMutation({
    mutationFn: (ml: number) => {
      const save = saveChain.catch(() => null).then(async () => {
        const { error } = await supabase.from('water_logs')
          .upsert({ user_id: user!.id, logged_on: localDateKey(new Date()), ml, updated_at: new Date().toISOString() }, { onConflict: 'user_id,logged_on' })
        if (error) throw error
      })
      saveChain = save
      return save
    },
    onMutate: async (ml) => {
      const key = ['water', user?.id, localDateKey(new Date())]
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<number | null>(key)
      queryClient.setQueryData(key, ml)
      return { key, previous }
    },
    onError: (_e, _ml, ctx) => { if (ctx) queryClient.setQueryData(ctx.key, ctx.previous) },
    // Water badges may have just been earned.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['badges'] }),
  })
}

export function useWaterSettings() {
  const queryClient = useQueryClient()
  const { data: user } = useCurrentUser()
  return useMutation({
    mutationFn: async (fields: { water_goal_ml: number; water_glass_ml: number }) => {
      const { error } = await supabase.from('users').update(fields).eq('id', user!.id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['currentUser'] }),
  })
}
