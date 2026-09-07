-- ФОРМАТИРОВАНИЕ, ОПРОСЫ, РЕАКЦИИ ПОИМЁННО, УПОМИНАНИЯ.
--
-- Запускать ПОСЛЕ supabase/profiles.sql.
--
-- ЧТО ДОБАВЛЯЕТ:
--   1. Опросы в постах.
--   2. Список тех, кто поставил реакцию (было только число).
--   3. Уведомления: упоминание @ником, ответ на пост, реакция.
--
-- Форматирование текста базы не касается вовсе: разметка хранится как есть,
-- а разбирается при показе (src/forum/markup.js). Так правила показа можно
-- поменять задним числом — при хранении готового HTML пришлось бы переписывать
-- все старые записи.

-- ── Зависимые представления удаляются первыми ───────────────────────────────
--
-- Лента и комментарии ссылаются на forum_profiles, а ниже они пересобираются
-- с опросами и реакциями. Порядок тот же, что в profiles.sql, и по той же
-- причине: CASCADE снёс бы зависимое молча.

drop view if exists public.forum_post_list;
drop view if exists public.forum_comment_list;

-- ── Опросы ──────────────────────────────────────────────────────────────────
--
-- ПОЧЕМУ ОТДЕЛЬНЫМИ ТАБЛИЦАМИ, А НЕ ПОЛЕМ В ПОСТЕ.
--
-- Можно было положить опрос в jsonb рядом с текстом: и вопрос, и варианты,
-- и голоса. Соблазн понятный — одна колонка вместо трёх таблиц.
--
-- Но голос — это не свойство поста, а связь между человеком и вариантом.
-- В jsonb пришлось бы читать весь опрос, дописывать голос и записывать обратно;
-- два человека, голосующие одновременно, затирали бы друг друга, и заметить
-- это было бы нельзя. Отдельная строка на голос такой возможности не даёт
-- вовсе — этим и отличается база от файла.

create table if not exists public.forum_polls (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null unique references public.forum_posts (id) on delete cascade,
  question   text not null check (char_length(question) between 3 and 200),
  /*
    Можно ли выбрать несколько вариантов. У «кто виноват» ответ один,
    у «когда собираемся» — несколько, и это разные вопросы по сути.
  */
  multiple   boolean not null default false,
  /*
    Закрытый опрос голосов не принимает, но результаты видны. Закрывает автор
    или модерация — сам по себе он не закрывается: срок голосования на форуме
    сообщества чаще мешает, чем помогает.
  */
  closed     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.forum_poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.forum_polls (id) on delete cascade,
  text     text not null check (char_length(text) between 1 and 120),
  -- Порядок вариантов — тоже данные: «за / против / воздержался» не то же,
  -- что «против / за / воздержался».
  position integer not null default 0
);

create index if not exists forum_poll_options_poll_idx
  on public.forum_poll_options (poll_id, position);

/*
  Голос.

  Первичный ключ из трёх полей не даёт проголосовать за один вариант дважды.
  Для опроса с одним ответом этого мало — там нельзя выбрать ДВА РАЗНЫХ
  варианта, и это держит триггер ниже: одним ключом такое правило не выразить.
*/
create table if not exists public.forum_poll_votes (
  poll_id   uuid not null references public.forum_polls (id) on delete cascade,
  option_id uuid not null references public.forum_poll_options (id) on delete cascade,
  user_id   uuid not null references public.forum_users (id) on delete cascade,
  voted_at  timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);

create index if not exists forum_poll_votes_option_idx
  on public.forum_poll_votes (option_id);

-- ── Права на опросы ─────────────────────────────────────────────────────────

alter table public.forum_polls        enable row level security;
alter table public.forum_poll_options enable row level security;
alter table public.forum_poll_votes   enable row level security;

-- Читать может кто угодно: опрос — часть поста, а посты открыты.
drop policy if exists forum_polls_read on public.forum_polls;
create policy forum_polls_read on public.forum_polls for select using (true);

