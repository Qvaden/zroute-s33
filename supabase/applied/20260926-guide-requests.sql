-- 2026-09-26. Заявки на гайды: игрок называет тему, модерация решает ею.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub),
-- перенесена на наш SQL: там заявка — отдельная таблица, и у нас так же.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Раздел гайдов отвечает на вопрос «как играть», но отвечает на те вопросы,
-- которые уже кому-то пришло в голову задать. Новичок, который не знает, что
-- именно ему надо спросить, не напишет «сделайте гайд по сбору» — он просто
-- упрётся в стену и уйдёт. При этом автор гайда — такой же игрок: он пишет то,
-- что интересно ему, и не видит чужого пробела, потому что сам в него не
-- попадал.
--
-- Заявка связывает этих двоих: один называет тему, модератор либо говорит
-- «такое уже есть, вот ссылка», либо закрывает с объяснением. Отдельной
-- доски «хочу гайд», где темы висят годами без решения, здесь не будет: у
-- нас нет штата, который разгребает очередь ради очереди.
--
-- ── ПОЧЕМУ ТАБЛИЦА, А НЕ МЕТКА ТЕМЫ ─────────────────────────────────────────
--
-- Календарь и обмен мы сделали метками темы, и это сработало: и встреча, и
-- объявление — по форме обычный пост, у них есть автор, текст и комментарии,
-- где договариваются. Заявка на гайд — не пост. У неё нет смысла в
-- комментариях (обсуждать нечего, есть только «есть такое» или «нет»), у неё
-- есть исход, которого у темы нет, и у неё есть право видеть только своё,
-- чего у темы быть не может: темы открыты всем.
--
-- Гайды у нас уже живут отдельной таблицей, а не разделом форума, поэтому
-- заявка пристёгнута к ним же: `guide_id` ссылается на `forum_guides`, и
-- связать заявку можно только с опубликованным гайдом.
--
-- ── ЧЕГО ЗДЕСЬ НЕТ НАМЕРЕННО ────────────────────────────────────────────────
--
--   Голосов и «поддерживаю». Донорский форум сознательно обошёлся без них, и
--   у нас та же причина: счётчик голосов показывает не потребность, а
--   активность одного кружка, и автор пишет то, что набрало голосов, а не то,
--   что полезно. Нужен сигнал «это волнует многих» — пусть напишет своей
--   заявкой; дедуп держит только повторы от одного человека.
--
--   Статуса «взято в работу». Его должен ставить автор, а автор у нас никто:
--   заявки читают все, пишет любой. Статус без хозяина превращается в висящее
--   обещание.
--
--   Награды за написанный по заявке гайд. Репутация у нас выдаётся владельцем
--   за свершённое, а не за запрос.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Заявку создаёт вошедший игрок, у которого есть право писать. Тишина на
--      форуме отменяет и заявки: просить — это тоже слово.
--   2. Название — от 4 и не больше 140 символов, описание — до 1200. Верхняя
--      граница описания важнее нижней: заявка на полстраницы не читается.
--   3. Не больше трёх заявок за сутки (по часам базы). Заявки читают люди, и
--      четвёртая за день — это давление, а не просьба.
--   4. У одного человека не может быть двух открытых заявок с одним и тем же
--      названием. Повтор от того же автора — то же самое, что и первая заявка,
--      только в очереди он выглядит как спросивший не дождавшийся.
--   5. Своё название не совпадает с чужим: дедуп держит повторы внутри автора,
--      а не запрещает тему целиком. Двум людям одна тема нужна по-разному.
--   6. Открытую заявку может отозвать только её автор. Отзванная остаётся в
--      истории — иначе «отозвал» стало бы способом стереть факт просьбы.
--   7. Разбирает заявку модерация, и обязана оставить текст от 5 символов.
--      Молчаливое «закрыто» неотличимо от «до тебя не дошли».
--   8. «Связана с гайдом» требует опубликованный гайд: обещание, которое
--      нельзя прочитать, — то же самое, что отказ без объяснения.
--   9. Открытые заявки видят все (в том числе невошедший): список того, чего
--      не хватает, — это публичная карта пробелов. Разобранные видит только
--      автор и модерация, потому что исход чужой просьбы никого не касается.
--  10. Об исходе автор узнаёт из уведомления, а не из очереди панели.
--
-- ── ПОЧЕМУ ДВЕРИ — ФУНКЦИИ, А НЕ ПОЛИТИКИ ───────────────────────────────────
--
-- Правило «не больше трёх за сутки» и дедуп по названию не выразить
-- политикой: политика проверяет строку, а не соседние с ней. Кроме того,
-- отказ должен быть внятным («не больше трёх заявок за сутки»), а не текстом
-- нарушения ограничения, который человек не может ни понять, ни пересказать.
--
-- Отзыв и решение тоже функции: модерация меняет чужую строку, и это ровно
-- тот случай, когда дверь нужна (в закладках её не было — там каждая строка
-- своя). Нормализация названия вынесена в функцию и в индекс одинаковым
-- выражением, иначе проверка и ограничение разошлись бы при первом же
-- пробеле.
--
-- Автор строки подставляется в самой функции из токена, поэтому триггера
-- `forum_set_row_user()` здесь нет: он нужен там, где браузер пишет в таблицу
-- сам (закладки, подписки), а сюда браузер не пишет вовсе.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Те же значения лежат в CONFIG.forum.limits: guideRequestTitleMin (4),
-- guideRequestTitleMax (140), guideRequestDetailsMax (1200),
-- guideRequestDailyMax (3). Пояснение модерации держат общие
-- guideNoteMin/guideNoteMax (5 и 280) — тот же смысл, что и у подписи под
-- отметкой «устарел»: короткое объяснение от модерации. База сторожит границы
-- сама, а совпадение чисел с config.js и общность текстов отказа с черновым
-- адаптером сторожит тест.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Скрипт повторный: недостающее
-- создаёт, существующее правит. Ставится после 20260925-guide-review.sql
-- (ссылка ведёт на forum_guides) и не трогает существующих представлений, так
-- что застывания колонок здесь не было. Новых слов в проверке `kind`
-- уведомлений не появляется: исход ложится в уже существующий 'moderation',
-- тем же порядком, что и решение по апелляции.
--
-- До пуша кода миграция не обязательна: список заявок читается отдельным
-- запросом с прощением отказа, и без неё страница гайдов работает как раньше,
-- а блок заявок вместо пустоты называет имя этого файла.

