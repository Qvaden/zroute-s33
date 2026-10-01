-- 2026-09-29. Гайды пишут игроки: право, лимиты, страх отметки и скриншоты.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Гайд уже был сущностью в базе: таблица `forum_guides`, страница «Гайды»,
-- отметки модерации «проверен / устарел», сигнал игрока «устарело», заявки на
-- гайды и очередь в панели. Не хватало одного — права писать. Политика вставки
-- требовала `forum_is_leader()`, то есть владельца или модерацию, и любой
-- человек, который хотел поделиться сборкой или разбором, получал отказ базы
-- там, где интерфейс вообще не предполагал отказа.
--
-- Практический смысл: справочник официальных гайдов перенесён из Telegram-бота
-- один в один и руками не поддерживается. Если живые разборы игроков живут
-- только в коде репозитория, сайт через месяц после переноса — архив чужих
-- скриншотов. Право писать переводит гайды из «того, что делает агент по
-- просьбе» в «то, что делает сообщество».
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Гайд публикуется сразу. Черновик, застрявший в очереди, — это молчание
--      автора; проверка модерацией идёт ПОСЛЕ публикации и не блокирует текст.
--   2. Неопубликованное отличие от владения одно: чужой гайд нельзя ни
--      отредактировать, ни удалить. Автор и модерация — можно (политики
--      `forum_guides_update` и `forum_guides_delete` уже были, их не трогаем).
--   3. Отметку «проверен / устарел» ставит только модерация, и теперь это
--      верно и для вставки. Прежний страх висел только на `update`, а
--      PostgREST умеет прислать `review_status` вместе с первой строкой, —
--      игрок получил бы собственный гайд со штампом «проверено модерацией»,
--      не выдумывая ничего кроме поля в запросе.
--   4. Порогов немного и они мягкие: тело не короче двухсот символов, не
--      длиннее двадцати тысяч, не больше двух гайдов в сутки на человека.
--      Модерация лимитам не подчиняется: снять свой же текст и починить
--      опечатку в чужом — работа, а не привилегия.
--   5. Скриншоты гайда — те же прикреплённые файлы форума, что у тем и ответов.
--      Отдельного хранилища, отдельного лимита и отдельной модерации картинок
--      не появляется: `target_type` получает третье значение, и всё остальное
--      работает как работало.
--
-- ── ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО ────────────────────────────────────────────────
--
--   Очереди на публикацию. Решение принято сознательно: сначала смотрим, что
--   реально приходит. Если через неделю список завалит, очередь — один шаг:
--   статус `draft` уже в чек-констрейнте колонки, и триггер-страх к ней
--   прикручен, так что возвращаться к этому решению дёшево.
--
--   Цензуру по ключевым словам и автоматическое устаревание по сроку.
--   `20260925-guide-review.sql` уже отказался от второго: отметка, которая
--   проставляется сама, начинает врать молча.
--
--   Автоочистку вложений при удалении гайда. Строка вложения переживает свою
--   запись ровно так же, как у тем форума: снимает её автор или модерация, и
--   удаление гайда не превращается в способ незаметно стереть чужой скриншот.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
--   `guideBodyMin` = 200, `guideBodyMax` = 20000, `guideDailyMax` = 2,
--   `attachmentsMax` = 12 (уже существующее, для гайдов не удваиваем). Лежат в
--   `config.js` (`CONFIG.forum.limits`), совпадение сторожит тест. Двадцать
--   тысяч символов — это примерно тридцать страниц текста: больше в один гайд
--   не пишет никто, а смысл ceiling'а в том, чтобы страница загружалась.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Повторный прогон безопасен:
-- политики снимаются перед созданием, constraint — через `drop ... if exists`,
-- триггеры пересоздаются. Выполняется после `chats.sql` (таблица `forum_guides`),
-- `profiles.sql` (`forum_attachments`) и `20260925-guide-review.sql`
-- (колонки обзора). До пуша кода миграция обязательна: без неё игрок упирается
-- в отказ политики, а скриншот гайда — в отказ констрейнта `target_type`.

-- ── Шаг 1. Писать может любой, кто может писать на форум ────────────────────

drop policy if exists forum_guides_insert on public.forum_guides;
create policy forum_guides_insert on public.forum_guides
  for insert with check (public.forum_can_write());

comment on policy forum_guides_insert on public.forum_guides is
  'Гайд публикует любой вошедший с правом писать; отметку модерации при этом не получает — см. страх ниже.';

-- ── Шаг 2. Лимиты автора и страх отметки на вставке ─────────────────────────

