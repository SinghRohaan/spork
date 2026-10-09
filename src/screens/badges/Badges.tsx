import { useState } from 'react'
import { TopBar } from '../../components/TopBar'
import { Skeleton } from '../../components/Skeleton'
import { BadgeMedal, BadgeSheet } from '../../components/Badges'
import { useBadges } from '../../hooks/useBadges'
import { badgeDate, type Badge } from '../../lib/badges'

/** All badges: the ones you've earned, and progress towards the rest. */
export default function Badges() {
  const { badges, isError, refetch } = useBadges()
  const [tab, setTab] = useState<'earned' | 'locked'>('earned')
  const [open, setOpen] = useState<Badge | null>(null)

  if (isError) {
    return (
      <div>
        <TopBar title="Badges" back="/home/profile" />
        <div className="card text-center"><p className="muted">Couldn’t load your badges.</p><button type="button" className="btn" onClick={() => refetch()}>Try again</button></div>
      </div>
    )
  }
  if (!badges) {
    return <div><TopBar title="Badges" back="/home/profile" /><Skeleton className="h-[420px] w-full rounded-[27px]" /></div>
  }

  const earned = badges.filter((b) => b.earnedOn).sort((a, b) => b.earnedOn!.localeCompare(a.earnedOn!))
  const locked = badges.filter((b) => !b.earnedOn).sort((a, b) => b.progress / b.target - a.progress / a.target)
  const shown = tab === 'earned' ? earned : locked

  return (
    <div>
      <TopBar title="Badges" back="/home/profile" />

      <div className="card flex items-center gap-4" style={{ marginTop: 0 }}>
        <b className="font-display" style={{ fontSize: 34, fontWeight: 500 }}>{earned.length}<span className="muted" style={{ fontSize: 18 }}> / {badges.length}</span></b>
        <span className="min-w-0 flex-1">
          <small className="muted block">badges earned</small>
          <span className="meter block" style={{ marginTop: 6 }}><i style={{ width: `${(earned.length / badges.length) * 100}%` }} /></span>
        </span>
      </div>

      <div className="seg" role="tablist" style={{ marginBottom: 18 }}>
        <button type="button" role="tab" aria-selected={tab === 'earned'} className={tab === 'earned' ? 'on' : ''} onClick={() => setTab('earned')}>Earned</button>
        <button type="button" role="tab" aria-selected={tab === 'locked'} className={tab === 'locked' ? 'on' : ''} onClick={() => setTab('locked')}>To unlock</button>
      </div>

      {shown.length === 0 ? (
        <div className="card tint text-center" style={{ padding: 30 }}>
          <b className="block font-semibold">{tab === 'earned' ? 'No badges yet' : 'You’ve earned them all 🎉'}</b>
          {tab === 'earned' && <p className="small muted">Log a meal to earn your first one.</p>}
        </div>
      ) : (
        <div className="badge-grid">
          {shown.map((b) => (
            <button key={b.id} type="button" onClick={() => setOpen(b)} className="text-center">
              <BadgeMedal badge={b} />
              <b className="block font-semibold" style={{ fontSize: 13, marginTop: 8 }}>{b.name}</b>
              {b.earnedOn
                ? <small className="tiny muted">{b.times > 1 ? `×${b.times} · ` : ''}{badgeDate(b.earnedOn)}</small>
                : <>
                    <small className="tiny muted">{b.progress} / {b.target}</small>
                    <span className="meter block" style={{ width: '70%', margin: '5px auto 0' }}><i style={{ width: `${(b.progress / b.target) * 100}%` }} /></span>
                  </>}
            </button>
          ))}
        </div>
      )}
      <div style={{ height: 24 }} />
      {open && <BadgeSheet badge={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
