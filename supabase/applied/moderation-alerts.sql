-- Уведомления команды о накопившихся жалобах.
-- Запустить после moderation-automation.sql и rich-forum.sql.

create table if not exists public.forum_moderation_alerts (
  target_type text not null,
  target_id uuid not null,
  level text not null check (level in ('urgent', 'critical')),
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, level)
);

create or replace function public.forum_alert_moderators_on_reports()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_count integer; v_level text;
begin
  select count(*) into v_count from public.forum_reports
   where target_type = new.target_type and target_id = new.target_id and resolved = false;
  v_level := case when v_count >= 5 then 'critical' when v_count >= 3 then 'urgent' else null end;
  if v_level is null then return new; end if;
  insert into public.forum_moderation_alerts (target_type, target_id, level)
  values (new.target_type, new.target_id, v_level) on conflict do nothing;
  insert into public.forum_notifications (user_id, actor_nick, kind, post_id, preview)
  select u.id, 'Система', 'moderation',
         case when new.target_type = 'post' then new.target_id else c.post_id end,
         case when v_level = 'critical' then 'Критично: 5 жалоб на один материал' else 'Срочно: 3 жалобы на один материал' end
    from public.forum_users u left join public.forum_comments c on c.id = new.target_id
   where u.role in ('admin', 'moderator');
  return new;
end;
$$;

drop trigger if exists forum_alert_moderators_on_reports on public.forum_reports;
create trigger forum_alert_moderators_on_reports
  after insert on public.forum_reports
  for each row execute function public.forum_alert_moderators_on_reports();
