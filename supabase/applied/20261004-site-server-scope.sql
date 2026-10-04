-- МУЛЬТИАРЕНДА ДАННЫХ САЙТА, ШАГ 1: у недели, альянса, события и текста
-- появляется сервер.
--
-- ЗАЧЕМ.
-- Форум уже живёт в одной базе несколькими серверами: `20261001-server-scope.sql`
-- дал колонку сервера темам, `20261001-server-rights.sql` дал по серверу право
-- слова, в адресе страницы уже есть `?server=N`. Данные сайта остались
-- однопредметными: таблицы `site_*` сервера не знают вовсе, и сайт, и панель
-- читают их одним вызовом `site_dataset()` — без аргументов. Пока так,
-- «второй сервер» означал бы второй сайт с копией кода и копией истории, от
-- чего проект отказался сознательно: сервер становится измерением данных, а не
-- отдельным проектом.
--
-- ЧТО ЗДЕСЬ ДЕЛАЕТСЯ.
--   1. Колонка `server_id` у пяти таблиц данных сайта — со ссылкой на
--      `forum_servers`, чтобы список серверов остался один на форум и сайт.
--   2. Ключи таблиц: у недель, событий, текстов и результатов — пара
--      (сервер, собственный ключ). У альянсов идентификатор остаётся
--      одноколоночным и глобально свободным; почему — ниже, это главное
--      решение файла.
--   3. `site_dataset(p_server)` отдаёт набор одного сервера — ровно той же
--      формы, что и прежде, поэтому разбор в `src/data/adapters/_map.js` не
--      меняется ни в одной строке.
--   4. `site_next_alliance_id()` — панель берёт номер нового альянса у базы,
--      потому что чужих серверов она не видит.
--
-- ПОЧЕМУ У АЛЬЯНСОВ КЛЮЧ ОДНИМ СТОЛБЦОМ, ХОТЯ У СОСЕДЕЙ ПО ДВА.
--   На `site_alliances (id)` ссылаются семь ограничений ВНЕ данных сайта:
--   подписки на альянс, снимок мест и история изменений дайджеста
--   (`20260916-forum-community.sql`), турниры и их раунды (`chats.sql`). Все
--   они хранят текстовый id и о сервере не знают ничего. Если бы «a01» значил
--   альянс и на 33-м, и на 44-м, каждая такая строка стала бы двусмысленной:
--   дайджест записал бы место 44-го альянса поверх 33-го и разослал уведомление
--   подписчикам чужого сервера. Молча. Поэтому у альянсов сервер вытекает из
--   самого идентификатора, и составной ключ им не нужен — он был бы полумерой:
--   таблица сайта про сервер знала бы, а семь ссылающихся на неё таблиц — нет.
--   У недель, событий и текстов внешних ссылок нет ни одной: их id — локальное
--   имя («W1» значит «первая неделя»), и две «W1» на разных серверах путают
--   только соседние таблицы сайта, а те тоже ключуются парой.
--
-- ЧТО ОЗНАЧАЕТ ГЛОБАЛЬНЫЙ id АЛЬЯНСА ДЛЯ ПАНЕЛИ.
--   Прежний порядок «взять максимум из своего списка и прибавить единицу»
--   работал, пока список был один. На втором сервере он выдал бы занятый номер,
--   а панель пишет через `merge-duplicates`, где занятый номер означает не
--   отказ, а перезапись чужого альянса со сменой сервера. Поэтому свободный
--   номер считает база, а панель спрашивает его перед созданием. Страховка на
--   тот же случай — триггер неподвижности сервера ниже: даже прямая строка из
--   SQL Editor не перетащит альянс в чужой список.
--
-- ДВА ПОХОЖИХ ИМЕНИ, КОТОРЫЕ НЕ НАДО ПУТАТЬ.
--   У `site_events` уже есть колонка `server_number` — это КАКОЙ сервер в игре
--   был захвачен (хронология 33-го хранит захваты 47-го и других). Новая
--   `server_id` — КОМУ принадлежит запись, то есть чей это сайт и чья история.
--   Разные вещи, и сверять их числа между собой было бы ошибкой.
--
-- ЧЕГО ЗДЕСЬ НЕТ — И ПОЧЕМУ.
--   1. Права на внесение по серверу. Политики записи `site_*` как смотрели на
--      `site_can_edit()`, так и смотрят: сегодня модератор любого сервера
--      правит чужую неделю. Полумера хуже отсутствия — часть политик знала бы
--      сервер, часть нет, а различие проявилось бы только на втором сервере.
--      Это следующий шаг, и он опирается на уже готовое членство
--      (`forum_server_members`).
--   2. Переключателя сервера на самом сайте. Адаптеры просят `CONFIG.server`,
--      но выбрать другой сервер человеком пока нечем: `?server=N` для вкладок
--      рейтинга — отдельный шаг.
--   3. Сервера у резервного снимка `data/live.json`. Снимок один, и он о 33-м.
--      Пока адрес сервер не выбирает, расхождения нет; появится выбор —
--      понадобится и отдельный снимок на сервер, иначе сайт 44-го при отказе
--      базы показал бы рейтинг 33-го под своей шапкой.
--   4. Сервера у журнала правок `site_audit`. Строки журнала остаются общими:
--      `server_id` видно в деталях записи (триггер кладёт `to_jsonb` строки в
--      `details`), а экран журнала у владельца один на все серверы.
--
-- ПОРЯДОК ПРОТИВ ОПЕЧАТКИ.
--   Значение по умолчанию у новой колонки и у нового аргумента функции — 33.
--   Оно нужно на время между прогоном этого файла и выкладкой кода: в браузере
--   может лежать закешированная страница, которая вызывает `site_dataset()`
--   без аргументов, и планировщик снимка (`scripts/backup-from-db.mjs`) шлёт
--   `{}`. Функция с параметром по умолчанию отвечает и тем, и другим, и
--   отвечает им тот же самый 33-й сервер, что и сегодня. Обратный порядок —
--   код без этого файла — работать не может: новая панель и новый сайт шлют
--   `p_server`, и база без этой миграции ответила бы «функция не найдена».
--   Поэтому файл обязан быть прогнан ДО пуша.

