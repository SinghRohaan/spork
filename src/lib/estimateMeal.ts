import { supabase } from './supabase'
import { parseEstimateResponse } from './parseEstimate'
import { compressImage } from './compressImage'
import type { EstimateResult } from '../store/logDraft'

// Smaller copy for the model — Gemini doesn't benefit beyond ~1024px.
const AI_MAX_DIMENSION_PX = 1024
const LABEL_MAX_DIMENSION_PX = 1600

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * Calls the estimate-meal Edge Function. Returns null on ANY failure —
 * network error, non-2xx response, or a shape parseEstimateResponse
 * rejects — never throws. The Log flow's fallback rule (spec §6) treats
 * every failure mode identically: blank manual-entry fields, log never
 * blocked.
 */
export interface ConfirmedItem {
  name: string
  quantity?: string
}

export async function estimateMeal(
  photo: File,
  description: string,
  /** User-corrected items from the review screen ("Recalculate with AI"). */
  confirmedItems?: ConfirmedItem[],
  /** 'packaged' reads a wrapper / nutrition label instead of estimating a plate. */
  mode: 'meal' | 'packaged' = 'meal',
): Promise<EstimateResult | null> {
  try {
    // Nutrition labels are small print — give the model a sharper image for those.
    const resized = await compressImage(photo, mode === 'packaged' ? LABEL_MAX_DIMENSION_PX : AI_MAX_DIMENSION_PX)
    const photoBase64 = await blobToBase64(resized)

    const invokePromise = supabase.functions.invoke('estimate-meal', {
      body: { photoBase64, description, ...(confirmedItems?.length ? { confirmedItems } : {}), ...(mode === 'packaged' ? { mode } : {}) },
    })
    const timeoutPromise = new Promise<{ data: null; error: Error }>((resolve) =>
      setTimeout(() => resolve({ data: null, error: new Error('estimate-meal timed out') }), 30_000),
    )

    const { data, error } = await Promise.race([invokePromise, timeoutPromise])

    if (error) return null

    const parsed = parseEstimateResponse(data)
    if (!parsed) return null

    return { parsed, raw: data }
  } catch {
    return null
  }
}
