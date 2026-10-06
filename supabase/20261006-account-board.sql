-- 2026-10-06. Доска аккаунтов: тема, в которой названо, что за аккаунт и почём.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Продажей и обменом аккаунтов форум до сих пор называл себя местом, где этого
-- нет (правило «Без рекламы и торговли»), — и всё равно ими пахло: объявления
-- уходили в чаты и в личку, где ни даты, ни автора, ни модерации не видно.
-- Запрет работал ровно в одном: он отнимал у человека право сказать это открыто,
-- где его услышат оба — и покупатель, и тот, кто отвечает за сервер.
--
-- Доска меняет не разрешение, а место. Объявление остаётся тем, чем оно и было
-- на форуме: темой с меткой, под которой можно спросить «почта привязана?»,
-- «а есть доступ к регистру?» и «ты точно владелец?». Ответы, жалобы, срок
-- действия, удаление с причиной и права модератора сервера — всё уже здесь,
-- потому что это обычная тема.
--
-- Доска не обещает сделку и не ведёт её: у нас нет ни платёжного шлюза, ни
-- денег сервера, ни способа заглянуть в чужой игровой аккаунт и проверить, что
-- там написано. Она держит объявление и его автора. Всё остальное происходит
-- мимо форума, и это честное ограничение, а не недоделка.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Объявление — тема, а не запись в отдельном ящике. Метка «Аккаунты»
--      превращает обычную тему в карточку доски, и вместе с меткой тема
--      получает всё, что уже умела: ответы, жалобы, закрепление модерацией,
--      срок действия. Отдельной таблицы здесь нет нарочно: объявление, у
--      которого нельзя спросить «а точно работает», — это витрина с почтой,
--      а обсуждение под ним и есть то, что отличает доску от витрины. Тот же
--      урок, что у бартер-доски (20260926-barter-board.sql, шаг 1).
--   2. Названы обе части: что в аккаунте и почём он. Одно «продаю аккаунт» без
--      состава и цены — это не объявление, а вопрос, который съедает вечер
--      обоим: «а что там?», «а сколько?», «а торг есть?».
--   3. Денег на сайте нет. Ни колонки для реквизитов, ни кнопки «купить», ни
--      комиссии: карточка называет цену словами («1500 ₽», «торг», «по
--      договорённости»), а передают их люди мимо форума. Сайт не принимает
--      платежи и не отвечает за то, что после перевода кто-то не отдал аккаунт,
--      — и потому не может ни удержать сумму, ни вернуть её.
--   4. Контакты — не колонка. Ник автора и так виден в теме, а поле под
--      телефон или дискорд стало бы приглашением светить личные данные прямо в
--      карточке, которую читают все подряд, — это противоречит правилу «Без
--      личных данных» и ломает его изнутри того же форума.
--   5. Объявление всегда с датой: срок действия обязателен, как у набора,
--      срочных тем и обмена. Истёкшее не прячется и не удаляется — тема
--      остаётся со своим обсуждением и получает знак «срок вышел» (тот же
--      порядок, что у 20260925-announcement-expiry.sql).
--   6. Сделку закрывает автор одной отметкой: «продано» или «снял с доски».
--      Тема не удаляется — под ней могли договориться и другие, и их ответы
--      исчезли бы вместе с объявлением.
--   7. Модерация снимает объявление как любую тему: удаление с причиной,
--      жалоба и тишина по разделу работают здесь без отдельных правил.
--   8. Аккаунт — не личность на сайте. Ник, репутация, достижения и закладки
--      привязаны к автору объявления, а не к продаваемому игровому аккаунту:
--      доска переносит игру, а не сайт. Продавец, который отдаёт аккаунт
--      вместе с доступом к почте, отдаёт и способ сбросить пароль — об этом
--      правило говорит в тексте объявления, а не в колонке.
--
-- ── ГДЕ ДВЕРЬ ───────────────────────────────────────────────────────────────
--
--   Дверей нет. Объявление создаётся и правится как тема: политика
--   forum_posts_insert уже требует author_id = auth.uid() и право писать, а
--   forum_posts_update_own пускает к строке только автора (плюс модерацию через
--   forum_posts_moderate). Отметку закрытия ставит тот же автор.
--
--   Частоту постов держит forum_posts_hold (выдержка: три темы за двадцать
--   минут). Отдельного лимита на объявления нет намеренно: аккаунт — тема, и
--   второй счётчик на то же действие означал бы, что человек упирается в два
--   разных отказа, не понимая, какой из них про объявления.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
--   Границы держит проверка таблицы: описание аккаунта — от 20 до 400
--   символов, цена — от 2 до 80. Те же числа стоят в CONFIG.forum.limits
--   (accountOfferMin, accountOfferMax, accountPriceMin, accountPriceMax), чтобы
--   форма отказывала тем же словом, что и база; совпадение сторожит тест.
--   Нижняя граница описания не для красоты: «аккаунт норм» из пяти слов не
--   описание, а заголовок описания, и покупатель всё равно спросит то же самое
--   в комментариях — ровно поэтому бартерное «отдам патроны» начинается с трёх
--   символов, а этот текст с двадцати.
--   Срок действия — общие числа объявления (expiryDaysMin, expiryDaysMax,
--   expiryChoices), отдельного аккаунтного срока нет.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20261005-player-server.sql.
--
-- ДВА места, где файл требует внимания:
--
--   * шаг 3 пересоздаёт представление forum_post_list — колонки представления
--     фиксируются в момент его создания, и старое select p.* уже никогда не
--     увидит новые столбцы темы (тот же урок, что у двух предыдущих файлов);
--   * шаг 4 переписывает forum_expiry_required и текст отказа
--     forum_posts_expiry: без них метка «Аккаунты» не требовала бы срока, и
--     доска копила бы просроченное.
--
-- Без этой миграции сайт не падает: обычная лента читается как раньше,
-- колонок у темы просто нет, метку форма не предложит (она живёт в коде),
-- а черновик работает без базы всегда.
--
-- ── Шаг 1. Две строки и отметка закрытия у темы ─────────────────────────────

