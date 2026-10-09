-- One-time repair: make old posts' totals match their own item list.
--
-- Until this fix, a new log started with the AI's own totals instead of the
-- sum of the items it listed — and the AI sometimes disagreed with itself
-- (e.g. 30 g protein in the total, 27 g on the only item). Unless the person
-- edited something, those totals were posted as-is.
--
-- Only numbers the person never changed are touched (final = what the AI
-- said). Anything they typed or edited stays exactly as it is. Logs whose
-- item list is incomplete or malformed are skipped. The AI's original
-- estimate columns are left alone.
--
-- Safe to run more than once: the second run finds nothing to fix.
-- Shows how many posts were corrected.

with item_lists as (
  select l.id,
    case
      when jsonb_typeof(l.items) = 'array' and jsonb_array_length(l.items) > 0 then l.items
      when jsonb_typeof(l.ai_raw_response -> 'items') = 'array' then l.ai_raw_response -> 'items'
    end as items
  from logs l
),
valid as (
  select i.id, i.items
  from item_lists i
  where i.items is not null
    and jsonb_array_length(i.items) > 0
    and not exists (
      select 1 from jsonb_array_elements(i.items) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'name') <> 'string'
         or jsonb_typeof(e -> 'calories') <> 'number' or (e ->> 'calories')::numeric < 0
         or jsonb_typeof(e -> 'protein_g') <> 'number' or (e ->> 'protein_g')::numeric < 0
         or jsonb_typeof(e -> 'carbs_g') <> 'number' or (e ->> 'carbs_g')::numeric < 0
         or jsonb_typeof(e -> 'fat_g') <> 'number' or (e ->> 'fat_g')::numeric < 0
    )
),
sums as (
  -- Rounded per item, the same way the app adds them up.
  select v.id,
    sum(round((e ->> 'calories')::numeric))::int as calories,
    sum(round((e ->> 'protein_g')::numeric))::int as protein,
    sum(round((e ->> 'carbs_g')::numeric))::int as carbs,
    sum(round((e ->> 'fat_g')::numeric))::int as fat
  from valid v, jsonb_array_elements(v.items) e
  group by v.id
),
targets as (
  select l.id,
    -- "Untouched" = the posted number is still exactly the AI's number.
    (l.calories_estimate is not null and coalesce(l.calories_final, l.calories_estimate) = l.calories_estimate and l.calories_estimate <> s.calories) as fix_cal,
    (l.protein_estimate_g is not null and coalesce(l.protein_final_g, l.protein_estimate_g) = l.protein_estimate_g and l.protein_estimate_g <> s.protein) as fix_protein,
    (l.carbs_estimate_g is not null and coalesce(l.carbs_final_g, l.carbs_estimate_g) = l.carbs_estimate_g and l.carbs_estimate_g <> s.carbs) as fix_carbs,
    (l.fat_estimate_g is not null and coalesce(l.fat_final_g, l.fat_estimate_g) = l.fat_estimate_g and l.fat_estimate_g <> s.fat) as fix_fat,
    s.calories, s.protein, s.carbs, s.fat
  from logs l
  join sums s on s.id = l.id
  -- Rows that break 0019's (not-yet-validated) text limits would make the
  -- whole update fail, so leave those few alone.
  where coalesce(char_length(l.name), 0) <= 200
    and coalesce(char_length(l.caption), 0) <= 1000
    and coalesce(char_length(l.description), 0) <= 2000
),
fixed as (
  update logs l set
    calories_final  = case when t.fix_cal     then t.calories else l.calories_final  end,
    protein_final_g = case when t.fix_protein then t.protein  else l.protein_final_g end,
    carbs_final_g   = case when t.fix_carbs   then t.carbs    else l.carbs_final_g   end,
    fat_final_g     = case when t.fix_fat     then t.fat      else l.fat_final_g     end
  from targets t
  where l.id = t.id
    and (t.fix_cal or t.fix_protein or t.fix_carbs or t.fix_fat)
  returning l.id
)
select count(*) as posts_fixed from fixed;
