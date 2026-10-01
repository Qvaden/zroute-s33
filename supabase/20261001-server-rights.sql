-- Мультиаренда, шаг 2: у сервера появляются свои права.
--
-- ЗАЧЕМ. Шаг 1 (`20261001-server-scope.sql`) научил базу различать ленты, но
-- право слова оставил общим: игрок, выбравший в переключателе чужой сервер,
-- писал туда на тех же правах, что в свою. Второй сервер оставался витриной, и
-- список «чего здесь намеренно нет» прямо обязывал этот шаг.
--
-- ПРАВИЛО ШАГА. Права по серверу касаются только материала ленты:
--   - написать тему или ответ — значит быть участником сервера, если сервер
--     закрыт; открытый сервер принимает любого вошедшего, ровно как сегодня;
--   - модерировать — закрепить, скрыть, снять чужое вложение, разобрать
--     жалобу — значит быть модератором ЭТОГО сервера или модерацией сайта;
--   - читать — как и раньше: ленты публичные. Право слова не равно доступу, и
--     делать чужую ленту невидимой этот шаг не собирается.
--
-- ЧЕГО ЗДЕСЬ НЕТ — И ПОЧЕМУ.
--
-- 1. Мер над человеком по серверу. Бан, тишина (общая и по разделу), апелляции
--    и роль в `forum_users` остаются глобальными. Причина не в лени: запрет,
--    который действует на 44-м и снимается на 33-м, означает, что забаненный
--    продолжает говорить — просто в другой ленте. Мера над человеком обязана
--    быть одна на весь сайт, и территория у неё одна — весь сайт.
-- 2. Сервера у записей, живущих без темы: заметки пульса, события магазина,
--    заявки на гайды, чаты. У них колонка появится отдельными шагами, и право
--    писать там держит общая модерация.
-- 3. Экрана панели. Дверь одна (`forum_set_server_member`), и на этом шаге её
--    вызывают из SQL — готовыми строками, которые лежат в `supabase/README.md`.
--    Просьба «запиши меня в сервер» и экран выдачи — следующий шаг: просить
--    участие в закрытую ленту через кнопку, которую никто не проверяет, —
--    полумера, а не дверь.
-- 4. Права смотреть чужие жалобы целиком. Модератор сервера видит только жалобы
--    на материал своей ленты — политика ниже.
--
-- ПОРЯДОК ПРОТИВ ОПЕЧАТКИ. Значение по умолчанию у флага открытости — `false`:
-- новый сервер по умолчанию свой, а не общий, и ошибку «забыл закрыть» такой
-- выбор не допускает. Обратное было бы хуже: сервер, заведённый для одной
-- команды, молча принял бы чужие темы.

-- ── Шаг 1. Открытость сервера ───────────────────────────────────────────────

/*
  Два флага у одного сервера — не дубль, а два разных вопроса:
   - `enabled` — принимает ли сервер НОВЫЕ темы вообще, для участников тоже.
     Этот флаг уже был, но только подписывал кнопку в переключателе; с этого
     шага он отказывает;
   - `open_writing` — пускает ли он чужих, то есть тех, кого нет в списке
     участников.
*/
alter table public.forum_servers add column if not exists open_writing boolean
  not null default false;

comment on column public.forum_servers.open_writing is
  'true — писать может любой вошедший; false — только участники из forum_server_members и модерация сайта.';

/*
  Ряд №33 открывается этим же файлом, и это единственное место, где шаг 2
  трогает существующие данные. Смысл ровно один: прогон миграции не должен ни у
  кого отнять слово. Сообщество 33-го пишет сюда с первого дня сайта, и закрыть
  его «по умолчанию» значило бы проснуться с форумом, где писать некому, кроме
  владельца.

  Условие по id, а не «все строки»: если списку когда-нибудь добавят второй
  сервер, он должен родиться закрытым, а не унаследовать открытость дома.
*/
update public.forum_servers set open_writing = true where id = 33;

-- ── Шаг 2. Список участников сервера ────────────────────────────────────────

