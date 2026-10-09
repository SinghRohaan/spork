import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/compressImage'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useSession } from '../../hooks/useSession'
import { useTodayStats } from '../../hooks/useTodayStats'
import { useMyLogs, useLogsForDay, useUpdateProfile } from '../../hooks/useProfile'
import { useMyPosts } from '../../hooks/useMyPosts'
import { useFriendships } from '../../hooks/useFriendships'
import { useStreakData } from '../../hooks/useStreakData'
import { useToggleLike } from '../../hooks/useMealDetail'
import { CalorieRing } from '../../components/CalorieRing'
import { StreakCalendar } from '../../components/StreakCalendar'
import { PostCard } from '../../components/PostCard'
import { ProfileHeaderSkeleton, Skeleton, FeedCardSkeleton } from '../../components/Skeleton'
import { useToast } from '../../components/Toast'
import { Avatar } from '../../components/Avatar'
import { PhotoViewer } from '../../components/PhotoViewer'
import {
  computeWeeklyAvgCalories,
  computeWeeklyLoggedDays,
  computeCalorieRingPct,
  buildLogDateSet,
} from '../../lib/profileStats'
import { useQueryClient } from '@tanstack/react-query'
import { SporkOrb } from '../../components/brand/SporkOrb'
import { ProfileBadges } from '../../components/Badges'
import { dailyGoals } from '../../lib/accountability'

