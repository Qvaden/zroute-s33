-- ── НИКИ И ВЕРИФИКАЦИЯ: защита от «чужого ника» ─────────────────────────────
--
-- Две задачи одним блоком:
--
-- 1) ЗАЩИТА НИКОВ. Ник живёт в базе как есть, но для сравнения считается его
--    нормализованный ключ (forum_nick_key): нижний регистр + подмена
--    кириллических и латинских «двойников» (Крeмль == Кремль). Уникальный
--    индекс на этом ключе запрещает регистрацию похожего ника. Игрок может
--    сменить ник сам, владелец — переименовать кого угодно (например, тролля
--    обратно на осмысленный ник). Каждая смена пишется в журнал
--    forum_nick_history, а копии ника в постах/комментариях/чатах/уведомлениях
--    синхронизируются. Стоп-лист (reserved_nicks) держит «святые» ники,
--    которые вообще нельзя занять никому.
--
-- 2) ПРОВЕРЕННЫЙ ИГРОК. Профиль получает флаг is_verified — «ник подтверждён»:
--    ставит лидер альянса игрока, модератор или владелец. Непроверенные
--    профили помечены в ленте, и, главное, непроверенный не может создать чат
--    (это закрывает главный вектор прикола — чат под чужим именем).
--
-- РЕШЕНИЕ ПРИНИМАЕТ БАЗА, А НЕ ПАНЕЛЬ: и проверку ника, и смену, и верификацию
-- панель пересказывает через RPC, права проверяются в функциях.
--
-- Запускать ПОСЛЕ supabase/chats.sql (там forum_is_leader, forum_chats,
-- forum_profiles), supabase/profiles.sql, supabase/rich-forum.sql и
-- supabase/leaders.sql (там forum_set_leader и leader_of, которые здесь
-- переопределяются) — в самом конце цепочки миграций. Повторный запуск
-- безопасен.

-- ── Нормализованный ключ ника ───────────────────────────────────────────────
--
-- Иммутабельная функция для индекса: подменяет кириллические буквы, внешне
-- неотличимые от латинских (обман «Крeмль» вместо «Кремль» не проходит),
-- и приводит к нижнему регистру. Разделители (пробел, _, -) не трогаем:
-- «Ковыль» и «Ковыль-33» — разные люди, их нельзя склеивать.

create or replace function public.forum_nick_key(nick text)
returns text
language sql immutable
as $$
  select lower(
    translate(
      coalesce(nick, ''),
      'авекмнорстух',
      'abekmhopctuyx'
    )
  );
$$;

-- ── Колонки верификации ─────────────────────────────────────────────────────

alter table public.forum_users
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_by uuid,
  add column if not exists verified_at timestamptz;

-- ── Уникальный индекс на ключ ника ─────────────────────────────────────────
--
-- Аналог существующего нижнего индекса (forum_users_nick_key на lower(nick)),
-- но по нормализованному ключу: «Кремль» и «Крeмль» больше не могут
-- существовать одновременно. Если индекс упадёт на конфликте в данных —
-- значит, в базе уже есть похожие ники, и их нужно переименовать.

create unique index if not exists forum_users_nickkey_uniq
  on public.forum_users (public.forum_nick_key(nick))
  where btrim(nick) <> '';

-- ── Стоп-лист ───────────────────────────────────────────────────────────────
--
-- Ники, которые нельзя занять никому. Без RLS и без grant'ов: читается и
-- правится только через RPC ниже (админ делает добавление/удаление).
-- В ключах хранится нормализованный вид, чтобы «НеЛЬЗЯ» и «нельзя» совпадали.

create table if not exists public.reserved_nicks (
  nick       text primary key,
  added_by   uuid,
  created_at timestamptz not null default now()
);

revoke all on table public.reserved_nicks from public, anon, authenticated;

-- ── Журнал переименований ───────────────────────────────────────────────────
--
-- Меняли ник сам игрок или владелец принудительно — каждый случай остаётся
-- следом: старый ник, новый, кто и когда, а для принудительных — причина.
-- Если тролль переименовался обратно в чужой ник, журнал сохраняет старое имя.

create table if not exists public.forum_nick_history (
  id         bigserial primary key,
  user_id    uuid not null,
  old_nick   text not null,
  new_nick   text not null,
  changed_by uuid,                 -- null = смена самим игроком
  reason     text not null default '',
  created_at timestamptz not null default now()
);

