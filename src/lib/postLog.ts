import { supabase } from './supabase'
import { compressImage } from './compressImage'
import { uploadMealPhoto } from './mealPhotos'
import { computeNextStreak } from './streak'
import type { EstimateResult, MealType, Visibility, Satiety } from '../store/logDraft'
import type { MealItem } from './mealItems'

export interface PostLogInput {
  userId: string
  photoFile: File | null
  mealName: string
  description: string
  caption: string
  mealType: MealType
  visibility: Visibility
  satiety: Satiety | null
  estimate: EstimateResult | null
  finalCalories: number | null
  finalProteinG: number | null
  finalCarbsG: number | null
  finalFatG: number | null
  /** The items as posted (after edits), for the swipe breakdown. */
  items: MealItem[] | null
  currentStreakCount: number
  currentStreakLastLogDate: string | null
}

export async function postLog(input: PostLogInput): Promise<string> {
  const logId = crypto.randomUUID()

  const photoPath = input.photoFile ? await uploadMealPhoto(input.userId, logId, await compressImage(input.photoFile)) : null

  // Core log row — columns that exist in every migration version.
  // caption and satiety were added later (migrations 0006); if the column
  // doesn't exist yet the insert will fail on those fields alone, so we
  // try the full insert first and fall back to the minimal version.
  const coreFields = {
    id: logId,
    user_id: input.userId,
    photo_url: photoPath,
    name: input.mealName || null,
    description: input.description || null,
    meal_type: input.mealType,
    visibility: input.visibility,
    calories_estimate: input.estimate?.parsed.calories ?? null,
    calories_final: input.finalCalories,
    protein_estimate_g: input.estimate?.parsed.protein_g ?? null,
    protein_final_g: input.finalProteinG,
    carbs_estimate_g: input.estimate?.parsed.carbs_g ?? null,
    carbs_final_g: input.finalCarbsG,
    fat_estimate_g: input.estimate?.parsed.fat_g ?? null,
    fat_final_g: input.finalFatG,
    ai_confidence: input.estimate?.parsed.confidence ?? null,
    ai_raw_response: input.estimate?.raw ?? null,
  }

  // Try full insert (with caption + satiety + items)
  const extraFields = { caption: input.caption || null, satiety: input.satiety }
  let { error: insertError } = await supabase.from('logs').insert({ ...coreFields, ...extraFields, items: input.items })

  // Before migration 0018 there's no items column — post without them.
  if (insertError?.message?.includes('items')) {
    ({ error: insertError } = await supabase.from('logs').insert({ ...coreFields, ...extraFields }))
  }

  if (insertError) {
    // If the error is about a missing column (caption/satiety not migrated yet),
    // fall back to inserting without those fields so posting still works.
    const isColumnError =
      insertError.code === '42703' ||             // undefined_column (Postgres)
      insertError.message?.includes('caption') ||
      insertError.message?.includes('satiety')

    if (isColumnError) {
      const { error: fallbackError } = await supabase.from('logs').insert(coreFields)
      if (fallbackError) throw fallbackError
    } else {
      throw insertError
    }
  }

  const next = computeNextStreak(input.currentStreakCount, input.currentStreakLastLogDate, new Date())
  const { error: streakError } = await supabase
    .from('users')
    .update({ streak_count: next.streak_count, streak_last_log_date: next.streak_last_log_date })
    .eq('id', input.userId)

  if (streakError) throw streakError

  return logId
}
