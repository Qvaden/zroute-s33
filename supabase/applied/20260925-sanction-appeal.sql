-- 2026-09-25. Оспаривание запрета писать и тишины.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- перенесена на наш SQL: там апелляция пристёгнута к уведомлению о удалении
-- поста, а сама блокировка оспорить нельзя — в их коде это подтверждается
-- отказом на сервере. Мы делаем наоборот: оспаривается именно мера, которая
-- не даёт человеку сказать слово.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Модератор тоже человек, и он ошибается: пункты правил объясняет текстом,
-- а решает по смыслу. Когда решение лишает слова целиком, у ошибившегося
-- игрока не остаётся ничего, кроме надежды, что администратор заглянет в
-- список игроков. Такая надежда — не процедура, и ниже она превращена в неё.
--
-- Оспорить можно две меры: «запрет писем» (banned) и «тишину до даты»
-- (muted_until). Удаление поста здесь сознательно не оспаривается: пост
-- виден, причина рядом, и у человека всегда остаётся право пожаловаться
-- второй стороне и написать заново по правилам. Запрет писать не оставляет
-- ни одного ответа, поэтому очередь разбирается именно от него.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Оспорить можно только ту меру, которая действует сейчас: «тишина
--      закончилась вчера» разбирать нечего.
--   2. Одна открытая апелляция на вид меры и на человека. Повтор, пока
--      модератор не ответил, — это давление, а не аргумент.
--   3. После ответа та же мера не оспаривается 7 дней. Без этого шага
--      отказ превращался бы в бесконечную очередь из одного и того же
--      вопроса, а у модератора не оставалось бы способа закрыть тему.
--   4. Текст апелляции — от 20 и не больше 600 символов: заявка из трёх слов
--      не разбирается по существу.
--   5. Модератор обязан ответить текстом от 10 символов. Молчаливое
--      «отклонено» — то же самое, что и отсутствие апелляции.
--   6. «Удовлетворено» снимает ровно ту меру, которую оспорили: бан так и
--      снимает бан, а не всё подряд; апелляция на тишину не возвращает
--      право писать тому, у кого стоит бан.
--   7. Чужие апелляции не видны никому, кроме модерации. Открытый список
--      «кого забанили и кто спорит» — это карта конфликтов, и её мы не
--      раздаём (тот же разговор, что у сигналов об устаревании гайдов).
--
-- ── ПОЧЕМУ ДВЕРИ — ФУНКЦИИ, А НЕ ПОЛИТИКИ ───────────────────────────────────
--
-- Право писать проверяет forum_can_write(), и забаненный человек через него
-- не проходит. Если бы вставка апелляции проверяла её, апелляция оказалась
-- бы доступна всем, кроме того, кому она нужна: запрет писать отменял бы
-- право возразить против запрета писать. Поэтому у таблицы НЕТ политик
-- записи, менять её умеют только две функции ниже.
--
-- Та же причина у отказа от прямых UPDATE со стороны браузера: «отклонено»
-- превратилось бы в «удовлетворено» одним запросом мимо сайта, и вся
-- конструкция потеряла бы смысл.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Те же значения лежат в CONFIG.forum.limits: appealMessageMin (20),
-- appealMessageMax (600), appealAnswerMin (10), appealAnswerMax (600),
-- appealCooldownDays (7). База сторожит их сама, а совпадение чисел с config.js
-- и общность текстов отказа с черновым адаптером сторожит тест.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20260925-announcement-expiry.sql;
-- новых колонок у существующих таблиц здесь нет, представления от этого не
-- застывают, и сайт без этой миграции работает как раньше: апелляции приходят
-- отдельным запросом, а неудача прячет кнопку, а не страницу.

-- ── Шаг 1. Заявки ───────────────────────────────────────────────────────────

create table if not exists public.forum_appeals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.forum_users (id) on delete cascade,

  /*
    ban   — «запрет писем», строка banned у профиля;
    mute  — «тишина до даты», строка muted_until.

    Два значения, а не одно «ограничение»: снимать нужно ровно то, что
    оспорили, и решение по тишине не имеет права трогать бан.
  */
  kind        text not null check (kind in ('ban', 'mute')),

  /*
    Снимок причины на момент заявки. Берётся из ban_reason самой функцией, а
    не присылается браузером: иначе человек принёс бы сюда удобную ему
    причину, и модератор разбирал бы выдумку вместо решения.

    Снимок, а не ссылка на профиль: меру могут снять или изменить, а
    разбираемая заявка должна оставаться тем вопросом, которым она была.
  */
  sanction    text not null default '',

  message     text not null check (char_length(message) between 20 and 600),

  /*
    open     — ждёт решения;
    upheld   — удовлетворена, мера снята;
    rejected — отклонена, ответ прочитан игроком из уведомления.

    «Игрок передумал» отдельным статусом не заводим: снять заявку может
    только тот, кто её открыл, а очередь от этого не становится интереснее.
  */
  status      text not null default 'open'
                check (status in ('open', 'upheld', 'rejected')),

  /*
    Ответ модерации. Пусто допускается: пока заявка открыта, отвечать ещё
    нечем. Диапазон длин держат и эта проверка, и функция решения — здесь он
    нужен, чтобы ответ не мог появиться мимо слов отказа.
  */
  answer      text not null default ''
                check (answer = '' or char_length(answer) between 10 and 600),

  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.forum_users (id) on delete set null
);

