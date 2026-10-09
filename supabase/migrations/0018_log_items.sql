-- The meal's items as posted (name, amount, calories, macros), after the
-- user's edits on the review screen. Shown when you swipe a post. Before
-- this, only the AI's first guess (ai_raw_response) and the totals were
-- saved. Covered by the existing logs policies. Safe to run more than once.

alter table logs add column if not exists items jsonb;
