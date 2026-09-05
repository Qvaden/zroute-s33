-- ДАННЫЕ САЙТА В БАЗЕ.
--
-- Запускать ПОСЛЕ supabase/schema.sql: здесь используется таблица профилей
-- и функции прав, созданные там.
--
-- ЗАЧЕМ ЭТО НУЖНО. До сих пор история сервера лежала в data/live.json
-- в репозитории, и панель писала туда через API GitHub. Работало, но упиралось
-- в две вещи:
--
--   1. Две системы прав, ничего не знающие друг о друге. Владельцу приходилось
--      держать два пароля: токен GitHub для панели и ник с паролем для форума.
--
--   2. Чтобы пустить нового редактора, надо было выдать ему доступ
--      к репозиторию — то есть объяснить человеку, что такое GitHub и personal
--      access token, ради правки счёта в VS. На практике это означало, что
--      редактор один: владелец.
--
-- Теперь данные сайта живут здесь же, права одни, и редактор добавляется
-- нажатием в панели.
--
-- ЧТО ПРИ ЭТОМ ТЕРЯЕТСЯ И ЧЕМ ЭТО ЗАКРЫТО. В git история правок велась сама:
-- каждый коммит — кто и что поменял. База так не умеет. Поэтому здесь есть
-- таблица site_audit (журнал правок) и отдельно, в репозитории, воркфлоу,
-- который раз в сутки выгружает базу обратно в data/live.json. Без выгрузки
-- проект терял бы главное своё свойство: историю, которая переживает всё.

-- ── Справочники ─────────────────────────────────────────────────────────────
--
-- ПОЧЕМУ id ТЕКСТОВЫЕ, А НЕ uuid. Они уже существуют: «a01», «W24». На них
-- ссылаются результаты, их видел человек в таблице, они лежат в резервных
-- копиях. Переименовать их в uuid означало бы переписать историю ради
-- красоты — а история здесь и есть весь смысл сайта.

create table if not exists public.site_alliances (
  id          text primary key,
  tag         text not null,
  name        text not null,
  color       text,
  active      boolean not null default true,
  note        text,
  -- Id альянса, в который этот вошёл слиянием. История при этом НЕ переносится:
  -- поглотивший физически не играл те VS. См. docs/ARCHITECTURE.md.
  merged_into text references public.site_alliances (id) on delete set null,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists public.site_weeks (
  id         text primary key,
  number     integer not null,
  start_date date not null,
  end_date   date not null,
  note       text,
  updated_at timestamptz not null default now()
);

create index if not exists site_weeks_number_idx on public.site_weeks (number);

/*
  Результат одного альянса за одну неделю.

  Исходов ровно два: победа или поражение. В VS альянс участвует всегда,
  ничьих и пропусков в игре не бывает — поэтому их нет и здесь. Отсутствие
  строки означает «результат ещё не внесли», и это состояние данных,
  а не игры (см. src/data/types.js).

  Первичный ключ из пары не даёт завести два результата на одну неделю:
  раньше это держалось только порядком записи в JSON.
*/
create table if not exists public.site_results (
  week_id     text not null references public.site_weeks (id) on delete cascade,
  alliance_id text not null references public.site_alliances (id) on delete cascade,
  outcome     text not null check (outcome in ('win', 'loss')),
  opponent    text,
  comment     text,
  updated_at  timestamptz not null default now(),
  primary key (week_id, alliance_id)
);

create table if not exists public.site_events (
  id            text primary key,
  event_date    date not null,
  type          text not null default 'other',
  server_number integer,
  title         text not null,
  summary       text,
  body          text,
  -- Несколько фотографий: раньше в JSON лежала то одна ссылка, то массив.
  image_urls    text[] not null default '{}',
  duration_days integer,
  updated_at    timestamptz not null default now()
);

create index if not exists site_events_date_idx on public.site_events (event_date desc);

create table if not exists public.site_texts (
  key        text primary key,
  title      text not null default '',
  body       text not null default '',
  updated_at timestamptz not null default now()
);

-- ── Журнал правок ───────────────────────────────────────────────────────────
--
-- То, что в git получалось само собой. Без него после переезда пропал бы ответ
-- на вопрос «кто внёс эту неделю» — а он нужен не для наказания, а чтобы
-- понять, откуда взялась ошибка в данных.
--
-- Пишется триггерами, а не панелью: запись из другого места всё равно попадёт
-- в журнал.

create table if not exists public.site_audit (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor_id   uuid references public.forum_users (id) on delete set null,
  actor_nick text not null default '',
  entity     text not null,
  entity_id  text not null default '',
  action     text not null,
  details    jsonb
);

create index if not exists site_audit_at_idx on public.site_audit (at desc);

-- ── Право править данные сайта ──────────────────────────────────────────────
--
-- Есть у владельца и у модератора.
--
-- Сначала это был отдельный признак can_edit_site: «тот, кто вносит итоги VS,
-- не обязан разбирать жалобы». Разделение выглядело аккуратно, но оно из
-- другого масштаба — оно экономит доверие там, где помощников десяток.
-- Здесь их один-два, и отдельный признак означал лишь ещё одну сущность,
-- которую надо помнить и выдавать по отдельности.
--
-- Доверяя человеку удаление чужих постов, странно не доверять ему внесение
-- результатов VS. Поэтому право теперь у роли, а не у признака.
--
-- Колонка can_edit_site остаётся в таблице: у кого-то она уже выставлена,
-- и удаление означало бы миграцию ради чистоты. Ниже она просто перестала
-- влиять на права.

alter table public.forum_users
  add column if not exists can_edit_site boolean not null default false;

/*
  Забаненный не правит данные сайта, даже будучи модератором: бан означает
  «этому человеку сейчас не доверяем», и половинчатое доверие тут хуже
  ясного запрета.

  Владельца забанить нельзя вовсе (см. охранник в profiles.sql), поэтому
  для него это условие ничего не меняет.
*/
create or replace function public.site_can_edit()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_users
    where id = auth.uid()
      and banned = false
      and role in ('admin', 'moderator')
  );