-- ── Шаг 1. Заявки ───────────────────────────────────────────────────────────

create table if not exists public.forum_guide_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.forum_users (id) on delete cascade,

  /*
    Тема заявки целиком: по ней модератор решает, есть ли уже такой гайд, и по
    ней же человек потом узнаёт свою просьбу в списке. 140 символов — потому,
    что название попадает и в уведомление, где длиннее не читается.
  */
  title       text not null check (char_length(title) between 4 and 140),

  /*
    Факультативно: где именно человек встал и чего ему не хватило. Пустое
    значение разрешено намеренно — «хочу гайд по сбору» уже полезный сигнал, и
    требовать сочинение значило бы отсекать тех, кто не умеет писать.
  */
  details     text not null default '' check (char_length(details) <= 1200),

  /*
    open     — ждёт решения, видно всем;
    linked   — такой гайд уже есть, ссылка в guide_id;
    closed   — разобрано без ссылки (темы нет в планах, вопрос не про сервер);
    cancelled — автор отозвал свою заявку.

    «Отклонено» и «закрыто» — одно слово: исход для игрока одинаковый, и
    второй статус нужен был бы только ради самоутешения очереди.
  */
  status      text not null default 'open'
                check (status in ('open', 'linked', 'closed', 'cancelled')),

  /*
    Гайд, который закрывает вопрос. on delete set null: гайд мог уехать в
    архив или исчезнуть, а просьба человека не должна исчезать вместе с ним —
    она уже разобрана, и это факт.
  */
  guide_id    uuid references public.forum_guides (id) on delete set null,

  /*
    Ответ модерации. Пусто, пока заявка открыта или отозвана: отвечать ещё
    нечем. Диапазон держат и эта проверка, и функция решения — здесь он нужен,
    чтобы ответ не мог появиться мимо слов отказа.
  */
  answer      text not null default ''
                check (answer = '' or char_length(answer) between 5 and 280),

  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.forum_users (id) on delete set null
);

