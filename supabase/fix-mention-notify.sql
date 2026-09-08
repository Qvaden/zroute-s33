/*
  ФИКС УВЕДОМЛЕНИЙ ОБ УПОМИНАНИЯХ В ПОСТАХ.

  В однажды применённую к базе версию supabase/rich-forum.sql попала строка
  `lower(nick_lower(nick)) = lower(nick_lower(nick))` — обращение к функции
  public.nick_lower(), которой в базе нет. Вставка поста с «@ник» падала
  на триггере forum_notify_post, и уведомления не доходили.

  Меняем функцию целиком (create or replace), чтобы такой же фикс можно было
  применить повторно — к одной строке он тоже сводится, но со временем
  расходится с файлом источника. Применять можно сколько угодно раз.
*/
create or replace function public.forum_notify_post()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  nick text;
  target uuid;
begin
  foreach nick in array public.forum_mentioned_nicks(new.title || ' ' || new.body)
  loop
    select id into target from public.forum_users where lower(forum_users.nick) = lower(nick);

    -- Себя не уведомляем: человек знает, что написал.
    if target is not null and target <> new.author_id then
      insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, post_id, preview)
      values (target, new.author_id, new.author_nick, 'mention', new.id, left(new.title, 120));
    end if;
  end loop;

  return new;
end;
$$;

-- Проверка: функция пересоздана без обращения к никому не известной функции.
-- Должно вернуться 0 строк.
select count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'forum_notify_post'
  and pg_get_functiondef(p.oid) ilike '%nick_lower%';