create table if not exists public.forum_server_members (
  user_id    uuid    not null references public.forum_users (id) on delete cascade,
  -- Каскад и по серверу: ленту убрали из списка — её участники не должны
  -- остаться сиротской строкой в чужой таблице.
  server_id  integer not null references public.forum_servers (id) on delete cascade,

  /*
    Две роли, третьей нет. `member` — право слова в закрытой ленте. `moderator`
    — право на её материал. Модератор сервера НЕ становится модерацией сайта:
    панель, баны, тишина и роли ему не открываются (см. «ЧЕГО ЗДЕСЬ НЕТ», п. 1),
    и проверяется это по-прежнему через `forum_is_staff()`, а не через новую
    функцию.
  */
  role       text    not null default 'member' check (role in ('member', 'moderator')),

  added_by   uuid references public.forum_users (id) on delete set null,
  added_at   timestamptz not null default now(),

  primary key (user_id, server_id)
);

comment on table public.forum_server_members is
  'Кто принадлежит ленте сервера: пара «игрок и сервер» с ролью участник/модератор. Открытому серверу членство не нужно, но строка заводится всё равно.';

alter table public.forum_server_members enable row level security;

/*
  Свою строку видит участник, весь список — модерация сайта и модератор этого
  сервера: второму без списка некем управлять.

  Проверка модерата держится `forum_is_server_moderator()` (definer-функция), а
  не подзапросом в эту же таблицу: подзапрос внутри политики попал бы под её же
  правило и база отвергла бы запрос как бесконечную рекурсию.

  Две функции права стоят здесь, а не общим списком в шаге 5, по одной
  прозаической причине: `create policy` проверяет существование вызываемой
  функции в момент создания, и политика, ссылающаяся на функцию, которой ещё
  нет, не создаётся вовсе. Остальные три функции — в шаге 5, куда им и место,
  потому что их читают политики вставки и модературы.
*/
create or replace function public.forum_is_server_member(p_server integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_server_members
     where user_id = auth.uid() and server_id = p_server
  );
$$;

create or replace function public.forum_is_server_moderator(p_server integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.forum_server_members
     where user_id = auth.uid() and server_id = p_server and role = 'moderator'
  );
$$;

comment on function public.forum_is_server_member(integer) is
  'Принадлежит ли вошедший ленте этого сервера любой из ролей.';

comment on function public.forum_is_server_moderator(integer) is
  'Модератор ли вошедший именно этого сервера. Модерацией сайта эта строка не является.';

revoke all on function public.forum_is_server_member(integer) from public, anon;
revoke all on function public.forum_is_server_moderator(integer) from public, anon;
grant execute on function public.forum_is_server_member(integer) to authenticated;
grant execute on function public.forum_is_server_moderator(integer) to authenticated;

drop policy if exists forum_server_members_read on public.forum_server_members;
create policy forum_server_members_read on public.forum_server_members
  for select using (
    user_id = auth.uid()
    or public.forum_is_staff()
    or public.forum_is_server_moderator(server_id)
  );

/*
  Политик на запись нет ни одной намеренно — тот же порядок, что у тишины по
  разделу, заявок на гайды и наград репутацией: список умеет менять только дверь
  `forum_set_server_member` ниже. Политика строки не умеет ни отказать по
  причине, ни записать в журнал, ни не выбить последнего модератора — а всё это
  здесь нужно.
*/
revoke all on table public.forum_server_members from public, anon;
grant select on public.forum_server_members to authenticated;

-- Модератор сервера выбирает из своего списка, а не из всей таблицы.
create index if not exists forum_server_members_server_idx
  on public.forum_server_members (server_id, role);

-- ── Шаг 3. Нынешнее сообщество становится участниками №33 ──────────────────

