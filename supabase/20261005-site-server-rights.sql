-- МУЛЬТИАРЕНДА ДАННЫХ САЙТА, ШАГ 3: право вносить данные по серверу.
--
-- ЗАЧЕМ.
--   Шаг 1 (`20261004-site-server-scope.sql`) дал данным сайта сервер, шаг 2
--   позволил зрителю выбрать его глазами. Право писать при этом осталось
--   одноклассным: политики пяти таблиц смотрят на `site_can_edit()`, то есть на
--   роль в `forum_users`, и о сервере не знают ничего. Модератор 44-го сегодня
--   равняет чужую неделю на 33-м, заводит альянсы в чужой список и правит чужие
--   тексты. Пока второму серверу некем править, это безразлично; с первым же
--   приглашённым человеком оно становится дырой, и закрывать её надо до того,
--   как в панель придут не-владельцы.
--
-- ЧТО ЗДЕСЬ ДЕЛАЕТСЯ.
--   1. `site_can_edit_server(p_server)` — право править ДАННЫЕ ОДНОГО сервера.
--   2. Политики вставки, правки и удаления пяти `site_*`-таблиц смотрят на
--      `server_id` строки, а не на человека вообще.
--   3. Отказ назван причиной, а не «violates row-level security policy» —
--      охранник перед записью, тот же порядок, что у форума.
--   4. У журнала правок появляется сервер: редактор видит свои правки, модерация
--      сайта — все.
--   5. Фотографии летописи кладутся в папку своего сервера, и серверный редактор
--      вправе приложить своё.
--   6. Срез позиций рейтинга (`forum_record_alliance_rank_snapshot`) больше не
--      требует модерации сайта: он требует права на сервер каждого альянса из
--      присланного списка.
--
-- ПРАВО ДАЁТ ОДНА СУЩНОСТЬ, ВТОРАЯ НЕ НУЖНА.
--   Модератор сервера — это строка `role = 'moderator'` в `forum_server_members`,
--   тот же список, что решает, кто распоряжается лентой этого сервера. Отдельного
--   признака «редактор данных сайта по серверу» нет намеренно. Во-первых, проект
--   уже сократил пять ролей до трёх именно по этой причине: каждая лишняя
--   сущность — это то, что надо помнить, объяснять и выдавать отдельно
--   (см. шапку `site-data.sql` про исчезнувшего «редактора»). Во-вторых,
--   доверяя человеку ленту своего сервера — закреплять, скрывать, разбирать
--   жалобы его игроков, — странно не доверять ему неделю его же сервера: это
--   один и тот же круг доверия, и два разных списка для него означали бы, что
--   модератор сервера половинчатый.
--
--   Открытость сервера (`open_writing`) на данные сайта НЕ распространяется. В
--   ленту открытого сервера пишет любой вошедший — это публичная площадь. Итоги
--   VS, альянсы и хронология — история сервера, и «любой» здесь означал бы, что
--   каждый зарегистрированный может переписать чужой сезон.
--
-- ПОРЯДОК ПРОТИВ ОПЕЧАТКИ.
--   Первой проверяется модерация сайта, её ветка ничего не меняет: у владельца и
--   у модератора сайта права ровно те же, что до этого файла, и прогон миграции не
--   отнимает слово ни у кого, кто правит сайт с первого дня. Новый круг — только
--   те, кто получил роль модератора сервера, а её пока выдают одной дверью
--   (`forum_set_server_member`), и заведенных таких людей нет. Поэтому файл можно
--   гнать когда угодно: до пуша он не меняет поведение живого сайта ни на строку.
--
--   Всё же порядок — сначала база, потом код. Новая панель выдаёт человеку
--   серверы, которые он вправе править, и обещает это в шапке; со старой базой
--   каждое её обещание кончалось бы отказом политики.

-- ── 1. Право на сервер ──────────────────────────────────────────────────────

