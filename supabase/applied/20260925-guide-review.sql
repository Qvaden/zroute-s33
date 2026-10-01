-- 2026-09-25. Отметка «гайд проверен / устарел» и сигнал игрока.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- перенесена на наш SQL: там это редакционный статус материала, и у нас так же.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Гайд, который был прав в августе и стал неправ после патча, опаснее, чем
-- отсутствие гайда: новичок действует по нему уверенно и получает разгром.
-- До сих пор страница гайда не говорила ничего кроме даты правки, — а дата
-- правки не отвечает на вопрос «это ещё работает?».
--
-- Отметку ставит человек из модерации: «проверено» или «устарело», с пояснением
-- и датой. Автоматического устаревания по сроку здесь нет намеренно. Большой
-- форум сообщества пришёл к тому же выводу и записал его в свой запрет:
-- «проверено» нельзя получать из просмотров, реакций или давности. Отметка,
-- которая проставляется сама, начинает врать молча, а игрок перестаёт ей
-- верить ровно тогда, когда она оказалась ложной.
--
-- Игрок, напротив, может только сообщить: «вот это перестало работать». Сигнал
-- ничего на странице не меняет, кроме себя, — он копится у модерации. Так одно
-- недовольство не превращается в самоуправленческое «устарело».
--
-- ── ЧТО ЗДЕСЬ ───────────────────────────────────────────────────────────────
--
--   1. Четыре колонки обзора на forum_guides.
--   2. Сигналы игроков: одна строка на пару «человек и гайд».
--   3. Триггер-страх: отметку правит только модерация. Автор гайда не может
--      объявить собственный текст проверенным — иначе «Проверено» стоит на
--      каждом гайде и ничего не значит.
--   4. forum_review_guide — единственная дверь для отметки; она же закрывает
--      сигналы, потому что решённый вопрос не должен висеть у модерации.
--   5. forum_report_guide_stale — единственная дверь для сигнала: повтор
--      уточняет текст того же человека, а не плодит очередь.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Выполняется после
-- 20260925-spam-hold-and-topic-reads.sql; зависимости между ними нет.

-- ── Шаг 1. Колонки обзора ───────────────────────────────────────────────────

alter table public.forum_guides
  add column if not exists review_status text not null default 'none'
    check (review_status in ('none', 'verified', 'outdated'));

alter table public.forum_guides
  add column if not exists review_note text not null default '';

alter table public.forum_guides
  add column if not exists reviewed_at timestamptz;

alter table public.forum_guides
  add column if not exists reviewed_by uuid
    references public.forum_users (id) on delete set null;

comment on column public.forum_guides.review_status is
  'none — никто не проверял; verified — работает, проверено модерацией; outdated — не работает, читать с осторожностью.';

comment on column public.forum_guides.review_note is
  'Пояснение к отметке, которое видит игрок: что именно изменилось.';

-- ── Шаг 2. Сигналы игроков ──────────────────────────────────────────────────

/*
  Ключ из двух полей — это и есть правило «один человек — один сигнал».
  Без него недовольный игрок заполнил бы очередь десятью строками, и надпись
  «сигналов: 12» стала бы враньём про двенадцать человек.
*/
create table if not exists public.forum_guide_signals (
  guide_id   uuid not null references public.forum_guides (id) on delete cascade,
  user_id    uuid not null references public.forum_users (id) on delete cascade,
  note       text not null default '' check (char_length(note) between 5 and 280),
  created_at timestamptz not null default now(),
  resolved   boolean not null default false,
  primary key (guide_id, user_id)
);

alter table public.forum_guide_signals enable row level security;

/*
  Видно своё, всё — модерации. Игроку чужие сигналы не показываются не из
  секретности: список «кто сообщил об устаревании» легко читается как список
  недовольных, а такого адреса у сообщений нет. Модератору нужен полный состав,
  иначе «три сигнала» неотличимы от «три сигнала одного человека».

  Отдельного представления-счётчика, как с непрочитанными темами, здесь нет:
  таблица маленькая, и её целиком читает тот же запрос, что приносит список
  гайдов.
*/
drop policy if exists forum_guide_signals_read on public.forum_guide_signals;
create policy forum_guide_signals_read on public.forum_guide_signals
  for select using (user_id = auth.uid() or public.forum_is_staff());

drop policy if exists forum_guide_signals_write on public.forum_guide_signals;
create policy forum_guide_signals_write on public.forum_guide_signals
  for insert with check (user_id = auth.uid() and public.forum_can_write());

drop policy if exists forum_guide_signals_update on public.forum_guide_signals;
create policy forum_guide_signals_update on public.forum_guide_signals
  for update using (public.forum_is_staff());

drop policy if exists forum_guide_signals_withdraw on public.forum_guide_signals;
create policy forum_guide_signals_withdraw on public.forum_guide_signals
  for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.forum_guide_signals to authenticated;