/*
  Три колонки, все допускают пусто: обычная тема ни во что не превращается, а
  метка «Аккаунты» обязывает заполнить две из них — это держит триггер ниже, а не
  проверка таблицы. Проверка не выразила бы правило «если метка, то строки»:
  она про два столбца сразу.

  Верхняя граница описания — четыреста: карточка доски не рассказ, и после
  четырёхсот символов человек начинает описывать не аккаунт, а историю своей в
  нём игры, которую никто в списке не читает.
*/
alter table public.forum_posts add column if not exists
  account_offer text check (account_offer is null or char_length(account_offer) between 20 and 400);
alter table public.forum_posts add column if not exists
  account_price text check (account_price is null or char_length(account_price) between 2 and 80);
alter table public.forum_posts add column if not exists account_sold_at timestamptz;

comment on column public.forum_posts.account_offer is
  'Что в аккаунте: уровень, ресурсы, альянс, что внутри. Обязательно, если среди тегов есть «accounts», и снимается вместе с меткой (20261006-account-board.sql).';
comment on column public.forum_posts.account_price is
  'Почём, словами: сумма, «торг» или «по договорённости». Деньги через сайт не идут — колонка под реквизиты здесь нарочно не заводилась.';
comment on column public.forum_posts.account_sold_at is
  'Момент, когда автор снял объявление с доски: продал или передумал. null — объявление открыто.';

-- Метка живёт в том же списке, что и остальные: cardinality остаётся три.
alter table public.forum_posts drop constraint if exists forum_posts_tags_check;
alter table public.forum_posts add constraint forum_posts_tags_check check (
  cardinality(tags) <= 3 and tags <@ array['vs','recruiting','diplomacy','guide','question','event','sos','barter','accounts']::text[]
);

/*
  Доска смотрит на «объявления сверху — свежие». Частичный указатель берёт
  только темы с меткой: на форуме, где объявлений несколько десятков, а тем
  тысячи, полный индекс был бы платой за то, что никто не просит.
*/
create index if not exists forum_posts_accounts_idx
  on public.forum_posts (created_at desc)
  where 'accounts' = any (tags) and not deleted;

-- ── Шаг 2. Правила метки ────────────────────────────────────────────────────

