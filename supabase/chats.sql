-- ЗАКРЫТЫЕ ЧАТЫ: АЛЬЯНСОВЫЕ И МЕЖАЛЬЯНСОВЫЕ.
--
-- Запускать ПОСЛЕ supabase/rich-forum.sql. Повторный запуск безопасен.
--
-- ЗАЧЕМ. Альянсы сервера переписываются в ВК, Телеграме и Максе — в трёх
-- местах сразу, и половина людей не видит половины разговоров. Чат на сайте
-- даёт одно место, привязанное к тем же никам, что и форум.
--
-- КТО СОЗДАЁТ. Только лидер альянса (отметка is_leader у профиля) и
-- модерация. Отметку выдаёт владелец в панели — это не роль и не право
-- на сайт, а именно «доверенное лицо своего альянса». Без этого ограничения
-- чаты плодятся быстрее, чем в них появляются люди.
--
-- КТО ВИДИТ. Только участники чата и модерация. Модерация видит всё
-- намеренно и открыто: об этом написано у входа в чат. Закрытый от всех
-- чат на сайте, за который отвечает конкретный человек, невозможен —
-- жалобу на сообщение должен разбирать кто-то, кто его видит.
--
-- КАК ВСТУПАЮТ. По коду приглашения: лидер даёт ссылку, человек нажимает
-- «войти». Списков «все с тегом альянса автоматически» нет: тег в профиле
-- пишет сам игрок, и любой поставил бы себе чужой.
--
-- ПРЕДЕЛ. 200 человек в чате — держит триггер, а не сайт.

-- ── Статус лидера ───────────────────────────────────────────────────────────

alter table public.forum_users
  add column if not exists is_leader boolean not null default false;

