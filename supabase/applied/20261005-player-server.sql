/*
  СЕРВЕР — СВОЙСТВО ЧЕЛОВЕКА, А НЕ ВТОРАЯ ЛЕНТА.

  Выбор ленты зрителю убран 05.10.2026: второй ленты для читателя нет, а ряд из
  двух кнопок в шапке выглядел обещанием, которого сайт не выполняет. При этом
  игроки с других серверов существуют, и модераторов на весь форум двое — то
  есть никто не будет разборчиво сидеть в «своей» ленте, пока чужая пустая.
  Остался вопрос, на который лента не отвечает: с какого сервера этот человек.

  Поэтому сервер поселяется у игрока, а не у зрителя:
    - `forum_users.server_id` — номер, который человек назвал сам при
      регистрации и может поправить в профиле; `null` — «не указан», и это
      честное состояние, а не ноль и не 33 по умолчанию;
    - `author_server` в представлениях — тот же номер автора, чтобы значок
      рисовался возле ника без второго запроса на каждую строку списка;
    - лента остаётся одна: `forum_posts.server_id` не тронут и по-прежнему
      равен серверу сайта, темы разных серверов не разъезжаются по комнатам.

  ПРАВ НА ЗАПИСЬ ЭТОТ ШАГ НЕ КАСАЕТСЯ. Проверено на живой базе: у строки 33-го
  `open_writing = true`, то есть писать в общую ленту может любой незабаненный,
  и номер в профиле этому не препятствие. Роль участника в `forum_server_members`
  здесь не нужна: она решала, кому дозволено в чужую ленту, а чужих лент больше
  нет.

  ПОЧЕМУ ОДИН РАЗ В 30 ДНЕЙ. Номер человек выбирает сам и никто его не
  проверяет, поэтому этим номером легко прикинуться своим в чужом обсуждении. Ровно это держит и журнал переименований: ник тоже можно
  подменить, и срок на это есть. Снятие номера считается сменой на том же
  основании — иначе лимит обходился бы двумя правками: «снять сегодня, поставить
  новый завтра».
*/

-- ── Шаг 1. Номер сервера у человека ────────────────────────────────────────

alter table public.forum_users
  add column if not exists server_id integer,
  add column if not exists server_set_at timestamptz;

comment on column public.forum_users.server_id is
  'Игровой сервер, который человек назвал сам. Пусто — «не указан»: значка у ника нет, и это не враньё про чужой сервер.';
comment on column public.forum_users.server_set_at is
  'Когда номер был выбран в последний раз. По этому полю экран говорит, когда смена станет возможной.';

/*
  Границы те же, что у `forum_servers.id` и `forum_posts.server_id`: 1..999.
  Ограничение — страховка для записи прямо в базу, понятные слова человеку
  говорит триггер на шаге 2.
*/
alter table public.forum_users drop constraint if exists forum_users_server_range;
alter table public.forum_users add constraint forum_users_server_range
  check (server_id is null or server_id between 1 and 999);

-- ── Шаг 2. Отказ по-русски и ожидание между сменами ────────────────────────

/*
  Отдельный триггер, а не правка `forum_users_guard`: тот лежит в истории и
  держит роль, ник, бан и флаги. Переписывать прогнанный файл нельзя, а копия
  его тела в новом шаге — это место, где через год легко потерять одну из
  защит, и выглядит потеря как обычный профиль, где бан снова можно снять себе
  самому.
*/
create or replace function public.forum_users_server_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_wait interval := interval '30 days';
begin
  /*
    Дату смены извне не принимаем ни при каком раскладе: поле лежит в той же
    строке, что и номер, и правка вида «поставил 44 и заодно дату трёхлетней
    давности» обнулила бы ожидание быстрее, чем любое правило успело бы
    сработать. Ниже дату ставит только этот триггер.
  */
  new.server_set_at := old.server_set_at;

  if new.server_id is not distinct from old.server_id then
    return new;
  end if;

  if new.server_id is not null and (new.server_id < 1 or new.server_id > 999) then
    raise exception 'Номер сервера — целое от 1 до 999';
  end if;

  -- В SQL-редакторе и у служебного ключа ожидания нет: лечить чужую ошибку
  -- вручную должно быть можно в любой момент.
  if auth.uid() is null then
    new.server_set_at := now();
    return new;
  end if;

  -- Модерация правит всегда: человек мог вписать чужой номер до того, как
  -- правило успело его остановить, и исправить это должен тот, кто видит игру.
  if public.forum_is_staff() then
    new.server_set_at := now();
    return new;
  end if;

  if old.server_id is not null
     and old.server_set_at is not null
     and old.server_set_at > now() - v_wait then
    raise exception 'Сервер можно менять раз в 30 дней. Следующая смена — после %',
      to_char(old.server_set_at + v_wait, 'DD.MM.YYYY');
  end if;

  new.server_set_at := now();
  return new;
end;
$$;

/*
  Триггер висит и на `server_set_at`: иначе PATCH, который принёс только дату,
  дошёл бы до строки, не побеспокоив ни одно правило, и следующим шагом снялся
  бы лимит.
*/
drop trigger if exists forum_users_server_guard on public.forum_users;
create trigger forum_users_server_guard
  before update of server_id, server_set_at on public.forum_users
  for each row execute function public.forum_users_server_guard();

-- ── Шаг 3. Значок у ника: представления обязаны отдать сервер автора ────────

