/**
 * Square share cards (1080×1080), drawn straight onto a canvas so they look
 * the same on iOS Safari as on desktop. Laid out on a 360-unit grid and
 * drawn at 3×.
 */
import type { MealItem } from './mealItems'

export const CARD = 360
const SCALE = 3

const DISPLAY = 'SporkDisplay'
const SANS = 'SporkSans'
const BG = '#1b1b1b'
const INK = '#f4f4f3'
const QUIET = 'rgba(244,244,243,0.62)'
export const MACRO = { protein: '#ff77b8', carbs: '#ffb057', fat: '#6aa8ff' }
export const TEAL = '#42e8d4'

let fontsReady: Promise<void> | null = null

/**
 * Loads the brand fonts under private names straight from the font files.
 * The page's CSS fonts only load once something on screen uses them, so a
 * canvas drawn before that silently fell back to a system font.
 */
export function loadCardFonts(): Promise<void> {
  fontsReady ??= Promise.all([
    new FontFace(DISPLAY, 'url(/fonts/fredoka-medium.ttf)', { weight: '500' }),
    new FontFace(SANS, 'url(/fonts/dm-regular.ttf)', { weight: '400' }),
    new FontFace(SANS, 'url(/fonts/dm-semibold.ttf)', { weight: '600' }),
  ].map(async (face) => { document.fonts.add(await face.load()) }))
    .then(() => undefined)
    .catch(() => { fontsReady = null }) // try again next time; this card uses fallbacks
  return fontsReady
}

/** CORS download into a blob first, so the canvas isn't tainted by a cached non-CORS copy. */
export async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(src, { mode: 'cors', cache: 'no-store' })
    if (!res.ok) return null
    const objectUrl = URL.createObjectURL(await res.blob())
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(img) }
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null) }
      img.src = objectUrl
    })
  } catch {
    return null
  }
}

export type Ctx = CanvasRenderingContext2D

export const font = (size: number, weight: 400 | 500 | 600 = 600, display = false) =>
  `${weight} ${size}px ${display ? `${DISPLAY}, "Fredoka"` : `${SANS}, "DM Sans"`}, system-ui, sans-serif`

export function text(ctx: Ctx, s: string, x: number, y: number, size: number, opts: { weight?: 400 | 500 | 600; display?: boolean; color?: string; align?: CanvasTextAlign; maxW?: number } = {}) {
  ctx.font = font(size, opts.weight ?? 600, opts.display)
  ctx.fillStyle = opts.color ?? INK
  ctx.textAlign = opts.align ?? 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(opts.maxW ? ellipsize(ctx, s, opts.maxW) : s, x, y)
}

export function ellipsize(ctx: Ctx, s: string, maxW: number): string {
  if (ctx.measureText(s).width <= maxW) return s
  let t = s
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

/** The Spork wordmark: orb + "spork", left-aligned at (x, baseline y). */
export function brand(ctx: Ctx, x: number, y: number, color = INK) {
  const r = 7.5
  const cx = x + r, cy = y - 5.5
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = 2.6
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.lineWidth = 1.9
  for (const dx of [-2.6, 0, 2.6]) { ctx.beginPath(); ctx.moveTo(cx + dx, cy - 2.4); ctx.lineTo(cx + dx, cy + 2.4); ctx.stroke() }
  text(ctx, 'spork', x + 2 * r + 5, y, 16, { weight: 500, display: true, color })
}

/** Bottom row every card shares: wordmark left, @username right. */
export function footer(ctx: Ctx, username: string, color = INK) {
  brand(ctx, 20, CARD - 18, color)
  text(ctx, `@${username}`, CARD - 20, CARD - 18, 13, { color, align: 'right' })
}

/** A ring of coloured arcs (fractions of the circle), starting at 12 o'clock. */
export function ring(ctx: Ctx, cx: number, cy: number, r: number, width: number, arcs: { frac: number; color: string }[], track = '#313131') {
  ctx.lineWidth = width
  ctx.strokeStyle = track
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
  let start = -Math.PI / 2
  ctx.lineCap = arcs.length === 1 ? 'round' : 'butt'
  for (const a of arcs) {
    if (a.frac <= 0) continue
    const end = start + Math.min(1, a.frac) * Math.PI * 2
    ctx.strokeStyle = a.color
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.stroke()
    start = end
  }
}

/** Draws a card and encodes it as a PNG. `transparent` skips the dark background (stickers). */
export async function drawCard(draw: (ctx: Ctx) => Promise<void> | void, transparent = false): Promise<Blob> {
  await Promise.race([loadCardFonts(), new Promise((r) => setTimeout(r, 2500))])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CARD * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.scale(SCALE, SCALE)
  if (!transparent) { ctx.fillStyle = BG; ctx.fillRect(0, 0, CARD, CARD) }
  await draw(ctx)
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png')
    } catch (e) {
      // A tainted canvas (photo served without CORS) throws here
      reject(e instanceof Error ? e : new Error('Could not encode image'))
    }
  })
}

