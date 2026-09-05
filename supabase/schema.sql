-- ФОРУМ: СХЕМА И ПРАВА.
--
-- Это единственное место, где живёт настоящая защита форума. Проверки
-- в браузере (src/forum/rules.js) нужны для понятных сообщений: их можно
-- обойти, отправив запрос мимо сайта. Всё, что ниже, обойти нельзя —
-- база отказывает сама.
--
-- КАК ЗАПУСТИТЬ. Supabase → SQL Editor → вставить целиком → Run.
-- Скрипт можно выполнять повторно: он не падает на уже созданном.
--
-- ЧТО ВАЖНО ЗНАТЬ ПРО ВХОД БЕЗ ПОЧТЫ. Ник превращается в адрес вида
-- «ник@users.zroute-s33.local» — домен вымышленный, письма туда не уходят.
-- Поэтому в настройках проекта надо ВЫКЛЮЧИТЬ подтверждение почты
-- (Authentication → Sign In / Providers → Email → Confirm email = off),
-- иначе регистрация будет ждать письма, которого никогда не будет.

-- ── Профили ─────────────────────────────────────────────────────────────────
--
-- Профиль отдельно от системы входа: ник, роль и ограничения нужны в запросах
-- и в политиках доступа, а внутрь auth.users политики не смотрят.

create table if not exists public.forum_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  nick        text not null,
  role        text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  created_at  timestamptz not null default now(),
  muted_until timestamptz,
  banned      boolean not null default false,
  ban_reason  text not null default ''
);

-- Уникальность ника без учёта регистра: «Qvaden» и «qvaden» обязаны быть
-- одним человеком, иначе ник подделывается регистром.
create unique index if not exists forum_users_nick_key
  on public.forum_users (lower(nick));

-- ── Записи ──────────────────────────────────────────────────────────────────

create table if not exists public.forum_posts (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null references public.forum_users (id) on delete cascade,
  /*
    Ник автора лежит КОПИЕЙ рядом с постом, а не берётся связью из профиля.

    Так было задумано с самого начала (см. ForumPost в src/forum/contract.js),
    но первая версия схемы всё же соединяла таблицы — и лента оказалась пустой
    для всех. Причина: читать профили разрешено только свой и только модерации,
    поэтому соединение выбрасывало все посты, кроме собственных. Выглядело это
    как «форум пуст», хотя посты лежали на месте.

    Открыть профили целиком было бы неправильно: там даты регистрации и запреты,
    и публичный список «кто забанен» — готовый инструмент насмешек. Ник же
    и так виден на каждом посте, поэтому копия ничего не раскрывает.

    Плата за копию: смена ника не переписывает старые посты. Смены ника пока
    и нет; если появится — надо будет обновлять копии, и это придётся помнить.
  */
  author_nick    text not null default '',
  category       text not null check (category in ('news','vs','chronicle','ally','help','offtop')),
  title          text not null check (char_length(title) between 3 and 140),
  body           text not null check (char_length(body) between 1 and 8000),
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  pinned         boolean not null default false,
  deleted        boolean not null default false,
  deleted_reason text not null default '',
  deleted_at     timestamptz
);

-- Для баз, созданных первой версией схемы: колонки там ещё нет.
alter table public.forum_posts add column if not exists author_nick text not null default '';

create index if not exists forum_posts_feed_idx
  on public.forum_posts (pinned desc, created_at desc);
create index if not exists forum_posts_cat_idx
  on public.forum_posts (category, created_at desc);

create table if not exists public.forum_comments (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references public.forum_posts (id) on delete cascade,
  author_id      uuid not null references public.forum_users (id) on delete cascade,
  -- Копией, по той же причине, что и у поста.
  author_nick    text not null default '',
  body           text not null check (char_length(body) between 1 and 2000),
  created_at     timestamptz not null default now(),
  deleted        boolean not null default false,
  deleted_reason text not null default '',
  deleted_at     timestamptz
);

