# Spork meal score — the matrix

Every number the meal score uses, where it comes from, and how each edge case is handled.
The code is `mealScore()` in `src/lib/accountability.ts`; every threshold lives in `SCORE_RULES` there.
The AI side (what gets measured) is `supabase/functions/estimate-meal/index.ts`.

## 1. How each part is scored

Each part runs on a **sliding scale** between a "zero points" level and a "full points" level, the way the
Healthy Eating Index (HEI-2020) scores a diet. Nothing jumps from full to zero at a single cut-off. Fibre,
sugar and fat are judged **per calorie**, so a big plate and a small plate of the same food score the same
on quality. The size of the plate is judged separately, in Portion.

### Main meals (breakfast, lunch, dinner), 10 points

| Part | Points | Zero at | Full at | Based on |
|---|---|---|---|---|
| Protein | 3 | 25% of target | 90% of target | ISSN: 20–40 g per meal (0.25 g/kg). Target = daily goal × meal share, **clamped to 20–40 g** |
| Portion | 2 | 0.4× and 1.8× budget | 0.8–1.2× budget | Meal budget = daily calories × share (below) |
| Fibre | 2 | 4 g / 1,000 kcal | 14 g / 1,000 kcal | Dietary Reference Intake: 14 g fibre per 1,000 kcal |
| Food quality | 2 | see quality matrix | | HEI-2020 moderation parts, energy-density bands |
| Balance | 1 | fat 55% or carbs 80% of macro calories | fat ≤ 35% and carbs ≤ 65% | Acceptable Macronutrient Distribution Range (fat 20–35%, carbs 45–65%) |

### Snacks, 10 points

| Part | Points | How |
|---|---|---|
| Protein **or** plants | 4 | The better of: protein (target clamped to **10–20 g**), or fibre density / share of calories from fruit, veg, pulses or nuts (full at 50%). A curd, egg or whey snack and a fruit or nuts snack both count |
| Size | 3 | Full up to 1× the snack budget (15% of the day), zero at 1.67× |
| Food quality | 3 | Same quality matrix |

### Food quality (both), scored 0–1, then × 2 (meals) or × 3 (snacks)

| Sub-part | Weight | Zero at | Full at | Based on |
|---|---|---|---|---|
| Added / free sugar, share of calories | ½ | 26% | 6.5% | HEI-2020 added sugars; WHO free sugars < 10% (< 5% ideal). Fruit juice counts as free sugar; whole fruit and plain milk don't |
| Saturated fat, share of calories | ¼ | 16% | 8% | HEI-2020 saturated fat; WHO < 10% |
| Fried / calorie-dense, the worse of the two | ¼ | ≥ 60% of calories fried, or ≥ 4 kcal/g | not fried, ≤ 1.5 kcal/g | Energy-density bands (Rolls): low < 1.5, high > 4 kcal/g. Drinks and nuts are left out of density |

### Meal budgets (share of the day's calories)

| Breakfast | Lunch | Dinner | Snack | "Snack" scored as a meal |
|---|---|---|---|---|
| 25% | 30% | 30% | 15% | over **20%** of the day, scored with a 25% meal budget and labelled "Meal-sized snack — scored as a meal" |

## 2. Hard rules (applied after the parts)

| Rule | Detection | Result |
|---|---|---|
| Too small | under 40 kcal and no alcohol | **not scored**, "Too light to score" |
| No macros | protein + carbs + fat explain < 20% of the calories, no alcohol | **not scored**, "Not enough detail to score" |
| Mostly alcohol | alcohol ≥ 50% of calories | **1**, or **2** if ≤ 20 g (≤ 2 standard drinks). Shows "≈N standard drinks" (WHO: 10 g each). ≥ 60 g = heavy drinking (WHO) |
| Some alcohol | 20–50% of calories | −2, at most **5** |
| Drinks with food | < 20% of calories but ≥ 20 g | −1 |
| Mostly sugar | added sugar ≥ 50% of calories | at most **3** |
| Mostly junk | fried food, fried snacks, sweets or sugary drinks ≥ 60% of calories | snack at most **3**; meal at most **5**, or **4** at ≥ 80% |
| Too much at once | main meal over 1.5× budget / over 2× budget | at most **6** / at most **4** |
| Over budget | always | protein only counts for the part of the meal within 1.2× budget (1× for snacks), so eating double never earns double credit |

**Alcohol detection.** Uses the AI's `alcohol_g`. On older posts it falls back to calories that protein, carbs and fat
can't explain (alcohol is 7 kcal/g), but only when the meal or an item is clearly a drink. Word matching is
whole-word, so rumali roti, ginger, kale and beer-battered fish don't count.

