-- 2026-09-30. Игровой фид: автомат приносит из магазина события, а заметки
-- по-прежнему пишет тот, кто вошёл.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Пульс обновлений (20260926-update-pulse.sql) задумывался так: читателя кормит
-- человек, потому что серверной части нет. Серверная часть нашлась — планировщик
-- GitHub Actions, который уже кладёт в репозиторий резервную копию базы, — и
-- теперь нечестно оставлять в силе обоснование, которого больше нет.
--
-- У автомата ровно две вещи, которых не умеет человек, и обе нужны здесь.
-- Патч выходит в неудобный час, и модератор видит его к вечеру: игрок с
-- вопросом «это у меня сломалось после обновления?» пишет тему раньше. И у
-- события есть срок: оно начинается и кончается, а человек вспоминает про него
-- ровно тогда, когда оно уже прошло.
--
-- При этом автомат не получает права писать историю сайта от своего имени там,
-- где её пишет человек. Поэтому границы здесь проходят вот по какой линии:
--
--   Обновление игры. Автомат приносит ТЕКСТ, а заметку создаёт существующая
--   дверь forum_publish_update_note от имени учётной записи бота. Никакой
--   второй двери для заметок нет: у заметки есть автор, тип, ссылка и дата, и
--   всё это уже проверяется в одном месте.
--
--   Событие. Это НЕ заметка: у него есть расписание, и оно обязано устареть.
--   Заметка живёт, пока её не убрали руками, а событие, которое закончилось
--   неделю назад, должно уходить с экрана само, иначе блок превратится в свалку
--   прошедших дат. Для расписания нужна своя таблица.
--
-- ── ПОЧЕМУ НЕ В СУЩЕСТВУЮЩИЙ КАЛЕНДАРЬ ──────────────────────────────────────
--
-- forum_events (20260925-event-rsvp.sql) — это расписание самого форума: у
-- события есть автор-игрок, место встречи, места и RSVP. Внутриигровое событие
-- никто не «проведёт», на него не записываются, и его нельзя отменить: оно
-- кончается по часам магазина. Смешать их значило бы либо дать игрокам RSVP на
-- событие, которого они не организуют, либо добавить в ту таблицу половину
-- полей, которые у половины строк всегда пустые. Отдельная таблица дешевле и
-- честнее: у неё нет ни одного столбца, который был бы нужен не всем строкам.
--
-- ── ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО ────────────────────────────────────────────────
--
--   Права на запись в таблицы. Ни одной политики insert/update/delete нет:
--   приходят строки только через функции, а функции спрашивают роль. Правило
--   то же, что у пульса обновлений, и проверяется тем же тестом.
--
--   Уведомлений и подписок на событие. Патчей и событий несколько за неделю:
--   будить ими всех — приучать не открывать колокольчик. Блок стоит на
--   вкладке «Обновления игры», разговор о нём — на форуме.
--
--   Редактирования текста события. Автомат переносит то, что написано у
--   разработчиков. Переписывать это здесь значило бы терять связь с
--   первоисточником, а правки планировщик затёр бы при следующем обходе:
--   ключ строки тот же. Нужно своё прочтение — заметка.
--
--   Служебного ключа базы. Бот входит как обычный игрок (почта из ника, пароль
--   — секрет планировщика), и получает ровно те права, которые ему выдала
--   модерация. Ключ, обходящий Row Level Security, в проекте не появляется.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Событие видит и невошедший. Пустой список — тоже ответ, но «не нашёл»
--      и «ничего нет» для читателя выглядят одинаково, поэтому различает их
--      только модерация: ей доступен архив.
--   2. Ключ строки обязателен и уникален. Это то, по чему планировщик
--      узнаёт событие между обходами. Без уникального ключа каждый суточный
--      обход плодил бы одно и то же событие заново.
--   3. Заголовок — от 4 и не больше 120 символов. Нижний порог мягче, чем у
--      заметки (там 6): у события название часто одно слово, и «Рейд» — это
--      нормальное название, а не недоразумение.
--   4. Описание необязательно и не длиннее 500 символов: страница магазина
--      часто даёт только название и даты.
--   5. Ссылка либо прямая HTTPS, либо пустая строка. Пустая — законный
--      случай: у события без страницы в магазине ссылку не из чего взять, а
--      выдумывать её автомат не вправе.
--   6. Даты. Начало обязательно, конец необязателен, и если конец есть — он
--      позже начала. Обе проверки живут в функции, потому что политика
--      сравнивает столбцы, а объяснение словами должна давать дверь.
--   7. Автомат помечает пережитое, а не удаляет. Убранное руками возвращается в
--      список кнопкой архива, как у заметок: ошибся планировщик — человек
--      возвращает.
--   8. Состояние обхода — одна строка. Их не может быть больше одной:
--      это не журнал, а «что автомат знает сейчас». Журнал есть в GitHub.
--
-- ── ПОЧЕМУ ДВЕРИ — ФУНКЦИИ, А НЕ ПОЛИТИКИ ───────────────────────────────────
--
--   1. Отказ обязан называться по-русски. «duplicate key value violates
--      unique constraint» ничего не скажет ни модератору, ни журналу
--      планировщика, а событие — как раз та строка, где столкновение двух
--      обходов нормально и не является ошибкой.
--   2. Проверка «конец позже начала» не может быть CHECK в явном виде для
--      пустого начала: `(p_ends_at is null or p_ends_at > p_starts_at)`
--      политика выразит, но слово «у события конец раньше начала» — нет.
--   3. Роль спрашивает функция: у бота настоящий вход, поэтому `auth.uid()`
--      у него ненулевой, и автор строки — тот, кто вошёл, а не тот, о ком
--      попросили в теле запроса.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Те же значения лежат в CONFIG.forum.limits: storeEventTitleMin (4),
-- storeEventTitleMax (120), storeEventSummaryMax (500), storeEventKeyMax (80),
-- storeEventListMax (12), storeEventHideAfterDays (14). Длина ссылки —
-- updateUrlMax (500), её база проверяет ровно тем же числом, что и ссылку
-- заметки: второй цифры для одного и того же понятия быть не должно. Совпадение
-- чисел и текстов отказа сторожит тест.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20260929-player-guides.sql.
--
-- До пуша кода миграция не обязательна. Блок событий читает список отдельным
-- запросом и по его отказу называет имя этого файла, а не делает вид, что
-- событий нет; заметки автомат публикует существующей дверью, которая уже
-- работает. Без миграции остальной форум и пульс обновлений работают как раньше,
-- просто автомату некуда положить события и он не помнит, что уже приносил.
--
-- Отдельно, тем же запуском: учётная запись бота получает роль moderator. Её
-- нельзя выдать из этого файла — ник бота узнаётся только после того, как он
-- зарегистрируется на сайте, — поэтому порядок такой: зарегистрировать бота,
-- выдать ему роль в панели (или `update public.forum_users set role =
-- 'moderator' where id = '<uuid бота>';`), и только потом включать
-- планировщик.