alter table public.forum_comments add column if not exists author_nick text not null default '';

create index if not exists forum_comments_post_idx
  on public.forum_comments (post_id, created_at);

-- ── Реакции ─────────────────────────────────────────────────────────────────
--
-- Реакция у человека ОДНА на запись, и это устройство таблицы, а не проверка
-- в коде: автор входит в первичный ключ. Поставить лайк и дизлайк разом
-- физически нельзя — вторая реакция заменяет первую.

create table if not exists public.forum_reactions (
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  user_id     uuid not null references public.forum_users (id) on delete cascade,
  reaction    text not null check (reaction in ('like','dislike','fire','laugh','wow','sad','salute')),
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, user_id)
);

create index if not exists forum_reactions_target_idx
  on public.forum_reactions (target_type, target_id);

-- ── Жалобы ──────────────────────────────────────────────────────────────────
--
-- Смысл написанного оценивает человек, а не программа: списка запрещённых слов
-- в проекте нет. Поэтому жалоба — рабочий инструмент модерации.

create table if not exists public.forum_reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('post', 'comment')),
  target_id    uuid not null,
  reporter_id  uuid not null references public.forum_users (id) on delete cascade,
  rule_id      text not null,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  resolved     boolean not null default false,
  -- Повторная жалоба того же человека на то же — не новая жалоба.
  unique (target_type, target_id, reporter_id)
);

-- ── Кто я и что мне можно ───────────────────────────────────────────────────
--
-- Вспомогательные функции: политики ниже читаются как правила, а не как
-- подзапросы. `security definer` нужен, чтобы функция сама могла посмотреть
-- в forum_users, не упираясь в политику этой же таблицы.

create or replace function public.forum_is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid() and role in ('admin', 'moderator')
  );
$$;

create or replace function public.forum_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Право писать: не забанен и не в тишине. Одна функция на посты
-- и комментарии — иначе запрет обходился бы через комментарии.
create or replace function public.forum_can_write()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid()
      and banned = false
      and (muted_until is null or muted_until < now())
  );
$$;

-- ── Профиль создаётся сам ───────────────────────────────────────────────────
--
-- Ник приходит в метаданных при регистрации. Создавать профиль запросом
-- из браузера нельзя: между регистрацией и вторым запросом человек может
-- закрыть страницу, и остался бы аккаунт без ника.

create or replace function public.forum_on_signup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  raw_nick text;
begin
  raw_nick := coalesce(new.raw_user_meta_data ->> 'nick', '');
  if raw_nick = '' then
    -- Первая часть адреса — на случай регистрации мимо сайта.
    raw_nick := split_part(new.email, '@', 1);
  end if;

  insert into public.forum_users (id, nick)
  values (new.id, raw_nick)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists forum_on_signup on auth.users;
create trigger forum_on_signup
  after insert on auth.users
  for each row execute function public.forum_on_signup();

-- ── Права ───────────────────────────────────────────────────────────────────
--
-- Ниже начинается собственно защита. Без включённого RLS публичный ключ
-- давал бы полный доступ к таблицам, поэтому строки `enable row level
-- security` — самые важные в файле.

alter table public.forum_users     enable row level security;
alter table public.forum_posts     enable row level security;
alter table public.forum_comments  enable row level security;
alter table public.forum_reactions enable row level security;
alter table public.forum_reports   enable row level security;

-- Профили ───────────────────────────────────────────────────────────────────

drop policy if exists forum_users_read on public.forum_users;
create policy forum_users_read on public.forum_users
  for select using (
    -- Свой профиль видит каждый, все профили — только модерация.
    -- Ники и так видны в постах, но список всех участников с датами
    -- регистрации незачем отдавать кому угодно.
    id = auth.uid() or public.forum_is_staff()
  );

-- Профиль правит только модерация: иначе участник назначил бы себя
-- администратором и снял бы себе бан.
drop policy if exists forum_users_moderate on public.forum_users;
create policy forum_users_moderate on public.forum_users
  for update using (public.forum_is_staff())
  with check (public.forum_is_staff());

