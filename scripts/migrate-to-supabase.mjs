/**
 * ПЕРЕНОС ИСТОРИИ ИЗ data/live.json В БАЗУ.
 *
 * Запускается один раз при переезде. Читает файл, который был единственным
 * хранилищем истории, и печатает SQL — его надо вставить в редактор Supabase.
 *
 * ПОЧЕМУ ПЕЧАТАЕТ SQL, А НЕ ПИШЕТ САМ.
 *
 * Записать напрямую можно было бы только служебным ключом, который даёт полный
 * доступ ко всей базе в обход всех правил. Значит его пришлось бы где-то
 * держать — в переменной окружения, в истории команд, в буфере обмена.
 * Ради одноразовой операции это плохая сделка: ключ живёт дольше, чем задача.
 *
 * Печать в файл оставляет решение человеку: он видит, что именно будет
 * выполнено, и выполняет это своими правами в редакторе.
 *
 * ЧТО ВАЖНО В САМОМ SQL. Вставка идёт с `on conflict do update`, поэтому
 * запуск повторно не ломается и не двоит записи — переезд можно проверить,
 * прогнать заново после правки и не бояться, что первая попытка что-то
 * испортила.
 *
 * Запуск:  node scripts/migrate-to-supabase.mjs [файл-данных] [файл-вывода]
 * Пример:  node scripts/migrate-to-supabase.mjs data/live.json dist/migrate.sql
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mapDataset } from '../src/data/adapters/_map.js';

const inFile = process.argv[2] || 'data/live.json';
const outFile = process.argv[3] || 'dist/migrate.sql';

const raw = JSON.parse(await readFile(inFile, 'utf8'));

/*
  Разбираем тем же кодом, что и сайт. Иначе перенос стал бы вторым читателем
  формата со своим пониманием: где-то строка вместо даты, где-то незамеченный
  пустой исход — и расхождение обнаружилось бы уже в базе, задним числом.
*/
const data = mapDataset(raw);