/*
  Backfill обязателен, иначе единственной причиной, по которой сайт работает,
  остался бы флаг открытости: сегодня в 33-й пишет каждый, и «каждый» здесь —
  это ровно те строки, что уже лежат в `forum_users`. Захочет владелец закрыть
  свой дом — список уже собран, и закрытие не отнимет слово ни у кого, кто
  зарегистрирован.

  `on conflict do nothing`: файл прогоняют повторно, чтобы проверить
  идемпотентность, и второй запуск не должен перетирать то, что модерация
  изменила руками (например сняла чьё-то участие).

  Модерация сайта из этого запроса исключена (`role not in`) не из небрежности,
  а потому, что следующий ряд ставит ей другую роль: без условия её строка
  успела бы стать участником, а `on conflict do nothing` на втором запросе
  промолчал бы — и модератор 33-го остался бы в списке обычным участником.
*/
insert into public.forum_server_members (user_id, server_id, role)
select u.id, 33, 'member'
  from public.forum_users u
 where u.role not in ('admin', 'moderator')
   and exists (select 1 from public.forum_servers s where s.id = 33)
on conflict (user_id, server_id) do nothing;

/*
  Глобальная модерация получает роль модератора в своём доме. Формально она и
  так может всё везде (`forum_is_staff()` обходит границы), поэтому строка —
  книга учёта, а не расширение прав: «модератор сервера 33 — это те же люди, что
  модерация сайта».
*/
insert into public.forum_server_members (user_id, server_id, role)
select u.id, 33, 'moderator'
  from public.forum_users u
 where u.role in ('admin', 'moderator')
   and exists (select 1 from public.forum_servers s where s.id = 33)
on conflict (user_id, server_id) do nothing;

-- ── Шаг 4. Новый игрок записывается в открытые серверы сам ──────────────────

/*
  Без этой строки список участников остался бы фотографией момента миграции:
  через полгода закрытый сервер отказывал бы людям, которые всегда считались
  своими. Правило дешёвое и честное: открытый сервер принимает новичка в свой
  список сам.

  В закрытые серверы новичок не попадает ни как: там его заводит модератор
  сервера или модерация сайта — иначе «закрытый» был бы вывеской.
*/
create or replace function public.forum_join_open_servers()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.forum_server_members (user_id, server_id, role)
  select new.id, s.id, 'member'
    from public.forum_servers s
   where s.open_writing
  on conflict (user_id, server_id) do nothing;

  return new;
end;
$$;

comment on function public.forum_join_open_servers() is
  'Авточленство: новый игрок становится участником каждого открытого сервера.';

drop trigger if exists forum_join_open_servers on public.forum_users;
create trigger forum_join_open_servers
  after insert on public.forum_users
  for each row execute function public.forum_join_open_servers();

-- ── Шаг 5. Функции права ────────────────────────────────────────────────────

/*
  Все функции — `security definer`: их читают политики, а сами они смотрят в
  `forum_server_members`, целиком которой игроку не виден. Тот же порядок, что у
  `forum_is_staff()` и `forum_can_write()` в schema.sql. Две функции, отвечающие
  на вопрос «есть ли я в списке», уже определены в шаге 2 — там, где их требует
  политика чтения.
*/