/*
  `security definer` по той же причине, что и форумные функции права: читают это
  политики, а самим политикам смотреть в `forum_server_members` целиком нельзя —
  там чужие списки.

  Вторая ветка не переписывает правило членства, а берёт его у
  `forum_is_server_moderator()` и добавляет одно условие: забаненному нельзя
  ничего, даже свой сервер. Это тот же смысл, что в `site_can_edit()`, где бан
  перекрывает роль модератора сайта. Профиль, которого нет (пустой `auth.uid()`),
  права не даёт: `coalesce(..., true)` считает его запретом, а не разрешением, —
  так из этого же файла могут спокойно вызывать его триггеры и функции, работающие
  без токена.
*/
create or replace function public.site_can_edit_server(p_server integer)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.site_can_edit()                                  -- модерация сайта правит все серверы
     or (
       p_server is not null
       and public.forum_is_server_moderator(p_server)             -- модератор этого сервера
       and not coalesce((select u.banned from public.forum_users u
                          where u.id = auth.uid()), true)         -- забаненному — ничего
     );
$$;

comment on function public.site_can_edit_server(integer) is
  'Можно ли вошедшему править данные этого сервера: модерация сайта или модератор сервера, и не забаненный.';

/*
  Право исполнения остаётся у гостей: политики записи вычисляются для любой
  роли, а `anon` по умолчанию имеет доступ к таблицам сайта — со снятым правом у
  функции гость получил бы «permission denied for function» вместо штатного
  отказа политики. Ответ для него всегда false: и `site_can_edit()`, и
  `forum_is_server_moderator()` требуют токена.
*/
revoke all on function public.site_can_edit_server(integer) from public;
grant execute on function public.site_can_edit_server(integer) to anon, authenticated;

-- ── 2. Отказ по-русски ──────────────────────────────────────────────────────

/*
  Проверку держит политика, слова — триггер перед записью (тот же порядок, что у
  `forum_server_write_guard` в шаге прав форума). Без этого браузер перевёл бы
  отказ как «violates row-level security policy», и человек прочитал бы про
  поломку базы вместо «этот сервер правит другой».

  Пустой `auth.uid()` — миграция, definer-функция от имени владельца или прямая
  строка из SQL Editor: им граница не мешает, и проверка прав здесь была бы
  отказом владельцу в его же базе.
*/
create or replace function public.site_server_write_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_server integer;
begin
  if TG_OP = 'DELETE' then
    v_server := old.server_id;
  else
    v_server := new.server_id;
  end if;

  /*
    Пустой auth.uid() — миграция, definer-функция от имени владельца или прямая
    строка из SQL Editor: им граница не мешает, и проверка прав здесь была бы
    отказом владельцу в его же базе.
  */
  if auth.uid() is null or public.site_can_edit_server(v_server) then
    if TG_OP = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  /*
    Две причины и два сообщения, как у форума: «вас нет в модераторах сервера» и
    «ваш аккаунт под запретом» — разные вещи, и на вторую человеку посоветовать
    просить добавление было бы неверно.
  */
  if exists (select 1 from public.forum_users where id = auth.uid() and banned) then
    raise exception 'Ваш аккаунт под запретом — данные сайта править нельзя';
  end if;

  raise exception
    'Править данные сервера % может только его модератор: попросите добавить вас в модераторы этого сервера.',
    v_server;
end;
$$;

comment on function public.site_server_write_guard() is
  'Отказ серверному не-модератору и забаненному при записи данных сайта; слова отказа, а не текст политики.';

do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop trigger if exists %1$s_server_rights on public.%1$s', t);
    execute format(
      'create trigger %1$s_server_rights before insert or update or delete on public.%1$s
         for each row execute function public.site_server_write_guard()', t
    );
  end loop;
end $$;

-- ── 3. Политики: право по строке, а не по человеку ─────────────────────────

/*
  Три вида записи на пяти таблицах — и все они уже были циклом в `site-data.sql`,
  поэтому цикл остаётся: пять почти одинаковых блоков руками — это пять мест, где
  можно ошибиться, и одно из них потом окажется без защиты.

  `using` правки и удаления смотрит на СТАРУЮ строку, `with check` — на НОВУЮ.
  Именно поэтому перенос записи между серверами не проходит и политикой, и
  триггером неподвижности шага 1: править чужое нельзя, а «переезд» был бы
  правкой чужого с проверкой по своему.

  Удаление альянса по-прежнему называет только id — идентификатор альянса глобален
  специально (см. шапку шага 1), и строка у такого запроса одна. Сервер этой строки
  проверяет политика, а не фильтр панели.
*/
do $$
declare
  t text;
begin
  foreach t in array array['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts']
  loop
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format(
      'create policy %1$s_write on public.%1$s for insert with check (public.site_can_edit_server(server_id))', t
    );

    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update using (public.site_can_edit_server(server_id)) with check (public.site_can_edit_server(server_id))', t
    );

    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete using (public.site_can_edit_server(server_id))', t
    );
  end loop;
