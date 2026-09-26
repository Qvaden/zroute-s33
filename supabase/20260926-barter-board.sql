-- 2026-09-26. Бартер-доска: тема, в которой назвали, что отдают и что ищут.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- перенесена на наш SQL: там это отдельная таблица barterListings со своей
-- страницей /barter, у нас — тема с меткой «Обмен».
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- «Отдам патроны, ищу банки» на нашем сервере теряется в флудилке за вечер.
-- Люди пишут это в чат, чат прокручивается, и на следующий день никто не
-- помнит, у кого что есть. Доска нужна не для того, чтобы торговаться, —
-- торговаться умеют и в личных сообщениях, — а чтобы предложение осталось
-- висеть и было находимым.
--
-- Доска не обещает сделку и не ведёт её: у нас нет ни денег, ни инвентаря
-- игры, ни способа проверить, что кто-то что-то отдал. Она держит только
-- объявление и его автора. Всё остальное происходит мимо форума, и это
-- честное ограничение, а не недоделка.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Обмен — это тема, а не запись в отдельном ящике. Метка «Обмен»
--      превращает обычную тему в объявление, и вместе с меткой тема получает
--      всё, что уже умела: ответы, жалобы, закрепление модерацией, срок
--      действия. Отдельной таблицы здесь нет нарочно: бартер, у которого
--      нельзя спросить «а точно работает», — это доска объявлений с почтой,
--      а обсуждение под объявлением и есть то, что отличает её от доски.
--   2. Названы обе стороны: что отдают и что ищут. Одна строка «отдам X» без
--      «ищу» — это реклама, а не обмен, и третья часть таких объявлений
--      заканчивается вопросом «а что тебе нужно?», который съедает вечер
--      обоим.
--   3. Объявление всегда с датой: срок действия обязателен, как у набора и
--      срочных тем. Истёкшее не прячется и не удаляется — тема остаётся со
--      своим обсуждением и получает знак «срок вышел» (тот же порядок, что у
--      20260925-announcement-expiry.sql).
--   4. Сделку закрывает автор одной отметкой: «обмен состоялся» или «снял с
--      доски». Тема не удаляется — под ней могли договориться другие, и их
--      ответы исчезли бы вместе с объявлением.
--   5. Модерация снимает объявление как любую тему: удаление с причиной и
--      жалоба работают здесь без отдельных правил.
--   6. Денег, контактов и гарантий здесь нет. Ни колонок под цену, ни поля
--      «мой дискорд»: объявление описывает вещи, а не способ связаться.
--      Контакты и так видны в теме (ник автора), а отдельное поле стало бы
--      приглашением писать их прямо в карточку, где их читают все подряд.
--
-- ── ГДЕ ДВЕРЬ ───────────────────────────────────────────────────────────────
--
--   Дверей нет. Объявление создаётся и правится как тема: политика
--   forum_posts_insert уже требует author_id = auth.uid() и право писать,
--   а forum_posts_update_own пускает к строке только автора (плюс
--   модерацию через forum_posts_moderate). Отметку закрытия ставит тот же
--   автор, и чужая строка ему недоступна просто потому, что он не может её
--   найти запросом — правило «кто правит» в этих таблицах уже стоит.
--
--   Частоту постов держит forum_posts_hold (выдержка: три темы за двадцать
--   минут). Отдельного лимита на объявления нет намеренно: обмен — тема, и
--   второй счётчик на то же действие означал бы, что человек упирается в
--   два разных отказа, не понимая, какой из них про объявления.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
--   Длину обеих строк держит проверка таблицы: от 3 до 200 символов. Те же
--   числа стоят в CONFIG.forum.limits (barterLineMin, barterLineMax), чтобы
--   форма отказывала тем же словом, что и база; совпадение сторожит тест.
--   Срок действия — общие числа объявления (expiryDaysMin, expiryDaysMax,
--   expiryChoices), и бартерного срока отдельного нет: три дня из общего
--   списка подходят объявлению больше, чем сутки, а вариант «на сутки»
--   появился бы здесь ценой нового поля в конфиге ради одной метки.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20260926-post-bookmarks.sql.
--
-- ДВА места, где файл требует внимания:
--
--   * шаг 3 пересоздаёт представление forum_post_list — колонки представления
--     фиксируются в момент его создания, и старое select p.* уже никогда не
--     увидит новые столбцы темы (тот же урок, что у двух предыдущих файлов);
--   * шаг 4 переписывает forum_expiry_required: без неё метка «Обмен» не
--     требовала бы срока, и объявления копили бы просроченное.
--
-- Без этой миграции сайт не падает: обычная лента читается как раньше,
-- колонок у темы просто нет, а черновик работает без базы всегда.
--
-- ── Шаг 1. Две строки и отметка закрытия у темы ─────────────────────────────

