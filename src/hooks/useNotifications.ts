import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useSession } from './useSession'
import type { Database } from '../lib/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type LogRow = Database['public']['Tables']['logs']['Row']
type NotificationRow = Database['public']['Tables']['notifications']['Row']

export interface NotificationItem {
  id: string
  type: NotificationRow['type']
  logId: string
  readAt: string | null
  createdAt: string
  actor: Pick<UserRow, 'id' | 'name' | 'username' | 'photo_url'>
  log: Pick<LogRow, 'id' | 'name' | 'meal_type'>
}

/**
 * Three plain queries (notifications, actors, logs), no embedded
 * selects. `notifications_select_own` RLS already restricts this to the
 * caller's own notifications, so no client-side recipient filter is
 * needed on the select. Every notification's recipient is always the
 * referenced log's owner (spec §10), so the caller viewing their own
 * inbox always has permission to read the logs it references — no RLS
 * gap even though this looks up logs a second time here.
 */
export function useNotifications() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user.id

  const query = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async (): Promise<NotificationItem[]> => {
      const { data: rows, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error

      const notifs = rows ?? []
      if (notifs.length === 0) return []

      const actorIds = [...new Set(notifs.map((n) => n.actor_id))]
      const { data: actors, error: actorsError } = await supabase
        .from('users')
        .select('id, name, username, photo_url')
        .in('id', actorIds)
      if (actorsError) throw actorsError
      const actorsById = new Map((actors ?? []).map((a) => [a.id, a]))

      const logIds = [...new Set(notifs.map((n) => n.log_id))]
      const { data: logs, error: logsError } = await supabase
        .from('logs')
        .select('id, name, meal_type')
        .in('id', logIds)
      if (logsError) throw logsError
      const logsById = new Map((logs ?? []).map((l) => [l.id, l]))

      return notifs
        .map((n) => {
          const actor = actorsById.get(n.actor_id)
          const log = logsById.get(n.log_id)
          if (!actor || !log) return null
          return {
            id: n.id,
            type: n.type,
            logId: n.log_id,
            readAt: n.read_at,
            createdAt: n.created_at,
            actor,
            log,
          }
        })
        .filter((n): n is NotificationItem => n !== null)
    },
    enabled: Boolean(userId),
  })

  const unreadCount = (query.data ?? []).filter((n) => n.readAt === null).length

  return {
    ...query,
    isLoading: sessionLoading || (Boolean(userId) && query.isLoading),
    unreadCount,
  }
}

export function useMarkNotificationsRead() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not signed in')
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient_id', session.user.id)
        .is('read_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Deletes every notification sent to the signed-in user ("Clear all"). */
export function useClearNotifications() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Not signed in')
      const { data, error } = await supabase
        .from('notifications')
        .delete()
        .eq('recipient_id', session.user.id)
        .select('id')
      if (error) throw error
      // Without the delete policy (migration 0020) the database silently deletes nothing.
      if (!data?.length) throw new Error('Nothing was cleared')
    },
    onSuccess: () => {
      queryClient.setQueriesData({ queryKey: ['notifications'] }, [])
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