// ── Meal cards ────────────────────────────────────────────────────────────────

export interface MealShareData {
  photoUrl: string | null
  username: string
  mealName: string | null
  mealType: string
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  items: MealItem[]
}

const n = (v: number | null) => Math.round(v ?? 0)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Calories · protein · carbs · fat, as evenly spaced label/value columns. */
function statRow(ctx: Ctx, d: MealShareData, y: number, color = INK) {
  const stats: [string, string][] = [
    ['Calories', `${n(d.calories).toLocaleString()}`],
    ['Protein', `${n(d.proteinG)} g`],
    ['Carbs', `${n(d.carbsG)} g`],
    ['Fat', `${n(d.fatG)} g`],
  ]
  const colW = (CARD - 40) / stats.length
  stats.forEach(([label, value], i) => {
    const x = 20 + colW * i + colW / 2
    text(ctx, label, x, y, 11, { weight: 400, color, align: 'center' })
    text(ctx, value, x, y + 21, 17, { color, align: 'center' })
  })
}

/** A · the photo, full-bleed and centre-cropped to a square, with stats on top. */
export async function photoCard(d: MealShareData): Promise<Blob> {
  const img = d.photoUrl ? await loadImage(d.photoUrl) : null
  return drawCard((ctx) => {
    if (img) {
      const s = Math.max(CARD / img.naturalWidth, CARD / img.naturalHeight)
      const w = img.naturalWidth * s, h = img.naturalHeight * s
      ctx.drawImage(img, (CARD - w) / 2, (CARD - h) / 2, w, h)
    } else {
      ctx.fillStyle = '#313131'; ctx.fillRect(0, 0, CARD, CARD)
    }
    // Shade top and bottom so white text reads on any photo.
    const top = ctx.createLinearGradient(0, 0, 0, 110)
    top.addColorStop(0, 'rgba(0,0,0,0.62)'); top.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = top; ctx.fillRect(0, 0, CARD, 110)
    const bottom = ctx.createLinearGradient(0, CARD - 80, 0, CARD)
    bottom.addColorStop(0, 'rgba(0,0,0,0)'); bottom.addColorStop(1, 'rgba(0,0,0,0.62)')
    ctx.fillStyle = bottom; ctx.fillRect(0, CARD - 80, CARD, 80)
    statRow(ctx, d, 30)
    footer(ctx, d.username)
  })
}

