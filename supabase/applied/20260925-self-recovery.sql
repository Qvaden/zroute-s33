-- ── САМОВОССТАНОВЛЕНИЕ ДОСТУПА ──────────────────────────────────────────────
--
-- ЧТО МЕНЯЕТСЯ И ПОЧЕМУ. Раньше забытый пароль означал: владелец открывает
-- панель, сам набирает новый пароль и передаёт его человеку. Это работало, но
-- каждый игрок жил с аккаунтом, чужой пароль от которого известен владельцу, и
-- этот пароль становился рабочим надолго — поменять его самому было негде.
--
-- Теперь порядок другой:
--
--   1. Игрок на странице входа жмёт «Забыл пароль» и называет ник. Его браузер
--      придумывает длинный случайный ключ и показывает его только самому
--      игроку; в базу уходит SHA-256 от ключа, а не сам ключ.
--   2. Заявка живёт в базе и принимает новый пароль САМА — через 12 часов после
--      создания. Владелец видит её в панели ровно эти 12 часов и может
--      отклонить: отказ окончателен, заявка не оживёт. Подтвердить раньше срока
--      можно: это «не жди», для случая, когда игрок написал в игре.
--   3. Игрок возвращается и придумывает пароль сам. Он уходит в базу из его
--      браузера и нигде больше не показывается.
--
-- ПОЧЕМУ ВЫДЕРЖКА, А НЕ ЖИВОЙ ЧЕЛОВЕК. Прежний порядок превращал потерянный
-- пароль в очередь к одному человеку: игрок без доступа ждёт, пока владелец
-- заглянет в панель, и если тот не заглянул — двое сидят без дела. Выдержка
-- даёт то же самое время, только проверяет не внимание, а срок: половины суток
-- хватает, чтобы заметить чужую заявку в любой режим дня, а игроку не нужно
-- никого искать и ни о чём договариваться.
--
-- ЧЕМ ЭТО РИСКОВНЕЕ. Дверь больше не держит живой человек: тот, кому достался
-- чужой ключ с бумажки, через 12 часов окажется в аккаунте. Плата осознанная, и
-- у неё есть две опоры. Ключ не угадывается и из отпечатка не выводится, то
-- есть заполучить его можно только физически — прочесть чужую бумажку или
-- чужой браузер. И отказ владельца остаётся в силе навсегда: его право решает
-- исход по-прежнему, просто теперь нужно, чтобы НЕ пустить, а не чтобы пустить.
--
-- ИТОГ: у владельца остаётся право решить, кого НЕ пускать, и исчезает знание
-- чужого пароля. Это разные вещи, и вторая владельцу не нужна ни для чего,
-- кроме как войти в чужой аккаунт.
--
-- КАК ЗАПУСТИТЬ. Supabase → SQL Editor → вставить целиком → Run. Скрипт
-- повторный: правит существующее и не падает на уже созданном.
--
-- ЧИСЛА. 12 часов выдержка, сутки на «дойти и поставить пароль» после
-- досрочного подтверждения, неделя жизни неразобранной заявки, три заявки в
-- сутки на ник. Выдержка повторяется в этом файле пять раз и ещё раз названа
-- на стороне сайта (recoveryHoldHours в config.js) — менять надо вместе, иначе
-- страница обещает одно число, а база открывает дверь по другому.
--
-- ЧТО ЭТОТ СКРИПТ УБИРАЕТ. Функцию forum_admin_reset_password — вместе с окном
-- сброса в панели. Оставить её «на всякий случай» нельзя: пока она есть, любой,
-- кому владелец поверил на слово, получает пароль, которого владелец знать не
-- должен. Запасной вход для самого владельца описан в конце файла.

-- ── Заявки ───────────────────────────────────────────────────────────────────

