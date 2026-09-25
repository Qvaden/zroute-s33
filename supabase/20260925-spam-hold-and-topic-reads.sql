-- 2026-09-25. Выдержка на публикации и метки «не прочитано».
--
-- Две вещи, пришедшие из большого форума сообщества (Qvaden/zroute-alliance-hub).
-- Код оттуда перенести нельзя — у них React и MySQL, у нас статика и Supabase, —
-- но сами правила от стека не зависят, и здесь они записаны на нашем SQL.
--
-- ── 1. ВЫДЕРЖКА ──────────────────────────────────────────────────────────────
--
-- До сих пор ограничить человека написать ещё тему было нечем. Можно позвать
-- друга, зарегистрировать его и залить ленту за минуту; модератор узнаёт об
-- этом, когда лента уже забита, а жалоба на каждый дубль — отдельная работа.
--
-- Правило держит не подозрение в злой воле, а обычный шум: новичок, который
-- «просто спрашивает» в пяти темах подряд, мешает остальным так же, как тролль.
--
--   • тем — не больше ТРЁХ за ДВАДЦАТЬ МИНУТ;
--   • ответов — не больше ВОСЬМИ за ДВЕ МИНУТЫ;
--   • тот же текст, что человек уже публиковал за ПОСЛЕДНИЕ ДЕСЯТЬ МИНУТ, не
--     проходит ни под каким видом: кросс-пост один в один — самый частый вид
--     шума, и лечится он ровно этим.
--
-- У владельца и модератора потолок втрое выше. Не из вежливости: им правда
-- нужно выкладывать новости, отвечать нескольким игрокам в одну смену и
-- вести разбор, и общий лимит на всех заставил бы модератора писать «в окно
-- между жалобами».
--
-- ПОЧЕМУ ТРИГГЕР, А НЕ ПРОВЕРКА В БРАУЗЕРЕ. Тема и ответ уходят прямым
-- запросом в таблицу, под защиту RLS. Политика RLS умеет только разрешить или
-- отказать, и отказ выглядит как «permission denied» — человек не понял бы,
-- что он сделал не так. Триггер же может назвать срок. Браузер предупреждает
-- заранее (числа лежат в config.js), но решением остаётся база: запрос мимо
-- сайта не должен становиться дырой.
--
-- ПОЧЕМУ ОТСЧЁТ ИДЁТ ОТ ЧАСОВ БАЗЫ. Своё время подделать можно, и подсчёт по
-- клиентскому «сейчас» обходился бы переводом стрелок.
--
-- ЧИСЛА. 3 темы / 20 минут, 8 ответов / 2 минуты, 10 минут на повтор, ×3 для
-- staff. Каждое число названо дважды: здесь и в CONFIG.forum.limits (postHold*,
-- commentHold*, repeatHoldMinutes) — проверить совпадение нельзя глазами,
-- поэтому за ним следит тест. Менять — в двух местах, иначе страница обещает
-- одно, а база отказывает по-другому.
--
-- ── 2. МЕТКИ «НЕ ПРОЧИТАНО» ─────────────────────────────────────────────────
--
-- Тема в ленте сейчас выглядит одинаково: прочитана она или там появился
-- десятый ответ. В чатах счётчик новых уже есть, в форуме — не было, и
-- поэтому вернуться в обсуждение можно только по памяти.
--
-- Работает так: при входе в тему ставится отметка прочтения (там же, где
-- считается просмотр), а лента спрашивает базу, сколько чужих ответов появилось
-- позже. Своей записи отметка не нужна — игрок знает, что написал сам.
--
-- Отметки приватны: видеть их может только хозяин. Это не секрет, просто
-- чужая привычка читать в чужом списке бесполезна и слегка неприятна.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: правит
-- существующее и не падает на уже созданном. Выполняется после
-- 20260925-self-recovery.sql; зависимостей между ними нет, порядок выбран
-- по дате.

-- ── Шаг 1. Нормализация текста для проверки на повтор ───────────────────────

