-- Мультиаренда, шаг 1: у темы появляется сервер.
--
-- ЗАЧЕМ. Сайт всегда обслуживал один игровой сервер — №33, и это число было
-- вписано словами в шапку, в заголовок окна, в текст пушей и в названия
-- разделов. Данные при этом нигде не хранили сервер: у таблиц форума такой
-- колонки не было вовсе, и «для другого сервера» означало «завести второй
-- сайт». Это выбрано и отменено сознательно: копий не будет, сервер становится
-- измерением данных в одной базе.
--
-- ПРАВИЛО ШАГА. Сервер у темы — корень всего остального: ответ, реакция,
-- жалоба, закладка и подписка присоединены к теме, поэтому им колонка не
-- нужна, они наследуют сервер через `post_id`. Отдельная колонка появится там,
-- где запись живёт без темы (заметки пульса, события магазина, заявки на
-- гайды, чаты) — это следующие шаги, и каждый со своей ценой.
--
-- ЧЕГО ЗДЕСЬ НЕТ — И ПОЧЕМУ.
--
-- 1. Прав по серверу. Таблица членства и модератор, отвечающий за один сервер,
--    здесь не заводятся: сегодня все права глобальные, и полумера хуже
--    отсутствия — половина политик смотрела бы на сервер, половина нет. Это
--    отдельный шаг, и он обязан быть следующим, а не «когда-нибудь»: без него
--    второй сервер — только витрина, а не дом со своими правилами.
-- 2. Сервера у ответов. См. «ПРАВИЛО ШАГА»: связь с темой и есть сервер.
-- 3. Права на запись по серверу. Игрок, выбравший в переключателе чужой
--    сервер, напишет туда — сегодня это не тайна и не чужая кухня, а та же
--    публичная лента. Когда появятся членство и модераторы серверов, отказ
--    впишут сюда же, одним файлом.
--
-- ПОРЯДОК ПРОТИВ ОПЕЧАТКИ. Значение по умолчанию — 33, а не пусто. Оно нужно
-- ровно на время между прогоном этой миграции и пушем кода: живая страница
-- ещё не отправляет колонку, и без значения по умолчанию база отверг бы
-- каждую новую тему. Опечатка в числе сервера тоже кончится здесь, а не
-- молчанием: несуществующего сервера в списке нет, и отсылка к нему падает
-- наружной ссылкой.

-- ── Шаг 1. Список серверов ──────────────────────────────────────────────────

create table if not exists public.forum_servers (
  id        integer primary key check (id between 1 and 999),
  title     text not null check (char_length(title) between 1 and 60),
  enabled   boolean not null default true,
  added_at  timestamptz not null default now()
);

comment on table public.forum_servers is
  'Игровые серверы, чьи ленты живёт в этой базе. Один ряд — один сервер: добавляется ряд, а не сайт.';

/*
  Ряд №33 обязателен: на него ссылается значение по умолчанию у тем, и если его
  не будет, миграция не сможет ни заполнить существующие записи, ни принять
  новые. `on conflict do nothing` — файл прогоняют повторно, чтобы убедиться,
  что он идемпотентен, и второй запуск не должен ни ругаться, ни править то,
  что модерация переименовала руками.
*/
insert into public.forum_servers (id, title) values (33, 'Сервер 33')
  on conflict (id) do nothing;

-- Читается гостем тоже: список серверов нужен шапке до всякого входа.
grant select on public.forum_servers to anon, authenticated;
alter table public.forum_servers enable row level security;

drop policy if exists forum_servers_read on public.forum_servers;
create policy forum_servers_read on public.forum_servers
  for select to anon, authenticated
  using (true);

/*
  Политик на запись нет ни одной намеренно: сервер в список добавляет человек
  с доступом к базе (SQL-консоль или будущая панель), а не игрок через сайт.
  Пока права не привязаны к серверу, дать кому-либо писать в этот список
  значило бы позволить любому пустить ленту чужого сервера по своей ссылке.
*/

-- ── Шаг 2. Сервер у темы ───────────────────────────────────────────────────

/*
  Колонка добавляется с NOT NULL и значением по умолчанию: в Postgres 11+ это
  не переписывает таблицу, а существующие темы получают свой настоящий сервер,
  №33. Никакого «неизвестно откуда» здесь нет и быть не может — вся база до
  этого шага и была один сервер.
*/
alter table public.forum_posts add column if not exists server_id integer
  not null default 33;

alter table public.forum_posts drop constraint if exists forum_posts_server_id_fkey;
alter table public.forum_posts add constraint forum_posts_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

/*
  Лента выбирается по серверу, а внутри сервера — по закреплённости и дате, и
  именно в таком порядке колонок нужен индекс: прежний `forum_posts_feed_idx`
  без сервера стал бы для фильтра бесполезен. Старый индекс не убираем: по нему
  работают запросы без условия по серверу (список закреплённых, счётчики).
*/
create index if not exists forum_posts_server_idx
  on public.forum_posts (server_id, pinned desc, created_at desc);

-- ── Шаг 3. Лента обязана увидеть новую колонку ─────────────────────────────

/*
  Копия определения из 20260926-barter-board.sql, дословно и в том же порядке
  колонок. Пересоздаётся представление только затем, чтобы `select p.*`
  развернулся заново и забрал `server_id`: колонки представления фиксируются в
  момент его создания, и старое определение не увидит новую колонку никогда.
  Без этого шага фильтра `?server_id=eq.N` в базе просто не существует, и
  клиент, отправивший такой запрос, получил бы «column does not exist» вместо
  ленты.
*/
drop view if exists public.forum_post_list;
create view public.forum_post_list with (security_invoker = on) as
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
  exists(select 1 from public.forum_thanks t where t.target_type='post' and t.target_id=p.id and t.giver_id=auth.uid()) i_thanked
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;

-- Кэш схемы API не должен держать старое представление: без этого шага
-- PostgREST продолжал бы отвечать колонками, которых у представления больше нет.
notify pgrst, 'reload schema';
