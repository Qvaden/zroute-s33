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
  console.log(`✕ Ошибки в структуре: ${problems.length}\n`);
  for (const p of problems.slice(0, 40)) console.log(`  • ${p}`);
  if (problems.length > 40) console.log(`  … и ещё ${problems.length - 40}`);
  console.log('');
  process.exit(1);
}

console.log('✓ Структура в порядке, ошибок нет.\n');

/*
  Структура и готовность — разные вещи, и путать их нельзя.
  Пустая таблица формально безупречна: ни одной ошибки, все колонки на месте.
  Но переключить на неё сайт означает показать людям нули.
  Поэтому дальше отдельная проверка: есть ли чем наполнять страницы.
*/
const blockers = [];
const warnings = [];

if (data.alliances.length === 0) {
  blockers.push('Ни одного альянса. Заполните tag и name во вкладке alliances — строки с пустыми названиями сайт игнорирует.');
} else if (data.alliances.length < 4) {
  warnings.push(`Альянсов всего ${data.alliances.length}. Рейтинг будет выглядеть скудно.`);
}

if (data.weeks.length === 0) {
  blockers.push('Ни одной недели во вкладке weeks.');
}

/*
  Отсутствие результатов больше не блокирует переключение: сайт умеет
  показывать состояние «отсчёт начинается» — с составом на старте и
  объяснением правил, вместо пустых клеток. Но предупредить надо.
*/
if (data.results.length === 0) {
  warnings.push('Ни одного результата. Сайт покажет экран «отсчёт начинается» вместо итогов недели.');
} else if (data.results.length < data.alliances.length) {
  warnings.push(
    `Результатов ${data.results.length} — меньше одной полной недели. ` +
      'Сравнение в разделе для малых альянсов пока не покажется.'
  );
}

if (data.texts.length === 0) {
  warnings.push('Нет текстов — раздел для малых альянсов будет пустым.');
}
if (data.events.length === 0) {
  warnings.push('Нет событий — хронология покажет, что летопись ещё не начата.');
}

// Заполненность матрицы: сколько ячеек внесено из возможных.
const expected = data.alliances.filter((a) => a.active).length * data.weeks.length;
if (expected && data.results.length) {
  const pct = Math.round((data.results.length / expected) * 100);
  console.log(`Заполненность матрицы: ${data.results.length} из ${expected} (${pct}%)`);
  console.log(
    pct < 100
      ? '  Незаполненные ячейки — это нормально: значит результат ещё не внесли.\n'
      : ''
  );
}

// Если рейтинг считается — данные живые, и это видно глазами.
if (data.weeks.length && data.alliances.length && data.results.length) {
  const table = computeStandings(
    data.alliances, data.weeks, data.results, CONFIG.scoring, CONFIG.formLength
  );
  console.log('Верх таблицы по этим данным:');
  for (const r of table.slice(0, 5)) {
    const pts = `${r.points > 0 ? '+' : ''}${r.points}`;
    console.log(
      `  ${String(r.place).padStart(2)}. ${r.alliance.tag.padEnd(5)} ` +
        `${r.alliance.name.padEnd(18)} ${pts.padStart(4)}  (${r.wins}-${r.losses})`
    );
  }
  console.log('');
}

for (const w of warnings) console.log(`⚠ ${w}`);
if (warnings.length) console.log('');

if (blockers.length) {
  console.log('✕ Переключать пока рано:\n');
  for (const b of blockers) console.log(`  • ${b}`);
  console.log('\nСтруктура готова, не хватает только данных.');
  process.exit(1);
}

console.log("✓ Готово к переключению: в config.js поставьте dataSource: 'sheets'.");
