-- Форум: метки, подписки на рейтинг, автоскрытие и еженедельный дайджест.
-- Запускать после schema.sql, site-data.sql, rich-forum.sql, profiles.sql,
-- nicks-verified.sql и topic-subscriptions.sql. Повторный запуск безопасен.

alter table public.forum_posts add column if not exists tags text[] not null default '{}';
alter table public.forum_posts add column if not exists auto_hidden boolean not null default false;
alter table public.forum_comments add column if not exists auto_hidden boolean not null default false;
alter table public.forum_posts drop constraint if exists forum_posts_tags_check;
alter table public.forum_posts add constraint forum_posts_tags_check check (
  cardinality(tags) <= 3 and tags <@ array['vs','recruiting','diplomacy','guide','question','event']::text[]
);

alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications add constraint forum_notifications_kind_check check
  (kind in ('mention','reply','reaction','subscription','alliance_rank','moderation','digest'));

-- Последняя опубликованная позиция. Редактор вызывает RPC после публикации
-- результатов; уведомление рождается только если место действительно сменилось.
create table if not exists public.forum_alliance_subscriptions (
  alliance_id text not null references public.site_alliances(id) on delete cascade,
  user_id uuid not null references public.forum_users(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (alliance_id, user_id)
);
alter table public.forum_alliance_subscriptions enable row level security;
drop policy if exists forum_alliance_subscriptions_read on public.forum_alliance_subscriptions;
create policy forum_alliance_subscriptions_read on public.forum_alliance_subscriptions for select using (user_id = auth.uid());
drop policy if exists forum_alliance_subscriptions_insert on public.forum_alliance_subscriptions;
create policy forum_alliance_subscriptions_insert on public.forum_alliance_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists forum_alliance_subscriptions_delete on public.forum_alliance_subscriptions;
create policy forum_alliance_subscriptions_delete on public.forum_alliance_subscriptions for delete using (user_id = auth.uid());
grant select, insert, delete on public.forum_alliance_subscriptions to authenticated;

create table if not exists public.forum_alliance_rank_snapshots (
  alliance_id text primary key references public.site_alliances(id) on delete cascade,
  place integer not null check (place > 0), points integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.forum_alliance_rank_changes (
  id bigserial primary key, alliance_id text not null references public.site_alliances(id) on delete cascade,
  old_place integer not null, new_place integer not null, created_at timestamptz not null default now()
);

create or replace function public.forum_record_alliance_rank_snapshot(p_rows jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare item jsonb; old_place integer; aid text; new_place integer; pts integer; aname text;
begin
  if not public.site_can_edit() then raise exception 'Недостаточно прав'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := item->>'alliance_id'; new_place := (item->>'place')::integer; pts := coalesce((item->>'points')::integer, 0);
    select place into old_place from public.forum_alliance_rank_snapshots where alliance_id = aid;
    select tag into aname from public.site_alliances where id = aid;
    if old_place is not null and old_place <> new_place then
      insert into public.forum_alliance_rank_changes (alliance_id, old_place, new_place)
        values (aid, old_place, new_place);
      insert into public.forum_notifications (user_id, actor_nick, kind, preview)
      select user_id, 'Рейтинг', 'alliance_rank',
        coalesce(aname, aid) || ': ' || old_place || ' → ' || new_place || ' место'
        from public.forum_alliance_subscriptions where alliance_id = aid;
    end if;
    insert into public.forum_alliance_rank_snapshots (alliance_id, place, points, updated_at)
      values (aid, new_place, pts, now())
      on conflict (alliance_id) do update set place = excluded.place, points = excluded.points, updated_at = excluded.updated_at;
  end loop;
end;
$$;
grant execute on function public.forum_record_alliance_rank_snapshot(jsonb) to authenticated;

-- Пять независимых жалоб временно скрывают материал. Модератор может снять
-- именно эту отметку, не смешивая её с ручным удалением по правилу.
create or replace function public.forum_auto_hide_reported_content()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from public.forum_reports
   where target_type = new.target_type and target_id = new.target_id and resolved = false;
  if n < 5 then return new; end if;
  if new.target_type = 'post' then
    update public.forum_posts set deleted = true, auto_hidden = true,
      deleted_reason = 'Скрыто автоматически после пяти жалоб: материал проверяет модератор.', deleted_at = now()
      where id = new.target_id and deleted = false;
  else
    update public.forum_comments set deleted = true, auto_hidden = true,
      deleted_reason = 'Скрыто автоматически после пяти жалоб: материал проверяет модератор.', deleted_at = now()
      where id = new.target_id and deleted = false;
  end if;
  return new;
end;
$$;
drop trigger if exists forum_auto_hide_reported_content on public.forum_reports;
create trigger forum_auto_hide_reported_content after insert on public.forum_reports
  for each row execute function public.forum_auto_hide_reported_content();

-- Еженедельный выпуск формируется задачей Supabase (cron/Edge Function),
-- которая вызывает эту функцию раз в неделю. В него попадают только живые
-- обсуждения с наибольшей активностью за семь дней.
create or replace function public.forum_send_weekly_digest()
returns void language plpgsql security definer set search_path = public as $$
declare digest text; ranks text;
begin
  select coalesce(string_agg(title, ' · '), 'За неделю пока не появилось обсуждений') into digest
    from (select title from public.forum_posts where deleted = false and created_at >= now() - interval '7 days'
          order by views desc, created_at desc limit 3) q;
  select coalesce(string_agg(tag || ' ' || old_place || '→' || new_place, ' · '), 'без изменений мест') into ranks
    from (select a.tag, c.old_place, c.new_place from public.forum_alliance_rank_changes c
          join public.site_alliances a on a.id=c.alliance_id
          where c.created_at >= now() - interval '7 days' order by c.created_at desc limit 5) q;
  insert into public.forum_notifications (user_id, actor_nick, kind, preview)
    select id, 'Дайджест', 'digest', left('Рейтинг: ' || ranks || '. Обсуждения: ' || digest, 120)
      from public.forum_users where banned = false;
end;
$$;
grant execute on function public.forum_send_weekly_digest() to service_role;

-- Добавляем метки и альянс автора в представления, не меняя порядок старых
-- колонок: новые поля строго в конце, чтобы PostgREST не сломал клиентов.
drop view if exists public.forum_post_list;
create view public.forum_post_list with (security_invoker = on) as
select p.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  (select count(*) from public.forum_comments c where c.post_id=p.id and not c.deleted) as comment_count,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='post' and target_id=p.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='post' and target_id=p.id and user_id=auth.uid()) my_reaction,
  coalesce((select sum(case reaction when 'like' then 1 when 'dislike' then -1 else 0 end) from public.forum_reactions where target_type='post' and target_id=p.id),0) score,
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'url',a.url) order by a.created_at) from public.forum_attachments a where a.target_type='post' and a.target_id=p.id),'[]'::jsonb) attachments,
  (select jsonb_build_object('id',pl.id,'question',pl.question,'multiple',pl.multiple,'closed',pl.closed,'total',(select count(distinct user_id) from public.forum_poll_votes v where v.poll_id=pl.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text,'votes',(select count(*) from public.forum_poll_votes v where v.option_id=o.id),'mine',exists(select 1 from public.forum_poll_votes v where v.option_id=o.id and v.user_id=auth.uid())) order by o.position,o.id) from public.forum_poll_options o where o.poll_id=pl.id),'[]'::jsonb)) from public.forum_polls pl where pl.post_id=p.id) poll
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;