-- ── Шаг 1. События магазина ─────────────────────────────────────────────────

create table if not exists public.forum_store_events (
  id           uuid primary key default gen_random_uuid(),

  /*
    Ключ строки из магазина: планировщик считает его из названия и дат события.
    Он уникальный — это единственное, что отличает новый обход от повторного.
    Читаемый вид (домен + хвост) выбран нарочно: по нему в журнале видно, из
    какой именно страницы приехало событие, не открывая саму страницу.
  */
  feed_key     text not null unique
               check (char_length(feed_key) between 8 and 80),

  /*
    Название события. Нижний порог — 4 символа, а не 6 как у заметки: у
    внутриигрового события имя часто одно слово, и «Рейд» невозможно
    перепутать с недосмотром, тогда как «Обн» — уже опечатка.
  */
  title        text not null
               check (char_length(title) between 4 and 120),

  /*
    Описание необязательное: страница магазина нередко даёт только имя и
    даты. Пустая строка честнее выдуманного «подробности уточняются».
  */
  summary      text not null default ''
               check (char_length(summary) <= 500),

  /*
    Чей это магазин. Пока автомат читает два, и слово 'other' в списке
    держит место для третьего источника, который появится одной строкой, а не
    переписыванием ограничения.
  */
  platform     text not null default 'android'
               check (platform in ('android', 'ios', 'other')),

  starts_at    timestamptz not null,
  ends_at      timestamptz,

  /*
    Ссылка либо настоящая, либо пустая. Полумеры вида «vk.com» без схемы здесь
    запрещены тем же, чем они запрещены у заметок: страница печатает href как
    есть, и один адрес без схемы стоил бы ссылки вида javascript:.
  */
  source_url   text not null default ''
               check (source_url = '' or (source_url ~ '^https://[^[:space:]]+$'
                                          and char_length(source_url) <= 500)),

  status       text not null default 'published'
               check (status in ('published', 'archived')),

  /*
    Два времени вместо одного. first_seen_at — когда событие вообще приехало
    (по нему видно, что автомат жив), last_seen_at — когда его в последний раз
    показала страница магазина. Разница между ними и есть ответ на вопрос
    «событие ещё в магазине или мы его пропустили».
  */
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  archived_at   timestamptz,
  archived_by   uuid references public.forum_users (id) on delete set null
);

