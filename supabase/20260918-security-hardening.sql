-- Закрытие оставшихся дыр аудита.
-- Запускать после 20260917-security-hardening.sql; повторный запуск безопасен.

-- ── 1. RLS на форумные таблицы ранга ─────────────────────────────────────────
--
-- forum_alliance_rank_snapshots и forum_alliance_rank_changes создавались без
-- RLS: при стандартных грантах Supabase их мог читать и писать кто угодно,
-- включая анонима, минуя security definer-функцию.
-- Пишет только forum_record_alliance_rank_snapshot, читают модераторы.

alter table public.forum_alliance_rank_snapshots enable row level security;
alter table public.forum_alliance_rank_changes   enable row level security;

drop policy if exists forum_alliance_rank_snapshots_read on public.forum_alliance_rank_snapshots;
create policy forum_alliance_rank_snapshots_read on public.forum_alliance_rank_snapshots
  for select using (public.forum_is_staff());

drop policy if exists forum_alliance_rank_changes_read on public.forum_alliance_rank_changes;
create policy forum_alliance_rank_changes_read on public.forum_alliance_rank_changes
  for select using (public.forum_is_staff());

revoke all on public.forum_alliance_rank_snapshots from anon, authenticated;
revoke all on public.forum_alliance_rank_changes   from anon, authenticated;
grant select on public.forum_alliance_rank_snapshots to authenticated;
grant select on public.forum_alliance_rank_changes   to authenticated;


-- ── 2. Защита флагов профиля от модератора ────────────────────────────────────
--
-- Без этого модератор мог напрямую через REST-запрос поставить себе или другому
-- is_leader / is_verified / is_blogger, минуя официальные RPC:
--   - forum_set_leader требует админа;
--   - forum_set_verified проверяет тег альянса и запрет «себя».
-- В гварде флаги затираются, если они меняются не админом и не через RPC,
-- который поднял флаг app.forum_flags_ok.

create or replace function public.forum_users_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  flags_ok text;
begin
  if auth.uid() is null then
    return new;
  end if;

  flags_ok := coalesce(current_setting('app.forum_flags_ok', true), '');

  -- Роль меняет только владелец, и снять её с себя нельзя через панель.
  if new.role <> old.role then
    if not public.forum_is_admin() then
      raise exception 'Роль меняет только владелец';
    end if;

    if old.role = 'admin' and new.role <> 'admin' then
      raise exception 'Роль владельца через панель не снимается — только запросом в базу';
    end if;
  end if;

  -- Ник меняется только через функцию (app.nick_change_ok).
  if new.nick is distinct from old.nick
     and coalesce(current_setting('app.nick_change_ok', true), '') <> 'on' then
    new.nick := old.nick;
  end if;
  new.created_at := old.created_at;
  new.id := old.id;

  -- Администратора нельзя забанить или поставить в тишину.
  if old.role = 'admin' then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
  end if;

  -- Обычные участники не могут менять свой бан/тишину/причину.
  if not public.forum_is_staff() then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
    new.ban_reason := old.ban_reason;
  end if;

  -- Лидерство и метки (верификация, блоггер) меняются только владельцем
  -- через официальные RPC (которые поднимают app.forum_flags_ok) или напрямую
  -- из SQL-редактора. Прямое изменение модератором игнорируется.
  if flags_ok <> 'on' and not public.forum_is_admin() then
    new.leader_of   := old.leader_of;
    new.is_leader   := old.is_leader;
    new.is_verified := old.is_verified;
    new.is_blogger  := old.is_blogger;
  end if;

  -- Пределы подписи и тега.
  if char_length(coalesce(new.about, '')) > 200 then
    raise exception 'Подпись длиннее 200 символов';
  end if;
  if char_length(coalesce(new.alliance_tag, '')) > 12 then
    raise exception 'Тег альянса длиннее 12 символов';
  end if;

  return new;
end;
$$;

drop trigger if exists forum_users_guard on public.forum_users;
create trigger forum_users_guard
  before update on public.forum_users
  for each row execute function public.forum_users_guard();

-- Обновляем forum_set_verified, чтобы она поднимала флаг перед обновлением.
-- forum_set_leader не требует флага, так как доступен только администратору.
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

  -- Даём гварду пропустить изменение флагов.
  perform set_config('app.forum_flags_ok', 'on', true);

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


-- ── 3. Защита кода приглашения в чат ─────────────────────────────────────────
--
-- Ставим 12 символов (48 бит) для новых чатов и смены кода: перебор 48 бит
-- нереален. Кроме того, добавляем rate limit для forum_chat_join: пять неверных
-- попыток за десять минут — блокировка.

alter table public.forum_chats
  alter column invite_code
  set default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

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
  fresh := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  update public.forum_chats set invite_code = fresh where id = target;
  return fresh;
end;
$$;

revoke all on function public.forum_chat_rotate_code(uuid) from public, anon;
grant execute on function public.forum_chat_rotate_code(uuid) to authenticated;

-- Таблица попыток входа по коду. Доступна только через security definer-функцию.
create table if not exists public.forum_chat_join_attempts (
  user_id      uuid not null references public.forum_users(id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists forum_chat_join_attempts_idx
  on public.forum_chat_join_attempts (user_id, attempted_at);
alter table public.forum_chat_join_attempts enable row level security;
revoke all on public.forum_chat_join_attempts from anon, authenticated;

create or replace function public.forum_chat_join(code text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  target   public.forum_chats%rowtype;
  attempts integer;
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;
  if not public.forum_can_write() then
    raise exception 'Вам запрещено писать, поэтому и в чаты входить нельзя';
  end if;

  -- Убираем попытки старше десяти минут.
  delete from public.forum_chat_join_attempts
   where user_id = auth.uid() and attempted_at < now() - interval '10 minutes';

  select count(*) into attempts
    from public.forum_chat_join_attempts
   where user_id = auth.uid();

  if attempts >= 5 then
    raise exception 'Слишком много неверных попыток. Подождите десять минут';
  end if;

  select * into target from public.forum_chats where invite_code = lower(btrim(code));

  if target.id is null then
    insert into public.forum_chat_join_attempts (user_id) values (auth.uid());
    raise exception 'Такого приглашения нет — проверьте код';
  end if;

  if target.closed then
    raise exception 'Чат закрыт: %', coalesce(nullif(target.closed_reason, ''), 'без объяснения');
  end if;

  insert into public.forum_chat_members (chat_id, user_id, role)
  values (target.id, auth.uid(), 'member')
  on conflict (chat_id, user_id) do nothing;

  -- Успех: сбрасываем счётчик.
  delete from public.forum_chat_join_attempts where user_id = auth.uid();

  return target.id;
end;
$$;

revoke all on function public.forum_chat_join(text) from public, anon;
grant execute on function public.forum_chat_join(text) to authenticated;
