-- ── ЛИДЕР = АЛЬЯНС: одна отметка, привязанная к тегу ────────────────────────
--
-- Раньше «лидер» был просто boolean у профиля: непонятно, лидер какого альянса
-- и сколько лидеров на один альянс. Модель «лидер = альянс» меняет это так:
--
--   * у профиля появляется leader_of — тег альянса, лидером которого он является;
--   * пустой leader_of = «не лидер»;
--   * один лидер на альянс — гарантирует функция forum_set_leader, которую
--     вызывает панель: назначение нового лидера снимает предыдущего;
--   * is_leader остаётся и держится синхронно с leader_of (триггер), чтобы
--     не рассыпались бейджи, права создания чатов и лента — они читают is_leader.
--
-- РЕШЕНИЕ ПРОИЗВОДИТ ФУНКЦИЯ, А НЕ ЗАПРОС. Как у сброса пароля и удаления:
-- назначение лидера — действие владельца, и проверка «вызвавший — администратор»
-- живёт в базе, а не в панели. Панель лишь показывает кнопки и пересказывает
-- ошибки базы.
--
-- Запускать ПОСЛЕ supabase/chats.sql (там is_leader и forum_is_leader).
-- Повторный запуск безопасен.

-- ── Колонка лидерства ────────────────────────────────────────────────────────

alter table public.forum_users
  add column if not exists leader_of text not null default '';

-- ── Перенос существующих лидеров ─────────────────────────────────────────────
--
-- У кого лидерство уже стоит и тег альянса заполнен — лидерство наследуется.
-- Лидер без тега альянса в новой модели невозможен («лидер = альянс»), поэтому
-- такая отметка снимается: владелец разберётся и переназначит осознанно.
-- Уникальность тега лидеров в старой базе не проверялась, поэтому одинаковые
-- теги у двух лидеров схлопывает функция ниже — станет лидером один из них.

update public.forum_users
   set leader_of = alliance_tag
 where is_leader = true
   and alliance_tag <> ''
   and leader_of = '';

update public.forum_users
   set is_leader = false
 where is_leader = true
   and leader_of = '';

-- ├─ Синхронизация is_leader от leader_of ─────────────────────────────────────
--
-- Держим оба поля согласованными, чтобы не зависеть от того, кто пишет колонку.
-- Функция forum_set_leader и так пишет обе сразу, но триггер страхует прямые
-- правки и будущие миграции от рассинхрона.

create or replace function public.forum_user_leader_sync()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.is_leader := (btrim(new.leader_of) <> '');
  return new;
end;
$$;

drop trigger if exists forum_user_leader_sync on public.forum_users;
create trigger forum_user_leader_sync
  before insert or update of leader_of on public.forum_users
  for each row execute function public.forum_user_leader_sync();

-- ── Назначение и снятие лидера ───────────────────────────────────────────────

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
    -- Снятие: просто очищаем отметку. Созданные чаты остаются, участники видны
    -- на вкладке «Чаты».
    update public.forum_users
       set leader_of = ''
     where id = target_user;
    return;
  end if;

  -- Один лидер на альянс: сначала снимаем текущего держателя тега (не себя),
  -- потом назначаем. Два лидера одного альянса в базе исключены.
  update public.forum_users as previous_leader
     set leader_of = ''
   where previous_leader.leader_of = v_tag
     and previous_leader.id <> target_user;

  update public.forum_users
     set leader_of = v_tag
   where id = target_user;
end;
$$;

revoke all on function public.forum_set_leader(uuid, text) from public, anon;
grant execute on function public.forum_set_leader(uuid, text) to authenticated;
