-- Security fixes + database speed-ups. Safe to run more than once.
-- Run AFTER the app update that ships with it is live (the app reads its
-- own profile through get_my_profile(), added here).

-- ── 1. Friend requests can't skip the "accept" step ─────────────────────
-- Before: a request could be created already "accepted", so anyone could
-- make themselves your friend and see your meals.
drop policy if exists "friendships_insert_as_requester" on friendships;
create policy "friendships_insert_as_requester"
  on friendships for insert
  to authenticated
  with check (auth.uid() = requester_id and status = 'pending' and not is_blocked_with(recipient_id));

-- ── 2. Accepting only flips pending → accepted, nothing else ────────────
-- Before: the person a request was sent to could rewrite who it was from,
-- becoming "friends" with anyone. Now only the status column can change.
revoke update on friendships from anon, authenticated;
grant update (status) on friendships to authenticated;
drop policy if exists "friendships_update_recipient_accepts" on friendships;
create policy "friendships_update_recipient_accepts"
  on friendships for update
  to authenticated
  using (auth.uid() = recipient_id and status = 'pending')
  with check (auth.uid() = recipient_id and status = 'accepted' and not is_blocked_with(requester_id));

-- ── 3. Other people see only your public profile fields ─────────────────
-- Before: any signed-in user could read everyone's height, target weight,
-- reminder time and water settings. Others now see only what the app
-- shows about you; your own full profile comes from get_my_profile().
revoke select on users from anon, authenticated;
grant select (id, username, name, photo_url, privacy_default, calorie_goal, protein_goal, streak_count, streak_last_log_date, created_at)
  on users to authenticated;

create or replace function public.get_my_profile()
returns setof users
language sql
stable
security definer
set search_path = public
as $$
  select * from users where id = auth.uid();
$$;
revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- ── 4. AI estimate usage limit ──────────────────────────────────────────
-- The estimate-meal function calls this with the user's own login token
-- before every AI call: it proves the login is real and caps each person
-- at p_limit estimates a day, so nobody can run up the AI bill.
create table if not exists ai_usage (
  user_id uuid not null,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table ai_usage enable row level security;
-- No policies: only consume_ai_quota() touches this table.

create or replace function public.consume_ai_quota(p_limit int default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  used int;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  insert into ai_usage (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  returning count into used;
  return used <= least(greatest(coalesce(p_limit, 60), 1), 200);
end;
$$;
revoke all on function public.consume_ai_quota(int) from public, anon;
grant execute on function public.consume_ai_quota(int) to authenticated;

-- ── 5. Photo uploads: images only, sensible sizes ───────────────────────
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
      set file_size_limit = 5 * 1024 * 1024,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
      where id = 'avatars';
    update storage.buckets
      set file_size_limit = 10 * 1024 * 1024,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
      where id = 'meal-photos';
  end if;
end $$;

-- ── 6. Length limits on text people type ────────────────────────────────
-- NOT VALID: applies to new and edited rows only, so old rows never block this.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'log_comments_body_length') then
    alter table log_comments add constraint log_comments_body_length check (char_length(body) between 1 and 2000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'logs_text_length') then
    alter table logs add constraint logs_text_length check (
      coalesce(char_length(name), 0) <= 200 and coalesce(char_length(caption), 0) <= 1000 and coalesce(char_length(description), 0) <= 2000
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_name_length') then
    alter table users add constraint users_name_length check (char_length(name) <= 80) not valid;
  end if;
end $$;

-- ── 7. Speed: indexes for the feed, profiles, photos and friend checks ──
create index if not exists logs_created_at_idx on logs (created_at desc);
create index if not exists logs_user_created_idx on logs (user_id, created_at desc);
create index if not exists logs_photo_url_idx on logs (photo_url) where photo_url is not null;
create index if not exists friendships_requester_status_idx on friendships (requester_id, status);
create index if not exists friendships_recipient_status_idx on friendships (recipient_id, status);
create index if not exists log_likes_log_id_idx on log_likes (log_id);
create index if not exists redemptions_user_idx on redemptions (user_id);

-- ── 8. Speed: work out "who is asking" once per query, not once per row ─
-- Same rule as before (owner, or an accepted friend for public posts);
-- (select auth.uid()) lets Postgres evaluate it a single time.
drop policy if exists "logs_select_own_or_public_friend" on logs;
create policy "logs_select_own_or_public_friend"
  on logs for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (
      visibility = 'public'
      and exists (
        select 1 from friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = (select auth.uid()) and f.recipient_id = logs.user_id)
            or (f.recipient_id = (select auth.uid()) and f.requester_id = logs.user_id)
          )
      )
    )
  );