**Basic score.** Meals without AI detail (older posts, hand-added items making up more than 20% of the calories)
score fibre and quality at half marks, and the meal page says so.

## 3. Labels

| Score | 9–10 | 7–8 | 5–6 | 3–4 | 1–2 |
|---|---|---|---|---|---|
| Label | Excellent | Good | Okay | Needs work | Poor |
| Colour | green | green | amber | red | red |

The headline adds the biggest fix ("Good, light on protein"). Up to 3 reasons are shown: one thing that went
well, then the fixes, worst first.

## 4. Day score (/100)

Calories 40 · protein 40 · meals logged 20 (unchanged), minus **10** for 2+ standard drinks or **25** for 6+
(WHO heavy episodic drinking, 60 g), shown as "≈N standard drinks today".

## 5. Getting the numbers right (AI side)

A 2025 study of three AI models on food photos (PMC12513282) found about 36% error on calories, around 60% on
protein, systematic **under**-estimation that grows with portion size, and misidentified dishes as the biggest
source of error. So:

1. **Measure, then weigh.** The prompt makes the model estimate each item's size against the plate, katori,
   spoon or hand, then volume, then grams. It is told not to shrink full or heaped portions, and to count
   hidden oil, ghee, gravy and dips.
2. **Reference values.** The prompt carries per-100 g values for about 45 common Indian foods, plus household
   measures (katori 150 ml, roti 40 g, peg 30 ml, …). A number more than about 30% off a reference means the
   model has to look again.
3. **Self-check in the prompt.** calories ≈ 4P + 4C + 9F + 7·alcohol; calories per gram fits the food;
   nutrients can't outweigh the food; fibre and sugar ≤ carbs, saturated fat ≤ fat; totals = sum.
4. **Server-side double-check.** The server runs the same physics on every answer (`checkEstimate`).
   - Anything failing goes back to the model **once**, with the exact problems listed.
   - Whatever is still wrong is fixed: impossible values are clamped, and calories are set from the macros
     (except printed labels).
   - The estimate is then marked low-confidence with "worth a quick check".
   - Totals are always recomputed as the sum of the items.

## 6. Edge cases (each one has a test)

| Case | Handling |
|---|---|
| Black coffee, water, ORS, vitamins | not scored |
| Calories typed with no macros | not scored, asks for macros |
| Half a bottle of vodka | 1, mostly alcohol, ≈12 standard drinks |
| One peg | 2, mostly alcohol |
| Dinner + 2–3 beers | −2, at most 5 |
| Alcohol-free beer, ginger tea, rumali roti, kale, beer-battered fish | not alcohol |
| Cola, fruit juice | mostly sugar, at most 3 |
| Chips, samosa + sweet chai | junk cap |
| Nuts | not flagged as dense; nourishing snack |
| Keto plate | fat-heavy |
| Ghee-heavy dal makhani | high in saturated fat |
| 528 kcal / 43 g protein "snack" | scored as a meal (≈8), not "needs work" |
| 180 g/day protein goal | lunch target capped at 40 g |
| 40 g/day protein goal | meal target floored at 20 g |
| 1, 1.25, 1.5, 2, 2.5, 3 plates of the same food | score never goes up as the plate grows |
| 150 kcal lunch | "Very light lunch — was anything left out?" |
| Hand-added item without detail | basic score |
| 500 random meals and goals | always a whole number 1–10 or not scored, ≤ 3 reasons |
| AI calories don't match macros / impossible kcal per gram / nutrients heavier than food / beer with 0 g alcohol | second look, then corrected and flagged |

## Sources

- ISSN position stand: protein and exercise — https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0189-4
- HEI-2020 components and standards — https://www.fns.usda.gov/cnpp/how-hei-scored, https://epi.grants.cancer.gov/hei/developing.html
- WHO healthy diet fact sheet — https://www.who.int/publications/m/item/healthy-diet-factsheet394
- WHO heavy episodic drinking (60 g) — https://www.who.int/data/gho/data/indicators/indicator-details/GHO/heavy-episodic-drinking-(youth-15--19-years)-drinkers-only-past-30-days-(-)
- Acceptable Macronutrient Distribution Ranges — https://nap.nationalacademies.org/read/11537/chapter/7
- Fibre 14 g / 1,000 kcal (DRI) — https://www.health.harvard.edu/staying-healthy/facts-about-fiber
- Energy-density bands — https://scienceinsights.org/how-to-calculate-energy-density-of-food/
- AI photo estimation accuracy (2025) — https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/
- ICMR-NIN Dietary Guidelines for Indians 2024 — https://nutritionconnect.org/resource-center/dietary-guidelines-indians-2024-edition-icmr-nin
