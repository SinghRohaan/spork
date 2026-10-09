import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { signMealPhotos } from '../lib/mealPhotos'
import { useSession } from './useSession'
import { groupComments, type CommentRow } from '../lib/commentTree'
import type { Database } from '../lib/database.types'

type LogRow = Database['public']['Tables']['logs']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type CommentAuthor = Pick<UserRow, 'id' | 'name' | 'username' | 'photo_url'>

export interface CommentWithAuthor extends CommentRow {
  author: CommentAuthor
}

export interface CommentThread extends CommentWithAuthor {
  replies: CommentWithAuthor[]
}

export interface MealDetailData {
  log: LogRow
  author: Pick<UserRow, 'id' | 'name' | 'username' | 'photo_url'>
  photoSignedUrl: string | null
  likeCount: number
  likerIds: string[]
  likedByViewer: boolean
  comments: CommentThread[]
  /** null when migration 0010 isn't deployed — UI hides comment hearts */
  commentLikes: CommentLikes | null
}

/** Per-comment heart state. */
export interface CommentLikes {
  counts: Map<string, number>
  mine: Set<string>
}

/**
 * Four plain queries (log, author, likes, comments+their authors), no
 * embedded selects — same reasoning as every other hook in this
 * codebase. `log_likes`/`log_comments` RLS already restricts what a
 * plain select can return to what the viewer is allowed to see, so the
 * like count and comment list can never over-fetch a hidden log's data.
 */
export function useMealDetail(logId: string | undefined) {
  const { session, loading: sessionLoading } = useSession()
  const viewerId = session?.user.id

  const query = useQuery({
    queryKey: ['mealDetail', viewerId, logId],
    queryFn: async (): Promise<MealDetailData | null> => {
      const { data: log, error: logError } = await supabase.from('logs').select('*').eq('id', logId!).maybeSingle()
      if (logError) throw logError
      if (!log) return null

      // Everything below depends only on the post, so fetch it all at once.
      const [authorRes, signed, likesRes, commentsRes] = await Promise.all([
        supabase.from('users').select('id, name, username, photo_url').eq('id', log.user_id).single(),
        log.photo_url ? signMealPhotos([log.photo_url]) : Promise.resolve(new Map<string, string>()),
        supabase.from('log_likes').select('user_id').eq('log_id', logId!),
        supabase
          .from('log_comments')
          .select('id, user_id, parent_comment_id, body, created_at')
          .eq('log_id', logId!)
          .order('created_at', { ascending: true }),
      ])
      const { data: author, error: authorError } = authorRes
      if (authorError) throw authorError
      const photoSignedUrl = log.photo_url ? (signed.get(log.photo_url) ?? null) : null

      const { data: likes, error: likesError } = likesRes
      if (likesError) throw likesError
      const likeRows = likes ?? []
      const likeCount = likeRows.length
      const likedByViewer = likeRows.some((l) => l.user_id === viewerId)
      const likerIds = likeRows.map((l) => l.user_id)

      const { data: commentRows, error: commentsError } = commentsRes
      if (commentsError) throw commentsError

      const rows = commentRows ?? []
      const commenterIds = [...new Set(rows.map((c) => c.user_id))]
      // Commenters and comment hearts both depend only on the comments — fetch together.
      const [{ data: commenters, error: commentersError }, commentLikesRes] = await Promise.all([
        commenterIds.length > 0
          ? supabase.from('users').select('id, name, username, photo_url').in('id', commenterIds)
          : Promise.resolve({ data: [] as CommentAuthor[], error: null }),
        rows.length > 0
          ? supabase.from('comment_likes').select('comment_id, user_id').in('comment_id', rows.map((c) => c.id))
          : Promise.resolve(null),
      ])
      if (commentersError) throw commentersError

      const commentersById = new Map((commenters ?? []).map((u) => [u.id, u]))
      const rowsWithAuthor = rows
        .map((row) => {
          const commentAuthor = commentersById.get(row.user_id)
          return commentAuthor ? { ...row, author: commentAuthor } : null
        })
        .filter((r): r is CommentWithAuthor => r !== null)

      const comments = groupComments(rowsWithAuthor)

      // Comment hearts (migration 0010). If the table isn't there yet the
      // request 404s (PGRST205 / 42P01) — treat that as "feature not
      // deployed" and let the UI hide the hearts rather than erroring.
      let commentLikes: CommentLikes | null = null
      if (commentLikesRes) {
        const { data: likeRows, error: clError } = commentLikesRes
        if (!clError) {
          const counts = new Map<string, number>()
          const mine = new Set<string>()
          for (const row of (likeRows ?? []) as { comment_id: string; user_id: string }[]) {
            counts.set(row.comment_id, (counts.get(row.comment_id) ?? 0) + 1)
            if (row.user_id === viewerId) mine.add(row.comment_id)
          }
          commentLikes = { counts, mine }
        }
      } else {
        commentLikes = { counts: new Map(), mine: new Set() }
      }

      return { log, author, photoSignedUrl, likeCount, likerIds, likedByViewer, comments, commentLikes }
    },
    enabled: Boolean(logId) && Boolean(viewerId),
  })

  return {
    ...query,
    isLoading: sessionLoading || (Boolean(viewerId) && query.isLoading),
  }
}