/** B · the meal name and what was in it, Hevy-style. */
export function itemsCard(d: MealShareData): Promise<Blob> {
  return drawCard((ctx) => {
    text(ctx, d.mealName || cap(d.mealType), 22, 46, 24, { weight: 500, display: true, maxW: CARD - 44 })
    text(ctx, `${cap(d.mealType)} · ${n(d.calories).toLocaleString()} kcal · ${n(d.proteinG)} g protein`, 22, 68, 12, { weight: 400, color: QUIET, maxW: CARD - 44 })
    const shown = d.items.slice(0, 6)
    shown.forEach((item, i) => {
      const y = 108 + i * 34
      const amount = item.quantity ?? (item.grams ? `${item.grams} g` : '')
      ctx.font = font(15)
      const amountW = amount ? Math.min(ctx.measureText(amount).width, 130) + 8 : 0
      if (amount) text(ctx, amount, 22, y, 15, { color: TEAL, maxW: 130 })
      text(ctx, item.name, 22 + amountW, y, 15, { weight: 400, maxW: CARD - 90 - amountW })
      text(ctx, `${item.calories} kcal`, CARD - 22, y, 13, { weight: 400, color: QUIET, align: 'right' })
    })
    if (d.items.length > shown.length) text(ctx, `…and ${d.items.length - shown.length} more`, 22, 108 + shown.length * 34, 12, { weight: 400, color: QUIET })
    if (!d.items.length) statRow(ctx, d, 130)
    footer(ctx, d.username)
  })
}

/** C · calories in a ring split by where they came from (protein / carbs / fat). */
export function ringCard(d: MealShareData): Promise<Blob> {
  return drawCard((ctx) => {
    const p = n(d.proteinG) * 4, c = n(d.carbsG) * 4, f = n(d.fatG) * 9
    const total = p + c + f || 1
    const cx = CARD / 2, cy = 150
    ring(ctx, cx, cy, 74, 16, [{ frac: p / total, color: MACRO.protein }, { frac: c / total, color: MACRO.carbs }, { frac: f / total, color: MACRO.fat }])
    text(ctx, n(d.calories).toLocaleString(), cx, cy + 8, 34, { weight: 500, display: true, align: 'center' })
    text(ctx, 'kcal', cx, cy + 28, 12, { weight: 400, color: QUIET, align: 'center' })
    const legend: [string, string][] = [[`${n(d.proteinG)} g protein`, MACRO.protein], [`${n(d.carbsG)} g carbs`, MACRO.carbs], [`${n(d.fatG)} g fat`, MACRO.fat]]
    const colW = (CARD - 40) / 3
    legend.forEach(([label, color], i) => {
      const x = 20 + colW * i + colW / 2
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(x, 262, 4, 0, Math.PI * 2); ctx.fill()
      text(ctx, label, x, 284, 13, { align: 'center' })
    })
    footer(ctx, d.username)
  })
}

/** D · see-through sticker for Instagram stories: just the numbers and the wordmark. */
export function stickerCard(d: MealShareData): Promise<Blob> {
  return drawCard((ctx) => {
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 6
    const rows: [string, string][] = [[`${n(d.calories).toLocaleString()} kcal`, 'Calories'], [`${n(d.proteinG)} g`, 'Protein'], [`${n(d.carbsG)} g · ${n(d.fatG)} g`, 'Carbs · Fat']]
    rows.forEach(([value, label], i) => {
      const y = 92 + i * 64
      text(ctx, value, CARD / 2, y, 28, { align: 'center' })
      text(ctx, label, CARD / 2, y + 20, 13, { weight: 400, align: 'center' })
    })
    ctx.font = font(16, 500, true)
    const w = ctx.measureText('spork').width + 20
    brand(ctx, CARD / 2 - w / 2, 300)
    text(ctx, `@${d.username}`, CARD / 2, 322, 12, { weight: 400, align: 'center' })
  }, true)
}

export function mealCards(d: MealShareData) {
  return [
    { label: 'Photo', render: () => photoCard(d), skip: !d.photoUrl },
    { label: 'What’s in it', render: () => itemsCard(d), skip: !d.items.length },
    { label: 'Macros', render: () => ringCard(d) },
    { label: 'Sticker', render: () => stickerCard(d), transparent: true },
  ].filter((c) => !c.skip)
}

// ── Day review cards ──────────────────────────────────────────────────────────

export interface DayShareData {
  username: string
  date: Date
  score: number
  tone: 'good' | 'mid' | 'low'
  label: string
  calories: number
  calorieGoal: number
  protein: number
  proteinGoal: number
  meals: { name: string; calories: number }[]
}

