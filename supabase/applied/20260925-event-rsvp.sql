-- 2026-09-25. Календарь встреч: событие — это тема, у которой есть дата.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub):
-- там события живут отдельной сущностью с RSVP, лимитом мест и напоминаниями.
-- Перенесено не один в один, а сознательно наполовину: см. «ЧЕГО ЗДЕСЬ НЕТ»
-- в разделе ПРАВИЛО и объяснение в шаге 1.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Договориться о встрече в ленте нельзя: обсуждение идёт неделями, а «во сколько»
-- тонет между ответами. Человек пишет «собираемся в субботу», десять человек
-- отвечают «буду», и ни один из них не знает, что дата уже перенесена трижды.
-- Календарь нужен не для красивого списка, а потому что у встречи есть три вещи,
-- которых у обсуждения нет: момент времени, число участников и напоминание.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Событие — это обычная тема с меткой «Событие» и колонкой event_at.
--      Отдельной таблицы событий здесь нет намеренно: метка «Событие» в тегах
--      живёт с 20260916-forum-community.sql, и вместе с ней у события уже есть
--      обсуждение, реакции, жалобы, подписки, отметка «не прочитано», выдержка
--      на публикацию и право оспорить удаление. Заводя отдельную сущность,
--      пришлось бы строить всё это второй раз — и дважды его же чинить.
--   2. Дату смотрит тема, а не браузер: без event_at метка «Событие» не
--      проходит, а стоит снять метку — дата снимается сама. Иначе в календаре
--      копились бы темы «когда-нибудь».
--   3. Момент назначают вперёд: не меньше чем через 10 минут (часы браузера и
--      базы никогда не совпадают до секунд) и не дальше 90 дней. Прошедшее
--      событие остаётся в календаре завершённым — дата правится только вместе
--      с самой темой, и переписывать её задним числом незачем.
--   4. Участие — три слова: going («буду»), maybe («возможно»), declined
--      («не приду»). Пара «тема и человек» одна, поэтому передумать — это та же
--      строка, а не вторая; «не приду» не удавляет запись, а освобождает место.
--   5. Ответ НЕ требует права писать. Забаненный человек не может спорить
--      словами, но может прийти на рейд: право участвовать — не право писать.
--      Тот же смысл, что у апелляций (20260925-sanction-appeal.sql).
--   6. Мест может быть столько, сколько названо: лимит лежит в теме и считается
--      по ответившим «буду». «Возможно» место не занимает, иначе организатор
--      заполнил бы свою встречу людьми, которые могут и не прийти.
--   7. Отмена — это удаление темы. Темой уже владеет весь форумный механизм:
--      автор снимает её с пометкой «Удалено автором», модератор — с причиной по
--      пункту правил, и в обоих случаях ссылка продолжает открываться с
--      заглушкой. Своего статуса «отменено» нет: две причины отмены у одной
--      темы путались бы.
--   8. Напоминание ставит себе сам игрок: за 15 минут, за час или за сутки, и
--      только на «буду» и «возможно». Пишется в ту же лентку уведомлений, что и
--      ответы и упоминания, — отдельного канала «календарь» не заводим.
--
-- ── ГДЕ ДВЕРЬ ───────────────────────────────────────────────────────────────
--
-- Тема создаётся и правится политиками вставки и обновления — они уже стоят и
-- уже вызывают forum_can_write(). Дата и лимит проходят через триггер
-- forum_posts_event_at, который отказывает словами, а не текстом нарушения
-- ограничения (тот же порядок, что у forum_posts_expiry и
-- forum_section_mute_guard).
--
-- Ответы пишутся только через функцию forum_answer_event: место может быть
-- занятым, и проверка «не больше лимита» обязана происходить внутри одной
-- операции с записью ответа, а не в браузере, где два человека нажмут кнопку
-- одновременно. Политик записи у таблицы ответов нет вовсе — как у заявок на
-- пересмотр меры.
--
-- Счётчики «кто придёт» читает безопасность функции, а не строки: список
-- участников привязан к людям, а число участников — публично. Поэтому
-- forum_event_going и forum_event_maybe объявлены security definer и отдают
-- только число; сами строки видны отвечающему, модерации и организатору темы.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Границы держит эта миграция: горизонт планирования (90 дней), минимальный
-- запас до начала (10 минут), лимит мест (от 2 до 200) и шаги напоминания
-- (15 мин, 1 час, сутки). Те же значения лежат в CONFIG.forum.limits:
-- eventHorizonDays, eventMinLeadMinutes, eventSeatsMin, eventSeatsMax,
-- eventRemindChoices. База сторожит их сама, а совпадение чисел с config.js и
-- общность текстов отказа с черновым адаптером сторожит тест.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20260925-section-mute.sql.
--
-- ДВА места, где файл требует внимания:
--
--   * шаг 4 пересоздаёт представление forum_post_list — колонки представления
--     фиксируются в момент его создания, и старое select p.* уже никогда не
--     увидит event_at (тот же урок, что у 20260925-announcement-expiry.sql);
--     там же представлению добавляют поля my_rsvp и my_remind_minutes, чтобы
--     кнопка ответа на теме знала, что игрок уже отвечал и на когда поставил
--     напоминание;
--   * шаг 7 расширяет список видов уведомления — без этого напоминание не
--     записалось бы, а упало бы на проверке kind.
--
-- Напоминания приносит планировщик: Supabase → Integrations → Cron Jobs →
-- New job → добавить задачу с выражением `*/15 * * * *` и командой `select public.forum_send_event_reminders();`
-- (тот же способ, что у еженедельного дайджеста). Без задачи календарь, ответы и
-- лимит мест работают, а колокольник о встрече молчит.
--
-- До пуша кода эта миграция не обязательна: страница календаря читает
-- представление отдельным запросом, и без таблицы она выходит с прямой надписью
-- «нужно прогнать 20260925-event-rsvp.sql» вместо пустого списка. Лента тем и
-- всё остальное от неё не зависят.

