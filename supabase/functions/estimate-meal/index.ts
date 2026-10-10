// Deno runtime — deployed via `supabase functions deploy estimate-meal`
// (Task 4). Supabase's default verify_jwt only checks that the request
// carries ANY validly-signed JWT — the public anon key satisfies that,
// so it does NOT by itself restrict this to real signed-in users. The
// explicit claims check below (role === 'authenticated' AND a subject)
// is what actually protects the free-tier Gemini quota (spec §6 AI
// provider notes) from being hit by anyone who reads the client bundle.

// Read through globalThis so the pure checks below can also be imported by unit tests (Node).
// deno-lint-ignore no-explicit-any
const env = (key: string): string | undefined => (globalThis as any).Deno?.env.get(key)
const GEMINI_API_KEY = env('GEMINI_API_KEY')
// Model is overridable via the GEMINI_MODEL secret (e.g. 'gemini-flash-latest'
// for better vision accuracy) without a code change. Default unchanged.
const GEMINI_MODEL = env('GEMINI_MODEL') || 'gemini-flash-lite-latest'
// Backup models, tried in order when the main one is overloaded (503) or
// rate-limited (429). Each model has its own capacity, so a demand spike on
// one rarely hits the others. Overridable via the GEMINI_FALLBACK_MODELS
// secret (comma-separated).
const GEMINI_FALLBACK_MODELS = (env('GEMINI_FALLBACK_MODELS') || 'gemini-flash-latest,gemini-2.5-flash-lite')
  .split(',').map((m) => m.trim()).filter(Boolean)
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])]
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

const SUPABASE_URL = env('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY') ?? ''
/** AI estimates per person per day (migration 0019's consume_ai_quota). */
const DAILY_ESTIMATE_LIMIT = 60
/** ~6 MB of photo; the app sends ~150–300 KB. */
const MAX_PHOTO_BASE64_LENGTH = 8_000_000

/**
 * Asks the database, with the caller's own login token, to count this
 * estimate. That both proves the token is genuine (the database checks its
 * signature) and enforces the daily limit. 'allowed' if the quota function
 * isn't deployed yet, so estimates keep working before the migration runs.
 */
async function checkQuota(jwt: string): Promise<'allowed' | 'limit' | 'unauthorized'> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/consume_ai_quota`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: DAILY_ESTIMATE_LIMIT }),
    })
    if (res.status === 401 || res.status === 403) return 'unauthorized'
    if (!res.ok) return 'allowed' // function not deployed yet, or a database hiccup — don't block logging
    return (await res.json()) === false ? 'limit' : 'allowed'
  } catch {
    return 'allowed'
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Guardrail shared by both prompts: non-edible products (balms, ointments,
// hair oil, soap…) are flagged so the app can refuse to log them.
const FOOD_CHECK = `FIRST — IS THIS SOMETHING PEOPLE EAT OR DRINK?
- Food, drinks and dietary supplements (protein powder, vitamins, ORS) count as food — so do cooking oils, ghee, spices and sauces.
- Set "is_food" to false ONLY when the photo (or, with no photo, the description) is clearly about something not meant to be eaten: cosmetics or skincare (cream, lotion, lip balm, balm), medicines or ointments, hair oil, massage or essential oil, soap, detergent or cleaning products, pet food, or no food at all (a person, a room, a screenshot).
- When "is_food" is false: return "items": [], every number 0, "confidence": "low", and "not_food_reason" saying what it is in under 60 characters (e.g. "Looks like a lip balm").
- When in doubt, treat it as food and set "is_food" to true.

