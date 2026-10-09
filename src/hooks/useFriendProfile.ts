import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { signMealPhotos } from '../lib/mealPhotos'
import { useSession } from './useSession'
import { PUBLIC_USER_COLUMNS, type PublicUser } from './useCurrentUser'
import type { Database } from '../lib/database.types'

type UserRow = PublicUser
type LogRow = Database['public']['Tables']['logs']['Row']

export interface FriendProfileLog extends LogRow {
  photoSignedUrl: string | null
  likeCount: number
  likerIds: string[]
  likedByViewer: boolean
  commentCount: number
}

export interface FriendProfileData {
  user: UserRow
  logs: FriendProfileLog[]
}

/**
 * Two plain queries, same reasoning as useFeed: no embedded selects. The
 * `logs` query is RLS-safe by construction — whatever `visibility`/
 * friendship rules apply, this always returns exactly what the caller is
 * allowed to see for that user_id, nothing more.
 */
export function useFriendProfile(username: string | undefined) {
  const { session, loading: sessionLoading } = useSession()
  const viewerId = session?.user.id

  // viewerId is part of the key so cached, RLS-filtered results never
  // leak across accounts sharing a browser (e.g. signing out and into a
  // different account within TanStack Query's gcTime window).
  const query = useQuery({
    queryKey: ['friendProfile', viewerId, username],
    queryFn: async (): Promise<FriendProfileData | null> => {
      const { data: user, error: userError } = await supabase
        .from('users')
        .select(PUBLIC_USER_COLUMNS)
        .eq('username', username!)
        .maybeSingle()

      if (userError) throw userError
      if (!user) return null

      const { data: logs, error: logsError } = await supabase
        .from('logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (logsError) throw logsError

      const rows = logs ?? []
      const photoPaths = rows.filter((log) => log.photo_url).map((log) => log.photo_url as string)
      const logIds = rows.map((log) => log.id)
      const [signedUrlByPath, { data: likeRows }, { data: commentRows }] = await Promise.all([
        signMealPhotos(photoPaths),
        supabase.from('log_likes').select('log_id, user_id').in('log_id', logIds),
        supabase.from('log_comments').select('log_id').in('log_id', logIds),
      ])

      const likesByLog = new Map<string, { count: number; likedByViewer: boolean; likerIds: string[] }>()
      for (const like of likeRows ?? []) {
        const entry = likesByLog.get(like.log_id) ?? { count: 0, likedByViewer: false, likerIds: [] }
        entry.count += 1
        entry.likerIds.push(like.user_id)
        if (like.user_id === viewerId) entry.likedByViewer = true
        likesByLog.set(like.log_id, entry)
      }

      const commentCountByLog = new Map<string, number>()
      for (const comment of commentRows ?? []) {
        commentCountByLog.set(comment.log_id, (commentCountByLog.get(comment.log_id) ?? 0) + 1)
      }

      return {
        user,
        logs: rows.map((log) => {
          const likeInfo = likesByLog.get(log.id) ?? { count: 0, likedByViewer: false, likerIds: [] as string[] }
          return {
            ...log,
            photoSignedUrl: log.photo_url ? (signedUrlByPath.get(log.photo_url) ?? null) : null,
            likeCount: likeInfo.count,
            likedByViewer: likeInfo.likedByViewer,
            likerIds: likeInfo.likerIds,
            commentCount: commentCountByLog.get(log.id) ?? 0,
          }
        }),
      }
    },
    enabled: Boolean(username) && Boolean(viewerId),
  })

  // Same session-race guard as useCurrentUser.ts / useFeed.ts: a disabled
  // query (no viewerId yet, because useSession() hasn't resolved) reports
  // isLoading: false in TanStack Query v5, so without folding sessionLoading
  // in here callers briefly see isLoading: false + data: undefined and
  // mistake "session not yet known" for "profile not found."
  return {
    ...query,
    isLoading: sessionLoading || (Boolean(viewerId) && query.isLoading),
  }
}
