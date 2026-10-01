-- 2026-09-26. Благодарность автору, репутация и награда от владельца.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- перенесена на наш SQL: там это «Community thanks», реестр репутации и ручная
-- корректировка владельцем.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Реакция отвечает на вопрос «согласен ли я с текстом». Благодарность отвечает
-- на другой: «помог ли мне этот текст». Разница не в вежливости, а в устройстве:
-- согласие снимаются и перевешиваются, благодарность — нет. Человек, который
-- два года пользовался разбором и вернулся сказать спасибо, не «передумал»,
-- если поставил на ту же тему лайк.
--
-- До сих пор сказать «спасибо» можно было только лайком, то есть тем же
-- движением, что и «не согласен, но терпимо». Хороший ответ и дежурное
-- «ок» выглядели в ленте одинаково.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Благодарят чужую запись — тему или ответ. Свою нельзя: это не признание
--      помощи, а реклама себя, и таких строк набралось бы больше, чем полезных.
--   2. Одна благодарность на запись от одного человека. Повтор не увеличивает
--      счётчик и не обновляет дату.
--   3. Благодарность НЕ отзывается. Отзыв означал бы, что это мнение о человеке,
--      а мнение снимается; здесь же запись о том, что помощь была. Её не
--      пересматривают задним числом.
--   4. Наружу выходит только число. Ни лента, ни профиль не показывают, кто
--      именно поблагодарил: список «кто кого благодарил» — карта личных
--      связей, а не заслуга. Автору пишет уведомление — там имя есть, потому
--      что это его собственный входящий ящик.
--   5. Пять благодарностей за пять минут — предел. Он отсекает серию «по клику»
--      и не мешает тому, кто благодарит после долгого чтения: столько за
--      пять минут собирают редко, а накрутчики собирают именно так.
--   6. РЕПУТАЦИЯ — отдельное число, и благодарность очки ей НЕ приносит.
--      Это главное заимствование, и оно спорное нарочно: очками платят только
--      за то, что подтвердил кто-то со стороны, — проверенный разбор из
--      20260925-guide-review.sql и награда владельца. Иначе репутация
--      превращается в счётчик кликов, а клики достаются самому шумному.
--   7. Награду выдаёт только владелец. Модератор снимает запреты и разбирает
--      жалобы; оценка людей оставлена одному человеку нарочно — иначе награда
--      становится ещё одним рычалом давления в спорной паре.
--   8. Начисление неизменяемо: ни правки, ни удаления. Ошибочная награда
--      исправляется обратной записью с пояснением, и в истории остаются обе —
--      так «мы ошиблись» видно, а не прячется.
--
-- ── ГДЕ ДВЕРЬ ───────────────────────────────────────────────────────────────
--
--   forum_give_thank(text, uuid)   — благодарность игрока.
--   forum_grant_reputation(uuid, integer, text) — награда владельца.
--   forum_reputation_grant_list()  — история начислений: своя или вся модерацией.
--
--   forum_thanks_count(text, uuid) — число благодарностей у конкретной записи;
--   вызывается из представлений, наружу отдаёт только число.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
--   5 благодарностей за 5 минут, дельта награды от −100 до +100, пояснение
--   8–500 символов. Эти числа продублированы в config.js (thanksPerWindow,
--   thanksWindowMinutes, repGrantMax, repReasonMin, repReasonMax) — совпадение
--   сторожит тест; числа решает база, а не браузер.
--   25 очков за проверенный разбор в базе не вычитаются: представление отдаёт
--   ЧИСЛО проверенных разборов, а сколько они стоят — правило страницы
--   (REP_POINTS в src/forum/rank.js). Цена заслуги меняется вместе с надписями,
--   и держать её рядом с надписями честнее, чем в двух несвязанных местах.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Выполняется после 20260925-event-rsvp.sql,
-- так как пересоздаёт то же представление ленты в его же определении.
--
-- Без этой миграции сайт не падает: лента читается старым представлением,
-- где колонок благодарности нет, а адаптер оставляет поле пустым. Исчезает
-- сама возможность сказать спасибо — кнопка при нажатии получает отказ базы
-- и назовет имя этого файла.

-- ── Шаг 1. Благодарности ────────────────────────────────────────────────────