drop policy if exists forum_poll_options_read on public.forum_poll_options;
create policy forum_poll_options_read on public.forum_poll_options for select using (true);

/*
  ГОЛОСА ЧИТАЮТСЯ ВСЕМИ, И ЭТО РЕШЕНИЕ, А НЕ УПУЩЕНИЕ.

  Тайное голосование на форуме сообщества создаёт больше проблем, чем решает:
  «за» без имён невозможно оспорить, и первый же спорный опрос превращается
  в обвинения в накрутке. Открытый список имён снимает вопрос сразу.

  Человек должен об этом знать ДО голосования — поэтому в интерфейсе рядом
  с опросом написано, что голос виден всем.
*/
drop policy if exists forum_poll_votes_read on public.forum_poll_votes;
create policy forum_poll_votes_read on public.forum_poll_votes for select using (true);

-- Опрос создаёт автор поста, вместе с постом.
drop policy if exists forum_polls_insert on public.forum_polls;
create policy forum_polls_insert on public.forum_polls
  for insert with check (
    public.forum_can_write()
    and exists (
      select 1 from public.forum_posts p
       where p.id = post_id and p.author_id = auth.uid()
    )
  );

drop policy if exists forum_poll_options_insert on public.forum_poll_options;
create policy forum_poll_options_insert on public.forum_poll_options
  for insert with check (
    public.forum_can_write()
    and exists (
      select 1 from public.forum_polls pl
        join public.forum_posts p on p.id = pl.post_id
       where pl.id = poll_id and p.author_id = auth.uid()
    )
  );

-- Закрыть опрос: автор или модерация.
drop policy if exists forum_polls_close on public.forum_polls;
create policy forum_polls_close on public.forum_polls
  for update using (
    public.forum_is_staff()
    or exists (
      select 1 from public.forum_posts p
       where p.id = post_id and p.author_id = auth.uid()
    )
  );

drop policy if exists forum_poll_votes_insert on public.forum_poll_votes;
create policy forum_poll_votes_insert on public.forum_poll_votes
  for insert with check (
    user_id = auth.uid()
    and public.forum_can_write()
    -- В закрытый опрос голос не принимается.
    and exists (select 1 from public.forum_polls pl where pl.id = poll_id and pl.closed = false)
  );

-- Свой голос можно снять. Чужой — нет: это подмена результата.
drop policy if exists forum_poll_votes_delete on public.forum_poll_votes;
create policy forum_poll_votes_delete on public.forum_poll_votes
  for delete using (user_id = auth.uid());

-- Автор голоса подставляется базой: подделать нельзя даже запросом мимо сайта.
create or replace function public.forum_set_vote_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists forum_poll_votes_user on public.forum_poll_votes;
create trigger forum_poll_votes_user
  before insert on public.forum_poll_votes
  for each row execute function public.forum_set_vote_user();

/*
  ОДИН ГОЛОС В ОПРОСЕ С ОДНИМ ОТВЕТОМ.

  Первичный ключ запрещает два голоса за ОДИН вариант, но не запрещает голоса
  за разные. Для опроса с multiple = false это дыра: человек отметил бы все
  варианты и получил бы «100% за каждый».

  Проверка в триггере, а не в правиле доступа: правило не видит, сколько
  голосов уже есть у этого человека в этом опросе.
*/
create or replace function public.forum_poll_single_choice()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  allows_multiple boolean;
begin
  select multiple into allows_multiple from public.forum_polls where id = new.poll_id;

  if not allows_multiple and exists (
    select 1 from public.forum_poll_votes
     where poll_id = new.poll_id and user_id = new.user_id
  ) then
    raise exception 'В этом опросе можно выбрать только один вариант';
  end if;

  return new;
end;
$$;