/*
  Три колонки, все допускают пусто: обычная тема ни во что не превращается, а
  метка «Обмен» обязывает заполнить две из них — это держит триггер ниже, а не
  проверка таблицы. Проверка не выразила бы правило «если метка, то строки»:
  она про два столбца сразу.

  Границы длины здесь выразимы, и они здесь: короткое «банки» модератору не о
  чем разборчивать, а двести символов — уже не строка, а рассказ, который в
  карточке доски никто не читает.
*/
alter table public.forum_posts add column if not exists
  barter_gives text check (barter_gives is null or char_length(barter_gives) between 3 and 200);
alter table public.forum_posts add column if not exists
  barter_wants text check (barter_wants is null or char_length(barter_wants) between 3 and 200);
alter table public.forum_posts add column if not exists barter_closed_at timestamptz;

comment on column public.forum_posts.barter_gives is
  'Что автор отдаёт: обязательно, если среди тегов есть «barter», и снимается вместе с меткой.';
comment on column public.forum_posts.barter_wants is
  'Что автор ищет: вторая сторона обмена; тоже обязательна при метке.';
comment on column public.forum_posts.barter_closed_at is
  'Момент, когда автор снял объявление с доски. null — объявление открыто.';

-- Метка живёт в том же списке, что и остальные: cardinality остаётся три.
alter table public.forum_posts drop constraint if exists forum_posts_tags_check;
alter table public.forum_posts add constraint forum_posts_tags_check check (
  cardinality(tags) <= 3 and tags <@ array['vs','recruiting','diplomacy','guide','question','event','sos','barter']::text[]
);

/*
  Доска смотрит на «открытые объявления, сверху — свежие». Частичный указатель
  берёт только темы с меткой: на форуме, где объявлений несколько десятков, а
  тем тысячи, полный индекс был бы платой за то, что никто не просит.
*/
create index if not exists forum_posts_barter_idx
  on public.forum_posts (created_at desc)
  where 'barter' = any (tags) and not deleted;

-- ── Шаг 2. Правила метки ────────────────────────────────────────────────────

create or replace function public.forum_posts_barter()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора не ограничиваем: там нет вошедшего человека,
  -- а у владельца проекта и так полный доступ. Тот же порядок, что у
  -- forum_posts_expiry и forum_posts_event_at.
  if auth.uid() is null then
    return new;
  end if;

  /*
    Метку сняли — строки и отметка уходят сами. Иначе тема, которая «уже не
    обмен», висела бы в карточке с «отдам патроны», а автор при этом считал бы,
    что убрал объявление.
  */
  if not ('barter' = any(new.tags)) then
    new.barter_gives := null;
    new.barter_wants := null;
    new.barter_closed_at := null;
    return new;
  end if;

  /*
    Требование обеих строк смотрим ТОЛЬКО когда человек трогает метки или сами
    строки. Иначе старая тема с меткой, заведённая до этого правила, отказывала
    бы на любом запросе: модератор жмёт «закрепить» — и получает «назовите, что
    ищете». Это ровно тот урок, который записан в forum_posts_expiry и
    forum_posts_event_at.
  */
  if (new.tags is distinct from old.tags
      or new.barter_gives is distinct from old.barter_gives
      or new.barter_wants is distinct from old.barter_wants)
     and (new.barter_gives is null or new.barter_wants is null) then
    raise exception 'У темы с меткой «Обмен» должны быть названы обе стороны: что отдаёте и что ищете'
      using errcode = 'check_violation';
  end if;

  /*
    Закрыть объявление задним числом нельзя: отметка — это «я снял сегодня», а
    не способ переписать историю. Будущее время тоже правим на «сейчас»: часы
    браузера и базы различаются, и объявление, закрытое «завтра», висело бы
    открытым ровно тот день, которого никто не ждал.
  */
  if new.barter_closed_at is not null
     and new.barter_closed_at is distinct from old.barter_closed_at then
    if new.barter_closed_at > now() then
      new.barter_closed_at := now();
    end if;
    if new.barter_closed_at < new.created_at then
      raise exception 'Нельзя закрыть объявление раньше, чем оно появилось'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.forum_posts_barter() is
  'Метка «Обмен»: требует обе строки обмена, снимает их вместе с меткой, следит за отметкой закрытия.';

