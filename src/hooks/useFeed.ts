import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { signMealPhotos } from '../lib/mealPhotos'
import { useSession } from './useSession'
import type { Database } from '../lib/database.types'

type LogRow = Database['public']['Tables']['logs']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export interface FeedItem {
  log: LogRow
  author: Pick<UserRow, 'id' | 'name' | 'username' | 'photo_url' | 'streak_count' | 'streak_last_log_date' | 'calorie_goal' | 'protein_goal'>
  photoSignedUrl: string | null
  likeCount: number
  likedByViewer: boolean
  /** user_ids of everyone who liked — PostCard names the viewer's friends among them */
  likerIds: string[]
  commentCount: number
}

/**
 * Fetches the viewer's own logs plus their friends', then the authors,
 * as two separate queries rather than one embedded Supabase
 * `.select('*, users(...)')` — our hand-written Database type doesn't
 * model foreign-key `Relationships`, and past experience in this project
 * (Phase 1) showed embedded-select type inference silently degrading
 * without it. Two plain queries avoid that whole class of bug.
 *
 * A single reverse-chronological timeline, own posts and friends' posts
 * interleaved purely by `created_at` — not two separate sections. RLS on
 * `logs` already restricts what a plain `select('*')` can return to the
 * caller's own rows (any visibility) or an accepted friend's public rows
 * — nothing client-side needs to additionally filter by author for this
 * to be private-log-safe. That's RLS's job (see
 * supabase/migrations/0001_init.sql).
 */
export function useFeed() {
  const { session, loading: sessionLoading } = useSession()
  const userId = session?.user.id

  const query = useQuery({
    queryKey: ['feed', userId],
    queryFn: async (): Promise<FeedItem[]> => {
      const { data: logs, error: logsError } = await supabase
        .from('logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (logsError) throw logsError
      if (!logs || logs.length === 0) return []

      const authorIds = [...new Set(logs.map((log) => log.user_id))]
      const { data: authors, error: authorsError } = await supabase
        .from('users')
        .select('id, name, username, photo_url, streak_count, streak_last_log_date, calorie_goal, protein_goal')
        .in('id', authorIds)

      if (authorsError) throw authorsError

      const authorsById = new Map((authors ?? []).map((author) => [author.id, author]))

      const photoPaths = logs.filter((log) => log.photo_url).map((log) => log.photo_url as string)
      const signedUrlByPath = await signMealPhotos(photoPaths)

      const logIds = logs.map((log) => log.id)
      const { data: likeRows } = await supabase.from('log_likes').select('log_id, user_id').in('log_id', logIds)
      const { data: commentRows } = await supabase.from('log_comments').select('log_id').in('log_id', logIds)

      const likesByLog = new Map<string, { count: number; likedByViewer: boolean; likerIds: string[] }>()
      for (const like of likeRows ?? []) {
        const entry = likesByLog.get(like.log_id) ?? { count: 0, likedByViewer: false, likerIds: [] }
        entry.count += 1
        entry.likerIds.push(like.user_id)
        if (like.user_id === userId) entry.likedByViewer = true
        likesByLog.set(like.log_id, entry)
      }

      const commentCountByLog = new Map<string, number>()
      for (const comment of commentRows ?? []) {
        commentCountByLog.set(comment.log_id, (commentCountByLog.get(comment.log_id) ?? 0) + 1)
      }

      return logs
        .map((log) => {
          const author = authorsById.get(log.user_id)
          if (!author) return null
          const likeInfo = likesByLog.get(log.id) ?? { count: 0, likedByViewer: false, likerIds: [] as string[] }
          return {
            log,
            author,
            photoSignedUrl: log.photo_url ? (signedUrlByPath.get(log.photo_url) ?? null) : null,
            likeCount: likeInfo.count,
            likedByViewer: likeInfo.likedByViewer,
            likerIds: likeInfo.likerIds,
            commentCount: commentCountByLog.get(log.id) ?? 0,
          }
        })
        .filter((item): item is FeedItem => item !== null)
    },
    enabled: Boolean(userId),
  })

  // Same session-race guard as useCurrentUser.ts — a disabled query (no
  // userId yet because useSession() hasn't resolved) reports isLoading:
  // false in TanStack Query v5, so without this callers briefly see
  // isLoading: false + data: undefined and mistake "session not yet known"
  // for "confirmed: empty feed."
  return {
    ...query,
    isLoading: sessionLoading || (Boolean(userId) && query.isLoading),
  }
}
