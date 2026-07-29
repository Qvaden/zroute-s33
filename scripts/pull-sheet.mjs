/**
 * Выгружает Google Таблицу в data/live.json.
 *
 * ЗАЧЕМ. Сайт мог бы читать таблицу напрямую из браузера — так и было
 * сначала. Но тогда каждый посетитель обращается к docs.google.com, а Google
 * в России работает нестабильно: часть игроков увидела бы пустую страницу,
 * и хостинг тут ни при чём.
 *
 * Поэтому таблицу читает не браузер, а этот скрипт — по расписанию, на стороне
 * GitHub. Результат кладётся рядом с сайтом обычным файлом. Посетитель
 * обращается только к нашему домену, Google в цепочке не участвует вовсе.
 *
 * Для доверенного человека ничего не меняется: он правит ту же таблицу.
 * Разница только в задержке — данные доезжают за полчаса, а не сразу.
 *
 * Запуск:  node scripts/pull-sheet.mjs
 * Выход:   data/live.json, код возврата 0 если файл обновлён или не изменился
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CONFIG } from '../config.js';
import { validateDataset } from '../src/data/contract.js';
import * as sheets from '../src/data/adapters/sheets.js';

const OUT = 'data/live.json';

/** Дата → «2026-07-27». В JSON пишем строками, адаптер разберёт обратно. */
const iso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);

/** Убирает undefined, чтобы файл не пух и дифф оставался читаемым. */
const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));

console.log(`Читаю таблицу ${CONFIG.sheets.docId}`);

sheets.clearCache();
const [alliances, weeks, results, events, texts] = await Promise.all([
  sheets.getAlliances(),
  sheets.getWeeks(),
  sheets.getResults(),
  sheets.getEvents(),
  sheets.getTexts(),
]);

const problems = validateDataset({ alliances, weeks, results, events, texts });
if (problems.length) {
  console.error(`✕ В таблице ${problems.length} ошибок, выгрузка отменена:\n`);
  for (const p of problems.slice(0, 20)) console.error(`  • ${p}`);
  console.error('\nСтарые данные оставлены нетронутыми — сайт продолжает работать.');
  process.exit(1);
}

/*
  ЗАЩИТА ОТ ОБНУЛЕНИЯ.
  Если Google ответит частично или пустым CSV, валидация это пропустит:
  пустой набор формально корректен. Но записать его означает обнулить сайт.
  Поэтому сравниваем с тем, что уже лежит: резкое падение объёма —
  это почти наверняка сбой сети, а не решение человека удалить всё.
*/
let previous = null;
try {
  previous = JSON.parse(await readFile(OUT, 'utf8'));
} catch {
  console.log('Прошлой выгрузки нет — это первый запуск.');
}

if (previous) {
  const shrank = [
    ['альянсов', alliances.length, previous.alliances?.length ?? 0],
    ['недель', weeks.length, previous.weeks?.length ?? 0],
    ['результатов', results.length, previous.results?.length ?? 0],
  ].filter(([, now, before]) => before >= 4 && now < before * 0.5);

  if (shrank.length) {
    console.error('✕ Данных стало резко меньше — похоже на сбой чтения, не на правку:\n');
    for (const [what, now, before] of shrank) {
      console.error(`  • ${what}: было ${before}, стало ${now}`);
    }
    console.error(
      '\nВыгрузка отменена, старые данные сохранены.\n' +
        'Если вы действительно удалили половину таблицы — удалите data/live.json вручную.'
    );
    process.exit(1);
  }
}

const payload = {
  // Метка нужна, чтобы в истории гита было видно, когда данные обновлялись.
  pulledAt: new Date().toISOString(),
  source: `google-sheets:${CONFIG.sheets.docId}`,
  alliances: alliances.map((a) => clean({ ...a })),
  weeks: weeks.map((w) => clean({ ...w, startDate: iso(w.startDate), endDate: iso(w.endDate) })),
  results: results.map((r) => clean({ ...r })),
  events: events.map((e) => clean({ ...e, date: iso(e.date) })),
  texts,
};

const json = JSON.stringify(payload, null, 2) + '\n';

/*
  Сравниваем без метки времени: иначе коммит уходил бы каждые полчаса
  даже когда в таблице ничего не менялось, и история гита превратилась
  бы в мусор из тысяч пустых правок.
*/
const strip = (s) => s.replace(/^\s*"pulledAt":.*$/m, '');
if (previous && strip(JSON.stringify(previous, null, 2) + '\n') === strip(json)) {
  console.log('Данные не изменились — файл не трогаю.');
  process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile(OUT, json, 'utf8');

console.log(
  `✓ Обновлено: ${OUT}\n` +
    `  альянсов ${alliances.length}, недель ${weeks.length}, ` +
    `результатов ${results.length}, событий ${events.length}, текстов ${texts.length}`
);
