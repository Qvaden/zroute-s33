-- ── Подписки на темы форума ─────────────────────────────────────────────────
-- Запустить после rich-forum.sql.

create table if not exists public.forum_topic_subscriptions (
  post_id    uuid not null references public.forum_posts(id) on delete cascade,
  user_id    uuid not null references public.forum_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.forum_topic_subscriptions enable row level security;
drop policy if exists forum_topic_subscriptions_read on public.forum_topic_subscriptions;
create policy forum_topic_subscriptions_read on public.forum_topic_subscriptions
  for select using (user_id = auth.uid());
drop policy if exists forum_topic_subscriptions_write on public.forum_topic_subscriptions;
create policy forum_topic_subscriptions_write on public.forum_topic_subscriptions
  for insert with check (user_id = auth.uid());
drop policy if exists forum_topic_subscriptions_delete on public.forum_topic_subscriptions;
create policy forum_topic_subscriptions_delete on public.forum_topic_subscriptions
  for delete using (user_id = auth.uid());
grant select, insert, delete on public.forum_topic_subscriptions to authenticated;

alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications add constraint forum_notifications_kind_check
  check (kind in ('mention', 'reply', 'reaction', 'subscription', 'alliance_rank', 'moderation', 'digest'));

create or replace function public.forum_notify_topic_subscribers()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.forum_notifications
    (user_id, actor_id, actor_nick, kind, post_id, comment_id, preview)
  select s.user_id, new.author_id, new.author_nick, 'subscription', new.post_id,
         new.id, left(new.body, 120)
    from public.forum_topic_subscriptions s
   where s.post_id = new.post_id
     and s.user_id <> new.author_id
     and not exists (
       select 1 from public.forum_notifications n
        where n.user_id = s.user_id and n.comment_id = new.id
     );
  return new;
end;
$$;

drop trigger if exists forum_notify_topic_subscribers on public.forum_comments;
create trigger forum_notify_topic_subscribers
  after insert on public.forum_comments
  for each row execute function public.forum_notify_topic_subscribers();