/*
  Порядок списка: сначала то, что идёт сейчас и начнётся вскоре, поэтому по
  началу, а не по концу. Завершённые добираются по концу — иначе два события с
  одним началом читаются в случайном порядке.
*/
create index if not exists forum_store_events_list_idx
  on public.forum_store_events (status, starts_at desc, ends_at desc);

alter table public.forum_store_events enable row level security;

drop policy if exists forum_store_events_read on public.forum_store_events;
create policy forum_store_events_read on public.forum_store_events
  for select using (status = 'published' or public.forum_is_staff());

grant select on public.forum_store_events to anon, authenticated;

-- ── Шаг 2. Что автомат уже принёс ───────────────────────────────────────────

/*
  Одна строка на всё состояние обхода. Это не журнал: журнал есть у GitHub, и
  дублировать его в базу значило бы растить таблицу без читателя. Здесь только
  то, без чего следующий обход повторит прошлый: какие версии мы уже опубликовали
  и чем закончился последний запуск.
*/
create table if not exists public.forum_store_state (
  /* Единственно возможный первичный ключ одной строки: таблица не умеет
     иметь вторую запись, и база это проверяет, а не договорённость. */
  id               boolean primary key default true check (id),

  android_version  text not null default '',
  ios_version      text not null default '',
  android_at       timestamptz,
  ios_at           timestamptz,

  /* Что планировщик сказал о последнем запуске. Коротко и по-русски: это
     увидит модератор на странице, когда автомат молчит неделю.

     Пусто, а не «сейчас»: колонка обязана оставаться null до первого
     настоящего обхода. Строка «Планировщик заходил 29 сент., 22:38» — это слово
     о прогоне, а время миграции прогоном не было: читатель поверил бы, что
     магазины уже проверены, хотя автомат не запускался ни разу. */
  last_run_at      timestamptz,
  last_run_text    text not null default ''
                   check (char_length(last_run_text) <= 400),

  /* Номер заметки, которую автомат опубликовал последней. Нужен, чтобы
     «повторить обход» не означало «задвоить пост». */
  last_note_id     uuid
);

alter table public.forum_store_state enable row level security;

/* Состояние обхода читают все: «автомат проверял вчера» — публичное слово. */
drop policy if exists forum_store_state_read on public.forum_store_state;
create policy forum_store_state_read on public.forum_store_state
  for select using (true);

grant select on public.forum_store_state to anon, authenticated;

/*
  Единственную строку надо где-то взять до первого отчёта: иначе UPDATE в двери
  не нашёл бы строки, отчёт об обходе молча пропал бы, а страница показала бы
  «автомат не запускался никогда» вечно. Повторный запуск миграции ничего не
  меняет: on conflict по чужой строке не трогает.
*/
insert into public.forum_store_state (id) values (true)
  on conflict (id) do nothing;

/*
  Правка для тех баз, где этот файл уже прогоняли, когда колонка имела значение
  по умолчанию: там строка состояния получила время запуска миграции, и с того
  дня страница говорит «планировщик заходил», хотя обходов не было ни одного.
  Первая пара команд возвращает колонке право быть пустой, вторая убирает
  выдавшуюся дату. Условия выбирают именно строку без настоящего обхода: у
  обхода бывает текст отчёта, а обычно ещё версия площадки и номер заметки.
*/
alter table public.forum_store_state alter column last_run_at drop default;
alter table public.forum_store_state alter column last_run_at drop not null;

update public.forum_store_state
   set last_run_at = null
 where last_run_at is not null
   and last_run_text = ''
   and android_version = ''
   and ios_version = ''
   and last_note_id is null;

-- ── Шаг 3. Дверь: принести событие ──────────────────────────────────────────