comment on table public.forum_guide_requests is
  'Заявки игроков на гайд: тему называет автор, разбирает модерация. Открытые видны всем, исход — автору и модерации.';

comment on column public.forum_guide_requests.answer is
  'Пояснение модерации, которое читает автор заявки: на какой гайд она похожа или почему закрыта.';

comment on column public.forum_guide_requests.decided_at is
  'Момент решения. У отозванной заявки это момент отзыва, а decided_by — сам автор: отозвать чужую заявку нельзя.';

/*
  Тот же приём, что у сигналов об устаревании и у закладок: выражение нормализации
  повторяется в индексе и в функции слово в слово. Индекс — не ускорение (таблица
  маленькая), а последний рубеж: два человека, нажавшие «отправить» одновременно,
  пройдут проверку функции вдвоём, и только уникальность в базе не даст появиться
  двум одинаковым открытым заявкам.
*/
create unique index if not exists forum_guide_requests_one_open
  on public.forum_guide_requests (
    user_id,
    lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))
  )
  where status = 'open';

-- Очередь на странице гайдов: сначала свежие ожидающие.
create index if not exists forum_guide_requests_queue_idx
  on public.forum_guide_requests (status, created_at desc);

alter table public.forum_guide_requests enable row level security;

/*
  Открытая заявка публична: это вопрос «чего не хватает на сервере», и он
  полезен всем, включая тех, кто гайд мог бы написать. Разобранная — нет: там
  лежит исход чужой просьбы, и публичный список «кому отказали» читается как
  список обиженных.
*/
drop policy if exists forum_guide_requests_read on public.forum_guide_requests;
create policy forum_guide_requests_read on public.forum_guide_requests
  for select using (status = 'open' or user_id = auth.uid() or public.forum_is_staff());

/*
  Политик записи нет вовсе: браузер не вставляет, не правит и не удаляет эти
  строки — всё три действия идут через функции ниже, где отказ называется
  словами. Разрешаем только чтение.
*/
grant select on public.forum_guide_requests to anon, authenticated;

-- ── Шаг 2. Дверь заявки ─────────────────────────────────────────────────────

create or replace function public.forum_open_guide_request(p_title text, p_details text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id      uuid;
  v_title   text;
  v_details text;
  v_count   int;
begin
  if auth.uid() is null then
    raise exception 'Заявку отправляет только вошедший игрок';
  end if;

  /*
    Право писать проверяется здесь, а не политикой: заявка — тоже слово, и
    игрок в тишине не должен получить возможность говорить ею в обход меры.
  */
  if not public.forum_can_write() then
    raise exception 'Ваш аккаунт сейчас не может писать';
  end if;

  v_title := btrim(coalesce(p_title, ''));

  if char_length(v_title) < 4 then
    raise exception 'Название темы короче 4 символов: по трём словам гайд не написать';
  end if;

  if char_length(v_title) > 140 then
    raise exception 'Название темы длиннее 140 символов: его не прочитает ни модератор, ни автор гайда';
  end if;

  v_details := btrim(coalesce(p_details, ''));

  if char_length(v_details) > 1200 then
    raise exception 'Описание длиннее 1200 символов: суть влезает и в меньшее';
  end if;

  /*
    Частота считается по часам базы, а не браузера: три заявки за сутки — это
    правило, а предложение, и зависеть от того, какие часы у человека в
    кармане, оно не может.
  */
  select count(*) into v_count
    from public.forum_guide_requests
   where user_id = auth.uid()
     and created_at > now() - interval '24 hours';

  if v_count >= 3 then
    raise exception 'Не больше 3 заявок за сутки: их читают люди';
  end if;

  /*
    Дедуп внутри автора, а не глобально: двум игрокам одна тема нужна по-
    разному, и «уже кто-то просил» — не ответ второму. Совпадение смотрим по
    нормализованному названию ровно среди открытых: закрытая заявка на ту же
    тему — это новый вопрос, а не повтор.
  */
  if exists (
    select 1 from public.forum_guide_requests
     where user_id = auth.uid()
       and status = 'open'
       and lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))
         = lower(regexp_replace(v_title, '\s+', ' ', 'g'))
  ) then
    raise exception 'У вас уже есть открытая заявка с таким названием';
  end if;

  insert into public.forum_guide_requests (user_id, title, details)
  values (auth.uid(), left(v_title, 140), left(v_details, 1200))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.forum_open_guide_request(text, text) from public, anon;