drop trigger if exists forum_poll_single_choice on public.forum_poll_votes;
create trigger forum_poll_single_choice
  before insert on public.forum_poll_votes
  for each row execute function public.forum_poll_single_choice();

/*
  Сколько вариантов в опросе. Два — минимум, чтобы это был выбор; восемь —
  предел, после которого список на телефоне превращается в прокрутку,
  и человек голосует за первое, что видит.
*/
create or replace function public.forum_poll_option_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.forum_poll_options where poll_id = new.poll_id) >= 8 then
    raise exception 'В опросе не больше восьми вариантов';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_poll_option_limit on public.forum_poll_options;
create trigger forum_poll_option_limit
  before insert on public.forum_poll_options
  for each row execute function public.forum_poll_option_limit();

-- ── Кто поставил реакцию ────────────────────────────────────────────────────
--
-- Раньше лента отдавала только числа: «👍 5». Кто именно — не видно, и это
-- порождало вопрос «а кто со мной согласен», на который форум не отвечал.
--
-- Отдельное представление, а не колонка в ленте: список имён на сорок реакций
-- у каждого из двадцати постов — это лишние килобайты в каждом запросе ленты,
-- притом что открывают его редко. Здесь он запрашивается по нажатию.

drop view if exists public.forum_reaction_people;

create view public.forum_reaction_people
with (security_invoker = off) as
select
  r.target_type,
  r.target_id,
  r.reaction,
  r.user_id,
  u.nick,
  u.avatar_url,
  r.created_at
from public.forum_reactions r
join public.forum_users u on u.id = r.user_id;

/*
  security_invoker = off по той же причине, что у forum_profiles: соединение
  с forum_users иначе отдало бы только собственную реакцию — читать профили
  разрешено только свой.

  Полей ровно столько, сколько нужно показать: ник и аватарка. Запретов
  и служебного здесь нет.
*/
grant select on public.forum_reaction_people to anon, authenticated;

-- ── Уведомления ─────────────────────────────────────────────────────────────
--
-- ЗАЧЕМ. Упоминание @ником без уведомления бесполезно: человек узнает о нём,
-- только если случайно откроет тот же пост. Ответ на свой пост — то же самое.
--
-- ПОЧЕМУ УВЕДОМЛЕНИЯ ПИШУТ ТРИГГЕРЫ, А НЕ БРАУЗЕР. Браузер мог бы отправить
-- их после публикации — но если человек закрыл страницу или отвалилась сеть,
-- пост появится, а уведомления не будет. Триггер срабатывает внутри той же
-- операции, что и вставка записи: либо есть и то и другое, либо ничего.