-- Посты ─────────────────────────────────────────────────────────────────────

drop policy if exists forum_posts_read on public.forum_posts;
create policy forum_posts_read on public.forum_posts
  -- Читать может кто угодно, включая незарегистрированных: форум сообщества
  -- закрытым быть не должен. Удалённые тоже видны — на их месте остаётся
  -- заглушка с причиной, см. рассуждение в src/forum/contract.js.
  for select using (true);

drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write()
    -- Создать пост уже удалённым или закреплённым нельзя.
    and deleted = false
    and pinned = false
  );

drop policy if exists forum_posts_update_own on public.forum_posts;
create policy forum_posts_update_own on public.forum_posts
  for update using (author_id = auth.uid() and deleted = false)
  with check (
    author_id = auth.uid()
    -- Автор не может закрепить свой пост и не может подменить автора.
    and pinned = (select pinned from public.forum_posts p where p.id = id)
  );

drop policy if exists forum_posts_moderate on public.forum_posts;
create policy forum_posts_moderate on public.forum_posts
  for update using (public.forum_is_staff())
  with check (public.forum_is_staff());

-- Стирать строки нельзя никому, включая администратора: удаление — это
-- отметка с причиной. Политики `for delete` нет вовсе, поэтому запрос
-- на удаление отвергается по умолчанию.

-- Комментарии ───────────────────────────────────────────────────────────────

drop policy if exists forum_comments_read on public.forum_comments;
create policy forum_comments_read on public.forum_comments
  for select using (true);

drop policy if exists forum_comments_insert on public.forum_comments;
create policy forum_comments_insert on public.forum_comments
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write()
    and deleted = false
    -- Отвечать в удалённой теме незачем: обсуждать нечего.
    and exists (select 1 from public.forum_posts p where p.id = post_id and p.deleted = false)
  );

drop policy if exists forum_comments_update_own on public.forum_comments;
create policy forum_comments_update_own on public.forum_comments
  for update using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists forum_comments_moderate on public.forum_comments;
create policy forum_comments_moderate on public.forum_comments
  for update using (public.forum_is_staff())
  with check (public.forum_is_staff());

-- Реакции ───────────────────────────────────────────────────────────────────

drop policy if exists forum_reactions_read on public.forum_reactions;
create policy forum_reactions_read on public.forum_reactions
  for select using (true);

drop policy if exists forum_reactions_own on public.forum_reactions;
create policy forum_reactions_own on public.forum_reactions
  for insert with check (user_id = auth.uid() and public.forum_can_write());

drop policy if exists forum_reactions_change on public.forum_reactions;
create policy forum_reactions_change on public.forum_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists forum_reactions_drop on public.forum_reactions;
create policy forum_reactions_drop on public.forum_reactions
  -- Свою реакцию можно снять. Чужую — нет, и это единственное место
  -- в схеме, где строка действительно удаляется.
  for delete using (user_id = auth.uid());

-- Жалобы ────────────────────────────────────────────────────────────────────

drop policy if exists forum_reports_insert on public.forum_reports;
create policy forum_reports_insert on public.forum_reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists forum_reports_read on public.forum_reports;
create policy forum_reports_read on public.forum_reports
  -- Жалобы видит только модерация. Открытый список — готовый инструмент
  -- травли: видно, кто на кого пожаловался.
  for select using (public.forum_is_staff());

drop policy if exists forum_reports_resolve on public.forum_reports;
create policy forum_reports_resolve on public.forum_reports
  for update using (public.forum_is_staff()) with check (public.forum_is_staff());

-- ── Автор записи подставляется сам ──────────────────────────────────────────
--
-- Браузер не присылает ни author_id, ни ник: подставляем из сессии. Так
-- подделать авторство нельзя даже запросом мимо сайта.

