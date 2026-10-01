-- 2026-09-25. Тишина в одном разделе вместо тишины на всём форуме.
--
-- Идея пришла из большого форума сообщества (Qvaden/zroute-alliance-hub):
-- там у канала есть таблица channelMutes — пара «канал и человек» со сроком.
-- Перенесено на наш SQL один в один по смыслу: раздел вместо канала, строка
-- профиля вместо id пользователя.
--
-- ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
--
-- Общая тишина и бан — меры тяжёлые, и модератор их часто жалеет: из-за
-- одного разгоревшегося спора в «Разборе VS» человек лишается всего форума,
-- включая вопросы и летопись, где он полезен. Жалеть — правильно, но без
-- третьего варианта модератор выбирает между «ничего не делать» и «отнять
-- всё», и чаще всего выбирает первое. Раздельная тишина оставляет ему
-- соразмерный ответ.
--
-- ── ПРАВИЛО ─────────────────────────────────────────────────────────────────
--
--   1. Тишина налагается на раздел и на человека, парой (user_id, category).
--      Второй записи про ту же пару не бывает: продление — это та же строка.
--   2. Срок — от 1 до 30 дней. Дольше держит только общий запрет, и это не
--      придирка к цифре: «мьют до Нового года» — тот же бан, только без
--      двери для игрока (см. пункт 5).
--   3. Пояснение обязательно (5–200 символов) и показывается игроку. Мера,
--      причину которой не назвали, читается как произвол.
--   4. Тишина в разделе закрывает текст в этом разделе: новые темы и новые
--      ответы. Реакции, жалобы и правка своего старого поста остаются —
--      они не продолжают спор словами.
--   5. Закрыть игроку последний открытый раздел нельзя: это общий запрет,
--      замаскированный под частный. Общий запрет оспорим (см.
--      20260925-sanction-appeal.sql), а сумма частных мер такой двери не имеет,
--      и модератор, закрывший все разделы по очереди, отнял бы у человека
--      право возразить.
--   6. Тишины по разделам складываются с общей: бан и общая тишина действуют
--      через forum_can_write(), и закрытый раздел к ним только добавляется.
--
-- ── ГДЕ ДВЕРЬ ───────────────────────────────────────────────────────────────
--
-- Право писать держит forum_can_write(). У неё был один вопрос — «можно ли
-- человеку вообще»; теперь есть второй — «можно ли ему здесь». Перегруженная
-- функция принимает раздел и вызывается из политиков вставки: у темы раздел
-- лежит в самой строке, у комментария — у её темы (тот же подзапрос, что уже
-- стоит в политике комментария).
--
-- Отказ по-русски даёт триггер перед вставкой, а не политика: политика
-- сообщила бы браузеру «violates row-level security policy», и игрок увидел
-- бы поломку вместо причины. Тот же порядок, что у срока действия темы
-- (forum_posts_expiry) и у апелляций: проверка в базе, слова — тоже в базе.
--
-- Записывает тишину одна функция, а не прямой INSERT из панели: отказ обязан
-- называть причину, а не нарушать ограничение.
--
-- ── ЧИСЛА ───────────────────────────────────────────────────────────────────
--
-- Границы срока (1–30 дней) и длины пояснения (5–200) держит функция ниже;
-- панель предлагает те же сроки кнопками (DURATIONS в
-- src/admin/screens/players.js) и те же границы у поля, а совпадение списка
-- разделов со схемой и общность текстов отказа с черновым адаптером сторожит
-- тест. Отдельных чисел в config.js для этой меры нет — клиент ничего не
-- проверяет на глаз, он только пересказывает то, что скажет база.
--
-- ── ЗАПУСК ──────────────────────────────────────────────────────────────────
--
-- Supabase → SQL Editor → вставить целиком → Run. Ставится после
-- 20260925-sanction-appeal.sql. Новых колонок у существующих таблиц здесь нет;
-- пересоздаются только две политики вставки. Сайт без этой миграции работает
-- как раньше: список тишин приходит отдельным запросом, а неудача оставляет
-- разделы открытыми, а не роняет страницу.

-- ── Шаг 1. Тишины ───────────────────────────────────────────────────────────