`

// Per-item detail for the meal score (fibre, sugar, fat quality, alcohol,
// food group). Shared by all three prompts.
const NUTRITION_DETAIL = `NUTRITION DETAIL — for EVERY item also give:
- "fiber_g": dietary fibre in grams for the amount eaten.
- "added_sugar_g": FREE/ADDED sugar only — table sugar, jaggery, honey, syrups, sweets, sugary drinks, fruit juice. Natural sugar in whole fruit, vegetables or plain milk/curd is 0.
- "sat_fat_g": saturated fat in grams (ghee, butter, cream, cheese, coconut oil, fatty meat, palm oil in fried snacks and biscuits).
- "alcohol_g": grams of pure alcohol = ml × ABV × 0.789 (e.g. 30 ml peg of 40% spirit ≈ 9.5 g; 330 ml beer at 5% ≈ 13 g; 375 ml of vodka ≈ 118 g). 0 for anything non-alcoholic.
- "group": the item's main food group — one of "vegetable", "fruit", "pulse" (dal, chana, rajma, sprouts, soy), "whole_grain" (roti, brown rice, oats, millets), "refined_grain" (white rice, maida, white bread, pasta), "dairy", "egg", "meat", "fish", "nuts_seeds", "fat_oil", "sweet" (mithai, desserts, chocolate, biscuits), "fried_snack" (samosa, pakora, chips, fries), "sugary_drink", "alcohol", "protein_supplement", "other". For a mixed dish use the ingredient giving most of its calories (chicken biryani → "refined_grain"; palak paneer → "dairy"; aloo gobi → "vegetable").
- "fried": true if deep-fried or cooked in a lot of oil (puri, bhatura, pakora, fried chicken, fries), else false.
Alcohol is 7 kcal per gram and is NOT protein, carbs or fat: calories ≈ 4×protein + 4×carbs + 9×fat + 7×alcohol.

`

// Anchors for the numbers. Photo estimators are ~35% off on calories and
// worse on protein, mostly from misjudged portions and misidentified dishes;
// reference values + a measured-portion method + a self-check cut that down.
const REFERENCE_VALUES = `REFERENCE VALUES — typical Indian home food, per 100 g as served (kcal · protein · carbs · fat · fibre g). Scale to the grams you estimated; adjust for visible oil, ghee, cream or sugar.
- Cooked white rice 130 · 2.7 · 28 · 0.3 · 0.4 | brown rice 112 · 2.3 · 24 · 0.8 · 1.8 | chicken biryani 190 · 9 · 23 · 7 · 1 | poha 160 · 3 · 26 · 5 · 1.5 | upma 170 · 4 · 25 · 6 · 2
- Phulka/roti, no ghee (1 medium ≈ 40 g) 260 · 8.5 · 50 · 2.5 · 6 | plain paratha (1 ≈ 80 g) 320 · 7 · 45 · 13 · 4 | naan (1 ≈ 90 g) 300 · 9 · 50 · 6 · 2 | white bread (1 slice ≈ 28 g) 265 · 9 · 49 · 3 · 2.7
- Idli (1 ≈ 40 g) 145 · 4.5 · 30 · 0.5 · 1.5 | plain dosa (1 ≈ 80 g) 210 · 4.5 · 32 · 7 · 1.5 | sambar 65 · 3 · 9 · 2 · 2.5
- Dal with tadka 110 · 6 · 15 · 3 · 3 | rajma/chole curry 140 · 6.5 · 18 · 5 · 6 | dry mixed-veg sabzi 90 · 2.5 · 9 · 5 · 3.5 | aloo sabzi 120 · 2 · 15 · 6 · 2 | palak paneer 150 · 7 · 6 · 11 · 2.5 | green salad 20 · 1 · 4 · 0.2 · 1.8
- Paneer 290 · 18 · 3 · 23 · 0 | curd/dahi (whole milk) 60 · 3.5 · 4.7 · 3.3 · 0 | toned milk 58 · 3.2 · 4.7 · 3 · 0 | egg (1 large ≈ 50 g) 155 · 12.6 · 1.1 · 10.6 · 0
- Grilled/tandoori chicken breast 165 · 31 · 0 · 3.6 · 0 | tandoori chicken leg with skin 200 · 25 · 3 · 10 · 0 | chicken curry with gravy 160 · 14 · 5 · 9 · 1 | mutton curry 200 · 15 · 4 · 14 · 1 | fish curry 130 · 14 · 4 · 7 · 0.5
- Samosa (1 medium ≈ 70 g) 310 · 5 · 33 · 17 · 3 | pakora 300 · 7 · 28 · 18 · 4 | gulab jamun (1 ≈ 40 g) 330 · 4 · 50 · 13 · 0.5, of which added sugar 35 | pizza (1 slice ≈ 100 g) 270 · 11 · 33 · 10 · 2
- Banana 89 · 1.1 · 23 · 0.3 · 2.6 | apple 52 · 0.3 · 14 · 0.2 · 2.4 | mango 60 · 0.8 · 15 · 0.4 · 1.6 | almonds 580 · 21 · 22 · 50 · 12.5 | roasted peanuts 585 · 24 · 21 · 50 · 8
- Ghee 900 kcal (100 g fat, 62 g saturated); cooking oil 884 (100 g fat, ~15 g saturated); butter 717 (81 g fat, 51 g saturated); mayonnaise 680 (75 g fat) — 1 tsp ≈ 5 g, 1 tbsp ≈ 15 g
- Whey protein powder (1 scoop ≈ 30 g) 400 · 78 · 8 · 6 · 0 | oats cooked in water 70 · 2.5 · 12 · 1.4 · 1.7
- Per 100 ml: masala chai with 2 tsp sugar 55 · 1.7 · 8 · 1.8 (added sugar 5.5) | cola 42 (added sugar 10.6) | beer 5% 43 (alcohol 3.9 g) | wine 12% 83 (alcohol 9.5 g) | spirits 40% 231 (alcohol 31.6 g; a 30 ml peg ≈ 69 kcal)
- Measures: katori ≈ 150 ml (small 100 ml), steel glass ≈ 250 ml, cup ≈ 150 ml, tablespoon 15 ml, teaspoon 5 ml, dinner plate 25–28 cm, quarter plate ≈ 18 cm.