end $$;

-- ── 4. Журнал правок: у каждой записи свой сервер ───────────────────────────

/*
  Шаг 1 оставил журнал общим намеренно: экрана, которому нужен сервер, ещё не
  было. Теперь такой экран есть — панель открывает журнал, и модератор 44-го
  обязан видеть в нём свои правки, а не чужой список и не пустоту.

  Колонка допускает NULL: строки журнала бывают и о не-данных сайта (назначение
  ролей), а старые записи до этого файла сервера не называли. NULL читается как
  «не относится к серверу», и виден такой ряд только модерации сайта.

  Индекс — под тот же порядок, которым журнал читают: свежие справа, фильтр по
  серверу слева.
*/
alter table public.site_audit add column if not exists server_id integer;

update public.site_audit
   set server_id = (details ->> 'server_id')::integer
 where server_id is null
   and entity in ('site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts')
   and details ->> 'server_id' ~ '^[0-9]+$';

alter table public.site_audit drop constraint if exists site_audit_server_id_fkey;
alter table public.site_audit add constraint site_audit_server_id_fkey
  foreign key (server_id) references public.forum_servers (id);

create index if not exists site_audit_server_idx on public.site_audit (server_id, at desc);

drop policy if exists site_audit_read on public.site_audit;
create policy site_audit_read on public.site_audit
  for select using (
    public.site_can_edit()
    or (server_id is not null and public.site_can_edit_server(server_id))
  );

/*
  Заполняет колонку тот же триггер, что и раньше, — панель по-прежнему не может
  «забыть» записать правку. Определение совпадает с `site-data.sql` плюс одна
  строка; охранник шага 1 и триггеры неподвижности остаются как есть.

  Приведение guarded (`~ '^[0-9]+$'`), а не прямое: триггер висит на пяти таблицах,
  где `server_id` NOT NULL число, но падение журнала из-за будущего стола, к
  которому прикрепят эту же функцию, стоило бы дороже одной строки.
*/
create or replace function public.site_write_audit()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  who text;
  ident text;
  row_data jsonb;
begin
  select nick into who from public.forum_users where id = auth.uid();

  row_data := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  ident := coalesce(
    case TG_TABLE_NAME
      -- У составного ключа результатов нет одного id: собираем читаемый.
      when 'site_results' then (row_data ->> 'week_id') || '/' || (row_data ->> 'alliance_id')
      when 'site_texts'   then row_data ->> 'key'
      else row_data ->> 'id'
    end,
    ''
  );

  insert into public.site_audit
    (actor_id, actor_nick, entity, entity_id, action, details, server_id)
  values (
    auth.uid(),
    coalesce(who, 'из SQL-редактора'),
    TG_TABLE_NAME,
    ident,
    lower(TG_OP),
    row_data,
    case when row_data ->> 'server_id' ~ '^[0-9]+$'
         then (row_data ->> 'server_id')::integer end
  );

  return coalesce(new, old);
end;
$$;

-- ── 5. Фотографии летописи: папка сервера ───────────────────────────────────

/*
  Панель кладёт картинку в ведро `site-photos`, и политика ведра о сервере не
  знала: без правки этого шага модератор 44-го не смог бы приложить фотографию к
  событию своего же сервера — то есть право на половину экрана пропало бы молча.

  Номер сервера берётся из первой части пути (`44/events/…`), поэтому панель
  обязана называть его в пути — это вторая сторона того же правила, и тест сверяет
  число здесь с числом в `src/admin/image.js`.

  Разбор безопасный: у старых файлов папки сервера нет (`events/…`), функция
  отвечает NULL, и политика оставляет такие ряды за модерацией сайта. Ошибочный
  путь не должен превращаться в исключение приведения внутри политики.
*/
create or replace function public.site_photo_server(p_name text)
returns integer
language sql immutable set search_path = public
as $$
  select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9]+$'
              then split_part(p_name, '/', 1)::integer
              else null end;
$$;

comment on function public.site_photo_server(text) is
  'Номер сервера из пути фотографии летописи («44/events/x.jpg» → 44); NULL — у файла без серверной папки.';

