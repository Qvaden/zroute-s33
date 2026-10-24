-- ПРОМОКОДЫ, ДОБАВЛЕННЫЕ РУКАМИ.
--
-- Запускать в SQL-редакторе Supabase один раз, до публикации кода панели.
-- Файл лежит в очереди (`supabase/`), а не в `applied/`: на боевой базе он
-- ещё не выполнен.
--
-- ЗАЧЕМ ЭТО ОТДЕЛЬНАЯ ТАБЛИЦА. Автоматические коды приезжают из открытых
-- страниц раз в сутки и лежат в promocodes.json. Они не знают того, что видит
-- владелец: сработал ли код у игроков 33 сервера, закончился ли он раньше
-- срока, есть ли личный код события. Такие записи нельзя перезаписывать
-- ночным обходом, иначе ручная правка исчезала бы к утру.
--
-- КАК СКЛАДЫВАЮТСЯ ДВА СПИСКА. Страница читает файл и эту таблицу, при
-- совпадении кода побеждает таблица. Так ручная отметка «не работает»
-- сильнее чужого «активен», а новый код, которого нет в файле, всё равно
-- появляется на странице.
--
-- КТО ПИШЕТ. Владелец и модераторы сайта — та же проверка `site_can_edit()`,
-- что у остальных данных сайта. Она же отказывает забаненному. Читать может
-- кто угодно, включая гостя: промокоды — открытая часть сайта.

create table if not exists public.site_promo_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  status      text not null default 'active' check (status in ('active', 'inactive')),
  rewards     text,
  -- Дата появления кода. У источника она есть не всегда, поэтому её можно
  -- назвать руками; пустая означает «дата неизвестна», а не «сегодня».
  added_on    date not null default current_date,
  created_by  uuid default auth.uid() references public.forum_users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

/*
  Один код — одна строка. Сравниваем без учёта регистра: «zrr999» и «ZRR999»
  для игрока один и тот же код, и две карточки на странице читались бы как
  два разных подарка.
*/
create unique index if not exists site_promo_codes_code_key
  on public.site_promo_codes (upper(code));

create index if not exists site_promo_codes_status_idx
  on public.site_promo_codes (status, code);

alter table public.site_promo_codes enable row level security;

drop policy if exists site_promo_codes_read on public.site_promo_codes;
create policy site_promo_codes_read on public.site_promo_codes
  for select using (true);

drop policy if exists site_promo_codes_insert on public.site_promo_codes;
create policy site_promo_codes_insert on public.site_promo_codes
  for insert with check (public.site_can_edit());

drop policy if exists site_promo_codes_update on public.site_promo_codes;
create policy site_promo_codes_update on public.site_promo_codes
  for update using (public.site_can_edit()) with check (public.site_can_edit());

drop policy if exists site_promo_codes_delete on public.site_promo_codes;
create policy site_promo_codes_delete on public.site_promo_codes
  for delete using (public.site_can_edit());

/*
  Отметка правки ставится сама. Функция `site_touch()` заведена вместе с
  остальными данными сайта (`applied/site-data.sql`), поэтому новый файл
  выполняется после неё — на боевой базе она уже есть.
*/
drop trigger if exists site_promo_codes_touch on public.site_promo_codes;
create trigger site_promo_codes_touch
  before update on public.site_promo_codes
  for each row execute function public.site_touch();

comment on table public.site_promo_codes is
  'Промокоды, добавленные владельцем или модератором вручную; важнее автоматического списка.';
comment on column public.site_promo_codes.added_on is
  'Дата появления кода; current_date при добавлении, если дата неизвестна.';
