import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useBadges } from '../hooks/useBadges'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { badgeDate, type Badge } from '../lib/badges'
import { badgeCard } from '../lib/shareCards'
import { localDateKey } from '../lib/progress'
import { hapticCelebration } from '../lib/haptics'
import { ShareSheet } from './ShareModal'

/** Hexagon medal: coloured rim, dark face, emoji. Greyed out while locked. */
export function BadgeMedal({ badge, size = 84 }: { badge: Badge; size?: number }) {
  const earned = Boolean(badge.earnedOn)
  return (
    <span className={`badge-medal ${earned ? '' : 'locked'}`} style={{ width: size, height: size * 1.12, background: earned ? `linear-gradient(160deg, ${badge.colors[0]}, ${badge.colors[1]})` : undefined }} aria-hidden="true">
      <span style={{ fontSize: size * 0.36 }}>{badge.emoji}</span>
    </span>
  )
}

/** Detail / unlock sheet for one badge, with Share once it's earned. */
export function BadgeSheet({ badge, celebrate = false, onClose }: { badge: Badge; celebrate?: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { data: user } = useCurrentUser()
  const [sharing, setSharing] = useState(false)
  const today = localDateKey(new Date())
  const earned = badge.earnedOn

  if (sharing && earned && user) {
    return (
      <ShareSheet
        cards={[{ label: 'Badge', render: () => badgeCard({ username: user.username, name: badge.name, emoji: badge.emoji, colors: badge.colors, done: badge.done, earnedOn: earned }) }]}
        fileName={`spork-${user.username}-${badge.id}`}
        message={`I unlocked ${badge.name} on Spork ${badge.emoji}`}
        note={<>tag <b>@sporkapp</b></>}
        onClose={onClose}
      />
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-5 animate-fade-in" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="badge-sheet animate-slide-up" style={{ '--badge': badge.colors[1] } as React.CSSProperties}>
        <div className="flex justify-end"><button type="button" onClick={onClose} className="circle" aria-label="Close">✕</button></div>
        <div className="flex justify-center"><BadgeMedal badge={badge} size={128} /></div>
        <span className="pill badge-when" style={earned ? { color: badge.colors[0] } : undefined}>
          {earned ? (earned === today ? 'Unlocked today' : `Unlocked ${badgeDate(earned)}`) : `${badge.progress} / ${badge.target}`}
        </span>
        <h2 style={{ marginTop: 10 }}>{badge.name}</h2>
        <p className="small muted" style={{ margin: '6px 8px 0' }}>{earned ? badge.done : badge.how}{earned && badge.times > 1 ? ` · ${badge.times} times so far` : ''}</p>
        {!earned && <span className="meter block" style={{ margin: '16px 20px 0' }}><i style={{ width: `${(badge.progress / badge.target) * 100}%` }} /></span>}
        {earned && <button type="button" className="btn" style={{ marginTop: 22 }} onClick={() => setSharing(true)}>↗ Share</button>}
        {celebrate && <button type="button" className="small muted block w-full" style={{ marginTop: 14 }} onClick={() => { onClose(); navigate('/home/badges') }}>See all badges</button>}
      </div>
    </div>,
    document.body,
  )
}

const seenKey = (userId: string) => `spork-badges-seen:${userId}`
function readSeen(userId: string): string[] | null {
  try { const raw = localStorage.getItem(seenKey(userId)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeSeen(userId: string, ids: string[]) {
  try { localStorage.setItem(seenKey(userId), JSON.stringify(ids)) } catch { /* private mode: we may celebrate again */ }
}

/**
 * Pops up "Badge unlocked" for badges earned since this phone last saw
 * them. The very first time, older badges count as seen — only ones earned
 * today get a celebration. `paused` holds it back (e.g. mid-logging).
 */
export function BadgeCelebration({ paused = false }: { paused?: boolean }) {
  const { data: user } = useCurrentUser()
  const { badges } = useBadges()
  const [, rerender] = useState(0)
  const userId = user?.id

  useEffect(() => {
    if (!userId || !badges || readSeen(userId)) return
    const today = localDateKey(new Date())
    writeSeen(userId, badges.filter((b) => b.earnedOn && b.earnedOn !== today).map((b) => b.id))
    rerender((n) => n + 1)
  }, [userId, badges])

  // Read fresh each render: another instance may have just marked one seen.
  const seen = userId ? readSeen(userId) : null
  const next = seen && badges?.find((b) => b.earnedOn && !seen.includes(b.id))
  const show = Boolean(next && !paused)

  useEffect(() => { if (show) hapticCelebration() }, [show, next?.id])

  if (!show || !next || !userId) return null
  return (
    <BadgeSheet badge={next} celebrate onClose={() => {
      writeSeen(userId, [...(readSeen(userId) ?? []), next.id])
      rerender((n) => n + 1)
    }} />
  )
}

/** Profile: earned count and the latest three medals. */
export function ProfileBadges() {
  const navigate = useNavigate()
  const { badges } = useBadges()
  if (!badges) return null
  const earned = badges.filter((b) => b.earnedOn).sort((a, b) => b.earnedOn!.localeCompare(a.earnedOn!))
  return (
    <button type="button" onClick={() => navigate('/home/badges')} className="card flex w-full items-center gap-3 text-left">
      <span className="min-w-0 flex-1">
        <span className="caps">Badges</span>
        <b className="block font-display" style={{ fontSize: 22, fontWeight: 500, marginTop: 2 }}>{earned.length}<span className="muted" style={{ fontSize: 15 }}> / {badges.length}</span></b>
        <small className="muted">{earned.length ? 'Tap to see them all' : 'Log meals to start earning'}</small>
      </span>
      <span className="flex">
        {(earned.length ? earned : badges).slice(0, 3).map((b, i) => <span key={b.id} style={{ marginLeft: i ? -10 : 0 }}><BadgeMedal badge={b} size={40} /></span>)}
      </span>
    </button>
  )
}

/** Day review: badges earned on the day being viewed. */
export function DayBadges({ day }: { day: string }) {
  const { badges } = useBadges()
  const [open, setOpen] = useState<Badge | null>(null)
  const earned = badges?.filter((b) => b.earnedOn === day) ?? []
  if (!earned.length) return null
  return (
    <>
      {earned.map((b) => (
        <button key={b.id} type="button" onClick={() => setOpen(b)} className="card flex w-full items-center gap-3 text-left" style={{ background: `linear-gradient(135deg, ${b.colors[1]}33, var(--color-paper) 60%)` }}>
          <BadgeMedal badge={b} size={46} />
          <span className="min-w-0 flex-1"><b className="block truncate font-semibold">Badge unlocked: {b.name}</b><small className="muted block truncate">{b.done}</small></span>
          <span className="pill">Share</span>
        </button>
      ))}
      {open && <BadgeSheet badge={open} onClose={() => setOpen(null)} />}
    </>
  )
}