-- ── Шаг 1. У темы появляется момент ─────────────────────────────────────────

/*
  Событие — тема, поэтому дата живёт в той же таблице, что и тема.

  Две колонки, обе допускают пусто: обычная тема ни во что не превращается, а
  метка «Событие» обязывает их заполнить — это держит триггер ниже, а не
  проверка таблицы. Проверка HERE не выразила бы правило «если метка, то дата»:
  она про два столбца сразу и про время, а CHECK время не знает.
*/
alter table public.forum_posts add column if not exists event_at timestamptz;
alter table public.forum_posts add column if not exists
  event_capacity integer check (event_capacity is null or event_capacity between 2 and 200);

comment on column public.forum_posts.event_at is
  'Момент встречи; обязателен, если среди тегов есть «event», и снимается вместе с меткой.';
comment on column public.forum_posts.event_capacity is
  'Сколько мест: 2–200 или пусто без лимита. Считаются ответившие «буду».';

create index if not exists forum_posts_event_idx
  on public.forum_posts (event_at)
  where event_at is not null and not deleted;

-- ── Шаг 2. Правила даты ─────────────────────────────────────────────────────

create or replace function public.forum_posts_event_at()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора не ограничиваем: там нет вошедшего человека,
  -- а у владельца проекта и так полный доступ. Тот же порядок, что у
  -- forum_posts_expiry и forum_posts_guard.
  if auth.uid() is null then
    return new;
  end if;

  -- Метку сняли — дата и лимит уходят сами. Иначе в календаре стояла бы тема,
  -- которая «уже не событие», но всё ещё с моментом и местами.
  if not ('event' = any(new.tags)) then
    new.event_at := null;
    new.event_capacity := null;
    return new;
  end if;

  /*
    Требование даты смотрим ТОЛЬКО когда человек трогает метки или дату.
    Иначе старая тема с меткой, заведённая до этого правила, отказывала бы на
    любом запросе: модератор жмёт «закрепить» — и получает «выберите дату».
    Это ровно тот урок, который записан в forum_posts_expiry.
  */
  if (new.tags is distinct from old.tags or new.event_at is distinct from old.event_at)
     and new.event_at is null then
    raise exception 'У темы с меткой «Событие» должен быть момент — выберите дату и время'
      using errcode = 'check_violation';
  end if;

  if new.event_at is null then
    return new;
  end if;

  /*
    Границы момента смотрим ТОЛЬКО когда дату трогали. Иначе завершённая
    встреча отказывала бы модератору на «закрепить»: её момент по определению
    в прошлом, а правило про «не меньше десяти минут вперёд» там и не было бы
    нарушено. Это ровно тот урок, что записан выше про обязательность даты.
  */
  if new.event_at is not distinct from old.event_at then
    return new;
  end if;

  /*
    Десять минут запаса — не педантизм, а разные часы: человек назначает
    «на 20:00», его браузер живёт по своим часам, база — по своим, и встреча,
    которая «уже прошла» в момент публикации, выглядела бы поломкой.
  */
  if new.event_at <= now() + interval '10 minutes' then
    raise exception 'Назначайте встречу минимум через 10 минут — иначе она родится уже прошедшей'
      using errcode = 'check_violation';
  end if;

  if new.event_at > now() + interval '90 days' then
    raise exception 'Не дальше 90 дней: планируют на квартал, а не на год'
      using errcode = 'check_violation';
  end if;

  /*
    Перенесли встречу вперёд — напоминание возвращается. Строка с уже
    поставленной отметкой больше не сработала бы, и человек пропустил бы
    перенесённую встречу молча. Правим ответы напрямую: триггер работает
    правами владельца схемы и политики на запись ответов не проверяет.
  */
  if old.event_at is not null and new.event_at > old.event_at then
    update public.forum_event_rsvps r
       set reminded_at = null
      where r.post_id = new.id
        and r.reminded_at is not null
        and new.event_at - make_interval(mins => r.remind_minutes) > now();
  end if;

  return new;