comment on table public.forum_guide_signals is
  'Сообщения игроков «гайд устарел». Одно сообщение от одного человека, закрывает его отметка модерации.';

-- ── Шаг 3. Отметку ставит модерация, а не автор ─────────────────────────────

/*
  Право править гайд есть у автора (политика forum_guides_update: автор или
  модерация), и вместе с текстом автор мог бы унести в PATCH ещё и
  review_status. Тогда «Проверено модерацией» появлялось бы под каждым
  собственным гайдом, и игрок не мог бы отличить подтверждённый текст от
  самоподтверждённого.

  Триггер сравнивает новые значения со старыми: обычная правка текста их не
  трогает, PostgREST присылает только изменённые колонки, — значит срабатывает
  ровно на попытку поменять обзор. Отказ называется словами, а не выглядит как
  «permission denied»: автор мог нажать это честно, не понимая, что отметка
  чужая.
*/
create or replace function public.forum_guide_review_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.review_status is distinct from old.review_status
    or new.review_note  is distinct from old.review_note
    or new.reviewed_at  is distinct from old.reviewed_at
    or new.reviewed_by  is distinct from old.reviewed_by then
    if not public.forum_is_staff() then
      raise exception 'Отметку «проверен / устарел» ставит модерация';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_guide_review_guard on public.forum_guides;
create trigger forum_guide_review_guard
  before update on public.forum_guides
  for each row execute function public.forum_guide_review_guard();

-- ── Шаг 4. Единственная дверь для отметки ───────────────────────────────────

/*
  Страница не пишет в четыре колонки напрямую: ей нужна одна кнопка и один
  ответ базы, а не набор полей, которые можно передать невпопад. Функция сама
  подставляет, кто и когда решил, и не пропускает статус вне списка.

  Заодно она закрывает сигналы этого гайда. Модератор, который посмотрел гайд и
  поставил отметку, вопрос решил; оставь мы сигналы открытыми, очередь навсегда
  наполнилась бы разбором того, что уже разобрано, и модератор перестал бы в
  неё заглядывать.

  Служебный ключ сайта не участвует: вызов идёт под игроком, и без прав
  модерации функция отказывает сама, до всякой политики.
*/
create or replace function public.forum_review_guide(target uuid, status text, note text default '')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.forum_is_staff() then
    raise exception 'Отметку «проверен / устарел» ставит модерация';
  end if;

  if status not in ('none', 'verified', 'outdated') then
    raise exception 'Неизвестный статус проверки: %', status;
  end if;

  update public.forum_guides
    set review_status = status,
        review_note   = left(btrim(coalesce(note, '')), 280),
        reviewed_at   = case when status = 'none' then null else now() end,
        reviewed_by   = case when status = 'none' then null else auth.uid() end
  where id = target;

  if not found then
    raise exception 'Гайд не найден';
  end if;

  update public.forum_guide_signals
    set resolved = true
  where guide_id = target and resolved = false;
end;
$$;

revoke all on function public.forum_review_guide(uuid, text, text) from public, anon;
grant execute on function public.forum_review_guide(uuid, text, text) to authenticated;

comment on function public.forum_review_guide(uuid, text, text) is
  'Отметка модерации о том, что гайд актуален или устарел; закрывает сигналы игроков.';

-- ── Шаг 5. Дверь сигнала ────────────────────────────────────────────────────

/*
  Почему функцией, а не прямым запросом к таблице: отказ должен быть внятным
  («нужно хотя бы пять символов»), а не текстом нарушения ограничения, и
  повторный сигнал того же человека обязан уточнить прошлый, а не упасть на
  уникальном ключе.

  Открытие сигнала заново — то же право игрока, что и новый: если модератор
  уже поставил отметку, а человек сообщает снова, отметка спорная, и это стоит
  увидеть.
*/
create or replace function public.forum_report_guide_stale(target uuid, note text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Сообщить может только вошедший игрок';
  end if;

  if not public.forum_can_write() then
    raise exception 'Ваш аккаунт сейчас не может писать';
  end if;

  if char_length(btrim(coalesce(note, ''))) < 5 then
    raise exception 'Нужно хотя бы пять символов: что именно перестало работать';
  end if;

  if not exists (select 1 from public.forum_guides where id = target) then
    raise exception 'Гайд не найден';
  end if;

  insert into public.forum_guide_signals (guide_id, user_id, note)
  values (target, auth.uid(), left(btrim(note), 280))
  on conflict (guide_id, user_id)
    do update set note = excluded.note,
                  created_at = now(),
                  resolved = false;
end;
$$;

revoke all on function public.forum_report_guide_stale(uuid, text) from public, anon;
grant execute on function public.forum_report_guide_stale(uuid, text) to authenticated;

comment on function public.forum_report_guide_stale(uuid, text) is
  'Сообщение игрока «гайд устарел»; повтор уточняет текст, а не добавляет строку.';