create table if not exists public.forum_notifications (
  id          bigserial primary key,
  -- Кому.
  user_id     uuid not null references public.forum_users (id) on delete cascade,
  -- От кого. Может быть пустым: автора удалили, а уведомление осталось.
  actor_id    uuid references public.forum_users (id) on delete set null,
  actor_nick  text not null default '',
  kind        text not null check (kind in ('mention', 'reply', 'reaction')),
  post_id     uuid references public.forum_posts (id) on delete cascade,
  comment_id  uuid references public.forum_comments (id) on delete cascade,
  -- Кусок текста, чтобы уведомление читалось без перехода.
  preview     text not null default '',
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

/*
  Индекс под главный запрос: «мои непрочитанные, свежие сверху». Без него
  каждое открытие сайта читало бы всю таблицу целиком, а она растёт быстрее
  всех остальных.
*/
create index if not exists forum_notifications_mine_idx
  on public.forum_notifications (user_id, read_at, created_at desc);

alter table public.forum_notifications enable row level security;

/*
  Свои уведомления видит только их получатель — включая модерацию.

  Это единственная таблица, к которой у модерации нет доступа, и это
  осознанно: список «кого упоминали» и «кто на что отвечал» — карта личных
  связей, а не инструмент модерации. Нарушения разбираются по жалобам,
  для этого уведомления не нужны.
*/
drop policy if exists forum_notifications_read on public.forum_notifications;
create policy forum_notifications_read on public.forum_notifications
  for select using (user_id = auth.uid());

-- Отметить прочитанным — только своё.
drop policy if exists forum_notifications_update on public.forum_notifications;
create policy forum_notifications_update on public.forum_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists forum_notifications_delete on public.forum_notifications;
create policy forum_notifications_delete on public.forum_notifications
  for delete using (user_id = auth.uid());

/*
  Писать уведомления нельзя НИКОМУ, даже себе: политики insert здесь нет
  вовсе, поэтому запрос отвергается по умолчанию. Их создают только триггеры
  ниже — они работают правами владельца схемы и правила доступа не проверяют.

  Иначе можно было бы прислать человеку уведомление о том, чего не было.
*/

/**
 * Ники, упомянутые в тексте.
 *
 * Разбор в базе, а не в браузере, потому что уведомления пишет триггер:
 * он должен сам понять, кого упомянули. Дублирование с markup.js осознанное —
 * там разбор для показа, здесь для рассылки, и совпадать они не обязаны:
 * показ прощает лишнее упоминание, рассылка нет.
 */
create or replace function public.forum_mentioned_nicks(body text)
returns text[]
language sql immutable
as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(coalesce(body, ''), '(?:^|[\s(«"''>])@([[:alnum:]_-]{2,24})', 'g') as m;
$$;

/**
 * Уведомления о новом посте: упоминания.
 */
create or replace function public.forum_notify_post()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  nick text;
  target uuid;
begin
  foreach nick in array public.forum_mentioned_nicks(new.title || ' ' || new.body)
  loop
    select id into target from public.forum_users where lower(nick_lower(nick)) = lower(nick_lower(nick)) and lower(forum_users.nick) = lower(nick);

    -- Себя не уведомляем: человек знает, что написал.
    if target is not null and target <> new.author_id then
      insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, post_id, preview)
      values (target, new.author_id, new.author_nick, 'mention', new.id, left(new.title, 120));
    end if;
  end loop;

  return new;
end;
$$;

/**
 * Уведомления о комментарии: автору поста и упомянутым.
 */
create or replace function public.forum_notify_comment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  post_author uuid;
  post_title text;
  nick text;
  target uuid;
  notified uuid[] := '{}';
begin
  select author_id, title into post_author, post_title
    from public.forum_posts where id = new.post_id;

  -- Автору поста: ответ на его запись.
  if post_author is not null and post_author <> new.author_id then
    insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, post_id, comment_id, preview)
    values (post_author, new.author_id, new.author_nick, 'reply', new.post_id, new.id, left(new.body, 120));
    notified := array_append(notified, post_author);
  end if;

  -- Упомянутым в комментарии.
  foreach nick in array public.forum_mentioned_nicks(new.body)
  loop
    select id into target from public.forum_users where lower(forum_users.nick) = lower(nick);

    /*
      Одно уведомление на человека за одно действие. Без этого автор поста,
      которого ещё и упомянули в комментарии, получил бы два — и решил бы,
      что сайт двоит.
    */
    if target is not null and target <> new.author_id and not (target = any(notified)) then
      insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, post_id, comment_id, preview)
      values (target, new.author_id, new.author_nick, 'mention', new.post_id, new.id, left(new.body, 120));
      notified := array_append(notified, target);
    end if;
  end loop;

  return new;
end;
$$;

/**
 * Уведомление о реакции — автору записи.
 *
 * Только о согласии и несогласии: смайлики шлют десятками, и уведомление
 * о каждом превратило бы список в шум, из которого не видно важного.
 */
create or replace function public.forum_notify_reaction()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target uuid;
  actor text;
  parent_post uuid;
  snippet text;
