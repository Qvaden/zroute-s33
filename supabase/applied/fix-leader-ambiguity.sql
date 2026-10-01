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

  if exists (
    select 1
      from pg_attribute
     where attrelid = 'public.forum_users'::regclass
       and attname = 'is_verified'
       and not attisdropped
  ) then
    execute '
      update public.forum_users
         set leader_of = $1,
             is_verified = true,
             verified_by = $2,
             verified_at = coalesce(verified_at, now())
       where id = $3'
      using v_tag, auth.uid(), target_user;
  else
    update public.forum_users
       set leader_of = v_tag
     where id = target_user;
  end if;
end;
$$;

revoke all on function public.forum_set_leader(uuid, text) from public, anon;
grant execute on function public.forum_set_leader(uuid, text) to authenticated;
