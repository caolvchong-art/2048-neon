-- ============================================================
--  OPTIONAL / DESTRUCTIVE
--  Drops the global leaderboard table so setup.sql can rebuild it.
--
--  Only run this if the existing public.leaderboard_sum table is a
--  leftover you do not need.
--
--  Inspect what is currently there before dropping:
--    select column_name, data_type from information_schema.columns
--      where table_schema = 'public' and table_name = 'leaderboard_sum'
--      order by ordinal_position;
--    select count(*) from public.leaderboard_sum;
--
--  Delete a few rows without dropping the table:
--    delete from public.leaderboard_sum where player_name = 'DSH-探测-可删';
--
--  Then run setup.sql again.
-- ============================================================

drop table if exists public.leaderboard_sum cascade;
