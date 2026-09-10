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
