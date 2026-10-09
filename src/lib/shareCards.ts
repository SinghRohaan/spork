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

/** Top row every card shares, Hevy-style: wordmark left, @username right. */
export function header(ctx: Ctx, username: string, color = INK) {
  brand(ctx, 20, 34, color)
  text(ctx, `@${username}`, CARD - 20, 34, 13, { color, align: 'right' })
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

/** Draws a card and encodes it as a PNG. */
export async function drawCard(draw: (ctx: Ctx) => Promise<void> | void): Promise<Blob> {
  await Promise.race([loadCardFonts(), new Promise((r) => setTimeout(r, 2500))])
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CARD * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = BG; ctx.fillRect(0, 0, CARD, CARD)
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

/** A · the photo, full-bleed and centre-cropped to a square: brand on top, stats along the bottom. */
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
    const bottom = ctx.createLinearGradient(0, CARD - 110, 0, CARD)
    bottom.addColorStop(0, 'rgba(0,0,0,0)'); bottom.addColorStop(1, 'rgba(0,0,0,0.66)')
    ctx.fillStyle = bottom; ctx.fillRect(0, CARD - 110, CARD, 110)
    header(ctx, d.username)
    statRow(ctx, d, CARD - 45)
  })
}

/** B · the meal name and what was in it: item name, its amount underneath, calories on the right. */
export function itemsCard(d: MealShareData): Promise<Blob> {
  return drawCard((ctx) => {
    header(ctx, d.username)
    text(ctx, d.mealName || cap(d.mealType), 20, 80, 23, { weight: 500, display: true, maxW: CARD - 40 })
    text(ctx, `${cap(d.mealType)} · ${n(d.calories).toLocaleString()} kcal · ${n(d.proteinG)} g protein`, 20, 100, 12, { weight: 400, color: QUIET, maxW: CARD - 40 })
    const ROW = 46
    const shown = d.items.length > 5 ? d.items.slice(0, 4) : d.items
    shown.forEach((item, i) => {
      const top = 116 + i * ROW
      const kcal = `${item.calories} kcal`
      ctx.font = font(14)
      const kcalW = ctx.measureText(kcal).width + 14
      text(ctx, item.name, 20, top + 19, 15, { maxW: CARD - 40 - kcalW })
      const amount = item.quantity ?? (item.grams ? `${item.grams} g` : '')
      if (amount) text(ctx, amount, 20, top + 36, 12, { weight: 400, color: QUIET, maxW: CARD - 40 - kcalW })
      text(ctx, kcal, CARD - 20, top + 27, 14, { align: 'right' })
      if (i < shown.length - 1) { ctx.fillStyle = 'rgba(244,244,243,0.08)'; ctx.fillRect(20, top + ROW - 1, CARD - 40, 1) }
    })
    if (d.items.length > shown.length) text(ctx, `+${d.items.length - shown.length} more`, 20, 116 + shown.length * ROW + 14, 12, { weight: 400, color: QUIET })
    if (!d.items.length) statRow(ctx, d, 150)
  })
}

/** C · calories in a ring split by where they came from (protein / carbs / fat). */
export function ringCard(d: MealShareData): Promise<Blob> {
  return drawCard((ctx) => {
    const p = n(d.proteinG) * 4, c = n(d.carbsG) * 4, f = n(d.fatG) * 9
    const total = p + c + f || 1
    header(ctx, d.username)
    const cx = CARD / 2, cy = 168
    ring(ctx, cx, cy, 74, 16, [{ frac: p / total, color: MACRO.protein }, { frac: c / total, color: MACRO.carbs }, { frac: f / total, color: MACRO.fat }])
    text(ctx, n(d.calories).toLocaleString(), cx, cy + 8, 34, { weight: 500, display: true, align: 'center' })
    text(ctx, 'kcal', cx, cy + 28, 12, { weight: 400, color: QUIET, align: 'center' })
    const legend: [string, string][] = [[`${n(d.proteinG)} g protein`, MACRO.protein], [`${n(d.carbsG)} g carbs`, MACRO.carbs], [`${n(d.fatG)} g fat`, MACRO.fat]]
    const colW = (CARD - 40) / 3
    legend.forEach(([label, color], i) => {
      const x = 20 + colW * i + colW / 2
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(x, 286, 4, 0, Math.PI * 2); ctx.fill()
      text(ctx, label, x, 308, 13, { align: 'center' })
    })
  })
}