create or replace function public.forum_can_write_server(p_server integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.forum_is_staff()                       -- модерация сайта пишет везде
     or p_server is null                               -- сервера нет — разберётся политика вставки
     or exists (                                       -- открытый сервер принимает любого
       select 1 from public.forum_servers s
        where s.id = p_server and s.open_writing
     )
     or public.forum_is_server_member(p_server);
$$;

comment on function public.forum_can_write_server(integer) is
  'Можно ли вошедшему писать в ленту этого сервера: модерация сайта, открытый сервер или участник.';

create or replace function public.forum_can_moderate_server(p_server integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.forum_is_staff()
     or (p_server is not null and public.forum_is_server_moderator(p_server));
$$;

comment on function public.forum_can_moderate_server(integer) is
  'Можно ли распоряжаться материалом ленты этого сервера: закрепить, скрыть, снять вложение, разобрать жалобу.';

/*
  Экрану нужен не ответ «да/нет» по одному серверу, а карта сразу по всем:
  переключатель показывает чужие ленты, форма темы решает, прятаться или нет, и
  всё это — до первого обращения к чужому серверу. Один запрос вместо нескольких.

  Роль возвращается для каждого сервера, включая тот, где игрока нет: «none» —
  это тоже ответ, и именно он рисует объяснение под переключателем.

  Открытый сервер даёт роль `member` даже без строки участника: для экрана
  «могу писать» и «принадлежу ленте» — одно и то же.
*/
create or replace function public.forum_my_server_roles()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(x.id::text, x.role), '{}'::jsonb)
    from (
      select s.id,
        case
          when public.forum_is_staff()
            or public.forum_is_server_moderator(s.id) then 'moderator'
          when s.open_writing or public.forum_is_server_member(s.id) then 'member'
          else 'none'
        end as role
        from public.forum_servers s
    ) x;
$$;

comment on function public.forum_my_server_roles() is
  'Моя роль в каждом сервере одним запросом: moderator / member / none.';

revoke all on function public.forum_can_moderate_server(integer) from public, anon;
revoke all on function public.forum_my_server_roles() from public, anon;

grant execute on function public.forum_can_write_server(integer) to anon, authenticated;
grant execute on function public.forum_can_moderate_server(integer) to authenticated;
grant execute on function public.forum_my_server_roles() to authenticated;

-- ── Шаг 6. Отказ по-русски, а не «violates row-level security policy» ───────

/*
  Как и в тишине по разделу (`20260925-section-mute.sql`): проверку держит
  политика, а слова — триггер перед вставкой. Отказ политики браузер перевёл бы
  как «База отказала: недостаточно прав для этого действия», и игрок прочитал бы
  про поломку вместо «тебя нет в этом сервере».

  Слова отказа — те же, что в черновом адаптере: страница обязана сказать
  человеку то же самое до отправки, что скажет база после. Совпадение сторожит
  тест.
*/
create or replace function public.forum_server_write_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_server integer;
  v_accepts boolean;
begin
  -- Пустой auth.uid() — миграция или definer-функция от имени владельца: им
  -- границы лент не мешают (тот же порядок, что в forum_section_mute_guard).
  if auth.uid() is null then
    return new;
  end if;

  if TG_TABLE_NAME = 'forum_posts' then
    v_server := new.server_id;
  else
    select p.server_id into v_server from public.forum_posts p where p.id = new.post_id;
  end if;

  /*
    Темы под комментарием нет — её отвергнет политика вставки, и объяснять на
    русском нечего.
  */
  if v_server is null then
    return new;
  end if;

  /*
    Приём тем выключен. Отдельная причина и отдельное сообщение: «сервер закрыт
    для чужих» и «лента закрыта для всех» человек путает мгновенно, а вторая
    фраза значит, что ждать добавления бесполезно.
  */
  if TG_TABLE_NAME = 'forum_posts' and not public.forum_is_staff() then
    select s.enabled into v_accepts from public.forum_servers s where s.id = v_server;

    if v_accepts is not null and not v_accepts then
      raise exception 'Приём новых тем в этот сервер закрыт модерацией';
    end if;
  end if;

  if public.forum_can_write_server(v_server) then
    return new;
  end if;

  raise exception 'В этот сервер пишут только его участники: попросите модератора сервера добавить вас';
end;
$$;

comment on function public.forum_server_write_guard() is
  'Отказ не-участнику закрытого сервера и отказ любой новой теме на закрытой ленте. Тема и ответ проверяются одной функцией — ответ берёт сервер у темы.';

/*
  Имя по алфавиту идёт после `forum_section_mute_insert`: перед вставкой триггеры
  обходятся по именам, и человек, который пишет в закрытый для него раздел чужой
  ленты, должен получить сначала причину помягче (раздел), а уже потом про
  сервер. Тот же порядок повторяет черновой адаптер.
*/
drop trigger if exists forum_server_write_insert on public.forum_posts;
create trigger forum_server_write_insert
  before insert on public.forum_posts
  for each row execute function public.forum_server_write_guard();

drop trigger if exists forum_server_write_insert on public.forum_comments;
create trigger forum_server_write_insert
  before insert on public.forum_comments
  for each row execute function public.forum_server_write_guard();

-- ── Шаг 7. Политики: право слова по серверу ─────────────────────────────────

/*
  Копия определения из `20260925-section-mute.sql` плюс две строки. Сервер у
  темы лежит в самой строке, поэтому проверять негде, кроме как здесь.
*/
drop policy if exists forum_posts_insert on public.forum_posts;
create policy forum_posts_insert on public.forum_posts
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write(category)
    and public.forum_can_write_server(server_id)
    -- Приём тем выключен — не пишет никто, кроме модерации сайта: ей нужны
    -- служебные темы и на закрытой ленте.
    and (public.forum_is_staff() or exists (
          select 1 from public.forum_servers s where s.id = server_id and s.enabled
        ))
    and deleted = false
    and pinned = false
  );

