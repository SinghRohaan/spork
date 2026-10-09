import { Send } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../../components/TopBar'
import { Skeleton } from '../../components/Skeleton'
import { Reasons, ScoreRing } from '../../components/Accountability'
import { useWeekMeals } from '../../hooks/useAccountability'
import { dayReview, weekStart, weekSummary, type Tone } from '../../lib/accountability'
import { ShareSheet } from '../../components/ShareModal'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { dayCards } from '../../lib/shareCards'
import { DayBadges } from '../../components/Badges'
import { localDateKey } from '../../lib/progress'

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MACRO_COLOR = { calories: 'var(--color-ink)', protein: 'var(--macro-protein)', carbs: 'var(--macro-carbs)', fat: 'var(--macro-fat)' }
const fmt = (n: number) => Math.round(n).toLocaleString()
const signed = (n: number) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${fmt(Math.abs(n))}`
const toneOf = (score: number | null): Tone | null => (score == null ? null : score >= 80 ? 'good' : score >= 60 ? 'mid' : 'low')
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Day review: one day's score, targets vs eaten, what's missing, its meals, and the last 7 days. */
export default function DayReview() {
  const navigate = useNavigate()
  const todayIndex = 6
  const [dayIndex, setDayIndex] = useState(todayIndex)
  const [sharing, setSharing] = useState(false)
  const { data: user } = useCurrentUser()
  const { data, goals, isError, refetch } = useWeekMeals({ withPhotos: true })

  if (isError) {
    return (
      <div>
        <TopBar title="Day review" back="/home/insights" />
        <div className="card text-center"><p className="muted">Couldn’t load your meals.</p><button type="button" className="btn" onClick={() => refetch()}>Try again</button></div>
      </div>
    )
  }
  if (!data || !goals) {
    return (
      <div>
        <TopBar title="Day review" back="/home/insights" />
        <Skeleton className="h-[420px] w-full rounded-[27px]" />
      </div>
    )
  }

  const dates = Array.from({ length: 7 }, (_, i) => { const d = weekStart(); d.setDate(d.getDate() + i); return d })
  const week = weekSummary(data.days, goals)
  const review = dayReview(data.days[dayIndex], goals, dayIndex === todayIndex)
  const eaten = (key: 'calories' | 'protein') => review.rows.find((r) => r.key === key)!.eaten

  return (
    <div>
      <TopBar title="Day review" back="/home/insights"
        right={review.score != null && user ? <button type="button" className="circle" aria-label="Share this day" onClick={() => setSharing(true)}><Send size={18} aria-hidden="true" /></button> : undefined} />
      {sharing && review.score != null && user && (
        <ShareSheet
          cards={dayCards({
            username: user.username,
            date: dates[dayIndex],
            score: review.score,
            tone: review.tone,
            label: review.label,
            calories: eaten('calories'),
            calorieGoal: goals.calories,
            protein: eaten('protein'),
            proteinGoal: goals.protein,
            meals: review.meals.map((m) => ({ name: m.name || m.meal_type.charAt(0).toUpperCase() + m.meal_type.slice(1), calories: m.calories })),
          })}
          fileName={`spork-${user.username}-day`}
          message={`My day on Spork: ${review.score}/100 · ${review.label}`}
          note={<>tag <b>@sporkapp</b></>}
          onClose={() => setSharing(false)}
        />
      )}

      {/* ── Day picker (this week) ─────────────────────────── */}
      <div className="day-pick" role="group" aria-label="Day">
        {dates.map((date, i) => {
          const tone = toneOf(week.scores[i])
          return (
            <button key={i} type="button" onClick={() => setDayIndex(i)} aria-pressed={i === dayIndex}
              className={`${i === dayIndex ? 'on' : ''} ${tone ? `tone-${tone}` : ''}`}>
              {i === todayIndex ? 'Today' : DAY_LETTERS[date.getDay()]}<b>{date.getDate()}</b><i />
            </button>
          )
        })}
      </div>

      {/* ── Score ──────────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center" style={{ marginTop: 18 }}>
        <ScoreRing score={review.score} tone={review.tone} size={140} stroke={12} />
        <h3 style={{ marginTop: 12 }}>{review.label}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{review.summary}</p>
      </div>

      <div style={{ marginTop: 14 }}><DayBadges day={localDateKey(dates[dayIndex])} /></div>

      {/* ── Planned vs eaten ───────────────────────────────── */}
      <div className="card">
        <div className="target-row head"><span>Target</span><span>Planned</span><span>Eaten</span><span>Gap</span></div>
        {review.rows.map((row) => (
          <div key={row.key} className="target-row">
            <span className="flex items-center gap-2"><span className="macro-dot" style={{ background: MACRO_COLOR[row.key] }} />{row.label}</span>
            <span className="muted">{fmt(row.planned)}{row.key === 'calories' ? '' : ' g'}</span>
            <b className="font-semibold">{fmt(row.eaten)}{row.key === 'calories' ? '' : ' g'}</b>
            <span>{data.days[dayIndex].length ? <span className={`score-chip tone-${row.tone}`}>{signed(row.gap)}{row.key === 'calories' ? '' : ' g'}</span> : <span className="muted">—</span>}</span>
          </div>
        ))}
      </div>

      {/* ── What's missing ─────────────────────────────────── */}
      {review.missing.length > 0 && (
        <div className="card">
          <span className="caps">What’s missing</span>
          <div style={{ marginTop: 6 }}><Reasons items={review.missing} /></div>
        </div>
      )}

      {/* ── Meals ──────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between"><h4>Meals</h4><span className="tiny muted">{review.meals.length} logged</span></div>
        {review.meals.map((meal) => {
          const photo = meal.photo_url ? data.photos.get(meal.photo_url) : null
          return (
            <button key={meal.id} type="button" onClick={() => navigate(`/home/log/${meal.id}`)} className="flex w-full items-center gap-3 text-left"
              style={{ padding: '12px 0', borderTop: '1px solid var(--color-line)', marginTop: 10 }}>
              {photo ? <img src={photo} alt="" className="photo thumb" /> : <span className="photo thumb grid place-items-center muted" aria-hidden="true">◌</span>}
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold">{meal.name || meal.meal_type}</b>
                <small className="muted block">{meal.meal_type.charAt(0).toUpperCase() + meal.meal_type.slice(1)} · {time(meal.created_at)} · {fmt(meal.calories)} kcal · {Math.round(meal.protein)} g P</small>
              </span>
              <span className={`score-chip tone-${meal.tone}`}>{meal.score}/10</span>
            </button>
          )
        })}
        {review.roomKcal >= 150 && (
          <button type="button" onClick={() => navigate('/home/log')} className="flex w-full items-center gap-3 text-left"
            style={{ padding: '12px 0 2px', borderTop: '1px dashed var(--color-line)', marginTop: 10 }}>
            <span className="photo thumb grid place-items-center muted" style={{ background: 'none', border: '1.5px dashed var(--color-line)' }} aria-hidden="true">＋</span>
            <span className="min-w-0 flex-1"><b className="block font-semibold">Log a meal</b><small className="muted block">Room for ~{fmt(review.roomKcal)} kcal today</small></span>
          </button>
        )}
        {!review.meals.length && review.roomKcal < 150 && <p className="small muted" style={{ marginTop: 10 }}>No meals logged this day.</p>}
      </div>

      {/* ── This week ──────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between gap-2">
          <h4>Last 7 days</h4>
          {week.daysLogged > 0 && <span className={`score-chip tone-${week.daysOnTarget ? 'good' : 'mid'}`}>{week.daysOnTarget} / {week.daysLogged} days scored 80+</span>}
        </div>
        <div className="week-scores" style={{ marginTop: 14 }} aria-label="Day scores, last 7 days">
          {week.scores.map((s, i) => (
            <div key={i} className={toneOf(s) ? `tone-${toneOf(s)}` : ''}>{s ?? ''}<i style={{ height: s ? Math.max(8, s * 0.8) : 6 }} /></div>
          ))}
        </div>
        <div className="week-scores" style={{ height: 'auto', marginTop: 6 }}>
          {dates.map((d, i) => <span key={i} style={i === dayIndex ? { color: 'var(--color-ink)', fontWeight: 700 } : undefined}>{DAY_LETTERS[d.getDay()]}</span>)}
        </div>
        <div className="mini-stats">
          <div><span className="kpi" style={{ fontSize: 20 }}>{week.avgScore ?? '—'}</span><small className="tiny muted block">avg score</small></div>
          <div><span className="kpi" style={{ fontSize: 20 }}>{week.mealsPerDay ?? '—'}</span><small className="tiny muted block">meals / day</small></div>
          <div><span className="kpi" style={{ fontSize: 20 }}>{week.proteinHit} / {week.daysLogged}</span><small className="tiny muted block">protein hit</small></div>
        </div>
      </div>
      <p className="tiny muted text-center" style={{ margin: '4px 0 20px' }}>Only you can see your scores.</p>
    </div>
  )
}