create or replace function public.forum_posts_accounts()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Запрос из SQL-редактора не ограничиваем: там нет вошедшего человека,
  -- а у владельца проекта и так полный доступ. Тот же порядок, что у
  -- forum_posts_expiry, forum_posts_event_at и forum_posts_barter.
  if auth.uid() is null then
    return new;
  end if;

  /*
    Метку сняли — строки и отметка уходят сами. Иначе тема, которая «уже не
    продажа», висела бы в карточке доски с ценой, а автор при этом считал бы,
    что убрал объявление.
  */
  if not ('accounts' = any(new.tags)) then
    new.account_offer := null;
    new.account_price := null;
    new.account_sold_at := null;
    return new;
  end if;

  /*
    Требование обеих частей смотрим ТОЛЬКО когда человек трогает метки или сами
    строки. Иначе старая тема с меткой, заведённая до этого правила, отказывала
    бы на любом запросе: модератор жмёт «закрепить» — и получает «назовите, что
    в аккаунте». Это ровно тот урок, который записан в forum_posts_expiry,
    forum_posts_event_at и forum_posts_barter.
  */
  if (new.tags is distinct from old.tags
      or new.account_offer is distinct from old.account_offer
      or new.account_price is distinct from old.account_price)
     and (new.account_offer is null or new.account_price is null) then
    raise exception 'У темы с меткой «Аккаунты» должны быть названы обе части: что в аккаунте и почём он'
      using errcode = 'check_violation';
  end if;

  /*
    Закрыть объявление задним числом нельзя: отметка — это «я снял сегодня», а
    не способ переписать историю сделки. Будущее время тоже правим на «сейчас»:
    часы браузера и базы различаются, и объявление, закрытое «завтра», висело бы
    открытым ровно тот день, которого никто не ждал.
  */
  if new.account_sold_at is not null
     and new.account_sold_at is distinct from old.account_sold_at then
    if new.account_sold_at > now() then
      new.account_sold_at := now();
    end if;
    if new.account_sold_at < new.created_at then
      raise exception 'Нельзя снять объявление раньше, чем оно появилось'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.forum_posts_accounts() is
  'Метка «Аккаунты»: требует описание и цену, снимает их вместе с меткой, следит за отметкой закрытия. Денег и контактов у объявления нет нарочно.';

drop trigger if exists forum_posts_accounts on public.forum_posts;
create trigger forum_posts_accounts
  before insert or update on public.forum_posts
  for each row execute function public.forum_posts_accounts();

-- ── Шаг 3. Лента должна видеть новые колонки ────────────────────────────────

/*
  Копия определения из 20261005-player-server.sql, дословно и в том же порядке
  колонок (включая author_server), — пересоздаётся оно здесь только затем,
  чтобы select p.* заново развернулся и забрал три новых столбца темы.
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
  exists(select 1 from public.forum_thanks t where t.target_type='post' and t.target_id=p.id and t.giver_id=auth.uid()) i_thanked,
  prof.server_id as author_server
from public.forum_posts p left join public.forum_profiles prof on prof.id=p.author_id;
grant select on public.forum_post_list to anon, authenticated;

-- ── Шаг 4. Объявлению нужен срок ────────────────────────────────────────────

/*
  Список меток, которым назначен срок действия, живёт в одной функции:
  перечислять его второй раз в триггере — значит однажды разойтись. Здесь к
  «Набору», «Срочным» и «Обмену» добавляются «Аккаунты»: предложение, у которого
  нет даты, на доске превращается в мусор, который никто не решается снять, — а
  просроченное объявление о продаже аккаунта вреднее просроченного патрона,
  потому что по нему люди передают друг другу доступы.
*/
create or replace function public.forum_expiry_required(p_tags text[])
returns boolean
language sql immutable
as $$
  select coalesce(p_tags, '{}') && array['recruiting','sos','barter','accounts']::text[];
$$;

comment on function public.forum_expiry_required(text[]) is
  'Возвращает true для меток, чья тема обязана иметь срок действия: «Набор», «Срочно», «Обмен» и «Аккаунты».';

-- Вызывается только триггером forum_posts_expiry, наружу её просить некому.
revoke all on function public.forum_expiry_required(text[]) from public, anon;

-- Подпись колонки называла три метки из четырёх.
comment on column public.forum_posts.expires_at is
  'До какого числа тема считается актуальной. null — срок не назначен; для меток «Набор», «Срочно», «Обмен» и «Аккаунты» его требует триггер forum_posts_expiry.';

/*
  Текст отказа в forum_posts_expiry называл метки словами «Набор» и «Срочно»
  (третью добавил бартерный файл). Правим его тоже: человек, выбравший
  «Аккаунты» и не поставивший срок, должен читать про свою метку.
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
    raise exception 'У темы с меткой «Набор», «Срочно», «Обмен» или «Аккаунты» должен быть срок действия — выберите, сколько дней она висит'
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
  'Срок действия темы: обязателен для «Набор», «Срочно», «Обмен» и «Аккаунты», от 1 до 90 дней вперёд.';

-- ── Шаг 5. Прав на новые колонки не заводим ─────────────────────────────────

/*
  Таблица forum_posts уже выдана в schema.sql целиком, а доступ к строкам и так
  решают политики темы: объявление читает кто угодно, правит автор и модерация.
  Отдельный grant появился бы здесь только ради того, чтобы перепутать права
  с правами строки.
*/

-- Кэш схемы API не должен держать старое представление: без этого шага
-- PostgREST продолжал бы отвечать колонками, которых у представления больше нет.
notify pgrst, 'reload schema';