end;
$$;

comment on function public.forum_posts_event_at() is
  'Дата события: обязательна при метке «event», снимается вместе с ней, от 10 минут до 90 дней вперёд.';

drop trigger if exists forum_posts_event_at on public.forum_posts;
create trigger forum_posts_event_at
  before insert or update on public.forum_posts
  for each row execute function public.forum_posts_event_at();

-- ── Шаг 3. Кто идёт ─────────────────────────────────────────────────────────

create table if not exists public.forum_event_rsvps (
  post_id uuid not null references public.forum_posts (id) on delete cascade,
  user_id uuid not null references public.forum_users (id) on delete cascade,

  /*
    going    — «буду», занимает место;
    maybe    — «возможно», места не занимает;
    declined — «не приду», освобождает место и перестаёт ждать напоминание.

    Отдельного «интересно» нет: «возможно» и есть вежливое «интересно», а
    четыре слова превращают ответ в анкету.
  */
  status text not null check (status in ('going', 'maybe', 'declined')),

  -- Шаг напоминания в минутах; пусто — не напоминать. Три готовых значения, а
  -- не свободное число: человек выбирает «за сколько до начала», а не считает
  -- минуты, и базе не надо спорить с произвольным значением.
  remind_minutes integer check (remind_minutes is null or
    remind_minutes in (15, 60, 1440)),

  -- Когда напоминание уже ушло. Снимает её сама встреча, если её перенесли
  -- (см. forum_posts_event_at), и сбрасывает игрок, если заново выбрал срок.
  reminded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Одна строка на человека и встречу: передумал — та же запись.
  primary key (post_id, user_id)
);

comment on table public.forum_event_rsvps is
  'Ответы игроков на события: буду, возможно, не приду, и срок напоминания.';

create index if not exists forum_event_rsvps_event_idx
  on public.forum_event_rsvps (post_id, status);

/*
  Личная лента «мои встречи». Без этого индекса каждый заход на страницу
  перебирал бы все ответы форума: таблица растёт с каждой встречей.
*/
create index if not exists forum_event_rsvps_mine_idx
  on public.forum_event_rsvps (user_id, status, created_at desc);

alter table public.forum_event_rsvps enable row level security;

