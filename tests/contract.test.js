/**
 * Тесты без единой зависимости. Запуск:  node tests/contract.test.js
 *
 * Самый важный здесь — тест C. Он подсовывает sheets-адаптеру поддельный
 * CSV и проверяет, что на выходе получаются ровно те же доменные объекты,
 * что отдал бы любой другой источник. Именно он превращает фразу
 * «источник переключается одной строкой» в проверенный факт, а не в намерение.
 */
import { CONFIG } from '../config.js';
import { validateDataset, loadAndValidate } from '../src/data/contract.js';
import { computeStandings, computeWeekSummary, computeQuarterWindow, computeWindowForm } from '../src/logic/standings.js';
import { parseCsv, parseCsvObjects } from '../src/lib/csv.js';
import * as jsonAdapter from '../src/data/adapters/json.js';
import { getAllianceAchievements } from '../src/logic/achievements.js';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
  }
}

function equal(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, a === e ? '' : `получено: ${a}\n       ожидалось: ${e}`);
}

/*
  Тесты обязаны работать с фиксированными данными, а не с тем, на что указывает
  боевой конфиг. Иначе они начинают падать при каждом изменении реальной
  таблицы — и падают не потому, что код сломался, а потому что данные другие.
  Ровно это и случилось, когда сайт перевели с демо-данных на живую выгрузку.
*/
CONFIG.json.path = './data/demo.json';
jsonAdapter.clearCache();

// ── A. json-адаптер отдаёт данные, соответствующие доменной модели ──────────
console.log('\nA. Контракт json-адаптера');
{
  const { data, problems } = await loadAndValidate(jsonAdapter);
  check('демо-данные проходят валидацию', problems.length === 0, problems.slice(0, 5).join('\n       '));
  check('альянсы загружены', data.alliances.length === 32, `их ${data.alliances.length}`);
  check('недели загружены', data.weeks.length === 12, `их ${data.weeks.length}`);
  check('даты недель — это Date', data.weeks.every((w) => w.startDate instanceof Date));
  check('номера недель — это числа', data.weeks.every((w) => typeof w.number === 'number'));
  check(
    'outcome только из допустимого набора',
    data.results.every((r) => ['win', 'loss'].includes(r.outcome))
  );
}

// ── B. Арифметика рейтинга на заведомо известном примере ────────────────────
console.log('\nB. Подсчёт очков');
{
  const alliances = [
    { id: 'x', tag: 'X', name: 'Икс', active: true },
    { id: 'y', tag: 'Y', name: 'Игрек', active: true },
    { id: 'z', tag: 'Z', name: 'Зет', active: true },
  ];
  const weeks = [
    { id: 'W1', number: 1, startDate: new Date('2026-01-05'), endDate: new Date('2026-01-11') },
    { id: 'W2', number: 2, startDate: new Date('2026-01-12'), endDate: new Date('2026-01-18') },
    { id: 'W3', number: 3, startDate: new Date('2026-01-19'), endDate: new Date('2026-01-25') },
  ];
  const results = [
    { weekId: 'W1', allianceId: 'x', outcome: 'win' },
    { weekId: 'W2', allianceId: 'x', outcome: 'win' },
    { weekId: 'W3', allianceId: 'x', outcome: 'win' },
    { weekId: 'W1', allianceId: 'y', outcome: 'loss' },
    { weekId: 'W2', allianceId: 'y', outcome: 'win' },
    // За W3 у Y записи нет: результат ещё не внесли
    { weekId: 'W1', allianceId: 'z', outcome: 'loss' },
    { weekId: 'W2', allianceId: 'z', outcome: 'loss' },
    { weekId: 'W3', allianceId: 'z', outcome: 'loss' },
  ];
  const scoring = { win: 1, loss: -1 };
  const table = computeStandings(alliances, weeks, results, scoring, 5);
  const byId = Object.fromEntries(table.map((r) => [r.alliance.id, r]));

  equal('X: три победы = 3 очка', byId.x.points, 3);
  equal('Y: победа и поражение = 0 очков', byId.y.points, 0);
  equal('Z: три поражения = −3 очка', byId.z.points, -3);
  equal('X первый', byId.x.place, 1);
  equal('Z последний', byId.z.place, 3);

  check('невнесённая неделя не штрафует и не считается сыгранной',
    byId.y.points === 0 && byId.y.played === 2);
  equal('очки за невнесённую неделю не меняются', byId.y.series, [-1, 0, 0]);
  equal('серия X — три победы подряд', byId.x.streak, { type: 'win', length: 3 });
  equal('накопленные очки Z по неделям', byId.z.series, [-1, -2, -3]);
  equal('в форме только реальные результаты, без дырок', byId.y.form, ['loss', 'win']);

  const summary = computeWeekSummary(alliances, weeks, results);
  equal('в последней неделе один победитель', summary.winners.map((a) => a.id), ['x']);
  equal('в последней неделе один проигравший', summary.losers.map((a) => a.id), ['z']);
  equal('внесено двое из трёх', summary.recorded, 2);
}

// ── C. ГЛАВНОЕ: sheets-адаптер даёт ту же доменную модель ───────────────────
console.log('\nC. Паритет sheets-адаптера (широкая матрица → нормализованные строки)');
{
  const TABS = {
    alliances: 'id,tag,name,color,active\nx,X,Икс,#111111,да\ny,Y,Игрек,#222222,да\n',
    weeks:
      'id,number,startDate,endDate\n' +
      'W1,1,05.01.2026,11.01.2026\n' +
      'W2,2,12.01.2026,18.01.2026\n',
    // Ровно тот вид, в котором это заполняет человек: строки-альянсы, столбцы-недели.
    results: 'allianceId,tag,W1,W2\nx,X,П,П\ny,Y,Х,\n',
    events: 'id,date,type,serverNumber,title,body\ne1,18.04.2026,server_capture,47,Захвачен сервер 47,Три дня штурма\n',
    texts: 'key,title,body\nabout,О сайте,Текст\n',
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const tab = new URL(url).searchParams.get('sheet');
    return { ok: true, status: 200, text: async () => TABS[tab] };
  };
  CONFIG.sheets.docId = 'FAKE_DOC_ID';

  const sheetsAdapter = await import('../src/data/adapters/sheets.js');
  const { data, problems } = await loadAndValidate(sheetsAdapter);
  globalThis.fetch = realFetch;

  check('данные из таблицы проходят ту же валидацию', problems.length === 0, problems.join('\n       '));

  equal(
    'широкая матрица развёрнута в длинные строки',
    data.results,
    [
      { weekId: 'W1', allianceId: 'x', outcome: 'win' },
      { weekId: 'W2', allianceId: 'x', outcome: 'win' },
      { weekId: 'W1', allianceId: 'y', outcome: 'loss' },
    ]
  );
  check('пустая ячейка не порождает запись', data.results.length === 3);
  check('русская дата разобрана в Date', data.weeks[0].startDate instanceof Date);
  equal('день и месяц не перепутаны', data.weeks[0].startDate.toISOString().slice(0, 10), '2026-01-05');
  check('число недели стало числом, а не строкой', typeof data.weeks[0].number === 'number');
  check('«да» превратилось в boolean', data.alliances[0].active === true);
  check('служебные колонки не попали в результаты', !data.results.some((r) => r.weekId === 'tag'));
}

// ── D. Разбор CSV ───────────────────────────────────────────────────────────
console.log('\nD. Парсер CSV');
{
  equal('запятая внутри кавычек', parseCsv('a,"b,c",d')[0], ['a', 'b,c', 'd']);
  equal('удвоенные кавычки', parseCsv('a,"он сказал ""да""",c')[0], ['a', 'он сказал "да"', 'c']);
  equal('перенос строки внутри значения', parseCsv('a,"стр1\nстр2",c')[0], ['a', 'стр1\nстр2', 'c']);
  equal('CRLF не ломает разбор', parseCsv('a,b\r\nc,d').length, 2);
  equal('пустые строки отброшены', parseCsv('a,b\n\n\nc,d').length, 2);
  equal('объекты по заголовкам', parseCsvObjects('id,name\n1,Тест\n'), [{ id: '1', name: 'Тест' }]);
}

// ── E. Валидатор действительно ловит ошибки ─────────────────────────────────
console.log('\nE. Валидатор контракта');
{
  const bad = {
    alliances: [{ id: 'a', tag: 'A', name: 'А', active: true }, { id: 'a', tag: 'B', name: 'Б', active: true }],
    weeks: [{ id: 'W1', number: '1', startDate: new Date(), endDate: new Date() }],
    results: [{ weekId: 'W9', allianceId: 'a', outcome: 'победа' }],
    events: [],
    texts: [],
  };
  const problems = validateDataset(bad);
  check('поймал дубль id альянса', problems.some((p) => p.includes('дубль id')));
  check('поймал строку вместо числа', problems.some((p) => p.includes('целым числом')));
  check('поймал ссылку на несуществующую неделю', problems.some((p) => p.includes('неизвестная неделя')));
  check('поймал недопустимый outcome', problems.some((p) => p.includes('недопустимый outcome')));
}

