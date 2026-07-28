/**
 * Проверяет живую Google Таблицу перед переключением сайта на неё.
 *
 * Читает документ тем же адаптером, что и сайт, прогоняет через тот же
 * валидатор и показывает, что получилось. Смысл — увидеть проблемы в данных
 * до того, как их увидят люди: пустой сайт без ошибок в консоли отлаживать
 * гораздо неприятнее, чем прочитать список замечаний здесь.
 *
 * Запуск:  node scripts/check-sheet.mjs <ID документа>
 *          node scripts/check-sheet.mjs            (возьмёт docId из config.js)
 */
import { CONFIG } from '../config.js';
import { loadAndValidate } from '../src/data/contract.js';
import { computeStandings } from '../src/logic/standings.js';
import * as sheets from '../src/data/adapters/sheets.js';

const docId = process.argv[2] || CONFIG.sheets.docId;

if (!docId) {
  console.error(
    'Не указан ID документа.\n' +
      'Возьмите его из адреса: docs.google.com/spreadsheets/d/<ВОТ ЭТО>/edit\n' +
      'Запуск: node scripts/check-sheet.mjs <ID>'
  );
  process.exit(2);
}

CONFIG.sheets.docId = docId;
sheets.clearCache();

console.log(`Читаю документ ${docId}\n`);

let data;
let problems;
try {
  ({ data, problems } = await loadAndValidate(sheets));
} catch (err) {
  console.error(`✕ Не удалось прочитать таблицу.\n  ${err.message}\n`);
  console.error(
    'Частые причины:\n' +
      '  • документ не открыт на просмотр по ссылке\n' +
      '    (Доступ → Все, у кого есть ссылка → Читатель)\n' +
      `  • вкладка названа иначе, чем ожидается: ${Object.values(CONFIG.sheets.tabs).join(', ')}\n` +
      '  • ID документа скопирован не полностью'
  );
  process.exit(1);
}

console.log('Что прочитано:');
console.log(`  альянсов:    ${data.alliances.length}`);
console.log(`  недель:      ${data.weeks.length}`);
console.log(`  результатов: ${data.results.length}`);
console.log(`  событий:     ${data.events.length}`);
console.log(`  текстов:     ${data.texts.length}\n`);

if (problems.length) {
  console.log(`✕ Замечаний: ${problems.length}\n`);
  for (const p of problems.slice(0, 40)) console.log(`  • ${p}`);
  if (problems.length > 40) console.log(`  … и ещё ${problems.length - 40}`);
  console.log('');
  process.exit(1);
}

console.log('✓ Замечаний нет, структура в порядке.\n');

// Заполненность матрицы: сколько ячеек внесено из возможных.
const expected = data.alliances.filter((a) => a.active).length * data.weeks.length;
if (expected) {
  const pct = Math.round((data.results.length / expected) * 100);
  console.log(`Заполненность матрицы: ${data.results.length} из ${expected} (${pct}%)`);
  if (pct < 100) console.log('  Незаполненные ячейки — это нормально: значит результат ещё не внесли.\n');
  else console.log('');
}

// Небольшая проверка «на глаз»: если рейтинг считается, данные живые.
if (data.weeks.length && data.alliances.length) {
  const table = computeStandings(
    data.alliances, data.weeks, data.results, CONFIG.scoring, CONFIG.formLength
  );
  console.log('Верх таблицы по этим данным:');
  for (const r of table.slice(0, 5)) {
    const pts = `${r.points > 0 ? '+' : ''}${r.points}`;
    console.log(`  ${String(r.place).padStart(2)}. ${r.alliance.tag.padEnd(5)} ${r.alliance.name.padEnd(18)} ${pts.padStart(4)}  (${r.wins}-${r.losses})`);
  }
  console.log('');
}

console.log('Можно переключать: в config.js поставьте dataSource: \'sheets\' и docId.');