drop trigger if exists forum_posts_barter on public.forum_posts;
create trigger forum_posts_barter
  before insert or update on public.forum_posts
  for each row execute function public.forum_posts_barter();

-- ── Шаг 3. Лента должна видеть новые колонки ────────────────────────────────

/*
  Копия определения из 20260926-author-thanks.sql, дословно и в том же порядке
  колонок, — пересоздаётся оно здесь только затем, чтобы select p.* заново
  развернулся и забрал три новых столбца темы.
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
  (select jsonb_build_object('id',pl.id,'question',pl.question,'multiple',pl.multiple,'closed',pl.closed,'total',(select count(distinct user_id) from public.forum_poll_votes v where v.poll_id=pl.id),'options',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'text',o.text,'votes',(select count(*) from public.forum_poll_votes v where v.option_id=o.id),'mine',exists(select 1 from public.forum_poll_votes v where v.option_id=o.id and v.user_id=auth.uid())) order by o.position,o.id) from public.forum_poll_options o where o.poll_id=pl.id),'[]'::jsonb)) from public.forum_polls pl where pl.post_id=p.id) poll,
  public.forum_thanks_count('post', p.id) as thanks_count,
  exists(select 1 from public.forum_thanks t where t.target_type='post' and t.target_id=p.id and t.giver_id=auth.uid()) i_thanked
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;

-- ── Шаг 4. Объявлению нужен срок ────────────────────────────────────────────

/*
  Список меток, которым назначен срок действия, живёт в одной функции:
  перечислять его второй раз в триггере — значит однажды разойтись. Здесь к
  «Набору» и «Срочным» добавляется «Обмен»: предложение, у которого нет даты,
  на доске превращается в мусор, который никто не решается снять.
*/
create or replace function public.forum_expiry_required(p_tags text[])
returns boolean
language sql immutable
as $$
  select coalesce(p_tags, '{}') && array['recruiting','sos','barter']::text[];
$$;

comment on function public.forum_expiry_required(text[]) is
  'Возвращает true для меток, чья тема обязана иметь срок действия: «Набор», «Срочно» и «Обмен».';

-- Вызывается только триггером forum_posts_expiry, наружу её просить некому.
revoke all on function public.forum_expiry_required(text[]) from public, anon;

-- Подпись колонки называла две метки из трёх: без этой правки читатель схемы
-- не узнал бы, что обмен тоже под тем же правилом.
comment on column public.forum_posts.expires_at is
  'До какого числа тема считается актуальной. null — срок не назначен; для меток «Набор», «Срочно» и «Обмен» его требует триггер forum_posts_expiry.';

/*
  Текст отказа в forum_posts_expiry называет метки словами «Набор» и «Срочно».
  Правим его тоже: человек, выбравший «Обмен» и не поставивший срок, должен
  читать про свою метку, а не про чужие.
*/
create or replace function public.forum_posts_expiry()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.tags is distinct from old.tags or new.expires_at is distinct from old.expires_at)
     and public.forum_expiry_required(new.tags)
     and new.expires_at is null then
    raise exception 'У темы с меткой «Набор», «Срочно» или «Обмен» должен быть срок действия — выберите, сколько дней она висит'
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

  return new;
end;
$$;

comment on function public.forum_posts_expiry() is
  'Срок действия темы: обязателен для «Набор», «Срочно» и «Обмен», от 1 до 90 дней вперёд.';

-- ── Шаг 5. Прав на новые колонки не заводим ─────────────────────────────────

/*
  Таблица forum_posts уже выдана в schema.sql целиком, а доступ к строкам и так
  решают политики темы: объявление читает кто угодно, правит автор и модерация.
  Отдельный grant появился бы здесь только ради того, чтобы перепутать права
  с правами строки.
*/
