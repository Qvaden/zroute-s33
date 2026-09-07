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

-- ── Порядок пересоздания представлений ──────────────────────────────────────
--
-- Лента и комментарии ссылаются на forum_profiles, поэтому удалить профиль,
-- пока они существуют, нельзя:
--
--   cannot drop view forum_profiles because other objects depend on it
--
-- Postgres предлагает DROP ... CASCADE, и это плохой совет для файла, который
-- запускают повторно: CASCADE снесёт всё зависимое молча, включая то, о чём
-- автор файла не думал. Однажды он унесёт вместе с собой что-то нужное,
-- и произойдёт это без единого сообщения.
--
-- Правильный путь — удалить зависимые самому, в обратном порядке зависимости.
-- Тогда видно, что именно удаляется, и оба представления тут же создаются
-- заново в конце файла.
--
-- Строки ниже стоят в самом начале НАРОЧНО: до них файл ещё ничего не менял,
-- и порядок «сначала убрать зависимые, потом трогать основу» соблюдён явно.

drop view if exists public.forum_post_list;
drop view if exists public.forum_comment_list;
drop view if exists public.forum_profiles;

-- ── Владелец ровно один ─────────────────────────────────────────────────────
--
-- Владелец — это роль 'admin', и запись с ней может быть только одна.
-- Правило держит индекс, а не договорённость: обойти его нельзя даже запросом
-- мимо сайта.
--
-- ПОЧЕМУ ЭТО ВАЖНО. Роль владельца даёт власть над самими правами: назначать
-- модераторов и сбрасывать пароли. Второй владелец означал бы, что владельца
-- нет вовсе — любой из двоих может снять права другому, и спор об этом
-- решается не правилами, а скоростью нажатия.
--
-- Модераторов при этом сколько угодно: они не могут менять роли, поэтому
-- их число ничего не решает.

create unique index if not exists forum_users_single_owner
  on public.forum_users ((role = 'admin'))
  where role = 'admin';

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
-- Профили целиком читать нельзя: там запреты и признаки доверия, а публичный
-- список «кто забанен» — готовый инструмент насмешек (см. правила доступа
-- в schema.sql). Но страница участника нужна открытой: нажал на ник в ленте —
-- увидел, кто это.
--
-- ПОЧЕМУ ЗДЕСЬ security_invoker = OFF, ХОТЯ У ОСТАЛЬНЫХ ПРЕДСТАВЛЕНИЙ ON.
--
-- Это единственное исключение в схеме, и оно исправляет ошибку, допущенную
-- дважды подряд.
--
-- Сначала лента соединялась с forum_users напрямую — и оказалась пустой для
-- всех, кроме собственных постов: читать профили разрешено только свой.
-- Тогда открытые поля вынесли в это представление, но оставили на нём
-- security_invoker = on, то есть «читать правами того, кто спросил». А это
-- ровно та же проверка, что на самой таблице: гость снова не видел ничего —
-- ни аватарок в ленте, ни чужих страниц профиля.
--
-- Правильное устройство: представление САМО является границей доступа. Оно
-- отбирает поля, которые можно показать кому угодно, и читается правами
-- владельца — поверх правил на таблице. Так работает обычный приём «публичный
-- профиль»: секрет закрывается не проверкой на каждый запрос, а тем, что
-- секретных полей здесь просто нет.
--
-- ЧТО ЗДЕСЬ ЕСТЬ: ник, аватарка, подпись, альянс, роль, дата регистрации,
-- счётчики. Всё это и так видно в ленте.
--
-- ЧЕГО НЕТ И БЫТЬ НЕ ДОЛЖНО: banned, ban_reason, muted_until, can_edit_site.
-- Не «скрыты», а не выбраны — за этим следит тест.
--
-- Удалено оно уже в начале файла, вместе с зависимыми от него лентой
-- и комментариями: иначе Postgres не даёт его тронуть.