drop policy if exists site_photos_write on storage.objects;
create policy site_photos_write on storage.objects
  for insert with check (
    bucket_id = 'site-photos'
    and (
      public.site_can_edit()
      or (public.site_photo_server(name) is not null
          and public.site_can_edit_server(public.site_photo_server(name)))
    )
  );

drop policy if exists site_photos_delete on storage.objects;
create policy site_photos_delete on storage.objects
  for delete using (
    bucket_id = 'site-photos'
    and (
      public.site_can_edit()
      or (public.site_photo_server(name) is not null
          and public.site_can_edit_server(public.site_photo_server(name)))
    )
  );

-- ── 6. Срез позиций рейтинга: право на сервер альянса ──────────────────────

/*
  Функция требует модерации сайта целиком, хотя строки, которые она пишет,
  относятся к альянсам — а у альянса сервер есть (шаг 1). Для серверного редактора
  это значило бы: результаты опубликованы, подписчики его сервера о сдвиге мест не
  узнают никогда, и молчание ничем не объясняется.

  Проверка идёт по каждому альянсу, а не по «первому попавшемуся»: идентификатор
  альянса глобален, и без неё модератор 44-го сдвинул бы снимок 33-го — и разослал
  бы уведомление чужим подписчикам.

  Определение совпадает с `20260916-forum-community.sql` плюс блок права; остальное
  — ровно прежние строки, включая `on conflict`.
*/
create or replace function public.forum_record_alliance_rank_snapshot(p_rows jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  item jsonb;
  old_place integer;
  aid text;
  new_place integer;
  pts integer;
  aname text;
  a_server integer;
begin
  for item in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    aid := item->>'alliance_id';
    new_place := (item->>'place')::integer;
    pts := coalesce((item->>'points')::integer, 0);

    if not public.site_can_edit() then
      select server_id into a_server from public.site_alliances where id = aid;
      if not public.site_can_edit_server(a_server) then
        raise exception
          'Альянс «%» относится к серверу %, который вы не правите.',
          aid, coalesce(a_server::text, 'нет в справочнике');
      end if;
    end if;

    select place into old_place from public.forum_alliance_rank_snapshots where alliance_id = aid;
    select tag into aname from public.site_alliances where id = aid;
    if old_place is not null and old_place <> new_place then
      insert into public.forum_alliance_rank_changes (alliance_id, old_place, new_place)
        values (aid, old_place, new_place);
      insert into public.forum_notifications (user_id, actor_nick, kind, preview)
      select user_id, 'Рейтинг', 'alliance_rank',
        coalesce(aname, aid) || ': ' || old_place || ' → ' || new_place || ' место'
        from public.forum_alliance_subscriptions where alliance_id = aid;
    end if;
    insert into public.forum_alliance_rank_snapshots (alliance_id, place, points, updated_at)
      values (aid, new_place, pts, now())
      on conflict (alliance_id) do update
        set place = excluded.place, points = excluded.points, updated_at = excluded.updated_at;
  end loop;
end;
$$;

-- ── 7. Как проверить прогон и как выдать право ──────────────────────────────

/*
  Чтение — ничего не меняет, повторный прогон идемпотентен:

    select id, tag, server_id from public.site_alliances order by server_id, id;
    select count(*) filter (where server_id = 33) as s33,
           count(*) filter (where server_id is null) as no_server
      from public.site_audit;

  Право отвечает та же карта, что и форумная лента (`forum_my_server_roles()`), —
  панель спрашивает её одним запросом и не вводит второго источника прав. Дверь
  выдачи пока одна, экран выдачи — отдельный шаг:

    -- сделать игрока модератором сервера 44 (право только у модерации сайта)
    select public.forum_set_server_member(
      (select id from public.forum_users where nick = 'НикИгрока'), 44, 'moderator');

    -- проверить, что сервер видит его как модератора
    select public.site_can_edit_server(44);   -- из-под его входа: true

  И отказ, который обязан прийти чужому редактору:

    update public.site_weeks set note = 'проверка' where server_id = 44 and id = 'W1';

  Со стороны модератора 33-го эта строка должна кончиться текстом
  «Править данные сервера 44 может только его модератор…», а не «нарушением
  политики».
*/

-- Кэш схемы API: добавлены три функции и колонка, и со старым кэшем панель
-- услышала бы «column site_audit.server_id does not exist» там, где база уже
-- всё умеет.
notify pgrst, 'reload schema';