create or replace function public.forum_set_author()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.author_id := auth.uid();
  /*
    Ник тоже берём из профиля здесь, а не доверяем браузеру: иначе можно
    было бы опубликовать пост под чужим ником, прислав его в запросе.
  */
  new.author_nick := coalesce(
    (select nick from public.forum_users where id = auth.uid()),
    ''
  );
  return new;
end;
$$;

drop trigger if exists forum_posts_author on public.forum_posts;
create trigger forum_posts_author
  before insert on public.forum_posts
  for each row execute function public.forum_set_author();

drop trigger if exists forum_comments_author on public.forum_comments;
create trigger forum_comments_author
  before insert on public.forum_comments
  for each row execute function public.forum_set_author();

create or replace function public.forum_set_reporter()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.reporter_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists forum_reports_reporter on public.forum_reports;
create trigger forum_reports_reporter
  before insert on public.forum_reports
  for each row execute function public.forum_set_reporter();

create or replace function public.forum_set_reaction_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists forum_reactions_user on public.forum_reactions;
create trigger forum_reactions_user
  before insert on public.forum_reactions
  for each row execute function public.forum_set_reaction_user();

-- ── Что читает лента ────────────────────────────────────────────────────────
--
-- Ленте нужны счётчики: сколько комментариев, сколько каждой реакции и что
-- поставил я. Считать это в браузере означало бы тащить все реакции всех
-- постов целиком, поэтому считает база одним запросом.
--
-- security_invoker = on обязателен: без него представление читало бы данные
-- правами своего владельца, то есть в обход политик выше.
--
-- ЗДЕСЬ НЕТ СОЕДИНЕНИЯ С ПРОФИЛЯМИ, и это главное исправление первой версии.
-- Соединение с forum_users выбрасывало из ленты все посты, кроме собственных:
-- читать профили разрешено только свой и только модерации. Лента выглядела
-- пустой при полной базе постов. Ник теперь лежит копией в самой записи.

create or replace view public.forum_post_list
with (security_invoker = on) as
select
  p.id,
  p.author_id,
  p.author_nick,
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
  ) as score
from public.forum_posts p;

create or replace view public.forum_comment_list
with (security_invoker = on) as
select
  c.id,
  c.post_id,
  c.author_id,
  c.author_nick,
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
    where target_type = 'comment' and target_id = c.id and user_id = auth.uid()) as my_reaction
from public.forum_comments c;

/*
  Жалоба вместе с тем, на что жалуются: иначе панель делала бы по запросу
  на каждую строку списка.

  Соединение с профилями здесь допустимо: список видит только модерация,
  и ей профили читать разрешено.
*/
create or replace view public.forum_report_list
with (security_invoker = on) as
select
  r.id,
  r.target_type,
  r.target_id,
  r.reporter_id,
  reporter.nick as reporter_nick,
  r.rule_id,
  r.note,
  r.created_at,
  r.resolved,
  case r.target_type
    when 'post' then (select title from public.forum_posts where id = r.target_id)
    else ''
  end as target_title,
  case r.target_type
    when 'post' then (select left(body, 400) from public.forum_posts where id = r.target_id)
    else (select left(body, 400) from public.forum_comments where id = r.target_id)
  end as target_body,
  case r.target_type
    when 'post' then (select author_nick from public.forum_posts where id = r.target_id)
    else (select author_nick from public.forum_comments where id = r.target_id)
  end as target_author_nick
from public.forum_reports r
join public.forum_users reporter on reporter.id = r.reporter_id;