/*
  Копия определения из `20260925-section-mute.sql`, с одним изменением: между
  двумя проверками права появился сервер, и ответ берёт его у темы. Тот же
  подзапрос, что уже стоит в политике выше: `forum_posts` читает кто угодно,
  поэтому под политикой комментария он работает.
*/
drop policy if exists forum_comments_insert on public.forum_comments;
create policy forum_comments_insert on public.forum_comments
  for insert with check (
    author_id = auth.uid()
    and public.forum_can_write((select p.category from public.forum_posts p where p.id = post_id))
    and public.forum_can_write_server((select p.server_id from public.forum_posts p where p.id = post_id))
    and deleted = false
    and exists (select 1 from public.forum_posts p where p.id = post_id and p.deleted = false)
  );

-- ── Шаг 8. Политики: модература по серверу ──────────────────────────────────

/*
  Темы: прежняя `forum_is_staff()` стала территорией. Граница проходит по
  строке, а не по человеку: модератор 44-го не может ни скрыть тему 33-го, ни
  восстановить свою.

  `with check` смотрит на новый server_id, и это не случайность: попытка
  вытолкнуть тему в чужой дом, где права модератора кончаются, должна быть
  невозможна. Перевод темы между лентами остаётся делом владельца сайта — см.
  `forum_is_admin()` в триггере ниже.
*/
drop policy if exists forum_posts_moderate on public.forum_posts;
create policy forum_posts_moderate on public.forum_posts
  for update using (public.forum_can_moderate_server(server_id))
  with check (public.forum_can_moderate_server(server_id));

-- Ответы: сервера у них нет, он у темы.
drop policy if exists forum_comments_moderate on public.forum_comments;
create policy forum_comments_moderate on public.forum_comments
  for update using (
    exists (
      select 1 from public.forum_posts p
       where p.id = forum_comments.post_id
         and public.forum_can_moderate_server(p.server_id)
    )
  )
  with check (
    exists (
      select 1 from public.forum_posts p
       where p.id = forum_comments.post_id
         and public.forum_can_moderate_server(p.server_id)
    )
  );

