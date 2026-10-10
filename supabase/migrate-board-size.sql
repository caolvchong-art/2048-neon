-- ============================================================
--  2048 NEON EVOLVE - 只补 board_size 列（最小改动版）
--
--  用法：在 Supabase SQL Editor 里【逐段】执行，一段一次 Run。
--  为什么要逐段：SQL Editor 会把整段内容放在一个事务里，
--  一次性执行所有 ALTER 会长时间持有表锁，很容易和别人撞车
--  导致 deadlock detected (40P01)。
--
--  lock_timeout 的作用：拿不到锁就 5 秒后放弃并报
--  "canceling statement due to lock timeout"，这比死锁好得多
--  —— 直接重跑就行，不会牵连另一个会话。
--
--  执行前建议：关掉 Supabase 里其它开着这张表的标签页
--  （特别是 Table Editor，它会一直持有锁）。
-- ============================================================


-- ---------- 第 1 段：加列 ----------
set lock_timeout = '5s';
alter table public.leaderboard_sum
  add column if not exists board_size smallint not null default 4;


-- ---------- 第 2 段：加约束 ----------
set lock_timeout = '5s';
alter table public.leaderboard_sum drop constraint if exists lb_size_valid;
alter table public.leaderboard_sum add  constraint lb_size_valid check (board_size in (4, 5, 6));


-- ---------- 第 3 段：建索引 ----------
set lock_timeout = '5s';
create index if not exists lb_rank_idx on public.leaderboard_sum (board_size, rank_score desc);


-- ---------- 第 4 段：清掉之前探测留下的测试行 ----------
delete from public.leaderboard_sum where player_name = 'DSH-探测-可删';


-- ---------- 第 5 段：自检（应看到 board_size）----------
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'leaderboard_sum'
 order by ordinal_position;


-- ============================================================
--  如果还是报 deadlock，先看谁在持锁（另开一段执行）：
--
--    select pid, state, wait_event_type, wait_event,
--           now() - query_start as duration, left(query, 70) as query
--      from pg_stat_activity
--     where datname = current_database() and pid <> pg_backend_pid()
--     order by query_start;
--
--  确认某个 pid 是卡住的旧查询后，可以取消它：
--
--    select pg_cancel_backend(<上面查到的 pid>);
-- ============================================================
