import { ScoreRing } from './Accountability'
import { dailyGoals, mealScore } from '../lib/accountability'
import { foodEmoji, postedItems } from '../lib/mealItems'
import { formatItemQuantity } from '../lib/parseEstimate'
import type { FeedItem } from '../hooks/useFeed'

const MAX_ITEMS = 4
const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--macro-protein)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--macro-carbs)' },
  { key: 'fat', label: 'Fat', color: 'var(--macro-fat)' },
] as const

/** A post's second slide: meal score, totals and each item with its calories and macros. */
export function MealBreakdown({ log, author, onMore }: Pick<FeedItem, 'log' | 'author'> & { onMore: () => void }) {
  const meal = {
    id: log.id,
    name: log.name,
    meal_type: log.meal_type,
    created_at: log.created_at,
    photo_url: log.photo_url,
    calories: log.calories_final ?? log.calories_estimate ?? 0,
    protein: log.protein_final_g ?? log.protein_estimate_g ?? 0,
    carbs: log.carbs_final_g ?? log.carbs_estimate_g ?? 0,
    fat: log.fat_final_g ?? log.fat_estimate_g ?? 0,
  }
  const score = mealScore(meal, dailyGoals(author.calorie_goal, author.protein_goal))
  const items = postedItems(log)
  const extra = items.length - MAX_ITEMS

  return (
    <div className="breakdown">
      <div className="flex items-center gap-3.5">
        <ScoreRing score={score.score} tone={score.tone} max={10} size={70} stroke={7} />
        <span className="min-w-0">
          <span className="caps">Meal score</span>
          <b className="block truncate font-display" style={{ fontSize: 19, fontWeight: 500, marginTop: 2 }}>{score.headline}</b>
          <small className="muted block">
            {Math.round(meal.calories).toLocaleString()} kcal{items.length ? ` · ${items.length} item${items.length === 1 ? '' : 's'}` : ''}
          </small>
        </span>
      </div>

      <div className="breakdown-macros">
        {MACROS.map((m) => (
          <span key={m.key}>
            <small className="tiny muted flex items-center gap-1.5"><span className="macro-dot" style={{ background: m.color, width: 7, height: 7 }} />{m.label}</small>
            <b className="block font-semibold">{Math.round(meal[m.key])} g</b>
          </span>
        ))}
      </div>

      {items.length > 0 ? (
        <div style={{ marginTop: 6 }}>
          {items.slice(0, MAX_ITEMS).map((item, i) => {
            const amount = formatItemQuantity(item)
            return (
              <div key={i} className="breakdown-item">
                <span className="breakdown-emoji" aria-hidden="true">{foodEmoji(item.name)}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold">{item.name}</b>
                  <small className="muted block truncate">{amount ? `${amount} · ` : ''}P {item.protein_g} · C {item.carbs_g} · F {item.fat_g}</small>
                </span>
                <span className="flex-none text-right"><b className="block font-semibold">{item.calories}</b><small className="tiny muted">kcal</small></span>
              </div>
            )
          })}
          {extra > 0 && (
            <button type="button" onClick={onMore} className="small muted block w-full text-center" style={{ paddingTop: 8 }}>
              See {extra} more item{extra === 1 ? '' : 's'}
            </button>
          )}
        </div>
      ) : (
        <p className="small muted" style={{ marginTop: 12 }}>Item details weren’t saved for this meal.</p>
      )}
    </div>
  )
}
