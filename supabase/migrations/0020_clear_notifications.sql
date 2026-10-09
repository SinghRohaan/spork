-- "Clear all" in Notifications: you can delete notifications sent to you,
-- and nobody else's. Safe to run more than once.
drop policy if exists "notifications_delete_own" on notifications;
create policy "notifications_delete_own"
  on notifications for delete
  to authenticated
  using (recipient_id = (select auth.uid()));