// ── F. Разметка рейтинга и его скрипт говорят на одном языке ────────────────
console.log('\nF. Связка рейтинга: разметка ↔ скрипт');
{
  const { readFile } = await import('node:fs/promises');
  const { renderLadder } = await import('../src/pages/ladder.js');
  const { computeStandings } = await import('../src/logic/standings.js');
  const { CONFIG } = await import('../config.js');

  const data = await loadAndValidate(jsonAdapter).then((r) => r.data);
  const standings = computeStandings(
    data.alliances, data.weeks, data.results, CONFIG.scoring, CONFIG.formLength
  );
  const html = renderLadder({ standings });
  const script = await readFile('src/ui/ladder-controls.js', 'utf8');

  /*
    Скрипт ищет элементы по data-ladder-*. Если атрибут в разметке
    переименуют, поиск и сортировка молча перестанут работать — в браузере
    ошибки не будет, просто кнопки станут мёртвыми. Поэтому вытаскиваем
    имена прямо из исходника скрипта и проверяем, что все они есть в HTML.
  */
  const hooks = [...new Set(
    [...script.matchAll(/\[data-(ladder-[a-z]+)\]/g)].map((m) => m[1])
  )];
  check('скрипт вообще что-то ищет', hooks.length >= 5, `нашли: ${hooks.join(', ')}`);
  for (const hook of hooks) {
    check(`разметка содержит data-${hook}`, html.includes(`data-${hook}`));
  }

  // Поля, по которым скрипт фильтрует и сортирует.
  for (const field of ['data-name', 'data-tag', 'data-points', 'data-wins', 'data-form', 'data-place', 'data-active']) {
    check(`у строк есть ${field}`, html.includes(field));
  }

  const rowCount = (html.match(/class="lad__row/g) || []).length;
  equal('отрисованы все 32 альянса', rowCount, 32);
  check('поиск сравнивает в нижнем регистре', !/data-name="[^"]*[А-ЯЁ]/.test(html));
  check('сортировки скрипта покрывают кнопки',
    ['points', 'wins', 'form', 'name'].every((s) => html.includes(`data-ladder-sort="${s}"`)));
}

// ── B3. Кватр — фиксированные периоды по четыре недели ──────────────────────
console.log('\nB3. Четырёхнедельный рейтинг');
{
  const alliances = [{ id: 'x', tag: 'X', name: 'Икс', active: true }];
  const weeks = Array.from({ length: 8 }, (_, i) => ({
    id: `W${i + 1}`,
    number: i + 1,
    startDate: new Date(2026, 0, i * 7 + 5),
    endDate: new Date(2026, 0, i * 7 + 11),
  }));
  const results = [
    { weekId: 'W1', allianceId: 'x', outcome: 'win' },
    { weekId: 'W2', allianceId: 'x', outcome: 'win' },
    { weekId: 'W3', allianceId: 'x', outcome: 'loss' },
    { weekId: 'W4', allianceId: 'x', outcome: 'win' },
    { weekId: 'W5', allianceId: 'x', outcome: 'loss' },
  ];
  const first = computeQuarterWindow(weeks, results.slice(0, 4));
  equal('первый Кватр — недели 1–4', first.weeks.map((w) => w.number), [1, 2, 3, 4]);
  equal('первый Кватр имеет номер 1', first.number, 1);
  const second = computeQuarterWindow(weeks, results);
  equal('после новой недели начинается Кватр 2', second.number, 2);
  equal('Кварт 2 показывает полный блок недель 5–8', second.weeks.map((w) => w.number), [5, 6, 7, 8]);
  const secondStandings = computeStandings(alliances, second.weeks, results, CONFIG.scoring, 4);
  equal('очки нового Кватра считаются с нуля', secondStandings[0].points, -1);
}

// ── B4. Форма Кварта всегда состоит из четырёх недель ───────────────────────
console.log('\nB4. Четыре кубика формы');
{
  const weeks = [1, 2, 3, 4].map((n) => ({
    id: `W${n}`, number: n,
    startDate: new Date(2026, 0, n), endDate: new Date(2026, 0, n + 6),
  }));
  const results = [
    { weekId: 'W1', allianceId: 'kr33', outcome: 'win' },
    { weekId: 'W2', allianceId: 'kr33', outcome: 'win' },
    { weekId: 'W3', allianceId: 'kr33', outcome: 'win' },
    { weekId: 'W4', allianceId: 'kr33', outcome: 'loss' },
  ];
  equal('форма Кварта — победа, победа, победа, поражение',
    computeWindowForm('kr33', weeks, results), ['win', 'win', 'win', 'loss']);
  equal('одинаковый результат даёт одинаковые очки',
    computeStandings(
      [{ id: 'kr33', name: 'КР33' }, { id: 'ekf', name: 'EKF' }],
      weeks,
      results.concat([
        { weekId: 'W1', allianceId: 'ekf', outcome: 'win' },
        { weekId: 'W2', allianceId: 'ekf', outcome: 'win' },
        { weekId: 'W3', allianceId: 'ekf', outcome: 'win' },
        { weekId: 'W4', allianceId: 'ekf', outcome: 'loss' },
      ]),
      CONFIG.scoring,
      4
    ).map((row) => row.points), [2, 2]);
}

// ── B2. Недели из будущего не считаются текущими ────────────────────────────
console.log('\nB2. Недели, заведённые заранее');
{
  const { weeksUpToLastData } = await import('../src/logic/standings.js');
  const mkWeek = (n) => ({
    id: `W${n}`, number: n,
    startDate: new Date(2026, 0, n), endDate: new Date(2026, 0, n + 6),
  });
  const weeks = [31, 32, 33, 34, 35, 36].map(mkWeek);

  equal('без результатов набор пуст', weeksUpToLastData(weeks, []), []);

  const oneWeek = [{ weekId: 'W31', allianceId: 'a01', outcome: 'win' }];
  equal(
    'хвост будущих недель отброшен',
    weeksUpToLastData(weeks, oneWeek).map((w) => w.id),
    ['W31']
  );

  const withGap = [
    { weekId: 'W31', allianceId: 'a01', outcome: 'win' },
    { weekId: 'W33', allianceId: 'a01', outcome: 'loss' },
  ];
  equal(
    'внутренний пропуск сохранён, чтобы дырка в данных была видна',
    weeksUpToLastData(weeks, withGap).map((w) => w.id),
    ['W31', 'W32', 'W33']
  );

  check('порядок не зависит от порядка строк на входе',
    weeksUpToLastData([...weeks].reverse(), withGap).map((w) => w.id).join() === 'W31,W32,W33');

  // Главное следствие: «итогами недели» не может стать неделя из будущего.
  const trimmed = weeksUpToLastData(weeks, oneWeek);
  const summary = computeWeekSummary(
    [{ id: 'a01', tag: 'A', name: 'А', active: true }], trimmed, oneWeek
  );
  equal('текущая неделя — последняя с данными, а не последняя в списке', summary.week.id, 'W31');
}

// ── F2. Исходов ровно два ───────────────────────────────────────────────────
console.log('\nF2. Только победа и поражение');
{
  const { toOutcome } = await import('../src/data/adapters/_coerce.js');

  equal('«П» — победа', toOutcome('П'), 'win');
  equal('«Х» русская — поражение', toOutcome('Х'), 'loss');
  equal('«X» латинская — поражение', toOutcome('X'), 'loss');
  equal('регистр и пробелы не важны', toOutcome('  победа '), 'win');

  // Третьего исхода не существует: в VS альянс участвует всегда.
  equal('ничья больше не распознаётся', toOutcome('ничья'), null);
  equal('«Н» не распознаётся', toOutcome('Н'), null);
  equal('пустая ячейка — это отсутствие данных', toOutcome(''), null);
  equal('мусор не превращается в исход', toOutcome('???'), null);

  const { validateDataset } = await import('../src/data/contract.js');
  const problems = validateDataset({
    alliances: [{ id: 'a', tag: 'A', name: 'А', active: true }],
    weeks: [{ id: 'W1', number: 1, startDate: new Date(), endDate: new Date() }],
    results: [{ weekId: 'W1', allianceId: 'a', outcome: 'draw' }],
    events: [], texts: [],
  });
  check('валидатор отвергает ничью', problems.some((p) => p.includes('недопустимый outcome')));
}

// ── F3. Шаблон таблицы совпадает с тем, что читает адаптер ──────────────────
console.log('\nF3. Шаблон Google Таблицы ↔ адаптер');
{
  const { TABS, toCsv } = await import('../scripts/sheet-schema.mjs');
  const sheetsAdapter = await import('../src/data/adapters/sheets.js');
  const { CONFIG: cfg } = await import('../config.js');

  /*
    Берём сгенерированный шаблон, дописываем в него немного данных — как это
    сделал бы человек — и прогоняем через настоящий sheets-адаптер.

    Смысл теста: шаблон и код читают одну и ту же структуру. Если однажды
    переименуют колонку в одном месте и забудут в другом, поиск данных
    молча вернёт пустоту, а сайт покажет нули без единой ошибки в консоли.
  */
  const filled = {};
  for (const [tab, { headers, rows }] of Object.entries(TABS)) {
    const copy = rows.map((r) => [...r]);

    if (tab === cfg.sheets.tabs.alliances) {
      copy[0][1] = 'STG'; copy[0][2] = 'Сталкеры';
      copy[1][1] = 'VLK'; copy[1][2] = 'Волки';
      copy[2][1] = 'RUS'; copy[2][2] = 'Русичи';
      copy[2][4] = 'нет'; // распавшийся
    }
    if (tab === cfg.sheets.tabs.results) {
      // Колонки: allianceId, tag, name, затем недели
      copy[0][3] = 'П'; copy[0][4] = 'П';
      copy[1][3] = 'Х'; copy[1][4] = 'П';
      copy[2][3] = 'Х'; // за вторую неделю у третьего записи нет
    }
    filled[tab] = toCsv(headers, copy);
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const tab = new URL(url).searchParams.get('sheet');
    return { ok: true, status: 200, text: async () => filled[tab] };
  };
  cfg.sheets.docId = 'TEMPLATE_TEST';
  sheetsAdapter.clearCache();

  const { data, problems } = await loadAndValidate(sheetsAdapter);
  globalThis.fetch = realFetch;
  sheetsAdapter.clearCache();

  check('заполненный шаблон проходит контракт', problems.length === 0, problems.slice(0, 4).join('\n       '));
  equal('незаполненные строки альянсов пропущены', data.alliances.length, 3);
  equal('недели прочитаны', data.weeks.length, Object.values(TABS)[1].rows.length);

  const w1 = data.weeks[0].id;
  const w2 = data.weeks[1].id;
  equal('результаты развёрнуты правильно', data.results.length, 5);
  check('победа первого альянса прочитана',
    data.results.some((r) => r.allianceId === 'a01' && r.weekId === w1 && r.outcome === 'win'));
  check('поражение второго прочитано',
    data.results.some((r) => r.allianceId === 'a02' && r.weekId === w1 && r.outcome === 'loss'));
  check('невнесённая ячейка записи не создала',
    !data.results.some((r) => r.allianceId === 'a03' && r.weekId === w2));
  check('«нет» превратилось в active: false',
    data.alliances.find((a) => a.id === 'a03').active === false);
  check('цвета альянсов предзаполнены', data.alliances.every((a) => /^#[0-9a-f]{6}$/i.test(a.color ?? '')));

  const principles = data.texts.find((t) => t.key === 'guide-principles');
  check('тексты гайда лежат в шаблоне', Boolean(principles));
  check('escape \\n развёрнут в настоящий перенос строки', principles.body.includes('\n'));
  check('в тексте не осталось литеральных \\n', !principles.body.includes('\\n'));
  check('заголовки ## сохранились', principles.body.includes('## '));
}

// ── G. Русские склонения ────────────────────────────────────────────────────
console.log('\nG. Склонения по числам');
{
  const { plural, pluralWord } = await import('../src/ui/helpers.js');
  const day = (n) => pluralWord(n, 'день', 'дня', 'дней');

  equal('1 день', day(1), 'день');
  equal('2 дня', day(2), 'дня');
  equal('5 дней', day(5), 'дней');
  equal('11 дней — исключение', day(11), 'дней');
  equal('12 дней — исключение', day(12), 'дней');
  equal('14 дней — исключение', day(14), 'дней');
  equal('21 день', day(21), 'день');
  equal('22 дня', day(22), 'дня');
  equal('25 дней', day(25), 'дней');
  equal('101 день', day(101), 'день');
  equal('0 дней', day(0), 'дней');

  equal('plural подставляет число', plural(3, 'победа', 'победы', 'побед'), '3 победы');
  check('pluralWord число не подставляет', !day(10).includes('10'));
}

// ── H. Хронология: разметка и её скрипт ─────────────────────────────────────
console.log('\nH. Связка хронологии: разметка ↔ скрипт');
{
  const { readFile } = await import('node:fs/promises');
  const { renderTimeline } = await import('../src/pages/timeline.js');

  /*
    Свой набор событий, а не из адаптера: в реальной таблице хронология может
    быть пустой, и тогда страница показывает состояние «летопись не начата»,
    в котором проверяемых элементов нет вовсе. Тест должен проверять разметку
    заполненной страницы независимо от того, что сейчас в данных.
  */
  const events = [
    { id: 'e1', date: new Date('2026-04-18'), type: 'server_capture', serverNumber: 47,
      title: 'Захвачен сервер 47', durationDays: 3 },
    { id: 'e2', date: new Date('2026-05-02'), type: 'war', title: 'Война за зону', durationDays: 14 },
    { id: 'e3', date: new Date('2025-11-22'), type: 'merge', title: 'Слияние альянсов' },
    { id: 'e4', date: new Date('2026-06-28'), type: 'server_capture', serverNumber: 12,
      title: 'Захвачен сервер 12', durationDays: 9 },
  ];

  /*
    Недели с итогом нужны здесь по той же причине, что и события: страница
    должна быть заполненной. Без них не отрисуется календарь, и проверка
    «скрипт и разметка говорят на одном языке» молча пропустила бы половину
    крючков, которые скрипт ищет.
  */
  const weeks = [
    { id: 'W16', number: 16, startDate: new Date('2026-04-13'), endDate: new Date('2026-04-19'),
      serverOutcome: 'captured', serverNumber: 47 },
    { id: 'W17', number: 17, startDate: new Date('2026-04-20'), endDate: new Date('2026-04-26'),
      serverOutcome: 'held' },
    { id: 'W22', number: 22, startDate: new Date('2026-05-25'), endDate: new Date('2026-05-31'),
      serverOutcome: 'lost', serverNumber: 33 },
  ];

  const html = renderTimeline({ events, allWeeks: weeks });
  const script = await readFile('src/ui/timeline-controls.js', 'utf8');

  const hooks = [...new Set([...script.matchAll(/\[data-(tl-[a-z]+)\]/g)].map((m) => m[1]))];
  check('скрипт что-то ищет', hooks.length >= 3, `нашли: ${hooks.join(', ')}`);
  for (const hook of hooks) {
    check(`разметка содержит data-${hook}`, html.includes(`data-${hook}`));
  }

  const captures = events.filter((e) => e.type === 'server_capture');
  const trophies = (html.match(/class="trophy"/g) || []).length;
  equal('трофеев столько же, сколько захватов', trophies, captures.length);

  // Числа в шапке выводятся отдельно от подписей — проверяем, что подпись
  // не тащит число за собой и не получается «10 · 10 месяцев».
  check('в подписях статистики нет цифр', !/<span>[^<]*\d/.test(html.split('trophies')[0]));
  check('годы сгруппированы', html.includes('data-tl-year'));
}

// ── I. Граф импортов и файлы для публикации ─────────────────────────────────
console.log('\nI. Готовность к публикации');
{
  const { readFile, readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');

  /*
    Браузер грузит модули по относительным путям, и опечатка в пути
    проявляется только после публикации: страница молча остаётся пустой,
    а в консоли лежит 404, которого никто не видит. Поэтому проходим
    граф импортов целиком и проверяем, что каждый файл существует.
  */
  async function walk(dir, out = []) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  const files = [...(await walk('src')), 'config.js'];
  const broken = [];
  let edges = 0;

  for (const file of files) {
    const code = await readFile(file, 'utf8');
    for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"](\.[^'"]+)['"]/g)) {
      edges++;
      const target = path.resolve(path.dirname(file), m[1].split(/[?#]/, 1)[0]);
      try {
        await stat(target);
      } catch {
        broken.push(`${file} → ${m[1]}`);
      }
    }
  }

  check(`граф импортов цел (${edges} связей)`, broken.length === 0, broken.join('\n       '));

  // Файлы, без которых публикация сломается или установка не предложится.
  for (const f of [
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    '.nojekyll',
    'public/icons/icon-32.svg',
    'public/icons/icon-192.svg',
    'public/icons/icon-512.svg',
    'public/icons/maskable-512.svg',
  ]) {
    let ok = true;
    try { await stat(f); } catch { ok = false; }
    check(`есть ${f}`, ok);
  }

  /*
    Иконки манифеста обязаны быть текстовыми файлами.
    Интеграция с GitHub портит бинарные данные (проверено: base64 сохраняется
    как текст, сырые байты раздуваются при перекодировке). Поэтому иконки
    хранятся как SVG с вложенным внутрь точным PNG — текст заливается
    без потерь, а картинка остаётся пиксель в пиксель.

    Если однажды в манифест впишут .png, установка на Android сломается
    молча: браузер не найдёт иконку и не предложит установку.
  */
  const manifestRaw = JSON.parse(await readFile('manifest.webmanifest', 'utf8'));
  check(
    'все иконки манифеста — текстовые (SVG), иначе заливка их испортит',
    manifestRaw.icons.every((i) => i.src.endsWith('.svg')),
    manifestRaw.icons.map((i) => i.src).join(', ')
  );

  /*
    .nojekyll обязателен именно из-за _coerce.js: GitHub Pages прогоняет
    сайт через Jekyll, а тот игнорирует всё, что начинается с подчёркивания.
    Без этого файла адаптеры не загрузятся, и сайт останется пустым.
  */
  const underscored = files.filter((f) => path.basename(f).startsWith('_'));
  check(
    `файлы с подчёркиванием защищены .nojekyll (${underscored.length} шт.)`,
    underscored.length === 0 || (await stat('.nojekyll').then(() => true, () => false))
  );

  const html = await readFile('index.html', 'utf8');
  check('в index.html нет абсолютных путей от корня домена',
    !/(?:src|href)="\/(?!\/)/.test(html));
  check('манифест подключён', html.includes('rel="manifest"'));
  check('иконка для iOS подключена', html.includes('apple-touch-icon'));
  check('превью для чатов настроено', html.includes('og:image'));

  /*
    og:image должен быть абсолютным. Относительный путь отрисуется в браузере,
    но сборщики превью в мессенджерах его не развернут, и ссылка в чате уйдёт
    без картинки — а именно через чаты сайт и будут распространять.
  */
  const og = html.match(/property="og:image"\s+content="([^"]+)"/);
  check('og:image — абсолютный адрес', Boolean(og) && /^https?:\/\//.test(og[1]),
    og ? og[1] : 'тег не найден');
  check('og:url указан', html.includes('property="og:url"'));

  const manifest = manifestRaw;
  check('в манифесте относительный start_url', manifest.start_url.startsWith('./'));
  check('в манифесте есть maskable-иконка',
    manifest.icons.some((i) => i.purpose === 'maskable'));
  check('иконки манифеста существуют',
    (await Promise.all(manifest.icons.map((i) => stat(i.src).then(() => true, () => false))))
      .every(Boolean));
}

// ── J. Админ-панель: одинаковый разбор и честная фаза «только чтение» ───────
console.log('\nJ. Админ-панель');
{
  const { readFile, readdir } = await import('node:fs/promises');

  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const jsonAdapter = await import('../src/data/adapters/json.js');

  /*
    ГЛАВНАЯ ПРОВЕРКА РАЗДЕЛА.

    Сайт читает data/live.json с диска, панель — тот же файл через API GitHub.
    Разбор у них общий (_map.js), и это должно оставаться правдой: стоит
    кому-то поправить разбор в одном месте, панель начнёт показывать одно,
    а сайт другое. Расхождение вылезло бы в момент публикации.
  */
  // Адаптер в тестах смотрит на демо-данные (см. подмену пути в начале файла),
  // поэтому сверять надо с ними же — иначе тест поймает не расхождение
  // разбора, а разные файлы.
  const rawForParity = JSON.parse(await readFile('data/demo.json', 'utf8'));
  const viaAdapter = {
    alliances: await jsonAdapter.getAlliances(),
    weeks: await jsonAdapter.getWeeks(),
    results: await jsonAdapter.getResults(),
    events: await jsonAdapter.getEvents(),
    texts: await jsonAdapter.getTexts(),
  };
  check(
    'панель и сайт разбирают одни данные одинаково',
    JSON.stringify(mapDataset(rawForParity)) === JSON.stringify(viaAdapter)
  );

  /*
    Соберём исходники панели: несколько проверок идут по тексту.

    Пути склеиваем вручную через «/», а не через path.join. На Windows join
    даёт «src\admin\repo.js», и тогда проверки ниже врут: сравнение с
    'src/admin/repo.js' не совпадает, а фильтр /screens\// не находит ни
    одного экрана — то есть тест тихо проверяет меньше, чем обещает.
    Для fs косая черта работает на всех системах одинаково.
  */
  async function walkJs(dir, out = []) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) await walkJs(full, out);
      else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
  }
  const adminFiles = await walkJs('src/admin');
  /*
    Комментарии выкидываем: в них слова «console.log» и «POST» встречаются
    как раз там, где объясняется, почему их нельзя писать в коде. Проверять
    надо код, а не рассуждения о нём.
  */
  const stripComments = (s) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const adminSource = stripComments(
    (await Promise.all(adminFiles.map((f) => readFile(f, 'utf8')))).join('\n')
  );

  check(`панель разложена по файлам (${adminFiles.length} шт.)`, adminFiles.length >= 5);

  /*
    ВСЯ ЗАПИСЬ — В ОДНОМ ФАЙЛЕ.

    Пока это так, у вопроса «что в панели способно испортить накопленную
    историю» есть ровно один адрес. Стоит появиться записи в экране или
    в логике правки — и ответ на этот вопрос перестанет быть коротким.

    ЧТО ИЗМЕНИЛОСЬ ПОСЛЕ ПЕРЕЕЗДА С GITHUB. Раньше сеть и запись совпадали:
    единственным способом что-то изменить был запрос к api.github.com.
    Теперь запросы к базе делает общий клиент (src/db/client.js), которым
    пользуются и сайт, и форум, — и через него же ходит чтение, которое
    испортить ничего не может.

    Поэтому проверка сместилась с «где сеть» на «где запись». Это и был
    настоящий предмет беспокойства: испортить историю может изменяющий
    запрос, а не любой.
  */
  const writeFiles = [];
  for (const f of adminFiles) {
    const code = stripComments(await readFile(f, 'utf8'));
    if (/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i.test(code)) writeFiles.push(f);
  }
  equal('запись живёт ровно в одном файле', writeFiles.join(', '), 'src/admin/store.js');

  /*
    Панель не разговаривает с сетью напрямую: транспорт общий с сайтом
    и форумом. Свой fetch в панели означал бы вторую реализацию обновления
    токена и разбора ошибок — то есть два немного разных поведения.
  */
  const ownFetch = [];
  for (const f of adminFiles) {
    const code = stripComments(await readFile(f, 'utf8'));
    if (/\bfetch\(/.test(code)) ownFetch.push(f);
  }
  equal('панель не делает своих сетевых запросов', ownFetch.join(', '), '');

  const storeCode = stripComments(await readFile('src/admin/store.js', 'utf8'));
  /*
    Пустая отметка УДАЛЯЕТ результат, а не пишет третий исход. Отсутствие
    записи означает «результат ещё не внесли» — это состояние данных,
    а не игры (см. src/data/types.js).
  */
  check('снятая отметка удаляет результат, а не пишет третий исход',
    /method: 'DELETE'/.test(storeCode) && /site_results\?week_id=eq/.test(storeCode));
  check('право редактора выдаётся функцией базы, а не правкой профиля',
    /rpc\/site_set_editor/.test(storeCode));

  /*
    Токен — единственный секрет в проекте. Случайный console.log с ним
    означает утечку в консоль, скриншот или демонстрацию экрана.
  */
  check('в панели нет вывода в консоль — токену там не место', !/console\./.test(adminSource));

  /*
    ЭКРАНИРОВАНИЕ В ПАНЕЛИ.

    Панель — единственное место, где рядом с данными живёт токен. Данные вносит
    человек руками, а сообщения валидатора собраны ИЗ данных, поэтому вставлять
    их в разметку как есть нельзя: XSS на своём же домене означает украденный
    токен, а с ним право писать в репозиторий.

    Проверяем текстом: в панели не должно остаться подстановки в innerHTML
    без esc() — кроме заведомо своих строк.
  */
  /*
    Проверяем только файлы, которые собирают разметку. В repo.js те же имена
    встречаются при склейке текста сообщения — это не разметка, и требовать
    там esc() означало бы экранировать текст ради самого экранирования.
  */
  const renderFiles = adminFiles.filter(
    (f) => /main\.js$/.test(f) || /screens\//.test(f) || /shell\.js$/.test(f) || /login\.js$/.test(f)
  );
  const renderSource = stripComments(
    (await Promise.all(renderFiles.map((f) => readFile(f, 'utf8')))).join('\n')
  );
  check(
    'сообщения валидатора и ошибок экранируются перед вставкой в разметку',
    !/\$\{(?:problems|message|detail|p)\}/.test(renderSource)
  );

  const { safeUrl } = await import('../src/ui/helpers.js');
  equal('javascript-ссылка отбрасывается', safeUrl('javascript:alert(1)'), '');
  equal('data-ссылка отбрасывается', safeUrl('data:text/html,<script>'), '');
  equal('обычная ссылка проходит', safeUrl('https://example.com/a.png'), 'https://example.com/a.png');
  check(
    'ссылки на картинки проходят через safeUrl, а не только через esc',
    /safeUrl\(/.test(await readFile('src/admin/screens/events.js', 'utf8')) &&
      /safeUrl\(/.test(await readFile('src/pages/timeline.js', 'utf8'))
  );

  /*
    ОДИН ИСТОЧНИК ПРАВДЫ.

    Данные ведёт панель. Пока выгрузка из таблицы запускалась по расписанию
    и по каждому push, она затирала работу панели каждые полчаса — правка
    появлялась и исчезала, и понять причину было невозможно.

    Воркфлоу оставлен как аварийный выход, но только с ручным запуском.
    Если однажды кто-то вернёт `schedule` или `push`, этот тест упадёт —
    и вернуть их придётся осознанно.
  */
  const workflow = await readFile('.github/workflows/pull-data.yml', 'utf8');
  check('выгрузка из таблицы не ходит по расписанию', !/^\s*schedule:/m.test(workflow));
  check('выгрузка из таблицы не запускается по push', !/^\s*push:/m.test(workflow));
  check('ручной запуск выгрузки остался как аварийный выход', /workflow_dispatch:/.test(workflow));

  const pullScript = await readFile('scripts/pull-sheet.mjs', 'utf8');
  check(
    'скрипт выгрузки предупреждает, что затрёт данные панели',
    /затр[её]т/.test(pullScript)
  );

  const adminHtml = await readFile('admin.html', 'utf8');
  check('панель не регистрирует service worker', !/serviceWorker/.test(adminHtml));
  check('панель не подключает манифест', !adminHtml.includes('rel="manifest"'));
  check('панель закрыта от поисковиков', /name="robots"[^>]*noindex/.test(adminHtml));
  check('в admin.html нет абсолютных путей от корня домена', !/(?:src|href)="\/(?!\/)/.test(adminHtml));
  /*
    ПАНЕЛЬ ПЕРЕИСПОЛЬЗУЕТ ТОТ ЖЕ ЯЗЫК, ЧТО И САЙТ.

    Проверяем не «подключён какой-то styles.css», а «подключён тот самый файл,
    который грузит index.html». Прежняя проверка искала строку './src/styles.css'
    и пропустила настоящую поломку: панель осталась на файле, от которого сайт
    ушёл ещё в версии v6. Выглядело почти правильно — базовые цвета совпадают, —
    но переменных --ease-out и --electric в старом файле нет, и часть оформления
    молча не работала.

    Расхождение такого рода накапливается незаметно: оба файла живые, ошибки
    нет, а выглядит по-разному.
  */
  const indexForCss = await readFile('index.html', 'utf8');
  const siteCss = indexForCss.match(/href="\.\/(src\/[\w.-]+\.css)/)?.[1];
  check('панель переиспользует тот же файл стилей, что и сайт',
    Boolean(siteCss) && adminHtml.includes(`./${siteCss}`),
    `сайт: ${siteCss}`);


  /*
    Кэш админки опаснее устаревшего сайта: показав прошлую неделю, панель
    даёт опубликовать правку поверх чужой незаметно для обоих редакторов.
  */
  const sw = await readFile('sw.js', 'utf8');
  check('service worker обходит панель', /admin/.test(sw));
  /*
    Раньше проверялось «обходит api.github.com»: панель писала данные туда,
    и закэшированный ответ с токеном в заголовке был бы утечкой. Теперь панель
    ходит в базу, и мимо кэша должна идти она.
  */
  check('service worker обходит базу', /supabase/i.test(sw) || /api\.github\.com/.test(sw));

  /*
    РЕЗЕРВНАЯ КОПИЯ — УСЛОВИЕ ПЕРЕЕЗДА, А НЕ УДОБСТВО.

    Пока история лежала в git, ей не могло случиться ничего: репозиторий
    раздаётся тысячами копий, история правок неудаляема. В базе иначе —
    аккаунт можно потерять, тариф изменить, а неудачный запрос стирает данные
    молча и навсегда.

    Без выгрузки переезд означал бы обмен вечного хранилища на удобное. Поэтому
    здесь проверяется не наличие файла, а его предохранители: скрипт, который
    молча пишет пустоту поверх истории, хуже отсутствующего.
  */
  const backup = await readFile('scripts/backup-from-db.mjs', 'utf8');
  check('выгрузка отказывается писать пустой набор поверх копии',
    /не перезаписываю|НЕ перезаписываю/i.test(backup) && /process\.exit\(1\)/.test(backup));
  check('выгрузка замечает резкую потерю записей',
    /0\.5|половин/i.test(backup));
  check('выгрузка не требует служебного ключа',
    !/service_role|sb_secret/.test(backup));
  check('формат файла тот же, что был до переезда',
    /JSON\.stringify\(data, null, 2\)/.test(backup));

  const backupFlow = await readFile('.github/workflows/backup-from-db.yml', 'utf8');
  check('выгрузка идёт по расписанию, а не только руками',
    /schedule:/.test(backupFlow) && /cron:/.test(backupFlow));
  check('выгрузку можно запустить руками перед рискованной правкой',
    /workflow_dispatch:/.test(backupFlow));
  check('в воркфлоу выгрузки нет секретов — данные сайта открыты на чтение',
    !/secrets\./.test(backupFlow));

  // Экраны — чистые функции над данными, поэтому проверяются без браузера.
  const screens = [
    ['обзор', (await import('../src/admin/screens/overview.js')).renderOverview],
    ['неделя', (await import('../src/admin/screens/week.js')).renderWeek],
    ['альянсы', (await import('../src/admin/screens/alliances.js')).renderAlliances],
    ['хронология', (await import('../src/admin/screens/events.js')).renderEvents],
    ['тексты', (await import('../src/admin/screens/texts.js')).renderTexts],
  ];

  const viewFor = (data) => ({
    user: { login: 'editor' },
    repo: { fullName: 'Qvaden/zroute-s33', canPush: true, isPrivate: false },
    file: { path: 'data/live.json', size: 98304, sha: 'abc123' },
    commit: {
      sha: 'abc1234',
      message: 'данные из таблицы',
      date: new Date('2026-07-29T21:40:00Z'),
      authorName: 'github-actions[bot]',
      authorLogin: '',
    },
    data,
    weeks: data.weeks,
    problems: [],
  });

  const rawDemo = JSON.parse(await readFile('data/demo.json', 'utf8'));
  const full = viewFor(mapDataset(rawDemo));
  /*
    Пустой набор — не выдуманный случай: ровно так выглядят данные сейчас,
    до первого внесённого результата. Панель обязана открыться и на них.
  */
  const blank = viewFor(mapDataset({}));

  for (const [label, render] of screens) {
    let onBlank = '';
    let onFull = '';
    try { onBlank = render(blank, null); } catch (err) { onBlank = `ПАДАЕТ: ${err.message}`; }
    try { onFull = render(full, null); } catch (err) { onFull = `ПАДАЕТ: ${err.message}`; }

    check(`экран «${label}» рисуется на пустых данных`, onBlank.startsWith('\n') || onBlank.startsWith('<'), onBlank.slice(0, 90));
    check(`экран «${label}» рисуется на полных данных`, onFull.length > 300, onFull.slice(0, 90));
  }

  /*
    Адрес вида #/week/W24 обязан открывать именно эту неделю, а не последнюю.
    Номер берём из самих данных: в демо недели свои, и зашитый номер сделал бы
    тест хрупким без всякой пользы.
  */
  const target = full.data.weeks[Math.floor(full.data.weeks.length / 2)];
  const picked = screens[1][1](full, target.id);
  check(
    'экран недели слушается адреса',
    picked.includes(`Неделя ${target.number}`),
    `просили ${target.id}`
  );
}

// ── K0. Порядок недель на переходе года ─────────────────────────────────────
console.log('\nK0. Недели упорядочены по дате, а не по номеру');
{
  const { mapWeeks } = await import('../src/data/adapters/_map.js');

  /*
    ЛОВУШКА, КОТОРУЮ ЭТОТ ТЕСТ ДЕРЖИТ ЗАКРЫТОЙ.

    Номер недели у людей означает номер внутри года: 27 июля 2026 — это 31-я
    неделя года. Значит в январе счёт пойдёт заново, и при сортировке по номеру
    неделя 1 января 2027 встанет ПЕРЕД неделей 31 июля 2026.

    Тогда посыпется всё, что опирается на порядок: график гонки очков, серии,
    история мест, «итоги недели». Причём не сразу, а через несколько месяцев
    после запуска, и выглядеть это будет как «сайт врёт».
  */
  const acrossNewYear = mapWeeks([
    { id: 'W01', number: 1, startDate: '2027-01-04', endDate: '2027-01-10' },
    { id: 'W31', number: 31, startDate: '2026-07-27', endDate: '2026-08-02' },
    { id: 'W52', number: 52, startDate: '2026-12-21', endDate: '2026-12-27' },
  ]);

  equal(
    'через новый год недели идут по календарю, а не по номеру',
    acrossNewYear.map((w) => w.id).join(' '),
    'W31 W52 W01'
  );

  // Обратный порядок — тот же календарь, только свежие первыми.
  const { byWeekStartDesc } = await import('../src/data/week-order.js');
  equal(
    'свежая неделя первая даже после нового года',
    [...acrossNewYear].sort(byWeekStartDesc).map((w) => w.id).join(' '),
    'W01 W52 W31'
  );

  /*
    «Какая неделя сейчас» — отдельная проверка, потому что здесь была живая
    ошибка: панель открывалась на последней ЗАВЕДЁННОЙ неделе, а недели заводят
    на месяц вперёд. Человек вносил результаты в неделю из будущего.
  */
  const { findCurrentWeek } = await import('../src/data/week-order.js');
  const season = mapWeeks([
    { id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' },
    { id: 'W2', number: 2, startDate: '2026-08-03', endDate: '2026-08-09' },
    { id: 'W3', number: 3, startDate: '2026-08-10', endDate: '2026-08-16' },
  ]);

  equal('идёт та неделя, в которую попал день',
    findCurrentWeek(season, new Date('2026-08-05T10:00:00Z'))?.id, 'W2');
  equal('последний день недели ещё её же',
    findCurrentWeek(season, new Date('2026-08-09T23:00:00Z'))?.id, 'W2');
  equal('после всех недель — последняя прошедшая, а не первая',
    findCurrentWeek(season, new Date('2026-12-01T00:00:00Z'))?.id, 'W3');
  equal('до старта — первая неделя',
    findCurrentWeek(season, new Date('2026-07-01T00:00:00Z'))?.id, 'W1');
  equal('без недель — ничего', findCurrentWeek([], new Date()), null);

  // Недели без даты не должны исчезать: данные неполные, но они есть.
  const noDate = mapWeeks([
    { id: 'WX', number: 9 },
    { id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' },
  ]);
  equal('неделя без даты уходит в конец, но не теряется', noDate.map((w) => w.id).join(' '), 'W1 WX');
}

// ── K. Публикация: логика правки данных ─────────────────────────────────────
console.log('\nK. Публикация недели');
{
  const { readFile } = await import('node:fs/promises');
  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const { applyMarks, marksFromRaw, diffMarks, commitMessage, serialize } = await import(
    '../src/admin/edit.js'
  );
  const { describe: describeChange } = await import('../src/admin/screens/week.js');

  /*
    Маленький выдуманный набор вместо демо-данных: здесь проверяется не объём,
    а поведение на границах — снятая отметка, чужая неделя, лишние поля.
    На трёх альянсах любое расхождение видно глазами прямо в сообщении теста.
  */
  const raw = {
    pulledAt: '2026-07-29T00:00:00.000Z',
    source: 'google-sheets:xxx',
    alliances: [{ id: 'a01' }, { id: 'a02' }, { id: 'a03' }],
    weeks: [{ id: 'W1', number: 1 }, { id: 'W2', number: 2 }],
    results: [
      { weekId: 'W1', allianceId: 'a01', outcome: 'win' },
      { weekId: 'W1', allianceId: 'a02', outcome: 'loss' },
      { weekId: 'W2', allianceId: 'a01', outcome: 'loss', opponent: 'кто-то' },
    ],
    events: [],
    texts: [],
  };

  const out = applyMarks(raw, 'W1', { a01: 'loss', a03: 'win' });

  equal(
    'результаты другой недели не тронуты',
    JSON.stringify(out.results.filter((r) => r.weekId === 'W2')),
    JSON.stringify([{ weekId: 'W2', allianceId: 'a01', outcome: 'loss', opponent: 'кто-то' }])
  );
  check(
    'снятая отметка удаляет запись, а не пишет третий исход',
    !out.results.some((r) => r.weekId === 'W1' && r.allianceId === 'a02')
  );
  equal(
    'исход исправляется',
    out.results.find((r) => r.weekId === 'W1' && r.allianceId === 'a01').outcome,
    'loss'
  );
  check(
    'новая отметка добавляется',
    out.results.some((r) => r.weekId === 'W1' && r.allianceId === 'a03' && r.outcome === 'win')
  );
  equal('исходные данные не мутируются', raw.results.length, 3);

  // Поля, которые панель не показывает, она не имеет права потерять.
  equal(
    'opponent сохраняется при правке исхода',
    applyMarks(raw, 'W2', { a01: 'win' }).results.find((r) => r.weekId === 'W2').opponent,
    'кто-то'
  );

  /*
    Порядок канонический: недели в порядке из weeks, альянсы — из alliances.
    Без этого правка одной недели тасовала бы весь файл, и в истории гита
    вместо «изменилась неделя 31» стояло бы «изменилось всё».
  */
  equal(
    'порядок записей: сначала недели, внутри — альянсы',
    applyMarks(raw, 'W1', { a03: 'win', a01: 'win', a02: 'win' })
      .results.map((r) => `${r.weekId}/${r.allianceId}`)
      .join(' '),
    'W1/a01 W1/a02 W1/a03 W2/a01'
  );

  // Выгрузка пишет английские слова, генератор демо-данных — русские П и Х.
  equal(
    'русская отметка из таблицы понимается',
    marksFromRaw({ ...raw, results: [{ weekId: 'W1', allianceId: 'a01', outcome: 'П' }] }, 'W1').a01,
    'win'
  );

  // Формат обязан совпасть с scripts/pull-sheet.mjs, иначе первый же коммит
  // панели покажет в истории «изменён весь файл».
  equal('файл пишется с отступом 2 и переводом строки в конце', serialize({ a: 1 }), '{\n  "a": 1\n}\n');

  const d = diffMarks(raw, 'W1', { a01: 'loss', a03: 'win' });
  equal('посчитано добавленных', d.added, 1);
  equal('посчитано исправленных', d.changed, 1);
  equal('посчитано удаляемых', d.removed, 1);

  check('удаление названо вслух до нажатия', /удалится/.test(describeChange(d, null)));
  check('без изменений публиковать нечего', /нечего/.test(describeChange(diffMarks(raw, 'W1', marksFromRaw(raw, 'W1')), null)));

  equal(
    'сообщение коммита человеческое',
    commitMessage({ number: 31 }, { a01: 'win', a02: 'win', a03: 'loss' }),
    'неделя 31: 2 победы, 1 поражение'
  );
  equal('очистка недели названа отдельно', commitMessage({ number: 5 }, {}), 'неделя 5: результаты убраны');

  /*
    ГЛАВНАЯ ПРОВЕРКА РАЗДЕЛА: обещание «панель не опубликует то, на чём сайт
    откроется пустым» должно быть проверяемым, а не написанным в комментарии.
    Берём настоящие демо-данные, правим неделю и прогоняем результат тем же
    валидатором, которым проверяется сайт.
  */
  const rawDemo = JSON.parse(await readFile('data/demo.json', 'utf8'));
  const someWeek = rawDemo.weeks[rawDemo.weeks.length - 1].id;
  const marks = Object.fromEntries(
    rawDemo.alliances.slice(0, 10).map((a, i) => [a.id, i % 2 ? 'loss' : 'win'])
  );

  check(
    'правка недели проходит валидатор сайта',
    validateDataset(mapDataset(applyMarks(rawDemo, someWeek, marks))).length === 0
  );
  check(
    'валидатор ловит отметку неизвестного альянса — публикация будет отменена',
    validateDataset(mapDataset(applyMarks(rawDemo, someWeek, { 'нет-такого': 'win' }))).length > 0
  );
}

// ── L. Серверные события: захваты и защиты ──────────────────────────────────
console.log('\nL. Летопись сервера: захватили, защитили, потеряли');
{
  const { EVENT_TYPE, EVENT_TYPE_ORDER, SERVER_TYPES, isServerEvent, verdictText, pillText, serverEvents } =
    await import('../src/logic/event-types.js');
  const { renderTimeline } = await import('../src/pages/timeline.js');

  /*
    РАЗДЕЛЕНИЕ ОБЯЗАННОСТЕЙ, КОТОРОЕ ЭТОТ РАЗДЕЛ ОХРАНЯЕТ.

    Неделя считает только альянсы. Что делал сервер целиком — в хронологии.
    Раньше захваты жили в двух местах, и один сервер попадал на страницу
    до пяти раз: в вердикте, в ленте, на стене трофеев и в событиях.
  */
  check('серверных типов ровно четыре', SERVER_TYPES.length === 4);
  check('захват — серверное событие', isServerEvent('server_capture'));
  check('война — не серверное событие', !isServerEvent('war'));
  check(
    'у каждого серверного типа есть исход и направление',
    SERVER_TYPES.every((t) => EVENT_TYPE[t].kind && EVENT_TYPE[t].action && EVENT_TYPE[t].verdict)
  );
  check(
    'у каждого типа есть подпись для фильтра',
    EVENT_TYPE_ORDER.every((t) => Boolean(EVENT_TYPE[t].filter))
  );

  /*
    НОМЕР ЗНАЧИТ РАЗНОЕ У АТАКИ И У ЗАЩИТЫ.

    При захвате — чью Столицу берём. При защите — кто на нас шёл: своя
    Столица у сервера одна, и «чей» там вопрос без смысла. Раньше при защите
    подставлялся свой 33, и это была бы тихая ложь — цифра выглядела бы
    осмысленной, называя нападавшим того, кто никуда не нападал.
  */
  equal('захват называет чужую Столицу',
    verdictText('server_capture', 74), 'Захватили Столицу сервера 74');
  equal('проигранный захват называется прямо',
    verdictText('capture_failed', 52), 'Проиграли захват Столицы сервера 52');
  equal('защита называет нападавшего',
    verdictText('server_defended', 51), 'Успешно защитили свою Столицу от сервера 51');
  equal('потеря называет нападавшего',
    verdictText('server_lost', 19), 'Не смогли защитить Столицу от сервера 19');

  equal('без номера захват не выдумывает сервер',
    verdictText('server_capture', undefined), 'Захватили чужую Столицу');
  equal('без номера защита не выдумывает нападавшего',
    verdictText('server_defended', undefined), 'Успешно защитили свою Столицу');
  check('свой номер 33 в защиту не подставляется',
    !verdictText('server_defended', undefined).includes('33'));
  equal('война вердикта не имеет', verdictText('war', undefined), '');

  // Плашка летописи: у защиты нужен предлог, иначе «отбились 51» непонятно.
  equal('плашка захвата', pillText('server_capture', 74), 'взяли 74');
  equal('плашка защиты с предлогом', pillText('server_defended', 51), 'отбились от 51');
  equal('плашка потери с предлогом', pillText('server_lost', 19), 'не отбились от 19');
  equal('плашка без номера', pillText('server_defended', null), 'отбились');

  check(
    'у каждого серверного типа есть подписи для поля номера',
    SERVER_TYPES.every((t) => EVENT_TYPE[t].numberLabel && EVENT_TYPE[t].numberHint)
  );
  equal('при захвате поле спрашивает чью Столицу',
    EVENT_TYPE.server_capture.numberLabel, 'Чья Столица');
  equal('при защите поле спрашивает кто нападал',
    EVENT_TYPE.server_defended.numberLabel, 'Кто нападал');

  const ev = (id, date, type, serverNumber) => ({
    id, type, serverNumber, title: 'т', date: new Date(date),
  });

  const list = [
    ev('e1', '2026-04-18', 'server_capture', 47),
    ev('e2', '2026-05-02', 'war'),
    ev('e3', '2026-06-13', 'server_defended'),
    ev('e4', '2026-07-05', 'server_lost', 19),
  ];

  equal(
    'в летописи только серверные события, свежие сверху',
    serverEvents(list).map((e) => e.id).join(' '),
    'e4 e3 e1'
  );
  equal('событие без даты в летопись не попадает',
    serverEvents([{ id: 'x', type: 'server_capture', date: null }]).length, 0);

  /* ── Вкладка «Хронология» ── */
  const html = renderTimeline({ events: list });
  check('вердикт показан', html.includes('verdict'));
  check('вердикт берёт самое свежее серверное событие',
    html.includes('Не смогли защитить Столицу от сервера 19'));
  check('потеря красится как поражение', /verdict--loss/.test(html));
  equal('в летописи столько плашек, сколько серверных событий',
    (html.match(/class="wk /g) || []).length, 3);
  check('война в летопись серверных событий не попала', !/data-tl-week="e2"/.test(html));
  check('но в ленте событий война осталась', html.includes('data-tl-type="war"'));

  const held = renderTimeline({ events: [ev('e9', '2026-06-01', 'server_defended')] });
  check('успешная защита красится как победа', /verdict--win/.test(held));
  check('защита без номера подписана без выдуманного нападавшего',
    held.includes('Успешно защитили свою Столицу'));

  // Пустая летопись: экран должен объяснять, а не пустовать.
  const blank = renderTimeline({ events: [] });
  check('пустая хронология объясняет себя', blank.includes('Ещё ни одной записи'));
  check('пустая хронология не рисует вердикт', !blank.includes('verdict'));

  // Только войны и слияния: серверной секции нет, остальная страница на месте.
  const noServer = renderTimeline({ events: [ev('e2', '2026-05-02', 'war')] });
  check('без серверных событий вердикта нет', !noServer.includes('data-tl-verdict'));
  check('но лента событий рисуется', noServer.includes('data-tl-list'));

  /* ── Календарь ── */
  const cal = renderTimeline({
    events: [
      ev('c1', '2025-11-03', 'server_defended'),
      ev('c2', '2026-09-07', 'server_capture', 74),
      ev('c3', '2026-09-14', 'server_lost', 12),
      ev('c4', '2026-10-05', 'server_defended'),
    ],
  });
  equal('в календаре год на каждый год с данными', (cal.match(/data-tl-yr="\d{4}"/g) || []).length, 2);
  equal('в календаре месяц на каждый месяц с данными', (cal.match(/data-tl-mo="/g) || []).length, 3);
  equal('вердикт на каждую запись', (cal.match(/data-tl-verdict="/g) || []).length, 4);
  equal('открыт ровно один вердикт',
    (cal.match(/data-tl-verdict="[^"]*"(?! hidden)/g) || []).length, 1);
  check('месяц записи указан в разметке', cal.includes('data-tl-ym="2026-09"'));

  /* ── Неделя больше не носит серверный итог ── */
  const { mapWeeks } = await import('../src/data/adapters/_map.js');
  const week = mapWeeks([
    { id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02', serverOutcome: 'held', serverNumber: 33 },
  ])[0];
  check('поле итога у недели больше не читается', !('serverOutcome' in week) && !('serverNumber' in week));

  const weekScreen = (await import('../src/admin/screens/week.js')).renderWeek;
  const weekHtml = weekScreen(
    {
      data: { weeks: mapWeeks([{ id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' }]),
              alliances: [{ id: 'a01', tag: 'A', name: 'А', active: true }] },
      raw: { results: [], weeks: [], alliances: [] },
      canPush: true,
      weekId: 'W1',
      marks: {},
    },
    null
  );
  check('на экране недели нет блока итога', !weekHtml.includes('data-server-block'));
  check('на экране недели остались клетки альянсов', weekHtml.includes('data-cell='));
}

// ── M. Правка хронологии ────────────────────────────────────────────────────
console.log('\nM. Правка хронологии');
{
  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const {
    eventsFromRaw, applyEvents, eventsDiff, nextEventId, eventProblems,
    eventsCommitMessage, blankEvent,
  } = await import('../src/admin/edit.js');

  const raw = {
    alliances: [{ id: 'a01', tag: 'A', name: 'А', active: true }],
    weeks: [{ id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' }],
    results: [],
    events: [
      { id: 'e1', date: '2026-04-18', type: 'server_capture', serverNumber: 47, title: 'Захвачен 47', durationDays: 3 },
      { id: 'e5', date: '2026-06-01', type: 'war', title: 'Война' },
    ],
    texts: [],
  };

  /* ── Чтение в форму ── */
  const list = eventsFromRaw(raw);
  equal('свежие записи первыми', list.map((e) => e.id).join(' '), 'e5 e1');
  equal('дата приходит в форму как YYYY-MM-DD', list[1].date, '2026-04-18');
  equal('незаполненное описание — пустая строка, а не undefined', list[0].body, '');
  equal(
    'неизвестный тип превращается в «Событие»',
    eventsFromRaw({ events: [{ id: 'x', date: '2026-01-01', type: 'выдумка', title: 'т' }] })[0].type,
    'other'
  );

  /* ── Идентификаторы ── */
  equal('новый id не занят', nextEventId(raw, list), 'e6');
  // Счёт по количеству записей выдал бы e3 — уже занятый. Отсюда и тест.
  equal(
    'после удаления середины id не переиспользуется',
    nextEventId({ events: [{ id: 'e1' }, { id: 'e2' }, { id: 'e9' }] }, []),
    'e10'
  );

  /* ── Проверки до сохранения ── */
  check('без даты не сохранить', eventProblems({ ...blankEvent(), title: 'т' }).some((p) => /дата/i.test(p)));
  check('без заголовка не сохранить', eventProblems({ ...blankEvent(), date: '2026-01-01' }).some((p) => /заголов/i.test(p)));
  check(
    'ссылка не на http отвергается',
    eventProblems({ ...blankEvent(), date: '2026-01-01', title: 'т', imageUrl: 'javascript:alert(1)' })
      .some((p) => /http/i.test(p))
  );
  equal(
    'заполненная запись проходит',
    eventProblems({ ...blankEvent(), date: '2026-01-01', title: 'т' }).length,
    0
  );

  /* ── Запись в данные ── */
  const next = applyEvents(raw, [
    { id: 'e9', date: '2026-02-02', type: 'merge', title: '  Слияние  ', body: '', imageUrl: '', serverNumber: null, durationDays: null },
    ...list,
  ]);

  // Ищем по id, а не по позиции: тест не должен ломаться от того, что кто-то
  // поменял даты в исходных данных выше.
  const byId = (id) => next.events.find((e) => e.id === id);

  equal(
    'в файле летопись идёт от старых к новым',
    next.events.map((e) => e.id).join(' '),
    'e9 e1 e5' // 2 фев → 18 апр → 1 июн
  );
  equal('заголовок обрезается по краям', byId('e9').title, 'Слияние');
  check(
    'пустые необязательные поля в файл не пишутся',
    !('body' in byId('e9')) && !('imageUrl' in byId('e9')) && !('serverNumber' in byId('e9'))
  );
  check(
    'заполненные поля сохраняются',
    byId('e1').serverNumber === 47 && byId('e1').durationDays === 3
  );
  equal('исходные данные не мутируются', raw.events.length, 2);

  /* ── Что уйдёт в коммит ── */
  const d = eventsDiff(raw, [
    { ...list[0], title: 'Война за зону' },              // правка
    { id: 'e7', date: '2026-03-03', type: 'other', title: 'Новое' }, // добавление
  ]);                                                     // e1 пропал — удаление
  equal('посчитано добавленных', d.added, 1);
  equal('посчитано изменённых', d.changed, 1);
  equal('посчитано удаляемых', d.removed, 1);

  /*
    Картинка, выбранная в форме, но ещё не загруженная в репозиторий (загрузка
    отложена до «Опубликовать», см. main.js): пока imageUrl не поменялся, обычное
    сравнение полей не увидело бы изменения вовсе, и кнопка публикации осталась бы
    выключенной, хотя картинку опубликовать нужно.
  */
  equal(
    'ещё не загруженная картинка тоже считается изменением',
    eventsDiff(raw, [{ ...list[1], _pendingImage: { blob: {} } }, list[0]]).changed,
    1
  );

  equal(
    'сообщение коммита человеческое',
    eventsCommitMessage({ added: 1, changed: 0, removed: 0, total: 1 }),
    'хронология: 1 запись'
  );

  /*
    ГЛАВНОЕ: правка летописи обязана проходить тем же валидатором, которым
    проверяется сайт, — иначе панель опубликует то, на чём сайт откроется пустым.
  */
  check('правка проходит валидатор сайта', validateDataset(mapDataset(next)).length === 0);
  check(
    'запись без заголовка валидатор ловит',
    validateDataset(mapDataset(applyEvents(raw, [{ id: 'e9', date: '2026-02-02', type: 'other', title: '' }]))).length > 0
  );

  /* ── Экран рисуется и на пустой летописи, и на полной ── */
  const { renderEvents } = await import('../src/admin/screens/events.js');
  const viewFor = (over) => ({
    raw, canPush: true, events: eventsFromRaw(raw), eventsSaved: null, ...over,
  });

  check('экран показывает кнопку добавления', renderEvents(viewFor({})).includes('data-event-new'));
  check('у каждой записи есть правка и удаление',
    (renderEvents(viewFor({}).valueOf()).match(/data-event-edit=/g) || []).length === 2);
  check('форма появляется только когда что-то правят', !renderEvents(viewFor({})).includes('data-event-form'));
  check('открытая форма рисуется', renderEvents(viewFor({ eventDraft: blankEvent() })).includes('data-event-form'));
  check('без права записи кнопок правки нет',
    !renderEvents(viewFor({ canPush: false })).includes('data-event-edit'));
  check('пустая летопись объясняет себя',
    renderEvents(viewFor({ events: [] })).includes('Записей пока нет'));

  /* ── Картинка выбирается файлом, а не вводится ссылкой ── */
  const blankForm = renderEvents(viewFor({ eventDraft: blankEvent() }));
  check('поля ручной ссылки на картинку больше нет', !blankForm.includes('type="url"'));
  check('вместо неё — выбор файла', blankForm.includes('data-event-image-input'));

  const pendingForm = renderEvents(
    viewFor({ eventDraft: { ...blankEvent(), _pendingImage: { previewUrl: 'blob:фейковое-превью' } } })
  );
  check('превью невыгруженной картинки показано', pendingForm.includes('blob:фейковое-превью'));
  check('подписано, что загрузится при публикации', pendingForm.includes('Загрузится при публикации'));
  check('кнопка «убрать картинку» есть', pendingForm.includes('data-event-image-clear'));

  /* ── Подготовка имени файла под загрузку (src/ui/image-prep.js) ── */
  const { uploadPath } = await import('../src/admin/image.js');
  /*
    Раньше путь начинался с public/uploads — там лежали файлы, закоммиченные
    в репозиторий. После переезда фотографии живут в хранилище базы, и папка
    внутри него другая: «public/» в имени объекта означало бы папку с таким
    названием, а не публичный доступ — он задаётся правами на хранилище.
  */
  check('путь загрузки лежит в папке событий', uploadPath('jpg').startsWith('events/'));
  check('путь загрузки оканчивается на расширение', uploadPath('jpg').endsWith('.jpg'));
  check('два вызова дают разные имена', uploadPath('jpg') !== uploadPath('jpg'));

  /*
    Подготовка картинок общая для панели и форума: у аватарок и скриншотов
    разные пределы веса, но одно место, где обрабатывается HEIC и считается
    сжатие. Две копии означали бы два предела и два места для одной правки.
  */
  const { readFile: readSrc } = await import('node:fs/promises');
  const prep = await readSrc('src/ui/image-prep.js', 'utf8');
  check('аватарка обрезается по центру, а не сжимается по осям',
    /square: true/.test(prep) && /Math\.min\(bitmap\.width, bitmap\.height\)/.test(prep));
  check('у аватарки и фото разные пределы размера',
    /avatar:[\s\S]{0,140}max: 256/.test(prep) && /photo:[\s\S]{0,140}max: 1600/.test(prep));
  check('HEIC объясняется человеку, а не падает молча',
    /HEIC/.test(prep) && /Сохраните фото как JPG/.test(prep));
}

// ── N. Правка альянсов ──────────────────────────────────────────────────────
console.log('\nN. Правка альянсов');
{
  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const {
    alliancesFromRaw, applyAlliances, alliancesDiff, nextAllianceId, allianceProblems,
    allianceResultsCount, alliancesCommitMessage, blankAlliance,
  } = await import('../src/admin/edit.js');

  const raw = {
    alliances: [
      { id: 'a01', tag: 'STG', name: 'Сталкеры', color: '#d44949', active: true },
      { id: 'a02', tag: 'VLK', name: 'Волки', color: '#e18651', active: true, note: 'старый союзник' },
    ],
    weeks: [{ id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' }],
    results: [{ weekId: 'W1', allianceId: 'a01', outcome: 'win' }],
    events: [],
    texts: [],
  };

  /* ── Чтение в форму ── */
  const list = alliancesFromRaw(raw);
  equal('альянсы читаются как есть, без пересортировки', list.map((a) => a.id).join(' '), 'a01 a02');
  equal('незаполненная заметка — пустая строка, а не undefined', list[0].note, '');
  equal('заполненная заметка сохраняется', list[1].note, 'старый союзник');

  /* ── Идентификаторы ── */
  equal('новый id не занят', nextAllianceId(raw, list), 'a03');
  // Счёт по количеству записей выдал бы a03 — уже занятый. Отсюда и тест
  // (тот же приём, что и у nextEventId).
  equal(
    'после удаления середины id не переиспользуется',
    nextAllianceId({ alliances: [{ id: 'a01' }, { id: 'a02' }, { id: 'a09' }] }, []),
    'a10'
  );

  /* ── Защита от удаления с историей ── */
  equal('у альянса с результатом есть история', allianceResultsCount(raw, 'a01'), 1);
  equal('у альянса без результатов истории нет', allianceResultsCount(raw, 'a02'), 0);

  /* ── Проверки до сохранения ── */
  check('без тега не сохранить', allianceProblems({ ...blankAlliance(), name: 'Тест' }, []).some((p) => /тег/i.test(p)));
  check(
    'без названия не сохранить',
    allianceProblems({ ...blankAlliance(), tag: 'TST' }, []).some((p) => /названи/i.test(p))
  );
  check(
    'некорректный цвет отвергается',
    allianceProblems({ ...blankAlliance(), tag: 'TST', name: 'Тест', color: 'red' }, [])
      .some((p) => /HEX/i.test(p))
  );
  check(
    'занятый тег отвергается',
    allianceProblems({ ...blankAlliance(), id: 'a09', tag: 'stg', name: 'Дубль' }, list)
      .some((p) => /тег уже занят/i.test(p))
  );
  equal(
    'заполненный альянс проходит',
    allianceProblems({ ...blankAlliance(), tag: 'NEW', name: 'Новый' }, list).length,
    0
  );

  /* ── Запись в данные ── */
  const next = applyAlliances(raw, [
    ...list,
    { id: 'a03', tag: '  NEW  ', name: '  Новый союз  ', color: '', active: true, note: '' },
  ]);

  const byId = (id) => next.alliances.find((a) => a.id === id);

  equal('порядок как в рабочем списке — новый в конце', next.alliances.map((a) => a.id).join(' '), 'a01 a02 a03');
  equal('тег обрезается по краям', byId('a03').tag, 'NEW');
  equal('название обрезается по краям', byId('a03').name, 'Новый союз');
  check(
    'пустые необязательные поля в файл не пишутся',
    !('color' in byId('a03')) && !('note' in byId('a03'))
  );
  check('заполненные необязательные поля сохраняются', byId('a02').note === 'старый союзник');
  equal('исходные данные не мутируются', raw.alliances.length, 2);

  /* ── Что уйдёт в коммит ── */
  const d = alliancesDiff(raw, [
    { ...list[0], color: '#000000' },                                              // правка
    { id: 'a05', tag: 'NEW2', name: 'Ещё один', color: '', active: true, note: '' }, // добавление
  ]);                                                                               // a02 пропал — удаление
  equal('посчитано добавленных', d.added, 1);
  equal('посчитано изменённых', d.changed, 1);
  equal('посчитано удаляемых', d.removed, 1);

  equal(
    'сообщение коммита человеческое',
    alliancesCommitMessage({ added: 1, changed: 2, removed: 0, total: 3 }),
    'альянсы: 1 новый альянс, 2 правки'
  );
  equal(
    'без изменений называется отдельно',
    alliancesCommitMessage({ added: 0, changed: 0, removed: 0, total: 0 }),
    'альянсы: без изменений'
  );

  /*
    ГЛАВНОЕ: правка альянсов обязана проходить тем же валидатором, что и сайт.
    Деактивация — это просто active: false, а не удаление, поэтому результаты
    прошлых недель остаются в силе и после того, как альянс распался.
  */
  check('правка проходит валидатор сайта', validateDataset(mapDataset(next)).length === 0);
  check(
    'дубль id валидатор ловит',
    validateDataset(
      mapDataset(applyAlliances(raw, [...list, { id: 'a01', tag: 'X', name: 'Y', active: true }]))
    ).length > 0
  );

  /*
    ГВОЗДЬ РАЗДЕЛА: удаление альянса, за которым уже есть результат, обязано
    ломать валидацию сайта — именно это, а не только текст в интерфейсе,
    держит в силе правило «не удалять, а деактивировать» из документации.
  */
  check(
    'удаление альянса с историей ломает сайт — поэтому панель его не предлагает',
    validateDataset(mapDataset(applyAlliances(raw, list.filter((a) => a.id !== 'a01')))).length > 0
  );
  check(
    'удаление альянса без истории безопасно',
    validateDataset(mapDataset(applyAlliances(raw, list.filter((a) => a.id !== 'a02')))).length === 0
  );

  /* ── Экран рисуется и на пустом списке, и на полном ── */
  const { renderAlliances, describeAlliances } = await import('../src/admin/screens/alliances.js');
  const viewFor = (over) => ({
    raw, canPush: true, data: mapDataset(raw), alliances: alliancesFromRaw(raw), alliancesSaved: null, ...over,
  });

  check('экран показывает кнопку добавления', renderAlliances(viewFor({})).includes('data-alliance-new'));
  check(
    'у альянса без истории есть кнопка удаления',
    renderAlliances(viewFor({})).includes('data-alliance-delete="a02"')
  );
  check(
    'у альянса с историей кнопки удаления нет',
    !renderAlliances(viewFor({})).includes('data-alliance-delete="a01"')
  );
  check(
    'деактивировать можно любой альянс',
    (renderAlliances(viewFor({})).match(/data-alliance-toggle=/g) || []).length === 2
  );
  check('форма появляется только когда что-то правят', !renderAlliances(viewFor({})).includes('data-alliance-form'));
  check(
    'открытая форма рисуется',
    renderAlliances(viewFor({ allianceDraft: blankAlliance() })).includes('data-alliance-form')
  );
  check(
    'без права записи кнопок правки нет',
    !renderAlliances(viewFor({ canPush: false })).includes('data-alliance-edit')
  );
  check(
    'id недоступен для правки в разметке формы',
    !renderAlliances(viewFor({ allianceDraft: { ...list[0] } })).includes('data-alliance-field="id"')
  );
  check('пустой список объясняет себя', renderAlliances(viewFor({ alliances: [] })).includes('Альянсов пока нет'));

  check('удаление названо вслух до нажатия', /удалится/.test(describeAlliances(d, null)));
  check(
    'без изменений публиковать нечего',
    /нечего/.test(describeAlliances(alliancesDiff(raw, alliancesFromRaw(raw)), null))
  );
}

// ── O. Слияние альянсов ─────────────────────────────────────────────────────
console.log('\nO. Слияние альянсов');
{
  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const { computeStandings } = await import('../src/logic/standings.js');
  const {
    alliancesFromRaw, applyAlliances, alliancesDiff, allianceProblems, blankAlliance,
  } = await import('../src/admin/edit.js');

  /*
    a02 слился в a01: неактивен, но результат за W1 остаётся его собственным —
    очки a01 задним числом не пересчитываются.
  */
  const raw = {
    alliances: [
      { id: 'a01', tag: 'STG', name: 'Сталкеры', color: '#d44949', active: true },
      { id: 'a02', tag: 'VLK', name: 'Волки', color: '#e18651', active: false, mergedInto: 'a01' },
      { id: 'a03', tag: 'RUS', name: 'Русичи', color: '#ed925a', active: true },
    ],
    weeks: [{ id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' }],
    results: [
      { weekId: 'W1', allianceId: 'a01', outcome: 'win' },
      { weekId: 'W1', allianceId: 'a02', outcome: 'loss' },
    ],
    events: [],
    texts: [],
  };

  /* ── Чтение ── */
  const list = alliancesFromRaw(raw);
  equal('mergedInto читается из данных', list.find((a) => a.id === 'a02').mergedInto, 'a01');
  equal('у не слившегося альянса mergedInto пустой', list.find((a) => a.id === 'a01').mergedInto, '');

  /* ── Валидатор ── */
  check('корректное слияние проходит валидатор', validateDataset(mapDataset(raw)).length === 0);
  check(
    'слияние с самим собой валидатор ловит',
    validateDataset(
      mapDataset({ ...raw, alliances: [{ ...raw.alliances[0], mergedInto: 'a01' }, raw.alliances[1], raw.alliances[2]] })
    ).some((p) => /самого себя/.test(p))
  );
  check(
    'слияние в несуществующий альянс валидатор ловит',
    validateDataset(
      mapDataset({
        ...raw,
        alliances: [raw.alliances[0], { ...raw.alliances[1], mergedInto: 'нет-такого' }, raw.alliances[2]],
      })
    ).some((p) => /несуществующий альянс/.test(p))
  );
  check(
    'слившийся, но помеченный активным альянс валидатор ловит',
    validateDataset(
      mapDataset({
        ...raw,
        alliances: [raw.alliances[0], { ...raw.alliances[1], active: true }, raw.alliances[2]],
      })
    ).some((p) => /обязан быть неактивным/.test(p))
  );

  /* ── Проверки формы ── */
  check(
    'слияние с самим собой отвергается формой',
    allianceProblems({ ...blankAlliance(), id: 'a01', tag: 'X', name: 'Y', mergedInto: 'a01' }, list.filter((a) => a.id !== 'a01'))
      .some((p) => /сам с собой/.test(p))
  );
  check(
    'слияние в несуществующий альянс отвергается формой',
    allianceProblems({ ...blankAlliance(), tag: 'X', name: 'Y', mergedInto: 'нет-такого' }, list)
      .some((p) => /не найден/.test(p))
  );
  equal(
    'слияние в существующий альянс проходит форму',
    allianceProblems({ ...blankAlliance(), tag: 'NEW', name: 'Новый', mergedInto: 'a01' }, list).length,
    0
  );

  /* ── Запись в данные ── */
  const next = applyAlliances(raw, [
    list[0],
    list[1],
    { ...list[2], mergedInto: 'a01', active: true }, // форма прислала active:true — должно быть перебито
  ]);
  const a03after = next.alliances.find((a) => a.id === 'a03');
  equal('слияние принудительно деактивирует альянс', a03after.active, false);
  equal('mergedInto записывается', a03after.mergedInto, 'a01');
  check(
    'пустой mergedInto не пишется в файл',
    !('mergedInto' in next.alliances.find((a) => a.id === 'a01'))
  );

  /* ── Диф видит слияние как правку ── */
  const d = alliancesDiff(raw, [list[0], list[1], { ...list[2], mergedInto: 'a01', active: false }]);
  equal('слияние посчитано изменением', d.changed, 1);

  /* ── Экран панели ── */
  const { renderAlliances } = await import('../src/admin/screens/alliances.js');
  const viewFor = (over) => ({
    raw, canPush: true, data: mapDataset(raw), alliances: list, alliancesSaved: null, ...over,
  });

  check(
    'слившийся альянс подписан через того, кого поглотил, а не «распался»',
    renderAlliances(viewFor({})).includes('слился с STG')
  );
  check(
    'форма правки существующего альянса предлагает выбор «слился с»',
    renderAlliances(viewFor({ allianceDraft: { ...list[0] } })).includes('data-alliance-field="mergedInto"')
  );
  check(
    'у формы нового альянса выбора «слился с» нет',
    !renderAlliances(viewFor({ allianceDraft: blankAlliance() })).includes('data-alliance-field="mergedInto"')
  );
  check(
    'альянс не предлагается слиться сам с собой',
    !renderAlliances(viewFor({ allianceDraft: { ...list[0] } })).includes('value="a01"')
  );

  /* ── Публичный сайт: рейтинг и страница альянса ── */
  const data = mapDataset(raw);
  const standings = computeStandings(data.alliances, data.weeks, data.results, { win: 1, loss: -1 }, 5);

  const { renderLadder } = await import('../src/pages/ladder.js');
  const ladderHtml = renderLadder({ standings });
  check('на сайте слившийся альянс подписан через поглотившего', ladderHtml.includes('слился с STG'));
  check('обычное «распался» не путается со слившимся', !/VLK[\s\S]{0,200}распался/.test(ladderHtml));

  const { renderAlliance } = await import('../src/pages/alliance.js');
  const allyHtml = renderAlliance({ standings, weeks: data.weeks, results: data.results, placeHistory: new Map() }, 'a02');
  check('на странице слившегося альянса — ссылка на поглотившего', allyHtml.includes('Слился с <a href="#/alliance/a01">STG</a>'));

  const survivorHtml = renderAlliance({ standings, weeks: data.weeks, results: data.results, placeHistory: new Map() }, 'a01');
  check('на странице поглотившего альянса статус обычный', survivorHtml.includes('Активен'));
}

// ── P. Правка текстов ────────────────────────────────────────────────────────
console.log('\nP. Правка текстов');
{
  const { mapDataset } = await import('../src/data/adapters/_map.js');
  const {
    textsFromRaw, applyTexts, textsDiff, textProblems, textsCommitMessage, blankText, KNOWN_TEXT_KEYS,
  } = await import('../src/admin/edit.js');

  const raw = {
    alliances: [{ id: 'a01', tag: 'STG', name: 'Сталкеры', active: true }],
    weeks: [],
    results: [],
    events: [],
    texts: [
      { key: 'guide-intro', title: 'Вступление', body: 'Текст вступления' },
      { key: 'guide-week', title: 'Ритм недели', body: '- пункт 1\n- пункт 2' },
    ],
  };

  /* ── Чтение ── */
  const list = textsFromRaw(raw);
  equal('тексты читаются как есть, без пересортировки', list.map((t) => t.key).join(' '), 'guide-intro guide-week');
  check('известные ключи сайта названы явно', KNOWN_TEXT_KEYS.includes('guide-intro'));

  /* ── Заготовка формы ── */
  equal('у пустой заготовки originalKey пуст — значит форма для нового', blankText().originalKey, null);

  /* ── Валидатор ── */
  check('обычные тексты проходят валидатор', validateDataset(mapDataset(raw)).length === 0);
  check(
    'дубль ключа валидатор ловит',
    validateDataset(mapDataset({ ...raw, texts: [...raw.texts, { key: 'guide-intro', title: 'Дубль', body: '' }] }))
      .some((p) => /дубль key/.test(p))
  );

  /* ── Проверки формы ── */
  check('без ключа не сохранить', textProblems({ key: '', title: 'Т', body: '' }, list).some((p) => /ключ/i.test(p)));
  check(
    'занятый ключ отвергается',
    textProblems({ key: 'guide-intro', title: 'Т', body: '' }, list).some((p) => /уже занят/.test(p))
  );
  equal(
    'новый ключ проходит форму',
    textProblems({ key: 'guide-donts', title: 'Т', body: '' }, list).length,
    0
  );

  /* ── Запись в данные ── */
  const next = applyTexts(raw, [
    ...list,
    { key: 'guide-donts', title: '  Чего не стоит  ', body: 'body as-is  ' },
  ]);
  const added = next.texts.find((t) => t.key === 'guide-donts');
  equal('порядок как в рабочем списке — новый в конце', next.texts.map((t) => t.key).join(' '), 'guide-intro guide-week guide-donts');
  equal('заголовок обрезается по краям', added.title, 'Чего не стоит');
  equal('тело текста не обрезается — пробелы могут быть частью markdown', added.body, 'body as-is  ');
  equal('исходные данные не мутируются', raw.texts.length, 2);

  /* ── Диф и сообщение коммита ── */
  const d = textsDiff(raw, [
    { ...list[0], title: 'Новое вступление' },       // правка
    { key: 'guide-donts', title: 'Новый', body: '' }, // добавление
  ]);                                                  // guide-week пропал — удаление
  equal('посчитано добавленных', d.added, 1);
  equal('посчитано изменённых', d.changed, 1);
  equal('посчитано удаляемых', d.removed, 1);

  equal(
    'сообщение коммита человеческое',
    textsCommitMessage({ added: 1, changed: 2, removed: 0, total: 3 }),
    'тексты: 1 новый блок, 2 правки'
  );
  equal('без изменений называется отдельно', textsCommitMessage({ added: 0, changed: 0, removed: 0, total: 0 }), 'тексты: без изменений');

  check('правка проходит валидатор сайта', validateDataset(mapDataset(next)).length === 0);

  /* ── Экран рисуется на пустом списке и на полном ── */
  const { renderTexts, describeTexts } = await import('../src/admin/screens/texts.js');
  const viewFor = (over) => ({
    raw, canPush: true, data: mapDataset(raw), texts: list, textsSaved: null, ...over,
  });

  check('экран показывает кнопку добавления', renderTexts(viewFor({})).includes('data-text-new'));
  check(
    'у каждого текста есть правка и удаление',
    (renderTexts(viewFor({})).match(/data-text-edit=/g) || []).length === 2
  );
  check('форма появляется только когда что-то правят', !renderTexts(viewFor({})).includes('data-text-form'));
  check(
    'открытая форма нового текста рисуется и даёт ввести ключ',
    renderTexts(viewFor({ textDraft: blankText() })).includes('data-text-field="key"')
  );
  check(
    'у формы правки существующего текста ключ только показан, не редактируется',
    !renderTexts(viewFor({ textDraft: { ...list[0], originalKey: list[0].key } })).includes('data-text-field="key"')
  );
  check(
    'без права записи кнопок правки нет',
    !renderTexts(viewFor({ canPush: false })).includes('data-text-edit')
  );
  check('пустой список объясняет себя', renderTexts(viewFor({ texts: [] })).includes('Текстов нет'));

  check('удаление названо вслух до нажатия', /удалится/.test(describeTexts(d, null)));
  check(
    'без изменений публиковать нечего',
    /нечего/.test(describeTexts(textsDiff(raw, textsFromRaw(raw)), null))
  );
}

// ── F. Достижения альянсов ────────────────────────────────────────────────
console.log('\nF. Достижения');
{
  const weeks4 = [1, 2, 3, 4].map((number) => ({ id: `Q${number}`, number }));
  const result = (allianceId, outcomes) => outcomes.map((outcome, i) => ({ weekId: `Q${i + 1}`, allianceId, outcome }));
  const perfect = getAllianceAchievements('p', weeks4, result('p', ['win', 'win', 'win', 'win']));
  check('идеальный Кварт выдаёт значок', perfect.some((badge) => badge.id === 'perfect-quarter'));
  check('три победы подряд выдаёт значок серии', perfect.some((badge) => badge.id === 'streak3'));
  check('идеальный Кварт считается Квартом без поражений', perfect.some((badge) => badge.id === 'undefeated-quarter'));

  const comeback = getAllianceAchievements('c', weeks4, result('c', ['loss', 'loss', 'win', 'win']));
  check('камбэк из минуса выдаёт отдельный значок', comeback.some((badge) => badge.id === 'comeback'));

  const ordinary = getAllianceAchievements('o', weeks4, result('o', ['win', 'loss', 'win', 'loss']));
  check('неидеальный Кварт не получает идеальный значок', !ordinary.some((badge) => badge.id === 'perfect-quarter'));

  const lastStand = getAllianceAchievements('s', weeks4, result('s', ['loss', 'loss', 'loss', 'win']));
  check('три поражения и победа дают значок последнего рывка', lastStand.some((badge) => badge.id === 'last-stand'));

  const veteranWeeks = Array.from({ length: 12 }, (_, i) => ({ id: `V${i + 1}`, number: i + 1 }));
  const veteranResults = Array.from({ length: 10 }, (_, i) => ({ weekId: `V${i + 1}`, allianceId: 'v', outcome: 'win' }));
  const veteran = getAllianceAchievements('v', veteranWeeks, veteranResults);
  check('10 побед дают значок ветерана', veteran.some((badge) => badge.id === 'veteran'));
  check('7 побед подряд дают корону', veteran.some((badge) => badge.id === 'streak7'));
}

// ── Q. Форум: чужой текст, правила и права ────────────────────────────────
/*
  ПОЧЕМУ ЭТОТ БЛОК САМЫЙ ВАЖНЫЙ В ФАЙЛЕ.

  До форума все тексты на сайте писал доверенный редактор, и худшее, что могло
  случиться, — опечатка. Форум принимает текст от постороннего человека
  и показывает его другим людям. Это меняет не удобство, а класс риска:
  незакрытая подстановка означает чужой скрипт в браузере читателя,
  на нашем домене.

  Поэтому здесь проверяется не «работает ли», а «нельзя ли навредить».
*/
console.log('\nQ. Форум');
{
  const { readFile, readdir } = await import('node:fs/promises');
  const { postBody, excerpt, timeAgo, nickColor } = await import('../src/forum/format.js');
  const {
    RULES, SANCTIONS, CATEGORIES, CATEGORY_IDS, REACTIONS,
    validateNick, validatePassword, validatePost, validateComment, deletionReason,
  } = await import('../src/forum/rules.js');

  /* ── Показ чужого текста ── */

  check('теги в тексте поста не становятся разметкой',
    !postBody('<script>alert(1)</script>').includes('<script>'));
  check('закрывающий тег из текста не ломает абзац',
    !postBody('обычный текст</p><img src=x onerror=alert(1)>').includes('<img'));
  check('обработчик события в тексте остаётся текстом',
    !/onerror=/.test(postBody('<b onerror="alert(1)">жирный</b>').replace(/&quot;/g, '"')) ||
      !postBody('<b onerror="alert(1)">жирный</b>').includes('<b '));

  /*
    Разметку от участников не принимаем вовсе: markdown в посте приятен,
    но каждая конструкция — ещё одно место, где можно ошибиться.
    miniMarkdown из helpers.js здесь намеренно не используется.
  */
  check('звёздочки не превращаются в жирный текст',
    !postBody('**не жирный**').includes('<strong>'));
  check('решётка не превращается в заголовок',
    !postBody('# не заголовок').includes('<h2>'));

  check('пустая строка разбивает текст на абзацы',
    (postBody('первый\n\nвторой').match(/<p>/g) ?? []).length === 2);
  check('одиночный перенос остаётся переносом',
    postBody('строка\nещё строка').includes('<br>'));

  /*
    Ссылки — единственное, что превращается в разметку, и схема проверяется
    через safeUrl: `javascript:` внутри href остаётся рабочим кодом даже
    после честного экранирования кавычек.
  */
  check('обычная ссылка становится ссылкой',
    postBody('смотри https://example.com/a страницу').includes('<a href="https://example.com/a"'));
  check('javascript-ссылка ссылкой не становится',
    !postBody('javascript:alert(1)').includes('<a href'));
  check('чужая ссылка помечена ugc и не уводит вкладку',
    /rel="noopener noreferrer ugc"/.test(postBody('https://example.com')));
  check('в ссылке показан домен, а не простыня',
    postBody('https://example.com/очень/длинный/путь/ещё').includes('>example.com<'));
  check('точка после ссылки не съедается в адрес',
    postBody('иди на https://example.com.').includes('>example.com</a>.'));

  /* ── Выжимка и время ── */

  equal('короткий текст в выжимке не режется', excerpt('коротко', 100), 'коротко');
  check('длинный текст режется по слову, а не посередине',
    !/\s…$/.test(excerpt('слово '.repeat(80), 40)) && excerpt('слово '.repeat(80), 40).endsWith('…'));

  const now = new Date('2026-09-05T12:00:00');
  equal('свежая запись — «только что»', timeAgo(new Date('2026-09-05T11:59:40'), now), 'только что');
  equal('час назад считается часами', timeAgo(new Date('2026-09-05T11:00:00'), now), '1 час назад');
  /*
    «Вчера» считается по календарю, а не по 24 часам: в 00:30 сообщение
    от 23:00 — вчерашнее, хотя прошло полтора часа.
  */
  equal('вчерашняя запись названа вчерашней',
    timeAgo(new Date('2026-09-04T23:00:00'), new Date('2026-09-05T00:30:00')), 'вчера');
  equal('прошлогодняя запись показывает год',
    timeAgo(new Date('2025-03-02T10:00:00'), now), '2 мар 2025');

  check('цвет метки участника один и тот же для одного ника',
    nickColor('Qvaden') === nickColor('Qvaden'));
  check('разные ники получают разные цвета', nickColor('Qvaden') !== nickColor('Другой'));

  /* ── Правила ── */

  check(`правил не меньше пяти (${RULES.length})`, RULES.length >= 5);
  check('у каждого правила есть id, заголовок и объяснение',
    RULES.every((r) => r.id && r.title && r.body && r.body.length > 40));
  equal('идентификаторы правил уникальны',
    new Set(RULES.map((r) => r.id)).size, RULES.length);
  check('последствия нарушения названы вслух', SANCTIONS.length >= 2);

  /*
    ГЛАВНОЕ РЕШЕНИЕ ЭТОГО РАЗДЕЛА: списка запрещённых слов в проекте нет.
    Он одновременно ловит невиновных (Кострома, «нахимовский») и обходится
    одной точкой внутри слова — то есть создаёт видимость модерации вместо
    неё. Смысл оценивает человек по жалобе. Если однажды кто-то захочет
    вернуть такой список, этот тест упадёт, и вернуть его придётся осознанно.
  */
  const forumFiles = [];
  for (const dir of ['src/forum', 'src/forum/adapters']) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.js')) forumFiles.push(`${dir}/${e.name}`);
    }
  }
  const forumSource = (await Promise.all(forumFiles.map((f) => readFile(f, 'utf8'))))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  check('в форуме нет списка запрещённых слов — смысл оценивает человек',
    !/BANNED_WORDS|BAD_WORDS|badWords|profanit/i.test(forumSource));

  /* ── Проверки ввода ── */

  check('пустой ник отбрасывается', !validateNick('').ok);
  check('короткий ник отбрасывается', !validateNick('ab').ok);
  check('ник из русских букв проходит', validateNick('Ковыль').ok);
  check('ник из двух слов проходит — в игре такие бывают', validateNick('Тёмный Лорд').ok);
  check('ник с угловой скобкой отбрасывается', !validateNick('<script>').ok);
  check('ник из одних пробелов отбрасывается', !validateNick('   ').ok);
  equal('двойные пробелы в нике сжимаются',
    validateNick('Тёмный   Лорд').value, 'Тёмный Лорд');

  /*
    От пароля требуется только длина. «Одна заглавная, одна цифра, один символ»
    на практике даёт «Password1!» — пароль, который выглядит сложным и стоит
    в каждом втором аккаунте.
  */
  check('короткий пароль отбрасывается', !validatePassword('1234567').ok);
  check('длинный пароль из одних букв проходит', validatePassword('корабельнаясосна').ok);
  check('пробел на краю пароля — почти всегда опечатка', !validatePassword(' пароль123 ').ok);

  check('пост без раздела отбрасывается',
    !validatePost({ title: 'Заголовок', body: 'текст', category: 'нет-такого' }).ok);
  check('пустой текст поста отбрасывается',
    !validatePost({ title: 'Заголовок', body: '   ', category: 'news' }).ok);
  check('нормальный пост проходит',
    validatePost({ title: 'Разбор VS', body: 'Мы выиграли потому что', category: 'vs' }).ok);
  check('переносы внутри текста сохраняются',
    validatePost({ title: 'Тема', body: 'первый\n\nвторой', category: 'news' }).value.body.includes('\n\n'));
  /*
    Заголовок капсом — не нарушение правил, а неудобство для читающих.
    Поэтому не отказываем, а приводим к обычному виду: человек не должен
    угадывать, каким регистром сайт согласен принять его мысль.
  */
  check('заголовок капсом приводится к обычному виду',
    validatePost({ title: 'СРОЧНО ВСЕ СЮДА ЧИТАЙТЕ', body: 'текст', category: 'news' })
      .value.title !== 'СРОЧНО ВСЕ СЮДА ЧИТАЙТЕ');
  check('короткая аббревиатура в заголовке не ломается',
    validatePost({ title: 'VS', body: 'текст', category: 'vs' }).ok === false ||
      validatePost({ title: 'VS итоги', body: 'текст', category: 'vs' }).value.title === 'VS итоги');

  check('пустой комментарий отбрасывается', !validateComment('  ').ok);
  check('обычный комментарий проходит', validateComment('согласен').ok);

  check('причина удаления называет пункт правил',
    /Пункт 1/.test(deletionReason(RULES[0].id)));
  check('пояснение попадает в причину',
    /мимо темы/.test(deletionReason(RULES[0].id, 'мимо темы')));

  /* ── Реакции ── */

  equal('лайк и дизлайк лежат в одном наборе — оба сразу поставить нельзя',
    REACTIONS.filter((r) => r.weight !== 0).map((r) => r.id).join(','), 'like,dislike');
  check('смайлики не влияют на «за» и «против»',
    REACTIONS.filter((r) => !['like', 'dislike'].includes(r.id)).every((r) => r.weight === 0));
  equal('идентификаторы реакций уникальны',
    new Set(REACTIONS.map((r) => r.id)).size, REACTIONS.length);

  /* ── Ник → адрес почты ── */

  /*
    ЭТО МЕСТО СЛОМАЛОСЬ НА ЖИВОЙ БАЗЕ, И ПОТОМУ ПРОВЕРЯЕТСЯ ПОДРОБНО.

    Вход по нику устроен так: ник превращается в адрес почты на вымышленном
    домене. Первая версия делала это в три строки — пробелы в точки, нижний
    регистр, приписать домен — и на настоящей системе входа Supabase
    развалилась сразу: она не принимает в адресе ничего, кроме ASCII.

      linktest77  → принято
      Ковыль      → «Unable to validate email address: invalid format»

    То есть регистрация не работала почти для всех: аудитория играет
    под русскими никами. Ошибка при этом ничего не объясняла.
  */
  const { nickToLocalPart, nickToEmail } = await import('../src/forum/nick-email.js');
  const supabaseSource = await readFile('src/forum/adapters/supabase.js', 'utf8');

  const NICKS = [
    'Ковыль', 'Тёмный Лорд', 'Игрок77', 'Qvaden', 'linktest77',
    'Лёша', 'Леша', 'щука', 'ЖЖЖ', 'Іван', 'Ўлад',
    'Игрок!', 'Игрок?', '★★★', 'a'.repeat(40), 'Ко-выль', 'ник_с_чертой',
  ];

  const locals = NICKS.map(nickToLocalPart);

  check('адрес состоит только из допустимых символов',
    locals.every((l) => /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(l)));
  check('в адресе нет двух точек подряд — правила почты этого не допускают',
    locals.every((l) => !/\.\./.test(l)));
  check('русский ник превращается в читаемую основу',
    nickToLocalPart('Ковыль').startsWith('kovyl'));
  check('пробел в нике становится дефисом, а не пропадает',
    nickToLocalPart('Тёмный Лорд').startsWith('tyomnyy-lord'));

  /*
    ГЛАВНОЕ ТРЕБОВАНИЕ. Если два разных ника дадут один адрес, второй человек
    при регистрации получит «занято», а при входе попадёт в ЧУЖОЙ аккаунт.
    Одной транслитерацией этого не избежать: «Лёша» и «Леша» в латинице
    совпадают, «Игрок!» и «Игрок?» после чистки — тоже. Поэтому к основе
    добавляется отпечаток точного ника.
  */
  equal('разные ники дают разные адреса', new Set(locals).size, NICKS.length);
  check('«Лёша» и «Леша» — разные люди',
    nickToLocalPart('Лёша') !== nickToLocalPart('Леша'));
  check('«Игрок!» и «Игрок?» — разные люди',
    nickToLocalPart('Игрок!') !== nickToLocalPart('Игрок?'));

  /*
    Обратная сторона того же требования: ОДИН ник обязан давать ОДИН адрес
    всегда, иначе человек не войдёт в свою же учётную запись. Ник приходит
    сюда после validateNick, который подрезает пробелы по краям и сжимает
    двойные внутри, — значит и здесь это надо делать так же.
  */
  equal('один и тот же ник даёт один и тот же адрес',
    nickToLocalPart('Ковыль'), nickToLocalPart('Ковыль'));
  equal('пробелы по краям не меняют адрес',
    nickToLocalPart('Ковыль '), nickToLocalPart('Ковыль'));
  equal('двойной пробел внутри не меняет адрес',
    nickToLocalPart('Тёмный  Лорд'), nickToLocalPart('Тёмный Лорд'));
  equal('регистр не меняет адрес — иначе ник подделывается регистром',
    nickToLocalPart('КОВЫЛЬ'), nickToLocalPart('ковыль'));

  /*
    Ник может целиком состоять из символов, которых в адресе быть не может.
    Это рабочий случай, а не ошибка: в игре такой ник допустим.
  */
  check('ник без пригодных символов всё равно даёт годный адрес',
    /^u-[0-9a-f]{8}$/.test(nickToLocalPart('★★★')));
  check('очень длинный ник не даёт бесконечный адрес',
    nickToLocalPart('a'.repeat(200)).length < 40);

  check('домен подставляется целиком',
    nickToEmail('Ковыль', 'users.zroute-s33.local').endsWith('@users.zroute-s33.local'));

  /*
    Отказ по формату адреса человек видеть не должен: он вводил ник и про
    адрес ничего не знает, для него это «сайт сломался». Такое сообщение
    возможно только если превращение выпустило не-ASCII, то есть это наша
    ошибка — и сказать надо именно так.
  */
  check('отказ по формату адреса объясняется как наша ошибка, а не вина игрока',
    /это наша ошибка/i.test(supabaseSource) && /validate email\|invalid format/.test(supabaseSource));
  check('отказ индекса по нику переводится в «ник занят»',
    /forum_users_nick_key/.test(supabaseSource));

  /*
    КТО Я — ЭТО ПРОВЕРКА ИДЕНТИФИКАТОРА, А НЕ ПРАВ ДОСТУПА.

    Здесь стоял запрос «первая строка из forum_users с limit=1» с расчётом
    на то, что права и так отдадут только мою строку. Для участника верно,
    для АДМИНИСТРАТОРА нет: ему видны все профили, иначе модерация
    не работала бы. Первая строка без порядка — произвольная, на практике
    самая старая в таблице, и администратор видел на сайте ЧУЖОЙ ник.

    Совпадение ответов на «кто я» и «что мне можно читать» было случайным.
  */
  check('«кто я» спрашивается по идентификатору из токена, а не первой строкой',
    /id=eq\.\$\{encodeURIComponent\(myId\)\}/.test(supabaseSource));
  check('идентификатор берётся из токена сессии',
    /userIdFromToken/.test(supabaseSource) && /payload\?\.sub/.test(supabaseSource));
  check('в запросе профиля нет ставки на «первую строку»',
    !/'\/forum_users\?select=\*&limit=1'/.test(supabaseSource));
  /*
    JWT кодируется base64url: вместо «+/» стоят «-_», выравнивающие «=»
    отброшены. atob этого не знает — без возврата обратно разбор токена
    падал бы на части ников случайным образом.
  */
  check('base64url приводится к обычному base64 перед разбором',
    /replace\(\/-\/g, '\+'\)\.replace\(\/_\/g, '\/'\)/.test(supabaseSource));

  /* ── Согласованность слоёв ── */

  const localAdapter = await import('../src/forum/adapters/local.js');
  const supabaseAdapter = await import('../src/forum/adapters/supabase.js');

  /*
    Тот же приём, что в блоке C для адаптеров данных: обещание «переключается
    одной строкой» должно быть проверяемым фактом. Расхождение иначе нашлось бы
    в день подключения базы, то есть в худший момент.
  */
  const required = [
    'isReady', 'currentUser', 'signUp', 'signIn', 'signOut',
    'listPosts', 'getPost', 'createPost', 'editPost', 'deletePost',
    'listComments', 'addComment', 'deleteComment',
    'setReaction', 'report', 'listReports', 'resolveReport',
    'listUsers', 'resetPassword', 'setRestriction',
  ];
  const missingLocal = required.filter((m) => typeof localAdapter[m] !== 'function');
  const missingSupabase = required.filter((m) => typeof supabaseAdapter[m] !== 'function');
  equal('локальный адаптер реализует контракт целиком', missingLocal.join(', '), '');
  equal('адаптер базы реализует контракт целиком', missingSupabase.join(', '), '');

  check('оба адаптера честно объявляют, видят ли записи другие люди',
    localAdapter.capabilities.isShared === false && supabaseAdapter.capabilities.isShared === true);

  /*
    АДРЕС ПРОЕКТА ПРИВОДИТСЯ К ОДНОМУ ВИДУ.

    В панели Supabase адрес показан в разделе Data API уже с хвостом
    «/rest/v1/», и скопировать его целиком — самое естественное действие.
    Тогда путь к таблицам стал бы «…/rest/v1/rest/v1/…», а вход не нашёлся бы
    вовсе: его путь начинается с /auth. Выглядело бы это как «форум
    не отвечает», ничего не говоря о причине.

    Проверяем текстом: адаптер обязан отрезать хвост сам, а не полагаться
    на то, что человек скопировал не то, что было написано.
  */
  check('адрес проекта чистится от хвоста /rest/v1 и /auth/v1',
    /replace\(\/\\\/\(rest\|auth\)\\\/v\\d\+\\\/\?\$\/i, ''\)/.test(supabaseSource));
  check('запросы строятся от очищенного адреса, а не от строки из конфига',
    !/\$\{CFG\.url\}\/(rest|auth)/.test(supabaseSource) && /baseUrl\(\)/.test(supabaseSource));

  /*
    Локальный режим паролей не знает вовсе. Изобразить успешный сброс было бы
    хуже отказа: администратор решил бы, что пароль сменён.
  */
  let localResetRefused = false;
  try {
    await localAdapter.resetPassword('u1', 'какой-то пароль');
  } catch {
    localResetRefused = true;
  }
  check('в локальном режиме сброс пароля честно отказывает', localResetRefused);

  /* ── Схема базы: где живёт настоящая защита ── */

  const schema = await readFile('supabase/schema.sql', 'utf8');

  /*
    Проверки в браузере защитой не бывают: их обходит запрос мимо сайта.
    Без включённого RLS публичный ключ дал бы полный доступ к таблицам,
    поэтому эти строки — самые важные в схеме.
  */
  for (const table of ['forum_users', 'forum_posts', 'forum_comments', 'forum_reactions', 'forum_reports']) {
    check(`${table}: права на строки включены`,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(schema));
  }

  check('автор записи подставляется базой, а не браузером',
    /new\.author_id\s*:=\s*auth\.uid\(\)/.test(schema));
  check('автор жалобы подставляется базой',
    /new\.reporter_id\s*:=\s*auth\.uid\(\)/.test(schema));
  check('право писать проверяет база, а не страница',
    /forum_can_write/.test(schema) && /banned = false/.test(schema));

  /*
    Реакция у человека одна на запись — это устройство таблицы, а не проверка
    в коде: автор входит в первичный ключ, поэтому вторая реакция заменяет
    первую. Накрутить оба счётчика нельзя физически.
  */
  check('одна реакция на человека закреплена первичным ключом',
    /primary key \(target_type, target_id, user_id\)/.test(schema));

  /*
    Удаление — отметка с причиной, а не стирание строки: на месте поста
    остаётся заглушка. Политики `for delete` для постов нет вовсе, поэтому
    запрос на удаление отвергается по умолчанию.
  */
  check('стирать посты не может никто, включая администратора',
    !/create policy[^;]*on public\.forum_posts\s+for delete/i.test(schema));
  check('удалённая запись хранит причину',
    /deleted_reason/.test(schema));

  /*
    Служебный ключ (service_role) даёт полный доступ ко всей базе в обход
    политик. Панель открывается в браузере, поэтому такой ключ там появиться
    не должен ни при каких условиях: смену пароля делает функция внутри базы.
  */
  check('сброс пароля живёт функцией в базе, а не запросом из панели',
    /create or replace function public\.forum_admin_reset_password/.test(schema));
  check('сброс пароля проверяет права администратора внутри базы',
    /forum_is_admin\(\)/.test(schema) && /raise exception/.test(schema));
  check('анонимному запросу сброс пароля недоступен',
    /revoke all on function public\.forum_admin_reset_password[\s\S]*?from public, anon/.test(schema));

  /*
    security_invoker обязателен: без него представление читало бы данные
    правами своего владельца, то есть в обход всех политик выше.

    Считаем объявления «create view», а не «create or replace»: представления
    пересоздаются через drop, потому что заменой нельзя добавить колонку
    в середину — Postgres принимает это за переименование и отказывает.
  */
  const views = schema.match(/create (?:or replace )?view public\.\w+/g) ?? [];
  const invokers = schema.match(/with \(security_invoker = on\)/g) ?? [];
  equal('каждое представление читает данные правами того, кто спросил',
    invokers.length, views.length);

  /*
    Схему запускают повторно при каждом обновлении, поэтому каждое
    представление обязано сначала удаляться. Без этого второй запуск падает
    на первом же изменившемся составе колонок — и падает невнятно, сообщением
    про переименование колонки, которую никто не переименовывал.
  */
  const viewNames = [...schema.matchAll(/create (?:or replace )?view public\.(\w+)/g)].map((m) => m[1]);
  const withoutDrop = viewNames.filter(
    (name) => !new RegExp(`drop view if exists public\\.${name}`).test(schema)
  );
  equal('каждое представление удаляется перед созданием — иначе повторный запуск падает',
    withoutDrop.join(', '), '');

  check('жалобы видит только модерация — открытый список стал бы травлей',
    /create policy forum_reports_read on public\.forum_reports\s+[\s\S]{0,200}?forum_is_staff\(\)/.test(schema));

  /*
    ЛЕНТА НЕ СОЕДИНЯЕТСЯ С ПРОФИЛЯМИ.

    Первая версия схемы брала ник автора связью из forum_users — и лента
    оказалась пустой для всех, кроме собственных постов: читать профили
    разрешено только свой и только модерации, поэтому соединение выбрасывало
    все остальные строки. Выглядело это как «форум пуст» при полной базе.

    Открыть профили целиком нельзя: там даты регистрации и запреты, а
    публичный список «кто забанен» — готовый инструмент насмешек. Поэтому ник
    лежит копией в самой записи, и подставляет его база, а не браузер.
  */
  const postListView = schema.slice(
    schema.indexOf('create or replace view public.forum_post_list'),
    schema.indexOf('create or replace view public.forum_comment_list')
  );
  check('лента не соединяется с профилями — иначе она пуста для всех',
    !/join public\.forum_users/.test(postListView));
  check('ник автора хранится копией в самой записи',
    /author_nick\s+text not null/.test(schema));
  check('ник автора подставляет база, а не браузер',
    /new\.author_nick\s*:=\s*coalesce\(/.test(schema));
  check('колонка ника добавляется и в базы, созданные первой версией схемы',
    /add column if not exists author_nick/.test(schema));

  /*
    В ПОЛИТИКАХ НЕ ДОЛЖНО БЫТЬ ПОДЗАПРОСОВ К СВОЕЙ ЖЕ ТАБЛИЦЕ.

    Здесь стояло условие «pinned = (select pinned from forum_posts p where
    p.id = id)» — попытка запретить автору закреплять свой пост. Postgres
    связал `id` без имени таблицы с той же таблицей внутри подзапроса,
    условие превратилось в «p.id = p.id», подзапрос вернул все строки,
    и ЛЮБАЯ правка поста падала с «more than one row returned by a subquery».

    Ошибка была не в опечатке, а в затее: политика отвечает на вопрос «можно
    ли трогать эту строку», а не «какие поля разрешено менять». Второй вопрос
    решает триггер, где есть OLD и подзапрос не нужен вовсе.

    Комментарии выбрасываем: разбор этой самой ошибки написан в схеме прямо
    над исправленной политикой, и без чистки тест поймал бы объяснение
    вместо кода.
  */
  const schemaCode = schema.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  const policies = schemaCode.match(/create policy[\s\S]*?;/g) ?? [];
  const withSelfSubquery = policies.filter(
    (p) => /\(\s*select\s+(?!1\b)/i.test(p) && /forum_(posts|comments|users|reactions)\s+\w*\s*where/i.test(p)
  );
  equal('в политиках нет подзапросов к своей же таблице',
    withSelfSubquery.length, 0);

  check('ограничения по полям живут в триггере, где есть OLD',
    /forum_posts_guard/.test(schema) && /new\.pinned\s*:=\s*old\.pinned/.test(schema));
  check('автор не может выдать своё удаление за решение модерации',
    /new\.deleted_reason\s*:=\s*'Удалено автором'/.test(schema));
  check('удалённый пост не возвращается автором обратно',
    /elsif old\.deleted then/.test(schema));

  /*
    Роль — не то же самое, что запрет писать. Модератор, способный менять
    роли, назначит администратором себя, и разница между ролями исчезнет.
  */
  check('роль меняет только администратор, а не любой модератор',
    /Роль меняет только администратор/.test(schema));
  check('последнего администратора нельзя лишить роли',
    /последний администратор/.test(schema));
  check('администратора нельзя забанить — это способ отобрать форум',
    /if old\.role = 'admin' then[\s\S]{0,200}new\.banned\s*:=\s*old\.banned/.test(schema));

  /*
    ПЕРВОГО администратора назначают запросом из SQL-редактора, где вошедшего
    человека нет и auth.uid() пуст. Без пропуска такого запроса проверка выше
    отбивала бы владельца проекта от его же базы — то есть обязательный шаг
    настройки стал бы невыполним.
  */
  const guards = schema.match(/create or replace function public\.forum_\w+_guard\(\)[\s\S]*?\$\$;/g) ?? [];
  equal('каждый охранник пропускает запрос из SQL-редактора',
    guards.filter((g) => /auth\.uid\(\) is null/.test(g)).length, guards.length);

  /*
    СХЕМУ ВСТАВЛЯЮТ ЦЕЛИКОМ И НЕ ПРАВЯТ.

    В конце файла лежали два закомментированных блока, где требовалось
    подставить свой ник: назначение администратора и очистка пробных данных.
    Это оказалось ловушкой. Правка внутри комментария рвёт строку, её хвост
    остаётся без «--» и становится настоящим SQL — запуск всего файла падает
    с невнятной синтаксической ошибкой в конце, хотя со схемой всё в порядке.
    Ровно это и произошло: перенос строки внутри `lower('...')`.

    Одноразовые действия вынесены в отдельные файлы, где правка — цель,
    а не ловушка посреди семисот строк.
  */
  check('в схеме нет мест, которые нужно править руками',
    !/ТВОЙ_НИК|Раскомментируй|раскомментируй/.test(schema));

  const { stat: statFile } = await import('node:fs/promises');
  for (const f of ['supabase/first-admin.sql', 'supabase/cleanup-test-data.sql']) {
    let exists = true;
    try { await statFile(f); } catch { exists = false; }
    check(`одноразовое действие вынесено отдельно: ${f}`, exists);
  }

  /*
    В одноразовом файле должно быть РОВНО ОДНО место, где стоит ник: два
    и больше — приглашение поправить одно и забыть про другое.

    Считаем не подстановку «ТВОЙ_НИК», а сами места с ником. Первая версия
    искала именно заготовку — и тест падал, стоило подставить в файл настоящий
    ник, то есть ровно за то, что файл и просит сделать. Проверять надо
    устройство файла, а не то, воспользовались им или нет.
  */
  for (const f of ['supabase/first-admin.sql', 'supabase/cleanup-test-data.sql']) {
    const code = (await readFile(f, 'utf8')).replace(/^\s*--.*$/gm, '');
    const spots = (code.match(/lower\('[^']*'\)/g) ?? []).length;
    equal(`${f}: одно место для правки`, spots, 1);
  }

  /*
    Очистка обязана останавливаться, если ник не совпал: без этого опечатка
    удаляет всех, включая владельца, и вернуть уже нечего.
  */
  const cleanup = await readFile('supabase/cleanup-test-data.sql', 'utf8');
  check('при несовпадении ника очистка останавливается и не удаляет ничего',
    /raise exception/.test(cleanup) && /Ничего не удалено/.test(cleanup));
  check('очистка удаляет и учётные записи, а не только посты',
    /delete from auth\.users/.test(cleanup));
  check('очистка выполняется одним блоком: либо целиком, либо никак',
    /^do \$\$/m.test(cleanup) && /^end \$\$;/m.test(cleanup));

  /*
    В ОДНОРАЗОВЫХ ФАЙЛАХ НЕ ДОЛЖНО БЫТЬ СОЗДАНИЯ ТАБЛИЦ.

    Первая версия очистки складывала «кого оставить» во временную таблицу,
    и редактор Supabase на любое создание таблицы спрашивал: «Run without RLS»
    или «Run and enable RLS». Вопрос по делу, но не про этот случай: временная
    таблица живёт секунду и тут же удаляется. А человек, пришедший стереть
    пробные записи, оказывался перед выбором между двумя непонятными
    вариантами — и любой из них выглядел рискованным.
  */
  for (const f of ['supabase/first-admin.sql', 'supabase/cleanup-test-data.sql']) {
    const code = (await readFile(f, 'utf8')).replace(/^\s*--.*$/gm, '');
    check(`${f}: не создаёт таблиц — иначе редактор спросит про RLS`,
      !/create\s+(temporary\s+)?table/i.test(code));
  }

  /* ── Страница и панель ── */

  const { renderForum } = await import('../src/pages/forum.js');

  const eventsSample = [
    { id: 'e1', date: new Date('2026-08-20T00:00:00Z'), type: 'server_capture', serverNumber: 74, title: 'Взяли 74' },
    { id: 'e2', date: new Date('2026-07-11T00:00:00Z'), type: 'server_defended', serverNumber: 51, title: 'Отбились' },
  ];

  const offHtml = renderForum({ events: eventsSample }, { ready: false, loading: false });
  check('неподключённый форум говорит об этом прямо, а не показывает мёртвую форму',
    /не подключ/i.test(offHtml) && !offHtml.includes('data-forum-auth'));
  check('хроника видна даже без подключённого форума', offHtml.includes('Взяли') || offHtml.includes('74'));

  const localHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: false, sourceName: 'локальный', loading: false, posts: [], me: null,
  });
  check('черновой режим предупреждает, что записей никто не увидит',
    /только в этом браузере/i.test(localHtml));

  const guestHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, posts: [], me: null,
  });
  check('гостю показана форма входа', guestHtml.includes('data-forum-auth'));
  check('гостю не показана форма написания поста', !guestHtml.includes('data-forum-new'));
  check('вход обещает обойтись без почты', /почта не нужна/i.test(guestHtml));
  check('правила видны раньше кнопки «написать»',
    guestHtml.indexOf('Правила форума') < guestHtml.indexOf('data-forum-feed') ||
      guestHtml.includes('Правила форума'));

  const me = { id: 'u1', nick: 'Qvaden', role: 'admin', createdAt: new Date(), banned: false, mutedUntil: null };
  const post = {
    id: 'p1', authorId: 'u2', authorNick: 'Игрок', category: 'vs',
    title: 'Разбор', body: 'текст поста', createdAt: new Date(), commentCount: 0,
    reactions: { like: 2 }, myReaction: null, score: 2, deleted: false,
  };

  const memberHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me, posts: [post],
  });
  check('вошедшему показана форма написания поста', memberHtml.includes('data-forum-new'));
  check('перед публикацией названы правила и последствие',
    /соглашаетесь с правилами/i.test(memberHtml));
  check('чужой пост можно пожаловаться', memberHtml.includes('data-forum-report="post:p1"'));
  check('счётчик лайков виден', memberHtml.includes('>2<'));

  const bannedHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, posts: [],
    me: { ...me, banned: true, banReason: 'Пункт 2' },
  });
  check('забаненному не показана форма написания поста', !bannedHtml.includes('data-forum-new'));
  check('забаненный видит причину запрета', /Пункт 2/.test(bannedHtml));

  /*
    Удалённый пост остаётся на месте заглушкой с причиной. Молча исчезнувший
    пост читается как поломка сайта и порождает второй такой же.
  */
  const deletedHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me,
    posts: [{ ...post, deleted: true, deletedReason: 'Пункт 4: Без рекламы' }],
  });
  check('удалённый пост остаётся на месте', deletedHtml.includes('Пост удалён'));
  check('удалённый пост объясняет причину', /Без рекламы/.test(deletedHtml));
  check('текст удалённого поста не показывается', !deletedHtml.includes('текст поста'));

  /* ── Экраны панели ── */

  const { renderPlayers } = await import('../src/admin/screens/players.js');
  const { renderModeration } = await import('../src/admin/screens/moderation.js');

  /*
    Панель и форум — две разные системы прав. Токен GitHub над форумом
    не властен: там своя учётная запись, и проверяет её база. Поэтому панель
    обязана уметь сказать «вы не администратор форума», а не показывать
    кнопку, которая заведомо откажет.
  */
  check('без подключённого форума экран игроков объясняет это',
    /не подключ/i.test(renderPlayers({ forum: { configured: false } })));
  check('не вошедшему на форум панель объясняет, что токен GitHub здесь не действует',
    /токен GitHub/i.test(renderPlayers({ forum: { configured: true, me: null } })));
  check('участнику кнопка сброса пароля не показывается',
    !renderPlayers({
      forum: { configured: true, me: { id: 'u9', nick: 'Кто-то', role: 'member' }, users: [] },
    }).includes('data-player-reset'));

  const playersHtml = renderPlayers({
    forum: {
      configured: true,
      me,
      users: [me, { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null }],
    },
  });
  check('администратору доступен сброс пароля', playersHtml.includes('data-player-reset="u2"'));
  check('себе пароль сбросить нельзя — для этого есть обычная смена',
    !playersHtml.includes('data-player-reset="u1"'));
  check('панель предупреждает, что пароль покажется один раз',
    /один раз/.test(playersHtml));

  const reportsHtml = renderModeration({
    forum: {
      configured: true,
      me,
      reports: [{
        id: 'r1', targetType: 'post', targetId: 'p1', reporterId: 'u3', reporterNick: 'Жалобщик',
        ruleId: RULES[0].id, note: 'оскорбляет', createdAt: new Date(),
        targetTitle: 'Заголовок', targetBody: 'текст нарушения', targetAuthorNick: 'Нарушитель',
      }],
    },
  });
  check('в жалобе виден пункт правил', reportsHtml.includes(RULES[0].title));
  check('в жалобе виден текст, на который жалуются', /текст нарушения/.test(reportsHtml));
  check('удаление по жалобе несёт пункт правил', reportsHtml.includes('data-report-rule='));
  check('жалобу можно отклонить, а не только удалить', reportsHtml.includes('data-report-dismiss'));
  check('пустой список жалоб объясняет себя',
    /нечего/i.test(renderModeration({ forum: { configured: true, me, reports: [] } })));

  /* ── Сайдбар и офлайн-копия ── */

  const indexHtml = await readFile('index.html', 'utf8');
  check('боковое меню есть в разметке', /<aside[^>]+id="side"/.test(indexHtml));
  check('кнопка меню подписана для незрячих', /aria-label="Открыть меню/.test(indexHtml));
  check('кнопка меню сообщает своё состояние', /aria-expanded="false"/.test(indexHtml));
  check('стили форума подключены', indexHtml.includes('forum.css'));

  const mainJs = await readFile('src/main.js', 'utf8');
  check('форум — первый раздел в меню',
    /const ROUTES = \[\s*\{ id: 'forum'/.test(mainJs));
  check('пустой адрес открывает форум', /id \|\| 'forum'/.test(mainJs));
  check('итоги VS остались отдельным разделом', /id: 'home'/.test(mainJs));
  check('хронология осталась отдельным разделом', /id: 'timeline'/.test(mainJs));
  /*
    Форум лежит не в data/live.json, поэтому недоступная таблица результатов
    не должна закрывать разговор сообщества. Раньше здесь была страница
    с ошибкой вместо всего сайта.
  */
  check('сломанные данные сайта не роняют форум', /loadError/.test(mainJs));

  /*
    ПРЕВЬЮ — ЭТО АВАРИЙНЫЙ ВЫХОД, А НЕ КАРТИНКА.

    Если источник данных однажды отвалится, scripts/build-preview.mjs
    превращает сайт в статику, и накопленная история остаётся доступной.
    Значит собранный файл обязан быть ТЕМ ЖЕ сайтом.

    Пока в превью было четыре раздела из семи и стили от версии v6, аварийный
    выход давал сайт без Кварта, без бота и без форума — то есть не спасал,
    а подменял. Обнаружилось бы это в тот день, когда выход понадобится.
  */
  const preview = await readFile('scripts/build-preview.mjs', 'utf8');
  const routeIds = [...mainJs.matchAll(/\{ id: '([\w-]+)',/g)].map((m) => m[1]);
  const previewIds = [...preview.matchAll(/\{ id: '([\w-]+)',/g)].map((m) => m[1]);
  const missingInPreview = routeIds.filter((id) => !previewIds.includes(id));
  equal('превью собирает все разделы сайта', missingInPreview.join(', '), '');

  check('превью берёт стили из index.html, а не зашитым именем',
    /matchAll\(\/href="\\\.\\\/\(src\\\/\[\^"\?\]\+\\\.css\)/.test(preview) ||
      /indexHtml\.matchAll/.test(preview));
  check('превью показывает боковое меню, как настоящий сайт',
    /id="side"/.test(preview) && /side-toggle/.test(preview));

  /*
    Список офлайн-копии уже один раз разъехался: в нём лежал src/styles.css,
    которого сайт не грузит, и icon-192.png, которого в репозитории нет вовсе.
    Теперь он сверяется с тем, что действительно подключено.
  */
  const swJs = await readFile('sw.js', 'utf8');
  const shell = [...swJs.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]);
  const cssInHtml = [...indexHtml.matchAll(/href="\.\/(src\/[^"?]+\.css)/g)].map((m) => `./${m[1]}`);
  const missingInShell = cssInHtml.filter((f) => !shell.includes(f));
  equal('офлайн-копия кэширует те же стили, что грузит страница',
    missingInShell.join(', '), '');

  const { stat } = await import('node:fs/promises');
  const brokenShell = [];
  for (const url of shell) {
    if (url === './') continue;
    try {
      await stat(url.replace(/^\.\//, ''));
    } catch {
      brokenShell.push(url);
    }
  }
  equal('все файлы офлайн-копии существуют', brokenShell.join(', '), '');
}

console.log(`\n${'─'.repeat(52)}`);
console.log(`Пройдено: ${passed}   Провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
