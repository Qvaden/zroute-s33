-- ── Автоматическая защита освобождённых ников ───────────────────────────────
-- Запустить один раз ПОСЛЕ supabase/nicks-verified.sql.
--
-- Все прежние ники из журнала, которые сейчас никем не заняты, резервируются
-- навсегда. Далее триггер делает это автоматически при каждом переименовании.

create or replace function public.forum_reserve_released_nick()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.nick is distinct from new.nick and btrim(old.nick) <> '' then
    insert into public.reserved_nicks (nick, added_by)
    values (public.forum_nick_key(old.nick), auth.uid())
    on conflict (nick) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_reserve_released_nick on public.forum_users;
create trigger forum_reserve_released_nick
  before update of nick on public.forum_users
  for each row execute function public.forum_reserve_released_nick();

insert into public.reserved_nicks (nick, added_by, created_at)
select public.forum_nick_key(h.old_nick), h.changed_by, h.created_at
  from public.forum_nick_history h
 where btrim(h.old_nick) <> ''
   and not exists (
     select 1
       from public.forum_users u
      where public.forum_nick_key(u.nick) = public.forum_nick_key(h.old_nick)
   )
on conflict (nick) do nothing;