export default function ProfileScreen() {
  const navigate       = useNavigate()
  const queryClient    = useQueryClient()
  const { session }    = useSession()
  const { data: user, isLoading } = useCurrentUser()
  const { data: stats }           = useTodayStats()
  const { data: recentLogs = [] } = useMyLogs(14)
  const { data: streakData }      = useStreakData()
  const { data: posts = [], isLoading: postsLoading } = useMyPosts()
  const { data: friendships }     = useFriendships()
  const updateProfile = useUpdateProfile()
  const toggleLike    = useToggleLike()
  const { toast }     = useToast()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [showAvatar, setShowAvatar] = useState(false)

  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const { data: dayLogs = [] }        = useLogsForDay(selectedDay ?? '')
  const [editingName, setEditingName] = useState(false)
  const [nameVal,     setNameVal]     = useState('')

  const [optimisticLikes, setOptimisticLikes] = useState<Record<string, boolean>>({})
  const [likeAnimating,   setLikeAnimating]   = useState<Record<string, boolean>>({})

  function handleLike(logId: string, logOwnerId: string, currentlyLiked: boolean) {
    const next = !currentlyLiked
    setOptimisticLikes((p) => ({ ...p, [logId]: next }))
    if (next) {
      setLikeAnimating((p) => ({ ...p, [logId]: true }))
      setTimeout(() => setLikeAnimating((p) => ({ ...p, [logId]: false })), 350)
    }
    toggleLike.mutate(
      { logId, logOwnerId, currentlyLiked },
      { onError: () => { setOptimisticLikes((p) => ({ ...p, [logId]: currentlyLiked })); toast('Could not like — try again', 'error') } },
    )
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const original = e.target.files?.[0]
    if (!original || !session?.user.id) return
    setUploadingAvatar(true)
    try {
      const file = await compressImage(original, 512)
      const ext  = file.name.split('.').pop() ?? 'jpg'
      const path = `${session.user.id}/avatar.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('avatars').upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) throw uploadErr

      // Same storage path every time (upsert), so bust the cache or the
      // browser/CDN keeps showing the previous photo.
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path)
      const photoUrl = `${urlData.publicUrl}?v=${Date.now()}`
      const { error: updateErr } = await supabase
        .from('users').update({ photo_url: photoUrl }).eq('id', session.user.id)
      if (updateErr) throw updateErr

      queryClient.invalidateQueries({ queryKey: ['currentUser'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['myPosts'] })
      toast('Photo updated ✓')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'try again'
      toast(`Could not update photo — ${msg}`, 'error')
    } finally {
      setUploadingAvatar(false)
      e.target.value = ''
    }
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <div className="topbar"><Skeleton className="h-6 w-24" /></div>
        <ProfileHeaderSkeleton />
        <Skeleton className="mt-5 h-44 !rounded-[27px]" />
        <div className="tile-grid mt-3">
          <Skeleton className="h-24 !rounded-[27px]" />
          <Skeleton className="h-24 !rounded-[27px]" />
        </div>
      </div>
    )
  }
  if (!user) return null

  const calorieGoal    = user.calorie_goal ?? 2000
  const proteinGoal    = dailyGoals(calorieGoal, user.protein_goal).protein
  const todayCal       = stats?.caloriesLogged ?? 0
  const todayProtein   = stats?.proteinLogged ?? 0
  const ringPct        = computeCalorieRingPct(todayCal, calorieGoal)
  const over           = todayCal > calorieGoal
  const weeklyAvg      = computeWeeklyAvgCalories(recentLogs)
  const weeklyDays     = computeWeeklyLoggedDays(recentLogs)
  const logDates       = streakData?.recentLogDates ?? buildLogDateSet(recentLogs)
  const effectiveStreak = streakData?.effectiveStreak ?? user.streak_count

  // Friendships here are mutual (both sides accepted), so there is one
  // count rather than separate followers/following. Incoming requests get
  // their own chip so they don't inflate it.
  const friendCount  = friendships?.accepted.length ?? 0
  const pendingCount = friendships?.incoming.length ?? 0

  function saveField(fields: Parameters<typeof updateProfile.mutate>[0]) {
    updateProfile.mutate(fields, {
      onSuccess: () => toast('Saved ✓'),
      onError:   () => toast('Could not save — try again', 'error'),
    })
  }

  return (
    <div>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="topbar">
        <span className="clay">@{user.username}</span>
        <span className="flex items-center gap-2.5">
          {/* Add friends — Instagram-style person+plus */}
          <button type="button" onClick={() => navigate('/home/friends')} aria-label="Find friends" className="circle sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10" cy="8" r="3.5" />
              <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
              <path d="M19 8v6M16 11h6" />
            </svg>
          </button>
          <button type="button" onClick={() => navigate('/home/rewards')} aria-label="Streaks and rewards" className="circle sm" style={{ fontSize: 15 }}>🔥</button>
          <button type="button" onClick={() => navigate('/home/settings')} aria-label="Settings" className="circle sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </span>
      </div>

      {/* ── Identity row ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => (user.photo_url ? setShowAvatar(true) : avatarInputRef.current?.click())}
          disabled={uploadingAvatar}
          aria-label={user.photo_url ? 'View profile photo' : 'Add profile photo'}
          className="no-press relative flex-none"
        >
          <Avatar name={user.name} photoUrl={user.photo_url} size="big" />
          <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-on-ink" style={{ boxShadow: '0 0 0 3px var(--color-canvas)' }}>
            {uploadingAvatar ? (
              <span className="text-[10px]">…</span>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </span>
        </button>
        <input ref={avatarInputRef} id="avatar-upload" type="file" accept="image/*" className="sr-only" onChange={handleAvatarChange} />
        {showAvatar && user.photo_url && (
          <PhotoViewer
            src={user.photo_url}
            alt={user.name}
            onClose={() => setShowAvatar(false)}
            actions={[{ label: 'Change photo', onClick: () => { setShowAvatar(false); avatarInputRef.current?.click() } }]}
          />
        )}

        <span className="min-w-0 flex-1">
          {editingName ? (
            <span className="flex items-center gap-2">
              <input value={nameVal} onChange={(e) => setNameVal(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { saveField({ name: nameVal }); setEditingName(false) } }}
                className="input" style={{ padding: '8px 12px' }} />
              <button type="button" onClick={() => { saveField({ name: nameVal }); setEditingName(false) }} className="pill sel">Save</button>
              <button type="button" onClick={() => setEditingName(false)} className="muted">✕</button>
            </span>
          ) : (
            <button type="button" onClick={() => { setNameVal(user.name); setEditingName(true) }} className="block text-left">
              <h3 className="truncate">{user.name}</h3>
            </button>
          )}
          <p className="small muted">Tap name or photo to edit</p>
          <span className="flex flex-wrap gap-x-3 gap-y-1 small" style={{ marginTop: 8 }}>
            <span><b>{posts.length}</b> posts</span>
            <button type="button" onClick={() => navigate(`/home/connections/${user.username}`)}>
              <b>{friendCount}</b> friend{friendCount === 1 ? '' : 's'}
            </button>
            {pendingCount > 0 && (
              <button type="button" onClick={() => navigate('/home/friends')} className="font-semibold">
                {pendingCount} request{pendingCount === 1 ? '' : 's'}
              </button>
            )}
          </span>
        </span>
      </div>

      {/* ── Today's ring ─────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 20 }}>
        <span className="caps">Today{effectiveStreak > 0 ? ` · ${effectiveStreak} day streak` : ''}</span>
        <div className="flex items-center gap-4" style={{ marginTop: 13 }}>
          <CalorieRing pct={ringPct} size={120} label={todayCal.toLocaleString()} sublabel="kcal" over={over} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span>Calories</span>
              <b className={over ? 'text-error' : 'calories-left'}>
                {over ? `${(todayCal - calorieGoal).toLocaleString()} over` : `${(calorieGoal - todayCal).toLocaleString()} left`}
              </b>
            </div>
            <div className={`bar calories ${over ? 'over' : ''}`} style={{ margin: '7px 0 18px' }}>
              <i style={{ width: `${Math.min(ringPct * 100, 100)}%` }} />
            </div>
            {proteinGoal > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span>Protein</span>
                  <b className="protein-total">{todayProtein} / {proteinGoal}g</b>
                </div>
                <div className="bar protein" style={{ marginTop: 7 }}>
                  <i style={{ width: `${Math.min((todayProtein / proteinGoal) * 100, 100)}%` }} />
                </div>
              </>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>{stats?.logCount ?? 0} meal{(stats?.logCount ?? 0) !== 1 ? 's' : ''} logged</p>
          </div>
        </div>
      </div>

      <ProfileBadges />

      {/* ── Weekly stats ──────────────────────────────────────────── */}
      <div className="tile-grid">
        <div className="tile compact">
          <span className="icon">▦</span>
          <span><b>{weeklyDays}/14</b><small className="block">days logged</small></span>
        </div>
        <div className="tile compact">
          <span className="icon">◌</span>
          <span><b>{weeklyAvg !== null ? weeklyAvg.toLocaleString() : '—'}</b><small className="block">avg kcal/day</small></span>
        </div>
      </div>

      {/* ── Consistency calendar ─────────────────────────────────── */}
      <div className="section">
        <span className="caps">Last 14 days · tap a day</span>
        <StreakCalendar logDates={logDates} days={14} selectedDay={selectedDay} onDayTap={(d) => setSelectedDay(selectedDay === d ? null : d)} />
        {selectedDay && (
          <div className="card tint animate-slide-down">
            <span className="caps">
              {new Date(selectedDay + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            {dayLogs.length === 0
              ? <p className="small muted" style={{ marginTop: 8 }}>Nothing logged this day</p>
              : dayLogs.map((log) => (
                <button key={log.id} type="button" onClick={() => navigate(`/home/log/${log.id}`)}
                  className="meal-row w-full items-center justify-between" style={{ marginBottom: 0 }}>
                  <span>
                    <b className="block text-[13px] font-semibold">{log.name || log.meal_type}</b>
                    <small className="muted capitalize">{log.meal_type}</small>
                  </span>
                  <b className="font-semibold">{(log.calories_final ?? log.calories_estimate ?? '—')} kcal</b>
                </button>
              ))
            }
          </div>
        )}
      </div>

      {/* ── My posts ─────────────────────────────────────────────── */}
      <div className="section">
        <span className="caps">Posts · {posts.length}</span>
        {postsLoading ? (
          [1, 2].map((i) => <FeedCardSkeleton key={i} />)
        ) : posts.length === 0 ? (
          <div className="card tint text-center" style={{ margin: 0, padding: 40 }}>
            <div className="flex justify-center"><SporkOrb size={40} /></div>
            <h4 style={{ marginTop: 12 }}>No meals logged yet</h4>
            <button type="button" onClick={() => navigate('/home/log')} className="btn">Log your first meal</button>
          </div>
        ) : (
          posts.map((item, i) => (
            <PostCard
              key={item.log.id}
              item={item}
              index={i}
              viewerId={item.author.id}
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