/** Строка в SQL. Одинарные кавычки удваиваются, иначе они закроют строку. */
function q(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Дата в YYYY-MM-DD. Время нам не нужно: недели и события живут днями. */
function d(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'null';
  return `'${date.toISOString().slice(0, 10)}'`;
}

function n(value) {
  return value == null || Number.isNaN(Number(value)) ? 'null' : String(Number(value));
}

/** Массив ссылок в литерал массива Postgres. */
function arr(list) {
  const clean = (list ?? []).filter(Boolean);
  if (!clean.length) return `'{}'`;
  return `array[${clean.map((s) => q(s)).join(', ')}]`;
}

const lines = [];
const say = (s = '') => lines.push(s);

say('-- ПЕРЕНОС ИСТОРИИ В БАЗУ.');
say('--');
say(`-- Собрано из ${inFile} скриптом scripts/migrate-to-supabase.mjs`);
say(`-- Дата сборки: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
say('--');
say('-- Запускать ПОСЛЕ supabase/schema.sql и supabase/site-data.sql.');
say('-- Можно выполнять повторно: записи не двоятся, а обновляются.');
say('--');
say(`-- В переносе: ${data.alliances.length} альянсов, ${data.weeks.length} недель,`);
say(`-- ${data.results.length} результатов, ${data.events.length} событий, ${data.texts.length} текстов.`);
say();
say('begin;');
say();

/*
  Порядок вставки задан связями: результаты ссылаются на недели и альянсы,
  слияния — на другие альянсы. Обратный порядок упёрся бы в проверку связей.
*/
say('-- ── Альянсы ────────────────────────────────────────────────────────────');
say('--');
say('-- mergedInto заполняется вторым проходом ниже: альянс может ссылаться');
say('-- на другой, которого в момент вставки ещё нет.');
say();
data.alliances.forEach((a, i) => {
  say(
    `insert into public.site_alliances (id, tag, name, color, active, note, sort_order) values (` +
      `${q(a.id)}, ${q(a.tag)}, ${q(a.name)}, ${q(a.color)}, ${a.active}, ${q(a.note)}, ${i}) ` +
      `on conflict (id) do update set tag = excluded.tag, name = excluded.name, ` +
      `color = excluded.color, active = excluded.active, note = excluded.note, ` +
      `sort_order = excluded.sort_order;`
  );
});

const merges = data.alliances.filter((a) => a.mergedInto);
if (merges.length) {
  say();
  say('-- Слияния: вторым проходом, когда все альянсы уже на месте.');
  merges.forEach((a) => {
    say(`update public.site_alliances set merged_into = ${q(a.mergedInto)} where id = ${q(a.id)};`);
  });
}

say();
say('-- ── Недели ─────────────────────────────────────────────────────────────');
say();
data.weeks.forEach((w) => {
  say(
    `insert into public.site_weeks (id, number, start_date, end_date, note) values (` +
      `${q(w.id)}, ${n(w.number)}, ${d(w.startDate)}, ${d(w.endDate)}, ${q(w.note)}) ` +
      `on conflict (id) do update set number = excluded.number, ` +
      `start_date = excluded.start_date, end_date = excluded.end_date, note = excluded.note;`
  );
});

say();
say('-- ── Результаты ─────────────────────────────────────────────────────────');
say();
data.results.forEach((r) => {
  say(
    `insert into public.site_results (week_id, alliance_id, outcome, opponent, comment) values (` +
      `${q(r.weekId)}, ${q(r.allianceId)}, ${q(r.outcome)}, ${q(r.opponent)}, ${q(r.comment)}) ` +
      `on conflict (week_id, alliance_id) do update set outcome = excluded.outcome, ` +
      `opponent = excluded.opponent, comment = excluded.comment;`
  );
});

say();
say('-- ── Хронология ─────────────────────────────────────────────────────────');
say('--');
say('-- В JSON ссылка на фото лежала то одиночным полем imageUrl, то массивом');
say('-- imageUrls. В базе всегда массив: два способа хранить одно и то же —');
say('-- это два места, где можно забыть проверить второй.');
say();
data.events.forEach((e) => {
  const urls = Array.isArray(e.imageUrls) ? e.imageUrls : (e.imageUrl ? [e.imageUrl] : []);
  say(
    `insert into public.site_events (id, event_date, type, server_number, title, summary, body, image_urls, duration_days) values (` +
      `${q(e.id)}, ${d(e.date)}, ${q(e.type)}, ${n(e.serverNumber)}, ${q(e.title)}, ` +
      `${q(e.summary)}, ${q(e.body)}, ${arr(urls)}, ${n(e.durationDays)}) ` +
      `on conflict (id) do update set event_date = excluded.event_date, type = excluded.type, ` +
      `server_number = excluded.server_number, title = excluded.title, summary = excluded.summary, ` +
      `body = excluded.body, image_urls = excluded.image_urls, duration_days = excluded.duration_days;`
  );
});

say();
say('-- ── Тексты ─────────────────────────────────────────────────────────────');
say();
data.texts.forEach((t) => {
  say(
    `insert into public.site_texts (key, title, body) values (` +
      `${q(t.key)}, ${q(t.title)}, ${q(t.body)}) ` +
      `on conflict (key) do update set title = excluded.title, body = excluded.body;`
  );
});

say();
say('commit;');
say();
say('-- ── Проверить, что перенеслось ─────────────────────────────────────────');
say('--');
say('-- Числа должны совпасть с теми, что указаны в начале файла.');
say();
say('-- select');
say(`--   (select count(*) from public.site_alliances) as alliances,`);
say(`--   (select count(*) from public.site_weeks) as weeks,`);
say(`--   (select count(*) from public.site_results) as results,`);
say(`--   (select count(*) from public.site_events) as events,`);
say(`--   (select count(*) from public.site_texts) as texts;`);

const sql = lines.join('\n') + '\n';
await mkdir('dist', { recursive: true });
await writeFile(outFile, sql, 'utf8');

console.log(`Готово: ${outFile} (${(sql.length / 1024).toFixed(0)} КБ)`);
console.log(
  `Перенос: ${data.alliances.length} альянсов, ${data.weeks.length} недель, ` +
    `${data.results.length} результатов, ${data.events.length} событий, ${data.texts.length} текстов.`
);
console.log('\nДальше: открыть файл, скопировать целиком, вставить в SQL Editor и нажать Run.');
