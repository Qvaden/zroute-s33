-- ── Аватар в комментариях к летописи ───────────────────────────────────────
--
-- ЗАЧЕМ. Комментарий к записи хронологии показывается с аватаром автора,
-- но таблица forum_event_comments хранит только author_id — и аватара в ней
-- нет. Раньше страница показывала первую букву ника всегда, даже когда у
-- человека аватар был: адаптер читал author_avatar, которого в ответе базы
-- не было, и тихо рисовал букву.
--
-- ЧТО ДЕЛАЕМ. Добавляем представление forum_event_comment_list, которое
-- берёт аватар из forum_users по author_id. Таблица не трогаем: она уже
-- используется в других местах, и колонка с аватаром продублировала бы
-- данные, которые меняются у человека.
--
-- ЗАПУСК. В Supabase → SQL Editor → вставить → Run.
-- Откат: drop view if exists public.forum_event_comment_list;

create or replace view public.forum_event_comment_list
with (security_invoker = off) as
select
  c.id,
  c.event_id,
  c.author_id,
  c.author_nick,
  u.avatar_url as author_avatar,
  c.body,
  c.deleted,
  c.deleted_reason,
  c.created_at
from public.forum_event_comments c
left join public.forum_users u on u.id = c.author_id;

grant select on public.forum_event_comment_list to authenticated;