/*
  Ключ — пара «человек и запись», и это устройство таблицы, а не проверка
  в коде: вторая благодарность физически не влезает.

  Автор записи записан КОПИЕЙ, а не берётся по ссылке при чтении. Ник и
  принадлежность записи меняются (пост правят, автора удаляют), а факт
  «поблагодарили вот этого человека за вот это» должен остаться тем, чем
  он был в момент нажатия.
*/
create table if not exists public.forum_thanks (
  target_type text not null check (target_type in ('post', 'comment')),
  target_id   uuid not null,
  giver_id    uuid not null references public.forum_users (id) on delete cascade,
  author_id   uuid not null references public.forum_users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (target_type, target_id, giver_id)
);

-- «Сколько благодарностей собрал человек» — главный запрос профиля.
create index if not exists forum_thanks_author_idx
  on public.forum_thanks (author_id, created_at);

-- «Кого и за что благодарили» — служит представлению и пределу частоты.
create index if not exists forum_thanks_target_idx
  on public.forum_thanks (target_type, target_id);

/*
  Предел частоты ищет строки одного человека за последние минуты. Без этого
  индекса каждая благодарность читала бы таблицу целиком, а таблица растёт
  быстрее постов.
*/
create index if not exists forum_thanks_giver_recent_idx
  on public.forum_thanks (giver_id, created_at desc);

alter table public.forum_thanks enable row level security;

/*
  Свою строку человек видит — из неё лента узнаёт, что он уже благодарил,
  и кнопка выглядит нажатой. Чужие строки не видит никто, включая модерацию:
  право читать «кто кого поблагодарил» не нужно ни одной задаче панели,
  а отдаёт оно то самое, что правило 4 обещает не показывать.
*/
drop policy if exists forum_thanks_own on public.forum_thanks;
create policy forum_thanks_own on public.forum_thanks
  for select using (giver_id = auth.uid());

/*
  Политик на запись нет вовсе.

  Это не забывчивость, а способ не соврать в отказе. Политика отвергает строку
  текстом «violates row-level security policy» — человек увидел бы служебное
  сообщение вместо причины. Все решения (свой пост, удалённая запись, повтор,
  частота) принимает forum_give_thank: она видит и автора, и соседей по таблице,
  и отвечает словами.
*/

-- ── Шаг 2. Число благодарностей ─────────────────────────────────────────────

/*
  Счётчик работает правами владельца, поэтому его можно спросить даже тогда,
  когда своих строк не видно: представлению ленты нужны только цифры.
*/
create or replace function public.forum_thanks_count(p_target_type text, p_target_id uuid)
returns integer
language sql security definer set search_path = public
as $$
  select coalesce((
    select count(*)
      from public.forum_thanks
     where target_type = p_target_type and target_id = p_target_id
  ), 0);
$$;

revoke all on function public.forum_thanks_count(text, uuid) from public, anon;
grant execute on function public.forum_thanks_count(text, uuid) to anon, authenticated;

comment on function public.forum_thanks_count(text, uuid) is
  'Сколько человек поблагодарили автора записи; только число, без имён.';

-- ── Шаг 3. Дверь игрока ─────────────────────────────────────────────────────

