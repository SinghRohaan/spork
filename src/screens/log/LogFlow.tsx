import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Capture from './Capture'
import EstimateEdit from './EstimateEdit'
import PackagedScanner from './PackagedScanner'
import { SporkLoader } from '../../components/brand/SporkLoader'
import { useLogDraftStore, type EstimateResult } from '../../store/logDraft'
import { estimateMeal, type ConfirmedItem } from '../../lib/estimateMeal'
import { suggestMealType } from '../../lib/mealType'
import { postLog } from '../../lib/postLog'
import { useSession } from '../../hooks/useSession'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { useTodayStats } from '../../hooks/useTodayStats'
import { computeNextStreak, getEffectiveStreak } from '../../lib/streak'
import { hapticSuccess, hapticCelebration, hapticError } from '../../lib/haptics'

type Step = 'capture' | 'scan' | 'loading' | 'edit' | 'not-food' | 'celebration'

interface CelebrationData {
  logId: string
  calories: number
  newStreakCount: number
  wasStreakBroken: boolean
  remaining: number
  calorieGoal: number
  mealName: string
}

export default function LogFlow() {
  const navigate      = useNavigate()
  const queryClient   = useQueryClient()
  const { session }   = useSession()
  const { data: user } = useCurrentUser()
  const { data: stats } = useTodayStats()

  const [step, setStep]         = useState<Step>(() => (useLogDraftStore.getState().estimate ? 'edit' : 'capture'))
  const [posting, setPosting]   = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [celebData, setCelebData] = useState<CelebrationData | null>(null)
  const [notFoodReason, setNotFoodReason] = useState('')
  const estimateRequestIdRef    = useRef(0)
  /** 'packaged' when the current photo is a wrapper/label — re-estimates keep reading it as one. */
  const estimateModeRef         = useRef<'meal' | 'packaged'>('meal')

  const photoFile    = useLogDraftStore((s) => s.photoFile)
  const applyEstimate = useLogDraftStore((s) => s.applyEstimate)
  const reset        = useLogDraftStore((s) => s.reset)

  /** The AI says the photo isn't edible (balm, soap…): drop the photo so it can't be posted. */
  function blockNonFood(reason: string) {
    estimateRequestIdRef.current++
    reset()
    setNotFoodReason(reason)
    setStep('not-food')
  }

  async function handleGetEstimate() {
    if (!photoFile) return
    const requestId = ++estimateRequestIdRef.current
    estimateModeRef.current = 'meal'
    setStep('loading')
    const result = await estimateMeal(photoFile, useLogDraftStore.getState().description)
    if (estimateRequestIdRef.current !== requestId) return
    if (result?.parsed.notFood) { blockNonFood(result.parsed.notFood); return }
    applyEstimate(result, suggestMealType(new Date()), user?.privacy_default ?? 'public')
    setStep('edit')
  }

  /**
   * "Recalculate with AI" on the review screen: re-send the photo with the
   * user's corrected item list as hard constraints. Returns false on failure
   * so the screen can say so; the current numbers are left untouched.
   */
  async function handleReestimate(confirmedItems: ConfirmedItem[]): Promise<boolean> {
    if (!photoFile) return false
    const requestId = ++estimateRequestIdRef.current
    const result = await estimateMeal(photoFile, useLogDraftStore.getState().description, confirmedItems, estimateModeRef.current)
    if (estimateRequestIdRef.current !== requestId) return false
    if (!result) return false
    if (result.parsed.notFood) { blockNonFood(result.parsed.notFood); return true }
    useLogDraftStore.getState().applyReestimate(result)
    return true
  }

  /** Barcode matched Open Food Facts: exact label numbers, no photo needed. */
  function handlePackagedProduct(estimate: EstimateResult) {
    estimateRequestIdRef.current++
    estimateModeRef.current = 'packaged'
    reset()
    applyEstimate(estimate, suggestMealType(new Date()), user?.privacy_default ?? 'public')
    useLogDraftStore.getState().setMealName(estimate.parsed.items[0]?.name ?? '')
    setStep('edit')
  }

  /** No barcode data: the AI reads the photographed pack / nutrition table. */
  async function handleReadLabel(photo: File, productHint?: string) {
    reset()
    useLogDraftStore.getState().setPhoto(photo)
    if (productHint) useLogDraftStore.getState().setDescription(`Product: ${productHint}`)
    estimateModeRef.current = 'packaged'
    const requestId = ++estimateRequestIdRef.current
    setStep('loading')
    const result = await estimateMeal(photo, useLogDraftStore.getState().description, undefined, 'packaged')
    if (estimateRequestIdRef.current !== requestId) return
    if (result?.parsed.notFood) { blockNonFood(result.parsed.notFood); return }
    applyEstimate(result, suggestMealType(new Date()), user?.privacy_default ?? 'public')
    // A product's real name beats a generated fun name.
    if (result?.parsed.items[0]?.name) useLogDraftStore.getState().setMealName(result.parsed.items[0].name)
    setStep('edit')
  }

  function handleSkipPhoto() {
    applyEstimate(null, suggestMealType(new Date()), user?.privacy_default ?? 'public')
    setStep('edit')
  }

  async function handlePost() {
    if (!session || !user) return
    setPosting(true)
    setPostError(null)

    try {
      const draft = useLogDraftStore.getState()
      const logId = await postLog({
        userId: session.user.id,
        photoFile,
        mealName: draft.mealName,
        description: draft.description,
        caption: draft.caption,
        mealType: draft.mealType,
        visibility: draft.visibility,
        satiety: draft.satiety,
        estimate: draft.estimate,
        finalCalories: draft.calories,
        finalProteinG: draft.proteinG,
        finalCarbsG: draft.carbsG,
        finalFatG: draft.fatG,
        currentStreakCount: user.streak_count,
        currentStreakLastLogDate: user.streak_last_log_date,
      })

      // Compute new streak for celebration display
      const { streak_count: newStreakCount } = computeNextStreak(
        user.streak_count,
        user.streak_last_log_date,
        new Date(),
      )
      const wasStreakBroken = getEffectiveStreak(user.streak_count, user.streak_last_log_date, new Date()) === 0
      const isStreakMilestone = [7, 30, 100].includes(newStreakCount)

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['currentUser'] })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
      queryClient.invalidateQueries({ queryKey: ['todayStats'] })
      queryClient.invalidateQueries({ queryKey: ['friendProfile'] })

      const caloriesLogged = draft.calories ?? 0
      const calorieGoal = stats?.calorieGoal ?? user.calorie_goal ?? 2000
      const prevLogged  = stats?.caloriesLogged ?? 0
      const remaining   = Math.max(calorieGoal - prevLogged - caloriesLogged, 0)

      setCelebData({
        logId,
        calories: caloriesLogged,
        newStreakCount,
        wasStreakBroken,
        remaining,
        calorieGoal,
        mealName: draft.mealName,
      })
      reset()
      setStep('celebration')
      // Haptic — milestone gets celebration pulse, normal post gets success tap
      if (isStreakMilestone) hapticCelebration()
      else hapticSuccess()
    } catch {
      hapticError()
      setPostError("Couldn't post — check your connection and try again.")
    } finally {
      setPosting(false)
    }
  }

  if (step === 'capture') {
    return <Capture onGetEstimate={handleGetEstimate} onSkipPhoto={handleSkipPhoto} onScanPackaged={() => setStep('scan')} />
  }

  if (step === 'scan') {
    return <PackagedScanner onBack={() => setStep('capture')} onProduct={handlePackagedProduct} onReadLabel={handleReadLabel} />
  }

  if (step === 'loading') {
    return <LoadingScreen onSkip={() => {
      estimateRequestIdRef.current++
      applyEstimate(null, suggestMealType(new Date()), user?.privacy_default ?? 'public')
      setStep('edit')
    }} photoFile={photoFile} />
  }

  if (step === 'edit') {
    return <EstimateEdit onBack={() => setStep('capture')} onPost={handlePost} posting={posting} postError={postError} onReestimate={photoFile ? handleReestimate : undefined} />
  }

  if (step === 'not-food') {
    return <NotFoodScreen reason={notFoodReason} onRetry={() => setStep('capture')} />
  }

  if (step === 'celebration' && celebData) {
    return <CelebrationScreen data={celebData} onViewPost={() => navigate(`/home/log/${celebData.logId}`)} onDone={() => navigate('/home/feed')} />
  }

  return null
}