/** Toggles a heart on a single comment (comment_likes, migration 0010). */
export function useToggleCommentLike() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { commentId: string; currentlyLiked: boolean }) => {
      if (!session) throw new Error('Not signed in')
      const userId = session.user.id
      if (input.currentlyLiked) {
        const { error } = await supabase.from('comment_likes').delete()
          .eq('comment_id', input.commentId).eq('user_id', userId)
        if (error) throw error
        return
      }
      const { error } = await supabase.from('comment_likes')
        .insert({ comment_id: input.commentId, user_id: userId })
      // 23505 = already liked (double tap); nothing to do.
      if (error && error.code !== '23505') throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealDetail'] })
    },
  })
}

/**
 * Toggles a like: deletes the row if already liked, otherwise inserts it
 * plus a notification row (skipped when liking your own post). Callers
 * pass `currentlyLiked` explicitly rather than this hook re-deriving it,
 * so a screen using optimistic local state (Task 5) controls exactly
 * which direction the toggle goes.
 */
export function useToggleLike() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { logId: string; logOwnerId: string; currentlyLiked: boolean }) => {
      if (!session) throw new Error('Not signed in')
      const userId = session.user.id

      if (input.currentlyLiked) {
        const { error } = await supabase.from('log_likes').delete().eq('log_id', input.logId).eq('user_id', userId)
        if (error) throw error
        return
      }

      const { error: likeError } = await supabase.from('log_likes').insert({ log_id: input.logId, user_id: userId })
      if (likeError) throw likeError

      if (input.logOwnerId !== userId) {
        const { error: notifError } = await supabase.from('notifications').insert({
          recipient_id: input.logOwnerId,
          actor_id: userId,
          log_id: input.logId,
          type: 'like',
        })
        // 23505 = unique_violation: a like notification for this
        // (actor, log) pair already exists from a prior like/unlike cycle
        // — the existing row still stands in for this one, nothing to do.
        if (notifError && notifError.code !== '23505') throw notifError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealDetail'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useAddComment() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      logId: string
      logOwnerId: string
      body: string
      parentCommentId: string | null
    }) => {
      if (!session) throw new Error('Not signed in')
      const userId = session.user.id

      const { data: insertedComment, error: commentError } = await supabase
        .from('log_comments')
        .insert({
          log_id: input.logId,
          user_id: userId,
          parent_comment_id: input.parentCommentId,
          body: input.body,
        })
        .select('id')
        .single()
      if (commentError) throw commentError

      if (input.logOwnerId !== userId) {
        const { error: notifError } = await supabase.from('notifications').insert({
          recipient_id: input.logOwnerId,
          actor_id: userId,
          log_id: input.logId,
          type: input.parentCommentId ? 'reply' : 'comment',
          comment_id: insertedComment.id,
        })
        if (notifError) throw notifError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealDetail'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useDeleteComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await supabase.from('log_comments').delete().eq('id', commentId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealDetail'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** Owner edits an existing log — the same fields the create form exposes. */
export interface EditLogInput {
  logId: string
  name: string | null
  caption: string | null
  meal_type: LogRow['meal_type']
  visibility: LogRow['visibility']
  satiety: LogRow['satiety']
  calories_final: number | null
  protein_final_g: number | null
  carbs_final_g: number | null
  fat_final_g: number | null
}

export function useEditLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ logId, ...fields }: EditLogInput) => {
      // RLS `logs_update_own` guarantees only the owner's row can change.
      const { error } = await supabase.from('logs').update(fields).eq('id', logId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mealDetail'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['myPosts'] })
      queryClient.invalidateQueries({ queryKey: ['todayStats'] })
      queryClient.invalidateQueries({ queryKey: ['myLogs'] })
      queryClient.invalidateQueries({ queryKey: ['insights'] })
    },
  })
}