create or replace function public.forum_give_thank(p_target_type text, p_target_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_author    uuid;
  v_post      uuid;
  v_snippet   text;
  v_gone      boolean;
  v_topic_gone boolean;
  v_recent    integer;
  v_nick      text;
begin
  if auth.uid() is null then
    raise exception 'Благодарность пишет вошедший игрок';
  end if;

  if p_target_type is null or p_target_type not in ('post', 'comment') then
    raise exception 'Благодарят за тему или за ответ';
  end if;

  if p_target_type = 'post' then
    select author_id, id, left(title, 120), deleted
      into v_author, v_post, v_snippet, v_gone
      from public.forum_posts where id = p_target_id;

    if not found then
      raise exception 'Записи уже нет: страница устарела';
    end if;
    if v_gone then
      raise exception 'Эту запись удалили — благодарить не за что';
    end if;
  else
    select c.author_id, c.post_id, left(c.body, 120), c.deleted, p.deleted
      into v_author, v_post, v_snippet, v_gone, v_topic_gone
      from public.forum_comments c
      join public.forum_posts p on p.id = c.post_id
     where c.id = p_target_id;

    if not found then
      raise exception 'Записи уже нет: страница устарела';
    end if;
    /*
      Ответ под удалённой темой считается недоступным так же: благодарность
      висит на конкретной строке, а показывать её после удаления темы негде.
    */
    if v_gone or v_topic_gone then
      raise exception 'Эту запись удалили — благодарить не за что';
    end if;
  end if;

  if v_author = auth.uid() then
    raise exception 'Свой текст не благодарят';
  end if;

  if exists (select 1 from public.forum_thanks
              where target_type = p_target_type and target_id = p_target_id
                and giver_id = auth.uid()) then
    raise exception 'Вы уже благодарили автора этой записи';
  end if;

  /*
    Предел частоты считается по ЧАСАМ БАЗЫ, а не по часам браузера: локальное
    время человек может поставить любое, и лимит перестал бы быть лимитом.
  */
  select count(*) into v_recent
    from public.forum_thanks
   where giver_id = auth.uid()
     and created_at > now() - interval '5 minutes';

  if v_recent >= 5 then
    raise exception 'Не больше 5 благодарностей за 5 минут — спасибо говорят за дело, а не подряд';
  end if;

  insert into public.forum_thanks (target_type, target_id, giver_id, author_id)
  values (p_target_type, p_target_id, auth.uid(), v_author);

  /*
    Уведомление автору. Имя благодарившего здесь есть нарочно: это его личный
    входящий ящик, а не публичный список. Правило 4 запрещает показывать связи
    всем остальным.

    Себя не уведомляем — проверка выше уже не пускает, но порядок тот же,
    что у триггера forum_notify_reaction.
  */
  select nick into v_nick from public.forum_users where id = auth.uid();

  insert into public.forum_notifications
    (user_id, actor_id, actor_nick, kind, post_id, comment_id, preview)
  values (
    v_author, auth.uid(), coalesce(v_nick, ''), 'thanks', v_post,
    case when p_target_type = 'comment' then p_target_id else null end,
    v_snippet
  );
end;
$$;

revoke all on function public.forum_give_thank(text, uuid) from public, anon;
grant execute on function public.forum_give_thank(text, uuid) to authenticated;

comment on function public.forum_give_thank(text, uuid) is
  'Благодарность автору темы или ответа: один раз, навсегда, без права отозвать.';

-- ── Шаг 4. Награда от владельца ─────────────────────────────────────────────

/*
  Журнал начислений. Строку нельзя ни исправить, ни удалить — в этом весь
  смысл: репутация, которую можно тихо поправить, не значит ничего.

  Пояснение обязательно и не короче восьми символов. «За хорошее» — не причина,
  а пустая строка с другим лицом; короткая запись превращает награду в знак
  внимания, который невозможно объяснить никому, кто читает историю позже.

  Текст самой записи сюда не копируется: награда висит на человеке, а разбор
  нарушений живёт в форуме.
*/
create table if not exists public.forum_rep_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.forum_users (id) on delete cascade,
  delta       integer not null check (delta <> 0 and abs(delta) <= 100),
  reason      text not null check (char_length(reason) between 8 and 500),
  granted_by  uuid references public.forum_users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists forum_rep_grants_user_idx
  on public.forum_rep_grants (user_id, created_at desc);

alter table public.forum_rep_grants enable row level security;

/*
  Свою историю человек читает сам, модерация — всю.

  Профиль открыт любому гостю, поэтому список «кому и за что начисляли» в
  представлении не появится: наружу выходит только итоговое число. Здесь же
  право видеть причины есть у тех, кто отвечает за решения.
*/
drop policy if exists forum_rep_grants_read on public.forum_rep_grants;
create policy forum_rep_grants_read on public.forum_rep_grants
  for select using (user_id = auth.uid() or public.forum_is_staff());

-- Политик на запись нет: пишет только forum_grant_reputation (шаг 5).

-- ── Шаг 5. Дверь владельца ──────────────────────────────────────────────────

create or replace function public.forum_grant_reputation(
  p_user uuid, p_delta integer, p_reason text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_note text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null then
    raise exception 'Награду выдаёт вошедший владелец';
  end if;

  /*
    Владельцем проверка названа прямо, хотя forum_is_staff() тоже пускала бы
    модератора: право оценивать людей оставлено одному человеку (правило 7).
  */
  if not public.forum_is_admin() then
    raise exception 'Репутацию меняет только владелец';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Ноль ничего не меняет — нужна дельта от −100 до 100';
  end if;

  if abs(p_delta) > 100 then
    raise exception 'Дельта награды умещается в сто очков';
  end if;

  if char_length(v_note) < 8 then
    raise exception 'Пояснение короче 8 символов — награду нужно описать словами';
  end if;

  if char_length(v_note) > 500 then
    raise exception 'Пояснение длиннее 500 символов';
  end if;

  if not exists (select 1 from public.forum_users where id = p_user) then
    raise exception 'Такого игрока нет: страница устарела';
  end if;

  -- Владелец не награждает себя: награда, которую выдают самому себе, — это
  -- способ сделать вид, что её кто-то назначил.
  if p_user = auth.uid() then
    raise exception 'Себе награду не выдают';
  end if;

  insert into public.forum_rep_grants (user_id, delta, reason, granted_by)
  values (p_user, p_delta, v_note, auth.uid());
end;
$$;

revoke all on function public.forum_grant_reputation(uuid, integer, text) from public, anon;
grant execute on function public.forum_grant_reputation(uuid, integer, text) to authenticated;

comment on function public.forum_grant_reputation(uuid, integer, text) is
  'Награда владельца: неизменяемое начисление очков репутации с обязательным пояснением.';

-- ── Шаг 6. История начислений ───────────────────────────────────────────────

/*
  Функция, а не представление: наружу идут nick того, кто начислил, и причины,
  а их читают только свой человек и модерация. Представление под безопасностью
  вызывающего фильтровало бы то же самое политикой, но тогда лента не увидела бы
  сумму — ей нужен отдельный счётчик в forum_profiles (шаг 7), а не эти строки.
*/
create or replace function public.forum_reputation_grant_list(p_user uuid default null)
returns table (
  id uuid,
  user_id uuid,
  nick text,
  delta integer,
  reason text,
  granted_by_nick text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Историю читает вошедший игрок';
  end if;

  if p_user is not null and p_user <> auth.uid() and not public.forum_is_staff() then
    raise exception 'Чужая история начислений закрыта';
  end if;

  if not public.forum_is_staff() and p_user is null then
    raise exception 'Без указания игрока историю читает только модерация';
  end if;

  return query
    select g.id, g.user_id, u.nick, g.delta, g.reason,
           coalesce(b.nick, 'владелец ушёл'), g.created_at
      from public.forum_rep_grants g
      join public.forum_users u on u.id = g.user_id
      left join public.forum_users b on b.id = g.granted_by
     where (p_user is null or g.user_id = p_user)
       and (public.forum_is_staff() or g.user_id = auth.uid())
     order by g.created_at desc, g.id desc
     limit 100;
end;
$$;

revoke all on function public.forum_reputation_grant_list(uuid) from public, anon;
grant execute on function public.forum_reputation_grant_list(uuid) to authenticated;

comment on function public.forum_reputation_grant_list(uuid) is
  'Начисления репутации: свои — игроку, все — модерации; пустой аргумент — «всё, что видно».';

-- ── Шаг 7. Профиль: откуда берётся репутация ────────────────────────────────

/*
  Три новых колонки — В КОНЦЕ списка: create or replace сверяет представления
  по позициям, а на forum_profiles смотрят лента и комментарии.

  Все три считаются по строкам, ни одна не хранится числом: хранимый счётчик
  разошёлся бы с правдой при первом же удалении записи и сделал бы это молча
  (тот же порядок, что у likes_received выше).

  Репутацию собирают эти две колонки: число проверенных разборов и сумма
  наград владельца. Сколько стоит проверенный разбор — решает страница
  (REP_POINTS в src/forum/rank.js), а не база: цена заслуги меняется вместе
  с надписями рядом с ней.
  Благодарностей в этом числе нет сознательно (правило 6). Проверку «разбор
  проверен» ставит модерация и только она — триггер из
  20260925-guide-review.sql не даёт автору объявить собственный текст
  проверенным, так что очко здесь действительно чужое, а не выданное себе.
*/
create or replace view public.forum_profiles
with (security_invoker = off) as
select
  u.id,
  u.nick,
  u.avatar_url,
  u.about,
  u.alliance_tag,
  u.role,
  u.is_blogger,
  u.created_at,
  (select count(*) from public.forum_posts p
     where p.author_id = u.id and p.deleted = false) as post_count,
  (select count(*) from public.forum_comments c
     where c.author_id = u.id and c.deleted = false) as comment_count,
  coalesce((
    select count(*)
      from public.forum_reactions r
      join public.forum_posts p on p.id = r.target_id
     where r.target_type = 'post' and p.author_id = u.id and r.reaction = 'like'
  ), 0) as likes_received,
  coalesce((
    select sum(p.views)
      from public.forum_posts p
     where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_views,
  coalesce((
    select count(*)
      from public.forum_posts p
     where p.author_id = u.id and p.category = 'blog' and p.deleted = false
  ), 0) as blog_post_count,
  u.is_leader,
  u.last_seen_at,
  coalesce((
    select count(*) from public.forum_profile_likes fl
    where fl.to_user = u.id
  ), 0) as profile_likes,
  coalesce((
    select 1 from public.forum_profile_likes fl
    where fl.to_user = u.id and fl.from_user = auth.uid() limit 1
  ), 0) as i_liked,
  u.is_verified,
  u.verified_at,
  coalesce((
    select count(*)
      from public.forum_posts p
      join public.forum_thanks t
        on t.target_type = 'post' and t.target_id = p.id
     where p.author_id = u.id
  ), 0)
  +
  coalesce((
    select count(*)
      from public.forum_comments c
      join public.forum_thanks t
        on t.target_type = 'comment' and t.target_id = c.id
     where c.author_id = u.id
  ), 0) as thanks_received,
  coalesce((
    select count(*) from public.forum_guides g
     where g.author_id = u.id and g.status = 'published'
       and g.review_status = 'verified'
  ), 0) as verified_guides,
  /*
    Встреча засчитывается организатору, только если она состоялась и на неё
    пришёл хоть один человек. Отвечать за анонс, который никто не поддержал,
    незачем: иначе календарь научился бы приносить значки сам себе.
  */
  coalesce((
    select count(*)
      from public.forum_posts p
     where p.author_id = u.id and not p.deleted
       and 'event' = any(p.tags) and p.event_at is not null and p.event_at <= now()
       and exists (select 1 from public.forum_event_rsvps r
                    where r.post_id = p.id and r.status = 'going'
                      and r.user_id <> p.author_id)
  ), 0) as events_held,
  coalesce((
    select sum(g.delta) from public.forum_rep_grants g where g.user_id = u.id
  ), 0) as rep_grants,
  coalesce((
    select count(*) from public.forum_rep_grants g where g.user_id = u.id
  ), 0) as rep_grant_count
from public.forum_users u;

grant select on public.forum_profiles to anon, authenticated;

-- ── Шаг 8. Лента и комментарии: число и своё состояние ─────────────────────

/*
  Копия определения forum_post_list из 20260925-event-rsvp.sql, дословно и
  в том же порядке колонок, — пересоздаётся оно здесь только затем, чтобы
  добавить две колонки в конец.

  thanks_count берётся из definer-функции: сама таблица закрыта политикой,
  а число видно всем — тот же порядок, что у forum_event_going рядом.
  i_thanked читается напрямую: политика пускает человека к его собственным
  строкам, и большего ленте не нужно.
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

drop view if exists public.forum_comment_list;
create view public.forum_comment_list with (security_invoker = on) as
select c.*, prof.avatar_url as author_avatar, prof.alliance_tag as author_alliance,
  prof.role as author_role, prof.is_blogger as author_is_blogger, prof.is_verified as author_is_verified,
  coalesce((select jsonb_object_agg(reaction,n) from (select reaction,count(*) n from public.forum_reactions where target_type='comment' and target_id=c.id group by reaction) r),'{}'::jsonb) reactions,
  (select reaction from public.forum_reactions where target_type='comment' and target_id=c.id and user_id=auth.uid()) my_reaction,
  public.forum_thanks_count('comment', c.id) as thanks_count,
  exists(select 1 from public.forum_thanks t where t.target_type='comment' and t.target_id=c.id and t.giver_id=auth.uid()) i_thanked
from public.forum_comments c left join public.forum_profiles prof on prof.id=c.author_id;
grant select on public.forum_comment_list to anon, authenticated;

-- ── Шаг 9. Вид уведомления ──────────────────────────────────────────────────

alter table public.forum_notifications drop constraint if exists forum_notifications_kind_check;
alter table public.forum_notifications add constraint forum_notifications_kind_check check
  (kind in ('mention','reply','reaction','subscription','alliance_rank','moderation','digest','event','thanks'));

-- ── Шаг 10. Прав на новые колонки не заводим ────────────────────────────────

/*
  forum_profiles и оба представления уже выданы выше; форумный REST ходит в них
  под ролью authenticated, и новых колонок это не касается. Таблицы форума
  выданы целиком в schema.sql, поэтому grant на forum_thanks и forum_rep_grants
  здесь появился бы только ради того, чтобы перепутать права.
*/
grant select on public.forum_thanks to anon, authenticated;
grant select on public.forum_rep_grants to authenticated;
