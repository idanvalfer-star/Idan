-- Cartly: re-enable Row Level Security.
--
-- Run this in Supabase → SQL Editor, on the project whose ref is
-- xxyhrhkflexpyipttmug (the one Cartly actually talks to — check the URL
-- before running, since the account also has a second project called Runny).
--
-- Every write in the app goes through server.js using the service-role key,
-- which always bypasses RLS — these policies only govern what a browser can
-- do directly with the public anon key (reads, and Realtime's live updates).
-- That direct anon-key path is exactly what was wide open: with RLS disabled,
-- anyone could query https://xxyhrhkflexpyipttmug.supabase.co/rest/v1/list_items
-- with the anon key baked into the page's JS and get every family's data back.

alter table users enable row level security;
alter table families enable row level security;
alter table list_items enable row level security;
alter table home_inventory enable row level security;

-- users: everyone can see and edit only their own row. No INSERT policy —
-- signup writes the row server-side via /api/complete-signup with the
-- service key, which is the only thing that's ever allowed to create one.
drop policy if exists users_select_own on users;
create policy users_select_own on users
  for select using (id = auth.uid());

drop policy if exists users_update_own on users;
create policy users_update_own on users
  for update using (id = auth.uid());

-- families: readable only by members of that family. Renames and creation
-- happen server-side (/api/family/:id/name, /api/complete-signup), so no
-- client-side insert/update/delete policy is needed.
drop policy if exists families_select_own on families;
create policy families_select_own on families
  for select using (
    id = (select family_id from users where id = auth.uid())
  );

-- list_items / home_inventory: readable only by members of the owning
-- family. All writes go through server.js's write endpoints (which now
-- check family membership themselves — see isFamilyMember() in server.js),
-- so no client-side write policy is needed here either.
drop policy if exists list_items_select_own_family on list_items;
create policy list_items_select_own_family on list_items
  for select using (
    family_id = (select family_id from users where id = auth.uid())
  );

drop policy if exists home_inventory_select_own_family on home_inventory;
create policy home_inventory_select_own_family on home_inventory
  for select using (
    family_id = (select family_id from users where id = auth.uid())
  );

-- Sanity check — should show every table with rowsecurity = true and one or
-- two policies each.
select tablename, rowsecurity
from pg_tables
where tablename in ('users', 'families', 'list_items', 'home_inventory');

select tablename, policyname, cmd
from pg_policies
where tablename in ('users', 'families', 'list_items', 'home_inventory')
order by tablename, policyname;