create table if not exists public.forum_section_mutes (
  user_id     uuid not null references public.forum_users (id) on delete cascade,

  /*
    Тот же список разделов, что у forum_posts.category в schema.sql. Держим
    его здесь прямо, а не ссылкой: CHECK не может смотреть в другую таблицу,
    а опечатка в id открыла бы тишину, которая никого не закрывает (раздел
    с таким id не вставляется никогда).
  */
  category    text not null check (category in ('news','vs','chronicle','ally','help','offtop','flood','blog')),

  /*
    До какого момента здесь нельзя писать. Просроченная запись не мешает и
    не чистится фоном: проверка всегда «muted_until > now()», поэтому
    истёкшая тишина ведёт себя ровно как снятая. Плюс остаётся история —
    «кому и где закрывали», а не стертое в ноль прошлое.
  */
  muted_until timestamptz not null,

  reason      text not null check (char_length(reason) between 5 and 200),

  set_by      uuid references public.forum_users (id) on delete set null,
  created_at  timestamptz not null default now(),

  primary key (user_id, category)
);

comment on table public.forum_section_mutes is
  'Тишина в отдельных разделах: пара «игрок и раздел» со сроком и причиной. Общую тишину не заменяет.';

alter table public.forum_section_mutes enable row level security;

/*
  Игроку — свои строки, модерации — все. Имени наложившего здесь нет и в
  панели оно не нужно: журнал модерации и так знает, кто что сделал.

  Политик записи нет: менять тишины умеет только функция ниже, иначе
  модераторский PATCH из браузера был бы отличим от любого другого PATCHа,
  а отказал бы он текстом нарушения ограничения.
*/
drop policy if exists forum_section_mutes_read on public.forum_section_mutes;
create policy forum_section_mutes_read on public.forum_section_mutes
  for select using (user_id = auth.uid() or public.forum_is_staff());

revoke all on table public.forum_section_mutes from public, anon;
grant select on public.forum_section_mutes to authenticated;

-- ── Шаг 2. Право писать в этом разделе ──────────────────────────────────────

/*
  Перегрузка, а не замена: функция без аргумента отвечает на прежний вопрос и
  стоит в политиках чатов, реакций гайдов и опросов. Переделывать её в
  «обязательно с разделом» значило бы заставить все эти места передавать
  раздел, которого у них нет.
*/
create or replace function public.forum_can_write(p_category text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.forum_can_write()
     and not exists (
       select 1 from public.forum_section_mutes m
        where m.user_id = auth.uid()
          and m.category = p_category
          and m.muted_until > now()
     );
$$;

comment on function public.forum_can_write(text) is
  'Можно ли вошедшему писать в этот раздел: общий запрет плюс тишина по разделу. Раздела нет — только общий запрет.';

revoke all on function public.forum_can_write(text) from public, anon;
grant execute on function public.forum_can_write(text) to authenticated;

-- Темы: раздел лежит в самой строке.
drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write(category)
    and deleted = false
    and pinned = false
  );

-- Ответы: раздел берётся у темы. forum_posts читает кто угодно, поэтому
-- подзапрос работает и под политикой комментария; post_id здесь однозначен —
-- у forum_posts такой колонки нет (ошибка с «id» без имени таблицы разобрана
-- в forum_posts_update_own).
drop policy if exists forum_comments_insert on public.forum_comments;
create policy forum_comments_insert on public.forum_comments
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write((select p.category from public.forum_posts p where p.id = post_id))
    and deleted = false
    and exists (select 1 from public.forum_posts p where p.id = post_id and p.deleted = false)
  );

/*
  Слова отказа. Политика отвергает строка, но человек в окне ошибки PostgREST
  видит «row-level security policy», и на этом его понимание кончается.
  Триггер перед вставкой срабатывает раньше проверки политики и отдаёт
  нормальную фразу. Даты в тексте нет намеренно: часовой пояс страницы и
  часовой пояс базы называют разные вечера, а дата игроку показывается
  рядом — там, где её формат известен.
*/
create or replace function public.forum_section_mute_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_cat    text;
  v_reason text;
begin
  -- Пустой auth.uid() — это миграция или функция от имени владельца: им
  -- тишина не мешает, иначе перестали бы работать уже готовые definer-функции.
  if auth.uid() is null then
    return new;
  end if;

  if public.forum_is_staff() then
    return new;
  end if;

  if TG_TABLE_NAME = 'forum_posts' then
    v_cat := new.category;
  else
    select p.category into v_cat from public.forum_posts p where p.id = new.post_id;
  end if;

  if v_cat is null then
    -- Темы нет: её отвергнет политика вставки, и объяснять тут нечего.
    return new;
  end if;

  select m.reason into v_reason
    from public.forum_section_mutes m
   where m.user_id = auth.uid()
     and m.category = v_cat
     and m.muted_until > now()
   order by m.muted_until desc
   limit 1;

  if v_reason is null then
    return new;
  end if;

  raise exception 'Вам нельзя писать в этот раздел: %', v_reason;