$$;

-- ── Права на строки ─────────────────────────────────────────────────────────
--
-- Без этого публичный ключ давал бы полный доступ к таблицам: правки истории
 -- сервера кем угодно. Строки ниже — самые важные в файле.

alter table public.site_alliances enable row level security;
alter table public.site_weeks     enable row level security;
alter table public.site_results   enable row level security;
alter table public.site_events    enable row level security;
alter table public.site_texts     enable row level security;
alter table public.site_audit     enable row level security;

/*
  Читать может кто угодно, включая незарегистрированных: это открытый сайт
  сообщества, и рейтинг обязан открываться без входа.

  Писать — только с правом редактора. Одинаково для всех пяти таблиц, поэтому
  политики создаются циклом: пять почти одинаковых блоков руками — это пять
  мест, где можно ошибиться, и одно из них потом окажется без защиты.
*/
do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select using (true)', t);

    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for insert with check (public.site_can_edit())', t
    );

    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update using (public.site_can_edit()) with check (public.site_can_edit())', t
    );

    /*
      Удаление данных сайта разрешено, в отличие от постов форума. Разница
      по смыслу: удалённый пост оставляет заглушку, потому что его читали люди
      и молчаливое исчезновение выглядит поломкой. А ошибочно заведённая
      неделя или альянс-опечатка — это мусор, который должен уйти совсем.

      Страховка от потери истории здесь другая: журнал правок ниже
      и ежедневная выгрузка в репозиторий.
    */
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete using (public.site_can_edit())', t
    );
  end loop;
end $$;

-- Журнал: читают редакторы, пишут только триггеры.
drop policy if exists site_audit_read on public.site_audit;
create policy site_audit_read on public.site_audit
  for select using (public.site_can_edit());

-- ── Журнал заполняется сам ──────────────────────────────────────────────────
--
-- Триггером, а не панелью: правка из другого места (SQL-редактор, чужой
-- скрипт) всё равно попадёт в журнал. Панель могла бы «забыть» записать,
-- и именно в этом случае журнал был бы нужнее всего.

create or replace function public.site_write_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  who text;
  ident text;
  row_data jsonb;