create view public.forum_profiles
with (security_invoker = off) as
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
  Дополняем существующий охранник профилей: он уже запрещает менять ник
  и дату регистрации. Здесь — правила ролей после сокращения до трёх
  и проверка длины подписи и тега.

  Пределы проверяются в базе, а не только в браузере: проверку в браузере
  обходит запрос мимо сайта.
*/
create or replace function public.forum_users_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора пропускаем: там нет вошедшего, а у владельца
  -- проекта и так полный доступ. Без этого нельзя назначить владельца.
  if auth.uid() is null then
    return new;
  end if;

  if new.role <> old.role then
    /*
      РОЛЬ МЕНЯЕТ ТОЛЬКО ВЛАДЕЛЕЦ.

      Это единственная граница между ним и модератором, и она принципиальна:
      иначе модератор назначил бы владельцем себя, и разница между ролями
      исчезла бы при первом же желании.
    */
    if not public.forum_is_admin() then
      raise exception 'Роль меняет только владелец';
    end if;

    /*
      Владелец не может перестать быть владельцем через панель.

      Второй владелец невозможен по устройству (уникальный индекс выше),
      поэтому «передать сайт» — это два действия: снять роль с себя и выдать
      другому. Между ними форум остался бы без владельца, а вернуть роль
      было бы можно только запросом в базу руками.

      Такая передача делается осознанно, из SQL-редактора, а не нажатием.
    */
    if old.role = 'admin' then
      raise exception 'Роль владельца через панель не снимается — только запросом в базу';
    end if;
  end if;

  -- Ник и дату регистрации не меняет никто: на ник ссылаются копии в постах.
  new.nick := old.nick;
  new.created_at := old.created_at;
  new.id := old.id;

  -- Владельца нельзя забанить: это способ отобрать сайт у хозяина.
  if old.role = 'admin' then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
  end if;

  /*
    Запреты себе не выдают и с себя не снимают. Без этого участник снимал бы
    себе тишину, а забаненный — бан, и наказание значило бы ровно ничего.
  */
  if not public.forum_is_staff() then
    new.banned := old.banned;
    new.muted_until := old.muted_until;
    new.ban_reason := old.ban_reason;
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
  Двенадцать — заметно больше прежних четырёх, но всё ещё конечное число:
  совершенно безграничная загрузка на бесплатном хранилище кончилась бы
  им же. Значение повторяет CONFIG.forum.limits.attachmentsMax в config.js.
*/
create or replace function public.forum_attachment_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (
    select count(*) from public.forum_attachments
     where target_type = new.target_type and target_id = new.target_id
  ) >= 12 then
    raise exception 'К одной записи можно приложить не больше двенадцати картинок';
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
--
-- ПОЧЕМУ ЭТИ ДВА НЕЛЬЗЯ «ЗАМЕНИТЬ» НА МЕСТЕ.
--
-- «Заменить» представление можно только теми же колонками в том же порядке.
-- Здесь добавляется author_avatar сразу после ника — то есть в середину, —
-- и Postgres отказывается, считая это переименованием третьей колонки:
--
--   cannot change name of view column "category" to "author_avatar"
--
-- Совет из подсказки («используйте ALTER VIEW RENAME COLUMN») не годится:
-- колонка не переименовывается, а вставляется.
--
-- Удалены они в начале файла — там же, где и forum_profiles, от которого
-- зависят. Данные при этом в безопасности: представление не хранит ничего,
-- это сохранённый запрос.

create view public.forum_post_list
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
  /*
    Роль автора идёт в ленту, чтобы метку «владелец» или «модератор» было видно
    рядом с ником. Это не украшение: читатель должен понимать, кто перед ним,
    когда речь идёт о правилах или решении по жалобе — иначе слово модератора
    ничем не отличается от слова любого участника.
  */
  prof.role as author_role,
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

create view public.forum_comment_list
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.author_id,
  c.author_nick,
  prof.avatar_url as author_avatar,
  prof.role as author_role,
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