/*
  Своё видит человек, всё про свою встречу — её организатор, все — модерация:
  ей нужно разбирать жалобу на «список участников». Чужой список гостей модератор
  читает по делу, а не по умолчанию, и ровно поэтому его нет в публичном
  представлении: наружу выходят только числа.
*/
drop policy if exists forum_event_rsvps_read on public.forum_event_rsvps;
create policy forum_event_rsvps_read on public.forum_event_rsvps
  for select using (
    user_id = auth.uid()
    or public.forum_is_staff()
    or exists (
      select 1 from public.forum_posts p
       where p.id = post_id and p.author_id = auth.uid()
    )
  );

/*
  Политик на запись нет вовсе: ответ принимает функция forum_answer_event —
  только она умеет сказать «мест больше нет», проверяя и занимая место в одной
  операции. Прямой INSERT из браузера отвергается по умолчанию, как у заявок
  на пересмотр меры и у тишины по разделам.
*/
grant select on public.forum_event_rsvps to authenticated;

-- ── Шаг 4. Счётчики и лента календаря ───────────────────────────────────────

/*
  Число пришедших — публичное, строки — личные. Поэтому функция работает
  правами владельца схемы (security definer) и отдаёт наружу только count:
  иначе анонимный посетитель видел бы пустой календарь, потому что читать
  ответы ему не разрешено.

  Вызов из представления идёт на каждую строку ленты; объёмы здесь крошечные
  (несколько десятков встреч), а индексы с шага 3 держат оба запроса.
*/
create or replace function public.forum_event_going(p_post uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.forum_event_rsvps
   where post_id = p_post and status = 'going';
$$;

create or replace function public.forum_event_maybe(p_post uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from public.forum_event_rsvps
   where post_id = p_post and status = 'maybe';
$$;

revoke all on function public.forum_event_going(uuid) from public, anon;
revoke all on function public.forum_event_maybe(uuid) from public, anon;
grant execute on function public.forum_event_going(uuid) to anon, authenticated;
grant execute on function public.forum_event_maybe(uuid) to anon, authenticated;

comment on function public.forum_event_going(uuid) is
  'Сколько игроков ответили «буду»; только число, без имён.';
comment on function public.forum_event_maybe(uuid) is
  'Сколько игроков ответили «возможно»; места не считаются.';

/*
  Копия определения forum_post_list из 20260925-announcement-expiry.sql,
  дословно и в том же порядке колонок, — пересоздаётся оно здесь только затем,
  чтобы select p.* заново развернулся и забрал event_at с event_capacity.

  Плюс два новых поля: my_rsvp и my_remind_minutes. Ленте тем нужно знать, что
  ответил сюда вошедший и на когда поставил напоминание, — иначе кнопка «буду»
  на теме выглядела бы нетронутой после того, как человек уже ответил, а срок
  напоминания сбрасывался бы в «не напоминать» при каждом открытии темы. Это
  ровно тот же порядок, что у my_reaction рядом: подбезопасности вызывающего,
  своя строка, наружу только собственное слово.
*/
drop view if exists public.forum_post_list;
create view public.forum_post_list with (security_invoker = on) as
select p.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  (select count(*) from public.forum_comments c where c.post_id=p.id and not c.deleted) as comment_count,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='post' and target_id=p.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='post' and target_id=p.id and user_id=auth.uid()) my_reaction,
  (select r.status from public.forum_event_rsvps r where r.post_id=p.id and r.user_id=auth.uid()) my_rsvp,
  (select r.remind_minutes from public.forum_event_rsvps r where r.post_id=p.id and r.user_id=auth.uid()) my_remind_minutes,
  coalesce((select sum(case reaction when 'like' then 1 when 'dislike' then -1 else 0 end) from public.forum_reactions where target_type='post' and target_id=p.id),0) score,
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'url',a.url) order by a.created_at) from public.forum_attachments a where a.target_type='post' and a.target_id=p.id),'[]'::jsonb) attachments,
  (select jsonb_build_object('id',pl.id,'question',pl.question,'multiple',pl.multiple,'closed',pl.closed,'total',(select count(distinct user_id) from public.forum_poll_votes v where v.poll_id=pl.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text,'votes',(select count(*) from public.forum_poll_votes v where v.option_id=o.id),'mine',exists(select 1 from public.forum_poll_votes v where v.option_id=o.id and v.user_id=auth.uid())) order by o.position,o.id) from public.forum_poll_options o where o.poll_id=pl.id),'[]'::jsonb)) from public.forum_polls pl where pl.post_id=p.id) poll
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;

