-- In-app account deletion (required by Google Play for apps with sign-up).
--
-- Deleting the auth user cascades through every table:
--   auth.users → users → logs, friendships, likes, comments, comment_likes,
--   notifications, redemptions (all "on delete cascade").
-- Photos in Storage can't be deleted from SQL, so the app removes them
-- through the Storage API first (meal-photos already allows deleting your
-- own folder; avatars gets the same policy here).

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  -- Only ever the caller's own account.
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