export function mealCards(d: MealShareData) {
  return [
    { label: 'Photo', render: () => photoCard(d), skip: !d.photoUrl },
    { label: 'What’s in it', render: () => itemsCard(d), skip: !d.items.length },
    { label: 'Macros', render: () => ringCard(d) },
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
    header(ctx, d.username)
    text(ctx, dayLabel(d.date), cx, 66, 12, { weight: 400, color: QUIET, align: 'center' })
    text(ctx, d.label, cx, 94, 24, { weight: 500, display: true, align: 'center', maxW: CARD - 40 })
    ring(ctx, cx, 176, 58, 13, [{ frac: d.score / 100, color: TONE[d.tone] }])
    text(ctx, `${d.score}`, cx, 189, 38, { weight: 500, display: true, align: 'center' })
    const stats: [string, string][] = [
      [Math.round(d.calories).toLocaleString(), `of ${d.calorieGoal.toLocaleString()} kcal`],
      [`${Math.round(d.protein)} g`, d.protein >= d.proteinGoal * 0.9 ? 'protein ✓' : `of ${d.proteinGoal} g protein`],
      [`${d.meals.length}`, d.meals.length === 1 ? 'meal' : 'meals'],
    ]
    const colW = (CARD - 40) / 3
    stats.forEach(([value, label], i) => {
      const x = 20 + colW * i + colW / 2
      text(ctx, value, x, 290, 20, { align: 'center' })
      text(ctx, label, x, 309, 11, { weight: 400, color: QUIET, align: 'center' })
    })
  })
}

/** B · what was eaten that day, with calories. */
export function dayMealsCard(d: DayShareData): Promise<Blob> {
  return drawCard((ctx) => {
    header(ctx, d.username)
    text(ctx, 'What I ate', 22, 80, 24, { weight: 500, display: true })
    text(ctx, `${dayLabel(d.date)} · day score ${d.score}`, 22, 100, 12, { weight: 400, color: QUIET })
    const shown = d.meals.slice(0, 5)
    shown.forEach((m, i) => {
      const y = 132 + i * 30
      text(ctx, m.name, 22, y, 15, { weight: 400, maxW: CARD - 110 })
      text(ctx, `${Math.round(m.calories)} kcal`, CARD - 22, y, 13, { weight: 400, color: QUIET, align: 'right' })
    })
    const more = d.meals.length - shown.length
    let y = 132 + (shown.length - 1) * 30 + 16
    if (more > 0) { text(ctx, `+${more} more`, 22, y + 8, 12, { weight: 400, color: QUIET }); y += 22 }
    ctx.fillStyle = 'rgba(244,244,243,0.15)'
    ctx.fillRect(22, y, CARD - 44, 1)
    text(ctx, 'Total', 22, y + 26, 15)
    text(ctx, `${Math.round(d.calories).toLocaleString()} kcal`, CARD - 22, y + 26, 15, { color: TONE[d.tone], align: 'right' })
  })
}

export function dayCards(d: DayShareData) {
  return [
    { label: 'Day score', render: () => dayScoreCard(d) },
    { label: 'What I ate', render: () => dayMealsCard(d) },
  ]
}

// ── Badge card ────────────────────────────────────────────────────────────────

export interface BadgeShareData {
  username: string
  name: string
  emoji: string
  colors: [string, string]
  done: string
  earnedOn: string
}

/** A pointy-top hexagon centred on (cx, cy). */
function hexagon(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 2
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a)
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y)
  }
  ctx.closePath()
}

/** The medal, its name and when it was earned. */
export function badgeCard(d: BadgeShareData): Promise<Blob> {
  return drawCard((ctx) => {
    const cx = CARD / 2, cy = 140
    const glow = ctx.createRadialGradient(cx, cy, 10, cx, cy, 170)
    glow.addColorStop(0, `${d.colors[1]}55`); glow.addColorStop(1, 'rgba(27,27,27,0)')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, CARD, CARD)
    const rim = ctx.createLinearGradient(cx - 60, cy - 70, cx + 60, cy + 70)
    rim.addColorStop(0, d.colors[0]); rim.addColorStop(1, d.colors[1])
    hexagon(ctx, cx, cy, 72); ctx.fillStyle = rim; ctx.fill()
    hexagon(ctx, cx, cy, 61); ctx.fillStyle = '#1f1f1f'; ctx.fill()
    ctx.font = '52px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(d.emoji, cx, cy + 3)
    text(ctx, 'BADGE UNLOCKED', cx, 248, 11, { color: d.colors[0], align: 'center' })
    text(ctx, d.name, cx, 278, 28, { weight: 500, display: true, align: 'center', maxW: CARD - 40 })
    text(ctx, `${d.done} · ${new Date(`${d.earnedOn}T12:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, cx, 302, 12, { weight: 400, color: QUIET, align: 'center', maxW: CARD - 40 })
    header(ctx, d.username)
  })
}
