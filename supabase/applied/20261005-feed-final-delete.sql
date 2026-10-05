-- ─────────────────────────────────────────────────────────────────────────────
-- УБРАНО — ЗНАЧИТ УБРАНО, И АВТОМАТ ПРО ЭТО ПОМНИТ
-- ─────────────────────────────────────────────────────────────────────────────
--
-- О чём договорились раньше и что этот файл меняет.
--
-- Пульс обновлений (`20260926-update-pulse.sql`) и фид магазина
-- (`20260930-store-feed.sql`) построены на одном правиле: ошибочную строку не
-- выбрасывают, её прячут. Для заметки это колонка `status` с архивом и дверью
-- «убрать / вернуть», для события — то же самое. Правило было правильным
-- ровно столько, сколько список вела модерация руками: решение можно
-- пересмотреть, и потому след решения должен жить рядом.
--
-- С автоматом, который ходит в магазины и в группу каждый час, смысл
-- переворачивается. «Убрано» перестаёт быть паузой и начинает выглядеть как
-- приглашение: планировщик ничего не помнит про чужое решение, он смотрит на
-- страницу и видит, что событие всё ещё там. В архиве на 05.10.2026 лежат
-- карточки, которые модерация убрала сознательно, и при первом же починенном
-- разборе они вернулись бы в список. Поэтому правило меняется на то, которое
-- называет владелец сайта: убрано насовсем.
--
-- ── Почему нужна отдельная таблица, а не колонка ─────────────────────────────
--
-- Казалось бы: ключ строки уже лежит в `forum_store_events.feed_key`, а у
-- заметки его никогда не было — добавим колонку и будем сверяться по таблице.
-- Так и сделано у событий, и именно поэтому события воскресают: удаление
-- строки уносит вместе с ней ключ, и следующий обход встречает чистое место.
-- Отметка обязана пережить то, о чём она, — отсюда `forum_feed_marks`. Таблица
-- ничего не показывает читателю и никем не правится руками: она один из двух
-- ответов на вопрос «это мы уже приносили».
--
-- Раз уж отметка заведена, на неё переезжает и ключ заметки: у записи из
-- официальной группы ВК номера версии нет вовсе, и опознать её при повторном
-- обходе можно только по ссылке на пост. Отсюда вторая правка этого файла —
-- у двери публикации появляется необязательный восьмой параметр.
--
-- ── Что происходит с уже убранным ────────────────────────────────────────────
--
-- Удаляется. Это не техническая деталь и не очистка: модерация уже вынесла по
-- этим строкам решение, а новое правило говорит, что решение окончательное.
-- Перед удалением их ключи заносятся в отметки — иначе «убрано насовсем»
-- продержалось бы ровно до следующего обхода.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит, уже удалённое не находит и не падает. Ставится
-- после 20261005-site-server-rights.sql.
--
-- До пуша кода миграция обязательна в обратную сторону: новый клиент зовёт
-- `forum_delete_update_note` и не зовёт архив, поэтому с неруководанным файлом
-- кнопка удаления получила бы «Could not find the function», а колонка `status`
-- при этом осталась бы на месте. Сам список без прогона читается: представление
-- `forum_update_note_list` существует и до этого файла, просто отдаёт колонку,
-- которую новый код не спрашивает.
--
-- Числа продублированы в `config.js` (`storeEventKeyMin`, `storeEventKeyMax` —
-- те же границы применяются к ключу заметки, второго числа для одного понятия в
-- проекте нет); совпадение чисел и слов отказа с черновым адаптером сторожит
-- тест.

-- ── Шаг 1. Отметка, переживающая удаление ────────────────────────────────────