/*
  Лента календаря: тема + её момент + числа + собственный ответ.

  Своё состояние читаем под безопасностью вызывающего (with security_invoker)
  — человек видит себя, и больше никто не протекает. Отменённые (удалённые)
  темы из списка пропадают, но открываются по ссылке с той же заглушкой, что и
  любой удалённый пост: «отменено» должно быть видно тому, кто шёл.

  Даты без момента в календаре не бывает, и это не перестраховка: метка
  «Событие» живёт в тегах с 20260916-forum-community.sql, и темы с ней уже
  заведены — без event_at. Такая тема в календарь не выйдет, пока организатор
  не назовёт момент; в ленте форума она при этом остаётся собой.
*/
drop view if exists public.forum_event_list;
create view public.forum_event_list with (security_invoker = on) as
select p.id, p.title, p.body, p.category, p.tags, p.author_id, p.author_nick,
  p.created_at, p.event_at, p.event_capacity,
  public.forum_event_going(p.id) as going_count,
  public.forum_event_maybe(p.id) as maybe_count,
  case when p.event_capacity is null then null
       else greatest(0, p.event_capacity - public.forum_event_going(p.id)) end as spots_left,
  (select r.status from public.forum_event_rsvps r
    where r.post_id = p.id and r.user_id = auth.uid()) as my_status,
  (select r.remind_minutes from public.forum_event_rsvps r
    where r.post_id = p.id and r.user_id = auth.uid()) as my_remind_minutes
from public.forum_posts p
where 'event' = any(p.tags) and not p.deleted and p.event_at is not null;

grant select on public.forum_event_list to anon, authenticated;

comment on view public.forum_event_list is
  'Календарь: темы с меткой «Событие», их момент, места и ответ вошедшего.';

-- ── Шаг 5. Дверь игрока ─────────────────────────────────────────────────────