end;
$$;

comment on function public.forum_section_mute_guard() is
  'Отказ игроку, который пишет в закрытый для него раздел. Тема и комментарий проверяются одной функцией.';

drop trigger if exists forum_section_mute_insert on public.forum_posts;
create trigger forum_section_mute_insert
  before insert on public.forum_posts
  for each row execute function public.forum_section_mute_guard();

drop trigger if exists forum_section_mute_insert on public.forum_comments;
create trigger forum_section_mute_insert
  before insert on public.forum_comments
  for each row execute function public.forum_section_mute_guard();

-- ── Шаг 3. Дверь модерации ─────────────────────────────────────────────────

create or replace function public.forum_set_section_mute(
  p_user_id  uuid,
  p_category text,
  p_days     integer,
  p_reason   text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_all    text[] := array['news','vs','chronicle','ally','help','offtop','flood','blog'];
  v_nick   text;
  v_user   public.forum_users%rowtype;
  v_reason text;
  v_free   integer;
begin
  select nick into v_nick from public.forum_users where id = auth.uid();

  if not public.forum_is_staff() then
    raise exception 'Тишину в разделе налагает и снимает модерация';
  end if;

  if p_category is null or not (p_category = any (v_all)) then
    raise exception 'Неизвестный раздел';
  end if;

  select * into v_user from public.forum_users where id = p_user_id;

  if v_user.id is null then
    raise exception 'Игрок не найден';
  end if;

  /*
    Строго то же, что держит триггер forum_users_guard для общей тишины:
    неприкосновенен владелец, а модератора ограничить может другой модератор.
    Разные правила для двух видов одной меры — это дырка, а не аккуратность.
  */
  if v_user.role = 'admin' then
    raise exception 'Администратора тишине не подвергают';
  end if;

  if p_days is null then
    delete from public.forum_section_mutes
     where user_id = p_user_id and category = p_category;

    perform public.forum_write_moderation_action(
      'user', p_user_id::text, v_user.nick, 'section_mute_removed',
      jsonb_build_object('category', p_category)
    );
    return;
  end if;

  if p_days < 1 or p_days > 30 then
    raise exception 'Тишина в разделе — от 1 до 30 дней: дольше держит общий запрет';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));

  if char_length(v_reason) < 5 or char_length(v_reason) > 200 then
    raise exception 'Нужно пояснение от 5 до 200 символов: игрок видит причину';
  end if;

  /*
    Последний открытый раздел. Считаем не только тот, что закрываем сейчас:
    если после этого шага писать будет некуда, мера стала общей, а общая мера
    обязана быть оспоримой. Функция отказывает и отправляет модератора в окно
    общих ограничений — там дверь для игрока уже есть.
  */
  select count(*) into v_free
    from unnest(v_all) as c(id)
   where c.id <> p_category
     and not exists (
       select 1 from public.forum_section_mutes m
        where m.user_id = p_user_id
          and m.category = c.id
          and m.muted_until > now()
     );

  if v_free = 0 then
    raise exception 'Это уже общий запрет: наложите тишину целиком — тогда игрок сможет её оспорить';
  end if;

  insert into public.forum_section_mutes (user_id, category, muted_until, reason, set_by)
  values (p_user_id, p_category, now() + make_interval(days => p_days), v_reason, auth.uid())
  on conflict (user_id, category)
    do update set muted_until = excluded.muted_until,
                  reason      = excluded.reason,
                  set_by      = excluded.set_by;

  /*
    В журнал это попадает руками, а не триггером: forum_audit_restriction
    следит за полем muted_until в профиле, а тут своя таблица и триггера на
    неё не было бы за чем — запись о решении нужна один раз, в момент
    решения. Без этой строки «кто закрыл раздел» в панели читалось бы как
    «никто».
  */
  perform public.forum_write_moderation_action(
    'user', p_user_id::text, v_user.nick, 'section_mute',
    jsonb_build_object('category', p_category, 'days', p_days, 'reason', v_reason)
  );

  insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, preview)
  values (
    p_user_id,
    auth.uid(),
    coalesce(v_nick, 'Модерация'),
    'moderation',
    left('Тишина в разделе: ' || v_reason, 120)
  );
end;
$$;

revoke all on function public.forum_set_section_mute(uuid, text, integer, text) from public, anon;
grant execute on function public.forum_set_section_mute(uuid, text, integer, text) to authenticated;

comment on function public.forum_set_section_mute(uuid, text, integer, text) is
  'Тишина в одном разделе на 1–30 дней; p_days is null снимает её. Последний открытый раздел закрыть нельзя.';