/*
  Два правила в одном триггере, потому что оба смотрят на строку до записи и
  оба молчат, когда строку правит модерация.

  Первый кусок — отметка. На вставке сравнивать со `old` не с чем, поэтому
  требование другое: не-модерация обязана прийти с колонками обзора в значениях
  по умолчанию. Это не придирка к формату, а защита смысла: «проверено
  модерацией» — чужая подпись, и автор ставить её не может даже честно.

  Второй кусок — длина и темп. Считается по `created_at >= midnight`: сутки
  берутся календарные, а не скользящие, потому что «не больше двух в сутки»
  человек читает как «на сегодня всё», и скользящее окно противоречило бы
  тексту отказа.
*/
create or replace function public.forum_guide_author_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_text text;
begin
  if not public.forum_is_staff() then
    if tg_op = 'INSERT' then
      if new.review_status is distinct from 'none'
        or new.review_note is distinct from ''
        or new.reviewed_at is not null
        or new.reviewed_by is not null then
        raise exception 'Отметку «проверен / устарел» ставит модерация';
      end if;
      if (
        select count(*) from public.forum_guides
         where author_id = auth.uid()
           and created_at >= date_trunc('day', now())
      ) >= 2 then
        raise exception 'Сегодня ты уже опубликовал два гайда — больше двух в сутки';
      end if;
    elsif new.review_status is distinct from old.review_status
      or new.review_note is distinct from old.review_note
      or new.reviewed_at is distinct from old.reviewed_at
      or new.reviewed_by is distinct from old.reviewed_by then
      raise exception 'Отметку «проверен / устарел» ставит модерация';
    end if;

    /*
      Длину меряем по тексту без разметки: в теле лежит HTML редактора, и
      считать его посимвольно значило бы принимать «гайд» из одних пустых
      <div>. Служебные символы разметки (&nbsp;) остаются в счёте — они
      добавляют две-три буквы, а нижняя граница в двести символов на этом
      не ломается.
    */
    v_text := btrim(regexp_replace(regexp_replace(coalesce(new.body, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g'));
    if char_length(v_text) < 200 then
      raise exception 'Гайд короче двухсот символов — это заметка, а не гайд';
    end if;
    if char_length(v_text) > 20000 then
      raise exception 'Гайд длиннее двадцати тысяч символов — разбей его на два';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_guide_author_guard on public.forum_guides;
create trigger forum_guide_author_guard
  before insert or update on public.forum_guides
  for each row execute function public.forum_guide_author_guard();

-- ── Шаг 3. Скриншоты у гайда ────────────────────────────────────────────────

/*
  Имя констрейнта здесь автогенерированное — именно так его записал Postgres
  при создании таблицы. Переименовывать не стали: чужие скрипты и дамп схемы
  ссылаются на это имя, а смысл правки — только добавить третье значение.
*/
alter table public.forum_attachments
  drop constraint if exists forum_attachments_target_type_check;

alter table public.forum_attachments
  add constraint forum_attachments_target_type_check
  check (target_type in ('post', 'comment', 'guide'));

comment on column public.forum_attachments.target_type is
  'post — тема или ответ форума, guide — гайд. Загрузка, лимит в двенадцать картинок и право удаления общие: отдельного механизма картинок для гайдов нет.';

-- ── Шаг 4. Адрес гайда рождается из заголовка ───────────────────────────────

/*
  Slug — адрес страницы, и до сих пор его набирал тот, кто публикует гайд: в
  форме было отдельное поле. Лидер с ним мирился, игрок — нет: человек пишет
  разбор про караваны, а ему предлагают придумать латинское имя для адреса.
  Поле убрано из формы, поэтому адрес обязана строить база.

  Почему именно база, а не скрипт формы: адрес попадает в уникальный индекс, и
  два человека, нажавшие «Опубликовать» на один и тот же заголовок, получили бы
  один и тот же адрес. Проверить это может только то место, где индекс лежит, —
  на стороне браузера такая проверка была бы гаданием по списку, который могли
  ещё не дочитать.

  Явно присланный slug не переименовывается: модерация вправе задать адрес
  словом, и тихо получить к нему суффикс «-2» вместо сказанного — значит
  потерять ссылку, которую уже разослали. Для него занятость остаётся отказом.
*/
create or replace function public.forum_guide_before()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_base  text;
  v_n     int := 0;
  v_built boolean := false;
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
    select nick into new.author_nick from public.forum_users where id = auth.uid();
  end if;
  new.title := left(btrim(new.title), 120);
  if char_length(new.title) < 2 then
    raise exception 'Заголовок гайда короче двух символов';
  end if;

  new.slug := lower(btrim(coalesce(new.slug, '')));
  if new.slug = '' then
    v_built := true;
    new.slug := regexp_replace(lower(new.title), '[^a-z0-9а-яё]', '-', 'g');
    new.slug := btrim(regexp_replace(new.slug, '-{2,}', '-', 'g'), '-');
    if char_length(new.slug) < 2 then
      raise exception 'Заголовок не даёт адреса: в нём нет букв или цифр';
    end if;
  end if;
  if new.slug !~ '^[a-z0-9а-яё-]{2,80}$' then
    raise exception 'Slug: только буквы, цифры и дефис';
  end if;
  new.slug := btrim(left(new.slug, 80), '-');

  v_base := new.slug;
  while exists (
    select 1 from public.forum_guides g
     where g.slug = new.slug and g.id is distinct from new.id
  ) loop
    if not v_built then
      raise exception 'Такой slug уже занят';
    end if;
    v_n := v_n + 1;
    new.slug := left(v_base, 74) || '-' || v_n::text;
  end loop;

  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

/*
  Триггер пересоздаётся, а не только функция: timing и набор событий у него не
  менялись, но повторный прогон файла должен приводить схему к одному виду,
  что бы в ней ни осталось от предыдущего запуска.
*/
drop trigger if exists forum_guide_before on public.forum_guides;
create trigger forum_guide_before
  before insert or update on public.forum_guides
  for each row execute function public.forum_guide_before();