-- ── 1. Колонка сервера ──────────────────────────────────────────────────────

/*
  Пять блоков подряд, а не цикл `do $$`: человек, который читает файл перед
  прогоном, ищет глазами именно имена таблиц.

  NOT NULL с константным значением по умолчанию в Postgres 11+ не переписывает
  таблицу, а все существующие строки получают свой настоящий сервер — №33,
  потому что других серверов у данных сайта до этого шага не было вовсе.
*/
alter table public.site_alliances add column if not exists server_id integer not null default 33;
alter table public.site_weeks     add column if not exists server_id integer not null default 33;
alter table public.site_results   add column if not exists server_id integer not null default 33;
alter table public.site_events    add column if not exists server_id integer not null default 33;
alter table public.site_texts     add column if not exists server_id integer not null default 33;

/*
  Ссылка на тот же список серверов, что у форума: номер, которого нет в
  `forum_servers`, база отвергает, а не хранит молча. Опечатка в числе сервера
  кончается здесь, а не через месяц пустой вкладкой.
*/
alter table public.site_alliances drop constraint if exists site_alliances_server_id_fkey;
alter table public.site_alliances add constraint site_alliances_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

alter table public.site_weeks drop constraint if exists site_weeks_server_id_fkey;
alter table public.site_weeks add constraint site_weeks_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

alter table public.site_results drop constraint if exists site_results_server_id_fkey;
alter table public.site_results add constraint site_results_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

alter table public.site_events drop constraint if exists site_events_server_id_fkey;
alter table public.site_events add constraint site_events_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

alter table public.site_texts drop constraint if exists site_texts_server_id_fkey;
alter table public.site_texts add constraint site_texts_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

comment on column public.site_alliances.server_id is
  'Чей это сайт и чья история. Не путать с site_events.server_number — там номер захваченного в игре сервера.';

-- ── 2. Ключи: пара (сервер, локальный идентификатор) ────────────────────────

/*
  Порядок важен: чужие ключи нельзя снять, пока на них стоят ссылки. Поэтому
  сначала разбираем `site_results` (он ссылается и на недели, и на альянсы),
  потом меняем первичные ключи недель, событий и текстов, и только затем
  собираем результаты заново.

  Первичный ключ — это и уникальный индекс, так что пара (сервер, id) после
  этого шага уникальна сама: два сервера могут держать «W1», а внутри одного
  сервера «W1» не повторится.
*/
alter table public.site_results drop constraint if exists site_results_week_id_fkey;
alter table public.site_results drop constraint if exists site_results_alliance_id_fkey;
alter table public.site_results drop constraint if exists site_results_pkey;

alter table public.site_weeks drop constraint if exists site_weeks_pkey;
alter table public.site_weeks add constraint site_weeks_pkey primary key (server_id, id);