begin
  if new.reaction not in ('like', 'dislike') then
    return new;
  end if;

  if new.target_type = 'post' then
    select author_id, id, left(title, 120) into target, parent_post, snippet
      from public.forum_posts where id = new.target_id;
  else
    select c.author_id, c.post_id, left(c.body, 120) into target, parent_post, snippet
      from public.forum_comments c where c.id = new.target_id;
  end if;

  if target is null or target = new.user_id then
    return new;
  end if;

  select nick into actor from public.forum_users where id = new.user_id;

  insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, post_id, comment_id, preview)
  values (
    target, new.user_id, coalesce(actor, ''), 'reaction', parent_post,
    case when new.target_type = 'comment' then new.target_id else null end,
    snippet
  );

  return new;
end;
$$;

drop trigger if exists forum_notify_post on public.forum_posts;
create trigger forum_notify_post
  after insert on public.forum_posts
  for each row execute function public.forum_notify_post();

drop trigger if exists forum_notify_comment on public.forum_comments;
create trigger forum_notify_comment
  after insert on public.forum_comments
  for each row execute function public.forum_notify_comment();

drop trigger if exists forum_notify_reaction on public.forum_reactions;
create trigger forum_notify_reaction
  after insert on public.forum_reactions
  for each row execute function public.forum_notify_reaction();

-- ── Лента с опросами ────────────────────────────────────────────────────────

create view public.forum_post_list
with (security_invoker = on) as
select
  p.id,
  p.author_id,
  p.author_nick,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  p.category,
  p.title,
  p.body,
  p.created_at,
  p.edited_at,
  p.pinned,
  p.deleted,
  p.deleted_reason,
  (select count(*) from public.forum_comments c
     where c.post_id = p.id and c.deleted = false) as comment_count,
  coalesce(
    (select jsonb_object_agg(r.reaction, r.n)
       from (select reaction, count(*) as n
               from public.forum_reactions
              where target_type = 'post' and target_id = p.id
              group by reaction) r),
    '{}'::jsonb
  ) as reactions,
  (select reaction from public.forum_reactions
    where target_type = 'post' and target_id = p.id and user_id = auth.uid()) as my_reaction,
  coalesce(
    (select sum(case reaction when 'like' then 1 when 'dislike' then -1 else 0 end)
       from public.forum_reactions
      where target_type = 'post' and target_id = p.id),
    0
  ) as score,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'url', a.url) order by a.created_at)
      from public.forum_attachments a
     where a.target_type = 'post' and a.target_id = p.id
  ), '[]'::jsonb) as attachments,
  /*
    Опрос приходит вместе с постом одним объектом: варианты, число голосов
    и что выбрал я. Отдельный запрос на каждый пост означал бы двадцать
    запросов на ленту.

    Голоса считаются здесь, а не хранятся числом: хранимый счётчик разошёлся
    бы с правдой при первом же снятом голосе, и разошёлся бы молча.
  */
  (
    select jsonb_build_object(
      'id', pl.id,
      'question', pl.question,
      'multiple', pl.multiple,
      'closed', pl.closed,
      'total', (select count(distinct user_id) from public.forum_poll_votes v where v.poll_id = pl.id),
      'options', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', o.id,
          'text', o.text,
          'votes', (select count(*) from public.forum_poll_votes v where v.option_id = o.id),
          'mine', exists (
            select 1 from public.forum_poll_votes v
             where v.option_id = o.id and v.user_id = auth.uid()
          )
        ) order by o.position, o.id)
          from public.forum_poll_options o where o.poll_id = pl.id
      ), '[]'::jsonb)
    )
      from public.forum_polls pl where pl.post_id = p.id
  ) as poll
from public.forum_posts p
left join public.forum_profiles prof on prof.id = p.author_id;

