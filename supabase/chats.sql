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
  avatar_url     text not null default '',
  pinned_message_id uuid references public.forum_chat_messages (id) on delete set null,
  created_at     timestamptz not null default now()
);

create table if not exists public.forum_chat_members (
  chat_id      uuid not null references public.forum_chats (id) on delete cascade,
  user_id      uuid not null references public.forum_users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at    timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  typing_at    timestamptz,
  primary key (chat_id, user_id)
);

create table if not exists public.forum_chat_messages (
  id             uuid primary key default gen_random_uuid(),
  chat_id        uuid not null references public.forum_chats (id) on delete cascade,
  author_id      uuid references public.forum_users (id) on delete set null,
  author_nick    text not null default '',
  body           text not null,
  attachments    jsonb not null default '[]'::jsonb,
  poll           jsonb default null,
  reply_to       jsonb default null,
  reactions      jsonb not null default '{}'::jsonb,
  deleted        boolean not null default false,
  deleted_reason text not null default '',
  created_at     timestamptz not null default now()
);

alter table public.forum_chat_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb,
  add column if not exists poll jsonb default null,
  add column if not exists reply_to jsonb default null,
  add column if not exists reactions jsonb not null default '{}'::jsonb;

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
  for delete using (public.forum_is_staff() or owner_id = auth.uid());

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
    -- Достижение «создал чат».
    insert into public.forum_chat_achievements (user_id, kind)
    values (new.owner_id, 'created_chat')
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
-- Обновлять могут участники (реакции, опросы), но какие поля реально меняются
-- решает триггер ниже.
drop policy if exists forum_chat_messages_update on public.forum_chat_messages;
create policy forum_chat_messages_update on public.forum_chat_messages
  for update using (author_id = auth.uid() or public.forum_chat_member(chat_id))
  with check (author_id = auth.uid() or public.forum_chat_member(chat_id));

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
  if char_length(btrim(new.body)) = 0
     and coalesce(new.attachments, '[]'::jsonb) = '[]'::jsonb
     and new.poll is null then
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
declare
  is_mgr boolean;
