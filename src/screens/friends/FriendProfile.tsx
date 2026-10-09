import { useNavigate, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useFriendProfile } from '../../hooks/useFriendProfile'
import { useConnections } from '../../hooks/useConnections'
import { useSession } from '../../hooks/useSession'
import { getEffectiveStreak } from '../../lib/streak'
import { computeAverageCalories, computeWeeklyLoggedDays } from '../../lib/friendStats'
import { buildLogDateSet } from '../../lib/profileStats'
import { useToggleLike } from '../../hooks/useMealDetail'
import { StreakCalendar } from '../../components/StreakCalendar'
import { PostCard } from '../../components/PostCard'
import { Skeleton, FeedCardSkeleton } from '../../components/Skeleton'
import { TopBar } from '../../components/TopBar'
import { Avatar } from '../../components/Avatar'
import { PhotoViewer } from '../../components/PhotoViewer'
import { useToast } from '../../components/Toast'
import type { FeedItem } from '../../hooks/useFeed'
import { SporkOrb } from '../../components/brand/SporkOrb'
import { FriendActions, ProfileMenu } from '../../components/FriendActions'
import { useBlocks, useUnblockUser } from '../../hooks/useBlocks'

export default function FriendProfile() {
  const { username }   = useParams<{ username: string }>()
  const navigate       = useNavigate()
  const { session }    = useSession()
  const { toast }      = useToast()
  const { data, isLoading, isError } = useFriendProfile(username)
  const { data: connections } = useConnections(username)
  const toggleLike     = useToggleLike()
  const { data: blocks } = useBlocks()
  const unblock        = useUnblockUser()

  const [optimisticLikes, setOptimisticLikes] = useState<Record<string, boolean>>({})
  const [likeAnimating,   setLikeAnimating]   = useState<Record<string, boolean>>({})
  const [showAvatar, setShowAvatar] = useState(false)

  function handleLike(logId: string, ownerId: string, currentlyLiked: boolean) {
    const next = !currentlyLiked
    setOptimisticLikes((p) => ({ ...p, [logId]: next }))
    if (next) {
      setLikeAnimating((p) => ({ ...p, [logId]: true }))
      setTimeout(() => setLikeAnimating((p) => ({ ...p, [logId]: false })), 350)
    }
    toggleLike.mutate(
      { logId, logOwnerId: ownerId, currentlyLiked },
      { onError: () => { setOptimisticLikes((p) => ({ ...p, [logId]: currentlyLiked })); toast('Could not like — try again', 'error') } },
    )
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <TopBar title={`@${username ?? ''}`} />
        <div className="flex items-center gap-4">
          <Skeleton className="h-[72px] w-[72px] !rounded-[26px]" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="mt-4 h-24 !rounded-[27px]" />
        <FeedCardSkeleton />
      </div>
    )
  }

  // Someone who blocked the viewer looks like a profile that doesn't exist.
  const hiddenByThem = Boolean(data && blocks?.hidden.has(data.user.id) && !blocks.blockedIds.has(data.user.id))

  if (isError || !data || hiddenByThem) {
    return (
      <div>
        <TopBar title="Profile" />
        <div className="card text-center" style={{ padding: 40 }}>
          <div style={{ fontSize: 40, lineHeight: 1 }}>◌</div>
          <h4 style={{ marginTop: 12 }}>{isError ? 'Something went wrong' : 'Profile not found'}</h4>
          <button type="button" onClick={() => navigate(-1)} className="btn">Go back</button>
        </div>
      </div>
    )
  }

  const { user, logs } = data
  const isSelf = user.id === session?.user.id
  const iBlocked = Boolean(blocks?.blockedIds.has(user.id))

  if (iBlocked) {
    return (
      <div className="animate-fade-in">
        <TopBar title={`@${user.username}`} back="/home/friends" right={<ProfileMenu user={user} blocked />} />
        <div className="card tint text-center" style={{ padding: 32 }}>
          <div className="flex justify-center"><Avatar name={user.name} photoUrl={null} size="big" /></div>
          <h4 style={{ marginTop: 12 }}>You blocked @{user.username}</h4>
          <p className="small muted">They can’t find you, see your meals or send you requests.</p>
          <button type="button" className="btn" disabled={unblock.isPending}
            onClick={() => unblock.mutate(user.id, { onSuccess: () => toast(`Unblocked @${user.username}`), onError: () => toast('Could not unblock — try again', 'error') })}>
            Unblock
          </button>
        </div>
      </div>
    )
  }
  const effectiveStreak = getEffectiveStreak(user.streak_count, user.streak_last_log_date, new Date())
  const avgCalories     = computeAverageCalories(logs)
  const weeklyDays      = computeWeeklyLoggedDays(logs)
  const logDates        = buildLogDateSet(logs)

  // Map FriendProfileLog → FeedItem shape for PostCard
  const feedItems: FeedItem[] = logs.map((log) => ({
    log,
    author: {
      id:                  user.id,
      name:                user.name,
      username:            user.username,
      photo_url:           user.photo_url,
      streak_count:        user.streak_count,
      streak_last_log_date: user.streak_last_log_date,
      calorie_goal:        user.calorie_goal,
      protein_goal:        user.protein_goal,
    },
    photoSignedUrl: log.photoSignedUrl,
    likeCount:      log.likeCount,
    likedByViewer:  log.likedByViewer,
    likerIds:       log.likerIds,
    commentCount:   log.commentCount,
  }))

  return (
    <div className="animate-fade-in">
      <TopBar title={`@${user.username}`} back="/home/friends" right={isSelf ? undefined : <ProfileMenu user={user} blocked={false} onBlocked={() => navigate('/home/friends')} />} />

      {/* ── Identity row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3.5">
        <button type="button" className="no-press flex-none" disabled={!user.photo_url} aria-label={user.photo_url ? 'View profile photo' : undefined}
          onClick={() => setShowAvatar(true)}>
          <Avatar name={user.name} photoUrl={user.photo_url} size="big" />
        </button>
        {showAvatar && user.photo_url && <PhotoViewer src={user.photo_url} alt={user.name} onClose={() => setShowAvatar(false)} />}
        <span className="min-w-0">
          <h3 className="truncate">@{user.username}</h3>
          <p className="muted small">{user.name}</p>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 small" style={{ marginTop: 4 }}>
            <span><b>{logs.length}</b> post{logs.length === 1 ? '' : 's'}</span>
            {connections?.visible && (
              <button type="button" onClick={() => navigate(`/home/connections/${user.username}`)}>
                <b>{connections.count}</b> friend{connections.count === 1 ? '' : 's'}
              </button>
            )}
            <span><b>{effectiveStreak}</b> day streak</span>
          </span>
        </span>
      </div>
      {!isSelf && <FriendActions user={user} />}
      <div style={{ height: 15 }} />

      {/* ── Streak card ──────────────────────────────────────────── */}
      <div className="card tint">
        <div className="flex items-center justify-between">
          <span>
            <span className="caps">Streak</span>
            <h3>{effectiveStreak} day{effectiveStreak === 1 ? '' : 's'}</h3>
          </span>
          <span style={{ fontSize: 40, lineHeight: 1 }}>🔥</span>
        </div>
      </div>

      {/* ── Consistency ──────────────────────────────────────────── */}
      <div className="tile-grid">
        <div className="tile compact">
          <span className="icon">▦</span>
          <span><b>{weeklyDays}/14</b><small className="block">days logged</small></span>
        </div>
        <div className="tile compact">
          <span className="icon">◌</span>
          <span><b>{avgCalories != null ? avgCalories.toLocaleString() : '—'}</b><small className="block">avg kcal/day</small></span>
        </div>
      </div>

      <div className="section">
        <span className="caps">Last 14 days</span>
        <StreakCalendar logDates={logDates} days={14} />
      </div>

      {/* ── Posts feed ───────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Recent meals · {logs.length}</span>
        {logs.length === 0 ? (
          <div className="card tint text-center" style={{ margin: 0 }}>
            <div className="flex justify-center"><SporkOrb size={34} /></div>
            <p className="small muted" style={{ marginTop: 8 }}>No public posts yet</p>
          </div>
        ) : (
          feedItems.map((item, i) => (
            <PostCard
              key={item.log.id}
              item={item}
              index={i}
              viewerId={session?.user.id}
              optimisticLiked={optimisticLikes[item.log.id]}
              likeAnimating={likeAnimating[item.log.id] ?? false}
              onLike={handleLike}
            />
          ))
        )}
      </div>
    </div>
  )
}