comment on table public.forum_appeals is
  'Заявки игроков на пересмотр запрета писать и тишины. Открывает их сам игрок, решает модерация.';

/*
  Одна открытая заявка на пару «человек и вид меры». Частичный индекс, как у
  заявок на восстановление: закрытые не мешают вернуться к вопросу потом,
  поэтому отвергнутая апелляция не закрывает путь навсегда.
*/
create unique index if not exists forum_appeals_one_open
  on public.forum_appeals (user_id, kind)
  where status = 'open';

-- Очередь панелью: сначала свежие ожидающие.
create index if not exists forum_appeals_queue_idx
  on public.forum_appeals (status, created_at desc);

alter table public.forum_appeals enable row level security;

/*
  Игроку — свои, модерации — все. Политик записи нет намеренно: см. рассуждение
  в начале файла про forum_can_write().
*/
drop policy if exists forum_appeals_read on public.forum_appeals;
create policy forum_appeals_read on public.forum_appeals
  for select using (user_id = auth.uid() or public.forum_is_staff());

grant select on public.forum_appeals to authenticated;

-- ── Шаг 2. Дверь игрока ─────────────────────────────────────────────────────

create or replace function public.forum_open_appeal(p_kind text, p_message text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user    public.forum_users%rowtype;
  v_text    text;
  v_last    timestamptz;
  v_days    integer;
begin
  if auth.uid() is null then
    raise exception 'Оспорить решение может только вошедший игрок';
  end if;

  if p_kind is null or p_kind not in ('ban', 'mute') then
    raise exception 'Оспорить можно запрет писем или тишину';
  end if;

  select * into v_user from public.forum_users where id = auth.uid();
  if not found then
    raise exception 'Оспорить решение может только вошедший игрок';
  end if;

  /*
    Мера должна действовать сейчас. Проверка на месте, а не в браузере:
    кнопка на странице могла пережить снятие запрета, и заявка «оспорить бан,
    которого нет» повисла бы у модерации мусором.
  */
  if p_kind = 'ban' and v_user.banned = false then
    raise exception 'Запрета писем сейчас нет — оспаривать нечего';
  end if;

  if p_kind = 'mute'
     and (v_user.muted_until is null or v_user.muted_until <= now()) then
    raise exception 'Тишина уже закончилась — оспаривать нечего';
  end if;

  v_text := btrim(coalesce(p_message, ''));

  if char_length(v_text) < 20 then
    raise exception 'Нужно хотя бы 20 символов: опишите, что именно не так с решением';
  end if;

  if char_length(v_text) > 600 then
    raise exception 'Не больше 600 символов: важна суть, а не пересказ всей переписки';
  end if;

  if exists (select 1 from public.forum_appeals
              where user_id = auth.uid() and kind = p_kind and status = 'open') then
    raise exception 'Такая апелляция уже открыта — модератор её ещё не разобрал';
  end if;

  /*
    Отсчёт выдержки — от ответа, а не от заявки: пока модератор молчит,
    игрок ждёт, и считать ему дни не с чего.
  */
  select max(decided_at) into v_last
    from public.forum_appeals
   where user_id = auth.uid() and kind = p_kind and status <> 'open';

  if v_last is not null and v_last > now() - interval '7 days' then
    v_days := greatest(1, ceiling(extract(epoch from (
      v_last + interval '7 days' - now())) / 86400));
    raise exception 'По этому вопросу уже ответили: новую апелляцию можно открыть через % дн.', v_days;
  end if;

  insert into public.forum_appeals (user_id, kind, sanction, message)
  values (
    auth.uid(),
    p_kind,
    case when v_user.ban_reason = '' then 'причина не указана'
         else left(v_user.ban_reason, 600) end,
    left(v_text, 600)
  );

  /*
    Модератор узнаёт о заявке из очереди панели; уведомление нужно для
    другого: очередь открывают не каждый день, а неразобранная апелляция
    выглядит как «никому не интересно». Пишется тем же порядком, что и
    уведомления о накопившихся жалобах.
  */
  insert into public.forum_notifications (user_id, actor_nick, kind, preview)
  select u.id,
         'Система',
         'moderation',
         left('Апелляция: ' || v_user.nick
              || ' — ' || case when p_kind = 'ban' then 'запрет писем' else 'тишина' end,
              120)
    from public.forum_users u
   where u.role in ('admin', 'moderator');
end;
$$;

revoke all on function public.forum_open_appeal(text, text) from public, anon;
grant execute on function public.forum_open_appeal(text, text) to authenticated;

comment on function public.forum_open_appeal(text, text) is
  'Заявка игрока на пересмотр запрета писем или тишины; работает и у забаненного — право возразить не право писать.';

-- ── Шаг 3. Дверь модерации ──────────────────────────────────────────────────

create or replace function public.forum_review_appeal(p_target uuid, p_status text, p_answer text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_appeal public.forum_appeals%rowtype;
  v_staff  text;
  v_text   text;
  v_word   text;
begin
  if not public.forum_is_staff() then
    raise exception 'Апелляцию разбирает модерация';
  end if;

  if p_status not in ('upheld', 'rejected') then
    raise exception 'Неизвестное решение по апелляции: %', p_status;
  end if;

  select * into v_appeal from public.forum_appeals where id = p_target;
  if not found then
    raise exception 'Апелляция не найдена';
  end if;

  v_text := btrim(coalesce(p_answer, ''));

  if char_length(v_text) < 10 then
    raise exception 'Нужно хотя бы 10 символов: игрок ждёт объяснения, а не молчаливого отказа';
  end if;

  if char_length(v_text) > 600 then
    raise exception 'Не больше 600 символов: объяснение должно читаться и с телефона';
  end if;

  v_text := left(v_text, 600);

  /*
    Решение пишется одним UPDATE с условием status = 'open': если второй
    модератор уже успел ответить, запрос ничего не тронет, и мы честно
    скажем «уже разобрана». Проверка «прочитал строку — решил» между двумя
    окнами панели от такой гонки не спасает.
  */
  update public.forum_appeals
     set status = p_status,
         answer = v_text,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_target and status = 'open';

  if not found then
    raise exception 'Эта апелляция уже разобрана: %',
      case when v_appeal.status = 'upheld' then 'удовлетворена' else 'отклонена' end;
  end if;

  if p_status = 'upheld' then
    if v_appeal.kind = 'ban' then
      update public.forum_users
         set banned = false, ban_reason = ''
       where id = v_appeal.user_id;

      /*
        Снятие меры может не случиться: триггер forum_users_guard не даёт
        тронуть бан у администратора. Проверка — после UPDATE, потому что
        UPDATE находит строку и тогда, когда триггер вернул прежнее значение.
      */
      if exists (select 1 from public.forum_users
                  where id = v_appeal.user_id and banned) then
        raise exception 'Запрет не снялся: заявка осталась открытой, разберитесь в списке игроков';
      end if;
    else
      update public.forum_users
         set muted_until = null
       where id = v_appeal.user_id;

      if exists (select 1 from public.forum_users
                  where id = v_appeal.user_id and muted_until is not null) then
        raise exception 'Тишина не снялась: заявка осталась открытой, разберитесь в списке игроков';
      end if;
    end if;
  end if;

  /*
    Молчать об исходе нельзя: игрок узнаёт о решении из уведомления, а не из
    очереди панели, которую он может и не открыть.
  */
  select nick into v_staff from public.forum_users where id = auth.uid();

  v_word := case when p_status = 'upheld' then 'удовлетворена' else 'отклонена' end;

  insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, preview)
  values (
    v_appeal.user_id,
    auth.uid(),
    coalesce(v_staff, 'Модерация'),
    'moderation',
    left('Апелация ' || v_word || ': ' || v_text, 120)
  );

  /*
    История решения лежит в самой строке (status, answer, decided_by,
    decided_at), а снятие меры и так попадает в журнал модерации триггером
    forum_audit_restriction. Отдельную запись в журнал здесь не заводим: две
    записи про одно действие расходятся при первой же правке.
  */
end;
$$;

revoke all on function public.forum_review_appeal(uuid, text, text) from public, anon;
grant execute on function public.forum_review_appeal(uuid, text, text) to authenticated;

comment on function public.forum_review_appeal(uuid, text, text) is
  'Решение модерации по апелляции: ответ обязателен текстом, «удовлетворено» снимает оспоренную меру.';

-- ── Шаг 4. Чтение ───────────────────────────────────────────────────────────

/*
  Модератору нужен ник заявителя, и тянуть его вторым запросом нельзя:
  политика forum_users чужие профили участнику не отдаёт, а представление
  ниже читается правами того, кто его открыл (security_invoker). Игрок
  соединяется со своим профилем и видит свою заявку; ник ответившего
  модератора он не увидит — и не должен: ему нужен ответ, а не состав очереди.

  Представление, а не колонка-копия ника в таблице: заявка живёт дни, а ник
  к тому времени мог смениться, и копия соврала бы про автора жалобы.
*/
create or replace view public.forum_appeal_list
with (security_invoker = on) as
select
  a.id,
  a.user_id,
  u.nick as user_nick,
  a.kind,
  a.sanction,
  a.message,
  a.status,
  a.answer,
  a.created_at,
  a.decided_at,
  d.nick as decided_by_nick
from public.forum_appeals a
join public.forum_users u on u.id = a.user_id
left join public.forum_users d on d.id = a.decided_by;

grant select on public.forum_appeal_list to authenticated;

comment on view public.forum_appeal_list is
  'Заявки с никами: игроку — свои, модерации — все. Право чтения держит политика forum_appeals.';