-- Публичный профиль показывает отметку лидера: у имени в чате и на странице.
--
-- ВАЖНО: без drop. Postgres позволяет create or replace view, только если
-- новые колонки добавлены в конец, — так и сделано. Drop уронил бы каскадом
-- forum_post_list и forum_comment_list, и лента стала бы пустой.
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
  /*
    Сколько согласий собрали его посты. Считается по реакциям, а не хранится
    числом: хранимый счётчик разошёлся бы с правдой при первом же удалении
    реакции, и разошёлся бы молча.
  */
  coalesce((
    select count(*)
      from public.forum_reactions r
      join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received,
  /*
    Счётчики блога. Просмотры — сумма views записей, помеченных разделом blog:
    это «сколько раз открыли что-то в блоге». Число постов — отдельно,
    чтобы участник видел размер своего блога, не считая чужие записи.
  */
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
  -- Лидер альянса: новая колонка В КОНЦЕ, поэтому create or replace
  -- проходит без drop — зависимые лента и комментарии остаются целы.
  u.is_leader
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

-- ── Таблицы ─────────────────────────────────────────────────────────────────

create table if not exists public.forum_chats (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  -- alliance — один альянс; inter — несколько альянсов (лидеры приводят своих).
  kind           text not null default 'alliance' check (kind in ('alliance', 'inter')),
  alliance_tag   text not null default '',
  owner_id       uuid references public.forum_users (id) on delete set null,
  owner_nick     text not null default '',
  -- Код приглашения. Короткий, чтобы диктовался голосом в игре.
  invite_code    text not null unique default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  max_members    int  not null default 200 check (max_members between 2 and 200),
  closed         boolean not null default false,
  closed_reason  text not null default '',
  created_at     timestamptz not null default now()
);

create table if not exists public.forum_chat_members (
  chat_id      uuid not null references public.forum_chats (id) on delete cascade,
  user_id      uuid not null references public.forum_users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.forum_chat_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references public.forum_chats (id) on delete cascade,
  author_id      uuid references public.forum_users (id) on delete set null,
  author_nick    text not null default '',
  body           text not null,
  deleted        boolean not null default false,
  deleted_reason text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists forum_chat_messages_chat_time
  on public.forum_chat_messages (chat_id, created_at desc);
create index if not exists forum_chat_members_user
  on public.forum_chat_members (user_id);

alter table public.forum_chats          enable row level security;
alter table public.forum_chat_members   enable row level security;
alter table public.forum_chat_messages  enable row level security;

-- ── Помощники для политик ───────────────────────────────────────────────────
--
-- security definer: политика на членах чата не может смотреть в ту же
-- таблицу своими правами — получится рекурсия.

create or replace function public.forum_is_leader()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid() and (is_leader = true or role in ('admin', 'moderator'))
  );
$$;

create or replace function public.forum_chat_member(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_chat_members
    where chat_id = target and user_id = auth.uid()
  );
$$;

create or replace function public.forum_chat_manager(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_chat_members
    where chat_id = target and user_id = auth.uid() and role in ('owner', 'admin')
  ) or public.forum_is_staff();
$$;

-- ── Политики: чаты ──────────────────────────────────────────────────────────

drop policy if exists forum_chats_read on public.forum_chats;
create policy forum_chats_read on public.forum_chats
  for select using (public.forum_chat_member(id) or public.forum_is_staff());

drop policy if exists forum_chats_insert on public.forum_chats;
create policy forum_chats_insert on public.forum_chats
  for insert with check (public.forum_is_leader() and public.forum_can_write());

drop policy if exists forum_chats_update on public.forum_chats;
create policy forum_chats_update on public.forum_chats
  for update using (public.forum_chat_manager(id))
  with check (public.forum_chat_manager(id));

drop policy if exists forum_chats_delete on public.forum_chats;
create policy forum_chats_delete on public.forum_chats
  for delete using (public.forum_is_staff());

-- Создатель становится владельцем чата автоматически: одной транзакцией,
-- иначе чат мог бы остаться без единого участника.
create or replace function public.forum_chat_on_create()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
    select nick into new.owner_nick from public.forum_users where id = auth.uid();
  end if;
  new.title := left(btrim(new.title), 60);
  if char_length(new.title) < 2 then
    raise exception 'Название чата короче двух символов';
  end if;
  new.alliance_tag := left(btrim(new.alliance_tag), 12);
  return new;
end;
$$;

drop trigger if exists forum_chat_on_create on public.forum_chats;
create trigger forum_chat_on_create
  before insert on public.forum_chats
  for each row execute function public.forum_chat_on_create();

create or replace function public.forum_chat_after_create()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.forum_chat_members (chat_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_after_create on public.forum_chats;
create trigger forum_chat_after_create
  after insert on public.forum_chats
  for each row execute function public.forum_chat_after_create();

-- Что можно менять после создания: название, тег, закрытие. Владелец
-- и код приглашения не меняются запросом — код пересоздаёт отдельная функция.
create or replace function public.forum_chat_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.owner_id := old.owner_id;
  new.owner_nick := old.owner_nick;
  new.created_at := old.created_at;
  new.kind := old.kind;
  new.title := left(btrim(new.title), 60);
  if new.closed and not old.closed and not public.forum_is_staff()
     and not exists (select 1 from public.forum_chat_members
                     where chat_id = old.id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Закрыть чат может владелец чата или модерация';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_guard on public.forum_chats;
create trigger forum_chat_guard
  before update on public.forum_chats
  for each row execute function public.forum_chat_guard();

-- ── Политики: участники ─────────────────────────────────────────────────────

drop policy if exists forum_chat_members_read on public.forum_chat_members;
create policy forum_chat_members_read on public.forum_chat_members
  for select using (public.forum_chat_member(chat_id) or public.forum_is_staff());

-- Вступление идёт через forum_chat_join(code) — прямой insert закрыт,
-- иначе код приглашения ничего бы не значил.
drop policy if exists forum_chat_members_insert on public.forum_chat_members;
create policy forum_chat_members_insert on public.forum_chat_members
  for insert with check (public.forum_is_staff());

-- Роль участника меняет управляющий чатом; own last_read_at — сам участник.
drop policy if exists forum_chat_members_update on public.forum_chat_members;
create policy forum_chat_members_update on public.forum_chat_members
  for update using (user_id = auth.uid() or public.forum_chat_manager(chat_id))
  with check (user_id = auth.uid() or public.forum_chat_manager(chat_id));

-- Выйти может каждый сам; выгнать — управляющий.
drop policy if exists forum_chat_members_delete on public.forum_chat_members;
create policy forum_chat_members_delete on public.forum_chat_members
  for delete using (user_id = auth.uid() or public.forum_chat_manager(chat_id));

create or replace function public.forum_chat_members_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  is_mgr boolean;
begin
  if auth.uid() is null then return new; end if;
  is_mgr := public.forum_chat_manager(old.chat_id);
  -- Обычный участник может менять только свою отметку прочтения.
  if not is_mgr then
    new.role := old.role;
  end if;
  -- Владельца чата не разжаловать и не выгнать никому, кроме модерации.
  if old.role = 'owner' and not public.forum_is_staff() then
    new.role := 'owner';
  end if;
  new.chat_id := old.chat_id;
  new.user_id := old.user_id;
  new.joined_at := old.joined_at;
  return new;
end;
$$;

drop trigger if exists forum_chat_members_guard on public.forum_chat_members;
create trigger forum_chat_members_guard
  before update on public.forum_chat_members
  for each row execute function public.forum_chat_members_guard();

create or replace function public.forum_chat_members_no_kick_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return old; end if;
  if old.role = 'owner' and old.user_id <> auth.uid() and not public.forum_is_staff() then
    raise exception 'Владельца чата выгнать нельзя';
  end if;
  return old;
end;
$$;

drop trigger if exists forum_chat_members_no_kick_owner on public.forum_chat_members;
create trigger forum_chat_members_no_kick_owner
  before delete on public.forum_chat_members
  for each row execute function public.forum_chat_members_no_kick_owner();

-- Предел участников: держит база.
create or replace function public.forum_chat_member_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  n int;
  cap int;
begin
  select count(*) into n from public.forum_chat_members where chat_id = new.chat_id;
  select max_members into cap from public.forum_chats where id = new.chat_id;
  if n >= coalesce(cap, 200) then
    raise exception 'В чате уже % участников — это предел', cap;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_member_limit on public.forum_chat_members;
create trigger forum_chat_member_limit
  before insert on public.forum_chat_members
  for each row execute function public.forum_chat_member_limit();

-- ── Вступление по коду ──────────────────────────────────────────────────────

create or replace function public.forum_chat_join(code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target public.forum_chats%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;
  if not public.forum_can_write() then
    raise exception 'Вам запрещено писать, поэтому и в чаты входить нельзя';
  end if;
  select * into target from public.forum_chats where invite_code = lower(btrim(code));
  if target.id is null then
    raise exception 'Такого приглашения нет — проверьте код';
  end if;
  if target.closed then
    raise exception 'Чат закрыт: %', coalesce(nullif(target.closed_reason, ''), 'без объяснения');
  end if;
  insert into public.forum_chat_members (chat_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict (chat_id, user_id) do nothing;
  return target.id;
end;
$$;

revoke all on function public.forum_chat_join(text) from public, anon;
grant execute on function public.forum_chat_join(text) to authenticated;

-- Новый код приглашения: старая ссылка перестаёт работать.
create or replace function public.forum_chat_rotate_code(target uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  fresh text;
begin
  if not public.forum_chat_manager(target) then
    raise exception 'Код меняет владелец чата или его помощник';
  end if;
  fresh := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update public.forum_chats set invite_code = fresh where id = target;
  return fresh;
end;
$$;

revoke all on function public.forum_chat_rotate_code(uuid) from public, anon;
grant execute on function public.forum_chat_rotate_code(uuid) to authenticated;

-- ── Политики: сообщения ─────────────────────────────────────────────────────

drop policy if exists forum_chat_messages_read on public.forum_chat_messages;
create policy forum_chat_messages_read on public.forum_chat_messages
  for select using (public.forum_chat_member(chat_id) or public.forum_is_staff());

drop policy if exists forum_chat_messages_insert on public.forum_chat_messages;
create policy forum_chat_messages_insert on public.forum_chat_messages
  for insert with check (
    public.forum_chat_member(chat_id)
    and public.forum_can_write()
    and not exists (select 1 from public.forum_chats c where c.id = chat_id and c.closed)
  );

-- Удаление мягкое, как у постов: сообщение остаётся заглушкой с причиной.
drop policy if exists forum_chat_messages_update on public.forum_chat_messages;
create policy forum_chat_messages_update on public.forum_chat_messages
  for update using (author_id = auth.uid() or public.forum_chat_manager(chat_id))
  with check (author_id = auth.uid() or public.forum_chat_manager(chat_id));

create or replace function public.forum_chat_message_set_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select nick into new.author_nick from public.forum_users where id = auth.uid();
  end if;
  new.body := left(new.body, 2000);
  if char_length(btrim(new.body)) = 0 then
    raise exception 'Пустое сообщение';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_message_set_author on public.forum_chat_messages;
create trigger forum_chat_message_set_author
  before insert on public.forum_chat_messages
  for each row execute function public.forum_chat_message_set_author();

create or replace function public.forum_chat_message_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.author_id := old.author_id;
  new.author_nick := old.author_nick;
  new.chat_id := old.chat_id;
  new.created_at := old.created_at;
  -- Правки текста нет: чат это разговор, сказанное сказано. Меняется только
  -- флаг удаления и причина.
  new.body := old.body;
  if old.deleted then
    new.deleted := true;
    new.deleted_reason := old.deleted_reason;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_message_guard on public.forum_chat_messages;
create trigger forum_chat_message_guard
  before update on public.forum_chat_messages
  for each row execute function public.forum_chat_message_guard();

-- ── Представления ───────────────────────────────────────────────────────────
--
-- Список чатов со счётчиками — одним запросом, как forum_post_list.
-- security_invoker = on: строки отбирают политики таблиц, представление
-- только досчитывает.

drop view if exists public.forum_chat_list;
create view public.forum_chat_list
with (security_invoker = on) as
select
  c.*,
  (select count(*) from public.forum_chat_members m where m.chat_id = c.id) as member_count,
  (select m.role from public.forum_chat_members m
     where m.chat_id = c.id and m.user_id = auth.uid()) as my_role,
  (select m.last_read_at from public.forum_chat_members m
     where m.chat_id = c.id and m.user_id = auth.uid()) as my_last_read_at,
  (select count(*) from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
       and x.created_at > coalesce(
         (select m.last_read_at from public.forum_chat_members m
            where m.chat_id = c.id and m.user_id = auth.uid()), 'epoch'::timestamptz)
       and x.author_id is distinct from auth.uid()) as unread_count,
  (select x.body from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_body,
  (select x.author_nick from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_nick,
  (select x.created_at from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_at
from public.forum_chats c;

grant select on public.forum_chat_list to authenticated;

drop view if exists public.forum_chat_message_list;
create view public.forum_chat_message_list
with (security_invoker = on) as
select
  x.*,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  prof.is_leader as author_is_leader
from public.forum_chat_messages x
left join public.forum_profiles prof on prof.id = x.author_id;

grant select on public.forum_chat_message_list to authenticated;

drop view if exists public.forum_chat_member_list;
create view public.forum_chat_member_list
with (security_invoker = on) as
select
  m.*,
  prof.nick,
  prof.avatar_url,
  prof.alliance_tag,
  prof.is_leader
from public.forum_chat_members m
join public.forum_profiles prof on prof.id = m.user_id;

grant select on public.forum_chat_member_list to authenticated;

grant select, insert, update, delete on public.forum_chats to authenticated;
grant select, insert, update, delete on public.forum_chat_members to authenticated;
grant select, insert, update on public.forum_chat_messages to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- ЧАСТЬ ВТОРАЯ: ВЛОЖЕНИЯ, ОТВЕТЫ, РЕАКЦИИ, ЗАКРЕПЛЁННОЕ, «ПИШЕТ…»
-- ════════════════════════════════════════════════════════════════════════════
--
-- Запускать тем же файлом, что и первую часть: он рассчитан на повторный
-- запуск («create or replace», «if not exists»), и всё, что ниже, добавится
-- к уже работающей базе без потери переписки.
--
-- ЗАЧЕМ ЭТО. Первая версия чата была перепиской текстом, и на живом сервере
-- так не вышло: в альянсовом чате кидают скриншот разведки, запись замеса
-- и файл со списком состава — и всё это уезжало в мессенджеры, то есть ровно
-- туда, откуда чат должен был забрать разговор.

-- ── Что нового в самих чатах ────────────────────────────────────────────────

alter table public.forum_chats
  add column if not exists topic text not null default '';

alter table public.forum_chats
  add column if not exists avatar_url text not null default '';

/*
  Название и тема приводятся к одному виду здесь, а не только в браузере:
  через REST можно записать что угодно, и «тема» длиной в роман, растянутая
  над лентой, — это не безобидная шалость.
*/
create or replace function public.forum_chat_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  new.owner_id := old.owner_id;
  new.owner_nick := old.owner_nick;
  new.created_at := old.created_at;
  new.kind := old.kind;
  new.title := left(btrim(new.title), 60);
  new.topic := left(btrim(coalesce(new.topic, '')), 140);
  if coalesce(new.avatar_url, '') <> '' and new.avatar_url !~* '^https?://' then
    new.avatar_url := old.avatar_url;
  end if;
  if new.closed and not old.closed and not public.forum_is_staff()
     and not exists (select 1 from public.forum_chat_members
                     where chat_id = old.id and user_id = auth.uid() and role = 'owner') then
    raise exception 'Закрыть чат может владелец чата или модерация';
  end if;
  return new;
end;
$$;

-- ── Новые колонки сообщений ─────────────────────────────────────────────────

alter table public.forum_chat_messages
  add column if not exists reply_to_id uuid references public.forum_chat_messages (id) on delete set null;

alter table public.forum_chat_messages
  add column if not exists pinned boolean not null default false;

alter table public.forum_chat_messages
  add column if not exists pinned_at timestamptz;

/*
  ЧЕРНОВИК ВЛОЖЕНИЙ.

  Колонка-посылка: браузер кладёт в неё список уже загруженных файлов, а
  триггер ниже разбирает его на строки в forum_chat_attachments и обнуляет.

  Зачем так, а не двумя запросами с сайта. PostgREST не умеет вставку
  «родитель и дети одним запросом», а два запроса дают окно, в котором
  сообщение уже видно, а файлов в нём ещё нет. Здесь же сообщение и его
  вложения появляются одной транзакцией — либо всё, либо ничего.

  Колонка живёт один INSERT: на UPDATE триггер принудительно ставит пустой
  список, поэтому через неё нельзя ни переписать вложения, ни дописать чужие.
*/
alter table public.forum_chat_messages
  add column if not exists draft_attachments jsonb not null default '[]'::jsonb;

create index if not exists forum_chat_messages_pinned
  on public.forum_chat_messages (chat_id)
  where pinned and not deleted;

-- ── Вложения ────────────────────────────────────────────────────────────────

create table if not exists public.forum_chat_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.forum_chat_messages (id) on delete cascade,
  chat_id      uuid not null references public.forum_chats (id) on delete cascade,
  uploader_id  uuid references public.forum_users (id) on delete set null,
  kind         text not null check (kind in ('image', 'video', 'audio', 'file')),
  url          text not null,
  storage_path text not null default '',
  name         text not null default '',
  mime         text not null default '',
  size_bytes   bigint not null default 0,
  width        int not null default 0,
  height       int not null default 0,
  duration_ms  int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists forum_chat_attachments_message
  on public.forum_chat_attachments (message_id);
create index if not exists forum_chat_attachments_chat
  on public.forum_chat_attachments (chat_id);

alter table public.forum_chat_attachments enable row level security;

/*
  Строки вложений пишет ТОЛЬКО триггер (security definer): политик на insert
  и update нет вовсе. Иначе через REST можно было бы привязать к чужому
  сообщению свою ссылку, а это уже подделка переписки.
*/
drop policy if exists forum_chat_attachments_read on public.forum_chat_attachments;
create policy forum_chat_attachments_read on public.forum_chat_attachments
  for select using (public.forum_chat_member(chat_id) or public.forum_is_staff());

-- Удалять может тот, кто загрузил, и управляющий чатом: этим сайт убирает
-- файлы, когда сообщение удаляют, чтобы место в хранилище не пропадало.
drop policy if exists forum_chat_attachments_delete on public.forum_chat_attachments;
create policy forum_chat_attachments_delete on public.forum_chat_attachments
  for delete using (uploader_id = auth.uid() or public.forum_chat_manager(chat_id));

create or replace function public.forum_chat_attachment_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  select count(*) into n from public.forum_chat_attachments where message_id = new.message_id;
  if n >= 10 then
    raise exception 'К одному сообщению можно приложить не больше десяти файлов';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_attachment_limit on public.forum_chat_attachments;
create trigger forum_chat_attachment_limit
  before insert on public.forum_chat_attachments
  for each row execute function public.forum_chat_attachment_limit();

-- ── Реакции ─────────────────────────────────────────────────────────────────

create table if not exists public.forum_chat_reactions (
  message_id uuid not null references public.forum_chat_messages (id) on delete cascade,
  user_id    uuid not null references public.forum_users (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists forum_chat_reactions_message
  on public.forum_chat_reactions (message_id);

alter table public.forum_chat_reactions enable row level security;

/*
  Сообщение → чат. Нужно политикам: у реакции нет своего chat_id, а спросить
  «мой ли это чат» можно только по сообщению. Функция security definer,
  иначе политика на реакциях читала бы таблицу сообщений своими правами
  и упёрлась бы в рекурсию.
*/
create or replace function public.forum_chat_of_message(target uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select chat_id from public.forum_chat_messages where id = target;
$$;

drop policy if exists forum_chat_reactions_read on public.forum_chat_reactions;
create policy forum_chat_reactions_read on public.forum_chat_reactions
  for select using (
    public.forum_chat_member(public.forum_chat_of_message(message_id)) or public.forum_is_staff()
  );

drop policy if exists forum_chat_reactions_insert on public.forum_chat_reactions;
create policy forum_chat_reactions_insert on public.forum_chat_reactions
  for insert with check (
    user_id = auth.uid()
    and public.forum_chat_member(public.forum_chat_of_message(message_id))
    and public.forum_can_write()
  );

-- Снять свою реакцию может каждый; чужую — управляющий чатом (например,
-- если реакцией прикрывают удалённое сообщение).
drop policy if exists forum_chat_reactions_delete on public.forum_chat_reactions;
create policy forum_chat_reactions_delete on public.forum_chat_reactions
  for delete using (
    user_id = auth.uid() or public.forum_chat_manager(public.forum_chat_of_message(message_id))
  );

/*
  Список допустимых реакций.

  Он же лежит в src/forum/rules.js (CHAT_REACTIONS) — браузер подсказывает,
  база охраняет. Проверка обязательна: без неё «реакцией» можно прислать
  произвольную строку, а её потом показывать всем в подсказке.
*/
create or replace function public.forum_chat_reaction_ok()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.emoji not in ('👍', '❤️', '🔥', '😂', '😮', '😢', '🫡', '👏') then
    raise exception 'Такой реакции в чате нет';
  end if;
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_reaction_ok on public.forum_chat_reactions;
create trigger forum_chat_reaction_ok
  before insert on public.forum_chat_reactions
  for each row execute function public.forum_chat_reaction_ok();

-- ── «Пишет…» ────────────────────────────────────────────────────────────────

/*
  Отметки о наборе текста. Это СОСТОЯНИЕ, а не запись: строка живёт секунды
  и гаснет сама. Поэтому истории у таблицы нет, а просроченное вычищается
  здесь же, при каждой новой отметке, — отдельная служба уборки не нужна.

  Политик на insert нет: писать можно только функцией ниже. Так к таблице
  не подобраться в обход проверки «ты вообще в этом чате?».
*/
create table if not exists public.forum_chat_typing (
  chat_id uuid not null references public.forum_chats (id) on delete cascade,
  user_id uuid not null references public.forum_users (id) on delete cascade,
  nick    text not null default '',
  at      timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create index if not exists forum_chat_typing_fresh
  on public.forum_chat_typing (chat_id, at desc);

alter table public.forum_chat_typing enable row level security;

drop policy if exists forum_chat_typing_read on public.forum_chat_typing;
create policy forum_chat_typing_read on public.forum_chat_typing
  for select using (public.forum_chat_member(chat_id) or public.forum_is_staff());

create or replace function public.forum_chat_typing_touch(target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if not public.forum_chat_member(target) then return; end if;

  insert into public.forum_chat_typing (chat_id, user_id, nick, at)
  values (
    target,
    auth.uid(),
    coalesce((select nick from public.forum_users where id = auth.uid()), ''),
    now()
  )
  on conflict (chat_id, user_id) do update set at = now(), nick = excluded.nick;

  -- Просроченное убираем здесь же: отметки живут секунды, и копить их незачем.
  delete from public.forum_chat_typing
   where chat_id = target and at < now() - interval '1 minute';
end;
$$;

revoke all on function public.forum_chat_typing_touch(uuid) from public, anon;
grant execute on function public.forum_chat_typing_touch(uuid) to authenticated;

-- ── Приём сообщения с вложениями ────────────────────────────────────────────

/*
  Этот триггер ЗАМЕНЯЕТ прежнюю версию из первой части: теперь сообщение
  может быть пустым по тексту, если к нему приложены файлы (картинку часто
  посылают без подписи), и он же проверяет черновик вложений.
*/
create or replace function public.forum_chat_message_set_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  files jsonb := coalesce(new.draft_attachments, '[]'::jsonb);
  count_files int := jsonb_array_length(coalesce(new.draft_attachments, '[]'::jsonb));
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select nick into new.author_nick from public.forum_users where id = auth.uid();
  end if;

  if jsonb_typeof(files) <> 'array' then
    raise exception 'Вложения должны быть списком';
  end if;

  new.body := left(coalesce(new.body, ''), 2000);
  if count_files = 0 and char_length(btrim(new.body)) = 0 then
    raise exception 'Пустое сообщение';
  end if;
  if count_files > 10 then
    raise exception 'К одному сообщению можно приложить не больше десяти файлов';
  end if;

  /*
    Файл обязан лежать в папке ЭТОГО чата и быть загруженным ЭТИМ человеком:
    путь в хранилище начинается с chat/<чат>/<кто>/. Без проверки через
    колонку-черновик можно было бы сослаться на чужой файл или на файл
    из другого чата — то есть показать закрытую переписку.
  */
  if count_files > 0 then
    if exists (
      select 1
        from jsonb_to_recordset(files)
          as f(kind text, url text, storage_path text, size_bytes bigint)
       where f.kind not in ('image', 'video', 'audio', 'file')
          or f.url !~* '^https?://'
          /*
            Потолок веса в базе — самый большой предел из CONFIG.forum.chat,
            то есть видео (25 МБ). Разбираться, картинка это или голосовое,
            здесь не нужно: в браузере предел для каждого вида свой, а тут
            стоит страховка от «через запрос льют гигабайты».
          */
          or coalesce(f.size_bytes, 0) > 25000000
          or coalesce(f.storage_path, '') not like
             'chat/' || new.chat_id::text || '/' || coalesce(auth.uid()::text, '') || '/%'
          /*
            То же, что BLOCKED_EXT в src/forum/media.js: страницы, скрипты
            и программы. Файл из чата открывается в браузере по ссылке в
            хранилище, и страница на этом адресе — готовый фишинг «вот новая
            версия сайта, войди». Клиент такую отправку не даёт, но браузер
            можно обойти, а базу — нет.
          */
          or lower(coalesce(f.storage_path, '')) ~
             '\.(html?|xhtml|svg|xml|js|mjs|exe|msi|bat|cmd|com|scr|ps1|vbs|jar|apk)$'
    ) then
      raise exception 'Вложение не подходит: чужой файл, страница или программа вместо файла, либо слишком большой вес';
    end if;
  end if;

  -- Ответ на сообщение из другого чата невозможен.
  if new.reply_to_id is not null
     and not exists (select 1 from public.forum_chat_messages m
                      where m.id = new.reply_to_id and m.chat_id = new.chat_id) then
    new.reply_to_id := null;
  end if;

  -- Закрепить сообщение при отправке нельзя: это отдельное действие.
  new.pinned := false;
  new.pinned_at := null;
  return new;
end;
$$;

/*
  Разбор черновика на строки. AFTER INSERT, а не BEFORE: строке вложений нужен
  идентификатор сообщения, которого до вставки ещё нет.
*/
create or replace function public.forum_chat_message_files()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(jsonb_array_length(new.draft_attachments), 0) > 0 then
    insert into public.forum_chat_attachments
      (message_id, chat_id, uploader_id, kind, url, storage_path, name, mime,
       size_bytes, width, height, duration_ms)
    select
      new.id,
      new.chat_id,
      new.author_id,
      f.kind,
      f.url,
      coalesce(f.storage_path, ''),
      left(coalesce(f.name, ''), 120),
      left(coalesce(f.mime, ''), 80),
      coalesce(f.size_bytes, 0),
      coalesce(f.width, 0),
      coalesce(f.height, 0),
      coalesce(f.duration_ms, 0)
    from jsonb_to_recordset(new.draft_attachments)
      as f(kind text, url text, storage_path text, name text, mime text,
           size_bytes bigint, width int, height int, duration_ms int);

    update public.forum_chat_messages set draft_attachments = '[]'::jsonb where id = new.id;
  end if;
  return new;

end;
$$;

drop trigger if exists forum_chat_message_files on public.forum_chat_messages;
create trigger forum_chat_message_files
  after insert on public.forum_chat_messages
  for each row execute function public.forum_chat_message_files();

/*
  Правка сообщения. Текста по-прежнему не касается (сказанное сказано),
  но теперь решает ещё два вопроса: закрепление (это право управляющего,
  а не автора) и защита связей от подмены.
*/
create or replace function public.forum_chat_message_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;

  new.author_id := old.author_id;
  new.author_nick := old.author_nick;
  new.chat_id := old.chat_id;
  new.created_at := old.created_at;
  new.body := old.body;
  new.reply_to_id := old.reply_to_id;
  new.draft_attachments := '[]'::jsonb;

  if new.pinned is distinct from old.pinned then
    if not public.forum_chat_manager(old.chat_id) then
      new.pinned := old.pinned;
      new.pinned_at := old.pinned_at;
    else
      new.pinned_at := case when new.pinned then now() else null end;
    end if;
  else
    new.pinned_at := old.pinned_at;
  end if;

  if old.deleted then
    new.deleted := true;
    new.deleted_reason := old.deleted_reason;
  end if;
  return new;
end;
$$;

/*
  Предел закреплённого. Число то же, что CONFIG.forum.chat.pinsMax.
  Без него «закрепить» превратилось бы в способ держать всю переписку
  над лентой, и лента стала бы бесполезной.
*/
create or replace function public.forum_chat_pin_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if new.pinned and not coalesce(old.pinned, false) then
    select count(*) into n
      from public.forum_chat_messages
     where chat_id = new.chat_id and pinned and not deleted;
    if n >= 20 then
      raise exception 'В чате уже двадцать закреплённых сообщений';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_chat_pin_limit on public.forum_chat_messages;
create trigger forum_chat_pin_limit
  before update on public.forum_chat_messages
  for each row execute function public.forum_chat_pin_limit();

-- ── Хранилище: файлы чатов ──────────────────────────────────────────────────

/*
  Отдельный контейнер, а не общий forum-uploads: у чатов свои правила.
  Файл поста видят все, файл чата — только участники, и выразить это одной
  политикой на общем контейнере нельзя, не ослабив правила для форума.
*/
insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

/*
  Чат из имени файла.

  Путь файла — chat/<чат>/<кто>/<файл>. Идентификатор чата зашит в путь
  именно ради правил доступа: политика хранилища не умеет спрашивать
  «к какому чату относится этот файл» ниоткуда, кроме имени.

  Функция возвращает null, если имя не подходит по форме, — тогда условие
  forum_chat_member(null) даёт false, и доступ закрыт. Разбирать имя прямо
  в политике нельзя: `split_part(...)::uuid` на мусорном имени уронил бы
  запрос ошибкой вместо честного отказа.
*/
create or replace function public.forum_chat_path_chat(object_name text)
returns uuid
language sql stable security definer set search_path = public
as $$
  select case
    when split_part(object_name, '/', 1) = 'chat'
     and split_part(object_name, '/', 2) ~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 2)::uuid
    else null
  end;
$$;

drop policy if exists chat_uploads_read on storage.objects;
create policy chat_uploads_read on storage.objects
  for select using (bucket_id = 'chat-uploads');

drop policy if exists chat_uploads_write on storage.objects;
create policy chat_uploads_write on storage.objects
  for insert with check (
    bucket_id = 'chat-uploads'
    and auth.role() = 'authenticated'
    -- Своя папка внутри чата: без этого участник перезаписал бы чужой файл.
    and split_part(name, '/', 3) = auth.uid()::text
    and public.forum_chat_member(public.forum_chat_path_chat(name))
    and public.forum_can_write()
  );

drop policy if exists chat_uploads_delete on storage.objects;
create policy chat_uploads_delete on storage.objects
  for delete using (
    bucket_id = 'chat-uploads'
    and (
      split_part(name, '/', 3) = auth.uid()::text
      or public.forum_chat_manager(public.forum_chat_path_chat(name))
    )
  );

-- ── Представления: то, что читает страница ──────────────────────────────────

/*
  Представления пересоздаются целиком (drop + create), поэтому новые колонки
  встают в любое место. Порядок колонок здесь не важен: страница читает
  объекты по именам, а не по номерам.

  ЧТО СЧИТАЕТСЯ НА СТОРОНЕ БАЗЫ. Вложения, реакции и цитата ответа едут
  вместе с сообщением. Иначе лента из тридцати реплик превратилась бы
  в сотню запросов: по два-три на каждое сообщение.
*/
drop view if exists public.forum_chat_list;
create view public.forum_chat_list
with (security_invoker = on) as
select
  c.*,
  (select count(*) from public.forum_chat_members m where m.chat_id = c.id) as member_count,
  (select m.role from public.forum_chat_members m
     where m.chat_id = c.id and m.user_id = auth.uid()) as my_role,
  (select m.last_read_at from public.forum_chat_members m
     where m.chat_id = c.id and m.user_id = auth.uid()) as my_last_read_at,
  (select count(*) from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
       and x.created_at > coalesce(
         (select m.last_read_at from public.forum_chat_members m
            where m.chat_id = c.id and m.user_id = auth.uid()), 'epoch'::timestamptz)
       and x.author_id is distinct from auth.uid()) as unread_count,
  (select x.body from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_body,
  (select x.author_nick from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_nick,
  (select x.created_at from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_at,
  /*
    Вид вложения последнего сообщения. У сообщения из одних картинок тела нет
    вовсе, и без этой колонки список чатов показывал бы пустую строку —
    будто в чате ничего не писали.
  */
  (select a.kind
     from public.forum_chat_attachments a
     join public.forum_chat_messages x on x.id = a.message_id
    where x.chat_id = c.id and x.deleted = false
    order by x.created_at desc, a.created_at
    limit 1) as last_kind,
  (select count(*) from public.forum_chat_messages x
     where x.chat_id = c.id and x.pinned and x.deleted = false) as pinned_count
from public.forum_chats c;

grant select on public.forum_chat_list to authenticated;

drop view if exists public.forum_chat_message_list;
create view public.forum_chat_message_list
with (security_invoker = on) as
select
  x.*,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  prof.is_leader as author_is_leader,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'kind', a.kind,
      'url', a.url,
      'name', a.name,
      'mime', a.mime,
      'size_bytes', a.size_bytes,
      'width', a.width,
      'height', a.height,
      'duration_ms', a.duration_ms
    ) order by a.created_at)
      from public.forum_chat_attachments a
     where a.message_id = x.id
  ), '[]'::jsonb) as attachments,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'emoji', r.emoji,
      'count', r.n,
      'mine', r.mine,
      'nicks', r.nicks
    ))
      from (
        select
          rr.emoji,
          count(*) as n,
          bool_or(rr.user_id = auth.uid()) as mine,
          (array_agg(coalesce(p.nick, '') order by rr.created_at))[1:8] as nicks
        from public.forum_chat_reactions rr
        left join public.forum_profiles p on p.id = rr.user_id
        where rr.message_id = x.id
        group by rr.emoji
      ) r
  ), '[]'::jsonb) as reactions,
  reply.id as reply_id,
  reply.author_nick as reply_nick,
  left(coalesce(reply.body, ''), 200) as reply_body,
  coalesce(reply.deleted, false) as reply_deleted
from public.forum_chat_messages x
left join public.forum_profiles prof on prof.id = x.author_id
left join public.forum_chat_messages reply on reply.id = x.reply_to_id;

grant select on public.forum_chat_message_list to authenticated;

drop view if exists public.forum_chat_member_list;
create view public.forum_chat_member_list
with (security_invoker = on) as
select
  m.*,
  prof.nick,
  prof.avatar_url,
  prof.alliance_tag,
  prof.is_leader
from public.forum_chat_members m
join public.forum_profiles prof on prof.id = m.user_id;

grant select on public.forum_chat_member_list to authenticated;

-- ── Права ───────────────────────────────────────────────────────────────────

grant select, delete on public.forum_chat_attachments to authenticated;
grant select, insert, delete on public.forum_chat_reactions to authenticated;
grant select on public.forum_chat_typing to authenticated;

grant select, insert, update, delete on public.forum_chats to authenticated;
grant select, insert, update, delete on public.forum_chat_members to authenticated;
grant select, insert, update on public.forum_chat_messages to authenticated;

/*
  ЧТО НАДО СДЕЛАТЬ РУКАМИ ПОСЛЕ ЗАПУСКА.

  Ничего. Файл рассчитан на повторный запуск целиком: он добавит колонки,
  таблицы, правила хранилища и заменит представления. Переписка, вложения
  и участники при этом не теряются.
*/