create table if not exists public.forum_feed_marks (
  /*
    Ключ строки из внешнего мира: `play.…` у события магазина, `vk:<номер>_<id>`
    у записи из группы. Читается человеком и напечатан в readability, а не
    хешем: журнал планировщика и модератор должны понимать, о чём отметка, не
    открывая страницу. Границы те же, что у ключа события: два числа на одно
    понятие — это два числа, которые однажды разойдутся.
  */
  feed_key  text primary key
            check (char_length(feed_key) between 8 and 80),

  /*
    Чем является строка за этим ключом: заметкой об обновлении или событием.
    Нужно это ровно затем, чтобы чтение отметок не выглядело как «все ключи
    сразу»: автомат спрашивает заметочные ключи и не трогает событийные, у
    которых своя проверка по таблице событий.
  */
  what      text not null check (what in ('note', 'event')),

  /*
    Название, которое стояло в строке. Его не читает никто, кроме человека,
    который через месяц откроет таблицу, чтобы понять, почему автомат не
    приносит эту карточку обратно. Пустая строка разрешена: событие могло
    приехать без названия, а отметка обязана появиться и в этом случае.
  */
  title     text not null default '' check (char_length(title) <= 120),

  /*
    Момент, когда автомат в первый раз принёс эту строку. Не дата первоисточника
    и не дата удаления: отметка отвечает на вопрос «приносили или нет», и по этой
    колонке видно, как давно автомат работает и жив ли он.
  */
  marked_at timestamptz not null default now()
);

comment on table public.forum_feed_marks is
  'Ключи строк внешнего мира, которые автомат уже приносил. Переживают удаление заметки или события, чтобы «убрано насовсем» не обернулось повторной публикацией на следующем обходе.';

alter table public.forum_feed_marks enable row level security;

/*
  Список ключей читает планировщик под учётной записью бота-модератора. Гостю
  и игроку смотреть не на что: здесь нет содержимого, только то, что автомат
  уже приносил, — а знать это вправе только тот, кто ведёт список.
*/
drop policy if exists forum_feed_marks_read on public.forum_feed_marks;
create policy forum_feed_marks_read on public.forum_feed_marks
  for select using (public.forum_is_staff());

grant select on public.forum_feed_marks to authenticated;

/*
  Политик на запись нет ни одной и ни для кого: строку сюда кладёт только
  definer-функция публикации в следующем шаге. Прямой INSERT из браузера дал бы
  модератору способ молча запретить автомату приносить что угодно любой фразой,
  и проверить потом, кто это сделал, было бы невозможно.
*/

-- ── Шаг 2. Дверь публикации помнит, откуда взялась заметка ──────────────────

/*
  `create or replace function` не умеет менять состав параметров: новое
  объявление с восьмым аргументом создало бы вторую функцию с тем же именем, а
  PostgREST при вызове по имени выбирал бы между двумя и отказывал. Снимаем
  старую версию явно — вместе с правами на неё.
*/
drop function if exists public.forum_publish_update_note(
  text, text, text, text, text, timestamptz, text
);