begin
  if auth.uid() is null then return new; end if;
  new.author_id := old.author_id;
  new.author_nick := old.author_nick;
  new.chat_id := old.chat_id;
  new.created_at := old.created_at;
  -- Правки текста нет: чат это разговор, сказанное сказано.
  new.body := old.body;
  -- Вложения, опрос и ссылка на ответ замораживаются после создания.
  new.attachments := old.attachments;
  new.reply_to := old.reply_to;

  -- Опрос может двигаться только если это опросное сообщение; голосует участник.
  if old.poll is null then
    new.poll := old.poll;
  end if;

  is_mgr := public.forum_chat_manager(old.chat_id);
  if old.deleted then
    new.deleted := true;
    new.deleted_reason := old.deleted_reason;
  elsif new.deleted then
    if old.author_id is distinct from auth.uid() and not is_mgr then
      new.deleted := false;
      new.deleted_reason := '';
    end if;
  else
    new.deleted := false;
    new.deleted_reason := '';
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
  (select coalesce(
      nullif(x.body, ''),
      case
        when x.poll is not null then '📊 Опрос'
        when x.attachments is not null and x.attachments <> '[]'::jsonb then '📎 Вложение'
        else ''
      end
    ) from public.forum_chat_messages x
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

-- ── Миграции для существующих баз ────────────────────────────────────────
-- Если база создана до этой версии, колонки уже есть в create table.
-- Если после — эти alter добавят недостающие.

alter table public.forum_chats add column if not exists avatar_url text not null default '';
alter table public.forum_chats add column if not exists pinned_message_id uuid references public.forum_chat_messages (id) on delete set null;
alter table public.forum_chat_members add column if not exists last_seen_at timestamptz not null default now();
alter table public.forum_chat_members add column if not exists typing_at timestamptz;

-- ── Закреплённое сообщение ───────────────────────────────────────────────

create or replace function public.forum_chat_pin(target_chat uuid, target_msg uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;
  if not exists (
    select 1 from public.forum_chat_members
    where chat_id = target_chat and user_id = auth.uid() and role in ('owner', 'admin')
  ) and not public.forum_is_staff() then
    raise exception 'Закрепить сообщение может владелец или помощник';
  end if;
  if not exists (
    select 1 from public.forum_chat_messages
    where id = target_msg and chat_id = target_chat and deleted = false
  ) then
    raise exception 'Сообщение не найдено в этом чате';
  end if;
  update public.forum_chats set pinned_message_id = target_msg where id = target_chat;
end;
$$;

revoke all on function public.forum_chat_pin(uuid, uuid) from public, anon;
grant execute on function public.forum_chat_pin(uuid, uuid) to authenticated;

create or replace function public.forum_chat_unpin(target_chat uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;
  if not exists (
    select 1 from public.forum_chat_members
    where chat_id = target_chat and user_id = auth.uid() and role in ('owner', 'admin')
  ) and not public.forum_is_staff() then
    raise exception 'Открепить может владелец или помощник';
  end if;
  update public.forum_chats set pinned_message_id = null where id = target_chat;
end;
$$;

revoke all on function public.forum_chat_unpin(uuid) from public, anon;
grant execute on function public.forum_chat_unpin(uuid) to authenticated;

-- ── Обновление last_seen_at при markChatRead ─────────────────────────────

-- В supabase adapter markChatRead обновляет last_read_at.
-- Триггер синхронизирует last_seen_at.
create or replace function public.forum_chat_member_seen()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

drop trigger if exists forum_chat_member_seen on public.forum_chat_members;
create trigger forum_chat_member_seen
  before update of last_read_at on public.forum_chat_members
  for each row execute function public.forum_chat_member_seen();

-- ── Индикатор «печатает…» ────────────────────────────────────────────────

create or replace function public.forum_chat_set_typing(target_chat uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.forum_chat_members
  set typing_at = now()
  where chat_id = target_chat and user_id = auth.uid();
end;
$$;

revoke all on function public.forum_chat_set_typing(uuid) from public, anon;
grant execute on function public.forum_chat_set_typing(uuid) to authenticated;

-- ── Обновлённые представления ─────────────────────────────────────────────

drop view if exists public.forum_chat_list;
create view public.forum_chat_list
with (security_invoker = on) as
select
  c.*,
  (select count(*) from public.forum_chat_members m where m.chat_id = c.id) as member_count,
  (select count(*) from public.forum_chat_members m
     where m.chat_id = c.id and m.last_seen_at > now() - interval '5 minutes') as online_count,
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
  (select coalesce(
      nullif(x.body, ''),
      case
        when x.poll is not null then '📊 Опрос'
        when x.attachments is not null and x.attachments <> '[]'::jsonb then '📎 Вложение'
        else ''
      end
    ) from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_body,
  (select x.author_nick from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_nick,
  (select x.created_at from public.forum_chat_messages x
     where x.chat_id = c.id and x.deleted = false
     order by x.created_at desc limit 1) as last_at,
  -- Закреплённое сообщение: первые 80 символов тела.
  (select left(coalesce(nullif(pm.body, ''), '📎'), 80)
     from public.forum_chat_messages pm
     where pm.id = c.pinned_message_id and pm.deleted = false) as pinned_body,
  (select pm.author_nick from public.forum_chat_messages pm
     where pm.id = c.pinned_message_id and pm.deleted = false) as pinned_nick
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

-- ── Достижения за чаты ───────────────────────────────────────────────────

create table if not exists public.forum_chat_achievements (
  user_id     uuid not null references public.forum_users (id) on delete cascade,
  kind        text not null check (kind in (
    'first_message',   -- первое сообщение в чате
    'chatter_100',     -- 100 сообщений в чатах
    'chatter_1000',    -- 1000 сообщений в чатах
    'created_chat',    -- создал чат
    'seven_day_streak' -- 7 дней подряд писал в чат
  )),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.forum_chat_achievements enable row level security;

drop policy if exists forum_chat_achievements_read on public.forum_chat_achievements;
create policy forum_chat_achievements_read on public.forum_chat_achievements
  for select using (user_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_chat_achievements_insert on public.forum_chat_achievements;
create policy forum_chat_achievements_insert on public.forum_chat_achievements
  for insert with check (user_id = auth.uid());

grant select, insert on public.forum_chat_achievements to authenticated;

-- Триггер: при первом сообщении в чате выдать достижение.
create or replace function public.forum_chat_achievement_check()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  msg_count int;
  streak_count int;
  chat_count int;
begin
  if new.author_id is null then return new; end if;

  -- first_message
  insert into public.forum_chat_achievements (user_id, kind)
  values (new.author_id, 'first_message')
  on conflict do nothing;

  -- chatter_100 / chatter_1000
  select count(*) into msg_count
  from public.forum_chat_messages
  where author_id = new.author_id and deleted = false;

  if msg_count >= 100 then
    insert into public.forum_chat_achievements (user_id, kind)
    values (new.author_id, 'chatter_100') on conflict do nothing;
  end if;
  if msg_count >= 1000 then
    insert into public.forum_chat_achievements (user_id, kind)
    values (new.author_id, 'chatter_1000') on conflict do nothing;
  end if;

  -- seven_day_streak: сообщения в 7 разных днях за последние 7 дней.
  select count(distinct date(created_at)) into streak_count
  from public.forum_chat_messages
  where author_id = new.author_id and deleted = false
    and created_at >= now() - interval '7 days';

  if streak_count >= 7 then
    insert into public.forum_chat_achievements (user_id, kind)
    values (new.author_id, 'seven_day_streak') on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists forum_chat_achievement_check on public.forum_chat_messages;
create trigger forum_chat_achievement_check
  after insert on public.forum_chat_messages
  for each row execute function public.forum_chat_achievement_check();

-- Достижение «создал чат» выдаётся в триггере forum_chat_after_create.
-- seven_day_streak — считается по дням, выдаётся при проверке из JS.

-- ── Личные сообщения (ЛС) ────────────────────────────────────────────────

-- ЛС — это обычный чат с kind = 'dm'. Отдельный вид не нужен:
-- при создании ЛС проверяем, что между двумя пользователями нет
-- уже существующего dm-чата, и переиспользуем его.

-- ── Личные сообщения (ЛС) ────────────────────────────────────────────────

-- ЛС — это обычный чат с kind = 'dm'. Отдельный вид не нужен:
-- при создании ЛС проверяем, что между двумя пользователями нет
-- уже существующего dm-чата, и переиспользуем его.

create or replace function public.forum_chat_create_dm(other_nick text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  other_user uuid;
  existing_id uuid;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;

  -- Look up user_id by nick
  select id into other_user from public.forum_users where lower(nick) = lower(other_nick) limit 1;
  if other_user is null then
    raise exception 'Игрок не найден';
  end if;

  if other_user = auth.uid() then
    raise exception 'Нельзя написать самому себе';
  end if;
  if not public.forum_can_write() then
    raise exception 'Вам запрещено писать';
  end if;

  -- Ищем существующий ЛС между двумя пользователями.
  select m1.chat_id into existing_id
  from public.forum_chat_members m1
  join public.forum_chats c on c.id = m1.chat_id and c.kind = 'dm'
  join public.forum_chat_members m2 on m2.chat_id = m1.chat_id and m2.user_id = other_user
  where m1.user_id = auth.uid()
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  -- Создаём новый ЛС-чат.
  insert into public.forum_chats (title, kind, owner_id, owner_nick)
  values (
    (select nick from public.forum_users where id = other_user),
    'dm',
    auth.uid(),
    (select nick from public.forum_users where id = auth.uid())
  ) returning id into new_id;

  -- Участники добавляются триггером forum_chat_after_create (владелец)
  -- и здесь — второй участник.
  insert into public.forum_chat_members (chat_id, user_id, role)
  values (new_id, other_user, 'member');

  return new_id;
end;
$$;

revoke all on function public.forum_chat_create_dm(text) from public, anon;
grant execute on function public.forum_chat_create_dm(text) to authenticated;

-- Обновляем constraint kind, чтобы включить 'dm'.
alter table public.forum_chats drop constraint if exists forum_chats_kind_check;
alter table public.forum_chats add constraint forum_chats_kind_check
  check (kind in ('alliance', 'inter', 'dm'));

-- ── Лидерборд чатов (представление) ──────────────────────────────────────

drop view if exists public.forum_chat_leaderboard;
create view public.forum_chat_leaderboard
with (security_invoker = on) as
select
  m.author_id as user_id,
  m.author_nick as nick,
  prof.avatar_url,
  prof.alliance_tag,
  count(*) as message_count
from public.forum_chat_messages m
left join public.forum_profiles prof on prof.id = m.author_id
where m.deleted = false
  and m.created_at >= date_trunc('week', now())
group by m.author_id, m.author_nick, prof.avatar_url, prof.alliance_tag
order by message_count desc
limit 20;

grant select on public.forum_chat_leaderboard to authenticated;

-- ── Уведомления в чатах (уведомление через forum_notifications) ──────────

-- Упоминание @Ник в чате: триггер на вставке сообщения парсит @Ник и
-- отправляет уведомление через существующую систему forum_notifications.

create or replace function public.forum_chat_message_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  mention_nick text;
  target_user_id uuid;
  chat_title text;
begin
  if new.author_id is null then return new; end if;

  select title into chat_title from public.forum_chats where id = new.chat_id;

  -- Парсим @Ник из тела сообщения.
  for mention_nick in
    select m[1] from regexp_matches(new.body, '@([A-Za-zА-Яа-яЁё0-9_]{2,40})', 'g') as m
  loop
    select id into target_user_id from public.forum_users where lower(nick) = lower(mention_nick) limit 1;
    if target_user_id is not null and target_user_id <> new.author_id then
      -- Проверяем, что получатель — участник чата.
      if exists (select 1 from public.forum_chat_members where chat_id = new.chat_id and user_id = target_user_id) then
        insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, preview)
        values (
          target_user_id,
          new.author_id,
          new.author_nick,
          'mention',
          left('В чате «' || coalesce(chat_title, '') || '»: ' || coalesce(nullif(new.body, ''), '📎'), 200)
        );
      end if;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists forum_chat_message_notify on public.forum_chat_messages;
create trigger forum_chat_message_notify
  after insert on public.forum_chat_messages
  for each row execute function public.forum_chat_message_notify();

-- ── Реакции-стикеры (расширенный набор эмодзи) ──────────────────────────

-- Реакции хранятся в JSON-колонке reactions сообщений. Набор эмодзи
-- определяется клиентом (src/pages/chats.js). База не ограничивает
-- какие эмодзи можно использовать — это данные, а не структура.
-- Поэтому отдельной таблицы не нужно.

-- ── Правка kind в forum_chat_guard ────────────────────────────────────────

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

-- ── Комментарии к летописи ──────────────────────────────────────────────

create table if not exists public.forum_event_comments (
  id             uuid primary key default gen_random_uuid(),
  event_id       text not null,
  author_id      uuid references public.forum_users (id) on delete set null,
  author_nick    text not null default '',
  body           text not null,
  deleted        boolean not null default false,
  deleted_reason text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists forum_event_comments_event_idx
  on public.forum_event_comments (event_id, created_at);

alter table public.forum_event_comments enable row level security;

drop policy if exists forum_event_comments_read on public.forum_event_comments;
create policy forum_event_comments_read on public.forum_event_comments
  for select using (true);

drop policy if exists forum_event_comments_insert on public.forum_event_comments;
create policy forum_event_comments_insert on public.forum_event_comments
  for insert with check (author_id = auth.uid() and public.forum_can_write());

drop policy if exists forum_event_comments_update on public.forum_event_comments;
create policy forum_event_comments_update on public.forum_event_comments
  for update using (author_id = auth.uid() or public.forum_is_staff())
  with check (author_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_event_comments_delete on public.forum_event_comments;
create policy forum_event_comments_delete on public.forum_event_comments
  for delete using (author_id = auth.uid() or public.forum_is_staff());

create or replace function public.forum_event_comment_author()
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
    raise exception 'Пустой комментарий';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_event_comment_author on public.forum_event_comments;
create trigger forum_event_comment_author
  before insert on public.forum_event_comments
  for each row execute function public.forum_event_comment_author();

grant select, insert, update, delete on public.forum_event_comments to authenticated;

-- ── Web Push уведомления ────────────────────────────────────────────────

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.forum_users (id) on delete cascade,
  endpoint   text not null unique,
  keys       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_read on public.push_subscriptions;
create policy push_subscriptions_read on public.push_subscriptions
  for select using (user_id = auth.uid() or public.forum_is_staff());

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (user_id = auth.uid() or public.forum_is_staff());

grant select, insert, delete on public.push_subscriptions to authenticated;

-- Автора подписки подставляет триггер: как в forum_posts.
create or replace function public.push_subscription_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists push_subscription_author on public.push_subscriptions;
create trigger push_subscription_author
  before insert on public.push_subscriptions
  for each row execute function public.push_subscription_author();

-- ═══════════════════════════════════════════════════════════════════════════
-- РАСШИРЕННЫЕ ФИЧИ: репутация, онлайн, push, генератор турниров
-- Запускать ПОСЛЕ предыдущих блоков chats.sql. Повторный запуск безопасен.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Репутация участников ─────────────────────────────────────────────

-- Лайк на профиль: один пользователь — один лайк на один профиль.
create table if not exists public.forum_user_likes (
  from_user uuid not null references public.forum_users (id) on delete cascade,
  to_user   uuid not null references public.forum_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user)
);

alter table public.forum_user_likes enable row level security;

drop policy if exists forum_user_likes_read on public.forum_user_likes;
create policy forum_user_likes_read on public.forum_user_likes
  for select using (true);

drop policy if exists forum_user_likes_insert on public.forum_user_likes;
create policy forum_user_likes_insert on public.forum_user_likes
  for insert with check (from_user = auth.uid() and from_user <> to_user);

drop policy if exists forum_user_likes_delete on public.forum_user_likes;
create policy forum_user_likes_delete on public.forum_user_likes
  for delete using (from_user = auth.uid());

grant select, insert, delete on public.forum_user_likes to authenticated;

-- ── 2. Обновлённый view profiles: добавляем likes_received и online ─────
-- Колонка last_seen_at нужна представлению, поэтому добавляем её ДО
-- пересоздания представления, а не после (как было).

alter table public.forum_users add column if not exists last_seen_at timestamptz;

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
  u.is_leader,
  u.created_at,
  (select count(*) from public.forum_posts p
     where p.author_id = u.id and p.deleted = false) as post_count,
  (select count(*) from public.forum_comments c
     where c.author_id = u.id and c.deleted = false) as comment_count,
  coalesce((
    select count(*) from public.forum_reactions r
    join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received,
  -- Новые: лайки на профиль
  coalesce((
    select count(*) from public.forum_user_likes ul
    where ul.to_user = u.id
  ), 0) as profile_likes,
  -- Новые: онлайн (последнее обновление)
  u.last_seen_at,
  coalesce((
    select sum(p.views)
    from public.forum_posts p
    where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_views,
  coalesce((
    select count(*)
    from public.forum_posts p
    where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_post_count
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

-- ── 3. last_seen_at на forum_users (для онлайн) ─────────────────────────
-- Сама колонка уже добавлена выше, перед пересозданием forum_profiles.

-- Триггер: при любом обновлении читать/писать в базе обновляем last_seen_at.
-- Если триггер уже есть от forum_chat_members — пропускаем (IF NOT EXISTS).
-- Делаем отдельный триггер на forum_users.
create or replace function public.forum_user_seen()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.last_seen_at := now();
  return new;
end;
$$;

-- Обновляем last_seen_at при каждом изменении forum_users.
-- Поскольку triggers не имеют IF NOT EXISTS — используем drop + create.
drop trigger if exists forum_user_seen on public.forum_users;
create trigger forum_user_seen
  before update on public.forum_users
  for each row execute function public.forum_user_seen();

-- ── 4. Расширенный Web Push: триггер на новые посты форума ──────────────

-- Триггер: новый пост → push всем subscribed (кроме автора).
-- Триггер: новый комментарий → push автору поста (если subscribed).
-- Вызывается Edge Function через Database Webhook.
-- Webhook на forum_posts INSERT и forum_comments INSERT → send-push.
-- В edge function проверяем record type и отправляем push.

-- Добавляем в push_subscriptions флаг is_active для отключения без удаления.
alter table public.push_subscriptions add column if not exists is_active boolean not null default true;

-- Обновлённая view: только активные подписки для отправки.
-- (Edge Function уже фильтрует по user_id, is_active проверим там.)
-- Обновляем push-триггер для чатов: проверяем is_active = true.
-- Поскольку chat_push_trigger уже создан, пересоздадим его.
create or replace function public.chat_push_trigger()
returns trigger
language plpgsql
as $$
declare
  v_url text;
  v_key text;
begin
  v_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://ebumybzkrhhyinpjpeuk.supabase.co'
  );
  v_key := current_setting('app.settings.supabase_anon_key', true);

  perform net.http_post(
    url    := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_key, '')
    ),
    body   := jsonb_build_object(
      'record', jsonb_build_object(
        'chat_id',     NEW.chat_id,
        'author_id',   NEW.author_id,
        'author_nick', NEW.author_nick,
        'body',        NEW.body,
        'source',      'chat'
      )
    )
  );

  return NEW;
end;
$$;

-- ── 5. Активность сервера — view: посты/сообщения за день ───────────────

create or replace view public.server_activity
with (security_invoker = on) as
select
  date(created_at) as day,
  count(*) filter (where author_id is not null) as new_posts,
  count(*) as new_messages
from public.forum_chat_messages
where deleted = false
group by date(created_at);

grant select on public.server_activity to authenticated;

-- ── 6. Личная статистика ────────────────────────────────────────────────

-- View: статистика по каждому пользователю.
create or replace view public.user_activity_stats
with (security_invoker = on) as
select
  u.id as user_id,
  u.nick,
  coalesce(p.cnt, 0) as forum_posts,
  coalesce(cm.cnt, 0) as forum_comments,
  coalesce(ch.cnt, 0) as chat_messages,
  coalesce(ch.chats_joined, 0) as chats_joined,
  coalesce(ul.cnt, 0) as profile_likes
from public.forum_users u
left join (select author_id, count(*) cnt from public.forum_posts where deleted = false group by author_id) p on p.author_id = u.id
left join (select author_id, count(*) cnt from public.forum_comments where deleted = false group by author_id) cm on cm.author_id = u.id
left join (select author_id, count(*) cnt from public.forum_chat_messages where deleted = false group by author_id) ch on ch.author_id = u.id
left join (select user_id, count(*) chats_joined from public.forum_chat_members group by user_id) cj on cj.user_id = u.id
left join (select to_user, count(*) cnt from public.forum_user_likes group by to_user) ul on ul.to_user = u.id;

grant select on public.user_activity_stats to authenticated;

-- ── 7. Турниры (VS matchup tracker) ─────────────────────────────────────

create table if not exists public.vs_tournaments (
  id           uuid primary key default gen_random_uuid(),
  title        text not null default '',
  ally_a       uuid not null references public.site_alliances (id) on delete cascade,
  ally_b       uuid not null references public.site_alliances (id) on delete cascade,
  wins_a       int  not null default 0,
  wins_b       int  not null default 0,
  draws        int  not null default 0,
  status       text not null default 'active' check (status in ('active', 'finished')),
  winner       uuid references public.site_alliances (id) on delete set null,
  created_by   uuid references public.forum_users (id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);

alter table public.vs_tournaments enable row level security;

drop policy if exists vs_tournaments_read on public.vs_tournaments;
create policy vs_tournaments_read on public.vs_tournaments
  for select using (true);

drop policy if exists vs_tournaments_insert on public.vs_tournaments;
create policy vs_tournaments_insert on public.vs_tournaments
  for insert with check (public.forum_is_leader() and public.forum_can_write());

drop policy if exists vs_tournaments_update on public.vs_tournaments;
create policy vs_tournaments_update on public.vs_tournaments
  for update using (created_by = auth.uid() or public.forum_is_staff());

grant select, insert, update on public.vs_tournaments to authenticated;

-- Отдельные результаты раундов турнира.
create table if not exists public.vs_tournament_rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.vs_tournaments (id) on delete cascade,
  round_number  int  not null default 1,
  winner        uuid references public.site_alliances (id) on delete set null,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

alter table public.vs_tournament_rounds enable row level security;

drop policy if exists vs_tournament_rounds_read on public.vs_tournament_rounds;
create policy vs_tournament_rounds_read on public.vs_tournament_rounds
  for select using (true);

drop policy if exists vs_tournament_rounds_insert on public.vs_tournament_rounds;
create policy vs_tournament_rounds_insert on public.vs_tournament_rounds
  for insert with check (public.forum_is_leader() and public.forum_can_write());

drop policy if exists vs_tournament_rounds_update on public.vs_tournament_rounds;
create policy vs_tournament_rounds_update on public.vs_tournament_rounds
  for update using (public.forum_is_leader() or public.forum_is_staff());

grant select, insert, update on public.vs_tournament_rounds to authenticated;

-- Триггер: после вставки раунда обновляем wins_a/wins_b/draws и winner в турнире.
create or replace function public.vs_tournament_round_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ally_a uuid;
  v_ally_b uuid;
  v_wins_a int;
  v_wins_b int;
  v_draws  int;
  v_winner uuid;
  v_count  int;
begin
  select ally_a, ally_b into v_ally_a, v_ally_b
    from public.vs_tournaments where id = NEW.tournament_id;

  select count(*) filter (where winner = v_ally_a),
         count(*) filter (where winner = v_ally_b),
         count(*) filter (where winner is null)
  into v_wins_a, v_wins_b, v_draws
  from public.vs_tournament_rounds
  where tournament_id = NEW.tournament_id;

  -- Если разница > 0 и больше невозможно догнать → победитель.
  v_winner := null;
  select count(*) into v_count from public.vs_tournament_rounds where tournament_id = NEW.tournament_id;
  if v_wins_a > v_wins_b + (v_count - v_wins_a - v_wins_b - v_draws) then
    v_winner := v_ally_a;
  elsif v_wins_b > v_wins_a + (v_count - v_wins_a - v_wins_b - v_draws) then
    v_winner := v_ally_b;
  end if;

  update public.vs_tournaments
  set wins_a = v_wins_a,
      wins_b = v_wins_b,
      draws  = v_draws,
      winner = v_winner,
      status = case when v_winner is not null then 'finished' else status end,
      finished_at = case when v_winner is not null then now() else finished_at end
  where id = NEW.tournament_id;

  return NEW;
end;
$$;

drop trigger if exists vs_tournament_round_update on public.vs_tournament_rounds;
create trigger vs_tournament_round_update
  after insert on public.vs_tournament_rounds
  for each row execute function public.vs_tournament_round_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- РАСШИРЕННЫЕ ФИЧИ 2: лайки на профили, онлайн, статья недели
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Лайки на профили (репутация) ────────────────────────────────────────

create table if not exists public.forum_profile_likes (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references public.forum_users (id) on delete cascade,
  to_user    uuid not null references public.forum_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);

alter table public.forum_profile_likes enable row level security;

drop policy if exists forum_profile_likes_read on public.forum_profile_likes;
create policy forum_profile_likes_read on public.forum_profile_likes
  for select using (true);

drop policy if exists forum_profile_likes_insert on public.forum_profile_likes;
create policy forum_profile_likes_insert on public.forum_profile_likes
  for insert with check (from_user = auth.uid() and from_user <> to_user);

drop policy if exists forum_profile_likes_delete on public.forum_profile_likes;
create policy forum_profile_likes_delete on public.forum_profile_likes
  for delete using (from_user = auth.uid());

grant select, insert, delete on public.forum_profile_likes to authenticated;

-- ── Обновлённый view forum_profiles с лайками и онлайном ──────────────────

drop view if exists public.forum_profiles;
create view public.forum_profiles
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
  u.last_seen_at,
  (select count(*) from public.forum_posts p
     where p.author_id = u.id and p.deleted = false) as post_count,
  (select count(*) from public.forum_comments c
     where c.author_id = u.id and c.deleted = false) as comment_count,
  coalesce((
    select count(*) from public.forum_reactions r
    join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received,
  coalesce((select count(*) from public.forum_profile_likes fl
            where fl.to_user = u.id), 0) as profile_likes,
  coalesce((select 1 from public.forum_profile_likes fl
            where fl.to_user = u.id and fl.from_user = auth.uid() limit 1), 0) as i_liked,
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
  u.is_leader
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ГАЙДЫ (wiki) и push на новые посты форума. Повторный запуск безопасен.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Гайды игроков ───────────────────────────────────────────────────────

create table if not exists public.forum_guides (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  category     text not null default 'strategy',
  body         text not null,
  author_id    uuid references public.forum_users (id) on delete set null,
  author_nick  text not null default '',
  status       text not null default 'published' check (status in ('draft','published','archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists forum_guides_cat_idx on public.forum_guides (category, published_at desc);

alter table public.forum_guides enable row level security;

-- Опубликованное видят все; черновик — только автор и модерация.
drop policy if exists forum_guides_read on public.forum_guides;
create policy forum_guides_read on public.forum_guides
  for select using (status = 'published' or author_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_guides_insert on public.forum_guides;
create policy forum_guides_insert on public.forum_guides
  for insert with check (public.forum_is_leader() and public.forum_can_write());

drop policy if exists forum_guides_update on public.forum_guides;
create policy forum_guides_update on public.forum_guides
  for update using (author_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_guides_delete on public.forum_guides;
create policy forum_guides_delete on public.forum_guides
  for delete using (author_id = auth.uid() or public.forum_is_staff());

-- Автора подставляет база; slug не даёт дублей, published_at проставляется сам.
create or replace function public.forum_guide_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select nick into new.author_nick from public.forum_users where id = auth.uid();
  end if;
  new.title := left(btrim(new.title), 120);
  if char_length(new.title) < 2 then
    raise exception 'Заголовок гайда короче двух символов';
  end if;
  new.slug := lower(btrim(new.slug));
  if new.slug !~ '^[a-z0-9а-яё-]{2,80}$' then
    raise exception 'Slug: только буквы, цифры и дефис';
  end if;
  new.slug := left(new.slug, 80);
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists forum_guide_before on public.forum_guides;
create trigger forum_guide_before
  before insert or update on public.forum_guides
  for each row execute function public.forum_guide_before();

grant select, insert, update, delete on public.forum_guides to authenticated;

-- ── Настройки push по типам событий ─────────────────────────────────────

-- Кто на что подписан сверх чатов: новые посты форума, комментарии.
create table if not exists public.forum_push_prefs (
  user_id          uuid primary key references public.forum_users (id) on delete cascade,
  new_forum_post   boolean not null default false,
  new_forum_reply  boolean not null default false,
  updated_at       timestamptz not null default now()
);

alter table public.forum_push_prefs enable row level security;

drop policy if exists forum_push_prefs_read on public.forum_push_prefs;
create policy forum_push_prefs_read on public.forum_push_prefs
  for select using (user_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_push_prefs_write on public.forum_push_prefs;
create policy forum_push_prefs_write on public.forum_push_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists forum_push_prefs_update on public.forum_push_prefs;
create policy forum_push_prefs_update on public.forum_push_prefs
  for update using (user_id = auth.uid());

grant select, insert, update on public.forum_push_prefs to authenticated;

-- ── Push на новый пост форума: webhook на Edge Function ─────────────────

-- При вставке поста уведомляем подписчиков. Автору — не шлём.
create or replace function public.forum_post_push_trigger()
returns trigger
language plpgsql
as $$
declare
  v_url text;
  v_key text;
begin
  if new.deleted then return new; end if;
  v_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://ebumybzkrhhyinpjpeuk.supabase.co'
  );
  v_key := current_setting('app.settings.supabase_anon_key', true);
  perform net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(v_key, '')
    ),
    body := jsonb_build_object(
      'record', jsonb_build_object(
        'source',      'forum_post',
        'post_id',     new.id,
        'author_id',   new.author_id,
        'author_nick', new.author_nick,
        'title',       new.title,
        'category',    new.category
      )
    )
  );
  return new;
end;
$$;

drop trigger if exists forum_post_push on public.forum_posts;
create trigger forum_post_push
  after insert on public.forum_posts
  for each row execute function public.forum_post_push_trigger();