grant execute on function public.forum_open_guide_request(text, text) to authenticated;

comment on function public.forum_open_guide_request(text, text) is
  'Заявка на гайд: название и необязательное описание; держит право писать, лимит трёх в сутки и повтор названия у того же автора.';

-- ── Шаг 3. Дверь отзыва ────────────────────────────────────────────────────

/*
  Отзыв — единственное действие автора после отправки, и оно тоже дверь, а не
  политика: отказ должен различать «не твоя заявка» и «заявку уже разобрали»,
  потому что для человека это две разные причины, а политика на второй случай
  просто не пустила бы строку без объяснения.
*/
create or replace function public.forum_cancel_guide_request(p_target uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.forum_guide_requests%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Сначала войдите';
  end if;

  select * into v from public.forum_guide_requests where id = p_target;
  if not found then
    raise exception 'Заявка не найдена';
  end if;

  if v.user_id <> auth.uid() then
    raise exception 'Отозвать можно только свою заявку';
  end if;

  /*
    Условие status = 'open' внутри UPDATE — та же защита от гонки, что у
    апелляций: пока человек смотрел список, модератор мог ответить, и
    «отозвать» не имеет права стирать уже данное объяснение.
  */
  update public.forum_guide_requests
     set status = 'cancelled',
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_target and status = 'open';

  if not found then
    raise exception 'Отозвать можно только открытую заявку';
  end if;
end;
$$;

revoke all on function public.forum_cancel_guide_request(uuid) from public, anon;
grant execute on function public.forum_cancel_guide_request(uuid) to authenticated;

comment on function public.forum_cancel_guide_request(uuid) is
  'Отзыв своей открытой заявки; разобранную отозвать нельзя.';

-- ── Шаг 4. Дверь решения ───────────────────────────────────────────────────

/*
  Статусы 'linked' и 'closed' — два разных ответа, и функция не принимает
  между ними смешанного: 'linked' обязывает назвать опубликованный гайд,
  'closed' обязывает объясниться текстом. Снимать заявку с модерации нельзя
  (для этого есть отзыв у автора) — иначе очередь начала бы врать о том, что
  никто не решал.
*/
create or replace function public.forum_resolve_guide_request(
  p_target uuid,
  p_status text,
  p_answer text default '',
  p_guide  uuid default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v        public.forum_guide_requests%rowtype;
  v_staff  text;
  v_answer text;
  v_word   text;
begin
  if not public.forum_is_staff() then
    raise exception 'Заявку разбирает модерация';
  end if;

  if p_status not in ('linked', 'closed') then
    raise exception 'Неизвестное решение по заявке: %', p_status;
  end if;

  select * into v from public.forum_guide_requests where id = p_target;
  if not found then
    raise exception 'Заявка не найдена';
  end if;

  v_answer := btrim(coalesce(p_answer, ''));

  if char_length(v_answer) < 5 then
    raise exception 'Нужно хотя бы 5 символов: игрок ждёт объяснения, а не молчаливого отказа';
  end if;

  if char_length(v_answer) > 280 then
    raise exception 'Не больше 280 символов: объяснение должно читаться и с телефона';
  end if;

  v_answer := left(v_answer, 280);

  if p_status = 'linked' then
    if p_guide is null then
      raise exception 'Нужно указать гайд, которым закрывается заявка';
    end if;

    if not exists (select 1 from public.forum_guides
                    where id = p_guide and status = 'published') then
      raise exception 'Связать заявку можно только с опубликованным гайдом';
    end if;
  end if;

  update public.forum_guide_requests
     set status = p_status,
         answer = v_answer,
         guide_id = case when p_status = 'linked' then p_guide else null end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_target and status = 'open';

  if not found then
    raise exception 'Эта заявка уже разобрана: %',
      case v.status
        when 'linked' then 'связана с гайдом'
        when 'closed' then 'закрыта'
        else 'отозвана'
      end;
  end if;

  /*
    Молчать об исходе нельзя: игрок узнаёт о решении из уведомления, а не из
    панели, которую он мог ни разу не открыть. kind 'moderation' уже существует
    (им же приходит ответ на апелляцию), новых слов в проверку вида не нужно.
  */
  select nick into v_staff from public.forum_users where id = auth.uid();

  v_word := case when p_status = 'linked' then 'связана с гайдом' else 'закрыта' end;

  insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, preview)
  values (
    v.user_id,
    auth.uid(),
    coalesce(v_staff, 'Модерация'),
    'moderation',
    left('Заявка «' || v.title || '» ' || v_word || ': ' || v_answer, 120)
  );
end;
$$;

revoke all on function public.forum_resolve_guide_request(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.forum_resolve_guide_request(uuid, text, text, uuid)
  to authenticated;

comment on function public.forum_resolve_guide_request(uuid, text, text, uuid) is
  'Решение модерации по заявке: связать с опубликованным гайдом или закрыть; обязано объяснить и уведомляет автора.';

-- ── Шаг 5. Список с никами ──────────────────────────────────────────────────

/*
  Ника нет в таблице заявок (не дублируем то, что меняется), поэтому список
  выходит представлением — тем же порядком, что forum_appeal_list.
  security_invoker = on обязательно: иначе правило «разобранное видит только
  автор» выполнялось бы от имени владельца, и панель показывала бы чужие
  заявки всем.

  Названия связанного гайда здесь сознательно нет, хотя соблазн присоединить
  forum_guides очевиден. Во-первых, права на чтение этой таблицы выданы только
  вошедшим (chats.sql), а открытые заявки читает и гость: одно отсутствующее
  разрешение сломало бы весь список невошедшему, причём молча. Во-вторых,
  строка с guide_id видна только автору и модерации, то есть название в этом
  запросе нужно редкому читателю — а список гайдов и так уже лежит у клиента
  в состоянии, и карточка найдёт его по id на своей стороне. Архивный или
  удалённый гайд станет тогда «гайд недоступен», что честнее ссылки в никуда.
*/
create or replace view public.forum_guide_request_list
with (security_invoker = on) as
select
  r.id,
  r.user_id,
  u.nick       as user_nick,
  r.title,
  r.details,
  r.status,
  r.guide_id,
  r.answer,
  r.created_at,
  r.decided_at,
  d.nick       as decided_by_nick
from public.forum_guide_requests r
join public.forum_profiles u on u.id = r.user_id
left join public.forum_profiles d on d.id = r.decided_by;

grant select on public.forum_guide_request_list to anon, authenticated;

comment on view public.forum_guide_request_list is
  'Заявки с никами автора и решившего; название гайда клиент берёт из своего списка. Право чтения держит политика forum_guide_requests.';
