import { useNavigate } from 'react-router-dom'
import { useWeekMeals } from '../hooks/useAccountability'
import { dayReview, mealScore, type Goals, type Reason, type ScoredMeal, type Tone } from '../lib/accountability'

const MACRO_COLOR = { calories: 'var(--color-ink)', protein: 'var(--macro-protein)', carbs: 'var(--macro-carbs)', fat: 'var(--macro-fat)' }
const ICON: Record<Tone, string> = { good: '✓', mid: '~', low: '↑' }
const fmt = (n: number) => Math.round(n).toLocaleString()

export function ScoreRing({ score, tone, size = 64, stroke = 7, max = 100 }: { score: number | null; tone: Tone; size?: number; stroke?: number; max?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = score == null ? 0 : Math.min(1, score / max)
  return (
    <div className={`score-ring tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={score == null ? 'No score yet' : `Score ${score} out of ${max}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-soft2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tone)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <b style={{ fontSize: size * 0.3 }}>{score ?? '—'}</b>
    </div>
  )
}

export function Reasons({ items }: { items: Reason[] }) {
  return (
    <div>
      {items.map((r) => (
        <div key={r.text} className={`reason tone-${r.tone}`}>
          <i aria-hidden="true">{ICON[r.tone]}</i>
          <span><b className="font-semibold">{r.text}</b>{r.hint && <small className="muted block">{r.hint}</small>}</span>
        </div>
      ))}
    </div>
  )
}

/** "Today's review" — top of Insights → Overview. Opens the full day review. */
export function TodayReviewCard() {
  const navigate = useNavigate()
  const { data, goals } = useWeekMeals()
  if (!data || !goals) return null
  const review = dayReview(data.days[data.days.length - 1], goals, true)
  const tip = review.missing.find((m) => m.tone !== 'good') ?? review.missing[0]

  return (
    <button type="button" onClick={() => navigate('/home/insights/review')} className="card block w-full text-left" style={{ marginTop: 0, border: '1px solid var(--color-line)' }}>
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="caps">Today’s review</span>
          <span className="block font-display" style={{ fontSize: 18, fontWeight: 500, marginTop: 3 }}>{review.label}</span>
        </span>
        <ScoreRing score={review.score} tone={review.tone} />
      </span>
      <span className="grid grid-cols-2 gap-x-4 gap-y-3" style={{ marginTop: 12 }}>
        {review.rows.map((row) => (
          <span key={row.key} className="block">
            <span className="flex justify-between gap-2 tiny"><span>{row.label}</span><span className="muted">{fmt(row.eaten)} / {fmt(row.planned)}{row.key === 'calories' ? '' : ' g'}</span></span>
            <span className="meter block" style={{ marginTop: 5 }}><i style={{ width: `${Math.min(100, (row.eaten / row.planned) * 100)}%`, background: MACRO_COLOR[row.key] }} /></span>
          </span>
        ))}
      </span>
      {tip && (
        <span className="flex items-center gap-2 small" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 14, background: 'var(--color-soft)' }}>
          <span className={`tone-${tip.tone}`} style={{ color: 'var(--tone)' }} aria-hidden="true">●</span>
          <span className="min-w-0 flex-1"><b className="font-semibold">{tip.text}.</b> <span className="muted">{tip.hint}</span></span>
          <span className="muted" aria-hidden="true">›</span>
        </span>
      )}
    </button>
  )
}

/** Meal score on the owner's meal page. */
export function MealScoreCard({ meal, goals }: { meal: ScoredMeal; goals: Goals }) {
  const s = mealScore(meal, goals)
  return (
    <div className={`card tone-${s.tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="caps">Meal score</span>
          <h4 style={{ marginTop: 3 }}>{s.headline}</h4>
          {s.note && <p className="tiny muted" style={{ marginTop: 2 }}>{s.note}</p>}
        </div>
        <span className="font-display" style={{ fontSize: 34, lineHeight: 1, color: 'var(--tone)' }}>{s.score ?? '—'}<small className="muted" style={{ font: '13px var(--font-sans)' }}> /10</small></span>
      </div>
      <div className="score-bar" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <span key={i} className={i < (s.score ?? 0) ? 'on' : ''} />)}</div>
      <div style={{ marginTop: 8 }}><Reasons items={s.reasons} /></div>
      {s.basic && <p className="tiny muted" style={{ marginTop: 6 }}>Basic score — fibre and sugar weren’t tracked when this was logged.</p>}
      <p className="tiny muted" style={{ marginTop: 6 }}>Only you can see your scores.</p>
    </div>
  )
}
