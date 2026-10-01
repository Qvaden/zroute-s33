-- 2026-09-25. Срок действия для тем набора и срочных сигналов.
--
-- Правило пришло из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- где доска объявлений и бартер живут с истекающей датой. Код оттуда не
-- переносится — у них React и MySQL, у нас статика и Supabase, — но само
-- правило от стека не зависит, и здесь оно записано на нашем SQL.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- «Набор в альянс открыт» — это обещание. Через месяц оно перестаёт быть
-- правдой, а в ленте висит: игрок читает, приходит, узнаёт что набор закрыт,
-- и делает вывод, что форуму верить нельзя. С «срочно» то же самое, только
-- заметнее: просьба о помощи, висящая спустя неделю, выглядит абсурдно.
--
-- До сих пор единственной подсказкой была дата публикации. Она не говорит,
-- актуален ли призыв, — срок говорит.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   • метка «Набор» или «Срочно» обязывает тему иметь срок;
--   • у любой другой темы срок по желанию: объявление «до следующего патча»
--     живёт по тем же часам, и запрещать это незачем;
--   • срок ставится вперёд не меньше чем на сутки и не больше чем на 90 дней.
--
-- 90 дней — не косметика. Без верхней границы «срок» превращается в способ
-- молча сделать тему вечной, и правило обходится одним кликом.
--
-- Метка «Срочно» (sos) заведена здесь же: сигнал «помогите со столицей
-- сегодня вечером» не описывается ни одной из прежних меток, а срок без него
-- был бы половинчатым — такие темы уходят в неактуальность быстрее всех.
--
-- ── ПОЧЕМУ ИСТЕКШАЯ ТЕМА НЕ ПРОПАДАЕТ ИЗ ЛЕНТЫ ─────────────────────────────
--
-- Соседний проект скрывает истёкшие объявления со доски. У нас так делать
-- нельзя: тема — это ещё и обсуждение под ней, и вместе с объявлением
-- пропал бы весь тред, включая ответы людей. Плюс история сервера: «кто и
-- когда набирал альянс» — справочная информация, вычёркивать её из поиска
-- незачем. Поэтому тема остаётся на месте и честно получает метку «срок
-- вышел», а продлить её может автор или модерация.
--
-- ── ПОЧЕМУ ТРИГГЕР, А НЕ ПРОВЕРКА В БРАУЗЕРЕ ───────────────────────────────
--
-- Пост уходит прямым запросом в таблицу под защиту RLS. Политика RLS умеет
-- только разрешить или отказать, и отказ выглядит как «permission denied» —
-- человек не понял бы, чего от него хотят. Триггер же называет причину.
-- Браузер подсказывает заранее (числа лежат в config.js), но решает база:
-- запрос мимо сайта не должен становиться дырой.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Минимум сутки, максимум 90 дней, варианты выбора 3 / 7 / 14 / 30 и сроки
-- по умолчанию (набор — 14, срочно — 3). Каждое число названо дважды: здесь
-- и в CONFIG.forum.limits (expiryDaysMin, expiryDaysMax, expiryChoices,
-- expiryDefault) — совпадение сторожит тест, потому что глазами его не
-- проверить. Менять — в двух местах, иначе форма обещает одно, а база
-- отказывает по-другому.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный.
-- Выполняется после 20260925-guide-review.sql.
--
-- ВАЖНО ПРО ПРЕДСТАВЛЕНИЕ. Колонки представления фиксируются в момент его
-- создания: select p.* в старом определении уже никогда не увидит новую
-- колонку таблицы. Поэтому шаг 4 пересоздаёт forum_post_list заново — иначе
-- лента не получила бы expires_at и срок не отобразился бы нигде.

-- ── Шаг 1. Колонка и новая метка ────────────────────────────────────────────

alter table public.forum_posts add column if not exists expires_at timestamptz;

comment on column public.forum_posts.expires_at is
  'До какого числа тема считается актуальной. null — срок не назначен; для меток «Набор» и «Срочно» его требует триггер forum_posts_expiry.';

alter table public.forum_posts drop constraint if exists forum_posts_tags_check;
alter table public.forum_posts add constraint forum_posts_tags_check check (
  cardinality(tags) <= 3 and tags <@ array['vs','recruiting','diplomacy','guide','question','event','sos']::text[]
);