/*
  Принести событие = создать его или сказать, что оно уже есть. Второе — не
  ошибка: обход идёт сутки назад и сегодня, и одно событие с датами увидит оба
  запуска. Поэтому функция возвращает одно из трёх слов — «новое»,
  «обновлено», «уже было», — а не молча идентификатор: журналу планировщика
  нужно на что-то опереться.
*/
create or replace function public.forum_record_store_event(
  p_feed_key   text,
  p_title      text,
  p_summary    text,
  p_platform   text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz default null,
  p_source_url text default ''
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_key     text;
  v_title   text;
  v_text    text;
  v_url     text;
  v_id      uuid;
begin
  if not public.forum_is_staff() then
    raise exception 'Событие из магазина приносит модерация';
  end if;

  v_key := btrim(coalesce(p_feed_key, ''));

  if char_length(v_key) < 8 then
    raise exception 'Ключ события короче 8 символов: по такому ключу не найти строку при повторном обходе';
  end if;

  if char_length(v_key) > 80 then
    raise exception 'Ключ события длиннее 80 символов: это не ключ, а пересказ';
  end if;

  if coalesce(p_platform, '') not in ('android', 'ios', 'other') then
    raise exception 'Неизвестная площадка события: %', p_platform;
  end if;

  v_title := btrim(coalesce(p_title, ''));

  if char_length(v_title) < 4 then
    raise exception 'Название события короче 4 символов: по двум буквам не понять, что началось';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'Название события длиннее 120 символов: на телефоне оно уйдёт в три строки';
  end if;

  v_text := btrim(coalesce(p_summary, ''));

  if char_length(v_text) > 500 then
    raise exception 'Описание события длиннее 500 символов: блок на вкладке не читалка';
  end if;

  if p_starts_at is null then
    raise exception 'У события нет начала: без даты непонятно, идёт оно сейчас или уже прошло';
  end if;

  if p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'У события конец раньше начала: так выглядит перепутанный порядок дат';
  end if;

  v_url := btrim(coalesce(p_source_url, ''));

  if v_url <> '' then
    if v_url !~* '^https://' then
      raise exception 'Ссылка на событие не начинается с https://';
    end if;
    if substring(lower(v_url) from 9) !~ '^[^[:space:]]+$' then
      raise exception 'Ссылка на событие не может содержать пробелы';
    end if;
    if char_length(v_url) > 500 then
      raise exception 'Ссылка на событие длиннее 500 символов';
    end if;
    v_url := 'https://' || substring(v_url from 9);
  end if;

  /*
    Столкновение по ключу — нормальный исход, поэтому оно не поднимается
    исключением: сначала пытаемся обновить, и только если строки нет —
    вставляем. Два одновременных обхода здесь невозможны (планировщик держит
    одну очередь), но условие по ключу в UPDATE стоит на тот же случай, что
    и у архива заметок: гонка двух модераторов обязана быть видна.
  */
  update public.forum_store_events
     set title        = left(v_title, 120),
         summary      = left(v_text, 500),
         platform     = p_platform,
         starts_at    = p_starts_at,
         ends_at      = p_ends_at,
         source_url   = left(v_url, 500),
         status       = 'published',
         archived_at  = null,
         archived_by  = null,
         last_seen_at = now()
   where feed_key = v_key
  returning id into v_id;

  if found then
    return 'обновлено';
  end if;

  insert into public.forum_store_events (
    feed_key, title, summary, platform, starts_at, ends_at, source_url
  ) values (
    v_key, left(v_title, 120), left(v_text, 500), p_platform,
    p_starts_at, p_ends_at, left(v_url, 500)
  )
  on conflict (feed_key) do nothing
  returning id into v_id;

  if found then
    return 'новое';
  end if;

  /* До этого места доходит только редкая гонка: строку вставили между
     нашим UPDATE и INSERT. */
  return 'уже было';
end;
$$;

revoke all on function public.forum_record_store_event(
  text, text, text, text, timestamptz, timestamptz, text
) from public, anon;

grant execute on function public.forum_record_store_event(
  text, text, text, text, timestamptz, timestamptz, text
) to authenticated;

-- ── Шаг 4. Дверь: убрать событие и вернуть ──────────────────────────────────

/*
  Ровно тот же смысл, что у архива заметок: ошибочную строку не выбрасывают,
  её прячут и показывают модерации. Триггера forum_set_row_user() нет: автор
  подставляется из токена в самой функции.
*/
create or replace function public.forum_set_store_event_archive(
  p_target   uuid,
  p_archived boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
begin
  if not public.forum_is_staff() then
    raise exception 'Событие из магазина убирает и возвращает модерация';
  end if;

  select status into v_status from public.forum_store_events where id = p_target;

  if not found then
    raise exception 'Событие не найдено';
  end if;

  if p_archived and v_status = 'archived' then
    raise exception 'Это событие уже в архиве';
  end if;

  if not p_archived and v_status = 'published' then
    raise exception 'Это событие и так опубликовано';
  end if;

  update public.forum_store_events
     set status      = case when p_archived then 'archived' else 'published' end,
         archived_at = case when p_archived then now() else null end,
         archived_by = case when p_archived then auth.uid() else null end
   where id = p_target
     and status = case when p_archived then 'published' else 'archived' end;

  if not found then
    raise exception 'Событие уже изменено';
  end if;
end;
$$;

revoke all on function public.forum_set_store_event_archive(uuid, boolean)
  from public, anon;

grant execute on function public.forum_set_store_event_archive(uuid, boolean)
  to authenticated;

-- ── Шаг 5. Дверь: отчитаться об обходе ──────────────────────────────────────

/*
  Планировщик говорит, что он видел и что из этого опубликовал. Отдельные
  функции для «спросить» и «записать» здесь не нужны: версию спрашивают из
  SELECT-запроса к таблице, которую всякий читает, а пишут только через эту
  дверь.
*/
create or replace function public.forum_mark_store_run(
  p_platform   text,
  p_version    text,
  p_at         timestamptz,
  p_text       text,
  p_note_id    uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.forum_is_staff() then
    raise exception 'Обход магазина отмечает модерация';
  end if;

  if coalesce(p_platform, '') not in ('android', 'ios') then
    raise exception 'Обход магазина бывает только над Android или iOS: %', p_platform;
  end if;

  if coalesce(p_version, '') <> '' and char_length(p_version) > 40 then
    raise exception 'Номер версии длиннее 40 символов: в состояние это не поместится';
  end if;

  if char_length(coalesce(p_text, '')) > 400 then
    raise exception 'Отчёт об обходе длиннее 400 символов: его читают с телефона';
  end if;

  /*
    Один текст на весь запуск, поэтому таблица одна и строка одна. Версия
    пишется только когда её принесли: пустая строка означает «магазин не
    ответил», а не «у приложения нет номера». Дата по той же причине
    сохраняется прежняя, если обход её не принёс: вчерашнее число лучше пустого
    поля, и по нему видно, когда магазин молчит.
  */
  update public.forum_store_state
     set android_version = case when p_platform = 'android' and coalesce(p_version, '') <> ''
                                then left(p_version, 40) else android_version end,
         ios_version     = case when p_platform = 'ios' and coalesce(p_version, '') <> ''
                                then left(p_version, 40) else ios_version end,
         android_at      = case when p_platform = 'android'
                                then coalesce(p_at, android_at) else android_at end,
         ios_at          = case when p_platform = 'ios'
                                then coalesce(p_at, ios_at) else ios_at end,
         last_run_at     = now(),
         last_run_text   = left(btrim(coalesce(p_text, '')), 400),
         last_note_id    = coalesce(p_note_id, last_note_id)
   where id is true;
end;
$$;

revoke all on function public.forum_mark_store_run(
  text, text, timestamptz, text, uuid
) from public, anon;

grant execute on function public.forum_mark_store_run(
  text, text, timestamptz, text, uuid
) to authenticated;

-- ── Шаг 6. Что видит страница ───────────────────────────────────────────────

/*
  Представление с security_invoker: права спрашиваются у читателя, поэтому
  гость видит опубликованное и ничего больше, а модератор — и архив. Ник
  убравшего берётся из вью профилей, как у заметок: второй копии имён в таблице
  не будет.
*/
create or replace view public.forum_store_event_list
with (security_invoker = on) as
select e.id,
       e.feed_key,
       e.title,
       e.summary,
       e.platform,
       e.starts_at,
       e.ends_at,
       e.source_url,
       e.status,
       e.first_seen_at,
       e.last_seen_at,
       e.archived_at,
       p_arch.nick as archived_by_nick
  from public.forum_store_events e
  left join public.forum_profiles p_arch on p_arch.id = e.archived_by;

grant select on public.forum_store_event_list to anon, authenticated;

/* Состояние обхода — отдельным представлением, чтобы страница брала его одним
   запросом и по отказу называла имя этого файла. */
create or replace view public.forum_store_status
with (security_invoker = on) as
select last_run_at, last_run_text, android_version, ios_version,
       android_at, ios_at, last_note_id
  from public.forum_store_state;

grant select on public.forum_store_status to anon, authenticated;