revoke all on table public.forum_nick_history from public, anon, authenticated;

-- ── Помощник: проверен ли текущий игрок ─────────────────────────────────────
--
-- Персонал считается проверенным по определению. Это же освобождает модерацию
-- от необходимости бежать «проверять» себя.

create or replace function public.forum_is_verified()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid()
      and (is_verified = true or role in ('admin', 'moderator'))
  );
$$;

-- Право открыть чат: как раньше (лидер или персонал + право писать), но
-- непременно «проверенный». Непроверенный лидер ещё не получил подтверждения
-- владельца — чат не откроет.
create or replace function public.forum_can_open_chats()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.forum_is_leader()
     and public.forum_can_write()
     and public.forum_is_verified();
$$;

-- Политику создания чатов: добавляем требование проверенности.
drop policy if exists forum_chats_insert on public.forum_chats;
create policy forum_chats_insert on public.forum_chats
  for insert with check (public.forum_can_open_chats());

-- ── Текущие лидеры и персонал считаются проверенными ────────────────────────
--
-- Лидерство назначает владелец — это уже подтверждение «это тот человек».
-- Поэтому при переходе на механику все действующие лидеры и персонал сразу
-- получают статус проверенного, и ничего из их прав не ломается.

update public.forum_users
   set is_verified = true,
       verified_at = coalesce(verified_at, now())
 where (
   is_leader = true
   or role in ('admin', 'moderator')
 );

