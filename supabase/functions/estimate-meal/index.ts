// Deno runtime — deployed via `supabase functions deploy estimate-meal`
// (Task 4). Supabase's default verify_jwt only checks that the request
// carries ANY validly-signed JWT — the public anon key satisfies that,
// so it does NOT by itself restrict this to real signed-in users. The
// explicit claims check below (role === 'authenticated' AND a subject)
// is what actually protects the free-tier Gemini quota (spec §6 AI
// provider notes) from being hit by anyone who reads the client bundle.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
// Model is overridable via the GEMINI_MODEL secret (e.g. 'gemini-flash-latest'
// for better vision accuracy) without a code change. Default unchanged.
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-lite-latest'
// Backup models, tried in order when the main one is overloaded (503) or
// rate-limited (429). Each model has its own capacity, so a demand spike on
// one rarely hits the others. Overridable via the GEMINI_FALLBACK_MODELS
// secret (comma-separated).
const GEMINI_FALLBACK_MODELS = (Deno.env.get('GEMINI_FALLBACK_MODELS') || 'gemini-flash-latest,gemini-2.5-flash-lite')
  .split(',').map((m) => m.trim()).filter(Boolean)
const GEMINI_MODELS = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])]
const geminiUrl = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
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

const PROMPT = `You are a registered-dietitian-level nutrition estimator specialising in Indian and South Asian home food, with broad knowledge of global cuisine. You are looking at a photo of one meal.

Work in two passes.

PASS 1 — IDENTIFY
- List every distinct food item you can see: each bowl, katori, pile or piece is a separate item.
- Name items specifically ("Yellow moong dal", "Egg bhurji", "Jeera rice") but only as specific as the photo supports.
- When two dishes look alike and you cannot tell them apart (e.g. soy chunk curry vs prawn curry vs paneer curry, chicken vs mutton, dal vs sambar), do NOT pick one confidently: name it generically ("Curry with chunks (soy/prawn?)") and set that item's confidence to "low".
- COUNT discrete items: boiled egg halves → whole eggs (4 halves = 2 eggs), rotis, idlis, pieces of chicken.

PASS 2 — QUANTIFY, then compute nutrition
- Estimate each item's amount using visual references:
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

${NUTRITION_DETAIL}Return ONLY JSON of this shape:
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

${NUTRITION_DETAIL}Return ONLY JSON of this shape:
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

${NUTRITION_DETAIL}Return ONLY JSON of this shape:
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
  const DEADLINE = Date.now() + 40_000
  let geminiRes: Response | null = null
  let lastFailure = ''

  models: for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      if (Date.now() > DEADLINE - 2_000) break models
      try {
        const res = await fetch(`${geminiUrl(model)}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(PER_CALL_TIMEOUT_MS, DEADLINE - Date.now()))),
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

Deno.serve(async (req: Request) => {
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
