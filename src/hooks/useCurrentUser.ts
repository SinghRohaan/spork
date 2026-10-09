import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'
import { useSession } from './useSession'

export type UserRow = Database['public']['Tables']['users']['Row']

/** The profile fields other people may read (migration 0019); height, target weight etc. stay private. */
export const PUBLIC_USER_COLUMNS = 'id, username, name, photo_url, privacy_default, calorie_goal, protein_goal, streak_count, streak_last_log_date, created_at'
export type PublicUser = Pick<UserRow, 'id' | 'username' | 'name' | 'photo_url' | 'privacy_default' | 'calorie_goal' | 'protein_goal' | 'streak_count' | 'streak_last_log_date' | 'created_at'>

export function useCurrentUser() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user.id

  const query = useQuery({
    queryKey: ['currentUser', userId],
    queryFn: async (): Promise<UserRow | null> => {
      // Your own full profile comes through get_my_profile() — other people's
      // private fields aren't readable from the table (migration 0019).
      const own = await supabase.rpc('get_my_profile')
      if (!own.error) return (own.data as UserRow[] | null)?.[0] ?? null
      if (own.error.code !== 'PGRST202') throw own.error
      // Before 0019 has been run the function doesn't exist yet.
      const { data, error } = await supabase.from('users').select('*').eq('id', userId!).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: Boolean(userId),
  })

  // A disabled query (no userId yet, because useSession() hasn't resolved)
  // reports isLoading: false in TanStack Query v5 — "loading" specifically
  // means "actively fetching," and a disabled query never fetches. Without
  // folding in sessionLoading here, callers see isLoading: false and
  // data: undefined simultaneously during that window and mistake "session
  // not yet known" for "confirmed: no user," which fires premature
  // onboarding-guard redirects on every fresh sign-in.
  return {
    ...query,
    isLoading: sessionLoading || (Boolean(userId) && query.isLoading),
  }
}