-- ── Шаг 2. Какие метки требуют срок ─────────────────────────────────────────

/*
  Отдельная функция, а не выражение внутри триггера: список меток знает одно
  правило, и перечислять его дважды — значит однажды разойтись.
*/
create or replace function public.forum_expiry_required(p_tags text[])
returns boolean
language sql immutable
as $$
  select coalesce(p_tags, '{}') && array['recruiting','sos']::text[];
$$;

comment on function public.forum_expiry_required(text[]) is
  'Возвращает true для меток, чья тема обязана иметь срок действия: «Набор» и «Срочно».';

-- Вызывается только триггером ниже, наружу её просить некому.
revoke all on function public.forum_expiry_required(text[]) from public, anon;

-- ── Шаг 3. Проверка срока ───────────────────────────────────────────────────

create or replace function public.forum_posts_expiry()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора не ограничиваем: там нет вошедшего человека,
  -- а у владельца проекта и так полный доступ. То же правило, что у forum_posts_guard.
  if auth.uid() is null then
    return new;
  end if;

  /*
    Требование срока смотрим ТОЛЬКО когда человек трогает метки или срок.
    Иначе старая тема «Набор», заведённая до этого правила, отказывала бы
    на любом запросе: модератор жмёт «удалить» или «закрепить» — и получает
    «выберите срок действия». Это выглядело бы поломкой сайта, а не правилом.
  */
  if (new.tags is distinct from old.tags or new.expires_at is distinct from old.expires_at)
     and public.forum_expiry_required(new.tags)
     and new.expires_at is null then
    raise exception 'У темы с меткой «Набор» или «Срочно» должен быть срок действия — выберите, сколько дней она висит'
      using errcode = 'check_violation';
  end if;

  if new.expires_at is null then
    return new;
  end if;

  if new.expires_at <= now() + interval '1 day' then
    raise exception 'Срок должен быть хотя бы на сутки впереди — вчерашнее объявление актуальным не станет'
      using errcode = 'check_violation';
  end if;

  if new.expires_at > now() + interval '90 days' then
    raise exception 'Срок не дальше 90 дней — иначе тема зависнет в ленте навсегда'
      using errcode = 'check_violation';
  end if;

  /*
    Продлить можно и вышедшую тему: срок отсчитывается от «сейчас», а не от
    прежней даты, иначе продление темы, проспавшей месяц, дало бы несколько
    дней вместо целого месяца.
  */
  return new;
end;
$$;

comment on function public.forum_posts_expiry() is
  'Срок действия темы: обязателен для «Набор» и «Срочно», от 1 до 90 дней вперёд.';

drop trigger if exists forum_posts_expiry on public.forum_posts;
create trigger forum_posts_expiry
  before insert or update on public.forum_posts
  for each row execute function public.forum_posts_expiry();

-- ── Шаг 4. Лента должна видеть новую колонку ────────────────────────────────

/*
  Копия определения из 20260916-forum-community.sql, дословно и в том же
  порядке колонок, — пересоздаётся оно здесь только затем, чтобы select p.*
  заново развернулся и забрал expires_at.
*/
drop view if exists public.forum_post_list;
create view public.forum_post_list with (security_invoker = on) as
select p.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  (select count(*) from public.forum_comments c where c.post_id=p.id and not c.deleted) as comment_count,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='post' and target_id=p.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='post' and target_id=p.id and user_id=auth.uid()) my_reaction,
  coalesce((select sum(case reaction when 'like' then 1 when 'dislike' then -1 else 0 end) from public.forum_reactions where target_type='post' and target_id=p.id),0) score,
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'url',a.url) order by a.created_at) from public.forum_attachments a where a.target_type='post' and a.target_id=p.id),'[]'::jsonb) attachments,
  (select jsonb_build_object('id',pl.id,'question',pl.question,'multiple',pl.multiple,'closed',pl.closed,'total',(select count(distinct user_id) from public.forum_poll_votes v where v.poll_id=pl.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text,'votes',(select count(*) from public.forum_poll_votes v where v.option_id=o.id),'mine',exists(select 1 from public.forum_poll_votes v where v.option_id=o.id and v.user_id=auth.uid())) order by o.position,o.id) from public.forum_poll_options o where o.poll_id=pl.id),'[]'::jsonb)) from public.forum_polls pl where pl.post_id=p.id) poll
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;