create or replace function public.forum_publish_update_note(
  p_kind         text,
  p_title        text,
  p_summary      text,
  p_source_name  text,
  p_source_url   text,
  p_source_at    timestamptz,
  p_game_version text default '',
  /*
    Ключ внешнего источника. Пустой у ручной заметки: модератор, который
    принёс текст сам, ничем не обязан запоминать, и требовать у него ключ —
    значит выдумывать поле, которого он не может заполнить.
  */
  p_feed_key     text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id      uuid;
  v_title   text;
  v_text    text;
  v_name    text;
  v_url     text;
  v_version text;
  v_key     text;
begin
  /*
    Гость и игрок слышат одно слово: проверка одна — forum_is_staff(), и она не
    различает «не вошёл» и «вошёл без прав». Тот же порядок, что у заявок.
  */
  if not public.forum_is_staff() then
    raise exception 'Заметку об обновлении публикует модерация';
  end if;

  if coalesce(p_kind, '') not in ('patch', 'notice', 'issue') then
    raise exception 'Неизвестный тип заметки: %', p_kind;
  end if;

  v_title := btrim(coalesce(p_title, ''));

  if char_length(v_title) < 6 then
    raise exception 'Заголовок короче 6 символов: по двум словам не понять, о чём заметка';
  end if;

  if char_length(v_title) > 120 then
    raise exception 'Заголовок длиннее 120 символов: на телефоне он уйдёт в три строки';
  end if;

  v_text := btrim(coalesce(p_summary, ''));

  if char_length(v_text) < 20 then
    raise exception 'Содержание короче 20 символов: «обновили игру» — это заголовок, а не заметка';
  end if;

  if char_length(v_text) > 1500 then
    raise exception 'Содержание длиннее 1500 символов: материал о патче пишется на форуме темой';
  end if;

  v_name := btrim(coalesce(p_source_name, ''));

  if char_length(v_name) < 2 then
    raise exception 'Нужно название первоисточника: ссылка без имени — это просто домен';
  end if;

  if char_length(v_name) > 60 then
    raise exception 'Название первоисточника длиннее 60 символов: достаточно короткого «Официальный сайт»';
  end if;

  /*
    Ссылка приводится к нижнему регистру по схеме и проверяется целиком. Здесь
    нет «разрешим http:// и подставим https» — такой редирект ломает ссылку на
    конкретную заметку, а молча пустить http значило бы отдавать адрес открытым
    текстом.
  */
  v_url := btrim(coalesce(p_source_url, ''));

  if v_url !~* '^https://' then
    raise exception 'Нужна прямая HTTPS-ссылка на первоисточник';
  end if;

  v_url := 'https://' || substring(v_url from 9);

  if v_url ~ '\s' then
    raise exception 'Ссылка не может содержать пробелы: похоже, к ней прилипло что-то ещё';
  end if;

  if char_length(v_url) > 500 then
    raise exception 'Ссылка длиннее 500 символов: в карточке она не читается';
  end if;

  if p_source_at is null then
    raise exception 'Нужна дата публикации у первоисточника';
  end if;

  if p_source_at > now() + interval '10 minutes' then
    raise exception 'Дата первоисточника не может быть из будущего';
  end if;

  if p_source_at < timestamp with time zone '2020-01-01 00:00:00+00' then
    raise exception 'Дата первоисточника раньше 2020 года: похоже, ошиблись годом';
  end if;

  v_version := btrim(coalesce(p_game_version, ''));

  if char_length(v_version) > 40 then
    raise exception 'Номер версии длиннее 40 символов: его не называют так длинно';
  end if;

  /*
    Проверка ключа стоит ДО вставки, а сама отметка — после, в одной операции с
    ней. Порядок важен: отметка без заметки оставила бы дыру (автомат больше
    никогда не принёс бы этот текст, и ничего не вышло), а заметка без отметки
    оставила бы только повтор в следующем обходе. Отдельный вызов «запомни
    ключ» после публикации не годился именно поэтому: между двумя запросами
    есть обрыв, а обрыв в планировщике выглядит как успешный запуск.
  */
  v_key := btrim(coalesce(p_feed_key, ''));

  if v_key <> '' then
    if char_length(v_key) < 8 then
      raise exception 'Ключ источника короче 8 символов: по такому ключу не найти строку при повторном обходе';
    end if;

    if char_length(v_key) > 80 then
      raise exception 'Ключ источника длиннее 80 символов: это не ключ, а пересказ';
    end if;

    if exists (select 1 from public.forum_feed_marks where feed_key = v_key) then
      raise exception 'Этот источник уже приносил заметку: повторная публикация означает, что первую убрали насовсем';
    end if;
  end if;

  insert into public.forum_update_notes
    (kind, title, summary, source_name, source_url, source_at, game_version, author_id)
  values
    (p_kind, left(v_title, 120), left(v_text, 1500), left(v_name, 60),
     left(v_url, 500), p_source_at, left(v_version, 40), auth.uid())
  returning id into v_id;

  if v_key <> '' then
    insert into public.forum_feed_marks (feed_key, what, title)
    values (v_key, 'note', left(v_title, 120));
  end if;

  return v_id;
end;
$$;

revoke all on function public.forum_publish_update_note(
  text, text, text, text, text, timestamptz, text, text
) from public, anon;

grant execute on function public.forum_publish_update_note(
  text, text, text, text, text, timestamptz, text, text
) to authenticated;

comment on function public.forum_publish_update_note(
  text, text, text, text, text, timestamptz, text, text
) is
  'Публикует заметку об обновлении: держит право модерации, домен типа, длины, обязательную HTTPS-ссылку и дату первоисточника не из будущего. Восьмой параметр — ключ внешнего источника: он заводит отметку в той же операции, чтобы убранная заметка не вернулась при следующем обходе.';

-- ── Шаг 3. Событие: ключ спрашивается у отметки, а не только у строки ─────────

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
    Живое событие обновляется по-прежнему: магазин правит даты мероприятия, и
    следующий обход обязан принести их сюда же, а не завести вторую карточку.
    Отличие от прежней версии одно — слово «уже было» теперь рождается не из
    уникального индекса, а из отметки: индекс молчит про удалённую строку.
  */
  update public.forum_store_events
     set title        = left(v_title, 120),
         summary      = left(v_text, 500),
         platform     = p_platform,
         starts_at    = p_starts_at,
         ends_at      = p_ends_at,
         source_url   = left(v_url, 500),
         last_seen_at = now()
   where feed_key = v_key
  returning id into v_id;

  if found then
    return 'обновлено';
  end if;

  if exists (select 1 from public.forum_feed_marks where feed_key = v_key) then
    return 'уже было';
  end if;

  insert into public.forum_store_events (
    feed_key, title, summary, platform, starts_at, ends_at, source_url
  ) values (
    v_key, left(v_title, 120), left(v_text, 500), p_platform,
    p_starts_at, p_ends_at, left(v_url, 500)
  )
  returning id into v_id;

  insert into public.forum_feed_marks (feed_key, what, title)
  values (v_key, 'event', left(v_title, 120));

  return 'новое';
end;
$$;

comment on function public.forum_record_store_event(
  text, text, text, text, timestamptz, timestamptz, text
) is
  'Принести событие из магазина: обновить живое, завести новое или сказать «уже было» по отметке. Отметка переживает удаление строки, поэтому убранное модерацией событие не вернётся при следующем обходе.';

-- ── Шаг 4. Двери удаления ────────────────────────────────────────────────────

/*
  Одна функция на один объект, а не пара «архивировать / вернуть»: второго
  движения больше нет. Право то же, что у публикации, — forum_is_staff(), и
  отказ звучит той же причиной, что у соседних дверей, чтобы модератор не
  собирал по слову, какая из двух ролей ему нужна.

  Отметку функция НЕ трогает: она и заведена ради того, чтобы пережить строку.
  Удаление отметки здесь было бы ровно той ошибкой, из-за которой весь этот
  шаг существует.
*/
create or replace function public.forum_delete_update_note(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.forum_is_staff() then
    raise exception 'Заметку об обновлении удаляет модерация';
  end if;

  delete from public.forum_update_notes where id = p_target
   returning id into v_id;

  if not found then
    raise exception 'Заметка не найдена';
  end if;

  /*
    Состояние обхода хранит номер последней опубликованной заметки, и после
    удаления он указывает в никуда. Страница по этому номеру ничего не строит,
    но журнал планировщика обязан оставаться правдой: пустая ссылка честнее
    висячей.
  */
  update public.forum_store_state
     set last_note_id = null
   where last_note_id = p_target;
end;
$$;

revoke all on function public.forum_delete_update_note(uuid) from public, anon;
grant execute on function public.forum_delete_update_note(uuid) to authenticated;

comment on function public.forum_delete_update_note(uuid) is
  'Удаляет заметку об обновлении безвозвратно. Отметка ключа остаётся: убранное автомат не приносит обратно.';

create or replace function public.forum_delete_store_event(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.forum_is_staff() then
    raise exception 'Событие из магазина удаляет модерация';
  end if;

  delete from public.forum_store_events where id = p_target
   returning id into v_id;

  if not found then
    raise exception 'Событие не найдено';
  end if;
end;
$$;

revoke all on function public.forum_delete_store_event(uuid) from public, anon;
grant execute on function public.forum_delete_store_event(uuid) to authenticated;

comment on function public.forum_delete_store_event(uuid) is
  'Удаляет событие магазина безвозвратно по идентификатору. Ключ живёт в отметках, поэтому следующая страница магазина не восстановит карточку.';

/*
  Двери архива снимаются, а не остаются «на всякий случай». Функция, которой
  никто не имеет права пользоваться, остаётся вызываемой: модератор из панели
  не вызовет, а планировщик или случайный вызов из SQL — да, и вернёт строку,
  которую удалили. У архивных колонок нет смысла, значит нет и двери.
*/
drop function if exists public.forum_set_update_note_archive(uuid, boolean);
drop function if exists public.forum_set_store_event_archive(uuid, boolean);

-- ── Шаг 5. Сносим архив как состояние ────────────────────────────────────────

/*
  Ключи убранных строк записываем ДО удаления: после него спрашивать будет
  нечего. Отметки заводятся по всем событиям, а не только по архивным — так
  таблица отметок становится полным ответом на вопрос «что автомат уже
  приносил», и следующий шаг не зависит от того, какая строка уцелела.
*/
insert into public.forum_feed_marks (feed_key, what, title)
select e.feed_key, 'event', e.title
  from public.forum_store_events e
on conflict (feed_key) do nothing;

delete from public.forum_store_events where status = 'archived';

delete from public.forum_update_notes where status = 'archived';

/*
  Представления падают первыми: колонка, на которую они смотрят, уходит следом,
  а Postgres не даёт вычесть колонку из чужого представления молча. Поднятие
  таблиц и опусканий — шаг 6, там же, где представления возвращаются.
*/
drop view if exists public.forum_update_note_list;
drop view if exists public.forum_store_event_list;

/*
  Индекс строился по статусу как первому столбцу — «опубликованные сверху,
  свежие раньше». С колонкой уходит и его смысл: порядок теперь
  «свежие раньше», одним столбцом меньше.
*/
drop index if exists public.forum_update_notes_list_idx;
drop index if exists public.forum_store_events_list_idx;

/*
  Разных состояний у строки больше нет, поэтому и правило чтения перестаёт
  различать читателей: в таблице лежит ровно то, что видит посетитель. Политика
  остаётся — без неё при включённом RLS не прочитал бы никто.

  Порядок здесь не косметика: политика, висящая на колонке, мешает эту колонку
  вычесть, и база отвечает `cannot drop column status … policy depends on it`.
  Поэтому правило меняется ДО сноса столбцов, а не после — как представления и
  индекс выше, которые по той же причине опущены раньше.
*/
drop policy if exists forum_update_notes_read on public.forum_update_notes;
create policy forum_update_notes_read on public.forum_update_notes
  for select using (true);

drop policy if exists forum_store_events_read on public.forum_store_events;
create policy forum_store_events_read on public.forum_store_events
  for select using (true);

alter table public.forum_update_notes
  drop column if exists status,
  drop column if exists archived_at,
  drop column if exists archived_by;

alter table public.forum_store_events
  drop column if exists status,
  drop column if exists archived_at,
  drop column if exists archived_by;

create index if not exists forum_update_notes_list_idx
  on public.forum_update_notes (source_at desc, created_at desc);

create index if not exists forum_store_events_list_idx
  on public.forum_store_events (starts_at desc, ends_at desc);

comment on table public.forum_update_notes is
  'Заметки об обновлениях игры: заметка, опубликованная модерацией или планировщиком фида. Строка в таблице и есть опубликованная заметка — убранное из списка удаляется и обратно не возвращается.';

-- ── Шаг 6. Представления без колонок архива ─────────────────────────────────

create or replace view public.forum_update_note_list
with (security_invoker = on) as
select
  n.id,
  n.kind,
  n.title,
  n.summary,
  n.source_name,
  n.source_url,
  n.source_at,
  n.game_version,
  n.author_id,
  a.nick       as author_nick,
  n.created_at
from public.forum_update_notes n
join public.forum_profiles a on a.id = n.author_id;

grant select on public.forum_update_note_list to anon, authenticated;

comment on view public.forum_update_note_list is
  'Заметки об обновлениях с ником автора. Все строки таблицы опубликованы: убранное удаляется, а не помечается, поэтому здесь нет ни статуса, ни имени убравшего.';

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
       e.first_seen_at,
       e.last_seen_at
  from public.forum_store_events e;

grant select on public.forum_store_event_list to anon, authenticated;

comment on view public.forum_store_event_list is
  'События, принесённые планировщиком. Строка одна и состояние у неё одно: убранное исчезает отсюда вместе с собой.';

-- ── Шаг 7. Планировщику нужно имя таблицы, а не только право ────────────────

/*
  Скрипт фида читает известные ему ключи одним запросом к таблице отметок.
  Право select он получает тем же входом, что и раньше (роль модератора), —
  отдельной выдачи нет; здесь только напоминаем базе про состав функций и
  представлений, иначе PostgREST отвечал бы «could not find the forum_feed_marks
  table» до первой перезагрузки схемы.
*/
notify pgrst, 'reload schema';