`

const SELF_CHECK = `SELF-CHECK — before answering, verify EVERY item and fix whatever fails:
1. calories ≈ 4×protein + 4×carbs + 9×fat + 7×alcohol (within 15%).
2. Calories per gram fits the food: salad/sabzi 0.2–1.6, cooked rice/dal/curries 0.6–2.5, roti/paratha/naan 2.4–3.6, fried snacks 2.5–5.5, sweets 1.5–5.5, nuts 5–7, oil/ghee 7–9, drinks 0.3–1.2 (spirits ≈ 2.3).
3. protein + carbs + fat + alcohol ≤ grams; fiber_g ≤ carbs; added_sugar_g ≤ carbs; sat_fat_g ≤ fat.
4. Compare each item with the reference values: if you differ by more than ~30% per 100 g, the dish or the portion is wrong — look again.
5. Top-level totals are exactly the sum of the items.

`

const PROMPT = `You are a registered-dietitian-level nutrition estimator specialising in Indian and South Asian home food, with broad knowledge of global cuisine. You are looking at a photo of one meal.

Work in two passes.

PASS 1 — IDENTIFY
- List every distinct food item you can see: each bowl, katori, pile or piece is a separate item.
- Name items specifically ("Yellow moong dal", "Egg bhurji", "Jeera rice") but only as specific as the photo supports.
- When two dishes look alike and you cannot tell them apart (e.g. soy chunk curry vs prawn curry vs paneer curry, chicken vs mutton, dal vs sambar), do NOT pick one confidently: name it generically ("Curry with chunks (soy/prawn?)") and set that item's confidence to "low".
- COUNT discrete items: boiled egg halves → whole eggs (4 halves = 2 eggs), rotis, idlis, pieces of chicken.

PASS 2 — MEASURE, then compute nutrition
- Measure before you weigh: judge each item's footprint (cm) and depth against the plate, katori, spoon or hand, turn that into volume (ml), then grams (cooked rice, dal, curry ≈ 1 g/ml; dry sabzi ≈ 0.6–0.8 g/ml; leafy salad ≈ 0.3–0.5 g/ml).
- Photo estimates are known to UNDER-estimate big portions. When a plate, bowl or katori is full or heaped, do NOT shrink it — count the full visible amount.
- Count hidden calories: the shine of oil or ghee, gravy pooled under food, butter on roti, food stacked under other food, dips and sauces.
- Visual references:
  • Indian steel katori/bowl ≈ 150–180 ml when full; small katori ≈ 100 ml
  • Dinner plate ≈ 25–28 cm across; quarter-plate ≈ 18 cm
  • Tablespoon ≈ 15 ml; a cupped handful of rice ≈ 80–100 g cooked
  • If the container is part-full, scale down accordingly.
- "grams" is the COOKED / as-served weight in grams (use ml ≈ g for liquids and gravies).
- "quantity" is a short human description a user can verify at a glance, always including a household measure: "1 cup cooked", "2 eggs (4 halves)", "1 katori (~150 ml)", "2 medium rotis".
- Use home-cooked values with typical oil/ghee (~1 tsp oil per curry/sabzi serving, ~½ tsp ghee per roti if it looks glossy). Restaurant food runs 2–3× the fat — only assume that if the photo clearly looks like restaurant/takeaway food.
- Macros must be consistent: calories ≈ 4×protein + 4×carbs + 9×fat + 7×alcohol (within ~10%).

