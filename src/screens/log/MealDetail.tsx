import { Heart, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'
import {
  useAddComment,
  useDeleteComment,
  useMealDetail,
  useToggleLike,
  type CommentThread,
  type CommentWithAuthor,
  useToggleCommentLike,
} from '../../hooks/useMealDetail'
import { computeLikeDelta } from '../../lib/likeDelta'
import { likedByLabel } from '../../lib/likedBy'
import { useFriendUsernames } from '../../hooks/useFriendUsernames'
import { relativeTime } from '../../lib/relativeTime'
import { TopBar } from '../../components/TopBar'
import { Avatar } from '../../components/Avatar'
import { PhotoViewer } from '../../components/PhotoViewer'
import { LikersSheet } from '../../components/LikersSheet'
import { MealScoreCard } from '../../components/Accountability'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { dailyGoals } from '../../lib/accountability'
import { startLogAgain, type PastMeal } from '../../lib/logAgain'

export default function MealDetail() {
  const { logId } = useParams<{ logId: string }>()
  const navigate = useNavigate()
  const { session } = useSession()
  const { data, isLoading, isError } = useMealDetail(logId)
  const toggleLike = useToggleLike()
  const addComment = useAddComment()
  const deleteComment = useDeleteComment()
  const toggleCommentLike = useToggleCommentLike()
  const friendUsernameById = useFriendUsernames()
  const { data: currentUser } = useCurrentUser()

  const [optimisticLiked, setOptimisticLiked] = useState<boolean | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ src: string; alt: string } | null>(null)
  const [showLikers, setShowLikers] = useState(false)

  useEffect(() => {
    setOptimisticLiked(null)
  }, [data?.likedByViewer])

  if (isLoading) {
    return (
      <div>
        <TopBar title="Meal detail" />
        <p className="muted text-center" style={{ padding: 60 }}>Loading…</p>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div>
        <TopBar title="Meal detail" />
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>◌</div>
          <h4 style={{ marginTop: 12 }}>{isError ? 'Something went wrong loading this meal' : 'Couldn’t find that meal'}</h4>
          <button type="button" onClick={() => navigate(-1)} className="btn">Go back</button>
        </div>
      </div>
    )
  }

  const { log, author, photoSignedUrl, likeCount, likedByViewer, likerIds, comments, commentLikes } = data
  const viewerId = session?.user.id
  const displayLiked = optimisticLiked ?? likedByViewer
  const displayLikeCount = likeCount + computeLikeDelta(optimisticLiked, likedByViewer)
  const likedBy = likedByLabel({ likerIds, total: displayLikeCount, viewerId, viewerLiked: displayLiked, friendUsernameById })
  const caption  = (log as { caption?: string | null }).caption
  const calories = log.calories_final ?? log.calories_estimate
  const proteinG = log.protein_final_g ?? log.protein_estimate_g
  const carbsG   = log.carbs_final_g ?? log.carbs_estimate_g
  const fatG     = log.fat_final_g ?? log.fat_estimate_g
  const mealTypeLabel = log.meal_type.charAt(0).toUpperCase() + log.meal_type.slice(1)

  function handleToggleLike() {
    const next = !displayLiked
    setOptimisticLiked(next)
    toggleLike.mutate(
      { logId: log.id, logOwnerId: log.user_id, currentlyLiked: displayLiked },
      { onError: () => setOptimisticLiked(!next) },
    )
  }

  function handleAddComment() {
    const body = commentBody.trim()
    if (!body) return
    addComment.mutate(
      { logId: log.id, logOwnerId: log.user_id, body, parentCommentId: replyingTo },
      {
        onSuccess: () => {
          setCommentBody('')
          setReplyingTo(null)
        },
      },
    )
  }

  return (
    <div>
      <TopBar title="Meal detail" right={viewerId === author.id ? (
        <button type="button" onClick={() => navigate(`/home/log/${log.id}/edit`)} className="pill" aria-label="Edit post">Edit</button>
      ) : undefined} />

      {/* Author row */}
      <div className="flex w-full items-center gap-2.5 text-left">
        <button type="button" className="no-press" aria-label={author.photo_url ? 'View profile photo' : 'View profile'}
          onClick={() => author.photo_url ? setViewer({ src: author.photo_url, alt: author.name }) : navigate(viewerId === author.id ? '/home/profile' : `/home/friend/${author.username}`)}>
          <Avatar name={author.name} photoUrl={author.photo_url} />
        </button>
        <button type="button" onClick={() => navigate(viewerId === author.id ? '/home/profile' : `/home/friend/${author.username}`)} className="no-press min-w-0 flex-1 text-left">
          <b className="block font-semibold">@{author.username}</b>
          <small className="muted block">{mealTypeLabel} · {relativeTime(log.created_at)}</small>
        </button>
      </div>
      <div style={{ height: 15 }} />

      {photoSignedUrl && (
        <img src={photoSignedUrl} alt={log.name ?? 'Meal photo'} className="photo natural" style={{ cursor: 'zoom-in' }}
          onClick={() => setViewer({ src: photoSignedUrl, alt: log.name ?? 'Meal photo' })} />
      )}
      {viewer && <PhotoViewer src={viewer.src} alt={viewer.alt} onClose={() => setViewer(null)} />}

      <h3 style={{ marginTop: 17 }}>{log.name || mealTypeLabel}</h3>
      {caption && <p className="small muted">{caption}</p>}

      <div className="card tint">
        <div className="flex items-center justify-between gap-2">
          <b className="font-semibold">{calories != null ? `${Number(calories).toLocaleString()} kcal` : '— kcal'}</b>
          <span className="protein-total">{proteinG ?? '—'}g protein</span>
          <span>{carbsG ?? '—'}g carbs</span>
          <span>{fatG ?? '—'}g fat</span>
        </div>
        {log.calories_final != null && log.calories_estimate != null && log.calories_final !== log.calories_estimate && (
          <p className="tiny muted" style={{ marginTop: 8 }}>AI estimate was {log.calories_estimate.toLocaleString()} kcal</p>
        )}
      </div>

      {/* Log again — own meals only; opens the review screen pre-filled */}
      {viewerId === author.id && calories != null && (
        <button type="button" className="btn flex items-center justify-center gap-2" style={{ marginTop: 4 }}
          onClick={() => { startLogAgain(log as PastMeal, currentUser?.privacy_default ?? 'public'); navigate('/home/log') }}>
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11V9a3 3 0 0 1 3-3h12m-3-3 3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m3 3-3-3 3-3" />
          </svg>
          Log this again
        </button>
      )}

      {/* Meal score — private, owner only */}
      {viewerId === author.id && currentUser && calories != null && (
        <MealScoreCard goals={dailyGoals(currentUser.calorie_goal, currentUser.protein_goal)} meal={{
          id: log.id, name: log.name, meal_type: log.meal_type, created_at: log.created_at, photo_url: log.photo_url,
          calories: Number(calories), protein: Number(proteinG ?? 0), carbs: Number(carbsG ?? 0), fat: Number(fatG ?? 0),
        }} />
      )}

      <div className="flex items-center gap-4" style={{ margin: '17px 0' }}>
        <button type="button" onClick={handleToggleLike} className={`flex items-center gap-1.5 ${displayLiked ? 'liked font-semibold' : ''}`}>
          <Heart size={19} fill={displayLiked ? 'currentColor' : 'none'} aria-hidden="true" />
          {displayLiked ? 'Liked' : 'Like'}
        </button>
        <span className="flex items-center gap-1.5">
          <MessageCircle size={19} aria-hidden="true" />
          {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
        </span>
      </div>
      {likedBy && (
        <button type="button" onClick={() => setShowLikers(true)} className="no-press small muted block text-left" style={{ marginTop: -8, marginBottom: 14 }}>
          {likedBy}
        </button>
      )}
      {showLikers && <LikersSheet logId={log.id} viewerId={viewerId} onClose={() => setShowLikers(false)} />}

      <div className="divider" />

      <h4>Comments</h4>
      {comments.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>No comments yet</p>}
      {comments.map((comment: CommentThread) => (
        <div key={comment.id}>
          <CommentRow
            comment={comment}
            canDelete={viewerId === comment.user_id || viewerId === log.user_id}
            likeCount={commentLikes?.counts.get(comment.id) ?? 0}
            liked={commentLikes?.mine.has(comment.id) ?? false}
            onLike={commentLikes ? () => toggleCommentLike.mutate({
              commentId: comment.id,
              currentlyLiked: commentLikes.mine.has(comment.id),
            }) : undefined}
            onReply={() => setReplyingTo(comment.id)}
            onDelete={() => deleteComment.mutate(comment.id)}
          />
          {comment.replies.length > 0 && (
            <div className="border-l border-line" style={{ marginLeft: 19, paddingLeft: 12 }}>
              {comment.replies.map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  canDelete={viewerId === reply.user_id || viewerId === log.user_id}
                  likeCount={commentLikes?.counts.get(reply.id) ?? 0}
                  liked={commentLikes?.mine.has(reply.id) ?? false}
                  onLike={commentLikes ? () => toggleCommentLike.mutate({
                    commentId: reply.id,
                    currentlyLiked: commentLikes.mine.has(reply.id),
                  }) : undefined}
                  onDelete={() => deleteComment.mutate(reply.id)}
                />
              ))}
            </div>
          )}
        </div>
      ))}

      {replyingTo && (
        <div className="pill tint flex w-full justify-between" style={{ marginTop: 12 }}>
          <span>Replying to a comment</span>
          <button type="button" onClick={() => setReplyingTo(null)} className="font-semibold">Cancel</button>
        </div>
      )}

      <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
        <input
          className="input flex-1"
          value={commentBody}
          onChange={(e) => setCommentBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
          placeholder="Add a comment"
        />
        <button
          type="button"
          onClick={handleAddComment}
          disabled={!commentBody.trim() || addComment.isPending}
          className="pill sel"
          style={{ padding: '12px 16px' }}
        >
          Post
        </button>
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  canDelete,
  likeCount,
  liked,
  onLike,
  onReply,
  onDelete,
}: {
  comment: CommentWithAuthor
  canDelete: boolean
  likeCount: number
  liked: boolean
  /** undefined while migration 0010 isn't deployed — the heart is hidden */
  onLike?: () => void
  onReply?: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const goToAuthor = () => navigate(`/home/friend/${comment.author.username}`)
  return (
    <div className="meal-row comment-row">
      <button type="button" onClick={goToAuthor} aria-label={`View ${comment.author.username}'s profile`} className="no-press">
        <Avatar name={comment.author.name} photoUrl={comment.author.photo_url} size="sm" />
      </button>
      <span className="min-w-0 flex-1">
        <button type="button" onClick={goToAuthor} className="font-semibold">@{comment.author.username}</button>
        <p className="small" style={{ marginTop: 2 }}>{comment.body}</p>
        <span className="comment-actions">
          {onLike && (
            <button type="button" onClick={onLike} className={liked ? 'liked' : 'muted'}
              aria-pressed={liked} aria-label={liked ? 'Unlike comment' : 'Like comment'}>
              <Heart size={14} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
              {likeCount > 0 && <span>{likeCount}</span>}
            </button>
          )}
          {onReply && <button type="button" onClick={onReply} className="muted">Reply</button>}
          {canDelete && <button type="button" onClick={onDelete} className="text-error">Delete</button>}
        </span>
      </span>
    </div>
  )

}