/*
  Ключ текста: пробелы и регистр перестают иметь значение. «Привет   всем» и
  «привет всем» становятся одной строкой. Знаки препинания не трогаем: «срочно!»
  и «срочно» — разные тексты, и лечить это надо не дедупликацией, а человеком.
*/
create or replace function public.forum_body_key(p_body text)
returns text
language sql immutable
as $$
  select trim(lower(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g')));
$$;

comment on function public.forum_body_key(text) is
  'Вид текста, в котором «Привет   всем» и «привет всем» совпадают. Нужен одному правилу: повтор того же текста тем же автором.';

-- Вызывается только из триггеров ниже, и наружу эту функцию просить незачем.
revoke all on function public.forum_body_key(text) from public, anon;

-- ── Шаг 2. Быстрые подсчёты ────────────────────────────────────────────────

/*
  Оба индекса нужны триггеру: он считает записи одного автора за короткий
  промежуток. Без индекса это полный обход таблицы при каждом посте, и правило
  само стало бы тормозом форума.
*/
create index if not exists forum_posts_author_created_idx
  on public.forum_posts (author_id, created_at desc);
create index if not exists forum_comments_author_created_idx
  on public.forum_comments (author_id, created_at desc);

-- ── Шаг 3. Темы ────────────────────────────────────────────────────────────

create or replace function public.forum_posts_hold()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  allowed integer;
  left_min integer;
begin
  /*
    Запрос из SQL-редактора не ограничиваем: там нет вошедшего человека, а
    у владельца проекта и так полный доступ. То же правило, что у forum_posts_guard.
  */
  if auth.uid() is null then
    return new;
  end if;

  allowed := 3 * case when public.forum_is_staff() then 3 else 1 end;

  if (select count(*) from public.forum_posts
       where author_id = auth.uid()
         and created_at > now() - interval '20 minutes') >= allowed then
    /*
      Сколько осталось ждать — считаем от самой свежей записи: она отпуск
      держит дольше всех. округление вверх, иначе человек получил бы «через 0
      мин» и нажал бы кнопку снова.
    */
    select ceiling(extract(epoch from (max(created_at) + interval '20 minutes' - now())) / 60)
      into left_min
      from public.forum_posts
     where author_id = auth.uid()
       and created_at > now() - interval '20 minutes';

    raise exception 'Новую тему можно создать через % мин — не больше % за 20 минут',
      greatest(1, coalesce(left_min, 1)), allowed
      using errcode = 'check_violation';
  end if;

  /*
    Повтор того же текста. Смотрим среди тем за последние 10 минут — тот же
    срок и у ответов, чтобы правило «не дублируйся» было одно, а не два.
  */
  if exists (
    select 1 from public.forum_posts
     where author_id = auth.uid()
       and created_at > now() - interval '10 minutes'
       and public.forum_body_key(title || ' ' || body) =
           public.forum_body_key(new.title || ' ' || new.body)
  ) then
    raise exception 'Такая тема у вас уже есть — правьте её, а не заводите копию'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.forum_posts_hold() is
  'Выдержка на темы: 3 за 20 минут (staff — 9) и запрет копировать свой текст за последние 10 минут.';

drop trigger if exists forum_posts_hold on public.forum_posts;
create trigger forum_posts_hold
  before insert on public.forum_posts
  for each row execute function public.forum_posts_hold();

-- ── Шаг 4. Ответы ──────────────────────────────────────────────────────────

create or replace function public.forum_comments_hold()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  allowed integer;
  left_min integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  allowed := 8 * case when public.forum_is_staff() then 3 else 1 end;

  if (select count(*) from public.forum_comments
       where author_id = auth.uid()
         and created_at > now() - interval '2 minutes') >= allowed then
    /*
      Здесь остаток в минутах, хотя окно — две минуты. Секунды показали бы
      «осталось 47 сек» и заставили бы смотреть на часы; минуты означают
      «допиши позже», и это ровно то, что от человека и требуется.
    */
    select ceiling(extract(epoch from (max(created_at) + interval '2 minutes' - now())) / 60)
      into left_min
      from public.forum_comments
     where author_id = auth.uid()
       and created_at > now() - interval '2 minutes';

    raise exception 'Отвечать можно снова через % мин — не больше % за 2 минуты',
      greatest(1, coalesce(left_min, 1)), allowed
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.forum_comments
     where author_id = auth.uid()
       and created_at > now() - interval '10 minutes'
       and public.forum_body_key(body) = public.forum_body_key(new.body)
  ) then
    raise exception 'Вы уже писали это — скопировать один и тот же ответ в несколько тем нельзя'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.forum_comments_hold() is
  'Выдержка на ответы: 8 за 2 минуты (staff — 24) и запрет повторять свой текст за последние 10 минут.';

drop trigger if exists forum_comments_hold on public.forum_comments;
create trigger forum_comments_hold
  before insert on public.forum_comments
  for each row execute function public.forum_comments_hold();

-- ── Шаг 5. Отметки прочтения ───────────────────────────────────────────────

create table if not exists public.forum_topic_reads (
  user_id      uuid not null references public.forum_users (id) on delete cascade,
  post_id      uuid not null references public.forum_posts (id) on delete cascade,
  /*
    Одна строка на пару «человек и тема», а не журнал визитов: нужен только
    последний вход. Журнал дал бы больше данных и ровно ноль пользы — плюс
    хранил бы привычку чтения человека, которая никому не нужна.
  */
  last_read_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.forum_topic_reads enable row level security;

drop policy if exists forum_topic_reads_own on public.forum_topic_reads;
create policy forum_topic_reads_own on public.forum_topic_reads
  for select using (user_id = auth.uid());

drop policy if exists forum_topic_reads_write on public.forum_topic_reads;
create policy forum_topic_reads_write on public.forum_topic_reads
  for insert with check (user_id = auth.uid());

drop policy if exists forum_topic_reads_update on public.forum_topic_reads;
create policy forum_topic_reads_update on public.forum_topic_reads
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

/*
  Отметку ставит функция, а не браузер напрямую — по той же причине, что и
  просмотр: править чужие строки по правилам таблицы нельзя, а счётчик должен
  расти у любого. Плюс вызов укорочен до одного запроса вместо «найти свою
  строку, потом обновить».
*/
create or replace function public.forum_read_topic(target_post uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.forum_topic_reads (user_id, post_id, last_read_at)
  values (auth.uid(), target_post, now())
  on conflict (user_id, post_id)
    do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke all on function public.forum_read_topic(uuid) from public, anon;
grant execute on function public.forum_read_topic(uuid) to authenticated;

comment on function public.forum_read_topic(uuid) is
  'Отметка «я здесь был» для одного человека и одной темы. Повторный вход передвигает отметку.';

-- ── Шаг 6. Сколько не прочитано ─────────────────────────────────────────────

/*
  ОТДЕЛЬНОЕ ПРЕДСТАВЛЕНИЕ, А НЕ НОВАЯ КОЛОНКА В forum_post_list. То огромное,
  и каждая правка в нём — риск уронить ленту целиком; здесь же поле нужно
  ровно одно, и клиент склеивает его с лентой тем же способом, каким уже
  склеивает подписки (см. listPosts в src/forum/adapters/supabase.js).

  Считаются чужие ответы: свои человек написал сам, и считать их новыми не за
  чем. Стёртые не считаем: вместо них остаётся заглушка с причиной, и счётчик,
  который зовёт читать заглушку, обесценивает всё правило.
  Для анонимного запроса строк нет вовсе: отметки привязаны к человеку.
*/
drop view if exists public.forum_topic_unread;
create view public.forum_topic_unread with (security_invoker = on) as
select p.id as post_id,
  (select count(*) from public.forum_comments c
    where c.post_id = p.id
      and c.deleted = false
      and c.author_id is distinct from auth.uid()
      and c.created_at > coalesce(
            (select r.last_read_at from public.forum_topic_reads r
              where r.user_id = auth.uid() and r.post_id = p.id),
            to_timestamp(0))) as unread
from public.forum_posts p
where p.deleted = false
  and auth.uid() is not null;

grant select on public.forum_topic_unread to authenticated;

comment on view public.forum_topic_unread is
  'Сколько чужих ответов в каждой теме появилось после последнего входа этого человека.';
