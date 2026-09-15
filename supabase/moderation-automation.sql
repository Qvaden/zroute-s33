-- ── Очередь и журнал модерации ──────────────────────────────────────────────
-- Запустить после schema.sql. Повторный запуск безопасен.

create table if not exists public.forum_moderation_actions (
  id          bigserial primary key,
  actor_id    uuid references public.forum_users(id) on delete set null,
  actor_nick  text not null default '',
  target_type text not null,
  target_id   text not null,
  target_nick text not null default '',
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists forum_moderation_actions_recent_idx
  on public.forum_moderation_actions (created_at desc);

alter table public.forum_moderation_actions enable row level security;
drop policy if exists forum_moderation_actions_read on public.forum_moderation_actions;
create policy forum_moderation_actions_read on public.forum_moderation_actions
  for select using (public.forum_is_staff());

create or replace function public.forum_write_moderation_action(
  p_target_type text, p_target_id text, p_target_nick text,
  p_action text, p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_actor_nick text;
begin
  if not public.forum_is_staff() then return; end if;
  select nick into v_actor_nick from public.forum_users where id = auth.uid();
  insert into public.forum_moderation_actions
    (actor_id, actor_nick, target_type, target_id, target_nick, action, details)
  values
    (auth.uid(), coalesce(v_actor_nick, ''), p_target_type, p_target_id,
     coalesce(p_target_nick, ''), p_action, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.forum_audit_report_resolution()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.resolved = false and new.resolved = true then
    perform public.forum_write_moderation_action(
      'report', new.id::text, '', 'report_resolved',
      jsonb_build_object('target_type', new.target_type, 'target_id', new.target_id,
                         'rule_id', new.rule_id));
  end if;
  return new;
end;
$$;

drop trigger if exists forum_audit_report_resolution on public.forum_reports;
create trigger forum_audit_report_resolution
  after update of resolved on public.forum_reports
  for each row execute function public.forum_audit_report_resolution();

create or replace function public.forum_audit_content_removal()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.deleted = false and new.deleted = true then
    perform public.forum_write_moderation_action(
      tg_argv[0], new.id::text, new.author_nick, 'content_removed',
      jsonb_build_object('reason', coalesce(new.deleted_reason, '')));
  end if;
  return new;
end;
$$;

drop trigger if exists forum_audit_post_removal on public.forum_posts;
create trigger forum_audit_post_removal
  after update of deleted on public.forum_posts
  for each row execute function public.forum_audit_content_removal('post');

drop trigger if exists forum_audit_comment_removal on public.forum_comments;
create trigger forum_audit_comment_removal
  after update of deleted on public.forum_comments
  for each row execute function public.forum_audit_content_removal('comment');

create or replace function public.forum_audit_restriction()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.banned is distinct from new.banned
     or old.muted_until is distinct from new.muted_until then
    perform public.forum_write_moderation_action(
      'user', new.id::text, new.nick, 'restriction_changed',
      jsonb_build_object('banned', new.banned, 'muted_until', new.muted_until,
                         'reason', coalesce(new.ban_reason, '')));
  end if;
  return new;
end;
$$;

drop trigger if exists forum_audit_restriction on public.forum_users;
create trigger forum_audit_restriction
  after update of banned, muted_until on public.forum_users
  for each row execute function public.forum_audit_restriction();

create or replace view public.forum_moderation_queue
with (security_invoker = on) as
select r.target_type, r.target_id, count(*)::integer as report_count,
       min(r.created_at) as first_report_at, max(r.created_at) as last_report_at,
       case when count(*) >= 5 then 'critical'
            when count(*) >= 3 then 'urgent'
            else 'normal' end as priority
  from public.forum_reports r
 where r.resolved = false
 group by r.target_type, r.target_id;

grant select on public.forum_moderation_actions, public.forum_moderation_queue to authenticated;
