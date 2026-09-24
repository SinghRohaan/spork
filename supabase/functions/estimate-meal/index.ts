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
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
- Macros must be consistent: calories ≈ 4×protein + 4×carbs + 9×fat (within ~10%).

USER TEXT ALWAYS WINS
- If the user's description gives items or quantities ("2 rotis", "200 g chicken", "it's prawn curry"), use them exactly and only estimate what they left out.

CONFIDENCE
- Per item: "high" only if the dish AND its amount are clearly visible; "low" for ambiguous dishes, hidden/stacked food, or blurry photos.
- Overall: the lowest-common-sense summary across items.

ASSUMPTIONS
- Add 1–3 short notes about the biggest assumptions you made that the user may want to correct (e.g. "Assumed curry is soy chunks — tap to change if it's prawn", "Assumed 1 tsp oil in the sabzi"). Keep each under 90 characters.

Return ONLY JSON of this shape:
{
  "items": [{ "name": string, "quantity": string, "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "confidence": "low"|"medium"|"high" }],
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

STEP 2 — NO TABLE, BUT THE PRODUCT IS RECOGNISABLE (brand + product name visible, e.g. "Yoga Bar Chocolate Brownie Protein Bar", "Amul Masti Dahi 200 g"):
- Use that product's published nutrition values. Set confidence "medium".

STEP 3 — HOW MUCH WAS EATEN:
- Single-serve packs (bars, chips/biscuit packets up to ~150 g, single bottles/cups): assume the whole pack.
- Bigger packs: one printed serving; if none is printed, a typical serving for that product type.
- If the user's text gives an amount ("had half", "2 bars", "30 g"), use it exactly.

STEP 4 — NOTHING READABLE: identify the product type from the pack and estimate; confidence "low".

Return ONE item: name = brand + product ("Yoga Bar Protein Bar – Chocolate Brownie"), quantity = what was eaten in household terms ("1 bar (60 g)", "1 serving (30 g)", "½ pack (50 g)"), grams = weight eaten, and its calories/protein_g/carbs_g/fat_g. Confidence "high" only when numbers were read off a visible table.
In "assumptions", say where the numbers came from in under 90 characters, e.g. "Read from the label · per serve (60 g)" or "No table visible — used Yoga Bar's published values".

Return ONLY JSON of this shape:
{
  "items": [{ "name": string, "quantity": string, "grams": number, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "confidence": "low"|"medium"|"high" }],
  "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number,
  "confidence": "low"|"medium"|"high",
  "assumptions": [string]
}
Top-level calories/protein_g/carbs_g/fat_g equal the single item's values.`

// Gemini structured output — keeps the model on-shape so parse failures
// (and silent "manual entry" fallbacks) become rare.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
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
          confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
        },
        required: ['name', 'quantity', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence'],
      },
    },
    calories: { type: 'NUMBER' },
    protein_g: { type: 'NUMBER' },
    carbs_g: { type: 'NUMBER' },
    fat_g: { type: 'NUMBER' },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
    assumptions: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['items', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'confidence'],
}

interface ConfirmedItem {
  name: string
  quantity?: string
}

interface EstimateMealRequestBody {
  photoBase64: string
  description?: string
  /** The user's corrected item list from the review screen ("Recalculate with AI"). */
  confirmedItems?: ConfirmedItem[]
  /** 'packaged' = read a wrapper / nutrition label instead of estimating a plated meal. */
  mode?: 'meal' | 'packaged'
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
 * API later means changing this function's body (and the GEMINI_URL/
 * PROMPT constants above it, which are Gemini-specific by nature).
 * Everything else — HTTP parsing, CORS, response formatting, the
 * Deno.serve handler — is provider-agnostic and doesn't change.
 */
async function estimateMeal(
  photoBase64: string,
  description?: string,
  confirmedItems?: ConfirmedItem[],
  mode: 'meal' | 'packaged' = 'meal',
): Promise<unknown> {
  if (!GEMINI_API_KEY) {
    throw new EstimateFailure('Server misconfigured: missing GEMINI_API_KEY', 500)
  }

  const parts = [
    { inline_data: { mime_type: 'image/jpeg', data: photoBase64 } },
    { text: [mode === 'packaged' ? PACKAGED_PROMPT : PROMPT, buildUserContext(description, confirmedItems)].filter(Boolean).join('\n\n') },
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

  // Gemini's free tier occasionally returns 503 ("high demand") or 429
  // (rate limit) — both transient, both known/expected (spec §6 AI
  // provider notes) — that typically clear within a second or two.
  // Retry those specifically before giving up to manual entry, rather
  // than treating every momentary blip as a hard failure.
  const RETRYABLE_STATUSES = new Set([429, 503])
  const MAX_ATTEMPTS = 3
  let geminiRes: Response
  let attempt = 1
  for (;;) {
    geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
    })
    if (geminiRes.ok || !RETRYABLE_STATUSES.has(geminiRes.status) || attempt >= MAX_ATTEMPTS) break
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    attempt++
  }

  if (!geminiRes.ok) {
    console.error('Gemini call failed:', geminiRes.status, await geminiRes.text())
    throw new EstimateFailure(`Gemini call failed: ${geminiRes.status}`, 502)
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
  if (!claims || claims.role !== 'authenticated' || !claims.sub) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  try {
    const body: EstimateMealRequestBody = await req.json()

    if (!body.photoBase64) {
      return jsonResponse({ error: 'photoBase64 is required' }, 400)
    }

    const confirmedItems = Array.isArray(body.confirmedItems) ? body.confirmedItems : undefined
    const mode = body.mode === 'packaged' ? 'packaged' : 'meal'
    const result = await estimateMeal(body.photoBase64, body.description, confirmedItems, mode)
    return jsonResponse(result, 200)
  } catch (err) {
    if (err instanceof EstimateFailure) {
      return jsonResponse({ error: err.message }, err.status)
    }
    console.error('estimate-meal unexpected error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
})