create table if not exists public.forum_recoveries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.forum_users (id) on delete cascade,

  /*
    Отпечаток ключа, а не ключ. Считается в браузере игрока (SHA-256 от 16
    случайных байт), сюда приходит уже свёрнутым, и проверить по нему пароль
    нельзя: ни один пароль здесь не лежит.

    Хранить именно отпечаток нужно потому, что заявка живёт в базе несколько
    дней: за это время её кто угодно может прочитать, а предъявить право на
    восстановление должен только тот, у кого есть ключ.
  */
  code_hash   text not null,

  /*
    pending  — открыта; пароль от неё поставим, как только минует выдержка,
               либо раньше, если владелец подтвердит;
    approved — владелец впустил досрочно, ждать нечего;
    rejected — владелец отказал (заявка не его или игрок передумал);
    used     — пароль уже поставлен, заявка закрыта;
    expired  — срок вышел, ни в какую сторону.

    Держим pending, а не «готовим отдельный статус readiness»: право поставить
    пароль считается от created_at, и было бы ошибкой замораживать его
    записью. Заявка, дожившая до своего часа, остаётся pending ровно до того
    момента, как игрок придёт, — и всё это время её можно отклонить.

    'expired' отдельным значением, а не «оставить pending с просроченным
    сроком»: иначе панель владельца показывала бы заявки, которые он уже не
    может ни подтвердить, ни отклонить по-человечески.
  */
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'used', 'expired')),

  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  /* Кто из владельцев впустил досрочно или отказал. На одну запись владельцев не
     больше одного, но поле нужно: решение — действие, а действие без следа
     невозможно разобрать, если игрок спорит. */
  decided_by  uuid references public.forum_users (id) on delete set null,
  finished_at timestamptz,
  expires_at  timestamptz not null
);

/*
  Одна открытая заявка на игрока. Без этого правила можно было завести на
  человека десяток заявок и утонуть в них, а настоящую — потерять.

  Частичный индекс: закрытые (used/rejected/expired) не мешают создать новую,
  поэтому отвергнутая заявка не блокирует человеку путь назад навсегда.
*/
create unique index if not exists forum_recoveries_one_open
  on public.forum_recoveries (user_id)
  where status in ('pending', 'approved');

-- Очередь на прочтение панелью: сначала свежие ожидающие.
create index if not exists forum_recoveries_queue_idx
  on public.forum_recoveries (status, created_at desc);

alter table public.forum_recoveries enable row level security;

drop policy if exists forum_recoveries_staff_read on public.forum_recoveries;
create policy forum_recoveries_staff_read on public.forum_recoveries
  for select using (public.forum_is_admin());

/*
  Прав записи нет ни для кого, включая владельца: менять заявки умеют только
  функции ниже. Это не паранойя, а следствие того, что «подтвердить» — это
  выпуск пароля, и решение о нём должно проходить через одну проверку прав.
*/

-- ── Шаг 1. Игрок создаёт заявку ─────────────────────────────────────────────
--
-- Вызывается АНОНИМНО: человек, потерявший доступ, войти не может по определению.
-- Поэтому проверка прав внутри невозможна, и вместо них — ограничение частоты.