USER TEXT ALWAYS WINS
- If the user's description gives items or quantities ("2 rotis", "200 g chicken", "it's prawn curry"), use them exactly and only estimate what they left out.

CONFIDENCE
- Per item: "high" only if the dish AND its amount are clearly visible; "low" for ambiguous dishes, hidden/stacked food, or blurry photos.
- Overall: the lowest-common-sense summary across items.

ASSUMPTIONS
- Add 1–3 short notes about the biggest assumptions you made that the user may want to correct (e.g. "Assumed curry is soy chunks — tap to change if it's prawn", "Assumed 1 tsp oil in the sabzi"). Keep each under 90 characters.

${REFERENCE_VALUES}${SELF_CHECK}${NUTRITION_DETAIL}Return ONLY JSON of this shape:
{
  "is_food": boolean, "not_food_reason": string,
  "items": [{ "name": string, "quantity": string, "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "added_sugar_g": number, "sat_fat_g": number, "alcohol_g": number, "group": string, "fried": boolean, "confidence": "low"|"medium"|"high" }],
  "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number,
  "confidence": "low"|"medium"|"high",
  "assumptions": [string]
}
Top-level calories/protein_g/carbs_g/fat_g are the SUM of the items.`


// Packaged food: a photo of the wrapper / nutrition label (no barcode, or
// the barcode isn't in Open Food Facts). Printed numbers win over estimates.
const PACKAGED_PROMPT = `You are reading a photo of PACKAGED FOOD (a wrapper, box, bottle or its nutrition label). Your job is exact numbers, not estimates, wherever the pack allows.

STEP 1 — NUTRITION TABLE VISIBLE? If a nutrition information / nutrition facts table is visible:
- Transcribe it EXACTLY. Never estimate a value that is printed.
- Indian labels usually print "per 100 g" and often "per serve". Use the PER-SERVE column when present, with its printed serve size; otherwise use per 100 g scaled to one serving (see STEP 3).
- Energy may be in kcal or kJ (kcal = kJ / 4.184). "Total carbohydrate" is carbs; "Total fat" is fat.
- Also transcribe dietary fibre, "added sugars" (if only total sugars is printed, use it for sweets, biscuits and drinks; for plain dairy use 0) and saturated fat when printed.

STEP 2 — NO TABLE, BUT THE PRODUCT IS RECOGNISABLE (brand + product name visible, e.g. "Yoga Bar Chocolate Brownie Protein Bar", "Amul Masti Dahi 200 g"):
- Use that product's published nutrition values. Set confidence "medium".

STEP 3 — HOW MUCH WAS EATEN:
- Single-serve packs (bars, chips/biscuit packets up to ~150 g, single bottles/cups): assume the whole pack.
- Bigger packs: one printed serving; if none is printed, a typical serving for that product type.
- If the user's text gives an amount ("had half", "2 bars", "30 g"), use it exactly.

STEP 4 — NOTHING READABLE: identify the product type from the pack and estimate; confidence "low".

Return ONE item: name = brand + product ("Yoga Bar Protein Bar – Chocolate Brownie"), quantity = what was eaten in household terms ("1 bar (60 g)", "1 serving (30 g)", "½ pack (50 g)"), grams = weight eaten, and its calories/protein_g/carbs_g/fat_g. Confidence "high" only when numbers were read off a visible table.
In "assumptions", say where the numbers came from in under 90 characters, e.g. "Read from the label · per serve (60 g)" or "No table visible — used Yoga Bar's published values".

${SELF_CHECK}${NUTRITION_DETAIL}Return ONLY JSON of this shape:
{
  "is_food": boolean, "not_food_reason": string,
  "items": [{ "name": string, "quantity": string, "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "added_sugar_g": number, "sat_fat_g": number, "alcohol_g": number, "group": string, "fried": boolean, "confidence": "low"|"medium"|"high" }],
  "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number,
  "confidence": "low"|"medium"|"high",
  "assumptions": [string]
}
Top-level calories/protein_g/carbs_g/fat_g equal the single item's values.`

// Log by typing: no photo, just the user's description ("2 rotis, dal, curd").
const TEXT_PROMPT = `You are a registered-dietitian-level nutrition estimator specialising in Indian and South Asian home food, with broad knowledge of global cuisine. There is NO photo — estimate the meal only from the user's description below.

- Split the description into distinct items ("2 rotis, dal, 1 katori curd" → 3 items). Keep the user's own dish names, just tidied up.
- Quantities the user states are FACT — use them exactly. For anything unstated, assume one typical Indian home serving (roti ≈ 40 g, 1 katori dal/sabzi ≈ 150 ml, 1 cup cooked rice ≈ 150 g, 1 egg ≈ 50 g) and say so in "assumptions".
- "grams" is the as-served weight; "quantity" is a short household measure ("2 medium rotis", "1 katori (~150 ml)").
- Home-cooked values with typical oil/ghee unless the user says restaurant, fried, takeaway, etc.
- Macros must be consistent: calories ≈ 4×protein + 4×carbs + 9×fat + 7×alcohol (within ~10%).
- Per-item confidence: "high" when the user gave the quantity, "medium" when you assumed a typical serving, "low" when the dish itself is vague ("snacks", "some sweets").
- In "assumptions", list the 1–3 biggest guesses (under 90 characters each).

${REFERENCE_VALUES}${SELF_CHECK}${NUTRITION_DETAIL}Return ONLY JSON of this shape:
{
  "is_food": boolean, "not_food_reason": string,
  "items": [{ "name": string, "quantity": string, "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number, "added_sugar_g": number, "sat_fat_g": number, "alcohol_g": number, "group": string, "fried": boolean, "confidence": "low"|"medium"|"high" }],
  "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number,
  "confidence": "low"|"medium"|"high",
  "assumptions": [string]
}
Top-level calories/protein_g/carbs_g/fat_g are the SUM of the items.`

// Gemini structured output — keeps the model on-shape so parse failures
// (and silent "manual entry" fallbacks) become rare.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_food: { type: 'BOOLEAN' },
    not_food_reason: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          calories: { type: 'NUMBER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
          fiber_g: { type: 'NUMBER' },
          added_sugar_g: { type: 'NUMBER' },
          sat_fat_g: { type: 'NUMBER' },
          alcohol_g: { type: 'NUMBER' },
          group: { type: 'STRING', enum: ['vegetable', 'fruit', 'pulse', 'whole_grain', 'refined_grain', 'dairy', 'egg', 'meat', 'fish', 'nuts_seeds', 'fat_oil', 'sweet', 'fried_snack', 'sugary_drink', 'alcohol', 'protein_supplement', 'other'] },
          fried: { type: 'BOOLEAN' },
          confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
        },
        required: ['name', 'quantity', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'added_sugar_g', 'sat_fat_g', 'alcohol_g', 'group', 'fried', 'confidence'],
      },
    },
    calories: { type: 'NUMBER' },
    protein_g: { type: 'NUMBER' },
    carbs_g: { type: 'NUMBER' },
    fat_g: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['is_food', 'items', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence'],
}

interface ConfirmedItem {
  name: string
  quantity?: string
}

interface EstimateMealRequestBody {
  /** Omitted in 'text' mode. */
  photoBase64?: string
  description?: string
  /** The user's corrected item list from the review screen ("Recalculate with AI"). */
  confirmedItems?: ConfirmedItem[]
  /** 'packaged' = read a wrapper / nutrition label; 'text' = no photo, estimate from the description. */
  mode?: 'meal' | 'packaged' | 'text'
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

class EstimateFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

/** Turns the user's corrections into hard constraints appended to the prompt. */
function buildUserContext(description?: string, confirmedItems?: ConfirmedItem[]): string {
  const parts: string[] = []
  const desc = description?.trim().slice(0, 500)
  if (desc) parts.push(`User's description: ${desc}`)
  const items = (confirmedItems ?? [])
    .filter((i) => typeof i?.name === 'string' && i.name.trim())
    .slice(0, 15)
  if (items.length > 0) {
    const list = items
      .map((i, n) => `${n + 1}. ${i.name.trim().slice(0, 80)}${i.quantity?.trim() ? ` — ${i.quantity.trim().slice(0, 60)}` : ''}`)
      .join('\n')
    parts.push(
      `The user has CONFIRMED the meal contains exactly these items (they corrected your earlier guess). ` +
      `Return exactly these items, in this order, with these names. Where a quantity is given use it exactly; ` +
      `otherwise estimate it from the photo. Recompute all nutrition for these items:\n${list}`,
    )
  }
  return parts.join('\n\n')
}

// ── Double-check every answer ─────────────────────────────────────────────
// The model is asked to self-check, but it doesn't always. These checks are
// physics, not taste: calories must match the macros, a food's calories per
// gram must be possible for what it is, and nutrients can't weigh more than
// the food. Failures go back to the model once; whatever is still wrong is
// corrected here and the estimate is marked low-confidence.

export interface EstItem {
  name: string; quantity?: string; grams?: number; calories: number; protein_g: number; carbs_g: number; fat_g: number
  fiber_g?: number; added_sugar_g?: number; sat_fat_g?: number; alcohol_g?: number; group?: string; fried?: boolean; confidence?: string
}
export interface Estimate {
  is_food?: boolean; not_food_reason?: string; items: EstItem[]
  calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence?: string; assumptions?: string[]
}

/** Calories per gram that are possible for each food group, as served (wide on purpose: catches misreads, not style). */
export const KCAL_PER_GRAM: Record<string, [number, number]> = {
  vegetable: [0.1, 2], fruit: [0.2, 3.2], pulse: [0.25, 4], whole_grain: [0.6, 4.5], refined_grain: [0.8, 4.6],
  dairy: [0.3, 4.2], egg: [1.2, 2.6], meat: [0.8, 5.5], fish: [0.7, 3.2], nuts_seeds: [4.5, 7.3], fat_oil: [3, 9.1],
  sweet: [1.2, 5.8], fried_snack: [2, 6], sugary_drink: [0.2, 1.2], alcohol: [0.25, 2.6], protein_supplement: [0.25, 4.6],
}
const NON_ALCOHOLIC = /alcohol[- ]?free|non[- ]?alcoholic|\b0\.0\b|zero alcohol/i
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
const atwater = (i: EstItem) => 4 * i.protein_g + 4 * i.carbs_g + 9 * i.fat_g + 7 * (i.alcohol_g ?? 0)

function withTotals(e: Estimate): Estimate {
  const sum = (k: 'calories' | 'protein_g' | 'carbs_g' | 'fat_g') => Math.round(e.items.reduce((t, i) => t + i[k], 0))
  return { ...e, calories: sum('calories'), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') }
}

/** Cleans the model's JSON and lists what's physically wrong with it. Totals always become the sum of the items. */
export function checkEstimate(raw: unknown, mode: 'meal' | 'packaged' | 'text'): { estimate: Estimate | null; issues: string[] } {
  if (typeof raw !== 'object' || raw === null) return { estimate: null, issues: ['The answer was not a JSON object'] }
  const r = raw as Record<string, unknown>
  if (r.is_food === false) return { estimate: { ...(r as unknown as Estimate), items: [], calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, issues: [] }
  const items: EstItem[] = (Array.isArray(r.items) ? r.items : [])
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null && typeof (i as { name?: unknown }).name === 'string')
    .map((i) => ({
      ...(i as unknown as EstItem),
      grams: num(i.grams), calories: num(i.calories), protein_g: num(i.protein_g), carbs_g: num(i.carbs_g), fat_g: num(i.fat_g),
      fiber_g: num(i.fiber_g), added_sugar_g: num(i.added_sugar_g), sat_fat_g: num(i.sat_fat_g), alcohol_g: num(i.alcohol_g),
    }))
  const issues: string[] = []
  if (!items.length) issues.push('No items were listed')
  const tolerance = mode === 'packaged' ? 0.25 : 0.15 // labels round, and count fibre and polyols differently
  for (const i of items) {
    const name = `"${i.name}"`
    const calc = atwater(i)
    if (Math.abs(i.calories - calc) > 20 && Math.abs(i.calories - calc) / Math.max(i.calories, calc) > tolerance) {
      issues.push(`${name}: ${Math.round(i.calories)} kcal doesn't match its macros (4×protein + 4×carbs + 9×fat + 7×alcohol = ${Math.round(calc)} kcal)`)
    }
    const range = KCAL_PER_GRAM[i.group ?? '']
    if (range && i.grams && i.calories) {
      const perGram = i.calories / i.grams
      if (perGram < range[0] || perGram > range[1]) issues.push(`${name}: ${perGram.toFixed(1)} kcal per gram is not possible for ${i.group} (${range[0]}–${range[1]}) — check the dish or the grams`)
    }
    const mass = i.protein_g + i.carbs_g + i.fat_g + (i.alcohol_g ?? 0)
    if (i.grams && mass > i.grams * 1.05) issues.push(`${name}: protein + carbs + fat (${Math.round(mass)} g) weigh more than the food (${Math.round(i.grams)} g)`)
    if ((i.fiber_g ?? 0) > i.carbs_g + 1) issues.push(`${name}: fibre (${i.fiber_g} g) can't exceed carbs (${i.carbs_g} g)`)
    if ((i.added_sugar_g ?? 0) > i.carbs_g + 1) issues.push(`${name}: added sugar (${i.added_sugar_g} g) can't exceed carbs (${i.carbs_g} g)`)
    if ((i.sat_fat_g ?? 0) > i.fat_g + 0.5) issues.push(`${name}: saturated fat (${i.sat_fat_g} g) can't exceed fat (${i.fat_g} g)`)
    if (i.group === 'alcohol' && !i.alcohol_g && !NON_ALCOHOLIC.test(i.name)) issues.push(`${name}: an alcoholic drink needs alcohol_g (ml × ABV × 0.789)`)
  }
  return { estimate: withTotals({ ...(r as unknown as Estimate), items }), issues }
}

/** Fixes what can be fixed safely once the model has had its second try, and flags the rest. */
export function finalizeEstimate(e: Estimate, mode: 'meal' | 'packaged' | 'text', issues: string[]): Estimate {
  if (!issues.length || e.is_food === false) return e
  let adjusted = false
  const items = e.items.map((i) => {
    const out = { ...i }
    if ((out.fiber_g ?? 0) > out.carbs_g) { out.fiber_g = out.carbs_g; adjusted = true }
    if ((out.added_sugar_g ?? 0) > out.carbs_g) { out.added_sugar_g = out.carbs_g; adjusted = true }
    if ((out.sat_fat_g ?? 0) > out.fat_g) { out.sat_fat_g = out.fat_g; adjusted = true }
    const calc = atwater(out)
    // Printed label calories stand; otherwise the macros (the more detailed estimate) set the calories.
    if (mode !== 'packaged' && calc > 0 && Math.abs(out.calories - calc) > 20 && Math.abs(out.calories - calc) / Math.max(out.calories, calc) > 0.15) {
      out.calories = Math.round(calc); adjusted = true
    }
    return out
  })
  const note = adjusted ? 'Some numbers were adjusted so they add up — worth a quick check' : 'Some values looked unusual for this food — worth a quick check'
  return withTotals({ ...e, items, confidence: 'low', assumptions: [...(e.assumptions ?? []).slice(0, 2), note] })
}

/**
 * The single provider-specific function (spec §6/§10) — swapping to a
 * paid Gemini key, a different model, or an entirely different vision
 * API later means changing this function's body (and the geminiUrl/
 * PROMPT constants above it, which are Gemini-specific by nature).
 * Everything else — HTTP parsing, CORS, response formatting, the
 * Deno.serve handler — is provider-agnostic and doesn't change.
 */
async function estimateMeal(
  photoBase64: string | null,
  description?: string,
  confirmedItems?: ConfirmedItem[],
  mode: 'meal' | 'packaged' | 'text' = 'meal',
): Promise<unknown> {
  if (!GEMINI_API_KEY) {
    throw new EstimateFailure('Server misconfigured: missing GEMINI_API_KEY', 500)
  }

  const prompt = mode === 'packaged' ? PACKAGED_PROMPT : mode === 'text' ? TEXT_PROMPT : PROMPT
  const parts = [
    ...(photoBase64 ? [{ inline_data: { mime_type: 'image/jpeg', data: photoBase64 } }] : []),
    { text: [FOOD_CHECK + prompt, buildUserContext(description, confirmedItems)].filter(Boolean).join('\n\n') },
  ]
  const deadline = Date.now() + 40_000

  const first = await callGemini(parts, deadline)
  let { estimate, issues } = checkEstimate(first, mode)
  if (!estimate) throw new EstimateFailure('Gemini returned an unexpected shape', 502)

  // Second look, only when something failed and there's time: same photo, the
  // previous answer and exactly what was wrong with it.
  if (issues.length && deadline - Date.now() > 15_000) {
    try {
      const review = `REVIEW — your previous answer failed these checks:\n${issues.slice(0, 8).map((x) => `- ${x}`).join('\n')}\n` +
        `Look at the ${photoBase64 ? 'photo' : 'description'} again. Fix the identification, the grams or the nutrients — whichever is wrong — ` +
        `keep everything that was right, and return the complete corrected JSON.\nPrevious answer: ${JSON.stringify(first).slice(0, 6000)}`
      const second = checkEstimate(await callGemini([...parts, { text: review }], deadline), mode)
      if (second.estimate && second.estimate.is_food !== false && second.issues.length <= issues.length) ({ estimate, issues } = second)
    } catch (err) {
      console.error('Second look failed, keeping the first answer:', err instanceof Error ? err.message : err)
    }
  }
  if (issues.length) console.log(`estimate-meal: ${issues.length} check(s) still failing — corrected`, issues.slice(0, 3))
  return finalizeEstimate(estimate, mode, issues)
}

/** One Gemini call with retries and backup models; returns the parsed JSON. */
// deno-lint-ignore no-explicit-any
async function callGemini(parts: any[], deadline: number): Promise<unknown> {
  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Low temperature → the same photo gives (nearly) the same numbers.
      temperature: 0.2,
    },
  })

  // Gemini's free tier returns 503 ("high demand") or 429 (rate limit) at
  // peak times, sometimes for minutes. Busy (503) / rate-limited (429) → one quick retry on the same model,
  // then move to the next model. A model that doesn't exist for this key
  // (404) is skipped. Whole thing stays well inside the app's timeout.
  const RETRYABLE_STATUSES = new Set([429, 500, 503])
  const ATTEMPTS_PER_MODEL = 2
  const PER_CALL_TIMEOUT_MS = 20_000
  let geminiRes: Response | null = null
  let lastFailure = ''

  models: for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      if (Date.now() > deadline - 2_000) break models
      try {
        const res = await fetch(`${geminiUrl(model)}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(PER_CALL_TIMEOUT_MS, deadline - Date.now()))),
        })
        if (res.ok) {
          if (model !== GEMINI_MODEL) console.log(`Gemini: used backup model ${model}`)
          geminiRes = res
          break models
        }
        lastFailure = `${model} → ${res.status} ${(await res.text()).slice(0, 300)}`
        console.error('Gemini call failed:', lastFailure)
        if (res.status === 404) continue models          // model not available → next model
        if (!RETRYABLE_STATUSES.has(res.status)) break models // e.g. 400 bad request: retrying won't help
      } catch (err) {
        lastFailure = `${model} → ${err instanceof Error ? err.name : 'network error'}`
        console.error('Gemini call failed:', lastFailure)
      }
      if (attempt < ATTEMPTS_PER_MODEL) await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  if (!geminiRes) {
    throw new EstimateFailure(`Gemini call failed: ${lastFailure.split(' ')[2] ?? 'unknown'}`, 502)
  }

  const geminiJson = await geminiRes.json()
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text

  if (typeof text !== 'string') {
    throw new EstimateFailure('No text in Gemini response', 502)
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new EstimateFailure('Gemini returned unparseable JSON', 502)
  }
}

// deno-lint-ignore no-explicit-any
if ((globalThis as any).Deno) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const jwt = req.headers.get('authorization')?.replace('Bearer ', '')
  let claims: { role?: string; sub?: string } | null = null
  try {
    claims = jwt ? JSON.parse(atob(jwt.split('.')[1])) : null
  } catch {
    claims = null
  }
  if (!jwt || !claims || claims.role !== 'authenticated' || !claims.sub) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const body: EstimateMealRequestBody = await req.json()
    if (typeof body.photoBase64 === 'string' && body.photoBase64.length > MAX_PHOTO_BASE64_LENGTH) {
      return jsonResponse({ error: 'Photo too large' }, 413)
    }

    const quota = await checkQuota(jwt)
    if (quota === 'unauthorized') return jsonResponse({ error: 'Unauthorized' }, 401)
    if (quota === 'limit') return jsonResponse({ error: 'Daily estimate limit reached — try again tomorrow' }, 429)

    const mode = body.mode === 'packaged' ? 'packaged' : body.mode === 'text' ? 'text' : 'meal'
    if (mode === 'text' ? !body.description?.trim() : !body.photoBase64) {
      return jsonResponse({ error: mode === 'text' ? 'description is required' : 'photoBase64 is required' }, 400)
    }

    const confirmedItems = Array.isArray(body.confirmedItems) ? body.confirmedItems : undefined
    const result = await estimateMeal(mode === 'text' ? null : body.photoBase64 ?? null, body.description, confirmedItems, mode)
    return jsonResponse(result, 200)
  } catch (err) {
    if (err instanceof EstimateFailure) {
      return jsonResponse({ error: err.message }, err.status)
    }
    console.error('estimate-meal unexpected error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