const TONE = { good: TEAL, mid: MACRO.carbs, low: '#ff6b5e' }
const dayLabel = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** A · the day's score ring with calories, protein and meals. */
export function dayScoreCard(d: DayShareData): Promise<Blob> {
  return drawCard((ctx) => {
    const cx = CARD / 2
    text(ctx, dayLabel(d.date), cx, 40, 12, { weight: 400, color: QUIET, align: 'center' })
    text(ctx, d.label, cx, 70, 24, { weight: 500, display: true, align: 'center', maxW: CARD - 40 })
    ring(ctx, cx, 158, 58, 13, [{ frac: d.score / 100, color: TONE[d.tone] }])
    text(ctx, `${d.score}`, cx, 171, 38, { weight: 500, display: true, align: 'center' })
    const stats: [string, string][] = [
      [Math.round(d.calories).toLocaleString(), `of ${d.calorieGoal.toLocaleString()} kcal`],
      [`${Math.round(d.protein)} g`, d.protein >= d.proteinGoal * 0.9 ? 'protein ✓' : `of ${d.proteinGoal} g protein`],
      [`${d.meals.length}`, d.meals.length === 1 ? 'meal' : 'meals'],
    ]
    const colW = (CARD - 40) / 3
    stats.forEach(([value, label], i) => {
      const x = 20 + colW * i + colW / 2
      text(ctx, value, x, 266, 20, { align: 'center' })
      text(ctx, label, x, 285, 11, { weight: 400, color: QUIET, align: 'center' })
    })
    footer(ctx, d.username)
  })
}

/** B · what was eaten that day, with calories. */
export function dayMealsCard(d: DayShareData): Promise<Blob> {
  return drawCard((ctx) => {
    text(ctx, 'What I ate', 22, 46, 24, { weight: 500, display: true })
    text(ctx, `${dayLabel(d.date)} · day score ${d.score}`, 22, 68, 12, { weight: 400, color: QUIET })
    const shown = d.meals.slice(0, 6)
    shown.forEach((m, i) => {
      const y = 108 + i * 34
      text(ctx, m.name, 22, y, 15, { weight: 400, maxW: CARD - 110 })
      text(ctx, `${Math.round(m.calories)} kcal`, CARD - 22, y, 13, { weight: 400, color: QUIET, align: 'right' })
    })
    const y = 108 + shown.length * 34 + 4
    if (d.meals.length > shown.length) text(ctx, `…and ${d.meals.length - shown.length} more`, 22, y - 10, 12, { weight: 400, color: QUIET })
    ctx.fillStyle = 'rgba(244,244,243,0.15)'
    ctx.fillRect(22, y, CARD - 44, 1)
    text(ctx, 'Total', 22, y + 26, 15)
    text(ctx, `${Math.round(d.calories).toLocaleString()} kcal`, CARD - 22, y + 26, 15, { color: TONE[d.tone], align: 'right' })
    footer(ctx, d.username)
  })
}

/** C · see-through sticker: score ring and label only. */
export function dayStickerCard(d: DayShareData): Promise<Blob> {
  return drawCard((ctx) => {
    const cx = CARD / 2
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 6
    ring(ctx, cx, 140, 64, 14, [{ frac: d.score / 100, color: TONE[d.tone] }], 'rgba(255,255,255,0.25)')
    text(ctx, `${d.score}`, cx, 154, 42, { weight: 500, display: true, align: 'center' })
    text(ctx, d.label, cx, 250, 24, { weight: 500, display: true, align: 'center' })
    ctx.font = font(16, 500, true)
    const w = ctx.measureText('spork').width + 20
    brand(ctx, cx - w / 2, 296)
    text(ctx, `@${d.username}`, cx, 318, 12, { weight: 400, align: 'center' })
  }, true)
}

export function dayCards(d: DayShareData) {
  return [
    { label: 'Day score', render: () => dayScoreCard(d) },
    { label: 'What I ate', render: () => dayMealsCard(d) },
    { label: 'Sticker', render: () => dayStickerCard(d), transparent: true },
  ]
}
