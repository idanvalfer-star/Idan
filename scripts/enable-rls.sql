-- Cartly: canonical RLS policies (idempotent — safe to re-run any time).
--
-- Run in Supabase → SQL Editor, on the project whose ref is
-- xxyhrhkflexpyipttmug (the one Cartly actually talks to — check the URL
-- before running, since the account also has a second project called Runny).
--
-- This supersedes an earlier version of this file. That version enabled RLS
-- but left a set of policies from an older, half-finished RLS attempt still
-- in place — dormant while RLS was disabled, active again the moment it was
-- turned back on. One of them was a real escalation bug: `users` had an
-- UPDATE policy that only checked `id = auth.uid()`, with nothing stopping a
-- signed-in user from changing their OWN family_id to a DIFFERENT family's
-- id. Since every other table's access is gated on
-- `family_id = (select family_id from users where id = auth.uid())`, one
-- PATCH request — no family code needed — would hand them read (and via
-- home_inventory/list_items's own leftover write policies, write) access to
-- any family whose id they knew. `families` had a matching problem: an
-- INSERT policy open to {anon,authenticated} with no restriction at all, so
-- anyone holding the public anon key could create rows in it freely.
--
-- The app's client code never writes to users, families, list_items, or
-- home_inventory directly — every write goes through server.js with the
-- service key (which always bypasses RLS, no matter what's defined here;
-- server.js separately checks family membership itself via
-- isFamilyMember() before it will write on someone's behalf). So the
-- correct policy set is exactly one SELECT policy per table and nothing
-- else. This script drops every write/duplicate policy — by every name
-- either the original schema or the previous version of this file could
-- have created — and defines exactly that.

alter table users enable row level security;
alter table families enable row level security;
alter table list_items enable row level security;
alter table home_inventory enable row level security;

-- users -----------------------------------------------------------
drop policy if exists "Users can create own profile" on users;
drop policy if exists "Users can update own profile" on users;
drop policy if exists "Users can update their own profile" on users;
drop policy if exists "Users can view their own profile" on users;
drop policy if exists "Users can read own profile" on users;
drop policy if exists users_select_own on users;
drop policy if exists users_update_own on users;

create policy users_select_own on users
  for select using (id = auth.uid());

-- families -----------------------------------------------------------
drop policy if exists "Allow anyone to create families" on families;
drop policy if exists "Users can create families" on families;
drop policy if exists "Family creator can update families" on families;
drop policy if exists "Family creator can update family settings" on families;
drop policy if exists "Users can view their family" on families;
drop policy if exists families_select_own on families;

create policy families_select_own on families
  for select using (
    id = (select family_id from users where id = auth.uid())
  );

-- list_items -----------------------------------------------------------
drop policy if exists list_delete on list_items;
drop policy if exists list_insert on list_items;
drop policy if exists list_update on list_items;
drop policy if exists list_select on list_items;
drop policy if exists list_items_select_own_family on list_items;

create policy list_items_select_own_family on list_items
  for select using (
    family_id = (select family_id from users where id = auth.uid())
  );

-- home_inventory -----------------------------------------------------------
drop policy if exists "Users can delete from their family's inventory" on home_inventory;
drop policy if exists "Users can insert items to their family's inventory" on home_inventory;
drop policy if exists "Users can update their family's inventory" on home_inventory;
drop policy if exists "Users can view their family's inventory" on home_inventory;
drop policy if exists home_inventory_select_own_family on home_inventory;

create policy home_inventory_select_own_family on home_inventory
  for select using (
    family_id = (select family_id from users where id = auth.uid())
  );

-- Verify: exactly one SELECT-only policy per table, four rows total.
select tablename, policyname, cmd, roles
from pg_policies
where tablename in ('users', 'families', 'list_items', 'home_inventory')
order by tablename;
