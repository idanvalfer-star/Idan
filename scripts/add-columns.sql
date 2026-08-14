-- Cartly: add columns for two features —
--   1. "who added this" badges that track the original adder, not the last
--      editor (list_items.added_by)
--   2. avatars visible to the rest of the family, not just your own device
--      (users.avatar)
--
-- Run in Supabase → SQL Editor, on project xxyhrhkflexpyipttmug.
--
-- Both are additive and both degrade gracefully if this hasn't run yet:
-- server.js already tolerates a missing added_by column on writes (it
-- self-heals around any column PostgREST reports as missing), and
-- /api/family/:familyId falls back to a query without avatar if that column
-- isn't there. So there's no breakage window either way — the two features
-- just silently no-op until this is applied.

alter table list_items add column if not exists added_by uuid;
alter table users add column if not exists avatar text;

-- sanity check — should show both new columns
select table_name, column_name, data_type
from information_schema.columns
where table_name in ('list_items', 'users')
  and column_name in ('added_by', 'avatar');