create or replace function public.forum_begin_recovery(
  p_nick      text,
  p_code_hash text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'Ключ повреждён — попробуйте ещё раз';
  end if;

  if char_length(trim(coalesce(p_nick, ''))) = 0 then
    raise exception 'Назовите ник';
  end if;

  select id into v_id
    from public.forum_users
   where lower(nick) = lower(trim(p_nick));

  /*
    НИКА НЕТ. Отвечаем тем же молчаливым успехом, что и для существующего:
    вставлять нечего, и функция на этом заканчивается.

    Это не маскировка — занят ли ник: форма регистрации отвечает на тот вопрос
    открыто, функцией forum_check_nick, и скрывать его тут было бы поздно.
    Молчание здесь ради одного: человек с опечаткой не упирается в «ника нет»,
    а сайт не объясняет всякому прохожему, кого он ещё не назвал. Страница
    восстановления сама спросит статус и покажет «заявка не найдена — проверьте
    ник», так что опечатка станет видна сразу.
  */
  if v_id is null then
    return;
  end if;

  -- Просроченные открытые заявки освобождают место: иначе человек, который
  -- не вернулся после подтверждения, не смог бы начать заново.
  update public.forum_recoveries
     set status = 'expired'
   where user_id = v_id
     and status in ('pending', 'approved')
     and expires_at < now();

  /*
    Открытая заявка уже есть — значит человек пришёл заново: сменил устройство,
    потерял ключ или нажал «начать заново». Заявка ПЕРЕзаписывается, а рядом не
    создаётся вторая: две открытые на одного игрока — это ровно та очередь, в
    которой настоящая тонет.

    И обязательно возвращается в pending. Оставить её подтверждённой означало
    бы, что новый ключ получает дверь, открытую для старого: подтверждение
    относится к той попытке, а не ко всем будущим.

    created_at при этом двигается — а вместе с ним начинается заново и выдержка
    в 12 часов. Это не формальность: перезаявка всегда означает, что прежний
    ключ потерян или кем-то уже виден, и открывать по новому ключу дверь,
    которую старый держал открытой, было бы тем же самым риском без ожидания.
  */
  if exists (
    select 1 from public.forum_recoveries
     where user_id = v_id
       and status in ('pending', 'approved')
  ) then
    update public.forum_recoveries
       set code_hash  = lower(p_code_hash),
           status     = 'pending',
           created_at = now(),
           decided_at = null,
           decided_by = null,
           expires_at = now() + interval '7 days'
     where user_id = v_id
       and status in ('pending', 'approved');
    return;
  end if;

  /*
    Три заявки в сутки на один ник. Правило держит не игрока (ему хватает
    одной), а поток мусора в панели владельца: без него анонимный вызов
    забил бы очередь за минуту.

    Считаются все заявки за сутки, включая закрытые: «отказали — создай ещё»
    не должно превращаться в десять отказов в час.
  */
  if (
    select count(*) from public.forum_recoveries
     where user_id = v_id
       and created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'Заявок на этот ник уже достаточно. Скажите владельцу напрямую и попробуйте позже';
  end if;

  insert into public.forum_recoveries (user_id, code_hash, expires_at)
  values (v_id, lower(p_code_hash), now() + interval '7 days');
end;
$$;

-- ── Шаг 2. Владелец может вмешаться ─────────────────────────────────────────
--
-- Заявка примет пароль и без этой функции; вызов нужен в двух противоположных
-- случаях: впустить досрочно (игрок написал в игре, ждать незачем) и не пустить
-- вовсе (заявка чужая). Второй важнее: с автоприёмом отказ — единственное, чем
-- владелец ещё влияет на то, кто окажется в чужом аккаунте.

create or replace function public.forum_review_recovery(
  p_id      uuid,
  p_approve boolean
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_status text;
begin
  if not public.forum_is_admin() then
    raise exception 'Отклонять и впускать заявки может только владелец';
  end if;

  select status into v_status from public.forum_recoveries where id = p_id;
  if v_status is null then
    raise exception 'Заявка не найдена';
  end if;

  if v_status <> 'pending' then
    raise exception 'Эта заявка уже разобрана: %', v_status;
  end if;

  /*
    Досрочный пропуск живёт сутки, а не «пока игрок не придёт».

    Смысл ручного пуска — подтвердить личность, а личности меняются: сегодня
    это был игрок, а завтра ник мог перейти к другому человеку. Неделя на
    «дойти и поставить пароль» после чужого «да» — это уже не подтверждение,
    а постоянная открытая дверь.

    Сама заявка, которую никто не тронул, так и живёт неделю: она открывается
    по сроку, а не по чьему-то слову, и слово тут задним числом не меняется.

    Отказ срока не имеет и после выдержки: запись остаётся pending, пока игрок
    не придёт, поэтому отклонить её можно и на двенадцатом часу. Это ровно то,
    ради чего панель существует в новом порядке, — запоздалое «стой» работает.
  */
  update public.forum_recoveries
     set status     = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = auth.uid(),
         expires_at = case
                        when p_approve then now() + interval '24 hours'
                        else now()
                      end
   where id = p_id;
end;
$$;

-- ── Шаг 3. Игрок ставит пароль ──────────────────────────────────────────────

-- Текущее состояние заявки — по нику и ключу.
--
-- Отвечаем только тому, кто предъявил ключ: без этого любой мог бы по списку
-- ников узнать, кого владелец уже пустил обратно.
--
-- 'none' — ни заявки нет, ни ключ не подходит, ни ника нет. Различать эти
-- случаи наружу незачем, а вред от различения есть.
--
-- ПОЧЕМУ JSONB, А НЕ ОДНО СЛОВО СТАТУСА. Мало сказать «ждёт» — надо сказать,
-- сколько ждать, иначе человек сядет перезаказывать заявку раз за разом и
-- упрётся в ограничение частоты, которое поставлено как раз против такого
-- шума. Поэтому наружу идут три поля:
--
--   status  — как в таблице;
--   canSet  — можно ли уже ставить пароль (срок вышел или владелец впустил);
--   readyAt — когда это станет возможным, чтобы показать остаток.
--
-- canSet считает база, а не браузер: часы на устройстве игрока могут спешить,
-- а право поставить пароль — не то, где удобству верить.
--
-- Возвращаемый тип меняется с text на jsonb, и create or replace этого не
-- прощает (Postgres запрещает менять тип результата), поэтому функция сначала
-- снимается.

drop function if exists public.forum_recovery_status(text, text);

create or replace function public.forum_recovery_status(
  p_nick text,
  p_code text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_row public.forum_recoveries%rowtype;
begin
  select r.* into v_row
    from public.forum_recoveries r
    join public.forum_users u on u.id = r.user_id
   where lower(u.nick) = lower(trim(coalesce(p_nick, '')))
     and r.code_hash = lower(encode(extensions.digest(convert_to(coalesce(p_code, ''), 'UTF8'), 'sha256'), 'hex'));

  if not found then
    return jsonb_build_object('status', 'none', 'canSet', false, 'readyAt', null);
  end if;

  if v_row.status in ('pending', 'approved') and v_row.expires_at < now() then
    update public.forum_recoveries set status = 'expired' where id = v_row.id;
    return jsonb_build_object('status', 'expired', 'canSet', false, 'readyAt', null);
  end if;

  if v_row.status not in ('pending', 'approved') then
    return jsonb_build_object('status', v_row.status, 'canSet', false, 'readyAt', null);
  end if;

  return jsonb_build_object(
    'status', v_row.status,
    'canSet', v_row.status = 'approved'
              or v_row.created_at + interval '12 hours' <= now(),
    'readyAt', v_row.created_at + interval '12 hours'
  );
end;
$$;

-- Новый пароль. Вызывается анонимно — с тем же ключом, что и заявка.
--
-- Пароль уходит отсюда в систему входа и НИКУДА больше: ни в панель, ни в
-- журнал, ни в ответ. Функция ничего не возвращает именно поэтому — показывать
-- нечего.
create or replace function public.forum_finish_recovery(
  p_nick     text,
  p_code     text,
  p_password text
)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_row public.forum_recoveries%rowtype;
begin
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Пароль короче 8 символов';
  end if;

  select r.* into v_row
    from public.forum_recoveries r
    join public.forum_users u on u.id = r.user_id
   where lower(u.nick) = lower(trim(coalesce(p_nick, '')))
     and r.code_hash = lower(encode(extensions.digest(convert_to(coalesce(p_code, ''), 'UTF8'), 'sha256'), 'hex'));

  if not found then
    raise exception 'Ключ не найден — начните восстановление заново';
  end if;

  /*
    Здесь держится всё правило. Статус страницы можно показать любой — этой
    проверкой, и только ею, заявка превращается в право сменить пароль.

    pending живёт в двух состояниях, и различает их время: до выдержки пароль
    не поставит никто, после — сам игрок, без единого нажатия в панели.
  */
  if v_row.status = 'pending' then
    if v_row.created_at + interval '12 hours' > now() then
      /*
        Сообщение считает база, а не браузер: обратиться сюда могут напрямую
        через REST, и «подождите» с настоящим остатком честнее, чем тот же
        текст без срока.
      */
      raise exception 'Заявка примет пароль через % минут',
        ceiling(extract(epoch from (v_row.created_at + interval '12 hours' - now())) / 60);
    end if;
  elsif v_row.status <> 'approved' then
    raise exception 'Заявка закрыта (%) — начните восстановление заново', v_row.status;
  end if;

  if v_row.expires_at < now() then
    update public.forum_recoveries set status = 'expired' where id = v_row.id;
    raise exception 'Заявка просрочилась — начните восстановление заново';
  end if;

  /*
    Пароль хеширует сам Postgres (bcrypt) — той же строкой, что и раньше.
    Своей криптографии в проекте нет намеренно: самодельное хеширование хуже
    отсутствия пароля, потому что выглядит защитой.
  */
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_row.user_id;

  update public.forum_recoveries
     set status = 'used', finished_at = now()
   where id = v_row.id;
end;
$$;

-- ── Список для панели ───────────────────────────────────────────────────────
--
-- Отдельное представление, а не прямая работа с таблицей: в нём нет поля
-- code_hash, так что даже владелец, открывший список в панели или в SQL-редакторе
-- через него, увидит ники и сроки, но не отпечатки ключей.
--
-- security_invoker = true — чтобы работали правила доступа самой таблицы:
-- представление не раздаёт заявки тем, кому их видеть нельзя.

create or replace view public.forum_recovery_requests
with (security_invoker = true) as
select r.id,
       r.user_id,
       u.nick,
       u.role,
       r.status,
       r.created_at,
       /* Час, когда заявка примет пароль сама. Панель считает от него остаток,
          чтобы владелец решал не «разбирать или нет», а «успеваю возразить». */
       r.created_at + interval '12 hours' as ready_at,
       r.decided_at,
       r.expires_at,
       (select n.nick from public.forum_users n where n.id = r.decided_by) as decided_by_nick
  from public.forum_recoveries r
  join public.forum_users u on u.id = r.user_id;

-- ── Права на вызов ──────────────────────────────────────────────────────────
--
-- Начало восстановления и его статус/финал — анонимные: тот, кто забыл пароль,
-- по определению не может войти. Всё остальное требует вошедшего владельца.

revoke all on function public.forum_begin_recovery(text, text) from public;
grant execute on function public.forum_begin_recovery(text, text) to anon, authenticated;

revoke all on function public.forum_recovery_status(text, text) from public;
grant execute on function public.forum_recovery_status(text, text) to anon, authenticated;

revoke all on function public.forum_finish_recovery(text, text, text) from public;
grant execute on function public.forum_finish_recovery(text, text, text) to anon, authenticated;

revoke all on function public.forum_review_recovery(uuid, boolean) from public, anon;
grant execute on function public.forum_review_recovery(uuid, boolean) to authenticated;

grant select on public.forum_recovery_requests to authenticated;

-- ── Старый сброс убирается ──────────────────────────────────────────────────
--
-- Панель больше не умеет набирать чужой пароль, и функции, которой он
-- передавался, в базе оставаться не должно.

drop function if exists public.forum_admin_reset_password(uuid, text);

-- ── ЕСЛИ ЗАБЫЛ ПАРОЛЬ САМ ВЛАДЕЛЕЦ ──────────────────────────────────────────
--
-- Поток выше не помогает: подтверждать заявку некому. Восстанавливается одним
-- запросом в Supabase → SQL Editor, где прав и так хватает:
--
--   update auth.users
--      set encrypted_password = extensions.crypt('новый-пароль',
--                                                extensions.gen_salt('bf'))
--     where id = (select id from public.forum_users where role = 'admin');
--
-- Отдельной кнопки в панели для этого нет намеренно: владелец и без неё хозяин
-- базы, а кнопка только расширила бы поверхность, куда дотягивается чужая рука.