// ── Loading screen ───────────────────────────────────────────────────────────

function LoadingScreen({ onSkip, photoFile }: { onSkip: () => void; photoFile: File | null }) {
  const previewUrl = useMemo(() => (photoFile ? URL.createObjectURL(photoFile) : null), [photoFile])

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  return (
    <div>
      <div className="topbar">
        <span style={{ width: 42 }} />
        <span className="clay">Log a meal</span>
        <span style={{ width: 42 }} />
      </div>
      <div className="text-center" style={{ paddingTop: 100 }}>
        <div className="icon-box relative mx-auto overflow-hidden" style={{ width: 145, height: 145, borderRadius: 48, fontSize: 70 }}>
          {previewUrl && <img src={previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm" />}
          <span className="relative"><SporkLoader size={70} label="Analysing your meal" /></span>
        </div>
        <div style={{ height: 28 }} />
        <h2>Analysing your meal</h2>
        <p className="muted">Identifying ingredients and estimating macros</p>
        <div style={{ height: 28 }} />
        <button type="button" onClick={onSkip} className="btn light">Skip · enter manually</button>
      </div>
    </div>
  )
}

// ── Not-food screen ──────────────────────────────────────────────────────────

function NotFoodScreen({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <div className="text-center animate-fade-in" style={{ paddingTop: 100 }}>
      <div className="icon-box mx-auto" style={{ width: 120, height: 120, borderRadius: 40, fontSize: 56 }} aria-hidden="true">🚫</div>
      <div style={{ height: 24 }} />
      <h2>That’s not food</h2>
      <p className="muted">{reason}</p>
      <p className="small muted" style={{ marginTop: 8 }}>Spork only logs things you eat or drink, so this photo can’t be posted.</p>
      <div style={{ height: 24 }} />
      <button type="button" onClick={onRetry} className="btn">Log something else</button>
    </div>
  )
}

// ── Celebration screen ───────────────────────────────────────────────────────

function CelebrationScreen({ data, onViewPost, onDone }: {
  data: CelebrationData
  onViewPost: () => void
  onDone: () => void
}) {
  const pct = data.calorieGoal > 0 ? Math.min(Math.round(((data.calorieGoal - data.remaining) / data.calorieGoal) * 100), 100) : 0
  const isStreakMilestone = [7, 30, 100].includes(data.newStreakCount)

  return (
    <div className="text-center animate-fade-in" style={{ paddingTop: 60 }}>
      <span className="font-display block" style={{ fontSize: 90, lineHeight: 1 }}>{isStreakMilestone ? '🏆' : '🔥'}</span>
      <h2>
        {isStreakMilestone
          ? `${data.newStreakCount}-day streak!`
          : data.wasStreakBroken
          ? 'Streak back on track!'
          : 'Logged!'}
      </h2>
      {data.mealName && <p className="muted">{data.mealName}</p>}

      {/* Calorie summary */}
      <div className="card text-left" style={{ marginTop: 30 }}>
        <div className="flex items-center justify-between">
          <b className="font-semibold">Today’s budget</b>
          <b className="font-semibold">{data.calories.toLocaleString()} kcal added</b>
        </div>
        {data.calorieGoal > 0 && (
          <>
            <div className="bar calories" style={{ margin: '15px 0' }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="flex items-center justify-between small muted">
              <span>{pct}% of daily goal</span>
              {data.remaining > 0
                ? <span className="calories-left">{data.remaining.toLocaleString()} kcal remaining</span>
                : <span>Goal reached ✓</span>}
            </div>
          </>
        )}
      </div>

      {/* Streak */}
      <div className="card tint text-left">
        <h3>{data.newStreakCount} day streak</h3>
        <p className="small muted">{isStreakMilestone ? 'You’ve hit a milestone!' : 'Your log keeps it going'}</p>
      </div>

      {/* Actions */}
      <button type="button" onClick={onViewPost} className="btn light">View post</button>
      <button type="button" onClick={onDone} className="btn">Back to feed</button>
    </div>
  )
}