drop view if exists public.forum_comment_list;
create view public.forum_comment_list with (security_invoker = on) as
select c.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='comment' and target_id=c.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='comment' and target_id=c.id and user_id=auth.uid()) my_reaction
from public.forum_comments c left join public.forum_profiles prof on prof.id=c.author_id;
grant select on public.forum_comment_list to anon, authenticated;

drop view if exists public.forum_report_list;
create view public.forum_report_list with (security_invoker = on) as
select r.*, reporter.nick as reporter_nick,
  case r.target_type when 'post' then (select title from public.forum_posts where id=r.target_id) else '' end as target_title,
  case r.target_type when 'post' then (select left(body,400) from public.forum_posts where id=r.target_id) else (select left(body,400) from public.forum_comments where id=r.target_id) end as target_body,
  case r.target_type when 'post' then (select author_nick from public.forum_posts where id=r.target_id) else (select author_nick from public.forum_comments where id=r.target_id) end as target_author_nick,
  case r.target_type when 'post' then r.target_id else (select post_id from public.forum_comments where id=r.target_id) end as target_post_id,
  case r.target_type when 'post' then (select auto_hidden from public.forum_posts where id=r.target_id) else (select auto_hidden from public.forum_comments where id=r.target_id) end as target_auto_hidden
from public.forum_reports r join public.forum_users reporter on reporter.id=r.reporter_id;
grant select on public.forum_report_list to authenticated;