/*
  Копии живых определений, снятых с боевой базы 05.10.2026 (список колонок
  сверян запросом, а не памятью), и в каждой — одна добавка в конце.

  ПОЧЕМУ `create or replace`, а не `drop` + `create`. От `forum_profiles`
  зависят лента, комментарии, чат и список участников чата: база отказала бы
  снимать его без CASCADE, а CASCADE унёс бы за собой представления, которых
  клиент не ждёт. `create or replace view` новые колонки принимает только в
  конец списка — поэтому добавка стоит последним столбцом, а порядок прежних
  колонок сохранён дословно. Права на чтение при таком шаге остаются теми же:
  чат по-прежнему виден только вошедшим, и расширять его доступ этот шаг не
  собирается.
*/

-- Профили: номер входит в публичный набор, как тег альянса и значок проверки.
create or replace view public.forum_profiles
with (security_invoker = off) as
select
  u.id,
  u.nick,
  u.avatar_url,
  u.about,
  u.alliance_tag,
  u.role,
  u.is_blogger,
  u.created_at,
  (select count(*) from public.forum_posts p
     where p.author_id = u.id and p.deleted = false) as post_count,
  (select count(*) from public.forum_comments c
     where c.author_id = u.id and c.deleted = false) as comment_count,
  coalesce((
    select count(*)
      from public.forum_reactions r
      join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received,
  coalesce((
    select sum(p.views)
      from public.forum_posts p
     where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_views,
  coalesce((
    select count(*)
      from public.forum_posts p
     where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_post_count,
  u.is_leader,
  u.last_seen_at,
  coalesce((
    select count(*) from public.forum_profile_likes fl
    where fl.to_user = u.id
  ), 0) as profile_likes,
  coalesce((
    select 1 from public.forum_profile_likes fl
    where fl.to_user = u.id and fl.from_user = auth.uid() limit 1
  ), 0) as i_liked,
  u.is_verified,
  u.verified_at,
  coalesce((
    select count(*)
      from public.forum_posts p
      join public.forum_thanks t
        on t.target_type = 'post' and t.target_id = p.id
     where p.author_id = u.id
  ), 0)
  +
  coalesce((
    select count(*)
      from public.forum_comments c
      join public.forum_thanks t
        on t.target_type = 'comment' and t.target_id = c.id
     where c.author_id = u.id
  ), 0) as thanks_received,
  coalesce((
    select count(*) from public.forum_guides g
     where g.author_id = u.id and g.status = 'published'
       and g.review_status = 'verified'
  ), 0) as verified_guides,
  coalesce((
    select count(*)
      from public.forum_posts p
     where p.author_id = u.id and not p.deleted
       and 'event' = any(p.tags) and p.event_at is not null and p.event_at <= now()
       and exists (select 1 from public.forum_event_rsvps r
                    where r.post_id = p.id and r.status = 'going'
                      and r.user_id <> p.author_id)
  ), 0) as events_held,
  coalesce((
    select sum(g.delta) from public.forum_rep_grants g where g.user_id = u.id
  ), 0) as rep_grants,
  coalesce((
    select count(*) from public.forum_rep_grants g where g.user_id = u.id
  ), 0) as rep_grant_count,
  u.server_id
from public.forum_users u;

-- Лента тем.
create or replace view public.forum_post_list with (security_invoker = on) as
select p.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  (select count(*) from public.forum_comments c where c.post_id=p.id and not c.deleted) as comment_count,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='post' and target_id=p.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='post' and target_id=p.id and user_id=auth.uid()) my_reaction,
  (select r.status from public.forum_event_rsvps r where r.post_id=p.id and r.user_id=auth.uid()) my_rsvp,
  (select r.remind_minutes from public.forum_event_rsvps r where r.post_id=p.id and r.user_id=auth.uid()) my_remind_minutes,
  coalesce((select sum(case reaction when 'like' then 1 when 'dislike' then -1 else 0 end) from public.forum_reactions where target_type='post' and target_id=p.id),0) score,
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'url',a.url) order by a.created_at) from public.forum_attachments a where a.target_type='post' and a.target_id=p.id),'[]'::jsonb) attachments,
  (select jsonb_build_object('id',pl.id,'question',pl.question,'multiple',pl.multiple,'closed',pl.closed,'total',(select count(distinct user_id) from public.forum_poll_votes v where v.poll_id=pl.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text,'votes',(select count(*) from public.forum_poll_votes v where v.option_id=o.id),'mine',exists(select 1 from public.forum_poll_votes v where v.option_id=o.id and v.user_id=auth.uid())) order by o.position,o.id) from public.forum_poll_options o where o.poll_id=pl.id),'[]'::jsonb)) from public.forum_polls pl where pl.post_id=p.id) poll,
  public.forum_thanks_count('post', p.id) as thanks_count,
  exists(select 1 from public.forum_thanks t where t.target_type='post' and t.target_id=p.id and t.giver_id=auth.uid()) i_thanked,
  prof.server_id as author_server
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;

-- Комментарии внутри темы.
create or replace view public.forum_comment_list with (security_invoker = on) as
select c.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='comment' and target_id=c.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='comment' and target_id=c.id and user_id=auth.uid()) my_reaction,
  public.forum_thanks_count('comment', c.id) as thanks_count,
  exists(select 1 from public.forum_thanks t where t.target_type='comment' and t.target_id=c.id and t.giver_id=auth.uid()) i_thanked,
  prof.server_id as author_server
from public.forum_comments c left join public.forum_profiles prof on prof.id=c.author_id;

-- Сообщения чата: там ник стоит рядом с текстом ровно так же, как в ленте.
create or replace view public.forum_chat_message_list
with (security_invoker = on) as
select
  x.*,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  prof.is_leader as author_is_leader,
  prof.is_verified as author_is_verified,
  prof.server_id as author_server
from public.forum_chat_messages x
left join public.forum_profiles prof on prof.id = x.author_id;

-- Кэш схемы API обязан уйти, иначе PostgREST отвечал бы колонками, которых у
-- представления уже нет, и `author_server` не дошёл бы до сайта.
notify pgrst, 'reload schema';