-- ── СБРОС ПАРОЛЯ АДМИНИСТРАТОРОМ ────────────────────────────────────────────
--
-- Почты нет, значит «восстановить самому» невозможно: пароль меняет
-- администратор из панели.
--
-- ПОЧЕМУ ЭТО ФУНКЦИЯ В БАЗЕ, А НЕ ЗАПРОС ИЗ ПАНЕЛИ. Менять чужой пароль
-- напрямую может только служебный ключ (service_role), а он даёт полный
-- доступ ко всей базе в обход всех политик выше. Панель открывается
-- в браузере — значит такой ключ там появиться не должен ни при каких
-- условиях: один скриншот с открытой консолью, и форум чужой.
--
-- Функция решает это тем, что служебных прав не выдаёт никому: она сама
-- проверяет, что вызвавший — администратор, и только после этого пишет
-- новый пароль. Наружу уходит право «сбросить пароль», а не право «всё».

create or replace function public.forum_admin_reset_password(
  target_user uuid,
  new_password text
)
returns void
language plpgsql security definer set search_path = public, auth, extensions
as $$
begin
  if not public.forum_is_admin() then
    raise exception 'Сбрасывать пароли может только администратор';
  end if;

  if char_length(new_password) < 8 then
    raise exception 'Пароль короче 8 символов';
  end if;

  -- Себе пароль так менять незачем: для этого есть обычная смена пароля,
  -- а запрет закрывает случай «администратор случайно сбросил себе».
  if target_user = auth.uid() then
    raise exception 'Свой пароль меняйте обычным способом';
  end if;

  if not exists (select 1 from public.forum_users where id = target_user) then
    raise exception 'Игрок не найден';
  end if;

  -- Пароль хеширует сам Postgres (bcrypt). Своей криптографии в проекте
  -- нет намеренно: самодельное хеширование хуже отсутствия пароля,
  -- потому что выглядит защитой.
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target_user;
end;
$$;

-- Право вызывать функцию — только вошедшим. Проверку «администратор ли»
-- делает сама функция; здесь закрываем её от анонимных запросов.
revoke all on function public.forum_admin_reset_password(uuid, text) from public, anon;
grant execute on function public.forum_admin_reset_password(uuid, text) to authenticated;

-- ── ПЕРВЫЙ АДМИНИСТРАТОР ────────────────────────────────────────────────────
--
-- Роль по умолчанию — участник, и назначить администратора может только
-- администратор. Первого поэтому назначают руками, один раз, здесь.
--
-- Зарегистрируйся на сайте своим ником, потом раскомментируй строку ниже,
-- подставь свой ник и выполни её:
--
-- update public.forum_users set role = 'admin' where lower(nick) = lower('Qvaden');


-- ── ОЧИСТКА ПРОБНЫХ ЗАПИСЕЙ ─────────────────────────────────────────────────
--
-- Работоспособность форума проверялась на живой базе — иначе проверка ничего
-- не стоит. После проверки в базе остаются пробные учётные записи и посты.
--
-- Стереть их обычным запросом нельзя: политики выше запрещают удаление строк
-- всем, включая администратора (удаление — это отметка с причиной). Здесь же
-- запрос выполняется служебными правами SQL-редактора, то есть в обход
-- политик, и это единственное место, где такое уместно: чистит владелец
-- проекта руками, а не сайт.
--
-- ЗАПУСКАТЬ ОДИН РАЗ, когда форум уже проверен и пора открывать его людям.
-- Раскомментируй блок и подставь свой ник в последнюю строку, чтобы не
-- удалить самого себя.

-- begin;
--   -- Посты, комментарии и реакции пробных учётных записей.
--   delete from public.forum_reactions where user_id in (
--     select id from public.forum_users where lower(nick) <> lower('Qvaden')
--   );
--   delete from public.forum_comments where author_id in (
--     select id from public.forum_users where lower(nick) <> lower('Qvaden')
--   );
--   delete from public.forum_posts where author_id in (
--     select id from public.forum_users where lower(nick) <> lower('Qvaden')
--   );
--   -- Сами учётные записи. Профиль связан с системой входа, поэтому удаление
--   -- строки в auth.users уносит профиль за собой (on delete cascade).
--   delete from auth.users where id in (
--     select id from public.forum_users where lower(nick) <> lower('Qvaden')
--   );
-- commit;