create view public.forum_comment_list
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.author_id,
  c.author_nick,
  prof.avatar_url as author_avatar,
  prof.role as author_role,
  c.body,
  c.created_at,
  c.deleted,
  c.deleted_reason,
  coalesce(
    (select jsonb_object_agg(r.reaction, r.n)
       from (select reaction, count(*) as n
               from public.forum_reactions
              where target_type = 'comment' and target_id = c.id
              group by reaction) r),
    '{}'::jsonb
  ) as reactions,
  (select reaction from public.forum_reactions
    where target_type = 'comment' and target_id = c.id and user_id = auth.uid()) as my_reaction,
  coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'url', a.url) order by a.created_at)
      from public.forum_attachments a
     where a.target_type = 'comment' and a.target_id = c.id
  ), '[]'::jsonb) as attachments
from public.forum_comments c
left join public.forum_profiles prof on prof.id = c.author_id;

-- ── Жалобы с родительским постом ────────────────────────────────────────────
--
-- Панель модерации показывает для каждой жалобы ссылку «Открыть на сайте».
-- Для жалобы на комментарий ссылка должна вести в пост, где тот сидит, — вот
-- target_post_id: для поста это сама цель, для комментария — родительский пост.
-- Без этого ссылка приводила на пустую страницу.

drop view if exists public.forum_report_list;

create view public.forum_report_list
with (security_invoker = on) as
select
  r.id,
  r.target_type,
  r.target_id,
  r.reporter_id,
  reporter.nick as reporter_nick,
  r.rule_id,
  r.note,
  r.created_at,
  r.resolved,
  case r.target_type
    when 'post' then (select title from public.forum_posts where id = r.target_id)
    else ''
  end as target_title,
  case r.target_type
    when 'post' then (select left(body, 400) from public.forum_posts where id = r.target_id)
    else (select left(body, 400) from public.forum_comments where id = r.target_id)
  end as target_body,
  case r.target_type
    when 'post' then (select author_nick from public.forum_posts where id = r.target_id)
    else (select author_nick from public.forum_comments where id = r.target_id)
  end as target_author_nick,
  case r.target_type
    when 'post' then r.target_id
    else (select post_id from public.forum_comments where id = r.target_id)
  end as target_post_id
from public.forum_reports r
join public.forum_users reporter on reporter.id = r.reporter_id;

-- ── Раздел «Флудилка» и предел картинок: правки поверх старой базы ───────────
--
-- Два блока ниже ИДЕМПОТЕНТНЫ: их можно запускать повторно сколько угодно
-- раз. Они не пересоздают то, что делает schema.sql / profiles.sql при чистой
-- установке, а доводят ЖИВУЮ базу, где те уже отработали, до новой версии:
--   * разделу «Флудилка» нужно расширенное ограничение на category;
--   * лимиту картинок — триггер с новым числом и текстом.
--
-- Если база ставится с нуля (schema.sql + profiles.sql из текущего каталога),
-- эти блоки тоже безопасны: drop … if exists ничего не сломает, create
-- … or replace просто перезапишет функцию той же версии.

-- Ограничение раздела в живом столбце называется по-накатанному —
-- forum_posts_category_check. Снимаем старое и навешиваем то же имя
-- с флудилкой в списке: имя не меняется, значит не меняется и всё,
-- что на него ссылается.
alter table public.forum_posts
  drop constraint if exists forum_posts_category_check;

alter table public.forum_posts
  add constraint forum_posts_category_check
  check (category in ('news','vs','chronicle','ally','help','offtop','flood'));

-- Лимит картинок. В живой базе старая функция была поставлена с «не больше
-- четырёх»; теперь число одно на проект и повторяет config.js.
create or replace function public.forum_attachment_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (
    select count(*) from public.forum_attachments
     where target_type = new.target_type and target_id = new.target_id
  ) >= 12 then
    raise exception 'К одной записи можно приложить не больше двенадцати картинок';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_attachments_limit on public.forum_attachments;
create trigger forum_attachments_limit
  before insert on public.forum_attachments
  for each row execute function public.forum_attachment_limit();