create or replace function public.forum_answer_event(
  p_post uuid, p_status text, p_remind_minutes integer default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_topic   public.forum_posts%rowtype;
  v_previous text;
  v_going   integer;
  v_remind  integer;
begin
  if auth.uid() is null then
    raise exception 'Отвечает на приглашение вошедший игрок';
  end if;

  if p_status is null or p_status not in ('going', 'maybe', 'declined') then
    raise exception 'Отвечают одним из трёх слов: буду, возможно, не приду';
  end if;

  if p_remind_minutes is not null
     and p_remind_minutes not in (15, 60, 1440) then
    raise exception 'Напоминание ставят на готовый срок: за 15 минут, за час или за сутки';
  end if;

  select * into v_topic from public.forum_posts where id = p_post;
  if not found then
    raise exception 'События уже нет: страница устарела';
  end if;

  if not ('event' = any(v_topic.tags)) then
    raise exception 'Отвечать можно только на тему с меткой «Событие»';
  end if;

  -- Право писать здесь не смотрим сознательно: забаненный не спорит словами,
  -- но прийти на встречу ему никто не мешал. См. правило 5 в начале файла.
  if v_topic.deleted then
    raise exception 'Событие отменено — отвечать не на что';
  end if;

  if v_topic.event_at is null then
    raise exception 'У события нет даты — модератору или автору нужно её поставить';
  end if;

  if v_topic.event_at <= now() then
    raise exception 'Событие уже началось: участие записывают до начала';
  end if;

  select status into v_previous from public.forum_event_rsvps
    where post_id = p_post and user_id = auth.uid();

  /*
    Место считается от нового ответа, а не от текущего состояния: если человек
    уже «буду» и просто меняет срок напоминания, место у него своё, и требовать
    его заново нельзя.

    Блокировка на время транзакции держит встречу: без неё два игрока,
    нажавшие кнопку в одну секунду, прочитали бы «свободно одно место» и оба
    бы его заняли. Ключ — идентификатор темы, поэтому на разных встречах
    ответы не мешают друг другу.
  */
  perform pg_advisory_xact_lock(hashtextextended(p_post::text, 0));

  if p_status = 'going' and v_topic.event_capacity is not null
     and coalesce(v_previous, '') <> 'going' then
    v_going := public.forum_event_going(p_post);
    if v_going >= v_topic.event_capacity then
      raise exception 'Мест больше нет: занято % из % — организатор ждёт «возможно»',
        v_going, v_topic.event_capacity
        using errcode = 'check_violation';
    end if;
  end if;

  -- Напоминание имеет смысл только там, где человек собирается. «Не приду» с
  -- напоминанием — это будильник, который звонит в пустоту.
  if p_status = 'declined' then
    v_remind := null;
  else
    v_remind := p_remind_minutes;
  end if;

  insert into public.forum_event_rsvps (post_id, user_id, status, remind_minutes)
  values (p_post, auth.uid(), p_status, v_remind)
  on conflict (post_id, user_id) do update
    set status = excluded.status,
        remind_minutes = excluded.remind_minutes,
        -- Новый срок — новое напоминание: старый уже ушёл и не считается.
        reminded_at = case
          when forum_event_rsvps.remind_minutes is distinct from excluded.remind_minutes
            then null
          else forum_event_rsvps.reminded_at end,
        updated_at = now();
end;
$$;

revoke all on function public.forum_answer_event(uuid, text, integer) from public, anon;
grant execute on function public.forum_answer_event(uuid, text, integer) to authenticated;

comment on function public.forum_answer_event(uuid, text, integer) is
  'Ответ игрока на событие и срок напоминания; места считает здесь, право писать не требуется.';

-- ── Шаг 6. Напоминания ───────────────────────────────────────────────────────

/*
  Вызывается планировщиком (см. ЗАПУСК в начале файла), а не браузером:
  иначе напоминание зависело бы от того, открыт ли сайт у человека в нужный
  момент, — то есть почти всегда нет.

  Строка помечается отправленной в том же запросе, который её отправил, поэтому
  повторный запуск cron не пришлёт одно и то же дважды. Для встреч, которые
  перенесли вперёд, отметку снимает триггер даты.
*/
create or replace function public.forum_send_event_reminders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  with fired as (
    update public.forum_event_rsvps r
       set reminded_at = now(),
           updated_at  = now()
      from public.forum_posts p
     where p.id = r.post_id
       and not p.deleted
       and 'event' = any(p.tags)
       and p.event_at is not null
       and r.status in ('going', 'maybe')
       and r.remind_minutes is not null
       and r.reminded_at is null
       and p.event_at > now()
       and p.event_at - make_interval(mins => r.remind_minutes) <= now()
    returning r.user_id, p.id as post_id, p.title,
      greatest(1, floor(extract(epoch from (p.event_at - now())) / 60))::int as left_min
  )
  insert into public.forum_notifications (user_id, actor_nick, kind, post_id, preview)
  select f.user_id, 'Календарь', 'event', f.post_id,
         left('Скоро: ' || f.title || ' — через ' || f.left_min || ' мин', 120)
    from fired f;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/*
  Не выполняется со стороны браузера вообще: права anon и authenticated сняты,
  остаётся postgres (он же планировщик Supabase Cron) и SQL-редактор владельца.
*/
revoke all on function public.forum_send_event_reminders() from public, anon, authenticated;

comment on function public.forum_send_event_reminders() is
  'Рассылка напоминаний о ближайших встречах; запускается планировщиком каждые 15 минут.';

-- ── Шаг 7. Вид уведомления ──────────────────────────────────────────────────

alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications add constraint forum_notifications_kind_check check
  (kind in ('mention','reply','reaction','subscription','alliance_rank','moderation','digest','event'));

-- ── Шаг 8. Прав на новые колонки не заводим ─────────────────────────────────

/*
  Колонки event_at и event_capacity добавлены в существующую таблицу, а политики
  forum_posts уже пускают к теме вошедшего и модерацию; отдельного гранта нет
  намеренно — на колонках права не живут. Представление календаря подаровано на
  чтение в шаге 4, там же, где оно создано.
*/