/*
  Жалобы. Читает и разбирает их модерация сайта — как и раньше — плюс модератор
  того сервера, о материале которого жалоба. Чужие списки жалоб при этом не
  открываются: жалоба знает, кто на кого пожаловался, и это уже обсуждалось в
  schema.sql.

  Сервера у жалобы нет, поэтому оба случая разбираются подзапросом: тема —
  прямо, комментарий — через свою тему.
*/
drop policy if exists forum_reports_read on public.forum_reports;
create policy forum_reports_read on public.forum_reports
  for select using (
    public.forum_is_staff()
    or (target_type = 'post' and exists (
          select 1 from public.forum_posts p
           where p.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
    or (target_type = 'comment' and exists (
          select 1 from public.forum_comments c
            join public.forum_posts p on p.id = c.post_id
           where c.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
  );

drop policy if exists forum_reports_resolve on public.forum_reports;
create policy forum_reports_resolve on public.forum_reports
  for update using (
    public.forum_is_staff()
    or (target_type = 'post' and exists (
          select 1 from public.forum_posts p
           where p.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
    or (target_type = 'comment' and exists (
          select 1 from public.forum_comments c
            join public.forum_posts p on p.id = c.post_id
           where c.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
  )
  with check (
    public.forum_is_staff()
    or (target_type = 'post' and exists (
          select 1 from public.forum_posts p
           where p.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
    or (target_type = 'comment' and exists (
          select 1 from public.forum_comments c
            join public.forum_posts p on p.id = c.post_id
           where c.id = forum_reports.target_id
             and public.forum_can_moderate_server(p.server_id)))
  );

-- Вложение: снимает своё — как раньше, чужое — модература ленты.
drop policy if exists forum_attachments_delete on public.forum_attachments;
create policy forum_attachments_delete on public.forum_attachments
  for delete using (
    author_id = auth.uid()
    -- Модерация сайта снимает любой тип вложения, включая скриншот гайда:
    -- у гайдов сервера нет, и без этой строки право модерации на них бы
    -- исчезло вместе с переписыванием политики.
    or public.forum_is_staff()
    or (target_type = 'post' and exists (
          select 1 from public.forum_posts p
           where p.id = forum_attachments.target_id
             and public.forum_can_moderate_server(p.server_id)))
    or (target_type = 'comment' and exists (
          select 1 from public.forum_comments c
            join public.forum_posts p on p.id = c.post_id
           where c.id = forum_attachments.target_id
             and public.forum_can_moderate_server(p.server_id)))
  );

/*
  Опрос закрывает его автор или модература ленты, где он стоит. Право вставки в
  опросы не тронуто: опрос создаёт автор темы вместе с темой, а тема уже прошла
  `forum_can_write_server`.
*/
drop policy if exists forum_polls_close on public.forum_polls;
create policy forum_polls_close on public.forum_polls
  for update using (
    exists (
      select 1 from public.forum_posts p
       where p.id = forum_polls.post_id
         and (p.author_id = auth.uid() or public.forum_can_moderate_server(p.server_id))
    )
  );

-- ── Шаг 9. Триггеры-охранники: закрепления и переезд темы ──────────────────

/*
  Копия определения из schema.sql с тремя изменениями, и все три по делу:

  1. Лимит закреплений считается ПО СЕРВЕРУ. Прежде счёт был общий на весь сайт,
     и три темы 33-го вытеснили бы из топа все остальные ленты — причём
     навсегда, потому что откреплять чужое никто не обязан.
  2. Право закреплять и снимать — модература этой ленты. Ветка ниже (та, что
     возвращает защищённые поля) теперь решается через
     `forum_can_moderate_server`, и вместе с ней серверный модератор получает те
     же свободы над материалом ленты, что и модерация сайта: отличает их
     территория, а не объём полномочия.
  3. `server_id` темы неподвижен для всех, кроме владельца сайта. Без этой
     строки модератор мог бы вытолкнуть неугодную тему в чужой дом, где его
     права кончаются, и формально остаться прав.
*/
create or replace function public.forum_posts_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.forum_is_admin() then
    new.server_id := old.server_id;
  end if;

  if public.forum_can_moderate_server(new.server_id) then
    if new.pinned and not old.pinned then
      if (select count(*) from public.forum_posts
          where pinned and not deleted and server_id = new.server_id and id <> new.id) >= 3 then
        raise exception 'В этом сервере закреплено уже три темы — сначала открепите одну'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  -- Закрепление темы — дело модературы ленты.
  new.pinned := old.pinned;
  -- Подменить автора или дату публикации нельзя: это перепись истории.
  new.author_id := old.author_id;
  new.author_nick := old.author_nick;
  new.created_at := old.created_at;
  /*
    Свой пост автор удаляет с пометкой «удалено автором» — и не может выдать
    её за решение модерации, приписав чужую причину. Обратно тоже нельзя:
    удалённый пост не возвращается, иначе модерацию можно было бы отменить.
  */
  if new.deleted and not old.deleted then
    new.deleted_reason := 'Удалено автором';
  elsif old.deleted then
    new.deleted := old.deleted;
    new.deleted_reason := old.deleted_reason;
  end if;

  return new;
end;
$$;

comment on function public.forum_posts_guard() is
  'Защищённые поля темы, лимит закреплений по серверу и запрет переводить тему между лентами без владельца сайта.';

/*
  Ответы: прежняя ветка `forum_is_staff()` стала территорией по той же причине,
  что и у тем. Без этой правки модератор сервера, который скрыл чужой ответ,
  получил бы в причине «Удалено автором» — триггер решил бы, что это автор.
*/
create or replace function public.forum_comments_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_server integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  select p.server_id into v_server from public.forum_posts p where p.id = new.post_id;

  if public.forum_can_moderate_server(v_server) then
    return new;
  end if;

  new.author_id := old.author_id;
  new.author_nick := old.author_nick;
  new.created_at := old.created_at;
  new.post_id := old.post_id;

  if new.deleted and not old.deleted then
    new.deleted_reason := 'Удалено автором';
  elsif old.deleted then
    new.deleted := old.deleted;
    new.deleted_reason := old.deleted_reason;
  end if;

  return new;
end;
$$;

-- ── Шаг 10. Дверь: кто выдаёт членство ──────────────────────────────────────

/*
  Два помощника нужны именно потому, что общий писатель журнала
  `forum_write_moderation_action()` молча пропускает всех, кто не модерация
  сайта (`if not public.forum_is_staff() then return`). Модератор сервера — не
  модерация сайта, и без этих двух функций его решения просто не попадали бы в
  журнал: «кто добавил человека в ленту» читалось бы как «никто».

  Право исполнения у них не открыто даже вошедшему (`revoke ... from
  authenticated`): вызываются они только из двери ниже, которая сама
  `security definer`.
*/
create or replace function public.forum_log_server_action(
  p_user_id uuid, p_nick text, p_action text, p_details jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_actor_nick text;
begin
  select nick into v_actor_nick from public.forum_users where id = auth.uid();

  insert into public.forum_moderation_actions
    (actor_id, actor_nick, target_type, target_id, target_nick, action, details)
  values
    (auth.uid(), coalesce(v_actor_nick, ''), 'user', p_user_id::text,
     coalesce(p_nick, ''), p_action, coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function public.forum_notify_server_membership(p_user_id uuid, p_text text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_nick text;
begin
  select nick into v_nick from public.forum_users where id = auth.uid();

  insert into public.forum_notifications (user_id, actor_id, actor_nick, kind, preview)
  values (p_user_id, auth.uid(), coalesce(v_nick, 'Модерация'), 'moderation', left(p_text, 120));
end;
$$;

/*
  Одна функция на три действия, как в тишине по разделу: роль — `member` или
  `moderator`, `p_role is null` — снять участие вовсе.

  Кто кому может:
   - модерация сайта — любому серверу любая роль; она и так может всё;
   - модератор сервера — участникам своего сервера; назначить или снять
     модератора он не вправе, иначе двое договорятся о передаче ленты между
     собой без чьего-либо контроля;
   - остальные — отказ, названный причиной.
*/
create or replace function public.forum_set_server_member(
  p_user_id   uuid,
  p_server_id integer,
  p_role      text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_title  text;
  v_open   boolean;
  v_user   public.forum_users%rowtype;
  v_old    text;
  v_nick   text;
  v_left   integer;
begin
  select s.title, s.open_writing into v_title, v_open
    from public.forum_servers s where s.id = p_server_id;

  if v_title is null then
    raise exception 'Сервер не найден';
  end if;

  select * into v_user from public.forum_users where id = p_user_id;

  if v_user.id is null then
    raise exception 'Игрок не найден';
  end if;

  if p_role is not null and p_role not in ('member', 'moderator') then
    raise exception 'В сервере бывают роли „участник“ и „модератор“';
  end if;

  select m.role into v_old
    from public.forum_server_members m
   where m.user_id = p_user_id and m.server_id = p_server_id;

  /*
    Право на шаг проверяется раньше остального: отказ «не туда лезешь» человек
    должен получать прежде, чем отказ «не того удаляешь», иначе функция
    выдавала бы устройство списка тому, кому он не предназначен.
  */
  if not public.forum_is_staff() then
    if p_role = 'moderator' then
      raise exception 'Модератора сервера назначает модерация сайта';
    end if;

    if not public.forum_is_server_moderator(p_server_id) then
      raise exception 'В свой сервер добавляет его модератор, в чужой — модерация сайта';
    end if;
  end if;

  /*
    Последнего модератора закрытой ленты снять нельзя. Не из вежливости: лента
    без своего модератора остаётся на попечении одного человека — владельца
    сайта, который не знает ни имён, ни обстоятельств этой команды. Назначают
    сначала другого, снимают потом.

    Открытому серверу это не нужно: там список — учёт, а не граница.
  */
  if v_old = 'moderator' and p_role is distinct from 'moderator' and not v_open then
    select count(*) into v_left
      from public.forum_server_members
     where server_id = p_server_id and role = 'moderator' and user_id <> p_user_id;

    if v_left = 0 then
      raise exception 'Это последний модератор сервера — сначала назначьте другого';
    end if;
  end if;

  if p_role is null then
    delete from public.forum_server_members
      where user_id = p_user_id and server_id = p_server_id;

    if v_old is null then
      return;
    end if;

    perform public.forum_log_server_action(
      p_user_id, v_user.nick, 'server_member_removed',
      jsonb_build_object('server_id', p_server_id, 'server_title', v_title, 'role', v_old)
    );

    /*
      Снятие участника с ОТКРЫТОГО сервера не отнимает у него слово: право там
      даёт открытость, а не строка. Молча это позволить значило бы дать
      модератору иллюзию наказания — поэтому в уведомлении сказано, что за
      снятием ничего не стоит.
    */
    perform public.forum_notify_server_membership(
      p_user_id, 'Ваше участие в сервере «' || v_title || '» снято'
      || case when v_open then ' (писать там всё равно можно: сервер открытый)' else '' end
    );
    return;
  end if;

  insert into public.forum_server_members (user_id, server_id, role, added_by)
  values (p_user_id, p_server_id, p_role, auth.uid())
  on conflict (user_id, server_id)
    do update set role = excluded.role, added_by = excluded.added_by;

  perform public.forum_log_server_action(
    p_user_id, v_user.nick,
    case when p_role = 'moderator' then 'server_moderator' else 'server_member' end,
    jsonb_build_object('server_id', p_server_id, 'server_title', v_title, 'was', v_old)
  );

  select nick into v_nick from public.forum_users where id = auth.uid();

  perform public.forum_notify_server_membership(
    p_user_id,
    case when p_role = 'moderator'
         then 'Вы модератор сервера «' || v_title || '»: лента, её закрепления и жалобы'
         else coalesce(v_nick, 'Модерация') || ' добавил вас в участники сервера «' || v_title || '»'
    end
  );
end;
$$;

comment on function public.forum_set_server_member(uuid, integer, text) is
  'Членство в сервере: участник, модератор или снятие (p_role is null). Модератора сервера назначает только модерация сайта.';

revoke all on function public.forum_log_server_action(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.forum_notify_server_membership(uuid, text) from public, anon, authenticated;
revoke all on function public.forum_set_server_member(uuid, integer, text) from public, anon;
grant execute on function public.forum_set_server_member(uuid, integer, text) to authenticated;

-- ── Шаг 11. Кэш схемы API ───────────────────────────────────────────────────

/*
  Ни одного представления этот шаг не пересоздаёт: `forum_post_list` шага 1 уже
  отдаёт `server_id`, а клиенту новых колонок не нужно — роль он спрашивает
  функцией `forum_my_server_roles()`, и отказывающая функция для него не
  страшна: отсутствие прав на сервер не имеет права ломать форум целиком.

  Кэш схемы обязан обновиться: новых функций ровно столько, сколько политик
  переписано, и PostgREST, знающий старый список, отвечал бы «function not
  found» там, где база уже всё умеет.
*/
notify pgrst, 'reload schema';