begin
  select nick into who from public.forum_users where id = auth.uid();

  /*
    СТРОКУ ПРЕВРАЩАЕМ В JSONB И РАБОТАЕМ С НИМ, А НЕ С ПОЛЯМИ НАПРЯМУЮ.

    Один триггер обслуживает пять разных таблиц, и поля у них разные:
    у результатов составной ключ week_id + alliance_id, у текстов — key,
    у остальных — id.

    Первая версия выбирала нужное через CASE по имени таблицы:

      case TG_TABLE_NAME
        when 'site_results' then new.week_id || '/' || new.alliance_id
        ...

    И падала на первой же вставке альянса:

      record "new" has no field "week_id"

    Причина в том, как PL/pgSQL исполняет выражения: он отдаёт CASE целиком
    как один SQL-запрос, и ссылки на поля проверяются во ВСЕХ ветках сразу,
    а не только в подходящей. У альянса поля week_id нет — отказ, хотя эта
    ветка никогда бы не выполнилась.

    Обращение к jsonb такой проверки не требует: отсутствующий ключ даёт
    просто NULL. Заодно to_jsonb нужен ниже для самой записи в журнал,
    так что лишней работы не появилось.
  */
  row_data := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  ident := coalesce(
    case TG_TABLE_NAME
      -- У составного ключа результатов нет одного id: собираем читаемый.
      when 'site_results' then (row_data ->> 'week_id') || '/' || (row_data ->> 'alliance_id')
      when 'site_texts'   then row_data ->> 'key'
      else row_data ->> 'id'
    end,
    ''
  );

  insert into public.site_audit (actor_id, actor_nick, entity, entity_id, action, details)
  values (
    auth.uid(),
    coalesce(who, 'из SQL-редактора'),
    TG_TABLE_NAME,
    ident,
    lower(TG_OP),
    row_data
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop trigger if exists %1$s_audit on public.%1$s', t);
    execute format(
      'create trigger %1$s_audit after insert or update or delete on public.%1$s
         for each row execute function public.site_write_audit()', t
    );
  end loop;
end $$;

-- Отметка времени правки — тоже сама.
create or replace function public.site_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format(
      'create trigger %1$s_touch before update on public.%1$s
         for each row execute function public.site_touch()', t
    );
  end loop;
end $$;

-- ── Хранилище для фотографий ────────────────────────────────────────────────
--
-- Раньше фотографии коммитились в репозиторий и раздавались через
-- raw.githubusercontent.com. Работало, но каждая картинка навсегда оставалась
-- в истории git: удалить её из репозитория нельзя, только скрыть.
--
-- Здесь они лежат в хранилище: доступ на чтение открыт всем, загрузка — только
-- редакторам, удаление настоящее.

insert into storage.buckets (id, name, public)
values ('site-photos', 'site-photos', true)
on conflict (id) do update set public = true;

drop policy if exists site_photos_read on storage.objects;
create policy site_photos_read on storage.objects
  for select using (bucket_id = 'site-photos');

drop policy if exists site_photos_write on storage.objects;
create policy site_photos_write on storage.objects
  for insert with check (bucket_id = 'site-photos' and public.site_can_edit());

drop policy if exists site_photos_delete on storage.objects;
create policy site_photos_delete on storage.objects
  for delete using (bucket_id = 'site-photos' and public.site_can_edit());

-- ── Что читает сайт ─────────────────────────────────────────────────────────
--
-- Один запрос вместо пяти: сайт грузит всё разом (32 альянса на 52 недели —
-- меньше двух тысяч строк в год, серверная фильтрация тут не нужна).
--
-- Возвращается ровно тот же вид, что лежал в data/live.json. Так адаптер
-- чтения остаётся простым, а выгрузка в репозиторий получается бесплатно:
-- результат этой функции и есть содержимое резервной копии.

create or replace function public.site_dataset()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'pulledAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'source', 'supabase',
    'alliances', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'tag', tag, 'name', name, 'color', color,
        'active', active, 'note', note, 'mergedInto', merged_into
      )) order by sort_order, id)
      from public.site_alliances
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'number', number,
        'startDate', to_char(start_date, 'YYYY-MM-DD'),
        'endDate', to_char(end_date, 'YYYY-MM-DD'),
        'note', note
      )) order by number, id)
      from public.site_weeks
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'weekId', week_id, 'allianceId', alliance_id, 'outcome', outcome,
        'opponent', opponent, 'comment', comment
      )) order by week_id, alliance_id)
      from public.site_results
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'date', to_char(event_date, 'YYYY-MM-DD'), 'type', type,
        'serverNumber', server_number, 'title', title, 'summary', summary,
        'body', body,
        'imageUrls', case when array_length(image_urls, 1) > 0
                          then to_jsonb(image_urls) else null end,
        'durationDays', duration_days
      )) order by event_date desc, id)
      from public.site_events
    ), '[]'::jsonb),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'title', title, 'body', body) order by key)
      from public.site_texts
    ), '[]'::jsonb)
  );
$$;

-- Читать набор может кто угодно: это открытый сайт.
grant execute on function public.site_dataset() to anon, authenticated;

-- ── Назначить модератора ────────────────────────────────────────────────────
--
-- Обычным запросом к forum_users этого не сделать: правку профилей разрешено
-- модерации, а роли — только владельцу. Функция проверяет это сама, поэтому
-- право «назначить модератора» можно отдать в панель, не отдавая права
-- «менять что угодно в профилях».
--
-- Раньше функция называлась site_set_editor и выдавала отдельный признак
-- редактора. Признака больше нет — роли сократились до трёх, и модератор
-- правит данные сайта наравне с владельцем. Старое имя удаляется ниже, чтобы
-- в базе не осталось функции, которая делает вид, что работает.

drop function if exists public.site_set_editor(text, boolean);

create or replace function public.site_set_moderator(target_nick text, allow boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  target_id uuid;
  target_role text;
begin
  if not public.forum_is_admin() then
    raise exception 'Роли назначает только владелец';
  end if;

  select id, role into target_id, target_role
    from public.forum_users where lower(nick) = lower(target_nick);

  if target_id is null then
    raise exception 'Игрок «%» не найден. Он должен сначала зарегистрироваться на сайте.', target_nick;
  end if;

  -- Владелец один, и роль владельца через панель не выдаётся и не снимается.
  if target_role = 'admin' then
    raise exception 'Это владелец — роль владельца через панель не меняется';
  end if;

  update public.forum_users
     set role = case when allow then 'moderator' else 'member' end
   where id = target_id;

  insert into public.site_audit (actor_id, actor_nick, entity, entity_id, action, details)
  values (
    auth.uid(),
    (select nick from public.forum_users where id = auth.uid()),
    'forum_users', target_id::text,
    case when allow then 'grant_moderator' else 'revoke_moderator' end,
    jsonb_build_object('nick', target_nick)
  );
end;
$$;

revoke all on function public.site_set_moderator(text, boolean) from public, anon;
grant execute on function public.site_set_moderator(text, boolean) to authenticated;
