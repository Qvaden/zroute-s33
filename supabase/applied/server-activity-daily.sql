-- ── Активность сервера: ежедневная статистика для виджета на форуме ────────
--
-- Функция возвращает за последние p_days дней: число постов, комментариев
-- и сообщений в чатах.
--
-- ЧЕСТНОСТЬ ДОСТУПА. security invoker — не definer: функция выполняется
-- правами того, кто её вызывает, а значит RLS каждой таблицы применяется
-- как обычно. Посты и комментарии читаются всеми (политики true), поэтому
-- их видит и аноним. Сообщения в чатах видят только участники, поэтому
-- анониму счётчик придёт нулём, а участнику — по его чатам. Раскрывать
-- чужие чаты простым числом было бы красиво, но нечестно: активность чата
-- такой же секрет, как его содержание.

create or replace function public.get_server_activity(p_days int default 7)
returns table (
  day            date,
  forum_posts    bigint,
  forum_comments bigint,
  chat_messages  bigint
)
language sql stable security invoker set search_path = public
as $$
  with days as (
    select (current_date - (p_days - 1) + s)::date as day
    from generate_series(0, p_days - 1) s
  ),
  posts as (
    select date(created_at) as day, count(*) as n
    from public.forum_posts
    where deleted = false
    group by 1
  ),
  comments as (
    select date(created_at) as day, count(*) as n
    from public.forum_comments
    where deleted = false
    group by 1
  ),
  messages as (
    select date(created_at) as day, count(*) as n
    from public.forum_chat_messages
    where deleted = false
    group by 1
  )
  select d.day,
    coalesce(p.n, 0) as forum_posts,
    coalesce(c.n, 0) as forum_comments,
    coalesce(m.n, 0) as chat_messages
  from days d
  left join posts p using (day)
  left join comments c using (day)
  left join messages m using (day)
  order by d.day;
$$;

grant execute on function public.get_server_activity(int) to anon, authenticated;