alter table public.site_events drop constraint if exists site_events_pkey;
alter table public.site_events add constraint site_events_pkey primary key (server_id, id);

alter table public.site_texts drop constraint if exists site_texts_pkey;
alter table public.site_texts add constraint site_texts_pkey primary key (server_id, key);

/*
  Неделя берётся парой — результат не может относиться к неделе чужого сервера,
  и это проверяет база, а не договорённость в коде панели.

  Альянс остаётся одиночной ссылкой: его id глобален (см. шапку файла), и
  отдельная проверка пары тут не нужна — она ниже, триггером, который делает
  ровно то, чего foreign key здесь не сделает: сверяет сервер результата с
  сервером альянса. Каскад сохранён: удаление альянса уносит его результаты,
  как и до этого файла.
*/
alter table public.site_results add constraint site_results_pkey
  primary key (server_id, week_id, alliance_id);

alter table public.site_results add constraint site_results_week_id_fkey
  foreign key (server_id, week_id) references public.site_weeks (server_id, id) on delete cascade;

alter table public.site_results add constraint site_results_alliance_id_fkey
  foreign key (alliance_id) references public.site_alliances (id) on delete cascade;

-- ── 3. Индексы, по которым читают набор сервера ─────────────────────────────

/*
  Прежние индексы без сервера остаются: по ним работают запросы, которые сервер
  не фильтруют (счётчики в панели, сверка снимка). Новые — ровно под тот порядок,
  которым `site_dataset` собирает недели и хронологию.

  У результатов отдельного индекса по серверу нет намеренно: их первичный ключ
  начинается с `server_id` и закрывает этот случай сам. У альянсов — тем более:
  сервера десятки строк против двух-трёх значений, и индекс по такому полю был
  бы лишней записью на каждую правку списка.
*/
create index if not exists site_weeks_server_idx on public.site_weeks (server_id, number);
create index if not exists site_events_server_idx on public.site_events (server_id, event_date desc);

-- ── 4. Сервер существующей записи не перевозят ──────────────────────────────

/*
  Перенос недели или альянса в другой сервер — это не правка, а другая история:
  чужой VS, чужие захваты, чужие подписчики дайджеста.

  Отдельная проверка нужна именно потому, что молчаливая перетасовка возможна
  через штатную запись панели: `merge-duplicates` на занятом идентификаторе
  делает не отказ, а UPDATE чужой строки, и без этой строки он изменил бы ещё и
  `server_id`.
*/
create or replace function public.site_server_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.server_id is distinct from old.server_id then
    raise exception
      'Сервер у записи сайта неподвижен: % → %. Это не правка, а перенос истории.',
      old.server_id, new.server_id
      using hint = 'Удалите запись на своём сервере и заведите её заново там, где она нужна.';
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop trigger if exists %1$s_server_immutable on public.%1$s', t);
    execute format(
      'create trigger %1$s_server_immutable before update on public.%1$s
         for each row execute function public.site_server_immutable()', t
    );
  end loop;
end $$;

/*
  Результат обязан называть сервер своего альянса.

  Неделя уже проверена парным foreign key, альянс — нет: его id глобален и может
  принадлежать другому серверу. Панель такую комбинацию физически не соберёт
  (она работает внутри одного набора), а прямая строка в базу или скрипт —
  могут, и тогда рейтинг одного сервера начал бы считать очки чужого альянса.
  Отказ назван причиной, а не текстом нарушения ограничения.
*/
create or replace function public.site_result_same_server()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ally_server integer;
begin
  select server_id into ally_server from public.site_alliances where id = new.alliance_id;
  if ally_server is distinct from new.server_id then
    raise exception
      'Альянс «%» принадлежит серверу %, а результат вносится на сервере %.',
      new.alliance_id, coalesce(ally_server::text, 'нет в справочнике'), new.server_id;
  end if;
  return new;
end;
$$;

drop trigger if exists site_results_same_server on public.site_results;
create trigger site_results_same_server
  before insert or update on public.site_results
  for each row execute function public.site_result_same_server();

/*
  Слияние — тоже только внутри своего сервера. `merged_into` ссылается на id
  глобально, поэтому проверка нужна словами: альянс 44-го, вошедший в «сливший»
  его 33-й, исчез бы из своего рейтинга и появился бы в чужом.
*/
create or replace function public.site_alliance_merge_same_server()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  into_server integer;
begin
  if new.merged_into is null then
    return new;
  end if;
  select server_id into into_server from public.site_alliances where id = new.merged_into;
  if into_server is distinct from new.server_id then
    raise exception
      'Сливать альянс можно только с альянсом своего сервера: «%» — с сервера %.',
      new.merged_into, coalesce(into_server::text, 'нет в справочнике');
  end if;
  return new;