-- Назначение лидера впредь автоматически подтверждает ник: владелец сам
-- проверил человека, когда делал его лидером.
create or replace function public.forum_set_leader(
  target_user uuid,
  leader_of   text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_tag text;
begin
  if not public.forum_is_admin() then
    raise exception 'Назначать лидеров может только владелец';
  end if;

  if not exists (select 1 from public.forum_users where id = target_user) then
    raise exception 'Игрок не найден';
  end if;

  v_tag := left(btrim(upper(coalesce(leader_of, ''))), 12);

  if v_tag = '' then
    update public.forum_users
       set leader_of = ''
     where id = target_user;
    return;
  end if;

  update public.forum_users as previous_leader
     set leader_of = ''
   where previous_leader.leader_of = v_tag
     and previous_leader.id <> target_user;

  update public.forum_users
     set leader_of = v_tag,
         is_verified = true,
         verified_by = auth.uid(),
         verified_at = coalesce(verified_at, now())
   where id = target_user;
end;
$$;

revoke all on function public.forum_set_leader(uuid, text) from public, anon;
grant execute on function public.forum_set_leader(uuid, text) to authenticated;

-- ── Охранник профиля: разрешаем смену ника только через RPC ────────────────
--
-- Раньше guard вообще запрещал менять ник. Теперь смена возможна, но только
-- когда текущая транзакция помечена флагом app.nick_change_ok (его ставит
-- forum_rename_nick / forum_rename_nick_as). Прямой UPDATE мимо RPC
-- по-прежнему ничего не изменит: ник и дальше «не трогается напрямую».

create or replace function public.forum_users_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.role <> old.role then
    if not public.forum_is_admin() then
      raise exception 'Роль меняет только администратор';
    end if;

    if old.role = 'admin' and new.role <> 'admin'
       and (select count(*) from public.forum_users where role = 'admin') <= 1 then
      raise exception 'Это последний администратор — снять роль нельзя';
    end if;
  end if;

  -- Ник меняется только транзакцией переименования (RPC ставит флаг),
  -- дату регистрации и id не меняет никто.
  if new.nick is distinct from old.nick
     and coalesce(current_setting('app.nick_change_ok', true), '') <> 'on' then
    new.nick := old.nick;
  end if;
  new.created_at := old.created_at;
  new.id := old.id;

  -- Администратора нельзя забанить
  if old.role = 'admin' then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
  end if;

  return new;
end;
$$;

drop trigger if exists forum_users_guard on public.forum_users;
create trigger forum_users_guard
  before update on public.forum_users
  for each row execute function public.forum_users_guard();

-- ── Проверка ника (живая, при регистрации и смене) ──────────────────────────
--
-- Возвращает статус для поля формы: free / taken / reserved.
-- Учёт текущего игрока: переименовываясь в свой же ник, человек не получает
-- «занят».

create or replace function public.forum_check_nick(nick text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_key text;
begin
  v_key := public.forum_nick_key(nick);

  if exists (
    select 1 from public.reserved_nicks
    where reserved_nicks.nick = v_key
  ) then
    return jsonb_build_object('status', 'reserved');
  end if;

  if exists (
    select 1 from public.forum_users u
    where public.forum_nick_key(u.nick) = v_key
      and (auth.uid() is null or u.id <> auth.uid())
  ) then
    return jsonb_build_object('status', 'taken');
  end if;

  return jsonb_build_object('status', 'free');
end;
$$;

-- Вызов доступен и АНОНИМУ: живая проверка ника работает в форме
-- регистрации, когда человек ещё не вошёл. Функция ничего не выдаёт, кроме
-- трёх статусов, и ничего не меняет.
revoke all on function public.forum_check_nick(text) from public;
grant execute on function public.forum_check_nick(text) to anon, authenticated;

-- ── Проверка при регистрации ────────────────────────────────────────────────
--
-- Создание профиля с запрещённым ником откатывается в триггере: зарезервиро
-- ванные ники и «похожие» на существующие не проходят. Уникальность ник-key
-- ловит сам индекс, резерв ловим здесь.

create or replace function public.forum_on_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  raw_nick text;
begin
  raw_nick := coalesce(new.raw_user_meta_data ->> 'nick', '');
  if raw_nick = '' then
    raw_nick := split_part(new.email, '@', 1);
  end if;

  if exists (
    select 1 from public.reserved_nicks
    where nick = public.forum_nick_key(raw_nick)
  ) then
    raise exception 'Этот ник зарезервирован';
  end if;

  insert into public.forum_users (id, nick)
  values (new.id, raw_nick)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists forum_on_signup on auth.users;
create trigger forum_on_signup
  after insert on auth.users
  for each row execute function public.forum_on_signup();

-- ── Синхронизация копий ника ────────────────────────────────────────────────
--
-- Ник автора лежит копией в постах, комментариях, чатах (владелец), сообщениях
-- и уведомлениях. При смене ника обновляем все копии одной транзакцией —
-- иначе пост подписало бы старым именем того же человека.

create or replace function public.forum_sync_nick_copies(
  target uuid,
  new_nick text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.forum_posts
     set author_nick = new_nick
   where author_id = target;
  update public.forum_comments
     set author_nick = new_nick
   where author_id = target;
  update public.forum_chats
     set owner_nick = new_nick
   where owner_id = target;
  update public.forum_chat_messages
     set author_nick = new_nick
   where author_id = target;
  update public.forum_notifications
     set actor_nick = new_nick
   where actor_id = target;
end;
$$;

-- ── Смена ника самим игроком ────────────────────────────────────────────────
--
-- Права: любой вошедший для себя. Проверки в базе, а не в панели: формат,
-- занятость по ключу, стоп-лист. Все смены пишутся в журнал.

create or replace function public.forum_rename_nick(
  new_nick text,
  reason   text default ''
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_new text;
  v_old text;
  v_len integer;
begin
  v_new := btrim(coalesce(new_nick, ''));
  v_old := (select nick from public.forum_users where id = auth.uid());

  if v_old is null then
    raise exception 'Игрок не найден';
  end if;

  if v_new = '' then
    raise exception 'Ник не может быть пустым';
  end if;

  v_len := char_length(v_new);
  if v_len < 2 or v_len > 40 then
    raise exception 'Ник должен быть от 2 до 40 символов';
  end if;

  if v_new ~ '^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$' = false then
    raise exception 'В нике допустимы только буквы, цифры, пробел, _ и -';
  end if;

  if v_new = v_old then
    return;
  end if;

  if exists (
    select 1 from public.reserved_nicks
    where nick = public.forum_nick_key(v_new)
  ) then
    raise exception 'Этот ник зарезервирован';
  end if;

  if exists (
    select 1 from public.forum_users
    where public.forum_nick_key(nick) = public.forum_nick_key(v_new)
      and id <> auth.uid()
  ) then
    raise exception 'Этот ник уже занят';
  end if;

  perform set_config('app.nick_change_ok', 'on', true);

  update public.forum_users
     set nick = v_new
   where id = auth.uid();

  insert into public.forum_nick_history (user_id, old_nick, new_nick, changed_by, reason)
  values (auth.uid(), v_old, v_new, null, '');

  perform public.forum_sync_nick_copies(auth.uid(), v_new);
end;
$$;

revoke all on function public.forum_rename_nick(text, text) from public, anon;
grant execute on function public.forum_rename_nick(text, text) to authenticated;

-- ── Переименование владельцем ───────────────────────────────────────────────
--
-- Владелец переименовывает кого угодно (приколы, чужие ники). Причина
-- обязательна — она остаётся в журнале. Рекомендуемый лайфхак администрации:
-- переименовать тролля в нейтральный ник и проверить/снять.
-- Роль последнего администратора не трогается: он и так админ.

create or replace function public.forum_rename_nick_as(
  target_user uuid,
  new_nick text,
  reason   text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_new text;
  v_old text;
  v_len integer;
begin
  if not public.forum_is_admin() then
    raise exception 'Переименовывать игроков может только владелец';
  end if;

  if not exists (select 1 from public.forum_users where id = target_user) then
    raise exception 'Игрок не найден';
  end if;

  v_new := btrim(coalesce(new_nick, ''));
  v_old := (select nick from public.forum_users where id = target_user);

  if v_new = '' then
    raise exception 'Ник не может быть пустым';
  end if;

  v_len := char_length(v_new);
  if v_len < 2 or v_len > 40 then
    raise exception 'Ник должен быть от 2 до 40 символов';
  end if;

  if v_new ~ '^[\p{L}\p{N}][\p{L}\p{N} _-]*[\p{L}\p{N}]$' = false then
    raise exception 'В нике допустимы только буквы, цифры, пробел, _ и -';
  end if;

  if v_new = v_old then
    return;
  end if;

  if exists (
    select 1 from public.reserved_nicks
    where nick = public.forum_nick_key(v_new)
  ) then
    raise exception 'Этот ник зарезервирован';
  end if;

  if exists (
    select 1 from public.forum_users
    where public.forum_nick_key(nick) = public.forum_nick_key(v_new)
      and id <> target_user
  ) then
    raise exception 'Этот ник уже занят';
  end if;

  perform set_config('app.nick_change_ok', 'on', true);

  update public.forum_users
     set nick = v_new
   where id = target_user;

  insert into public.forum_nick_history (user_id, old_nick, new_nick, changed_by, reason)
  values (target_user, v_old, v_new, auth.uid(), left(btrim(coalesce(reason, '')), 500));

  perform public.forum_sync_nick_copies(target_user, v_new);
end;
$$;

revoke all on function public.forum_rename_nick_as(uuid, text, text) from public, anon;
grant execute on function public.forum_rename_nick_as(uuid, text, text) to authenticated;

-- ── Верификация игрока ──────────────────────────────────────────────────────
--
-- Ставят: владелец, модератор, или лидер альянса для игрока СВОЕГО альянса
-- (совпадение alliance_tag профиля игрока и leader_of того, кто нажимает).
-- Ник сам себе не подтверждают: иначе прикол-под-чужим-именем сам себя проверил
-- бы одним кликом. Право «проверенного» — создание чатов и чистая метка в ленте.

create or replace function public.forum_set_verified(
  target_user uuid,
  verified    boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_my_leader_of text;
  v_victim_tag   text;
begin
  if not exists (select 1 from public.forum_users where id = target_user) then
    raise exception 'Игрок не найден';
  end if;

  if target_user = auth.uid() then
    raise exception 'Проверить самого себя нельзя: это сделает лидер вашего альянса, модератор или владелец';
  end if;

  if not public.forum_is_staff() then
    select leader_of into v_my_leader_of from public.forum_users where id = auth.uid();
    select alliance_tag into v_victim_tag from public.forum_users where id = target_user;

    if v_victim_tag = '' or v_victim_tag <> v_my_leader_of then
      raise exception 'Подтверждать игроков может владелец, модератор или лидер альянса игрока';
    end if;
  end if;

  if verified then
    update public.forum_users
       set is_verified = true,
           verified_by = auth.uid(),
           verified_at = coalesce(verified_at, now())
     where id = target_user;
  else
    update public.forum_users
       set is_verified = false,
           verified_at = null
     where id = target_user;
  end if;
end;
$$;

revoke all on function public.forum_set_verified(uuid, boolean) from public, anon;
grant execute on function public.forum_set_verified(uuid, boolean) to authenticated;

-- ── Журнал переименований конкретного игрока ───────────────────────────────
--
-- Смотрит сам игрок (своя история), модератор и владелец (любая): журнал —
-- рабочий инструмент модерации, а не только владелецская вотчина.

create or replace function public.forum_nick_history_list(target_user uuid)
returns table (
  created_at timestamptz,
  old_nick   text,
  new_nick   text,
  changed_by uuid,
  reason     text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if target_user <> auth.uid() and not public.forum_is_staff() then
    raise exception 'Историю смены ника смотрит модерация или сам игрок';
  end if;

  return query
    select h.created_at, h.old_nick, h.new_nick, h.changed_by, h.reason
      from public.forum_nick_history h
     where h.user_id = target_user
     order by h.created_at desc;
end;
$$;

revoke all on function public.forum_nick_history_list(uuid) from public, anon;
grant execute on function public.forum_nick_history_list(uuid) to authenticated;

-- ── Стоп-лист через RPC ─────────────────────────────────────────────────────

create or replace function public.forum_reserved_list()
returns table (nick text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.forum_is_admin() then
    raise exception 'Стоп-лист ников ведёт владелец';
  end if;

  return query
    select r.nick, r.created_at
      from public.reserved_nicks r
     order by r.nick;
end;
$$;

create or replace function public.forum_reserved_add(nick text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text;
begin
  if not public.forum_is_admin() then
    raise exception 'Стоп-лист ников ведёт владелец';
  end if;

  v_key := public.forum_nick_key(nick);
  if v_key = '' then
    raise exception 'Пустой ник нельзя добавить в стоп-лист';
  end if;

  insert into public.reserved_nicks (nick, added_by)
  values (v_key, auth.uid())
  on conflict (nick) do nothing;
end;
$$;

create or replace function public.forum_reserved_remove(nick text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.forum_is_admin() then
    raise exception 'Стоп-лист ников ведёт владелец';
  end if;

  delete from public.reserved_nicks
   where nick = public.forum_nick_key(nick);
end;
$$;

revoke all on function public.forum_reserved_list() from public, anon;
revoke all on function public.forum_reserved_add(text) from public, anon;
revoke all on function public.forum_reserved_remove(text) from public, anon;
grant execute on function public.forum_reserved_list() to authenticated;
grant execute on function public.forum_reserved_add(text) to authenticated;
grant execute on function public.forum_reserved_remove(text) to authenticated;

-- ── Представления: метка верификации по всем местам, где виден ник автора ──

-- Публичный профиль (без drop — новые колонки В КОНЦЕ).
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
  u.verified_at
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

-- Лента и комментарии: метка «проверен» автора едет рядом с ролью, как
-- author_is_blogger. Порядок колонок повторяет действующие представления
-- дословно (create or replace сверяет их по позициям), новая — строго в конец.
create or replace view public.forum_post_list
with (security_invoker = on) as
select
  p.id,
  p.author_id,
  p.author_nick,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  prof.is_blogger as author_is_blogger,
  p.category,
  p.title,
  p.body,
  p.created_at,
  p.edited_at,
  p.pinned,
  p.deleted,
  p.deleted_reason,
  p.views,
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
    Опрос в ленте — как в rich-forum.sql, откуда представление и выросло.
    Колонки при create or replace совпадают ПО ПОЗИЦИЯМ, поэтому порядок
    повторяет действующий дословно; новая колонка верификации добавлена
    строго в конец.
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
  ) as poll,
  prof.is_verified as author_is_verified
from public.forum_posts p
left join public.forum_profiles prof on prof.id = p.author_id;

grant select on public.forum_post_list to anon, authenticated;

create or replace view public.forum_comment_list
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.author_id,
  c.author_nick,
  prof.avatar_url as author_avatar,
  prof.role as author_role,
  prof.is_blogger as author_is_blogger,
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
  ), '[]'::jsonb) as attachments,
  prof.is_verified as author_is_verified
from public.forum_comments c
left join public.forum_profiles prof on prof.id = c.author_id;

grant select on public.forum_comment_list to anon, authenticated;

-- Сообщения чатов: та же метка на стороне профиля.
create or replace view public.forum_chat_message_list
with (security_invoker = on) as
select
  x.*,
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  prof.role as author_role,
  prof.is_leader as author_is_leader,
  prof.is_verified as author_is_verified
from public.forum_chat_messages x
left join public.forum_profiles prof on prof.id = x.author_id;

grant select on public.forum_chat_message_list to authenticated;
