import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { deleteMealPhotos } from '../lib/mealPhotos'
import { relativeTime } from '../lib/relativeTime'
import { computeLikeDelta } from '../lib/likeDelta'
import { likedByLabel } from '../lib/likedBy'
import { useFriendUsernames } from '../hooks/useFriendUsernames'
import { getEffectiveStreak } from '../lib/streak'
import { ShareModal } from './ShareModal'
import { LikersSheet } from './LikersSheet'
import { FeedImage } from './FeedImage'
import { MealBreakdown } from './MealBreakdown'
import { postedItems } from '../lib/mealItems'
import { PhotoViewer } from './PhotoViewer'
import { Avatar } from './Avatar'
import { useToast } from './Toast'
import { hapticLight } from '../lib/haptics'
import type { FeedItem } from '../hooks/useFeed'

interface PostCardProps {
  item: FeedItem
  index?: number
  viewerId?: string
  optimisticLiked?: boolean
  likeAnimating?: boolean
  onLike: (logId: string, logOwnerId: string, currentlyLiked: boolean) => void
}

/** ── Delete post mutation ─────────────────────────────────────────────────── */
function useDeletePost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ logId, photoPath }: { logId: string; photoPath: string | null }) => {
      const { data, error } = await supabase.from('logs').delete().eq('id', logId).select('id')
      if (error) throw error
      // RLS turns a disallowed delete into "0 rows" rather than an error.
      if (!data?.length) throw new Error('Post was not deleted')
      if (photoPath) await deleteMealPhotos([photoPath]).catch(() => null)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['myPosts'] })
      queryClient.invalidateQueries({ queryKey: ['todayStats'] })
    },
  })
}

function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }

export function PostCard({ item, index = 0, viewerId, optimisticLiked, likeAnimating = false, onLike }: PostCardProps) {
  const navigate     = useNavigate()
  const { toast }    = useToast()
  const deletePost   = useDeletePost()
  const { log, author, photoSignedUrl, likeCount, likedByViewer, likerIds, commentCount } = item
  const friendUsernameById = useFriendUsernames()

  const [showShare, setShowShare]   = useState(false)
  const [showPhoto, setShowPhoto]   = useState(false)
  const [showMenu,  setShowMenu]    = useState(false)
  const [showLikers, setShowLikers] = useState(false)
  const [slide, setSlide]           = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the ••• menu on any tap outside it. A full-screen backdrop element
  // can't be used here: the card's slide-up animation leaves a transform,
  // which traps the menu's z-index inside the card so a fixed backdrop ends
  // up *above* the menu and swallows every tap on its items.
  useEffect(() => {
    if (!showMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setShowMenu(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showMenu])

  const displayLiked     = optimisticLiked ?? likedByViewer
  const displayLikeCount = likeCount + computeLikeDelta(optimisticLiked, likedByViewer)
  const likedBy          = likedByLabel({ likerIds, total: displayLikeCount, viewerId, viewerLiked: displayLiked, friendUsernameById })
  const isOwnPost        = viewerId === log.user_id
  const caption          = (log as { caption?: string | null }).caption
  const calories         = log.calories_final ?? log.calories_estimate
  const proteinG         = log.protein_final_g ?? log.protein_estimate_g
  const effectiveStreak  = getEffectiveStreak(author.streak_count, author.streak_last_log_date, new Date())
  const detailPath       = `/home/log/${log.id}`

  function handleDelete() {
    setShowMenu(false)
    if (!window.confirm('Delete this meal post? This cannot be undone.')) return
    deletePost.mutate({ logId: log.id, photoPath: log.photo_url }, {
      onSuccess: () => toast('Post deleted'),
      onError:   () => toast('Could not delete — try again', 'error'),
    })
  }

  function handleLikeWithHaptic() {
    hapticLight()
    onLike(log.id, log.user_id, displayLiked)
  }

  return (
    <>
      <article className="feed-card animate-slide-up" style={{ animationDelay: `${index * 30}ms` }}>
        {/* ── Author row ──────────────────────────────────── */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => isOwnPost ? navigate('/home/profile') : navigate(`/home/friend/${author.username}`)}
            className="no-press flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Avatar name={author.name} photoUrl={author.photo_url} />
            <span className="min-w-0 flex-1">
              <b className="block truncate font-semibold">@{author.username}</b>
              <small className="muted block">{relativeTime(log.created_at)} · {capitalize(log.meal_type)}</small>
            </span>
          </button>

          {isOwnPost ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowMenu((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink"
                aria-label="Post options"
              >
                •••
              </button>
              {showMenu && (
                <div className="absolute right-0 top-9 z-50 w-40 overflow-hidden rounded-[19px] bg-paper shadow-[0_8px_30px_#00000020] animate-slide-down">
                  <button
                    type="button"
                    onClick={() => { setShowMenu(false); navigate(`${detailPath}/edit`) }}
                    className="block w-full px-4 py-3 text-left text-[13px]"
                  >
                    Edit post
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="block w-full border-t border-line px-4 py-3 text-left text-[13px] text-error"
                  >
                    Delete post
                  </button>
                </div>
              )}
            </div>
          ) : (
            effectiveStreak > 0 && <span className="pill tint">🔥 {effectiveStreak}</span>
          )}
        </div>

        {/* ── Photo, then swipe for the meal breakdown ───── */}
        {photoSignedUrl ? (
          <>
            <div className="post-slides" onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
              <div className="post-slide photo-slide">
                <FeedImage src={photoSignedUrl} alt={log.name ?? 'Meal photo'} className="photo" onClick={() => setShowPhoto(true)} priority={index < 2} />
                <span className="slide-count">1/2</span>
              </div>
              <div className="post-slide">
                <MealBreakdown log={log} author={author} onMore={() => navigate(detailPath)} />
                <span className="slide-count">2/2</span>
              </div>
            </div>
            <div className="slide-dots" aria-hidden="true"><i className={slide === 0 ? 'on' : ''} /><i className={slide === 1 ? 'on' : ''} /></div>
          </>
        ) : (
          <div style={{ marginTop: 13 }}><MealBreakdown log={log} author={author} onMore={() => navigate(detailPath)} /></div>
        )}

        {/* ── Meal name + calories ────────────────────────── */}
        <button type="button" onClick={() => navigate(detailPath)} className="no-press block w-full text-left" style={{ marginTop: 13 }}>
          <span className="flex items-start justify-between gap-3">
            <b className="font-semibold">{log.name || capitalize(log.meal_type)}</b>
            <span className="flex flex-none gap-1.5">
              {calories != null && <span className="pill tint">{Number(calories).toLocaleString()} kcal</span>}
              {proteinG != null && <span className="pill tint">{proteinG}g protein</span>}
            </span>
          </span>
          {caption && <p className="small muted" style={{ marginTop: 4 }}>{caption}</p>}
        </button>

        {/* ── Interaction row ─────────────────────────────── */}
        <div className="flex items-center gap-4" style={{ marginTop: 14 }}>
          <button type="button" onClick={handleLikeWithHaptic} className={`flex items-center gap-1.5 ${displayLiked ? 'liked font-semibold' : 'muted'}`}>
            <span className={likeAnimating ? 'animate-pop inline-block' : 'inline-block'} style={{ fontSize: 16, lineHeight: 1 }}>
              {displayLiked ? '♥' : '♡'}
            </span>
            {displayLiked ? 'Liked' : 'Like'}
          </button>
          <button type="button" onClick={() => navigate(detailPath)} className="muted flex items-center gap-1.5">
            <span style={{ fontSize: 16, lineHeight: 1 }}>◌</span>
            {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
          </button>
          <button type="button" onClick={() => setShowShare(true)} className="muted ml-auto flex items-center gap-1.5">
            <span style={{ fontSize: 16, lineHeight: 1 }}>↗</span> Share
          </button>
        </div>
        {likedBy && (
          <button type="button" onClick={() => setShowLikers(true)} className="no-press small muted block text-left" style={{ marginTop: 8 }}>
            {likedBy}
          </button>
        )}
      </article>

      {/* ── Full-screen photo ── */}
      {showPhoto && photoSignedUrl && (
        <PhotoViewer src={photoSignedUrl} alt={log.name ?? 'Meal photo'} onClose={() => setShowPhoto(false)} />
      )}

      {/* ── Share modal ── */}
      {showShare && (
        <ShareModal
          meal={{
            photoUrl: photoSignedUrl,
            username: author.username,
            mealName: log.name,
            mealType: log.meal_type,
            calories,
            proteinG,
            carbsG: log.carbs_final_g ?? log.carbs_estimate_g,
            fatG: log.fat_final_g ?? log.fat_estimate_g,
            items: postedItems(log),
          }}
          shareLogId={isOwnPost ? log.id : undefined}
          isPrivate={log.visibility === 'private'}
          onClose={() => setShowShare(false)}
        />
      )}

      {/* ── Who liked this ── */}
      {showLikers && <LikersSheet logId={log.id} viewerId={viewerId} onClose={() => setShowLikers(false)} />}
    </>
  )
}