end;
$$;

drop trigger if exists site_alliances_merge_same_server on public.site_alliances;
create trigger site_alliances_merge_same_server
  before insert or update on public.site_alliances
  for each row execute function public.site_alliance_merge_same_server();

-- ── 5. Свободный номер альянса считает база ─────────────────────────────────

/*
  Почему не в панели: она видит один сервер, а идентификатор альянса глобален.
  Локальный максимум на втором сервере выдал бы занятый номер, и запись ушла бы
  перезаписывать чужой альянс, а не отказываться (см. `merge-duplicates` выше).

  Считаются только идентификаторы вида «a» + цифры — те, что заводит панель.
  Ряд с самодельным именем в этот счёт не попадает, но и столкнуться с ним
  нельзя: панель дополняет номер до двух знаков, а занятость проверяет база
  первичным ключом и триггером неподвижности сервера выше.
*/
create or replace function public.site_next_alliance_id()
returns integer
language sql stable security definer set search_path = public
as $$
  select coalesce(max(substring(id from '^a([0-9]+)$')::integer), 0) + 1
    from public.site_alliances;
$$;

grant execute on function public.site_next_alliance_id() to authenticated;
revoke execute on function public.site_next_alliance_id() from anon;

-- ── 6. Что читает сайт: набор одного сервера ────────────────────────────────

/*
  Старая версия вызывается без аргументов: `create or replace` не умеет менять
  состав параметров, поэтому прежнее определение удаляется явно. Оставаться в
  базе двум одноимённым функциям нельзя: PostgREST при вызове без аргументов
  выбрал бы старую и отдал бы набор без фильтра, а не новый.

  Параметр с значением по умолчанию сохраняет прежних читателей: закешированная
  страница и планировщик снимка шлют `{}` и получают свой настоящий сервер.
  Новый код шлёт `p_server` явно.
*/
drop function if exists public.site_dataset();

create or replace function public.site_dataset(p_server integer default 33)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'pulledAt', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'source', 'supabase',
    'server', p_server,
    'alliances', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'tag', tag, 'name', name, 'color', color,
        'active', active, 'note', note, 'mergedInto', merged_into
      )) order by sort_order, id)
      from public.site_alliances where server_id = p_server
    ), '[]'::jsonb),
    'weeks', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', id, 'number', number,
        'startDate', to_char(start_date, 'YYYY-MM-DD'),
        'endDate', to_char(end_date, 'YYYY-MM-DD'),
        'note', note
      )) order by number, id)
      from public.site_weeks where server_id = p_server
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'weekId', week_id, 'allianceId', alliance_id, 'outcome', outcome,
        'opponent', opponent, 'comment', comment
      )) order by week_id, alliance_id)
      from public.site_results where server_id = p_server
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
      from public.site_events where server_id = p_server
    ), '[]'::jsonb),
    'texts', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'title', title, 'body', body) order by key)
      from public.site_texts where server_id = p_server
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.site_dataset(integer) to anon, authenticated;

/*
  Ряд «server» в ответе — не косметика: это единственный способ отличить, чей
  снимок лежит перед глазами, когда снимков станет несколько. Разбор он не
  меняет (адаптер берёт пять списков), а `data/live.json` становится на одну
  строку честнее.
*/

-- ── 7. Как проверить прогон и как добавить сервер ───────────────────────────

/*
  Сервер в список добавляет тот же человек, что и в форумной мультиаренде —
  рядом в `forum_servers`; политик на запись у той таблицы нет намеренно.
  Отдельной функции «завести сервер вместе с данными» здесь нет: пустой набор —
  это и есть состояние нового сервера, пока его модератор не внёс первую
  неделю.

  Проверить, что серверу вообще есть что показать, одной строкой:

    select count(*) as alliances from public.site_alliances where server_id = 44;
    select count(*) as weeks     from public.site_weeks     where server_id = 44;
    select count(*) as results   from public.site_results   where server_id = 44;

  И тем же вызовом, которым живёт сайт:

    select public.site_dataset(44);

  Ни одна из этих строк ничего не меняет — читать прогон этого файла можно
  сколько угодно раз, второй запуск идемпотентен.
*/

-- Кэш схемы API: у функции изменился состав аргументов, и со старым кэшем
-- панель услышала бы «функция не найдена» там, где база уже всё умеет.
notify pgrst, 'reload schema';
