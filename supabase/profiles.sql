-- ПРОФИЛИ И ВЛОЖЕНИЯ.
--
-- Запускать ПОСЛЕ supabase/schema.sql. Порядок важен: здесь дополняется
-- таблица профилей, созданная там.
--
-- ЧТО ДОБАВЛЯЕТ:
--   1. Аватарку, подпись и альянс в профиль игрока.
--   2. Открытую страницу участника — что видно чужому человеку.
--   3. Вложения к постам и комментариям (скриншоты).
--   4. Хранилище для того и другого.

-- ── Профиль ─────────────────────────────────────────────────────────────────

alter table public.forum_users
  add column if not exists avatar_url text,
  /*
    Подпись под ником. Короткая нарочно: это строка «кто я на сервере»,
    а не второй пост. Длинную подпись люди используют как объявление,
    и лента превращается в рекламные щиты.
  */
  add column if not exists about text not null default '',
  /*
    Альянс — ТЕКСТОМ, а не ссылкой на site_alliances.
    Так сделано осознанно, хотя связь выглядела бы правильнее. Причины две:
    игрок может быть в альянсе, которого нет в таблице (мелкий, чужой,
    только созданный), и он меняет альянс чаще, чем обновляется таблица.
    Связь означала бы «выбери из списка или соври», а текст — «напиши как есть».
  */
  add column if not exists alliance_tag text not null default '',
  add column if not exists updated_at timestamptz not null default now();

-- ── Открытая страница участника ─────────────────────────────────────────────
--
-- Профили целиком читать нельзя: там даты регистрации и запреты, а публичный
-- список «кто забанен» — готовый инструмент насмешек (см. правила доступа
-- в schema.sql). Но страница участника нужна открытой: нажал на ник в ленте —
-- увидел, кто это.
--
-- Поэтому представление отдаёт РОВНО то, что можно показать чужому человеку:
-- ник, аватарку, подпись, альянс, дату регистрации и счётчики. Запретов
-- и служебных полей здесь нет вовсе — не «скрыты», а не выбраны.

