-- ============================================================
--  2048 NEON EVOLVE - global leaderboard
--  Table: public.leaderboard_sum
--
--  Run in: Supabase Dashboard -> SQL Editor -> New query -> Run
--  Safe to re-run. It self-heals a partially created table and
--  never touches existing rows.
--  ASCII only on purpose, so copy/paste cannot break the encoding.
-- ============================================================

-- ---------- 1. table ----------
create table if not exists public.leaderboard_sum (
  id bigint generated always as identity primary key
);

-- Top up any missing column (this is what makes the script idempotent).
alter table public.leaderboard_sum add column if not exists player_name  text        not null default 'anonymous';
alter table public.leaderboard_sum add column if not exists rank_score   integer     not null default 0;
alter table public.leaderboard_sum add column if not exists skill_points integer     not null default 0;
alter table public.leaderboard_sum add column if not exists board_size   smallint    not null default 4;
alter table public.leaderboard_sum add column if not exists created_at   timestamptz not null default now();

-- ---------- 2. constraints (drop + add, so re-running never errors) ----------
-- These are the last line of defence: even someone calling the REST API
-- directly with the public key cannot insert junk that breaks the board.
alter table public.leaderboard_sum drop constraint if exists lb_name_len;
alter table public.leaderboard_sum add  constraint lb_name_len   check (char_length(player_name) between 1 and 16);

alter table public.leaderboard_sum drop constraint if exists lb_score_rng;
alter table public.leaderboard_sum add  constraint lb_score_rng  check (rank_score >= 0 and rank_score <= 100000000);

alter table public.leaderboard_sum drop constraint if exists lb_skill_rng;
alter table public.leaderboard_sum add  constraint lb_skill_rng  check (skill_points >= 0 and skill_points <= 999999);

alter table public.leaderboard_sum drop constraint if exists lb_size_valid;
alter table public.leaderboard_sum add  constraint lb_size_valid check (board_size in (4, 5, 6));

-- ---------- 3. index ----------
-- The ranking query filters by board_size and orders by rank_score desc.
create index if not exists lb_rank_idx on public.leaderboard_sum (board_size, rank_score desc);

-- ---------- 4. row level security ----------
-- This is what makes it safe to ship the publishable key in a public page.
alter table public.leaderboard_sum enable row level security;

drop policy if exists "lb_public_read" on public.leaderboard_sum;
create policy "lb_public_read"
  on public.leaderboard_sum for select
  to anon, authenticated
  using (true);

drop policy if exists "lb_public_insert" on public.leaderboard_sum;
create policy "lb_public_insert"
  on public.leaderboard_sum for insert
  to anon, authenticated
  with check (true);

-- NOTE: there is deliberately NO update and NO delete policy.
-- Under RLS, "no policy" means "denied", so anonymous visitors can read
-- the board and submit a score, but can never edit or wipe anyone's entry.

-- ---------- 5. grants ----------
grant select, insert on public.leaderboard_sum to anon, authenticated;

-- ---------- 6. verify (run these to check) ----------
-- select policyname, cmd, roles from pg_policies where tablename = 'leaderboard_sum';
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'leaderboard_sum' order by ordinal_position;
