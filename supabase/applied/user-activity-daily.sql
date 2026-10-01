-- ── Личная статистика: GitHub-график на странице участника ─────────────────
--
-- Возвращает за последние p_days дней активность конкретного пользователя:
-- посты, комментарии и сообщения в чатах по дням. Посты и комментарии —
-- публичные, чаты видят только сами участник (RLS) и staff.
--
-- Вторая часть — число чатов, в которых состоит пользователь. Для себя
-- (auth.uid() = p_user_id) вернёт точное число; для чужого профиля — null,
-- потому что RLS не позволяет читать чужие членства без общих чатов.

create or replace function public.get_user_activity(p_user_id uuid, p_days int default 140)
returns table (
  day            date,
  posts          bigint,
  comments       bigint,
  chat_messages  bigint,
  chats_joined   bigint
)
language sql stable security invoker set search_path = public
as $$
  with days as (
    select (current_date - (p_days - 1) + s)::date as day
    from generate_series(0, p_days - 1) s
  ),
  p as (
    select date(created_at) as day, count(*) as n
    from public.forum_posts
    where author_id = p_user_id and deleted = false
    group by 1
  ),
  c as (
    select date(created_at) as day, count(*) as n
    from public.forum_comments
    where author_id = p_user_id and deleted = false
    group by 1
  ),
  m as (
    select date(created_at) as day, count(*) as n
    from public.forum_chat_messages
    where author_id = p_user_id and deleted = false
    group by 1
  ),
  total as (
    select count(*) as n
    from public.forum_chat_members
    where user_id = p_user_id
  )
  select d.day,
    coalesce(p.n, 0)    as posts,
    coalesce(c.n, 0)    as comments,
    coalesce(m.n, 0)    as chat_messages,
    case when auth.uid() = p_user_id then (select n from total) else null end as chats_joined
  from days d
  left join p using (day)
  left join c using (day)
  left join m using (day)
  order by d.day;
$$;

grant execute on function public.get_user_activity(uuid, int) to anon, authenticated;