create or replace view public.forum_profiles
with (security_invoker = on) as
select
  u.id,
  u.nick,
  u.avatar_url,
  u.about,
  u.alliance_tag,
  u.role,
  u.created_at,
  (select count(*) from public.forum_posts p
     where p.author_id = u.id and p.deleted = false) as post_count,
  (select count(*) from public.forum_comments c
     where c.author_id = u.id and c.deleted = false) as comment_count,
  /*
    Сколько согласий собрали его посты. Считается по реакциям, а не хранится
    числом: хранимый счётчик разошёлся бы с правдой при первом же удалении
    реакции, и разошёлся бы молча.
  */
  coalesce((
    select count(*)
      from public.forum_reactions r
      join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

/*
  Своё правим сами.

  Политика в schema.sql пускает к профилям только модерацию — она писалась
  под запреты и роли. Профиль же человек обязан править сам, иначе смена
  аватарки становится обращением к администратору.

  Что менять нельзя — держит триггер ниже: ник, роль, признаки запрета.
  Разделение то же, что у постов: политика отвечает «можно ли трогать строку»,
  триггер — «какие поля».
*/
drop policy if exists forum_users_self on public.forum_users;
create policy forum_users_self on public.forum_users
  for update using (id = auth.uid()) with check (id = auth.uid());

/*
  Дополняем существующий охранник профилей: он уже запрещает менять ник, роль
  и дату регистрации. Здесь добавляется проверка длины подписи и тега —
  в базе, а не только в браузере: проверку в браузере обходит запрос мимо сайта.
*/
create or replace function public.forum_users_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора пропускаем: там нет вошедшего, а у владельца
  -- проекта и так полный доступ. Без этого нельзя назначить первого админа.
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

  -- Ник и дату регистрации не меняет никто: на ник ссылаются копии в постах.
  new.nick := old.nick;
  new.created_at := old.created_at;
  new.id := old.id;

  -- Администратора нельзя забанить: это способ отобрать форум у владельца.
  if old.role = 'admin' then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
  end if;

  /*
    Запреты и право редактора себе не выдают и с себя не снимают. Без этого
    участник снимал бы себе тишину, а забаненный — бан, и наказание значило бы
    ровно ничего.
  */
  if not public.forum_is_staff() then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
    new.ban_reason := old.ban_reason;
  end if;
  if not public.forum_is_admin() then
    new.can_edit_site := old.can_edit_site;
  end if;

  -- Подпись и тег: пределы держит база, а не только форма в браузере.
  if char_length(coalesce(new.about, '')) > 200 then
    raise exception 'Подпись длиннее 200 символов';
  end if;
  if char_length(coalesce(new.alliance_tag, '')) > 12 then
    raise exception 'Тег альянса длиннее 12 символов';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists forum_users_guard on public.forum_users;
create trigger forum_users_guard
  before update on public.forum_users
  for each row execute function public.forum_users_guard();

-- ── Вложения ────────────────────────────────────────────────────────────────
--
-- Скриншоты к постам и комментариям.
--
-- ПОЧЕМУ ОТДЕЛЬНОЙ ТАБЛИЦЕЙ, А НЕ МАССИВОМ ССЫЛОК В ПОСТЕ. Массив был бы
-- проще, и у событий летописи он именно такой. Разница в том, кто загружает:
-- события вносит доверенный редактор, а посты — кто угодно.
--
-- Отдельная таблица даёт то, чего массив не даёт: видно, кто и когда загрузил
-- каждый файл, и можно удалить одно вложение, не трогая пост. Для модерации
-- это разница между «убрать неуместный скриншот» и «удалить пост целиком».

create table if not exists public.forum_attachments (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  author_id   uuid not null references public.forum_users (id) on delete cascade,
  url         text not null,
  -- Путь в хранилище: по нему файл удаляется. Из адреса его выковыривать
  -- пришлось бы разбором строки, а это ломается при смене адреса проекта.
  storage_path text not null,
  width       integer,
  height      integer,
  created_at  timestamptz not null default now()
);

create index if not exists forum_attachments_target_idx
  on public.forum_attachments (target_type, target_id);

alter table public.forum_attachments enable row level security;

drop policy if exists forum_attachments_read on public.forum_attachments;
create policy forum_attachments_read on public.forum_attachments
  for select using (true);

drop policy if exists forum_attachments_insert on public.forum_attachments;
create policy forum_attachments_insert on public.forum_attachments
  for insert with check (author_id = auth.uid() and public.forum_can_write());

/*
  Удалять — своё или модерации. Здесь удаление настоящее, в отличие от постов:
  вложение это файл, а не высказывание. Заглушка «здесь был скриншот» ничему
  не учит, а место в хранилище занимает.
*/
drop policy if exists forum_attachments_delete on public.forum_attachments;
create policy forum_attachments_delete on public.forum_attachments
  for delete using (author_id = auth.uid() or public.forum_is_staff());

-- Автора подставляет база: подделать нельзя даже запросом мимо сайта.
create or replace function public.forum_set_attachment_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.author_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists forum_attachments_author on public.forum_attachments;
create trigger forum_attachments_author
  before insert on public.forum_attachments
  for each row execute function public.forum_set_attachment_author();

/*
  Сколько вложений можно на одну запись.

  Предел нужен не из скупости: без него один человек залил бы гигабайт
  скриншотов в один пост, и бесплатное хранилище кончилось бы для всех.
  Четыре — столько, сколько влезает в один взгляд на телефоне.
*/
create or replace function public.forum_attachment_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (
    select count(*) from public.forum_attachments
     where target_type = new.target_type and target_id = new.target_id
  ) >= 4 then
    raise exception 'К одной записи можно приложить не больше четырёх картинок';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_attachments_limit on public.forum_attachments;
create trigger forum_attachments_limit
  before insert on public.forum_attachments
  for each row execute function public.forum_attachment_limit();

-- ── Хранилище ───────────────────────────────────────────────────────────────
--
-- Два отдельных хранилища, а не одно общее: у аватарок и вложений разные
-- правила жизни. Аватарку человек меняет и старая должна уходить; вложение
-- живёт со своим постом.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('forum-uploads', 'forum-uploads', true)
on conflict (id) do update set public = true;

/*
  Читать — всем: это открытый форум, картинки в постах должны показываться
  незарегистрированному человеку.
*/
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (bucket_id = 'avatars');

/*
  Загружать и удалять аватарку — только свою.

  Имя файла начинается с идентификатора владельца, и правило сравнивает его
  с вошедшим. Без этого любой участник перезаписал бы чужую аватарку: доступ
  на запись в хранилище не различает файлы сам по себе.
*/
drop policy if exists avatars_write on storage.objects;
create policy avatars_write on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update using (
    bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or public.forum_is_staff())
  );

drop policy if exists forum_uploads_read on storage.objects;
create policy forum_uploads_read on storage.objects
  for select using (bucket_id = 'forum-uploads');

drop policy if exists forum_uploads_write on storage.objects;
create policy forum_uploads_write on storage.objects
  for insert with check (
    bucket_id = 'forum-uploads'
    and public.forum_can_write()
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists forum_uploads_delete on storage.objects;
create policy forum_uploads_delete on storage.objects
  for delete using (
    bucket_id = 'forum-uploads'
    and (split_part(name, '/', 1) = auth.uid()::text or public.forum_is_staff())
  );

-- ── Лента с вложениями ──────────────────────────────────────────────────────
--
-- Пересобираем представления, чтобы лента отдавала и картинки, и аватарку
-- автора. Иначе на каждый пост шёл бы отдельный запрос за вложениями —
-- двадцать постов означали бы двадцать запросов.

create or replace view public.forum_post_list
with (security_invoker = on) as
select
  p.id,
  p.author_id,
  p.author_nick,
  /*
    Аватарка берётся связью с профилем, а НЕ копией в посте — в отличие от ника.
    Разница в том, что ник в старом посте должен остаться прежним (на него
    ссылаются как на автора того высказывания), а аватарка это «как человек
    выглядит сейчас»: сменив её, он ожидает увидеть новую везде.

    Связь здесь безопасна: forum_profiles открыт для чтения всем, в отличие
    от forum_users.
  */
  prof.avatar_url as author_avatar,
  prof.alliance_tag as author_alliance,
  p.category,
  p.title,
  p.body,
  p.created_at,
  p.edited_at,
  p.pinned,
  p.deleted,
  p.deleted_reason,
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
  ), '[]'::jsonb) as attachments
from public.forum_posts p
left join public.forum_profiles prof on prof.id = p.author_id;

create or replace view public.forum_comment_list
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.author_id,
  c.author_nick,
  prof.avatar_url as author_avatar,
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
  ), '[]'::jsonb) as attachments
from public.forum_comments c
left join public.forum_profiles prof on prof.id = c.author_id;
