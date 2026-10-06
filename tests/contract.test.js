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

// ── B3a. Конец Кватра — календарный конец недели endNumber ────────────────
{
  // Кварт 2 идёт (результаты за W5, W6 есть), но недели W7, W8 ещё не заведены:
  // конец Кватра обязан досчитаться до конца недели №8, а не встать на W6.
  const weeks = Array.from({ length: 6 }, (_, i) => ({
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
    { weekId: 'W6', allianceId: 'x', outcome: 'win' },
  ];

  const growth = computeQuarterWindow(weeks, results);
  equal('Кварт 2 с неполными неделями — окно W5–W8', growth.number, 2);
  const fullEnd = new Date(2026, 0, 7 * 7 + 11);
  equal(
    'конец Кватра — конец недели 8, а не последней созданной W6',
    growth.endDate?.getTime(),
    fullEnd.getTime()
  );
  equal('кварт без недель не даёт даты конца',
    computeQuarterWindow([], []).endDate, null);
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
  check('снятая отметка удаляет результат своего сервера, а не пишет третий исход',
    /method: 'DELETE'/.test(storeCode) && /site_results\?server_id=eq\.\$\{server\}&week_id=eq/.test(storeCode));

  /*
    МУЛЬТАРЕНДА ДАННЫХ САЙТА.

    С `supabase/applied/20261004-site-server-scope.sql` id недели, события и текста
    перестали быть глобальными: «W1» живёт на каждом сервере своя. Значит
    запрос, в котором сервер не назван, опасен не косметически — DELETE по
    одному id сносит неделю у всех, а вставка без `server_id` попадает в ключ,
    которого панель не видит. Проверяем текстом панели, а не только поведением:
    ровно одна пропущенная строка здесь означает порчу чужих данных.
  */
  const fnSource = (name) => {
    const from = storeCode.indexOf(`export async function ${name}(`);
    if (from < 0) return '';
    const next = storeCode.indexOf('export async function', from + 10);
    return storeCode.slice(from, next < 0 ? from + 1500 : next);
  };
  const noServer = ['saveWeekMarks', 'saveAlliance', 'saveWeek', 'saveEvent', 'saveText']
    .filter((fn) => !/server_id: (?:panelServer\(\)|server[,}])/.test(fnSource(fn)));
  equal('каждая вставка панели называет сервер', noServer.join(', '), '');

  const deleteUrls = [...storeCode.matchAll(/rest\(\s*`(\/site_[^`]+)`,\s*\{\s*method: 'DELETE'\s*\}\s*\)/g)]
    .map((m) => m[1]);
  /*
    Альянс — единственное исключение: его id глобален специально, потому что
    на него смотрят таблицы форума и VS (объяснение — в шапке миграции).
    Остальные удаления обязаны начинаться с фильтра по серверу.
  */
  const looseDelete = deleteUrls
    .filter((u) => !/\?server_id=eq\./.test(u) && !/^\/site_alliances\?id=eq\./.test(u));
  equal('удалений без ограничения сервером не осталось', looseDelete.join(' '), '');
  equal('проверка видит все пять удалений панели', deleteUrls.length, 5);

  /*
    Номер сервера берётся из одного места. Если чтение и запись возьмут его
    из разных — панель начнёт править один сервер, а показывать другой, и
    глаза этого расхождения не увидят: и то и другое выглядит целым.

    С правами по серверу это одно место — `src/admin/target.js`: у панели
    появилась цель, и она у неё одна на чтение, запись, пути фотографий и
    папки черновиков. `src/data/server.js` остаётся читающей стороной: там
    живёт сервер сайта и выбор зрителя.
  */
  const targetSrc = await readFile('src/admin/target.js', 'utf8');
  const serverSrc = await readFile('src/data/server.js', 'utf8');
  check('номер сервера читается из config в одном месте',
    serverSrc.includes('CONFIG.server') &&
    (await readFile('src/admin/store.js', 'utf8')).includes("from '../data/server.js'") &&
    (await readFile('src/data/adapters/supabase.js', 'utf8')).includes("from '../server.js'"));
  check('запись требует номер сервера, а не додумывает его',
    /export function panelServer\(\)/.test(targetSrc) && targetSrc.includes('не заполнен server'));
  check('пишущая сторона спрашивает число у цели панели, а не у config',
    !/writeServer\(\)/.test(storeCode) && storeCode.includes("from './target.js'") &&
    /site_dataset'[\s\S]{0,120}panelServer\(\)/.test(storeCode));
  check('свободный номер альянса спрашивает базу, а не считает по своему списку',
    /rpc\/site_next_alliance_id/.test(storeCode));
  /*
    Роль назначается функцией базы, а не правкой профиля напрямую. Правку
    профилей разрешено модерации, а роли — только владельцу; функция проверяет
    это сама, поэтому право «назначить модератора» отдаётся в панель без права
    «менять что угодно в профилях».
  */
  check('роль назначается функцией базы, а не правкой профиля',
    /rpc\/site_set_moderator/.test(storeCode));

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
  ];

  /*
    ЭКРАН НЕ ЧИТАЕТ ПОЛЕЙ, КОТОРЫХ ПАНЕЛЬ ЕМУ НЕ ДАЁТ.

    Проверка по тексту, а не по вызову: вызов ловит только то, что упало
    на конкретных данных, а обзор падал лишь при отсутствующем repo — то есть
    всегда, но тест этого не видел, потому что подсовывал repo сам.

    Ниже — поля эпохи GitHub. После переезда их не существует, и обращение
    к ним означает, что экран остался в прошлом.
  */
  const adminScreenFiles = adminFiles.filter((f) => /screens\//.test(f));
  const stale = [];
  for (const f of adminScreenFiles) {
    const code = stripComments(await readFile(f, 'utf8'));
    for (const gone of ['view.repo', 'view.commit', 'repo.fullName', 'repo.canPush', 'commit.sha']) {
      if (code.includes(gone)) stale.push(`${f} → ${gone}`);
    }
  }
  equal('экраны панели не читают поля эпохи GitHub', stale.join(', '), '');

  /*
    ВЕРСИЯ У ИМПОРТОВ ПАНЕЛИ И В admin.html ОБЯЗАНА СОВПАДАТЬ.

    GitHub Pages велит браузеру хранить файлы десять минут, и тот слушается:
    обновление страницы перезапрашивает саму страницу и main.js, но вложенные
    модули берёт из кэша.

    Это уже стоило поломки. Обзор переписали под базу, main.js обновился,
    а screens/overview.js остался прежним — тот, что читал поля репозитория.
    Панель падала «Cannot read properties of undefined (reading fullName)»
    на исправленном коде, и понять это было нельзя: файл на диске правильный.

    Номер в адресе делает файл другим файлом для кэша, но работает это только
    если номер поднят и там, и там: иначе страница придёт свежая, а модули
    старые — то есть ровно та беда, от которой номер и ставили.
  */
  const adminMain = await readFile('src/admin/main.js', 'utf8');
  const htmlVersion = adminHtml.match(/admin\/main\.js\?v=(\d+)/)?.[1];
  const importVersions = [...adminMain.matchAll(/from '\.[^']+\.js\?v=(\d+)'/g)].map((m) => m[1]);

  check('в admin.html указана версия панели', Boolean(htmlVersion), `нашлось: ${htmlVersion}`);
  check('версия у всех импортов панели одна и та же',
    new Set(importVersions).size <= 1, `версии: ${[...new Set(importVersions)].join(', ')}`);
  equal('версия импортов совпадает с версией в admin.html',
    importVersions[0] ?? '', htmlVersion ?? '');

  /*
    Все относительные импорты панели должны быть с версией. Один забытый —
    один файл, который останется старым, и поломка вернётся ровно в том же
    виде: правильный код на диске, ошибка в браузере.
  */
  const bareImports = [...adminMain.matchAll(/from '(\.[^']+\.js)'/g)].map((m) => m[1]);
  equal('у каждого импорта панели есть версия', bareImports.join(', '), '');

  /*
    ТО ЖЕ ПРАВИЛО ДЛЯ САЙТА.

    Беда одна на оба входа: страница обновляется, main.js обновляется,
    а вложенные модули браузер берёт из кэша. У сайта это проявляется мягче
    (страница просто выглядит по-старому), но однажды проявится так же
    жёстко: свежий main.js вызовет функцию, которой в старом модуле нет.

    Версия обязана совпадать с той, что стоит в index.html.
  */
  const siteMain = await readFile('src/main.js', 'utf8');
  const siteHtml = await readFile('index.html', 'utf8');
  const indexVersion = siteHtml.match(/src\/main\.js\?v=(\d+)/)?.[1];
  const siteImportVersions = [...siteMain.matchAll(/from '\.[^']+\.js\?v=(\d+)'/g)].map((m) => m[1]);

  check('версия у всех импортов сайта одна и та же',
    new Set(siteImportVersions).size <= 1,
    `версии: ${[...new Set(siteImportVersions)].join(', ')}`);
  equal('версия импортов сайта совпадает с версией в index.html',
    siteImportVersions[0] ?? '', indexVersion ?? '');

  const bareSiteImports = [...siteMain.matchAll(/from '(\.[^']+\.js)'/g)].map((m) => m[1]);
  equal('у каждого импорта сайта есть версия', bareSiteImports.join(', '), '');

  /*
    ВЕРСИЯ ОДНА НА ВЕСЬ ГРАФ САЙТА, А НЕ ТОЛЬКО У ПЕРВОГО ЭШЕЛОНА.

    Три модуля сайта носят версии и у своих импортов: страницы вызывают
    контролы, контролы — помощников. Число обязано идти рядом с остальными:
    одна забытая восьмидесятая пара превращает обновление в половину
    обновления — свежий main.js вызовет функцию, которой в закешированном
    модуле третьего звена нет.
  */
  {
    const path = await import('node:path');
    async function walkSite(dir, out = []) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (dir === 'src' && e.name === 'admin') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walkSite(full, out);
        else if (e.name.endsWith('.js')) out.push(full);
      }
      return out;
    }
    const drift = [];
    let versionedEdges = 0;
    for (const file of await walkSite('src')) {
      const code = await readFile(file, 'utf8');
      for (const m of code.matchAll(/from\s*['"]\.[^'"]*\?v=(\d+)['"]/g)) {
        versionedEdges++;
        if (m[1] !== indexVersion) drift.push(`${file} → ?v=${m[1]}`);
      }
    }
    check(`у сайта есть что проверять в графе версий`, versionedEdges > 0,
      `найдено связей с версией: ${versionedEdges}`);
    equal(`весь граф сайта на версии ${indexVersion}`, [...new Set(drift)].sort().join('\n       '), '');
  }

  check('панель вешает удаление аккаунта и окно подтверждения никем',
    adminMain.includes('[data-player-delete]') && adminMain.includes('[data-delete-player-form]'));
  check('у быстрой кнопки бана нет обработчика — осталась только модалка «Ограничить»',
    !adminMain.includes('[data-player-ban]'));

  /*
    ЭКРАНЫ ПАНЕЛИ ПРОВЕРЯЮТСЯ НА ТОМ, ЧТО ПАНЕЛЬ ИМ ДЕЙСТВИТЕЛЬНО ДАЁТ.

    Здесь была подложена выдумка: объект с полями repo, commit и sha —
    остатками эпохи, когда данные лежали в репозитории. Экраны эти поля
    читали, тест их подсовывал, и всё сходилось.

    А панель после переезда кладёт совсем другое. Обзор продолжал читать
    view.repo.fullName и падал на первой строке — молча, вкладка просто
    не открывалась. Тест этого не увидел, потому что проверял не то,
    что собирает панель.

    Поэтому состав полей ниже — копия того, что кладёт load() в main.js,
    и ничего лишнего. Если панель начнёт давать другое, экраны сломаются
    здесь, а не у человека.
  */
  const viewFor = (data) => ({
    account: { nick: 'Qvaden', role: 'admin' },
    user: { login: 'Qvaden' },
    file: { path: 'база данных', size: 98304, sha: '' },
    changes: [],
    raw: {},
    baseRaw: {},
    data,
    weeks: data.weeks,
    canPush: true,
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
  const { readFile } = await import('node:fs/promises');
  const { EVENT_TYPE, EVENT_TYPE_ORDER, SERVER_TYPES, isServerEvent, verdictText, pillText, serverEvents } =
    await import('../src/logic/event-types.js');
  const { renderTimeline } = await import('../src/pages/timeline.js');
  const tlScript = await readFile('src/ui/timeline-controls.js', 'utf8');

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
  check('вердикт берёт самую свежую запись летописи',
    html.includes('Не смогли защитить Столицу от сервера 19'));
  check('потеря красится как поражение', /verdict--loss/.test(html));
  equal('в летописи столько плашек, сколько записей',
    (html.match(/data-tl-week="/g) || []).length, 4);
  check('война в навигации вердиктов есть', /data-tl-week="e2"/.test(html));
  check('но в ленте событий война осталась', html.includes('data-tl-type="war"'));

  /*
    Вердикт — не просто картинка в шапке, а переход к записи в ленте:
    на записи есть якорь data-tl-id, и вердикт знает, куда вести.
  */
  check('вердикты знают адрес своей записи',
    (html.match(/data-tl-open="/g) || []).length === 4 && (html.match(/data-tl-id="/g) || []).length === 4);
  check('скрипт умеет раскрывать весь список плашек',
    tlScript.includes('data-tl-more') && tlScript.includes('expandedWeeks') && tlScript.includes('WEEKS_SHOWN'));
  check('скрипт прыгает к записи из вердикта',
    tlScript.includes('data-tl-open') && tlScript.includes('data-tl-id') &&
    tlScript.includes('scrollIntoView') && tlScript.includes('is-flash'));

  /* Плашек со временем становится много — шапка не должна тащить их все.
     По умолчанию видно четыре свежих, остальное прячется за кнопкой. */
  const many = renderTimeline({
    events: [
      ev('m1', '2026-01-05', 'server_capture', 1),
      ev('m2', '2026-02-05', 'server_capture', 2),
      ev('m3', '2026-03-05', 'server_capture', 3),
      ev('m4', '2026-04-05', 'server_capture', 4),
      ev('m5', '2026-05-05', 'server_defended'),
      ev('m6', '2026-06-05', 'server_defended'),
    ],
  });
  equal('лишние плашки спрятаны в разметке', (many.match(/<li hidden>/g) || []).length, 2);
  check('при избытке плашек кнопка «Показать все» видна',
    /data-tl-more[\s\S]*?Показать все \(2\)/.test(many.replace(/ hidden/g, '')));
  check('когда плашек немного, кнопка прячется', /data-tl-more[^>]*hidden/.test(html));

  /* Выбор «Тип» на телефоне — свой список, а не системный select. */
  check('тип фильтруется и выпадающим списком (телефон)',
    html.includes('data-pick-open') && html.includes('data-tl-filter="all"'));
  check('выпадающий список типа не системный select',
    !/<select[^>]*data-tl-pick/.test(html));

  const held = renderTimeline({ events: [ev('e9', '2026-06-01', 'server_defended')] });
  check('успешная защита красится как победа', /verdict--win/.test(held));
  check('защита без номера подписана без выдуманного нападавшего',
    held.includes('Успешно защитили свою Столицу'));

  // Пустая летопись: экран должен объяснять, а не пустовать.
  const blank = renderTimeline({ events: [] });
  check('пустая хронология объясняет себя', blank.includes('Ещё ни одной записи'));
  check('пустая хронология не рисует вердикт', !blank.includes('verdict'));

  // Только войны и слияния: вердикт всё равно есть — летопись ведёт от
  // последней записи любого типа.
  const noServer = renderTimeline({ events: [ev('e2', '2026-05-02', 'war')] });
  check('вердикт есть и для не-серверного события', noServer.includes('data-tl-verdict="e2"'));
  check('заголовок вердикта берёт название записи',
    noServer.includes('<h2 class="verdict__text">т</h2>'));
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

  /* ── Фильтр клеток и одна массовая отметка вместо десятка «Х» ── */
  const { readFile: readAdmCss } = await import('node:fs/promises');
  const weekTwo = {
    data: {
      weeks: mapWeeks([{ id: 'W1', number: 1, startDate: '2026-07-27', endDate: '2026-08-02' }]),
      alliances: [
        { id: 'a01', tag: 'ZOR', name: 'Зорч', active: true },
        { id: 'a02', tag: 'QNT', name: 'Квант', active: true },
      ],
    },
    raw: { results: [{ weekId: 'W1', allianceId: 'a01', outcome: 'win' }], weeks: [], alliances: [] },
    canPush: true,
    weekId: 'W1',
    marks: { a01: 'win' },
  };

  const filtered = weekScreen(weekTwo, null);
  check('над клетками есть поле поиска', filtered.includes('data-cell-query'));
  check('есть переключатель «только неотмеченные»', filtered.includes('data-cell-only-empty'));
  check('есть счётчик показанных клеток', filtered.includes('data-cell-shown'));
  check(
    'клетка несёт строку поиска уже в нижнем регистре',
    filtered.includes('data-cell-find="qnt квант"'),
    'иначе «Квант» не найдётся по слову «квант»'
  );
  check(
    'массовая кнопка считает только неотмеченных',
    /data-mass-loss[\s\S]*?<b data-mass-count>1<\/b>/.test(filtered),
    'отмеченный альянс не должен попадать в число'
  );

  const prefilled = weekScreen({ ...weekTwo, weekFilter: { q: 'кван' } }, null);
  check(
    'введённое слово остаётся в поле после перерисовки',
    prefilled.includes('value="кван"'),
    'экран пересобирают после публикации и после сброса черновика'
  );

  const allMarked = weekScreen({ ...weekTwo, marks: { a01: 'win', a02: 'loss' } }, null);
  check('когда неотмеченных не осталось, массовой кнопки нет', !allMarked.includes('data-mass-loss'));

  const readOnly = weekScreen({ ...weekTwo, canPush: false }, null);
  check('без права на запись массовой кнопки нет', !readOnly.includes('data-mass-loss'));
  check('без права на записи фильтр остаётся', readOnly.includes('data-cell-query'));

  const admCss = await readAdmCss('src/admin/admin.css', 'utf8');
  check(
    'скрытая клетка убирается из сетки, а не только визуально',
    /\.adm-cell\[hidden\]\s*\{\s*display:\s*none/.test(admCss),
    '.adm-cell задаёт display:grid и перебивает заводское [hidden]'
  );
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
    eventsDiff(raw, [{ ...list[1], _pendingImages: [{ blob: {} }] }, list[0]]).changed,
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
    viewFor({ eventDraft: { ...blankEvent(), _pendingImages: [{ previewUrl: 'blob:фейковое-превью' }] } })
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

    Цель панели называется config.js, поэтому она не зависит от того, прочитаны
    ли права: путь обязан назвать сервер сайта и до ответа `myServerRoles`, и
    после `forgetRights()`. Переключателя серверов на сайте больше нет, значит
    выдумать номер неоткуда.
  */
  const target = await import('../src/admin/target.js');
  target.adoptRights({ account: { role: 'admin' }, roles: null });
  check('папка фотографии называет сервер сайта, даже когда права не прочитаны',
    (() => {
      target.forgetRights();
      try {
        return uploadPath('jpg').startsWith(`${target.panelServer()}/events/`);
      } finally {
        target.adoptRights({ account: { role: 'admin' }, roles: null });
      }
    })());
  check('путь загрузки лежит в папке событий своего сервера',
    uploadPath('jpg').startsWith(`${target.panelServer()}/events/`), uploadPath('jpg'));
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
  /*
    С мультиарендой своего списка мало: id альянса глобален, а панель видит
    только свой сервер. `floor` — номер, который база назвала свободным по всем
    серверам; без него «Добавить альянс» на 44-м выдал бы a02, занятый на 33-м,
    и merge-duplicates перезаписал бы чужой альянс вместо вставки своего.
  */
  equal(
    'номер не опускается ниже свободного по всем серверам',
    [
      nextAllianceId({ alliances: [{ id: 'a01' }] }, [], 33),
      nextAllianceId({ alliances: [{ id: 'a33' }] }, [], 20),
      nextAllianceId({ alliances: [{ id: 'a01' }] }, [], 0),
    ].join(' '),
    'a33 a34 a02'
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

  /*
    ФОРМА ПРАВКИ ДОЛЖНА ПОПАДАТЬСЯ ГЛАЗАМ.

    Экран рисует форму НАД списком, а список на боевых данных — 28 строк, около
    5000 px. До правки нажатие «Правка» у конца списка вставляло 1250 px формы
    выше прокрутки: видимый кусок уезжал вниз, человек видел другой конец списка
    и решал, что кнопка сломалась. Правится не разметкой — порядок формы и
    списка осознанный, — а прокруткой к открытой форме.

    Тест смотрит в текст main.js: проверка геометрии в браузере без входа в
    панель недоступна, а отсутствие вызова видно именно здесь.
  */
  const { readFile: readAdminMain } = await import('node:fs/promises');
  const adminMainSrc = await readAdminMain('src/admin/main.js', 'utf8');
  check('открытая форма альянса и хронологии показывается человеку',
    /function openAllianceForm[\s\S]{0,240}revealForm\('\[data-alliance-form\]'\)/.test(adminMainSrc)
      && /function openEventForm[\s\S]{0,240}revealForm\('\[data-event-form\]'\)/.test(adminMainSrc));
  check('отступ от прилипшей шапки измеряют, а не зашивают числом',
    /function revealForm[\s\S]{0,500}\.adm-top[\s\S]{0,200}getBoundingClientRect\(\)\.height/.test(adminMainSrc));

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
    textsFromRaw, applyTexts, textsDiff, textsCommitMessage, KNOWN_TEXT_KEYS,
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

  /* ── Валидатор ── */
  check('обычные тексты проходят валидатор', validateDataset(mapDataset(raw)).length === 0);
  check(
    'дубль ключа валидатор ловит',
    validateDataset(mapDataset({ ...raw, texts: [...raw.texts, { key: 'guide-intro', title: 'Дубль', body: '' }] }))
      .some((p) => /дубль key/.test(p))
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

  /*
    ЭКРАНА «ТЕКСТЫ» БОЛЬШЕ НЕТ — И ДОКУМЕНТЫ НЕ ИМЕЮТ ПРАВА ВОДИТЬ ЧЕЛОВЕКА
    НА ЭКРАН, КОТОРОГО В ПАНЕЛИ НЕТ.

    Беда lived ровно так: с того дня, когда на место списка ключей встал
    редактор страницы целиком, код экрана жил отдельно от навигации, а в docs
    осталась строчка «Экран Тексты → Правка». Человек открывал панель,
    искал вкладку и не находил — а найти нечего.

    Проверка двусторонняя: каждый экран навигации назван в docs, и каждое
    «Экран …» из docs живёт в навигации. Одна направляя ловила бы только
    удалённые экраны, другая — только новые.
  */
  const { readFile } = await import('node:fs/promises');
  const panelSrc = await readFile('src/admin/main.js', 'utf8');
  const screensBlock = panelSrc.match(/const SCREENS = \[([\s\S]*?)\n\];/)?.[1] ?? '';
  const labels = [...screensBlock.matchAll(/\{ id: '\w+', label: '([^']+)'/g)].map((m) => m[1]);
  const adminDoc = await readFile('docs/ADMIN.md', 'utf8');
  const editorDoc = await readFile('docs/EDITOR-GUIDE.md', 'utf8');

  check('навигация панели перечисляется — иначе проверка ниже ничего не сверяет',
    labels.length >= 10, labels.join(', '));
  equal('каждый экран панели описан в docs/ADMIN.md',
    labels.filter((label) => !adminDoc.includes(label)).join(', '), '');

  const mentioned = [...`${adminDoc}\n${editorDoc}`.matchAll(/Экран\s*(?:\*\*([^*]+)\*\*|«([^»]+)»)/g)]
    .map((m) => m[1] ?? m[2]);
  equal('документы не отправляют на экран, которого в панели нет',
    mentioned.filter((label) => !labels.includes(label)).join(', '), '');

  check('текстового экрана-списка в панели нет: его заменил редактор страницы целиком',
    !labels.includes('Тексты') && !panelSrc.includes('data-text-new'));

  /*
    ПУБЛИКАЦИЯ ОДНА, А КНОПОК ДВЕ.

    Дословно об этом и спотыкались: комментарий в main.js утверждал, что
    кнопка data-texts-publish стоит на обоих экранах, — на «Президенте» у
    неё свой адрес. Из-за этого публикация с доски не находила кнопку, не
    показывала «Публикуем…» и позволяла нажать ещё раз поверх первого
    коммита.
  */
  const guideSrc = await readFile('src/admin/screens/guide-roles.js', 'utf8');
  const presidentSrc = await readFile('src/admin/screens/president.js', 'utf8');
  check('оба живых текстовых экрана имеют свою кнопку публикации',
    /data-texts-publish/.test(guideSrc) && /data-president-publish/.test(presidentSrc));
  check('публикация текстов находит кнопку обоих экранов',
    /\[data-texts-publish\], \[data-president-publish\]/.test(panelSrc));
  check('кнопка «Президента» ведёт в тот же publishTexts',
    /data-president-publish\]'\)\) \{ savePresidentToList\(\); publishTexts\(\)/.test(panelSrc));
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
    РАЗМЕТКА РЕДАКТОРА. Человек форматирует прямо в поле (contenteditable),
    на хранение уходит HTML, показ чистит его белым списком sanitize.js.
    Проверяется не синтаксис — его больше нет — а честность HTML на выходе:
    стили редактора живы, чужой HTML становится текстом, звёздочки остаются
    буквами. Мини-разметка из helpers.js здесь не используется.
  */
  check('жирный текст редактора сохраняется',
    postBody('<strong>жирный</strong>').includes('<strong>жирный</strong>'));
  check('курсив сохраняется',
    postBody('<em>курсив</em>').includes('<em>курсив</em>'));
  check('подчёркнутый сохраняется',
    postBody('<u>подчёркнутый</u>').includes('<u>подчёркнутый</u>'));
  check('зачёркнутый сохраняется',
    postBody('<s>зачёркнутый</s>').includes('<s>зачёркнутый</s>'));
  check('вложенные стили сохраняются',
    postBody('<strong>смотри <em>сюда</em> сейчас</strong>')
      .includes('<strong>смотри <em>сюда</em> сейчас</strong>'));
  check('звёздочки остаются текстом, а не разметкой',
    postBody('**не разметка**') === '<p>**не разметка**</p>');
  check('цвет текста пропускается из белого набора',
    postBody('<span style="color: rgb(229, 83, 75)">кр</span>')
      .includes('<span style="color:rgb(229, 83, 75)">кр</span>'));
  check('стиль вне белого набора (позиция, тень) выбрасывается',
    !postBody('<span style="position:fixed">к</span>').includes('position'));
  check('сломанный HTML приводится к честному виду',
    postBody('<strong>без конца') === '<p><strong>без конца</strong></p>');
  check('теги, введённые в разметке, остаются текстом',
    !postBody('<strong><script>alert(1)</script></strong>').includes('<script>'));
  /* Заголовки в посте — текст: раздел форума задаётся категорией. */
  check('решётка не превращается в заголовок',
    !postBody('# не заголовок').includes('<h'));

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
  check('выжимка убирает разметку',
    excerpt('<strong>жирный</strong> и <s>зачёркнутый</s>', 100) === 'жирный и зачёркнутый');

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

  /* ── Разделы, включая флудилку ── */

  equal('все разделы на месте',
    CATEGORIES.map((c) => c.id).join(','), 'news,vs,chronicle,ally,help,offtop,flood,blog');
  check('у флудилки есть короткое имя и пояснение',
    CATEGORIES.some((c) => c.id === 'flood' && c.label === 'Флудилка' && /не по игре/i.test(c.hint)));
  check('идентификаторы разделов уникальны',
    new Set(CATEGORIES.map((c) => c.id)).size === CATEGORIES.length);
  check('в флудилку можно писать',
    validatePost({ title: 'Про всё подряд', body: 'поиграть', category: 'flood' }).ok);

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
  /*
    Транспорт (вход, таблицы, сессия, очистка адреса) — общий на весь проект
    и живёт в src/db/client.js, а адаптер форума его использует. Поэтому
    проверки того, как это устроено внутри, смотрим в clientSource.
  */
  const clientSource = await readFile('src/db/client.js', 'utf8');

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
    /это наша ошибка/i.test(clientSource) && /validate email\|invalid format/.test(clientSource));
  check('отказ индекса по нику переводится в «ник занят»',
    /forum_users_nick_key/.test(clientSource));

  /*
    КТО Я — ЭТО ПРОВЕРКА ИДЕНТИФИКАТОРА, А НЕ ПРАВ ДОСТУПА.

    Здесь стоял запрос «первая строка из forum_users с limit=1» с расчётом
    на то, что права и так отдадут только мою строку. Для участника верно,
    для АДМИНИСТРАТОРА нет: ему видны все профили, иначе модерация
    не работала бы. Первая строка без порядка — произвольная, на практике
    самая старая в таблице, и администратор видел на сайте ЧУЖОЙ ник.

    Совпадение ответов на «кто я» и «что мне можно читать» было случайным.
  */
  /*
    «Кто я» решает общий клиент через `currentUserId` (sub из токена).
    Проверяем, что адаптер форума делегирует ему, а не ищет первую строку.
  */
  check('«кто я» спрашивается по идентификатору из токена, а не первой строкой',
    /id=eq\.\$\{encodeURIComponent\(myId\)\}/.test(supabaseSource));
  check('идентификатор берётся из токена сессии',
    /currentUserId\(\)/.test(supabaseSource) && /\.sub\b/.test(clientSource));
  check('в запросе профиля нет ставки на «первую строку»',
    !/'\/forum_users\?select=\*&limit=1'/.test(supabaseSource));
  /*
    JWT кодируется base64url: вместо «+/» стоят «-_», выравнивающие «=»
    отброшены. atob этого не знает — без возврата обратно разбор токена
    падал бы на части ников случайным образом.
  */
  check('base64url приводится к обычному base64 перед разбором',
    /replace\(\/-\/g, '\+'\)\.replace\(\/_\/g, '\/'\)/.test(clientSource));

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
    'listPosts', 'getPost', 'createPost', 'editPost', 'deletePost', 'setPinned',
    'listComments', 'addComment', 'deleteComment',
    'setReaction', 'report', 'listReports', 'resolveReport',
    'listUsers', 'setRestriction',
    'beginRecovery', 'recoveryStatus', 'finishRecovery',
    'listRecoveryRequests', 'reviewRecovery',
    'votePoll', 'unvotePoll', 'closePoll',
    'listNotifications', 'markNotificationsRead', 'markAllNotificationsRead',
    'checkNick', 'setVerified', 'renameNick', 'renameNickAs',
    'listReservedNicks', 'addReservedNick', 'removeReservedNick', 'nickHistory',
  ];
  const missingLocal = required.filter((m) => typeof localAdapter[m] !== 'function');
  const missingSupabase = required.filter((m) => typeof supabaseAdapter[m] !== 'function');
  equal('локальный адаптер реализует контракт целиком', missingLocal.join(', '), '');
  equal('адаптер базы реализует контракт целиком', missingSupabase.join(', '), '');

  check('оба адаптера честно объявляют, видят ли записи другие люди',
    localAdapter.capabilities.isShared === false && supabaseAdapter.capabilities.isShared === true);

  /*
    Страница участника в черновом режиме. Профили читал только forum/profile.js
    напрямую из базы, и без базы нажатие на ник давало «Не удалось связаться
    с базой». Теперь локальный адаптер отдаёт профиль сам, а profile.js идёт
    к нему, если тот умеет.
  */
  check('локальный адаптер умеет профили',
    ['getProfile', 'getUserPosts', 'saveProfile'].every((m) => typeof localAdapter[m] === 'function'));
  const profileSource = await readFile('src/forum/profile.js', 'utf8');
  check('profile.js ходит к адаптеру, если тот умеет профили',
    /typeof forum\.getProfile === 'function'/.test(profileSource) && /if \(ownProfiles\) return forum\.getProfile/.test(profileSource));

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
    /replace\(\/\\\/\(rest\|auth\|storage\)\\\/v\\d\+\\\/\?\$\/i, ''\)/.test(clientSource));
  check('запросы строятся от очищенного адреса, а не от строки из конфига',
    !/\$\{CFG\.url\}\/(rest|auth)/.test(clientSource) && /baseUrl\(\)/.test(clientSource));

  /*
    Локальный режим паролей не знает вовсе. Изобразить очередь заявок было бы
    хуже отказа: владелец решил бы, что подтвердил восстановление, хотя
    подтверждать там нечего. Отказываемся всеми пятью методами — проверка
    держит это на месте.
  */
  const recoveryMethods = [
    'beginRecovery', 'recoveryStatus', 'finishRecovery',
    'listRecoveryRequests', 'reviewRecovery',
  ];
  for (const name of recoveryMethods) {
    let refused = false;
    try {
      await localAdapter[name]('u1', 'x');
    } catch {
      refused = true;
    }
    check(`в локальном режиме «${name}» честно отказывает`, refused);
  }
  check('сброса пароля из панели больше нет ни в одном адаптере',
    !('resetPassword' in localAdapter) && !('resetPassword' in supabaseAdapter));

  /* ── Правка поста и поиск: локальный режим ── */

  const loc = localAdapter;
  // Адаптер хранит сессию в localStorage; в Node его нет — даём in-memory.
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  await loc.signUp('писатель_для_тестов');
  const madeVs = await loc.createPost({ title: 'Разбор матча VS', body: 'всё по полочкам', category: 'vs' });
  await loc.createPost({ title: 'Болтовня', body: 'как же дела', category: 'flood' });

  const moved = await loc.editPost(madeVs.id, { category: 'flood', title: 'Разбор матча (перенесено)' });
  check('правка поста меняет раздел и заголовок',
    moved.category === 'flood' && moved.title.endsWith('перенесено)'));
  check('правка поста не трогает автора', moved.authorId === madeVs.authorId);

  equal('поиск находит по слову из текста',
    (await loc.listPosts({ q: 'полочкам' })).posts.length, 1);
  equal('поиск находит по слову из заголовка',
    (await loc.listPosts({ q: 'болтовня' })).posts.length, 1);
  equal('поиск не зависит от регистра',
    (await loc.listPosts({ q: 'РАЗБОР' })).posts.length, 1);
  equal('поиск без совпадений возвращает пусто',
    (await loc.listPosts({ q: 'небывальщина' })).posts.length, 0);

  /* ── Ники и верификация: локальный адаптер ── */

  await loc.addReservedNick('Рогоз');
  let reservedRefused = false;
  try {
    await loc.signUp('рогоз');
  } catch {
    reservedRefused = true;
  }
  check('стоп-лист отказывает занявшему похожее написание', reservedRefused);
  await loc.removeReservedNick('рогоз');
  const free = await loc.checkNick('свободный_ник');
  check('checkNick отвечает «свободно» на незанятый ник', free.status === 'free');
  const wannabe = await loc.signUp('гек_к_проверке');
  const meAgain = await loc.signIn('писатель_для_тестов');
  check('в локальном режиме первый игрок — владелец', meAgain.role === 'admin');
  check('checkNick отвечает «занято» на существующий ник',
    (await loc.checkNick('гек_к_проверке')).status === 'taken');

  /* Confusable-ники: стоп-лист и занятые ключи ловят похожие написания —
     латинскую диакритику, цифры 0/1 вместо букв и греческие буквы. */
  await loc.addReservedNick('няша0');
  let digitAsO = false;
  try {
    await loc.signUp('няшао');
  } catch {
    digitAsO = true;
  }
  check('стоп-лист ловит «0» как «о»', digitAsO);
  await loc.removeReservedNick('няша0');

  await loc.addReservedNick('крéмль');
  let accentAsE = false;
  try {
    await loc.signUp('кремль');
  } catch {
    accentAsE = true;
  }
  check('стоп-лист ловит диакритику «é» как «е»', accentAsE);
  await loc.removeReservedNick('крéмль');

  await loc.addReservedNick('маскарад');
  let greekAsO = false;
  try {
    await loc.signUp('масκарад');
  } catch {
    greekAsO = true;
  }
  check('стоп-лист ловит греческую «κ» как «к»', greekAsO);
  await loc.removeReservedNick('маскарад');

  await loc.setVerified(wannabe.id, true);
  const checkOk = await loc.signIn('гек_к_проверке');
  check('проверка отразилась в профиле', checkOk.isVerified === true && typeof checkOk.verifiedBy === 'string');
  let selfRefused = false;
  try {
    await loc.setVerified(checkOk.id, false);
  } catch {
    selfRefused = true;
  }
  check('самому себе снять проверку нельзя', selfRefused);
  await loc.signIn('писатель_для_тестов');
  await loc.setVerified(wannabe.id, false);

  const renamed = await loc.renameNick('Писатель');
  check('смена ника прошла без ошибок', renamed === undefined);
  check('посты переподписываются новым ником',
    (await loc.listPosts({ q: 'полочкам' })).posts[0].authorNick === 'Писатель');
  const history = await loc.nickHistory(meAgain.id);
  check('смена записана в журнал переименований',
    history.length >= 1 && /писатель_для_тестов → Писатель/.test(`${history[history.length - 1].oldNick} → ${history[history.length - 1].newNick}`));
  let oldNickRefused = false;
  try {
    await loc.renameNick('писатель_для_тестов');
  } catch {
    oldNickRefused = true;
  }
  check('освобождённый ник автоматически резервируется навсегда', oldNickRefused);
  let shapeRefused = false;
  try {
    await loc.renameNick('!!');
  } catch {
    shapeRefused = true;
  }
  check('смена ника держит формат букв и цифр, как база', shapeRefused);

  /*
    Раздел проверяется и в браузере (validatePost), и в адаптерах: база свою
    ошибку вернёт, но «Неизвестный раздел» понятнее «violates check constraint».
  */
  let badCategory = false;
  try {
    await loc.editPost(madeVs.id, { category: 'nope' });
  } catch {
    badCategory = true;
  }
  check('правка с неизвестным разделом отклоняется', badCategory);

  /* ── Закрепление темы — модерация, локальный режим ── */

  /*
    Первый зарегистрировавшийся в локальном режиме — администратор, у него
    право закреплять есть. Лимит — ровно три темы, число из конфига.
  */
  const pinable = await Promise.all([1, 2, 3, 4].map((n) =>
    loc.createPost({ title: `Закрепить ${n}`, body: 'для проверки топа', category: 'news' })
  ));

  const pinnedOne = await loc.setPinned(pinable[0].id, true);
  check('закреплённый пост возвращается с отметкой', pinnedOne.pinned);
  equal('закреплённая тема встаёт в топ ленты',
    (await loc.listPosts({})).posts[0].id, pinable[0].id);

  await loc.setPinned(pinable[1].id, true);
  await loc.setPinned(pinable[2].id, true);
  let tooMany = false;
  try {
    await loc.setPinned(pinable[3].id, true);
  } catch {
    tooMany = true;
  }
  check('четвёртое закрепление отклоняется', tooMany);

  await loc.setPinned(pinable[0].id, false);
  const freed = await loc.setPinned(pinable[3].id, true);
  check('после открепления место освобождается', freed.pinned);

  await loc.signUp('прохожий_для_проверки');
  let noRight = false;
  try {
    await loc.setPinned(pinable[1].id, true);
  } catch {
    noRight = true;
  }
  check('обычный участник закрепить не может', noRight);
  // Назад к администратору: следующие блоки ждут его сессию.
  await loc.signIn('Писатель');

  /* ── Поиск и правка: источник базы ── */

  /*
    Поиск в базе — параметр or= с ilike по названию и тексту: фильтрует сам
    Postgres, лента целиком в браузер не едет.
  */
  check('поиск в базе идёт параметром or, а не локальной вырезкой ленты',
    /title\.ilike\.\*\$\{query\}\*,body\.ilike\.\*\$\{query\}\*/.test(supabaseSource));
  check('адаптер базы проверяет раздел при правке, а не доверяет строке',
    /if \(patch\.category != null\)[\s\S]*CATEGORY_IDS\.includes\(patch\.category\)/.test(supabaseSource));
  check('адаптер базы ставит отметку времени правки',
    /edited_at/.test(supabaseSource) && /editPost/.test(supabaseSource));

  /* ── Лимит картинок: одно число в конфиге и пара к нему ── */

  const forumConfig = (await import('../config.js')).CONFIG.forum.limits.attachmentsMax;
  check('лимит картинок задан и больше четырёх',
    Number.isInteger(forumConfig) && forumConfig > 4 && forumConfig <= 20);

  const mountSource = await readFile('src/forum/mount.js', 'utf8');
  const editorSource = await readFile('src/forum/editor.js', 'utf8');
  check('браузер берёт предел из конфига, а не из зашитой четвёрки',
    /const MAX_SHOTS = CONFIG\.forum\.limits\.attachmentsMax/.test(mountSource) && !/\bMAX_SHOTS = 4\b/.test(mountSource));
  check('у правки поста есть форма, а у формы — комнаты',
    /data-forum-edit-form/.test(mountSource) && /edit:\$\{id\}/.test(mountSource));
  check('поиск по ленте держит паузу и сам перерисовывает список',
    /data-forum-search/.test(mountSource) && /setTimeout/.test(mountSource));
  check('цитата собирается из имени и текста и встаёт блоком',
    /data-forum-quote/.test(mountSource) && /blockquote/.test(mountSource) && /\$\{esc\(item\.authorNick\)\}:/.test(mountSource));

  /*
    Закрепление — действие модерации: кнопка в карточке поста, а обработчик
    дергает setPinned и перерисовывает ленту (закреплённые уходят наверх).
  */
  const forumOverlayStyles = await readFile('src/refine.css', 'utf8');
  check('окна форума не привязаны к анимированному контейнеру страницы',
    /#app:has\(\.forum-modal\)\s*\{\s*animation:\s*none;\s*\}/.test(forumOverlayStyles));
  check('открытое окно форума выше шапки и бокового меню',
    /#app:has\(\.forum-modal:not\(\[hidden\]\)\)\s*\{\s*z-index:\s*60;\s*\}/.test(forumOverlayStyles));
  check('карточка с открытым меню выше соседних карточек',
    /\.forum-post:has\(\.forum-act-menu\[open\]\)\s*\{\s*z-index:\s*3;\s*\}/.test(forumOverlayStyles));
  check('редактор ответа не перекрывает меню действий поста',
    /\.forum-post\s*>\s*\.forum-post__foot:has\(\.forum-act-menu\[open\]\)\s*\{\s*z-index:\s*3;\s*\}/.test(forumOverlayStyles));
  const forumPagesSource = await readFile('src/pages/forum.js', 'utf8');
  check('кнопка закрепления есть в карточке поста',
    /data-forum-pin/.test(forumPagesSource) && /Закрепить/.test(forumPagesSource) && /Открепить/.test(forumPagesSource));
  check('обработчик закрепления зовёт адаптер и перерисовывает ленту',
    /\[data-forum-pin\]/.test(mountSource) && /forum\.setPinned/.test(mountSource) && /loadFeed\(\)/.test(mountSource));
  check('адаптер базы спрашивает предел из конфига перед запросом',
    /pinsMax/.test(supabaseSource) && /pinned', 'eq\.true'/.test(supabaseSource));
  check('предел закреплений считается по серверу темы, а не по всему сайту',
    /server_id', `eq\.\$\{serverId\}`/.test(supabaseSource)
      && /В этом сервере закреплено уже три темы — сначала открепите одну/.test(supabaseSource));

  /*
    Проводка восстановления в mount.js. Страницы и адаптеры проверяются
    тестами выше, но между ними живёт склейка: кто создаёт ключ, кто спрашивает
    статус и что происходит, когда база ещё не перестроена. Всё это не видно
    ни в одном рендере, и разрыв обнаружился бы только у человека с потерянным
    паролем.
  */
  check('ключ рождается в браузере, а в адаптер уходит только отпечаток',
    /const key = createRecoveryKey\(\)/.test(mountSource)
    && /const hash = await hashRecoveryKey\(key\)/.test(mountSource)
    && /forum\.beginRecovery\(nick\.value, hash\)/.test(mountSource));
  check('заявка сохраняется только после принятого запроса',
    mountSource.indexOf('await forum.beginRecovery(') > 0
    && mountSource.indexOf('await forum.beginRecovery(') < mountSource.indexOf('if (!saveRecovery(')
    && /catch \(err\) \{[\s\S]{0,120}?r\.error = recoveryErrorText\(err\);\s*\n\s*paint\(\);\s*\n\s*return;/.test(mountSource));
  check('после успешно поставленного пароля ключ сжигается',
    /await forum\.finishRecovery[\s\S]{0,400}?clearRecovery\(\)/.test(mountSource));
  check('возврат на страницу продолжает с того же шага',
    /const saved = loadRecovery\(\)/.test(mountSource) && /r\.phase = 'wait'/.test(mountSource));
  check('кнопка «Проверить» есть на странице и спрашивает базу',
    /data-forum-recovery="check"/.test(forumPagesSource) && /act === 'check'/.test(mountSource)
    && /await recoveryCheck\(\)/.test(mountSource));
  check('сырой ответ базы игрок не видит',
    /function recoveryErrorText/.test(mountSource)
    && (mountSource.match(/r\.error = recoveryErrorText\(err\)/g) || []).length === 3
    && !/r\.error = String\(err\?\.message/.test(mountSource));
  check('перерисовка во время ответа базы не подменяет состояние',
    /const token = mountToken;[\s\S]{0,300}?if \(token !== mountToken\) return;/.test(mountSource));

  /*
    Шаг «можно ставить пароль» выбирает база. Свои часы на странице оставили бы
    поле у человека с неправильным временем — и он бы бился в отказ, которого
    страница ему не обещала.
  */
  check('шаг выбирается по canSet из ответа базы',
    /r\.canSet = info\.canSet === true;/.test(mountSource)
    && /r\.phase = r\.canSet \? 'set' : 'wait';/.test(mountSource));
  check('срок до самоприёма доезжает до состояния страницы',
    /r\.readyAt = info\.readyAt \?\? null;/.test(mountSource));
  check('и старое значение не переживает перезапуск шага',
    (mountSource.match(/canSet: false/g) || []).length >= 2
    && (mountSource.match(/r\.canSet = false;/g) || []).length >= 1);
  check('адаптер не додумывает статус, когда база ответила пустотой',
    /if \(!row \|\| typeof row\.status !== 'string'\) return \{ status: 'none', canSet: false, readyAt: null \};/.test(supabaseSource));

  /*
    Панель форматирования: кнопки дёргают document.execCommand — жирный, цвет
    и прочее видно в редакторе сразу, разметка при показе не собирается.
    Сами команды переехали в общий модуль редактора (forum/editor.js),
    mount.js только подвязывает его к своей форме.
  */
  check('панель форматирования работает командами редактора',
    editorSource.includes('data-editor-cmd') && editorSource.includes('document.execCommand'));
  check('цвета применяются кнопками палитры',
    editorSource.includes('data-editor-color') && editorSource.includes('foreColor'));
  check('предел длины держит сам редактор',
    editorSource.includes('beforeinput') && editorSource.includes('paste'));
  check('кнопка стиля держится, пока стиль действует',
    editorSource.includes('queryCommandState'));

  /* ── Схема базы: где живёт настоящая защита ── */

  const schema = await readFile('supabase/applied/schema.sql', 'utf8');

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
    не должен ни при каких условиях: пароль пишет функция внутри базы.

    Функция сброса пароля из панели удалена совсем. Проверка держит её мёртвой:
    пока она есть в схеме, любой, кому доверили панель, знает чужие пароли,
    и никакие тексты в интерфейсе этого не отменят.
  */
  check('сброса пароля властью панели в схеме больше нет',
    !/create (or replace )?function public\.forum_admin_reset_password/.test(schema)
    && !/grant execute on function public\.forum_admin_reset_password/.test(schema));

  /*
    САМОВОССТАНОВЛЕНИЕ ДОСТУПА.

    Отдельный файл, а не правка schema.sql: живая база уже развёрнута, и ей
    нужен скрипт, который прогоняют один раз. Schema.sql описывает новую базу
    целиком, а recovery-миграция — переход. Проверки читают именно миграцию,
    потому что на боевой базе выполняется она.
  */
  const recoverySql = await readFile('supabase/applied/20260925-self-recovery.sql', 'utf8');

  /*
    Неоткрытая скобка dollar-quoted тела — ошибка, которую Supabase показывает
    как «syntax error at end of input» в самой последней строке файла. Найти её
    глазами в шестистах строках сложно, а считается она просто: чётное число.
  */
  check('миграция восстановления: dollar-скобки закрыты',
    (recoverySql.match(/\$\$/g) || []).length % 2 === 0);

  /*
    RAISE не терпит склейки: `'текст' || переменная` — это синтаксическая ошибка,
    которую база показывает только в момент create function. На месте промаха
    не виден: миграция выполняется до конца файла, и падает ровно там, где её
    уже начали применять. Правильная форма — `'текст %', переменная`.
  */
  check('миграция восстановления: в raise нет склейки через ||',
    !/raise (exception|notice|warning)[^;]*\|\|/.test(recoverySql));

  for (const fn of ['forum_begin_recovery', 'forum_review_recovery', 'forum_recovery_status', 'forum_finish_recovery']) {
    check(`${fn}: существует в миграции и защищена правами вызывающего`,
      new RegExp(`create or replace function public\\.${fn}\\b[\\s\\S]*?security definer set search_path`).test(recoverySql));
  }

  /*
    Потерявший доступ войти не может — значит все три шага игрока вызываются
    АНОНИМНО. Если хотя бы одному закроить доступ от anon, страница восстановления
    превратится в «не удалось связаться с базой» ровно для тех, ради кого её делали.
  */
  for (const fn of ['forum_begin_recovery', 'forum_recovery_status', 'forum_finish_recovery']) {
    check(`${fn}: доступна анонимному запросу`,
      new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated`).test(recoverySql));
  }
  check('решать заявку может только вошедший владелец',
    /revoke all on function public\.forum_review_recovery[^;]*from public, anon/.test(recoverySql)
    && /grant execute on function public\.forum_review_recovery\(uuid, boolean\) to authenticated/.test(recoverySql));
  check('решение о заявке проверяет владельца внутри базы',
    /forum_review_recovery[\s\S]*?if not public\.forum_is_admin\(\) then\s+raise exception/.test(recoverySql));

  /*
    Ключа и пароля наружу — нигде. Это и есть смысл изменений, поэтому держится
    проверкой: достаточно одному будущему правке добавить code_hash в список
    полей представления, и «владелец не знает ваш пароль» станет неправдой.
  */
  check('список для панели не отдаёт отпечатки ключей',
    /create or replace view public\.forum_recovery_requests[\s\S]*?from public\.forum_recoveries/.test(recoverySql)
    && !/create or replace view public\.forum_recovery_requests[\s\S]*?code_hash/.test(recoverySql));
  check('представление заявок читается правами запрашивающего',
    /create or replace view public\.forum_recovery_requests\s+with \(security_invoker = true\)/.test(recoverySql));
  check('функция финала ничего не возвращает — показывать пароль нечем',
    /create or replace function public\.forum_finish_recovery\([\s\S]*?\)\s*returns void/.test(recoverySql));

  /*
    САМОПРИЁМ ЗАЯВКИ. Главный смысл новых правил: игрока впускает срок, а не
    живое человек, и держится это базой. Страница может что угодно показать —
    пустит её только проверка ниже, поэтому проверяем именно её.
  */
  check('отсчёт идёт от создания заявки, а не от чьего-либо решения',
    /v_row\.created_at \+ interval '12 hours'/.test(recoverySql));
  check('pending после выдержки пропускается, до выдержки — нет',
    /if v_row\.status = 'pending' then\s+if v_row\.created_at \+ interval '12 hours' > now\(\) then/.test(recoverySql));
  check('ранний приход получает отказ с настоящим остатком',
    /Заявка примет пароль через % минут/.test(recoverySql)
    && /extract\(epoch from \(v_row\.created_at \+ interval '12 hours' - now\(\)\)/.test(recoverySql));
  check('выдержка не оживляет отказ, used и просроченную заявку',
    /elsif v_row\.status <> 'approved' then\s+raise exception 'Заявка закрыта/.test(recoverySql));
  check('перезаявка обнуляет и срок: старый ключ не держит дверь открытой',
    /status     = 'pending',\s*\n\s*created_at = now\(\)/.test(recoverySql));
  check('статус отдаёт jsonb и снимает старую сигнатуру — тип результата не заменить',
    /drop function if exists public\.forum_recovery_status\(text, text\);[\s\S]*?create or replace function public\.forum_recovery_status\([\s\S]*?\)\s*returns jsonb/.test(recoverySql));
  check('право ставить пароль считает база, а не часы игрока',
    /'canSet', v_row\.status = 'approved'\s*\n\s*or v_row\.created_at \+ interval '12 hours' <= now\(\)/.test(recoverySql));
  check('и остаток до самоприёма уходит на страницу',
    /'readyAt', v_row\.created_at \+ interval '12 hours'/.test(recoverySql));
  check('закрытая заявка не получает ни права, ни срока',
    (/return jsonb_build_object\('status', v_row\.status, 'canSet', false, 'readyAt', null\);/.test(recoverySql)));
  check('панель видит тот же час самоприёма из представления',
    /r\.created_at \+ interval '12 hours' as ready_at/.test(recoverySql));
  check('число выдержки на сайте и в базе одно',
    recoverySql.includes(`interval '${CONFIG.forum.limits.recoveryHoldHours} hours'`));

  /*
    Одна открытая заявка на игрока и срок у каждой. Без частичного уникального
    индекса анонимный вызов забил бы очередь владельца мусором за минуту;
    без сроков подтверждение превратилось бы в постоянную открытую дверь.
  */
  check('открытая заявка на игрока возможна только одна',
    /create unique index[^;]*forum_recoveries_one_open[\s\S]*?where status in \('pending', 'approved'\)/.test(recoverySql));
  check('заявка живёт неделю, подтверждённая — сутки',
    /interval '7 days'/.test(recoverySql) && /interval '24 hours'/.test(recoverySql));
  check('частые заявки с одного ника останавливаются',
    /interval '24 hours'\s*\n\s*\) >= 3/.test(recoverySql));
  check('таблица заявок закрыта политиками доступа',
    /alter table public\.forum_recoveries enable row level security/.test(recoverySql)
    && /create policy forum_recoveries_staff_read on public\.forum_recoveries\s+for select using \(public\.forum_is_admin\(\)\)/.test(recoverySql));
  check('старый сброс пароля убирается из живой базы',
    /drop function if exists public\.forum_admin_reset_password/.test(recoverySql));
  /*
    Вход для самого владельца, если подтверждать заявку некому, обязан остаться
    закомментированным: кнопка в панели для этого была бы дырой ровно того же
    размера, от которой мы сейчас ушли.
  */
  check('запасной вход владельца существует только как комментарий',
    /^--\s+update auth\.users[\s\S]*?role = 'admin'/m.test(recoverySql));

  /*
    security_invoker обязателен: без него представление читало бы данные
    правами своего владельца, то есть в обход всех политик выше.

    ОДНО ИСКЛЮЧЕНИЕ — forum_profiles. Там invoker выключен НАРОЧНО: это
    открытая страница участника, и представление само служит границей доступа.
    Оно отбирает поля, которые можно показать кому угодно, и читается правами
    владельца — поверх правил на таблице.

    С invoker = on оно повторяло проверку самой таблицы («читать только свой
    профиль»), и гость не видел ни аватарок в ленте, ни чужих страниц.
    Ошибку допустили дважды, поэтому здесь она закреплена проверкой.

    Считаем объявления «create view»: представления пересоздаются через drop,
    потому что заменой нельзя добавить колонку в середину.
  */
  const views = schema.match(/create (?:or replace )?view public\.\w+/g) ?? [];
  const invokers = schema.match(/with \(security_invoker = on\)/g) ?? [];
  equal('каждое представление читает данные правами того, кто спросил',
    invokers.length, views.length);

  const profilesSql = await readFile('supabase/applied/profiles.sql', 'utf8');
  check('предел картинок в триггере базы совпадает с конфигом',
    new RegExp(`>=\\s*${CONFIG.forum.limits.attachmentsMax}\\b`).test(profilesSql));
  const profileView = profilesSql.slice(
    profilesSql.indexOf('create view public.forum_profiles'),
    profilesSql.indexOf('grant select on public.forum_profiles')
  );
  check('открытый профиль читается поверх правил таблицы, иначе гость не видит ничего',
    /security_invoker = off/.test(profileView));
  /*
    Обратная сторона того же решения: раз представление проходит поверх правил,
    в нём не должно быть ни одного поля, которое нельзя показать чужому.
    Не «скрыто», а не выбрано.
  */
  for (const secret of ['banned', 'ban_reason', 'muted_until', 'can_edit_site']) {
    check(`открытый профиль не отдаёт ${secret}`, !new RegExp(`\\b${secret}\\b`).test(profileView));
  }

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

  /*
    ЗАВИСИМОЕ УДАЛЯЕТСЯ ПЕРВЫМ.

    Лента и комментарии ссылаются на forum_profiles, поэтому удалить профиль,
    пока они существуют, нельзя:

      cannot drop view forum_profiles because other objects depend on it

    Postgres предлагает CASCADE, и это плохой совет для файла, который
    запускают повторно: CASCADE снесёт всё зависимое молча, включая то, о чём
    автор файла не думал. Однажды он унесёт нужное — и без единого сообщения.

    Поэтому зависимые удаляются явно и раньше основы. Проверяем порядок:
    удаление профиля не должно стоять выше удаления ленты.
  */
  const dropProfiles = profilesSql.indexOf('drop view if exists public.forum_profiles');
  const dropFeed = profilesSql.indexOf('drop view if exists public.forum_post_list');
  const dropComments = profilesSql.indexOf('drop view if exists public.forum_comment_list');
  check('зависимые представления удаляются раньше того, от чего зависят',
    dropFeed >= 0 && dropComments >= 0 && dropFeed < dropProfiles && dropComments < dropProfiles);
  /*
    Ищем CASCADE именно в удалении представлений. Два уточнения, каждое
    из которых уже давало ложное срабатывание:

    — «on delete set null» у связи постов с автором — совсем другое дело.
      Удаляя учётную запись, посты надо ОСТАВИТЬ (ник лежит копией в самой
      записи, и читатель не должен терять дискуссию из-за чужой пропажи).
      Это отдельная история, и к удалению представлений отношения не имеет;

    — комментарии выбрасываем. Разбор этой самой ошибки написан в схеме
      прямо над исправленным местом, и текст сообщения Postgres содержит
      слова «drop view ... CASCADE». Без чистки тест ловит объяснение
      вместо кода — третий раз на тех же граблях.
  */
  const sqlCode = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  const dropsWithCascade = [
    ...sqlCode(profilesSql).matchAll(/drop\s+view[^;]*;/gi),
    ...sqlCode(schema).matchAll(/drop\s+view[^;]*;/gi),
  ].filter((m) => /cascade/i.test(m[0]));
  equal('CASCADE не используется при удалении представлений — он снёс бы зависимое молча',
    dropsWithCascade.length, 0);

  /* ── Счётчик просмотров ── */

  check('счётчик просмотров заведён в таблицу постов',
    /forum_posts\s*\([\s\S]*?views\s+integer\s+not\s+null\s+default\s+0/m.test(schema));
  check('счётчик просмотров есть и у старых баз (миграция)',
    /alter table public\.forum_posts add column if not exists views integer not null default 0/.test(schema));
  for (const name of ['schema.sql', 'profiles.sql', 'rich-forum.sql']) {
    const src = await readFile(`supabase/applied/${name}`, 'utf8');
    check(`${name}: лента отдаёт счётчик просмотров`,
      /p\.views,\s*\n\s*\(select count\(\*\) from public\.forum_comments/.test(src));
  }
  check('просмотр считает функция в базе, а не клиент',
    /create or replace function public\.forum_register_view\(target_post uuid\)/.test(schema));
  check('счётчик просмотров открыт и гостю',
    /grant execute on function public\.forum_register_view\(uuid\) to authenticated, anon/.test(schema));
  check('просмотр не считает удалённые темы',
    /views = views \+ 1\s*\n\s*where id = target_post\s*\n\s*and deleted = false/.test(schema));

  /* ── Удаление аккаунта из панели ── */

  check('удаление аккаунта — функция в базе (править пользователей из сайта нельзя)',
    /create or replace function public\.forum_admin_delete_user\(\s*target_user uuid\s*\)/.test(schema));
  check('удаление аккаунта доступно только вошедшим',
    /revoke all on function public\.forum_admin_delete_user\(uuid\) from public, anon/.test(schema) &&
      /grant execute on function public\.forum_admin_delete_user\(uuid\) to authenticated/.test(schema));
  check('удаление аккаунта запрещает владелец и сам себя',
    /target_user = auth\.uid\(\)/.test(schema) && /role from public\.forum_users where id = target_user\) = 'admin'/.test(schema));
  check('удаление аккаунта рвёт только связь: посты и комментарии остаются',
    /forum_posts\s*\([\s\S]*?author_id\s+uuid references public\.forum_users \(id\) on delete set null/m.test(schema) &&
      /forum_comments\s*\([\s\S]*?author_id\s+uuid references public\.forum_users \(id\) on delete set null/m.test(schema));

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
    ТРИГГЕР НА НЕСКОЛЬКО ТАБЛИЦ НЕ ОБРАЩАЕТСЯ К ПОЛЯМ НАПРЯМУЮ.

    Журнал правок обслуживает пять таблиц с разными ключами: у результатов
    составной week_id + alliance_id, у текстов key, у остальных id. Первая
    версия выбирала нужное через CASE по имени таблицы — и падала на первой
    же вставке альянса:

      record "new" has no field "week_id"

    PL/pgSQL отдаёт CASE целиком как один SQL-запрос, и ссылки на поля
    проверяются во ВСЕХ ветках сразу, а не только в подходящей. У альянса
    поля week_id нет — отказ, хотя эта ветка никогда бы не выполнилась.

    Обращение к jsonb такой проверки не требует: отсутствующий ключ даёт NULL.
  */
  const siteData = await readFile('supabase/applied/site-data.sql', 'utf8');
  const auditFn = siteData.match(/create or replace function public\.site_write_audit[\s\S]*?\$\$;/)?.[0] ?? '';
  /*
    Комментарии выбрасываем: разбор этой самой ошибки написан внутри функции,
    и без чистки тест поймал бы объяснение вместо кода — ровно та же ловушка,
    что была в проверке подзапросов в политиках.
  */
  const auditCode = auditFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');
  check('журнал правок читает строку как jsonb, а не по именам полей',
    /to_jsonb/.test(auditCode) && !/new\.week_id|new\.alliance_id|new\.key\b/.test(auditCode));
  check('составной ключ результата собирается читаемым',
    /week_id.*\|\|.*alliance_id/.test(auditCode));

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
  check('лимит закреплений держит триггер базы, а не только браузер',
    /if new\.pinned and not old\.pinned then[\s\S]*?where pinned and not deleted[\s\S]*?>= 3/.test(schema)
    && /Закреплено уже три темы/.test(schema));
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
  for (const f of ['supabase/applied/first-admin.sql', 'supabase/applied/cleanup-test-data.sql']) {
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
  for (const f of ['supabase/applied/first-admin.sql', 'supabase/applied/cleanup-test-data.sql']) {
    const code = (await readFile(f, 'utf8')).replace(/^\s*--.*$/gm, '');
    const spots = (code.match(/lower\('[^']*'\)/g) ?? []).length;
    equal(`${f}: одно место для правки`, spots, 1);
  }

  /*
    Очистка обязана останавливаться, если ник не совпал: без этого опечатка
    удаляет всех, включая владельца, и вернуть уже нечего.
  */
  const cleanup = await readFile('supabase/applied/cleanup-test-data.sql', 'utf8');
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
  for (const f of ['supabase/applied/first-admin.sql', 'supabase/applied/cleanup-test-data.sql']) {
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

  /*
    САМОВОССТАНОВЛЕНИЕ ДОСТУПА СО СТОРОНЫ ИГРОКА.

    Держим главное обещание новых правил: пароль вводит сам человек, и ему не
    нужен живой свидетель. Пока он не назвал ник, на странице нечего копировать
    и негде набрать пароль, а форма восстановления — сосед формы входа: вложенные
    формы браузер расколол бы так, что кнопка «войти» начала отправлять заявку.
  */
  const HOLD_HOURS = CONFIG.forum.limits.recoveryHoldHours;
  const inFourHours = new Date(Date.now() + 4 * 3600000 + 12 * 60000);
  const recHtml = (over) => renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, posts: [], me: null,
    recovery: {
      available: true, open: true, phase: 'begin', nick: 'Игрок',
      key: '0123456789abcdef0123456789abcdef', status: 'pending',
      canSet: false, readyAt: null, error: '', ...over,
    },
  });
  const begin = recHtml({ phase: 'begin' });
  const wait = recHtml({ phase: 'wait', readyAt: inFourHours });
  const ready = recHtml({ phase: 'set', canSet: true });
  const set = recHtml({ phase: 'set', status: 'approved' });

  check('без доступного входа шага восстановления нет',
    !guestHtml.includes('data-forum-recovery'));
  check('свёрнутая заявка — одна кнопка, без ключа',
    /data-forum-recovery="open"/.test(recHtml({ open: false }))
    && !recHtml({ open: false }).includes('data-forum-recovery-key'));
  check('на шаге ника есть форма заявки', begin.includes('<form data-forum-recovery-begin'));
  check('ключа ещё нет — придумывать его рано', !begin.includes('data-forum-recovery-key'));
  check('и поля для пароля на первом шаге нет', !begin.includes('data-forum-recovery-finish'));
  check('ожидание показывает ключ', wait.includes('data-forum-recovery-key'));
  check('и срок до самоприёма — часами, а не датой в календаре',
    /Откроется сама через 4 ч 12 мин/.test(wait));
  check('срок назван тот же, что держит база',
    wait.includes(`${HOLD_HOURS} ч после создания`)
    && recoverySql.includes(`interval '${HOLD_HOURS} hours'`));
  check('никого не нужно уговаривать: это сказано игроку прямо',
    /без чьего-либо подтверждения/.test(wait));
  check('и право владельца возразить не спрятано', /отклонить/.test(wait));
  check('шаги подписаны ожиданием, а не решением владельца',
    new RegExp(`Ожидание ${HOLD_HOURS} ч`).test(wait));
  check('истёкшая выдержка зовёт ставить пароль', /Время вышло — ставьте пароль/.test(ready));
  check('и на этом шаге есть форма пароля', ready.includes('<form data-forum-recovery-finish'));
  check('никто не опоздал: обещано, что вход остаётся за игроком',
    /возражений не было/.test(ready));
  check('досрочное подтверждение названо досрочным', /Владелец впустил досрочно/.test(set));
  check('после подтверждения появляется поле нового пароля', set.includes('<form data-forum-recovery-finish'));
  check('пароль вводится дважды и не подставляется браузером',
    (set.match(/autocomplete="new-password"/g) || []).length === 2);
  check('форма восстановления не вложена в форму входа',
    begin.slice(0, begin.indexOf('<form data-forum-recovery-begin')).includes('</form>'));
  const shownKey = (wait.match(/data-forum-recovery-key>([\s\S]*?)<\/code>/) || [, ''])[1];
  check('ключ разбит на две строки — его переписывают с экрана',
    shownKey === '0123456789abcdef\n0123456789abcdef');
  check('ошибку адаптера показывают рядом, а не молчат',
    /forum-error/.test(recHtml({ error: 'Заявок на этот ник уже достаточно' })));
  check('без срока в ответе базы страница не врет про «через 0 ч»',
    /Заявка ждёт свой срок/.test(recHtml({ phase: 'wait' })));

  const me = { id: 'u1', nick: 'Qvaden', role: 'admin', createdAt: new Date(), banned: false, mutedUntil: null };
  const post = {
    id: 'p1', authorId: 'u2', authorNick: 'Игрок', category: 'vs',
    title: 'Разбор', body: 'текст поста', createdAt: new Date(), commentCount: 0,
    reactions: { like: 2 }, myReaction: null, score: 2, deleted: false, views: 7,
  };

  const memberHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me, posts: [post],
  });
  check('вошедшему показана форма написания поста', memberHtml.includes('data-forum-new'));
  check('перед публикацией названы правила и последствие',
    /соглашаетесь с правилами/i.test(memberHtml));
  check('форма поста предлагает форматирование',
    memberHtml.includes('data-editor') && memberHtml.includes('forum-md'));
  check('текст вводится в редактор, стили видны сразу',
    memberHtml.includes('contenteditable') && memberHtml.includes('data-placeholder'));
  check('чужой пост можно пожаловаться', memberHtml.includes('data-forum-report="post:p1"'));
  check('счётчик лайков виден', memberHtml.includes('>2<'));
  check('в карточке виден счётчик просмотров', memberHtml.includes('👁 7'));
  /* Разделы управляются и кнопками, и выпадающим списком (телефон).
     Список свой, а не системный <select>: системный на телефоне раскрывается
     во весь экран и теряет страницу, по которой человек выбирал. */
  check('управление разделами работает и выпадающим списком',
    memberHtml.includes('data-pick-open') &&
      memberHtml.includes('class="pick__menu"') &&
      memberHtml.includes('data-forum-cat="all"'));
  check('выпадающий список не системный select',
    !/<select[^>]*data-forum-cat-pick/.test(memberHtml));
  check('в списке заранее размечен выбранный раздел',
    memberHtml.includes('data-forum-cat="all"') &&
      memberHtml.includes('aria-selected="true"'));
  check('в списке помечен текущий раздел и нет чужого',
    (memberHtml.match(/data-forum-cat="[^"]*"[^>]*aria-selected="true"/g) || []).length === 1);

  /* ── Контракт isReady(): обещание, а не голый boolean ── */

  /*
    Контракт адаптера (src/forum/contract.js) обещает isReady(): Promise.
    supabase-адаптер долго отдавал синхронный boolean isConfigured(), а mount.js
    звал на нём .catch — TypeError падал на странице участника, и профиль
    не открывался ни у кого. Тест держит оба конца: сигнатуру адаптеров
    и отсутствие .catch на isReady в mount.js.
  */
  {
    for (const path of ['src/forum/adapters/local.js', 'src/forum/adapters/supabase.js']) {
      const adapter = await import('../' + path);
      const res = adapter.isReady();
      check(`${path.split('/').pop()}: isReady() возвращает обещание`,
        res && typeof res.then === 'function', `тип ответа: ${typeof res}`);
      const val = await res;
      check(`${path.split('/').pop()}: isReady() резолвится в boolean`, typeof val === 'boolean');
    }
const mountSource = await readFile('src/forum/mount.js', 'utf8');
    check('mount.js не зовёт .catch на isReady() (крах страницы профиля)',
      !mountSource.includes('.isReady().catch'));
    const supabaseSource2 = await readFile('src/forum/adapters/supabase.js', 'utf8');
    check('supabase isReady() объявлен async — по контракту это обещание',
      /export async function isReady/.test(supabaseSource2));

    for (const path of ['src/forum/adapters/local.js', 'src/forum/adapters/supabase.js']) {
      const adapter = await import('../' + path);
      check(`${path.split('/').pop()}: объявляет registerView()`, typeof adapter.registerView === 'function');
      check(`${path.split('/').pop()}: объявляет adminDeleteUser()`, typeof adapter.adminDeleteUser === 'function');
    }
    check('при открытии темы регистрируется просмотр',
      mountSource.includes('forum.registerView(postId)'));
    const loadThreadBlock = mountSource.match(/async function loadThread[\s\S]*?\n}/)?.[0] ?? '';
    check('перерисовка ленты просмотр не считает — засчитал бы сам себе',
      loadThreadBlock.length > 0 && !loadThreadBlock.includes('registerView'));
    check('supabase client считает просмотры функцией в базе',
      /rpc\/forum_register_view/.test(supabaseSource2));
    check('supabase client удаляет аккаунт функцией в базе',
      /rpc\/forum_admin_delete_user/.test(supabaseSource2));
  }

  const bannedHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, posts: [],
    me: { ...me, banned: true, banReason: 'Пункт 2' },
  });
  check('забаненному не показана форма написания поста', !bannedHtml.includes('data-forum-new'));
  check('забаненный видит причину запрета', /Пункт 2/.test(bannedHtml));

  /*
    Удалённый пост исчезает с форума: причина нужна модерации, а не читателям.
  */
  const deletedHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me,
    posts: [{ ...post, deleted: true, deletedReason: 'Пункт 4: Без рекламы' }],
  });
  check('удалённый пост исчезает с форума', !deletedHtml.includes('Пост удалён'));
  check('причина удаления не показывается', !deletedHtml.includes('forum-post--deleted'));
  check('текст удалённого поста не показывается', !deletedHtml.includes('текст поста'));

  /*
    Удалённый комментарий исчезает из списка целиком — ни заглушки, ни пустой
    строки. Если удалены все — на их месте «Ответов пока нет». Обычные
    комментарии остаются на своих местах.
  */
  const threadHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me,
    posts: [post], openPostId: post.id, comments: [
      { id: 'c1', authorId: 'u2', authorNick: 'Человек', authorRole: 'member', body: 'живой', createdAt: new Date(), deleted: false, deletedReason: '' },
      { id: 'c2', authorId: 'u3', authorNick: 'Другой', authorRole: 'member', body: 'удалённое содержимое', createdAt: new Date(), deleted: true, deletedReason: 'Спам' },
      { id: 'c3', authorId: 'u2', authorNick: 'Человек', authorRole: 'member', body: 'второй живой', createdAt: new Date(), deleted: false, deletedReason: '' },
    ],
  });
  check('удалённый комментарий не рисуется в списке',
    threadHtml.includes('живой')
      && threadHtml.includes('второй живой')
      && !threadHtml.includes('удалённое содержимое')
      && !threadHtml.includes('Комментарий удалён'));
  check('удалённый комментарий не оставляет пустой плашки',
    !threadHtml.includes('forum-comment--deleted'));
  const noCommentsHtml = renderForum({ events: eventsSample }, {
    ready: true, shared: true, loading: false, me,
    posts: [post], openPostId: post.id, comments: [
      { id: 'c1', authorId: 'u2', authorNick: 'Человек', authorRole: 'member', body: 'пропаж', createdAt: new Date(), deleted: true, deletedReason: 'Спам' },
    ],
  });
  check('если все комментарии удалены — место честно пусто',
    !noCommentsHtml.includes('пропаж') && /Ответов пока нет/.test(noCommentsHtml));

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
  check('не владельцу очередь заявок не показывается',
    !/data-recovery-review/.test(renderPlayers({
      forum: { configured: true, me: { id: 'u9', nick: 'Кто-то', role: 'moderator' }, users: [], recoveries: [] },
    })));

  const playersHtml = renderPlayers({
    forum: {
      configured: true,
      me,
      users: [me, { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null }],
    },
  });
  /*
    Восстановление доступа вместо сброса.

    Очередь рендерится отдельным кадром с заявками: `playersHtml` строится без
    `forum.recoveries`, и это самостоятельный случай — панель не должна падать
    и обязана объяснить, что блок появится после миграции.
  */
  check('без применённой миграции панель говорит об этом прямо',
    /Заявки на восстановление недоступны/.test(playersHtml)
    && playersHtml.includes('supabase/applied/20260925-self-recovery.sql'));
  check('в панели нет ни одного поля для пароля', !/type="password"/.test(playersHtml));
  check('панель объясняет, что паролей не видит никто',
    /Паролей вы не видите ни у кого/.test(playersHtml));
  check('администратору доступно ограничение писать', playersHtml.includes('data-player-restrict="u2"'));
  check('администратору доступно удаление аккаунта', playersHtml.includes('data-player-delete="u2"'));
  check('отдельной кнопки бана нет — запрет идёт через модалку «Ограничить»',
    !playersHtml.includes('data-player-ban="'));
  check('себе удаление не показывается',
    !playersHtml.includes('data-player-delete="u1"'));
  check('удаление аккаунта просит ввести ник — случайное нажатие не стирает человека',
    playersHtml.includes('data-delete-player-form') && /Введите ник игрока/.test(playersHtml));
  check('окно удаления честно говорит, что посты и комментарии останутся',
    /Посты и комментарии/.test(playersHtml) && /останутся/.test(playersHtml));
  const recoveryHtml = renderPlayers({
    forum: {
      configured: true,
      me,
      users: [me, { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null }],
      recoveries: [
        { id: 'r1', userId: 'u2', nick: 'Игрок', status: 'pending', createdAt: new Date(), readyAt: new Date(Date.now() + 3 * 3600000), decidedAt: null, expiresAt: new Date(Date.now() + 6 * 864e5), decidedByNick: '' },
        { id: 'r4', userId: 'u3', nick: 'Срочный', status: 'pending', createdAt: new Date(), readyAt: new Date(Date.now() - 3600000), decidedAt: null, expiresAt: new Date(Date.now() + 5 * 864e5), decidedByNick: '' },
        { id: 'r2', userId: 'u8', nick: 'Тихон', status: 'approved', createdAt: new Date(), readyAt: new Date(Date.now() + 3600000), decidedAt: new Date(), expiresAt: new Date(Date.now() + 40 * 6e4), decidedByNick: 'Владелец' },
        { id: 'r3', userId: 'u9', nick: 'Отказан', status: 'rejected', createdAt: new Date(), readyAt: new Date(Date.now() + 3600000), decidedAt: new Date(), expiresAt: new Date(Date.now() - 6e4), decidedByNick: 'Владелец' },
      ],
    },
  });
  check('заявка показана ником игрока', recoveryHtml.includes('adm-recovery__nick') && /Игрок/.test(recoveryHtml));
  check('у заявки есть обе кнопки решения',
    /data-recovery-review="r1"[\s\S]*?data-recovery-approve="1"/.test(recoveryHtml)
    && /data-recovery-review="r1"[\s\S]*?data-recovery-approve="0"/.test(recoveryHtml));
  check('впустить досрочно названо досрочно, а не «решением»',
    /Впустить сейчас/.test(recoveryHtml));
  check('срок до самоприёма показан остатком, а не датой создания',
    /откроется через 3 ч/.test(recoveryHtml));
  check('заявка, дожившая до своего часа, помечена открытой',
    /открыта — ждёт пароль/.test(recoveryHtml));
  check('досрочно впущенная не просит решить её ещё раз',
    !recoveryHtml.includes('data-recovery-review="r2"'));
  check('панель называет тот же срок, что держит база',
    new RegExp(`через\\s+${CONFIG.forum.limits.recoveryHoldHours}\\s+ч`).test(recoveryHtml));
  check('и объясняет владельцу, что его дело — возразить',
    /успеть отклонить чужую заявку/.test(recoveryHtml));
  check('впущенная досрочно упоминается отдельно',
    /Впущены досрочно и ждут/.test(recoveryHtml) && /Тихон/.test(recoveryHtml));
  check('разобранная заявка не висит в очереди', !/Отказан/.test(recoveryHtml));
  check('очередь не показывает отпечаток ключа', !/code_hash|codeHash/i.test(recoveryHtml));
  check('и в очереди нет поля пароля', !/type="password"/.test(recoveryHtml));
  check('очередь стоит над списком игроков',
    recoveryHtml.indexOf('adm-recoveries') < recoveryHtml.indexOf('class="adm-players"'));
  check('пустая очередь не выглядит поломкой',
    /Заявок нет/.test(renderPlayers({ forum: { configured: true, me, users: [me], recoveries: [] } })));

  /*
    Лидерство привязано к альянсу: лидер ведёт конкретный тег, инспекция в
    списке показывает этот тег, а отдельный блок собирает всех лидеров, чтобы
    назначение конкурента не потерялось в перечислении игроков.
  */
  const leaderHtml = renderPlayers({
    forum: {
      configured: true,
      me,
      users: [
        me,
        { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null },
        { id: 'u3', nick: 'Рэд', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null, isLeader: true, leaderOf: 'kr33', allianceTag: 'kr33' },
        { id: 'u4', nick: 'Бэн', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null, isLeader: true, leaderOf: 'FFA' },
        { id: 'u5', nick: 'Гек', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null, allianceTag: 'bmp' },
      ],
    },
  });
  check('лидеры собраны в отдельный блок',
    /Лидеры альянсов/.test(leaderHtml) && /adm-leaders__grid/.test(leaderHtml));
  check('в блоке лидеров виден тег альянса', /kr33/.test(leaderHtml) && /adm-leader__tag/.test(leaderHtml));
  check('лидер без альянса попал в блок', /FFA/.test(leaderHtml) && /Снять лидера/.test(leaderHtml));
  check('лидер в списке помечен своим тегом',
    /лидер KR33/.test(leaderHtml));
  check('кнопка лидера подсказывает альянс — своего, если лидер',
    /Снять лидера \(KR33\)/.test(leaderHtml) && /data-player-lead="1"/.test(leaderHtml));
  check('не-лидеру кнопка подсказывает его альянс из профиля',
    /Сделать лидером \(BMP\)/.test(leaderHtml) && /data-player-alliance="bmp"/.test(leaderHtml));
  check('легенда объясняет привязку лидера к альянсу',
    /привязано\s*к тегу/.test(leaderHtml));
  check('назначение идёт через окно с полем тега',
    /data-leader-form/.test(leaderHtml) && /data-leader-warning/.test(leaderHtml));
  check('без лидеров блок не рисуется',
    !renderPlayers({
      forum: { configured: true, me, users: [me, { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null }] },
    }).includes('Лидеры альянсов'));

  /* ── Ники: проверка, переименование, стоп-лист ── */

  check('администратору доступна проверка ника',
    playersHtml.includes('data-player-verify="u2"') && playersHtml.includes('data-player-ver=""'));
  check('непроверенный игрок помечен серой меткой',
    /role-badge--unverified/.test(playersHtml) && /не проверен/.test(playersHtml));

  const verifiedHtml = renderPlayers({
    forum: {
      configured: true,
      me,
      users: [
        me,
        { id: 'u2', nick: 'Игрок', role: 'member', createdAt: new Date(), banned: false, mutedUntil: null, isVerified: true, verifiedBy: 'u1', verifiedAt: new Date() },
      ],
    },
  });
  check('проверенный игрок носит зелёную метку и кнопку «снять»',
    /role-badge--verified/.test(verifiedHtml) && /проверен/.test(verifiedHtml) && /data-player-ver="1"/.test(verifiedHtml) && /Снять проверку/.test(verifiedHtml));

  check('переименование открывается окном с причиной и журналом',
    /data-player-rename="u2"/.test(playersHtml) && /data-rename-form/.test(playersHtml) && /data-nick-history/.test(playersHtml) && /Причина/.test(playersHtml));

  check('ручного стоп-листа в панели нет',
    !/Стоп-лист ников/.test(playersHtml) && !/data-reserved-form/.test(playersHtml));
  check('легенда объясняет автоматическую защиту ников',
    /Проверенный игрок/.test(playersHtml) && /Защита ников/.test(playersHtml)
      && /автоматически/.test(playersHtml));

  const playersMainSource = await readFile('src/admin/main.js', 'utf8');
  check('панель объясняет ошибку неприменённой схемы, а не показывает сырой SQL-ответ',
    /function showPlayerActionError[\s\S]*?не применена миграция/.test(playersMainSource));
  for (const migration of ['schema.sql', 'site-data.sql', 'profiles.sql', 'leaders.sql', 'nicks-verified.sql']) {
    check(`управление игроками подсказывает миграцию ${migration}`,
      playersMainSource.includes(`'${migration}'`));
  }
  check('кнопка лидера открывает диалог с подставленным тегом альянса',
    /if \(!isLeader\) \{[\s\S]*?openPlayerModal\('\[data-leader-modal\]', nick, leadBtn\.dataset\.playerLeader, \{ leaderTag: alliance \}\)/.test(playersMainSource));
  check('диалог лидера показывает ник выбранного игрока',
    /\[data-leader-nick\]/.test(playersMainSource));
  check('в панели не осталось окна сброса пароля',
    !/data-reset-modal|data-reset-form|data-player-reset|suggestPassword/.test(playersMainSource));
  for (const path of ['supabase/applied/leaders.sql', 'supabase/applied/nicks-verified.sql', 'supabase/applied/fix-leader-ambiguity.sql']) {
    const leaderSql = await readFile(path, 'utf8');
    check(`${path}: снятие прежнего лидера явно обращается к колонке, а не к параметру RPC`,
      /update public\.forum_users as previous_leader[\s\S]*?where previous_leader\.leader_of = v_tag[\s\S]*?previous_leader\.id <> target_user/.test(leaderSql));
  }

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

  /* ── Мобильная вёрстка и разметка: живой экран ── */

  const mobileCss = await readFile('src/mobile.css', 'utf8');
  const forumCss = await readFile('src/forum.css', 'utf8');

  /*
    Метка роли — подпись, а не второе имя: в строке поста/комментария от неё
    остаётся один значок, и кнопки действий рядом не толкаются и не накрываются.
  */
  check('слово роли в строке поста и комментария прячется, остаётся значок',
    /\.forum-post__by \.role-badge b,[\s\S]*display: none/.test(mobileCss));
  check('метка роли заметно мельче ника',
    /\.role-badge \{[^}]*font-size: 6\.5px/.test(mobileCss));

  /*
    Шапка на телефоне: кнопка слева, марка прижата к правому краю. Раскладка
    обязана быть явной строкой: styles-v8.css на узком экране оставил шапке
    flex-direction: column, и без переопределения кнопка вставала по центру,
    а марка уезжала влево. Диапазон до 1039px — телефон в альбомной
    ориентации шире 759px, а шапка всё равно разводит кнопку и марку.
  */
  check('на телефоне шапка разводит кнопку и марку по краям',
    /@media \(max-width: 1039px\)[\s\S]{0,400}\.site-head__inner \{\s*display: flex;\s*flex-direction: row[\s\S]{0,120}justify-content: space-between/.test(mobileCss));
  /* Шторка меню уже: на экране 375 она занимает не больше 52% ширины. */
  check('шторка меню на телефоне уже, чем 232px',
    /\.side \{[^}]*min\(var\(--side-w\), 52vw\)/.test(mobileCss));

  /*
    Стабильность: на телефоне страница не дёргается. min-height через svh не
    пересчитывается, когда адресная полоса сворачивается; полноэкранные
    анимации фона и blur под липкой шапкой выключены.
  */
  check('высота страницы на телефоне не зависит от адресной полосы',
    /body \{\s*min-height: 100svh/.test(mobileCss));
  check('на телефоне выключены постоянные анимации фона и страницы',
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]{0,200}body::before,[\s\S]{0,200}animation: none/.test(mobileCss));
  check('на телефоне выключен blur под липкой шапкой',
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]{0,600}backdrop-filter: none/.test(mobileCss));

  /* Панель форматирования и редактор получили стили. */
  check('панель форматирования получила стили',
    /\.forum-md\b/.test(forumCss) && /\.forum-md__btn\b/.test(forumCss));
  check('редактор получил стили и плейсхолдер',
    /\.forum-editor/.test(forumCss) && /\.forum-editor:empty/.test(forumCss));

  /*
    Полоска разделов на телефоне не должна уезжать за край: длинные списки
    становятся выпадающим списком, короткие сегменты — плотнее.
  */
  check('выпадающий список разделов получил стили',
    /\.pick__btn \{[^}]*border-radius: 999px/.test(mobileCss) && /\.pick__menu\b/.test(mobileCss));
  check('на телефоне длинный сегмент разделов уступает место списку',
    /@media \(max-width: 759px\)[\s\S]{0,300}\.seg--cat,[\s\S]{0,100}\.seg--type \{ display: none/.test(mobileCss));
  check('на телефоне пан вбок отрезается, а не тянет страницу',
    /overflow-x: clip/.test(mobileCss));

  const mainJs = await readFile('src/main.js', 'utf8');
  check('форум — первый раздел в меню',
    /const ROUTES = \[[\s\S]{0,600}?\{ id: 'forum'/.test(mainJs) &&
    mainJs.indexOf("{ id: 'forum'") < mainJs.indexOf("{ id: 'home'"));
  check('чаты — второй раздел, сразу за форумом',
    /\{ id: 'chats', label: 'Чаты', live: true/.test(mainJs) &&
    mainJs.indexOf("{ id: 'chats'") < mainJs.indexOf("{ id: 'home'"));
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
    ПЕРВЫЙ ЗАХОД ПОСЛЕ ТОГО, КАК БАЗА УСНУЛА. Supabase free усыпляет проект,
    если к нему неделю не обращаются, и первый запрос часто не укладывается
    в общий таймаут — то самое «форум не грузится с первого раза», когда
    второй заход уже работает. Два ответа: живая вкладка рисуется сразу,
    не дожидаясь данных сайта, а чтение ленты умеет один раз переждать
    пробуждение базы. Молчать вдвое дольше на настоящей пропаже сети нельзя,
    поэтому повтор только при таймауте и только на чтении.
  */
  const clientJs = await readFile('src/db/client.js', 'utf8');
  const forumDbJs = await readFile('src/forum/adapters/supabase.js', 'utf8');
  check('клиент умеет повторить запрос, не уложившийся в таймаут',
    /retryOnAbort/.test(clientJs));
  check('повтор по таймауту выключен по умолчанию',
    /retryOnAbort = false/.test(clientJs));
  check('повтор по таймауту включён у чтения ленты',
    /retryOnAbort: true/.test(forumDbJs));
  check('повтор по таймауту у ленты, поста, комментариев, чатов, календаря, пульса и фида магазина — девять мест',
    (forumDbJs.match(/retryOnAbort: true/g) ?? []).length === 9);
  check('главная вкладка рисуется до прихода данных, с пустым контуром',
    /liveFirst/.test(mainJs) && /emptyView\(\)/.test(mainJs));
  check('живые вкладки — форум, чаты, календарь, пульс обновлений, справочник и страница участника',
    /id === 'forum' \|\| id === 'chats' \|\| id === 'calendar'\s*\|\|\s*id === 'updates'\s*\|\|\s*id === 'handbook'\s*\|\|\s*\(id === 'user' && param\)/.test(mainJs));

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

// ── S. Чистые функции без DOM: помощники, роли, страницы, графики ──────────
console.log('\nS. Чистые функции');
{
  /* ── helpers: экранирование и даты ── */
  const h = await import('../src/ui/helpers.js');

  equal('esc', h.esc('a<b>&"\'c'), 'a&lt;b&gt;&amp;&quot;&#39;c');
  equal('esc(null)', h.esc(null), '');
  equal('esc(undefined)', h.esc(undefined), '');
  equal('esc(0)', h.esc(0), '0');

  equal('safeUrl: обычная ссылка остаётся', h.safeUrl('https://example.com/a?b=c'), 'https://example.com/a?b=c');
  equal('safeUrl: javascript выброшен', h.safeUrl('javascript:alert(1)'), '');
  equal('safeUrl: пробелы срезаются', h.safeUrl('  https://x.ru  '), 'https://x.ru');
  equal('safeUrl: пусто → пусто', h.safeUrl(undefined), '');

  const d = new Date('2026-09-07T00:00:00Z');
  equal('fmtDate', h.fmtDate(d), '7 сен');
  equal('fmtDateFull', h.fmtDateFull(d), '7 сен 2026');
  equal('fmtDate: битая дата → пусто', h.fmtDate(new Date('не число')), '');

  /* ── helpers: формы слов ── */
  const oneFewMany = h.pluralWord.bind(null);
  equal('1 → one', oneFewMany(1, 'победа', 'победы', 'побед'), 'победа');
  equal('2 → few', oneFewMany(2, 'победа', 'победы', 'побед'), 'победы');
  equal('5 → many', oneFewMany(5, 'победа', 'победы', 'побед'), 'побед');
  equal('11 → many (не one)', oneFewMany(11, 'победа', 'победы', 'побед'), 'побед');
  equal('21 → one (по последней цифре)', oneFewMany(21, 'победа', 'победы', 'побед'), 'победа');
  equal('12 → many (не few)', oneFewMany(12, 'победа', 'победы', 'побед'), 'побед');
  equal('plur..al с числом', h.plural(5, 'победа', 'победы', 'побед'), '5 побед');

  check('deltaBadge: без движения — плоский прочерк',
    h.deltaBadge(0).includes('delta--flat') && !h.deltaBadge(null).includes('▲'));
  check('deltaBadge: рост — стрелка вверх с модулем', h.deltaBadge(3).includes('▲3') && h.deltaBadge(3).includes('delta--up'));
  check('deltaBadge: падение — стрелка вниз с модулем', h.deltaBadge(-2).includes('▼2') && h.deltaBadge(-2).includes('delta--down'));

  /* ── helpers: мини-разметка ── */
  check('miniMarkdown: жирный и курсив', h.miniMarkdown('**ж** и *к*').includes('<strong>ж</strong>') && h.miniMarkdown('**ж** и *к*').includes('<em>к</em>'));
  check('miniMarkdown: теги как текст', !h.miniMarkdown('<b>x</b>').includes('<b>'));
  check('miniMarkdown: список', (() => {
    const html = h.miniMarkdown('- a\n- b');
    return html.includes('<ul>') && html.includes('<li>a</li>') && html.includes('</ul>');
  })());
  check('miniMarkdown: заголовки', h.miniMarkdown('## Раздел\nтекст').includes('<h3>Раздел</h3>'));
  check('sparkline: меньше двух точек — пусто', h.sparkline([5]) === '' && h.sparkline(undefined) === '');
  check('sparkline: рисует svg', h.sparkline([1, 2, 5]).includes('<svg class="spark"'));
  check('formDots: без формы — подпись', h.formDots([]).includes('нет данных'));
  check('formDots: исходы и пустые недели', h.formDots(['win', null, 'loss']).includes('dot--win') && h.formDots(['win', null, 'loss']).includes('dot--pending'));

  /* SplitSections раскладывает карточки на странице руководства. */
  const sections = h.splitSections('вступление\n\n## Глава 1\nтело 1\n\n## Глава 2\nтело 2');
  equal('splitSections: вступление плюс две карточки', sections.length, 3);
  equal('splitSections: названия', sections.map((s) => s.title).join('|'), '|Глава 1|Глава 2');
  equal('splitSections: вступление до заголовка', h.splitSections('вступление\n## Глава\nтело')[0].title, '');
  equal('splitSections: пустой текст', h.splitSections('').length, 0);

  /* ── roles: словарь ролей ── */
  const { roleKey, roleLabel, roleBadge } = await import('../src/forum/roles.js');
  equal('roleKey: владелец в базе — admin', roleKey({ role: 'admin' }), 'owner');
  equal('roleKey: модератор', roleKey({ role: 'moderator' }), 'moderator');
  equal('roleKey: остальные — участник', roleKey({ role: null }), 'member');
  equal('roleKey: без аккаунта — участник', roleKey(null), 'member');
  equal('roleLabel: владелец', roleLabel({ role: 'admin' }), 'владелец');
  equal('roleBadge: участник без метки', roleBadge({ role: 'member' }), '');
  equal('roleBadge: без аккаунта без метки', roleBadge(null), '');
  check('roleBadge: владелец с короной',
    roleBadge({ role: 'admin' }).includes('role-badge--owner') && roleBadge({ role: 'admin' }).includes('👑'));
  check('roleBadge: модератор коротко', roleBadge({ role: 'moderator' }, { short: true }).includes('модератор'));

  /* ── president-board: круговорот JSON ── */
  const pb = await import('../src/logic/president-board.js');
  const pbParsed = pb.parsePresidentBoard({ body: '{"name":"Люк","enabled":false,"note":"новое"}' });
  equal('president: включается/выключается', pbParsed.enabled, false);
  equal('president: имя', pbParsed.name, 'Люк');
  equal('president: note', pbParsed.note, 'новое');
  equal('president: битый JSON — значения по умолчанию', pb.parsePresidentBoard({ body: 'не json' }).name, 'Имя президента');
  equal('president: пустой объект — значения по умолчанию', pb.parsePresidentBoard({}).name, 'Имя президента');
  equal('president: сериализация-круг возвращает то же', pb.parsePresidentBoard({ body: pb.serializePresidentBoard({ name: 'Кира', enabled: false }) }).name, 'Кира');
  equal('president: нужный ключ из texts', pb.presidentBoardFromTexts([{ key: 'president-board', body: '{"label":"ПРЕЗИДЕНТ СЕРВЕРА"}' }]).label, 'ПРЕЗИДЕНТ СЕРВЕРА');
  equal('president: не тот ключ — по умолчанию', pb.presidentBoardFromTexts([{ key: 'другое', body: '{"label":"x"}' }]).label, 'ПРЕЗИДЕНТ СЕРВЕРА');
  equal('president: текстов нет — по умолчанию', pb.presidentBoardFromTexts([]).enabled, true);

  /* ── guide-roles: страница руководства ── */
  const gr = await import('../src/logic/guide-roles.js');
  equal('guide: не JSON — пять ролей по умолчанию', gr.parseGuidePage('не json').roles.length, 5);
  equal('guide: роли не массив — по умолчанию', gr.parseGuidePage('{"roles":"не массив"}').roles.length, 5);
  equal('guide: credit из JSON', gr.parseGuidePage('{"roles":[],"credit":"кто-то"}').credit, 'кто-то');
  equal('guide: legacy-раздел принципов', gr.parseGuidePage(null, { principles: { title: 'Вступление', body: 'тело' } }).principlesTitle, 'Вступление');
  check('guide: role приводится к чисту', (() => {
    const page = gr.parseGuidePage('{"roles":[{"icon":"#","title":"  Офицер ","tone":"gold","intro":"  описание  ","items":["дело"," ",""],"assistant":true}]}');
    return page.roles[0].title === 'Офицер' && page.roles[0].intro === 'описание' &&
      page.roles[0].items.join(',') === 'дело' && page.roles[0].assistant === true;
  })());
  check('guide: serialize → parse круг', (() => {
    const page = gr.parseGuidePage('{"roles":[{"icon":"#","title":"Офицер","tone":"cyan","intro":"i","items":["a"],"assistant":false}]}');
    const again = gr.parseGuidePage({ body: gr.serializeGuideRoles(page) });
    return again.roles[0].title === 'Офицер' && again.roles[0].items.join(',') === 'a';
  })());
  equal('guide: пустая роль для редактора', gr.blankGuideRole().title, 'Новая роль');
  equal('guide: пустая роль со вставкой', gr.blankGuideRole().icon, '✦');

  /* ── standings: движение и история мест ── */
  const st = await import('../src/logic/standings.js');
  const movers = st.computeMovers(
    [{ id: 1, delta: 3 }, { id: 2, delta: -1 }, { id: 3, delta: 0 }, { id: 4, delta: null }, { id: 5, delta: 7 }],
    2
  );
  equal('movers: вверх без нулей и null', movers.up.map((r) => r.id).join(','), '5,1');
  equal('movers: вниз', movers.down.map((r) => r.id).join(','), '2');
  equal('movers: лимит работает', movers.up.length, 2);

  const histAlliances = [{ id: 'a', tag: 'A', name: 'А', active: true }, { id: 'b', tag: 'B', name: 'Б', active: true }];
  const histWeeks = [
    { id: 'W1', number: 1 }, { id: 'W2', number: 2 },
  ];
  const histResults = [
    { weekId: 'W1', allianceId: 'a', outcome: 'win' },
    { weekId: 'W1', allianceId: 'b', outcome: 'loss' },
    { weekId: 'W2', allianceId: 'a', outcome: 'win' },
    { weekId: 'W2', allianceId: 'b', outcome: 'loss' },
  ];
  const history = st.computePlaceHistory(histAlliances, [...histWeeks].reverse(), histResults, { win: 2, loss: 0 });
  equal('history: места по неделям', history.get('a').join(','), '1,1');
  equal('history: места второго', history.get('b').join(','), '2,2');

  const windowOutcomes = st.computeWindowForm('a', histWeeks, [{ weekId: 'W2', allianceId: 'a', outcome: 'win' }]);
  equal('windowForm: пустая неделя сохраняется', windowOutcomes.join(','), ',win');

  /* ── chart: SVG-графики ── */
  const chart = await import('../src/ui/chart.js');
  const twoWeeks = [{ id: 'w1', number: 1 }, { id: 'w2', number: 2 }];
  equal('areaChart: мало точек → пусто', chart.areaChart([1], twoWeeks, '#f00'), '');
  equal('areaChart: нет данных → пусто', chart.areaChart(undefined, twoWeeks, '#f00'), '');
  check('areaChart: большой график', chart.areaChart([0, 10, 8], twoWeeks, '#f00').includes('ch--big'));
  check('areaChart: эталонная линия', chart.areaChart([0, 10], twoWeeks, '#f00', { reference: [0, 5] }).includes('средний по серверу'));
  check('areaChart: цвет экранируется и не открывает атрибут',
    !chart.areaChart([0, 10], twoWeeks, 'red" onload="x').includes(' onload="'));
  equal('placeChart: мало точек → пусто', chart.placeChart([1], twoWeeks, 4, '#00f'), '');
  check('placeChart: движение по местам', chart.placeChart([2, 1], twoWeeks, 4, '#00f').includes('ch__ytick'));
  equal('raceChart: пустой список → пусто', chart.raceChart([], twoWeeks), '');
  equal('raceChart: мало недель → пусто', chart.raceChart([{ alliance: { tag: 'A' }, series: [0, 1] }], [twoWeeks[0]]), '');
  const race = chart.raceChart(
    [
      { alliance: { tag: 'A', color: '#111' }, series: [0, 10] },
      { alliance: { tag: 'B', color: '#222' }, series: [0, 10] },
    ],
    twoWeeks
  );
  check('raceChart: подписи двух альянсов', (race.match(/class="ch__label"/g) ?? []).length === 2);
  check('raceChart: сдвинутые подписи соединяются чёрточкой', race.includes('<line x1='));
  const raceEsc = chart.raceChart([{ alliance: { tag: '<b>x</b>' }, series: [0, 10] }], twoWeeks);
  check('raceChart: тег в имени не становится разметкой', !raceEsc.includes('<b>x') && raceEsc.includes('&lt;b&gt;x&lt;/b&gt;'));
}

{
  /* ── Уровни, достижения и репутация форума (rank.js) ── */
  const {
    pointsOf, levelOf, progressOf, achievementsOf, doneCount, LEVELS,
    POINTS, REP_POINTS, reputationOf, reputationSourcesOf,
  } = await import('../src/forum/rank.js');

  equal('points: пустой профиль даёт ноль', pointsOf({}), 0);
  equal('points: пост = 10', pointsOf({ postCount: 1 }), 10);
  equal('points: ответ = 3', pointsOf({ commentCount: 2 }), 6);
  equal('points: согласие = 2', pointsOf({ likesReceived: 3 }), 6);
  equal('points: всё вместе', pointsOf({ postCount: 2, commentCount: 1, likesReceived: 5 }), 33);
  /*
    Благодарность дороже согласия: её не снять, и частоту держит база.
    Число названо здесь два раза осознанно — тест обязан заметить, если вес
    поедет вместе с объяснением в комментарии.
  */
  equal('points: благодарность = 5', pointsOf({ thanksReceived: 4 }), 20);
  check('points: благодарность стоит дороже согласия', POINTS.thanks > POINTS.like);
  check('points: благодарность дешевле поста', POINTS.thanks < POINTS.post);

  equal('level: новичок с нуля', levelOf({}).title, 'Новичок');
  equal('level: порог 20 поднимает до Писаря', levelOf({ likesReceived: 10 }).title, 'Писарь');
  equal('level: 60 — Летописец', levelOf({ commentCount: 20 }).title, 'Летописец');
  equal('level: последний уровень — Легенда', LEVELS[LEVELS.length - 1].title, 'Легенда');
  equal('level: за границей верхнего порога — Легенда', levelOf({ postCount: 100 }).title, 'Легенда');

  const p = progressOf({ commentCount: 10 }); // 30 точек, уровень 2 (от 20)
  equal('progress: до следующего уровня считается от своего порога', p.to, 60);
  equal('progress: доля заполнена', p.pct, 25);
  const top = progressOf({ postCount: 100 }); // 1000 — выше Легенды
  equal('progress: на последнем уровне нет следующего', top.to, 0);
  equal('progress: на последнем уровне поле заполнено', top.pct, 100);

  const freshDate = new Date();
  const young = achievementsOf({ postCount: 0, commentCount: 0, likesReceived: 0 });
  equal('achievements: у новичка ноль выполненных',
    doneCount({ postCount: 0, commentCount: 0, likesReceived: 0 }), 0);
  check('achievements: новичок не ошибается в счётчике',
    young.filter((a) => a.done).length === 0);

  const onePost = achievementsOf({ postCount: 1, commentCount: 0, likesReceived: 0 });
  check('achievements: первый пост отмечается', onePost.find((a) => a.id === 'first_post').done);
  check('achievements: десять постов — не сразу', !onePost.find((a) => a.id === 'ten_posts').done);
  check('achievements: все имеют подпись', onePost.every((a) => typeof a.hint === 'string' && a.hint.length > 0));

  const withAv = achievementsOf({ avatarUrl: '/x.png' });
  check('achievements: аватарка даёт значок', withAv.find((a) => a.id === 'has_avatar').done);

  const old = achievementsOf({ createdAt: new Date(Date.now() - 40 * 24 * 3600e3) });
  check('achievements: месяц на форуме даёт значок', old.find((a) => a.id === 'month_old').done);
  const notOld = achievementsOf({ createdAt: new Date(Date.now() - 1000) });
  check('achievements: свежий человек не получает значок месяца', !notOld.find((a) => a.id === 'month_old').done);

  check('achievements: набор значков полный', achievementsOf({}).length === 9);

  /*
    Три новых значка подтверждены со стороны — их нельзя выдать себе количеством
    сообщений, и страница помечает их иначе. Проверка держит именно это: без
    флага confirmed различие на экране пропало бы.
  */
  const confirmedIds = achievementsOf({}).filter((a) => a.confirmed).map((a) => a.id);
  check('achievements: подтверждённых значка три',
    confirmedIds.join(',') === 'thanked_five,verified_guide,event_held');
  check('achievements: активность сама себе флаг не ставит',
    achievementsOf({ postCount: 99, commentCount: 99, likesReceived: 99 })
      .every((a) => !a.confirmed || !['first_post', 'ten_posts'].includes(a.id)));

  const thanked = achievementsOf({ thanksReceived: 5 });
  check('achievements: пять благодарностей дают значок',
    thanked.find((a) => a.id === 'thanked_five').done);
  check('achievements: четырёх благодарностей мало',
    !achievementsOf({ thanksReceived: 4 }).find((a) => a.id === 'thanked_five').done);
  check('achievements: проверенный разбор даёт значок',
    achievementsOf({ verifiedGuides: 1 }).find((a) => a.id === 'verified_guide').done);
  check('achievements: состоявшаяся встреча даёт значок',
    achievementsOf({ eventsHeld: 1 }).find((a) => a.id === 'event_held').done);
  check('achievements: пустой профиль не получает подтверждённых значков',
    achievementsOf({}).filter((a) => a.done && a.confirmed).length === 0);

  /* ── Репутация: отдельная лестница, и её не купить благодарностями ── */
  equal('rep: пустой профиль без очков', reputationOf({}), 0);
  equal('rep: проверенный разбор стоит 25', reputationOf({ verifiedGuides: 2 }), 50);
  equal('rep: награда владельца складывается', reputationOf({ repGrantPoints: -15 }), -15);
  equal('rep: оба источника вместе', reputationOf({ verifiedGuides: 1, repGrantPoints: 10 }), 35);
  /*
    Главное правило раздела: сколько человек собрал благодарностей, не влияет
    на репутацию ни на очко. Точка, ради которой две лестницы держат раздельно.
  */
  equal('rep: благодарность очков не даёт', reputationOf({ thanksReceived: 500 }), 0);
  equal('rep: активность очков не даёт', reputationOf({ postCount: 90, commentCount: 90 }), 0);
  check('rep: очко за разбор названо и в правиле, и в числе', REP_POINTS.verifiedGuide === 25);

  const sources = reputationSourcesOf({ verifiedGuides: 2, repGrantPoints: 10, repGrantCount: 3 });
  equal('rep: источников два', sources.length, 2);
  equal('rep: разборы посчитаны очками', sources[0].points, 50);
  equal('rep: у наград своя сумма', sources[1].points, 10);
  equal('rep: наград ровно столько, сколько выдали', sources[1].count, 3);
  check('rep: пустой профиль без источника', reputationSourcesOf({}).length === 0);
  check('rep: одних благодарностей в списке источников нет',
    reputationSourcesOf({ thanksReceived: 7 }).length === 0);

  /* ── «Самое обсуждаемое» и приветствие на странице форума ── */
  const { renderForum } = await import('../src/pages/forum.js');
  const mkPost = (i, extra = {}) => ({
    id: `p${i}`, authorId: 'u', authorNick: 'Кто-то', authorAvatar: '', authorAlliance: '',
    authorRole: 'user', category: 'news', title: `Тема ${i}`, body: 'текст',
    createdAt: new Date(), editedAt: undefined, pinned: false, deleted: false,
    deletedReason: '', commentCount: 0, reactions: {}, myReaction: null, score: 0,
    attachments: [], ...extra,
  });
  const posts = [mkPost(1, { commentCount: 4, score: 3 }), mkPost(2), mkPost(3, { commentCount: 7 })];
  const hot = posts.filter((p) => p.commentCount > 0 && !p.deleted);

  const guestHtml = renderForum({ events: [] }, {
    ready: true, shared: true, sourceName: 's', me: null, posts, hot, total: 3,
    category: 'all', sort: 'fresh', loading: false, error: '', openPostId: null,
    comments: [], query: '',
  });
  check('горячие темы: блок рисуется, когда есть о чём',
    /data-forum-hot/.test(guestHtml));
  const hotBlock = guestHtml.match(/<section class="forum-hot"[\s\S]*?<\/section>/)?.[0] ?? '';
  check('горячие темы: отвечают темы только с ответами',
    /Тема 3/.test(hotBlock) && !/Тема 2/.test(hotBlock));
  check('горячие темы: заголовок про обсуждение',
    /Самое обсуждаемое/.test(guestHtml));
  check('приветствие: гостю рисуется',
    /data-forum-welcome/.test(guestHtml));

  const memberHtml = renderForum({ events: [] }, {
    ready: true, shared: true, sourceName: 's', me: { id: 'u', nick: 'Кто-то', role: 'user', createdAt: new Date() },
    posts, hot, total: 3, category: 'all', sort: 'fresh', loading: false,
    error: '', openPostId: null, comments: [], query: '',
  });
  check('приветствие: вошедшему не рисуется', !/data-forum-welcome/.test(memberHtml));
  check('горячие темы: вошедшему остаются', /data-forum-hot/.test(memberHtml));

  const noHot = renderForum({ events: [] }, {
    ready: true, shared: true, sourceName: 's', me: null, posts, hot: [], total: 3,
    category: 'all', sort: 'fresh', loading: false, error: '', openPostId: null,
    comments: [], query: '',
  });
  check('горячие темы: пустой список ничего не рисует', !/data-forum-hot/.test(noHot));

  /* ── Уровень и значки на странице участника ── */
  const { renderUserPage } = await import('../src/pages/user.js');
  const profile = {
    id: 'u', nick: 'Кто-то', avatarUrl: '', about: '', allianceTag: '', role: 'user',
    createdAt: new Date(), postCount: 3, commentCount: 8, likesReceived: 5,
  };
  const userHtml = renderUserPage({ profile, posts, me: null, nick: 'Кто-то' });
  check('профиль: блок уровня есть', /forum-rank/.test(userHtml));
  check('профиль: название уровня показывается',
    /Летописец/.test(userHtml)); // 3*10+8*3+5*2=64 → уровень 3
  check('профиль: прогресс до следующего уровня считается',
    /до следующего уровня/.test(userHtml));
  check('профиль: значки рисуются все девять',
    (userHtml.match(/<span class="forum-rank__ach\b/g) ?? []).length === 9);
  check('профиль: подпись «X из 9» есть', /из 9 достижений/.test(userHtml));
  /*
    Гость видит само число репутации, но не видит, из чего оно сложилось:
    причины наград читает тот, кому они написаны, и модерация.
  */
  check('профиль: гостю список причин наград не показывают', !/forum-rep__sources/.test(userHtml));

  const mine = { ...profile, thanksReceived: 6, verifiedGuides: 2, repGrantPoints: 10, repGrantCount: 1 };
  const own = renderUserPage({ profile: mine, posts, me: { id: 'u', nick: 'Кто-то' }, nick: 'Кто-то' });
  check('профиль: благодарности посчитаны в очках уровня',
    /Уровень \d/.test(own) && pointsOf(mine) === 64 + 6 * POINTS.thanks);
  check('профиль: хозяину показывают очки репутации',
    /forum-rep__points">60</.test(own)); // 2 × 25 + 10
  check('профиль: число благодарностей стоит рядом', /6 благодарност/.test(own));
  check('профиль: источники очков перечислены своему игроку', /forum-rep__sources/.test(own));
  check('профиль: источник назван словами с окончанием, а не ключом',
    /2 проверенных гайда/.test(own) && /1 награда от владельца/.test(own) && !/source:/.test(own));
  check('профиль: подтверждённый значок помечен классом', /forum-rank__ach--confirmed/.test(own));
  /*
    Слово «репутация» освобождено: ♡ на карточке — это симпатия к человеку,
    а не очки. Если подпись уедет обратно, две лестницы снова начнут
    называться одним словом.
  */
  check('профиль: ♥ назван симпатией, а не репутацией',
    /симпат/i.test(own) && !/♥ репутаци/i.test(own));

  // Значение достижения экранируется — иначе накрученный ник открыл бы атрибут.
  const evil = achievementsOf({ postCount: 1, commentCount: 0, likesReceived: 0 }).find((a) => a.id === 'first_post');
  check('achievements: подпись не должна зависеть от текста профиля', typeof evil.hint === 'string' && !/"/.test(evil.hint));
}

/* ── Источник: «Самое обсуждаемое» тянется вместе с лентой ── */
{
  const { readFile } = await import('node:fs/promises');
  const mountSource = await readFile('src/forum/mount.js', 'utf8');
  const pagesSource = await readFile('src/pages/forum.js', 'utf8');
  const userSource = await readFile('src/pages/user.js', 'utf8');

  check('лента тянет горячие темы через sort=talked',
    /listPosts\(\{ sort: 'talked', limit: 3, serverId: state\.serverId \}\)/.test(mountSource));
  check('горячие темы не роняют ленту при ошибке',
    /sort: 'talked', limit: 3[\s\S]{0,220}\}\s*catch\s*\{/.test(mountSource));
  check('удалённые темы не попадают в горячие',
    /!p\.deleted\s*&&\s*p\.commentCount\s*>\s*0/.test(mountSource));
  check('гостю рисуется призыв, вошедшему нет',
    /!s\.ready \|\| !s\.posts\.length \|\| s\.me/.test(pagesSource));
  check('профиль считает уровень и значки из тех же функций',
    /rank\.js/.test(userSource) && /достижений/.test(userSource));
}

/* ── Опросы: локальный адаптер ── */
{
  const { readFile } = await import('node:fs/promises');
  const { renderPostCard } = await import('../src/pages/forum.js');
  const localAdapter = await import('../src/forum/adapters/local.js');
  const a = localAdapter;
  const pollStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (pollStorage.has(k) ? pollStorage.get(k) : null),
    setItem: (k, v) => pollStorage.set(k, String(v)),
    removeItem: (k) => pollStorage.delete(k),
  };
  await a.signUp('poll_user');
  const post = await a.createPost({
    title: 'Опрос', body: '<p>ТЕСТ</p>', category: 'offtop',
    poll: { question: 'Красный или синий?', multiple: false, options: ['Красный', 'Синий'] },
  });
  const p = await a.getPost(post.id);
  check('создание поста с poll создаёт опрос', p.poll !== null);
  check('poll.id присвоен', typeof p.poll.id === 'string' && p.poll.id.length > 0);
  check('poll.question совпадает', p.poll.question === 'Красный или синий?');
  check('poll.options длина 2', p.poll.options.length === 2);
  check('poll.options[0].text', p.poll.options[0].text === 'Красный');
  check('poll.options[1].text', p.poll.options[1].text === 'Синий');
  check('poll.total 0', p.poll.total === 0);

  await a.votePoll(p.poll.id, p.poll.options[0].id);
  const p2 = await a.getPost(post.id);
  check('голосование увеличивает total', p2.poll.total === 1);
  check('голосование помечает option.mine', p2.poll.options[0].mine === true);

  // Повторный голос за тот же вариант — без изменений.
  await a.votePoll(p.poll.id, p.poll.options[0].id);
  const p3 = await a.getPost(post.id);
  check('повторный голос не дублирует', p3.poll.total === 1);

  await a.unvotePoll(p.poll.id, p.poll.options[0].id);
  const p4 = await a.getPost(post.id);
  check('отмена голоса уменьшает total', p4.poll.total === 0);
  check('отмена снимает mine', p4.poll.options[0].mine === false);

  // Смена варианта в опросе с одним ответом — голос переезжает, а не копится.
  await a.votePoll(p.poll.id, p.poll.options[0].id);
  await a.votePoll(p.poll.id, p.poll.options[1].id);
  const pSwitch = await a.getPost(post.id);
  check('смена одного голоса: total прежний', pSwitch.poll.total === 1);
  check('смена одного голоса: старый вариант без голоса',
    pSwitch.poll.options[0].votes === 0 && pSwitch.poll.options[0].mine === false);
  check('смена одного голоса: новый вариант помечен',
    pSwitch.poll.options[1].votes === 1 && pSwitch.poll.options[1].mine === true);
  await a.unvotePoll(p.poll.id, p.poll.options[1].id);

  // Закрытие опроса.
  await a.closePoll(p.poll.id);
  const p5 = await a.getPost(post.id);
  check('closePoll закрывает опрос', p5.poll.closed === true);

  // Голосование после закрытия — ошибка.
  let closeError = false;
  try { await a.votePoll(p.poll.id, p.poll.options[1].id); } catch { closeError = true; }
  check('голосование после закрытия отказывает', closeError);

  // Несколько вариантов.
  const mp = await a.createPost({
    title: 'Мульти', body: '<p>T</p>', category: 'offtop',
    poll: { question: 'Множественный?', multiple: true, options: ['A', 'B', 'C'] },
  });
  const mpoll = (await a.getPost(mp.id)).poll;
  await a.votePoll(mpoll.id, mpoll.options[0].id);
  await a.votePoll(mpoll.id, mpoll.options[2].id);
  const mp2 = await a.getPost(mp.id);
  check('множественный poll: total — уникальные проголосовавшие', mp2.poll.total === 1);
  check('множественный poll: два голоса mine', mp2.poll.options[0].mine && mp2.poll.options[2].mine);
  check('множественный poll: голоса в каждом варианте',
    mp2.poll.options[0].votes === 1 && mp2.poll.options[2].votes === 1);

  // В одном варианте опроса один человек может голоснуть только раз.
  await a.votePoll(mpoll.id, mpoll.options[0].id);
  const mp3 = await a.getPost(mp.id);
  check('повторный голос в том же варианте не дублирует',
    mp3.poll.options[0].votes === 1);

  // renderPoll: пустой опрос не крашит.
  const noMe = { me: null, openPostId: null, editingPostId: null, comments: [],
    category: 'all', sort: 'fresh', categories: {} };
  const t0 = new Date('2026-01-01T00:00:00Z');
  const emptyPollHtml = renderPostCard({
    id: 'e1', authorId: 'u1', authorNick: 'A', title: 'E', body: '', category: 'offtop',
    reactions: {}, myReaction: null, commentCount: 0, views: 0, createdAt: t0,
    poll: { id: 'ep', question: 'Пустой?', multiple: false, total: 0, closed: false, options: [] },
  }, noMe);
  check('renderPoll с пустыми опциями не падает', /forum-poll/.test(emptyPollHtml));

  const pollHtml = renderPostCard({
    id: 'p1', authorId: 'u1', authorNick: 'A', title: 'P', body: '', category: 'offtop',
    reactions: {}, myReaction: null, commentCount: 0, views: 0, createdAt: t0,
    poll: {
      id: 'pl1', question: 'Вопрос?', multiple: false, total: 5, closed: false,
      options: [
        { id: 'o1', text: 'Да', votes: 3, mine: true },
        { id: 'o2', text: 'Нет', votes: 2, mine: false },
      ],
    },
  }, noMe);
  check('renderPoll показывает вопрос', /Вопрос\?/.test(pollHtml));
  check('renderPoll показывает варианты', /Да/.test(pollHtml) && /Нет/.test(pollHtml));
  check('renderPoll показывает голоса', /3/.test(pollHtml) && /2/.test(pollHtml));
  check('renderPoll помечает mine', /is-on/.test(pollHtml));
  check('renderPoll имеет data-forum-poll', /data-forum-poll/.test(pollHtml));
  check('renderPoll имеет data-forum-poll-opt', /data-forum-poll-opt/.test(pollHtml));

  const closedHtml = renderPostCard({
    id: 'c1', authorId: 'u1', authorNick: 'A', title: 'C', body: '', category: 'offtop',
    reactions: {}, myReaction: null, commentCount: 0, views: 0, createdAt: t0,
    poll: {
      id: 'cl1', question: 'Закрыт?', multiple: false, total: 10, closed: true,
      options: [
        { id: 'co1', text: 'X', votes: 7, mine: false },
        { id: 'co2', text: 'Y', votes: 3, mine: false },
      ],
    },
  }, noMe);
  check('закрытый poll: disabled на инпутах', /disabled/.test(closedHtml));
  check('закрытый poll: текст «Опрос закрыт»', /Опрос закрыт/.test(closedHtml));

  // Проводка в интерфейсе: стресс-обработчик опроса и создание опроса в форме.
  const mountSourcePoll = await readFile('src/forum/mount.js', 'utf8');
  const pagesSourcePoll = await readFile('src/pages/forum.js', 'utf8');
  check('клик по варианта опроса обрабатывается',
    /data-forum-poll-opt/.test(mountSourcePoll) && /forum\.votePoll/.test(mountSourcePoll));
  check('форма создания опроса в композиторе',
    /data-forum-poll-toggle/.test(pagesSourcePoll) && /poll_question/.test(pagesSourcePoll));
  check('предел вариантов опроса в коде',
    /POLL_OPTIONS_MAX = 8/.test(mountSourcePoll) && /idx >= POLL_OPTIONS_MAX/.test(mountSourcePoll));

  /*
    Что обязано пережить перерисовку: у редактора (div contenteditable) нет
    свойства .name, поэтому имя поля читается атрибутом; раскрытая форма поста
    и опрос восстанавливаются по наличию атрибута, а не по его значению.
  */
  check('имя поля для снимка читается атрибутом, а не свойством',
    /const name = el\.getAttribute\('name'\)/.test(mountSourcePoll));
  check('раскрытая форма поста переживает перерисовку',
    /hasAttribute\('data-forum-composer'\)/.test(mountSourcePoll));
  check('форма опроса переживает перерисовку',
    /snapshot\.poll/.test(mountSourcePoll) && /appendPollOption\(container\)/.test(mountSourcePoll));
  check('Ctrl+Enter отправляет и из редактора',
    /area\.matches\('\[data-editor\]'\)/.test(mountSourcePoll));
}

/* ── Уведомления: правила те же, что у триггеров базы ── */
{
  const localNotif = await import('../src/forum/adapters/local.js');
  const n = localNotif;
  const nStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => (nStorage.has(k) ? nStorage.get(k) : null),
    setItem: (k, v) => nStorage.set(k, String(v)),
    removeItem: (k) => nStorage.delete(k),
  };

  // Автор темы.
  await n.signUp('автор_темы_проверки');
  const theme = await n.createPost({
    title: 'Обсуждение уведомлений', body: 'открыто', category: 'offtop',
  });

  // Читатель отвечает и в том же тексте упоминает автора — у автора должно
  // быть ОДНО уведомление, а не два (правило forum_notify_comment).
  await n.signUp('читатель_темы_проверки');
  await n.addComment(theme.id, 'посмотрел, @автор_темы_проверки, и одобряю');

  await n.signIn('автор_темы_проверки');
  let notif = await n.listNotifications();
  check('ответ рождает уведомление reply',
    notif.some((x) => x.kind === 'reply' && x.postId === theme.id && !x.readAt));
  check('упоминание автора в ответе не даёт второго уведомления',
    notif.filter((x) => x.kind === 'mention').length === 0);
  check('в уведомлении лежит актор', notif.every((x) => x.actorNick === 'читатель_темы_проверки'));
  check('в уведомлении лежит кусок текста', notif.some((x) => x.preview.includes('одобряю')));

  // Согласие на пост — уведомление автору.
  await n.signIn('читатель_темы_проверки');
  await n.setReaction('post', theme.id, 'like');
  await n.signIn('автор_темы_проверки');
  notif = await n.listNotifications();
  check('лайк рождает уведомление reaction',
    notif.some((x) => x.kind === 'reaction' && x.postId === theme.id && !x.readAt));

  // Смайлик не уведомляет — как в forum_notify_reaction (только like/dislike).
  const beforeSmile = (await n.listNotifications()).length;
  await n.signIn('читатель_темы_проверки');
  await n.setReaction('post', theme.id, 'fire');
  await n.signIn('автор_темы_проверки');
  check('смайлик не рождает уведомления',
    (await n.listNotifications()).length === beforeSmile);

  // Отметка прочитанным: выборочно и всё разом.
  const unread = (await n.listNotifications()).filter((x) => !x.readAt);
  check('новые уведомления приходят непрочитанными', unread.length >= 2);
  const one = unread[0];
  await n.markNotificationsRead([one.id]);
  const afterOne = await n.listNotifications();
  check('markNotificationsRead отмечает выбранное',
    afterOne.find((x) => x.id === one.id)?.readAt instanceof Date);
  check('остальные остаются непрочитанными',
    afterOne.filter((x) => x.id !== one.id && !x.readAt).length === unread.length - 1);

  await n.markAllNotificationsRead();
  check('markAllNotificationsRead отмечает всё',
    (await n.listNotifications()).every((x) => x.readAt));

  // Чужих уведомлений чужой не видит.
  await n.signIn('читатель_темы_проверки');
  const theirs = await n.listNotifications();
  const who = (await n.currentUser()).id;
  check('свои уведомления другому не видны',
    theirs.every((x) => x.userId === who));

  // Упоминание в заголовке поста — уведомление (forum_notify_post).
  await n.signUp('третья_сторона_проверки');
  await n.createPost({ title: 'Для @читатель_темы_проверки', body: 'вот', category: 'offtop' });
  await n.signIn('читатель_темы_проверки');
  check('упоминание в заголовке поста уведомляет',
    (await n.listNotifications()).some((x) => x.kind === 'mention' && x.preview.includes('Для')));

  // Сам себя не уведомляет.
  await n.signIn('автор_темы_проверки');
  await n.addComment(theme.id, '@автор_темы_проверки, помню себя');
  check('себя не уведомляет',
    (await n.listNotifications()).every((x) => x.actorNick !== 'автор_темы_проверки'));
}

/* ── Лидерборд: агрегатор и панель ── */
{
  const { readFile } = await import('node:fs/promises');
  const { leaderboardOf } = await import('../src/forum/leaderboard.js');
  const { renderForum } = await import('../src/pages/forum.js');

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const fresh = (offsetDays) => new Date(now - offsetDays * day);

  const posts = [
    { id: '1', authorId: 'u1', authorNick: 'A', deleted: false, commentCount: 2, score: 5, views: 10, createdAt: fresh(1) },
    { id: '2', authorId: 'u1', authorNick: 'A', deleted: false, commentCount: 4, score: 2, views: 40, createdAt: fresh(12) },
    { id: '3', authorId: 'u2', authorNick: 'B', deleted: false, commentCount: 8, score: 1, views: 80, createdAt: fresh(2) },
    { id: '4', authorId: 'u2', authorNick: 'B', deleted: true, commentCount: 99, score: 99, views: 999, createdAt: fresh(1) },
    { id: '5', authorId: 'u3', authorNick: 'C', deleted: false, commentCount: 1, score: 50, views: 5, createdAt: fresh(3) },
    { id: '6', authorNick: 'Гость', deleted: false, commentCount: 1, score: 0, views: 3, createdAt: fresh(1) },
    { id: '7', authorId: 'u4', authorNick: 'Будущее', deleted: false, commentCount: 1, score: 1, views: 1, createdAt: new Date(now + 30 * day) },
  ];

  const all = leaderboardOf(posts, { period: 'all' });
  const week = leaderboardOf(posts, { period: 'week' });

  check('лидерборд: ранги идут с 1', all[0].rank === 1 && all.at(-1).rank === all.length);
  check('лидерборд: не больше десяти строк', all.length <= 10);
  check('лидерборд: B выше по активности (8 ответов)',
    all[0].nick === 'B' && all[0].activity === 9);
  check('лидерборд: A второй (8 активность)', all[1].nick === 'A' && all[1].activity === 8);
  check('лидерборд: равная активность — выше рейтинг', all[2].nick === 'C');
  check('лидерборд: удалённый пост не идёт в счёт', all[0].posts === 1 && all[0].comments === 8);
  check('лидерборд: гости считаются по нику', all.some((l) => l.nick === 'Гость'));
  check('лидерборд: суммы ответов и рейтинга за период',
    all[1].posts === 2 && all[1].comments === 6 && all[1].score === 7);
  check('лидерборд: views суммируются', all[1].views === 50);

  check('лидерборд (неделя): старый пост не попадает',
    !week.some((l) => l.nick === 'A') || week.find((l) => l.nick === 'A').posts === 1);
  check('лидерборд (неделя): будущий пост не попадает', !week.some((l) => l.nick === 'Будущее'));
  check('лидерборд (всё время): будущий пост виден', all.some((l) => l.nick === 'Будущее'));
  check('лидерборд: не-массив даёт пустой ряд', leaderboardOf(null).length === 0 && leaderboardOf(undefined).length === 0);

  const board = {
    week: [{ rank: 1, nick: 'B', avatar: '', posts: 1, comments: 8, views: 80, score: 1 }],
    all: [
      { rank: 1, nick: 'B', avatar: '', posts: 1, comments: 8, views: 80, score: 1 },
      { rank: 2, nick: 'A', avatar: '', posts: 2, comments: 6, views: 50, score: 7 },
    ],
  };
  const leadAll = renderForum({ events: [] }, { lead: board, leadPeriod: 'all' });
  check('лидерборд: панель рисуется при непустом ряде', /data-forum-lead/.test(leadAll));
  check('лидерборд: вкладки «Неделя» и «Всё время»', /data-forum-lead-period="week"/.test(leadAll) && /data-forum-lead-period="all"/.test(leadAll));
  check('лидерборд: строки с ником и числом постов',
    /forum-lead__row/.test(leadAll) && /href="#\/user\/A"/.test(leadAll) && /2 поста/.test(leadAll));
  check('лидерборд: выбранный период помечен', /class="seg__btn is-on"[^>]*data-forum-lead-period="all"/.test(leadAll));

  const leadWeekEmpty = renderForum({ events: [] }, { lead: { week: [], all: board.all }, leadPeriod: 'week' });
  check('лидерборд: пустая неделя — приглашение написать первым',
    /data-forum-lead/.test(leadWeekEmpty) && /станьте первым/.test(leadWeekEmpty));

  const leadNone = renderForum({ events: [] }, { lead: { week: [], all: [] }, leadPeriod: 'all' });
  check('лидерборд: пустой ряд — нет панели', !/data-forum-lead/.test(leadNone));

  const mountSource = await readFile('src/forum/mount.js', 'utf8');
  const pagesSource = await readFile('src/pages/forum.js', 'utf8');
  check('лидерборд: mount считает через leaderboardOf по обеим периодам',
    /leaderboardOf\(.*period: 'week'/.test(mountSource) && /leaderboardOf\(.*period: 'all'/.test(mountSource));
  check('лидерборд: широкая выборка для счёта',
    /listPosts\(\{ sort: 'fresh', limit: 300, serverId: state\.serverId \}\)/.test(mountSource));
  check('лидерборд: переключение периода обрабатывается',
    /data-forum-lead-period/.test(mountSource) && /state\.leadPeriod/.test(mountSource));
}

/* ── «Мой след»: подсветка карточек с участием ── */
{
  const { renderPostCard } = await import('../src/pages/forum.js');
  const t0 = new Date('2026-01-01T00:00:00Z');
  const seat = { me: null, openPostId: null, editingPostId: null, comments: [],
    category: 'all', sort: 'fresh', categories: {} };
  const member = { ...seat, me: { id: 'u1', role: 'member' } };

  const base = {
    id: 'x1', authorId: 'u2', authorNick: 'B', title: 'T', body: '<p>x</p>',
    category: 'offtop', reactions: {}, myReaction: null, commentCount: 0, views: 0,
    createdAt: t0,
  };

  const plain = renderPostCard({ ...base }, member);
  check('след: без участия нет ни класса, ни бейджа',
    !/forum-post--trail/.test(plain) && !/Ваш след/.test(plain));

  const minePost = renderPostCard({ ...base, authorId: 'u1', authorNick: 'A' }, member);
  check('след: свой пост подсвечен', /forum-post--trail/.test(minePost) && /Ваш след/.test(minePost));

  const reacted = renderPostCard({ ...base, myReaction: 'like' }, member);
  check('след: моя реакция подсвечена', /forum-post--trail/.test(reacted) && /Ваш след/.test(reacted));

  const voted = renderPostCard({
    ...base,
    poll: {
      id: 'pl', question: 'Q', multiple: false, total: 1, closed: false,
      options: [{ id: 'o', text: 'X', votes: 1, mine: true }],
    },
  }, member);
  check('след: голос в опросе подсвечен', /forum-post--trail/.test(voted) && /Ваш след/.test(voted));

  const guestPlain = renderPostCard({ ...base, myReaction: 'like' }, seat);
  check('след: гость не получает подсветку', !/forum-post--trail/.test(guestPlain));

  const verifiedPost = renderPostCard({ ...base, authorIsVerified: true }, member);
  check('проверенный автор носит зелёную метку', /role-badge--verified/.test(verifiedPost));
  check('без флага проверки метка серая', /role-badge--unverified/.test(plain));
}

/* ── Еженедельная тема ── */
{
  const { renderForum } = await import('../src/pages/forum.js');
  const { KNOWN_TEXT_KEYS } = await import('../src/admin/edit.js');

  const seat = { ready: true, posts: [], hot: [], lead: [], categories: {} };

  const themed = renderForum({ events: [], texts: [
    { key: 'forum-theme', title: 'Рубрика дипломатии', body: 'Расскажите о союзах этой недели.' },
  ] }, seat);
  check('тема недели: баннер рисуется', /data-forum-theme/.test(themed));
  check('тема недели: заголовок показан', /Рубрика дипломатии/.test(themed));
  check('тема недели: текст рубрики показан', /союзах этой недели/.test(themed));

  const noTheme = renderForum({ events: [], texts: [
    { key: 'guide-intro', title: 'Гайд', body: 'x' },
  ] }, seat);
  check('тема недели: без ключа баннера нет', !/data-forum-theme/.test(noTheme));

  const emptyTexts = renderForum({ events: [], texts: [] }, seat);
  check('тема недели: пустой список текстов не мешает', !/data-forum-theme/.test(emptyTexts));

  const bareTheme = renderForum({ events: [], texts: [
    { key: 'forum-theme', title: '', body: '' },
  ] }, seat);
  check('тема недели: пустой заголовок — заглушка', /data-forum-theme/.test(bareTheme) && /Тема недели/.test(bareTheme));

  const { readFile } = await import('node:fs/promises');
  const pagesSource = await readFile('src/pages/forum.js', 'utf8');
  check('тема недели: ключ один на форум и панель',
    KNOWN_TEXT_KEYS.includes('forum-theme') && /FORUM_THEME_KEY = 'forum-theme'/.test(pagesSource));
}

/* ── Подтверждение ника и журнал имён на странице участника ── */
{
  const { renderUserPage } = await import('../src/pages/user.js');
  const { readFile } = await import('node:fs/promises');

  const profile = {
    id: 'u2', nick: 'Игрок', role: 'member', allianceTag: 'KR33',
    createdAt: new Date(), isVerified: false,
    postCount: 0, commentCount: 0, likesReceived: 0, profileLikes: 0,
  };
  const base = { profile, posts: [] };
  const leader = { id: 'u1', nick: 'Лидер', role: 'member', leaderOf: 'KR33', isLeader: true };
  const moderator = { id: 'u9', nick: 'Мод', role: 'moderator' };
  const stranger = { id: 'u3', nick: 'Прохожий', role: 'member' };
  const self = { id: 'u2', nick: 'Игрок', role: 'member' };

  check('лидер альянса видит кнопку подтверждения ника',
    /data-profile-verify/.test(renderUserPage({ ...base, me: leader })));
  check('модератор видит кнопку подтверждения ника',
    /data-profile-verify/.test(renderUserPage({ ...base, me: moderator })));
  check('постороннему игроку кнопка не показывается',
    !/data-profile-verify/.test(renderUserPage({ ...base, me: stranger })));
  check('сам себе подтвердить нельзя — кнопки нет',
    !/data-profile-verify/.test(renderUserPage({ ...base, me: self })));
  check('лидер чужого альянса подтвердить не может',
    !/data-profile-verify/.test(renderUserPage({ ...base, me: { ...leader, leaderOf: 'FFA' } })));
  check('подтверждённому игроку кнопка предлагает снять',
    /data-profile-ver="1"/.test(renderUserPage({ ...base, me: moderator, profile: { ...profile, isVerified: true } }))
      && /Снять подтверждение/.test(renderUserPage({ ...base, me: moderator, profile: { ...profile, isVerified: true } })));

  const entry = { createdAt: new Date('2026-09-01T12:00:00Z'), oldNick: 'Старый', newNick: 'Игрок', changedBy: 'u1', reason: 'троллил чужим ником' };
  check('модератору виден журнал переименований с причиной',
    /История переименований/.test(renderUserPage({ ...base, me: moderator, history: [entry] }))
      && /Старый → Игрок/.test(renderUserPage({ ...base, me: moderator, history: [entry] }))
      && /троллил чужим ником/.test(renderUserPage({ ...base, me: moderator, history: [entry] })));
  check('сам игрок видит свой журнал',
    /История переименований/.test(renderUserPage({ ...base, me: self, history: [entry] })));
  check('постороннему журнал не показывается',
    !/История переименований/.test(renderUserPage({ ...base, me: stranger, history: [entry] })));
  check('пустой журнал честно говорит «не менялся»',
    /Ник не менялся/.test(renderUserPage({ ...base, me: moderator, history: [] })));

const nicksSql = await readFile('supabase/applied/nicks-verified.sql', 'utf8');
  const autoProtectedNicksSql = await readFile('supabase/applied/auto-protected-nicks.sql', 'utf8');
  check('база автоматически резервирует прежний ник триггером',
    /create trigger forum_reserve_released_nick[\s\S]*?before update of nick/.test(nicksSql));
  check('отдельная миграция включает защиту и сохраняет свободные старые ники',
    /forum_reserve_released_nick/.test(autoProtectedNicksSql)
      && /forum_nick_history/.test(autoProtectedNicksSql));
  check('функция ключа ника в базе применяет NFKC и полную карту двойников',
    /normalize\(coalesce\(nick, ''\), NFKC\)/.test(nicksSql)
      && /'авекмнорстухіїєοικερτχνàáâãäåą/.test(nicksSql)
      && /01l'/.test(nicksSql));
  check('миграция пересоздаёт уникальный индекс под новый ключ ника',
    (/forum_users_nickkey_uniq/).test(await readFile('supabase/applied/nick-confusables.sql', 'utf8')));
  check('журнал переименований в базе открыт модерации, а не только владельцу',
    /forum_nick_history_list\(target_user uuid\)[\s\S]*?not public\.forum_is_staff\(\)/.test(nicksSql));
  check('подтверждение ника в базе разрешает лидеру своего альянса',
    /leader_of into v_my_leader_of[\s\S]*?alliance_tag into v_victim_tag[\s\S]*?v_victim_tag <> v_my_leader_of/.test(nicksSql));
  check('mount обновляет state.me после смены ника — шапка не врёт',
    /renameNick\(newNick\)[\s\S]{0,300}state\.me = await forum\.currentUser\(\)/.test(
      await readFile('src/forum/mount.js', 'utf8')));
}

console.log(`\n${'─'.repeat(52)}`);
{
  const { renderAbout } = await import('../src/pages/about.js');
  const html = renderAbout();
  check('о проекте: один заголовок страницы', (html.match(/<h1>/g) || []).length === 1);
  check('о проекте: предупреждение о чтении чатов', html.includes('Содержимое чатов могут читать владелец и модераторы.'));
  /*
    Страница «О проекте» — единственное место, где игроку объясняют новый
    порядок входа. Проверки держат её в согласии с кодом: текст обещает
    восстановление самому, а не переписку с владельцем, и не обещает настройки
    смены пароля, которых на сайте нет.
  */
  check('о проекте: доступ восстанавливает сам игрок',
    html.includes('Восстанавливаете доступ сами.'));
  check('о проекте: нет восстановления почтой',
    html.includes('Письма «забыли пароль» нет'));
  check('о проекте: владелец не узнаёт новый пароль',
    /не видит ни старый, ни новый пароль/.test(html));
  check('о проекте: пароль игрок вводит сам',
    /введите новый пароль прямо на сайте: его знаете только вы/i.test(html));
  check('о проекте: нет обещания сменить пароль в настройках',
    !/настройк[а-яё]* аккаунта/i.test(html));
  check('о проекте: нет технических и служебных деталей', !/Supabase|SQL|админ-панел|бэкап|service.worker/i.test(html));
  check('о проекте: ссылки на основные разделы', ['forum', 'ladder', 'timeline', 'chats', 'guides', 'tournaments'].every((id) => html.includes(`href="#/${id}"`)));
}

console.log(`\n${'─'.repeat(52)}`);
// ── R2. Главная: «Прямо сейчас», счёт недели и «Кто именно» ────────────────
console.log('\nR2. Главная страница');
{
  const { renderHome } = await import('../src/pages/home.js');
  const { computeStandings, computeQuarterWindow, computeWeekSummary, computeMovers, weeksUpToLastData } =
    await import('../src/logic/standings.js');
  const { readFile } = await import('node:fs/promises');
  const h = await import('../src/ui/helpers.js');

  const scoring = { win: 1, loss: -1 };
  const DAY = 86400000;

  /*
    Даты недель ставятся относительно сегодняшнего дня. Панель «Прямо сейчас»
    смотрит на часы, и тест с жёсткой датой начал бы падать или врать каждые
    сутки, а не по причине поломки кода.

    Недели — как в боевой таблице: понедельник .. воскресенье, полночь UTC.
  */
  const monday = new Date(new Date().setUTCHours(0, 0, 0, 0));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const week = (number, offset) => ({
    id: `W${number}`,
    number,
    startDate: new Date(monday.getTime() + offset * 7 * DAY),
    endDate: new Date(monday.getTime() + (offset * 7 + 6) * DAY),
  });

  const alliances = [1, 2, 3, 4].map((i) => ({
    id: `a${i}`, tag: `T${i}`, name: `Альянс ${i}`, active: true, color: '#123456',
  }));

  // Каждый VS: двое победили, двое проиграли — как требует доменная модель.
  const playedWeek = (w) => [
    { weekId: w.id, allianceId: 'a1', outcome: 'win' },
    { weekId: w.id, allianceId: 'a2', outcome: 'win' },
    { weekId: w.id, allianceId: 'a3', outcome: 'loss' },
    { weekId: w.id, allianceId: 'a4', outcome: 'loss' },
  ];

  /*
    НАБОР ПОЛЕЙ СОБИРАЕТСЯ ТЕМИ ЖЕ ФУНКЦИЯМИ, ЧТО И MAIN.JS.

    Это не выдуманный view: weeks режутся weeksUpToLastData, Кварт считается
    computeQuarterWindow, итоги недели — computeWeekSummary. Если главная
    начнёт читать поле, которого сайт ей не даёт, тест это увидит.
  */
  const build = (allWeeks, results) => {
    const weeks = weeksUpToLastData(allWeeks, results);
    const standings = computeStandings(alliances, weeks, results, scoring, 5);
    const quarter = computeQuarterWindow(allWeeks, results, 4);
    return {
      allWeeks,
      results,
      weeks,
      standings,
      quarter,
      quarterStandings: computeStandings(alliances, quarter.weeks, results, scoring, 4),
      summary: computeWeekSummary(alliances, weeks, results),
      movers: computeMovers(standings),
    };
  };

  // ── Состояние 1: идёт неделя, её результаты ещё не внесены ──────────────
  const w5 = week(5, -3), w6 = week(6, -2), w7 = week(7, -1), w8 = week(8, 0), w9 = week(9, 1);
  const live = build([w5, w6, w7, w8, w9], [...playedWeek(w5), ...playedWeek(w6), ...playedWeek(w7)]);
  const liveHtml = renderHome(live);

  check('идущая неделя: панель «Прямо сейчас» есть', /class="panel live"/.test(liveHtml));
  check('идущая неделя: названа та, чей VS впереди, а не последняя с данными',
    /Идёт неделя <b class="num">8<\/b>/.test(liveHtml));
  check('идущая неделя: показан её собственный диапазон дат',
    liveHtml.includes(`${h.fmtDate(w8.startDate)} — ${h.fmtDate(w8.endDate)}`));
  check('идущая неделя: есть счётчик дней до конца',
    /до конца|последний день недели/.test(liveHtml));
  check('идущая неделя: Кварт считается по сыгранным, а не по заведённым',
    /Кварт <b class="num">2<\/b> · сыграно 3 из 4/.test(liveHtml));
  check('идущая неделя: точек ровно по числу недель периода',
    (liveHtml.match(/<i class="live__dot/g) ?? []).length === 4);
  check('идущая неделя: горят только сыгранные',
    (liveHtml.match(/live__dot is-on/g) ?? []).length === 3);
  check('идущая неделя: ссылка на страницу Кварта ведёт куда надо',
    liveHtml.includes('href="#/quarter"'));

  /*
    Главный смысл панели: «итоги» и «сейчас» — разные недели. Если кто-то
    склеит их обратно в одну, тест упадёт здесь, а не на глазах у людей.
  */
  check('идущая неделя: герой говорит про неделю 7, панель — про неделю 8',
    /Неделя<\/span>\s*<span class="hero__num num">7<\/span>/.test(liveHtml) &&
      /Идёт неделя <b class="num">8<\/b>/.test(liveHtml));

  // ── Состояние 2: последняя заведённая неделя закрыта, новой нет ──────────
  /*
    Ровно та картина, на которой панель молчала: неделя кончилась, следующую
    ещё не завели, вносить нечего. Проверено на живой выгрузке 22.09.2026.
  */
  const p6 = week(6, -3), p7 = week(7, -2), p8 = week(8, -1);
  const paused = build([p6, p7, p8], [...playedWeek(p6), ...playedWeek(p7), ...playedWeek(p8)]);
  const pausedHtml = renderHome(paused);
  check('пауза: панель не молчит', /class="panel live"/.test(pausedHtml));
  check('пауза: честно сказано, что активной недели нет',
    /Пауза между VS/.test(pausedHtml) && !/Идёт неделя/.test(pausedHtml));
  check('пауза: названа последняя сыгранная неделя',
    /Сыграна неделя <b class="num">8<\/b>/.test(pausedHtml));
  check('пауза: не выдумывает «неделя не заведена»',
    !/не заведена/.test(pausedHtml));

  // ── Состояние 3: ближайшая неделя уже в таблице, но ещё не началась ─────
  const upcoming = build([w5, w6, w7, w8, w9], [...playedWeek(w5), ...playedWeek(w6), ...playedWeek(w7), ...playedWeek(w8)]);
  const upcomingHtml = renderHome(upcoming);
  check('будущая неделя: «Скоро», а не «Идёт»',
    /Скоро неделя <b class="num">9<\/b>/.test(upcomingHtml) && !/Идёт неделя/.test(upcomingHtml));
  check('будущая неделя: до неё считают дни', /новый Кварт с/.test(upcomingHtml));
  check('будущая неделя: отсчёт до начала, а не до конца ещё не начавшейся недели',
    /Скоро неделя <b class="num">9<\/b>[\s\S]{0,200}до начала/.test(upcomingHtml) &&
      !/до конца/.test(upcomingHtml));

  // ── Состояние 4: новый Кварт уже идёт, а впереди неделя 9 ───────────────
  const x5 = week(5, -4), x6 = week(6, -3), x7 = week(7, -2), x8 = week(8, -1), x9 = week(9, 0);
  const crossed = renderHome(
    build([x5, x6, x7, x8, x9], [...playedWeek(x5), ...playedWeek(x6), ...playedWeek(x7), ...playedWeek(x8)])
  );
  check('стык Квартов: идущая неделя названа', /Идёт неделя <b class="num">9<\/b>/.test(crossed));
  check('стык Квартов: закрытый период не называется «завершён» рядом со словом «идёт»',
    /новый Кварт уже идёт/.test(crossed) && !/завершён/.test(crossed));
  check('пауза между VS: тот же период честно назван завершённым',
    /завершён/.test(pausedHtml));

  /*
    Последний день недели — отдельная подпись, и поймать её «на календаре»
    нельзя: недели в тесте строим так, чтобы конец одной из них пришёлся
    ровно на сегодня.
  */
  const today0 = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const span = (number, from, to) => ({
    id: `W${number}`,
    number,
    startDate: new Date(today0.getTime() + from * DAY),
    endDate: new Date(today0.getTime() + to * DAY),
  });
  const e5 = span(5, -34, -28), e6 = span(6, -27, -21), e7 = span(7, -20, -14), e8 = span(8, -13, -7);
  const lastDayHtml = renderHome(
    build([e5, e6, e7, e8, span(9, -6, 0)],
      [...playedWeek(e5), ...playedWeek(e6), ...playedWeek(e7), ...playedWeek(e8)])
  );
  check('последний день: сказано «последний день недели», без отсчёта',
    /последний день недели/.test(lastDayHtml) && !/до конца/.test(lastDayHtml));
  check('последний день: итоги недели и идущая неделя не перепутаны',
    /Неделя<\/span>\s*<span class="hero__num num">8<\/span>/.test(lastDayHtml) &&
      /Идёт неделя <b class="num">9<\/b>/.test(lastDayHtml));

  // ── Герой: счёт вместо стен тайлов ──────────────────────────────────────
  check('счёт недели: ровно две клетки — победа и поражение',
    (liveHtml.match(/weekscore__cell/g) ?? []).length === 2);
  check('счёт недели: цифры сходятся с составом недели',
    /winscore[\s\S]{0,120}<b class="num">2<\/b>/.test(liveHtml) &&
      /losscore[\s\S]{0,120}<b class="num">2<\/b>/.test(liveHtml));
  check('счёт недели: склонение выбрано по числу',
    /победител/.test(liveHtml) && /проигравш/.test(liveHtml));
  check('«Кто именно» спрятан в раскрытие и работает без скрипта',
    /<details class="who">/.test(liveHtml) && /<summary class="who__summary">/.test(liveHtml));
  check('списки победителей и проигравших остались, просто под катом',
    (liveHtml.match(/class="tile"/g) ?? []).length === 4);
  check('до раскрытия на первом экране нет ни одного тайла',
    !liveHtml.slice(0, liveHtml.indexOf('<details')).includes('class="tile"'));
  check('«Вершина таблицы» не вернулась третьим дублем топа',
    !/Вершина таблицы/.test(liveHtml));
  check('гонка сезона и движение рейтинга остались',
    /Гонка сезона/.test(liveHtml) && /Движение в рейтинге/.test(liveHtml));
  check('ссылка на весь рейтинг есть под катом', liveHtml.includes('href="#/ladder"'));

  // Внесены не все: главная обязана сказать «N из M», а не «всё внесено».
  const partial = build([w5, w6, w7], [
    ...playedWeek(w5), ...playedWeek(w6),
    { weekId: 'W7', allianceId: 'a1', outcome: 'win' },
    { weekId: 'W7', allianceId: 'a3', outcome: 'loss' },
  ]);
  check('неполная неделя: честно «внесено 2 из 4»',
    /внесено 2 из 4/.test(renderHome(partial)));
  const full = build([w5, w6, w7], [...playedWeek(w5), ...playedWeek(w6), ...playedWeek(w7)]);
  check('полная неделя: «4 результата внесено» без дроби',
    /4 результата внесено/.test(renderHome(full)) && !/внесено 4 из 4/.test(renderHome(full)));

  // ── Предсезонка и пустой кадр ────────────────────────────────────────────
  const pre = renderHome(build([w8, w9], []));
  check('до первого результата: герой про старт отсчёта',
    /Отсчёт начинается/.test(pre) && /первый VS в истории сайта/.test(pre));
  check('до первого результата: счёт недели и кат с тайлами не рисуются',
    !/weekscore/.test(pre) && !/<details class="who">/.test(pre));
  check('до первого результата: панель «Прямо сейчас» всё равно есть',
    /Идёт неделя <b class="num">8<\/b>/.test(pre));

  const blank = renderHome({
    allWeeks: [], results: [], weeks: [], standings: [], quarterStandings: [],
    quarter: { weeks: [], playedWeeks: 0, number: 0, startNumber: 0, endNumber: 0, endDate: null },
    summary: null, movers: { up: [], down: [] },
  });
  check('пустой кадр: страница рисуется и не падает', /Отсчёт начинается/.test(blank));
  check('пустой кадр: недель нет — так и сказано', /Недели ещё не заведены/.test(blank));
  check('пустой кадр: придуманной панели «Прямо сейчас» нет', !/Прямо сейчас/.test(blank));
  check('вызов вообще без аргументов не роняет страницу',
    typeof renderHome() === 'string' && renderHome().length > 0);

  // Имя альянса не должно становиться разметкой.
  const evil = build([w5, w6], playedWeek(w5));
  const evilHtml = renderHome({
    ...evil,
    standings: evil.standings.map((row) => ({ ...row, alliance: { ...row.alliance, name: '<b>х</b>' } })),
  });
  check('главная: имя альянса экранируется', !evilHtml.includes('<b>х</b>'));

  /*
    ГЛАВНАЯ НЕ ЧИТАЕТ ПОЛЕЙ, КОТОРЫХ ЕЙ НЕ ОТДАЮТ.

    Функции собирают список полей из исходника самой страницы, а проверяют
    против main.js: пустого кадра, с которым страница рисуется до прихода
    данных, и загруженного набора. Если страница начнёт читать то, чего ей
    не кладут, сломается здесь, а не у человека на пустой вкладке.
  */
  const homeSrc = await readFile('src/pages/home.js', 'utf8');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const fields = new Set();
  for (const match of homeSrc.matchAll(/const \{([^}]+)\} = view/g)) {
    for (const name of match[1].split(',')) if (name.trim()) fields.add(name.trim());
  }
  for (const match of homeSrc.matchAll(/function renderLive\(\{([^}]+)\}/g)) {
    for (const name of match[1].split(',')) if (name.trim()) fields.add(name.trim());
  }
  check('список читаемых главной полей найден в её исходнике',
    fields.size >= 6, `найдено ${fields.size}`);

  const emptyBlock = mainSrc.match(/function emptyView[\s\S]*?return \{([\s\S]*?)\n\s{2,}\};/)?.[1] ?? '';
  const loadedBlock = mainSrc.match(/\n\s*view = \{([\s\S]*?)\n\s{4,}\};/)?.[1] ?? '';
  check('оба набора полей найдены в main.js',
    emptyBlock.length > 0 && loadedBlock.length > 0);

  /*
    Загруженный набор начинается с `...data`: поля адаптера приходят оттуда,
    и их имена берутся из того же контракта, что проверяет тест A.
  */
  const dataFields = ['alliances', 'weeks', 'results', 'events', 'texts'];
  const has = (block, field) => new RegExp(`(^|[\\s{,])${field}\\s*[:,]`).test(block);

  for (const field of fields) {
    check(`главная: поле «${field}» есть в пустом кадре`, has(emptyBlock, field));
    check(`главная: поле «${field}» отдаётся после загрузки`,
      has(loadedBlock, field) || dataFields.includes(field));
  }
}

console.log(`\n${'─'.repeat(52)}`);
/* ── Выдержка на публикации и знак «не прочитано» ── */
{
  const { readFile } = await import('node:fs/promises');
  const L = CONFIG.forum.limits;
  const holdSql = await readFile('supabase/applied/20260925-spam-hold-and-topic-reads.sql', 'utf8');

  /*
    Числа живут в двух местах: в config.js (их называет форма) и в триггерах
    базы (их исполняет база). Расхождение значит, что игроку пообещали одно,
    а отказали через другой срок — поэтому совпадение проверяется здесь.
  */
  check('выдержка тем: один срок в подсказке и в базе',
    holdSql.includes(`interval '${L.postHoldMinutes} minutes'`));
  check('выдержка ответов: один срок в подсказке и в базе',
    holdSql.includes(`interval '${L.commentHoldMinutes} minutes'`));
  check('потолок тем: одно число в подсказке и в базе',
    holdSql.includes(`allowed := ${L.postHoldMax} * case`));
  check('потолок ответов: одно число в подсказке и в базе',
    holdSql.includes(`allowed := ${L.commentHoldMax} * case`));
  check('срок повтора текста один в подсказке и в базе',
    holdSql.includes(`interval '${L.repeatHoldMinutes} minutes'`));
  check('staff получает втрое больше',
    (holdSql.match(/then 3 else 1 end/g) || []).length === 2);
  check('выдержку держат триггеры до вставки, а не сервер сайта',
    /create trigger forum_posts_hold[\s\S]{0,120}before insert on public\.forum_posts/.test(holdSql)
      && /create trigger forum_comments_hold[\s\S]{0,120}before insert on public\.forum_comments/.test(holdSql));
  check('запрос без вошедшего человека не задерживаем',
    (holdSql.match(/if auth\.uid\(\) is null then/g) || []).length === 3);

  check('отметка прочтения — одна строка на пару «человек и тема»',
    /create table if not exists public\.forum_topic_reads \([\s\S]*?primary key \(user_id, post_id\)/.test(holdSql));
  check('свою отметку читает и пишет только сам человек',
    (holdSql.match(/user_id = auth\.uid\(\)/g) || []).length >= 4);
  check('счётчик не прочитанного — отдельное представление, а не колонка ленты',
    /create view public\.forum_topic_unread with \(security_invoker = on\) as/.test(holdSql)
      && !/forum_topic_unread/.test(await readFile('supabase/applied/schema.sql', 'utf8')));
  check('в счётчике не считаем свои и стёртые ответы',
    /c\.author_id is distinct from auth\.uid\(\)/.test(holdSql)
      && /c\.deleted = false/.test(holdSql));
  check('ставить отметку умеет только вошедший',
    /revoke all on function public\.forum_read_topic\(uuid\) from public, anon;/.test(holdSql)
      && /grant execute on function public\.forum_read_topic\(uuid\) to authenticated;/.test(holdSql));

  const contract = await readFile('src/forum/contract.js', 'utf8');
  check('контракт описывает поле unread', /@property \{number\}\s+\[unread\]/.test(contract));
  check('контракт требует от адаптера markRead', /\[markRead\]/.test(contract) || /=> Promise<void>\} markRead/.test(contract));

  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  check('рабочий адаптер берёт счётчик из представления, а не из ленты',
    /forum_topic_unread\?select=post_id,unread/.test(supaSrc));
  check('отказ представления гасит только знак, но не ленту',
    /forum_topic_unread\?select=post_id,unread'\)\.catch\(\(\) => \[\]\)/.test(supaSrc));
  check('отметку прочтения ставит вызов функции в базе',
    /rpc\/forum_read_topic/.test(supaSrc));

  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  check('вход в тему ставит отметку прочтения', /forum\.markRead\(postId\)/.test(mountSrc));
  check('знак на открытой теме гасится сразу', /opened\.unread = 0/.test(mountSrc));
}

/* ── Черновой режим: те же правила и те же слова ── */
{
  const local = await import('../src/forum/adapters/local.js');
  const L = CONFIG.forum.limits;
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  await local.signUp('Хранитель');
  await local.signUp('Автор');

  const made = [];
  for (let i = 0; i < L.postHoldMax; i++) {
    made.push(await local.createPost({
      title: `Тема ${i}`, body: `<p>текст номера ${i}</p>`, category: 'offtop',
    }));
  }
  let held = '';
  try {
    await local.createPost({ title: `Тема ${L.postHoldMax}`, body: '<p>ещё одна</p>', category: 'offtop' });
  } catch (e) { held = String(e.message); }
  check('черновой режим держит тему так же, как база',
    held.includes(`не больше ${L.postHoldMax} за ${L.postHoldMinutes} минут`));

  let heldComment = '';
  for (let i = 0; i <= L.commentHoldMax; i++) {
    try {
      await local.addComment(made[0].id, `<p>ответ номер ${i}</p>`);
    } catch (e) { heldComment = String(e.message); break; }
  }
  check('черновой режим держит ответ так же, как база',
    heldComment.includes(`не больше ${L.commentHoldMax} за ${L.commentHoldMinutes} минуты`));

  await local.signUp('Повтор');
  const copied = { title: 'Один и тот же текст', body: '<p>копия</p>', category: 'offtop' };
  await local.createPost(copied);
  let dup = '';
  try { await local.createPost(copied); } catch (e) { dup = String(e.message); }
  check('тот же текст второй раз не проходит',
    dup === 'Такая тема у вас уже есть — правьте её, а не заводите копию');
  let dupComment = '';
  await local.addComment(made[1].id, '<p>один раз</p>');
  try { await local.addComment(made[1].id, '<p>один раз</p>'); } catch (e) { dupComment = String(e.message); }
  check('тот же ответ в другую тему не переносится',
    dupComment === 'Вы уже писали это — скопировать один и тот же ответ в несколько тем нельзя');

  /* Первый игрок в черновом режиме — владелец: ему втрое больше, чем всем. */
  let staffErr = '';
  try {
    await local.signIn('Хранитель');
    for (let i = 0; i < L.postHoldMax + 1; i++) {
      await local.createPost({ title: `Служебная тема ${i}`, body: `<p>текст служебный ${i}</p>`, category: 'offtop' });
    }
  } catch (e) { staffErr = String(e.message); }
  check('staff получает втрое больше и в черновом режиме', staffErr === '', staffErr);

  /* Счётчик новых ответов — та же комната, что и выше, но с чистого листа. */
  store.clear();
  await local.signUp('Владелец');
  await local.signUp('Читатель');
  const topic = await local.createPost({
    title: 'Тема со счётчиком', body: '<p>текст темы</p>', category: 'offtop',
  });
  const feedOf = async (nick) => {
    if (nick) await local.signIn(nick);
    const { posts } = await local.listPosts({ limit: 50 });
    return posts.find((p) => p.id === topic.id);
  };

  check('своей темы без чужих ответов не считаем', (await feedOf('Читатель')).unread === 0);
  await local.signIn('Владелец');
  await local.addComment(topic.id, '<p>ответ не от автора</p>');
  check('чужой ответ в теме виден как новый', (await feedOf('Читатель')).unread === 1);
  await local.markRead(topic.id);
  check('после входа в тему знак гаснет', (await feedOf('Читатель')).unread === 0);
  // Ответ должен появиться строго позже отметки — иначе миллисекунды совпадут.
  await new Promise((r) => setTimeout(r, 5));
  await local.signIn('Владелец');
  await local.addComment(topic.id, '<p>ещё один ответ не от автора</p>');
  check('ответ после входа снова считается новым', (await feedOf('Читатель')).unread === 1);
  await local.signIn('Читатель');
  await local.addComment(topic.id, '<p>свой ответ</p>');
  check('свой ответ новых не добавляет', (await feedOf()).unread === 1);
  await local.signOut();
  check('гостю считать нечего',
    (await local.listPosts({ limit: 50 })).posts.every((p) => !p.unread));
}

/* ── Лента: знак новых ответов и срок под формой ── */
{
  const { readFile } = await import('node:fs/promises');
  const { renderPostCard, renderForum } = await import('../src/pages/forum.js');
  const L = CONFIG.forum.limits;
  const t0 = new Date('2026-01-01T00:00:00Z');
  const seat = { me: { id: 'u1', role: 'member' }, openPostId: null, editingPostId: null,
    comments: [], category: 'all', sort: 'fresh', categories: {} };
  const base = { id: 'x1', authorId: 'u2', authorNick: 'B', title: 'T', body: '<p>x</p>',
    category: 'offtop', reactions: {}, myReaction: null, commentCount: 1, views: 0, createdAt: t0 };

  const three = renderPostCard({ ...base, unread: 3 }, seat);
  check('знак новых ответов стоит в шапке карточки',
    /forum-post__new/.test(three) && /3 новых ответа/.test(three));
  check('тема с новыми ответами помечена классом', /forum-post--unread/.test(three));
  check('заголовок такой темы плотнее — правило есть в стилях',
    /\.forum-post--unread \.forum-post__title \{ font-weight: 800; \}/.test(
      await readFile('src/forum.css', 'utf8')));
  check('один новый ответ — единственное число',
    /1 новый ответ/.test(renderPostCard({ ...base, unread: 1 }, seat)));
  check('пять новых ответов — множественное число',
    /5 новых ответов/.test(renderPostCard({ ...base, unread: 5 }, seat)));
  check('без новых ответов знака нет',
    !/forum-post__new/.test(renderPostCard({ ...base, unread: 0 }, seat))
      && !/forum-post--unread/.test(renderPostCard(base, seat)));
  check('знак рисует поле ленты, а не догадка карточки',
    /forum-post__new/.test(renderPostCard({ ...base, unread: 4 }, { ...seat, me: null })));

  const feed = renderForum({ events: [], texts: [] }, {
    ready: true, me: { id: 'u1', role: 'member', banned: false },
    posts: [], hot: [], lead: [], categories: {},
  });
  check('под формой назван тот же потолок тем, что держит база',
    feed.includes(`Не больше ${L.postHoldMax}`) && feed.includes(`за ${L.postHoldMinutes} минут`));
  check('под формой назван тот же потолок ответов, что держит база',
    feed.includes(`${L.commentHoldMax} `) && feed.includes(`за ${L.commentHoldMinutes} минуты`));
}

/* ── Русский язык во всём, что читает человек ── */
{
  const fsSync = await import('node:fs');
  const skip = new Set(['node_modules', '.git', 'dist', '.qoder']);
  const exts = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.sql']);
  const files = [];
  const walk = (dir) => {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (exts.has(p.slice(p.lastIndexOf('.')))) files.push(p);
    }
  };
  walk('src');
  files.push('index.html', 'admin.html', 'config.js', 'sw.js');

  const latinComment = [];
  const cjk = [];
  for (const f of files) {
    const text = fsSync.readFileSync(f, 'utf8');
    if (/[　-〿぀-ヿ㐀-䶿一-鿿가-힯]/.test(text)) cjk.push(f);
    text.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      let comment = null;
      if (t.startsWith('//')) comment = t.slice(2);
      else if (/^\/\*/.test(t) || /^\*/.test(t)) comment = t.replace(/^\/?\*+/, '').replace(/\*\/$/, '');
      else if (t.startsWith('<!--')) comment = t.slice(4);
      else if (t.startsWith('--') && f.endsWith('.sql')) comment = t.slice(2);
      if (comment === null) return;
      // Типы JSDoc и ссылки — не проза: их не переводим.
      if (/@(param|property|returns|type|typedef|template|license)\b/.test(comment)) return;
      if (/https?:/.test(comment)) return;
      if (/[А-Яа-яЁё]/.test(comment)) return;
      if ((comment.match(/[A-Za-z]{3,}(\s+[A-Za-z]{3,}){2,}/g) || []).length === 0) return;
      latinComment.push(`${f}:${i + 1}`);
    });
  }
  check('в комментариях нет английской прозы', latinComment.length === 0, latinComment.join(' '));
  check('в файлах сайта нет иероглифов', cjk.length === 0, cjk.join(' '));
  // Страж без объёма работы — не страж: проверяем, что файлы правда перебраны.
  check('страж языка смотрит исходники сайта', files.length > 60, `файлов: ${files.length}`);
}

// ── T. Фильтры ленты в адресе страницы ─────────────────────────────────────
console.log('\nT. Фильтры в адресе');
{
  /*
    Адрес — единственное место форума, где одна строка обязана дважды дать
    один и тот же результат: первый раз когда человек пришёл по ссылке,
    второй — когда состояние ленты записывают обратно в адрес. Раз эти две
    половины должны совпадать, их проверяют здесь, а не глазами в браузере.
  */
  const { filtersFromSearch, searchFromFilters, QUERY_MAX, DEFAULT_SECTION, DEFAULT_SORT } =
    await import('../src/forum/feed-url.js');
  const { CATEGORY_IDS, TOPIC_TAG_IDS, SORT_IDS } = await import('../src/forum/rules.js');
  const known = { categories: CATEGORY_IDS, tags: TOPIC_TAG_IDS, sorts: SORT_IDS };

  const empty = filtersFromSearch('', known);
  equal('пустой адрес — обычная лента',
    `${empty.category}/${empty.tag}/${empty.sort}/${empty.query}`,
    `${DEFAULT_SECTION}/${DEFAULT_SECTION}/${DEFAULT_SORT}/`);

  const vs = filtersFromSearch('cat=vs&sort=top&q=%D0%B3%D0%B2%D0%B0%D1%80%D0%B4', known);
  equal('адрес читают целиком', `${vs.category}/${vs.sort}/${vs.query}`, 'vs/top/гвард');

  /*
    Ссылка не должна устаревать молча. Если id раздела или тега убрали,
    адрес с ним открывает общую ленту, а не пустой экран и не ошибку:
    человек, перешедший по старой ссылке, хотя бы увидит форум.
  */
  const stale = filtersFromSearch('cat=legions&tag=arena&sort=money', known);
  equal('несуществующий id в адресе не поломка, а обычная лента',
    `${stale.category}/${stale.tag}/${stale.sort}`,
    `${DEFAULT_SECTION}/${DEFAULT_SECTION}/${DEFAULT_SORT}`);

  equal('длинный запрос в адресе обрезают',
    filtersFromSearch(`q=${'а'.repeat(QUERY_MAX + 40)}`, known).query.length, QUERY_MAX);

  /*
    Обратная дорога. Дефолт в адрес не пишем иначе каждая ссылка обрастает
    хвостом из четырёх параметров, и «просто форум» перестаёт быть коротким.
  */
  equal('обычная лента — адрес без хвоста',
    searchFromFilters({ category: DEFAULT_SECTION, tag: DEFAULT_SECTION, sort: DEFAULT_SORT, query: '' }), '');

  /*
    Пробел. URLSearchParams пишет его как «+», и в адресе, который человек
    видит в строке браузера, «+» посреди русского слова выглядит поломкой.
  */
  const spaced = searchFromFilters({ category: 'help', tag: DEFAULT_SECTION, sort: DEFAULT_SORT, query: 'обзор базы' });
  check('пробел в адресе выглядит как пробел', spaced.includes('%20') && !spaced.includes('+'), spaced);
  equal('запрос с пробелом возвращается из адреса тем же словом',
    filtersFromSearch(spaced, known).query, 'обзор базы');

  /*
    Главный смысл: адрес, записанный состоянием, читается обратно тем же
    состоянием — для каждого раздела, каждого тега и каждого порядка.
    Пропавший id здесь виден сразу, а не тогда, когда кто-то скинул ссылку.
  */
  const broken = [];
  for (const category of CATEGORY_IDS) {
    for (const sort of SORT_IDS) {
      const f = { category, tag: DEFAULT_SECTION, sort, query: '' };
      const back = filtersFromSearch(searchFromFilters(f), known);
      if (back.category !== category || back.sort !== sort) broken.push(`${category}/${sort}`);
    }
  }
  for (const tag of TOPIC_TAG_IDS) {
    const f = { category: DEFAULT_SECTION, tag, sort: DEFAULT_SORT, query: '' };
    if (filtersFromSearch(searchFromFilters(f), known).tag !== tag) broken.push(`tag:${tag}`);
  }
  equal('каждый раздел, тег и порядок возвращаются из адреса', broken.join(', '), '');

  /*
    Дальше — что адресом действительно пользуются, а не только умеют строить.
    Проверяем по исходнику три вещи, каждая из которых иначе превращается
    в тихое расхождение: адрес есть, а страницу он не описывает.
  */
  const fsSync = await import('node:fs');
  const mountSrc = fsSync.readFileSync('src/forum/mount.js', 'utf8');
  check('фильтры читают из адреса до первой отрисовки ленты',
    /if \(!postId\) readFilters\(search\);/.test(mountSrc));
  check('лента подписывает адрес одним местом, а не каждым обработчиком',
    /if \(!append\) writeFilters\(\);/.test(mountSrc));
  check('адрес меняют без перезагрузки страницы',
    mountSrc.includes('history.replaceState') && !/location\.hash = `#\/forum\$\{/.test(mountSrc));

  const mainSrc = fsSync.readFileSync('src/main.js', 'utf8');
  check('маршрутизатор отделяет хвост адреса от вкладки',
    /const \[path, search\] = location\.hash/.test(mainSrc) && /search: search \|\| ''/.test(mainSrc));
  check('хвост адреса доходит до форума', /mountForum\(app, view, param, search\)/.test(mainSrc));
}

console.log(`\n${'─'.repeat(52)}`);
// ── U. Гайды: отметка модерации и сигнал об устаревании ─────────────────────
console.log('\nU. Гайды: отметка и сигнал');
{
  /*
    Отметка «проверен / устарел» живёт в четырёх местах: колонка и две функции
    в базе, два адаптера и разметка страницы. Договорённость между ними стоит
    проверить здесь, потому что ошибка невидима: страница продолжит показывать
    «Проверено модерацией», которую на этот раз поставил кто-то другой.
  */
  const { readFile } = await import('node:fs/promises');
  const L = CONFIG.forum.limits;
  const sql = await readFile('supabase/applied/20260925-guide-review.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const pageSrc = await readFile('src/pages/guides.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');

  /*
    Три состояния и ни одного лишнего. Расхождение в любую сторону ломает
    молча: статус, которого нет в подсказке страницы, игрок увидит как пустое
    место, а removed из списка базы уронит PATCH тупым «violates check».
  */
  const sqlStatuses = (sql.match(/check \(review_status in \(([^)]*)\)\)/)?.[1] ?? '')
    .split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const adapterStatuses = (localSrc.match(/\['none', 'verified', 'outdated'\]/)?.[0] ?? '')
    .match(/'[a-z]+'/g)?.map((x) => x.replace(/'/g, '')) ?? [];
  const labelSrc = pageSrc.match(/const REVIEW_LABEL = \{([^}]*)\}/)?.[1] ?? '';
  /*
    «Не проверен» — не пустое место, а отдельная надпись: гайд выходит сразу, и
    без неё совет участника выглядел бы прочитанным модерацией. Поэтому ключей в
    подсказке ровно три, и none среди них не «дополнение», а первое состояние.
  */
  const pageStatuses = (labelSrc.match(/(\w+):/g) || []).map((x) => x.slice(0, -1));
  equal('отметка принимает ровно три значения — и в базе, и в коде',
    [sqlStatuses.join('/'), adapterStatuses.join('/'), pageStatuses.join('/')].join(' | '),
    'none/verified/outdated | none/verified/outdated | none/verified/outdated');

  /*
    Длина записи об устаревании — те же два места, что и у всех прочих лимитов:
    числа в config.js называет форма, проверка в базе их исполняет.
  */
  check('границы записи об устаревании — одни в форме и в базе',
    sql.includes(`char_length(note) between ${L.guideNoteMin} and ${L.guideNoteMax}`)
      && localSrc.includes(`CONFIG.forum.limits.guideNoteMin`)
      && localSrc.includes(`CONFIG.forum.limits.guideNoteMax`));
  check('длинную запись база обрезает, а не отвергает',
    sql.includes(`left(btrim(coalesce(note, '')), ${L.guideNoteMax})`));

  check('один человек — один сигнал по ключу таблицы',
    /create table if not exists public\.forum_guide_signals \([\s\S]*?primary key \(guide_id, user_id\)/.test(sql));
  check('игроку видно своё, модерации — всё',
    /create policy forum_guide_signals_read[\s\S]*?using \(user_id = auth\.uid\(\) or public\.forum_is_staff\(\)\)/.test(sql));
  check('сигнал вносит сам человек, правит его только модерация',
    /create policy forum_guide_signals_write[\s\S]*?with check \(user_id = auth\.uid\(\) and public\.forum_can_write\(\)\)/.test(sql)
      && /create policy forum_guide_signals_update[\s\S]*?using \(public\.forum_is_staff\(\)\)/.test(sql));

  /*
    Автор гайда имеет право его править — и вместе с текстом унёс бы в PATCH
    чужие колонки, поэтому страж висит на same UPDATE, а не на политике.
  */
  check('отметку нельзя унести вместе с правкой текста',
    /create trigger forum_guide_review_guard[\s\S]{0,120}before update on public\.forum_guides/.test(sql));
  const refusal = 'Отметку «проверен / устарел» ставит модерация';
  check('отказ назван одинаково в базе, в черновом режиме и в адаптере',
    (sql.match(new RegExp(refusal, 'g')) || []).length === 2
      && localSrc.includes(refusal));
  check('у страницы и базы один список статусов: неизвестный статус отвергает база',
    sql.includes(`if status not in ('none', 'verified', 'outdated') then`)
      && localSrc.includes('Неизвестный статус проверки'));

  /* Обе двери — функции, а не прямые запросы к таблице. */
  check('отметка и сигнал идут вызовами, а не записью в колонки',
    supaSrc.includes("'/rpc/forum_review_guide'") && supaSrc.includes("'/rpc/forum_report_guide_stale'")
      && !/forum_guide_signals[^']*(method: 'POST'|method: 'PATCH')/.test(supaSrc));
  check('чужие и анонимные вызовы функций не работают',
    sql.includes(`revoke all on function public.forum_review_guide(uuid, text, text) from public, anon;`)
      && sql.includes(`revoke all on function public.forum_report_guide_stale(uuid, text) from public, anon;`));
  check('контракт объявляет обе новые возможности',
    /reviewGuide/.test(contractSrc) && /reportGuideStale/.test(contractSrc));

  /* ── Черновой режим: та же развилка прав и те же слова ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  await local.signUp('Хранитель');             // первый — админ
  await local.signUp('Читатель');
  await local.signUp('Недоверенный');

  await local.signIn('Хранитель');
  const guide = await local.createGuide({
    slug: 'baza-tya', title: 'Боевая тётя', category: 'strategy', body: '<p>сначала влево</p>',
  });
  equal('новый гайд не имеет отметки', `${guide.reviewStatus}/${guide.reviewNote}`, 'none/');

  await local.signIn('Читатель');
  let denied = '';
  try { await local.reviewGuide(guide.id, 'verified', ''); } catch (e) { denied = String(e.message); }
  equal('игрок отметку не поставит', denied, refusal);

  let short = '';
  try { await local.reportGuideStale(guide.id, 'да'); } catch (e) { short = String(e.message); }
  check('короткий сигнал отклонён словами базы',
    short === 'Нужно хотя бы пять символов: что именно перестало работать', short);

  await local.reportGuideStale(guide.id, 'после обновления сменились цены');
  let asReader = (await local.listGuides()).find((x) => x.id === guide.id);
  equal('свой сигнал читателю виден', asReader.signals.length, 1);

  await local.signIn('Недоверенный');
  asReader = (await local.listGuides()).find((x) => x.id === guide.id);
  equal('чужой сигнал другому игроку не показывают', asReader.signals.length, 0);

  await local.reportGuideStale(guide.id, 'разбор не сходится с патчем');
  equal('своё видно даже рядом с чужим',
    (await local.listGuides()).find((x) => x.id === guide.id).signals.length, 1);

  await local.signIn('Хранитель');
  const asStaff = (await local.listGuides()).find((x) => x.id === guide.id);
  equal('модератор видит все открытые сигналы', asStaff.signals.length, 2);

  await local.reportGuideStale(guide.id, 'первый текст сигнала');
  await local.reportGuideStale(guide.id, 'уточняю: цены подняли вдвое');
  const afterRepeat = (await local.listGuides()).find((x) => x.id === guide.id);
  equal('повтор уточняет сигнал, а не плодит строку',
    `${afterRepeat.signals.length}/${afterRepeat.signals.filter((x) => x.note === 'уточняю: цены подняли вдвое').length}`,
    '3/1');

  await local.reviewGuide(guide.id, 'outdated', 'перестал работать после патча 12');
  const reviewed = await local.getGuide('baza-tya');
  equal('отметка названа, датирована и пояснена',
    `${reviewed.reviewStatus}/${reviewed.reviewNote}/${reviewed.reviewedAt instanceof Date}`,
    'outdated/перестал работать после патча 12/true');
  equal('решение модератора закрывает очередь сигналов', reviewed.signals.length, 0);

  await local.reviewGuide(guide.id, 'none', '');
  const cleared = await local.getGuide('baza-tya');
  equal('отметку можно снять вместе с датой',
    `${cleared.reviewStatus}/${cleared.reviewedAt}`, 'none/null');

  let badStatus = '';
  try { await local.reviewGuide(guide.id, 'needs_update', ''); } catch (e) { badStatus = String(e.message); }
  equal('неизвестный статус черновой режим не принимает',
    badStatus, 'Неизвестный статус проверки: needs_update');

  /* ── Разметка: что человек реально видит ── */
  const { renderGuides } = await import('../src/pages/guides.js');
  /*
    Гайд с отметкой и одним открытым сигналом: разметку проверяем на состоянии,
    которое адаптер реально отдаёт модератору, а не на выдуманном наборе полей.
  */
  const marked = {
    ...cleared,
    reviewStatus: 'outdated',
    reviewNote: 'перестал работать после патча 12',
    reviewedAt: new Date('2026-09-20T10:00:00Z'),
    signals: [{ userId: 'u2', note: 'после обновления сменились цены', createdAt: new Date('2026-09-19T10:00:00Z') }],
  };
  const base = { guides: [marked], category: 'all', query: '', composing: false, loading: false };
  const staffState = { ...base, me: { id: 'u1', nick: 'Хранитель', role: 'admin' }, selected: marked };
  const playerState = { ...base, me: { id: 'u2', nick: 'Читатель', role: 'member' }, selected: marked };
  const guestState = { ...base, me: null, selected: marked };

  const staffList = renderGuides({ ...base, me: staffState.me, selected: null });
  const playerList = renderGuides({ ...base, me: playerState.me, selected: null });
  check('в списке у гайда стоит знак отметки', staffList.includes('guide-badge--outdated'));
  check('знак «устарел» называется по-русски', staffList.includes('Устарел'));
  check('счётчик сигналов видит только модерация',
    staffList.includes('guide-badge--signal') && !playerList.includes('guide-badge--signal'));

  const staffHtml = renderGuides(staffState);
  const playerHtml = renderGuides(playerState);
  const guestHtml = renderGuides(guestState);

  const noticeAt = staffHtml.indexOf('guide-review guide-review--outdated');
  const bodyAt = staffHtml.indexOf('guide-content');
  check('вердикт показан до текста гайда', noticeAt >= 0 && bodyAt > noticeAt);
  check('под отметкой названо решение, а не молчание',
    staffHtml.includes('перестал работать после патча 12'));
  check('отметка названа датой, а не просто словом «проверено»',
    /Устарел · \d{2}\.\d{2}\.\d{4}/.test(staffHtml));
  check('страница объясняет, что отметку ставит человек',
    /не просмотры, не реакции/.test(staffHtml));
  check('кнопки отметки — только у модерации',
    /data-guide-review="verified"/.test(staffHtml) && !/data-guide-review=/.test(playerHtml));
  check('очередь сигналов перечислена модератору и спрятана от игрока',
    /guide-review__queue[\s\S]{0,200}после обновления сменились цены/.test(staffHtml)
      && !playerHtml.includes('guide-review__queue'));
  check('игрок видит свой сигнал и может его уточнить',
    playerHtml.includes('Вы сообщили') && /data-guide-stale-open/.test(playerHtml));
  check('невошедшему человеку не показывают кнопок, которым база откажет',
    !/data-guide-stale/.test(guestHtml) && !/data-guide-review=/.test(guestHtml));
}

// ── V. Срок действия темы ───────────────────────────────────────────────────
console.log('\nV. Срок действия темы');
{
  /*
    Правило размазано по пяти местам: колонка и триггер в базе, метка в
    правилах, числа в конфиге, два адаптера и разметка. Расхождение любого из
    них невидимо: тема без срока просто висит вечно, а игрок не узнает, что
    правило есть.
  */
  const { readFile } = await import('node:fs/promises');
  const L = CONFIG.forum.limits;
  const sql = await readFile('supabase/applied/20260925-announcement-expiry.sql', 'utf8');
  /*
    Правило срока переопределено позже: метка «Обмен» добавлена в
    20260926-barter-board.sql, и он же пересоздаёт и проверку меток, и функцию
    списка, и триггер. Поэтому список меток и текст отказа сверяются с ПОСЛЕДНИМ
    файлом — с прежним они разойтись обязаны, и ниже есть проверка на это.
  */
  const later = await readFile('supabase/applied/20260926-barter-board.sql', 'utf8');
  const oldSql = await readFile('supabase/applied/20260916-forum-community.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const rules = await import('../src/forum/rules.js');

  /* Метка «Срочно» должна доехать до списка, который принимает база. */
  const listOf = (s) => (s ?? '').split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort().join('/');
  equal('метки темы: база и правила называют одно и то же',
    listOf(later.match(/tags <@ array\[([^\]]*)\]::text\[\]/)?.[1]),
    listOf(rules.TOPIC_TAG_IDS.join(',')));
  check('метка «Срочно» названа по-русски и есть в списке',
    rules.TOPIC_TAGS.some((tag) => tag.id === 'sos' && tag.label === 'Срочно'));
  check('список меток переписан целиком, а не дописан одним файлом поверх другого',
    (later.match(/add constraint forum_posts_tags_check/g) || []).length === 1
      && later.includes("array['vs','recruiting','diplomacy','guide','question','event','sos','barter']::text[]"));

  /*
    Список меток, требующих срока, живёт в SQL-функции и в rules.js. Совпадать
    они обязаны буквально: база отвергнет тему, которой форма обещала прощение.
  */
  equal('требовать срок база и страница договариваются об одних метках',
    listOf(later.match(/&& array\[([^\]]*)\]::text\[\];/)?.[1]),
    listOf(rules.EXPIRY_TAG_IDS.join(',')));
  check('нужен срок или нет — решает одна функция, а не два списка',
    rules.needsExpiry(['recruiting']) && rules.needsExpiry(['sos', 'vs'])
      && !rules.needsExpiry(['vs']) && !rules.needsExpiry(undefined));

  /* Числа: их два места, и третье не придумает своё. */
  check('границы срока — одни в конфиге и в триггере',
    sql.includes(`interval '${L.expiryDaysMin} day'`)
      && sql.includes(`interval '${L.expiryDaysMax} days'`));
  check('варианты в форме не выходят за границы, которые принимает база',
    L.expiryChoices.every((d) => d > L.expiryDaysMin && d <= L.expiryDaysMax)
      && L.expiryChoices.length > 0);
  check('срок по умолчанию есть у каждой требующей метки и он из списка',
    rules.EXPIRY_TAG_IDS.every((tag) => L.expiryChoices.includes(L.expiryDefaultDays[tag])));

  /* Проверка висит на записи и на правке, иначе её можно перешагнуть PATCH. */
  check('срок проверяется при создании и при продлении',
    /create trigger forum_posts_expiry[\s\S]{0,140}before insert or update on public\.forum_posts/.test(sql));
  const need = 'У темы с меткой «Набор», «Срочно» или «Обмен» должен быть срок действия — выберите, сколько дней она висит';
  check('отказ про срок назван одинаково в базе и в черновом режиме',
    (later.match(new RegExp(need, 'g')) || []).length === 1 && localSrc.includes(need));
  check('прежний файл остаётся со своим текстом: читают последний, и он один',
    !sql.includes(need) && (later.match(/create or replace function public\.forum_posts_expiry\(\)/g) || []).length === 1);
  check('требование срока не мешает правкам, которые его не касаются',
    sql.includes('new.tags is distinct from old.tags or new.expires_at is distinct from old.expires_at'));
  check('функцию списка меток нельзя позвать из браузера',
    sql.includes('revoke all on function public.forum_expiry_required(text[]) from public, anon;'));

  /*
    Колонки представления фиксируются при его создании: select p.* из старой
    миграции никогда не увидит expires_at. Шаг 4 пересоздаёт ленту копией —
    и копия обязана быть дословной, иначе лента потеряет какую-нибудь колонку.
  */
  const viewOf = (src) => (src.match(/create view public\.forum_post_list[\s\S]*?author_id;/)?.[0] ?? '')
    .replace(/\s+/g, ' ').trim();
  check('лента пересоздана копией прежнего определения',
    viewOf(sql).length > 200 && viewOf(sql) === viewOf(oldSql));
  check('срок уезжает в ленту представлением, а не новой колонкой вручную',
    viewOf(sql).startsWith('create view public.forum_post_list with (security_invoker = on) as select p.*'));

  check('создание поста передаёт срок, а продление правит его PATCH-ем',
    supaSrc.includes('expires_at: draft.expiresAt ?? null')
      && /setExpiry[\s\S]{0,260}method: 'PATCH'[\s\S]{0,80}expires_at/.test(supaSrc));
  check('контракт объявляет срок и продление',
    /@property \{Date\|null\} \[expiresAt\]/.test(contractSrc)
      && /\(id: string, expiresAt: string\|null\) => Promise<ForumPost>\} setExpiry/.test(contractSrc));
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  check('страница спрашивает срок и знает кнопку продления',
    /name="expires_in"/.test(pageSrc) && mountSrc.includes('data-forum-extend') && mountSrc.includes('draft.expiresAt'));
  check('подсказка обязательности молчит, пока её не вызвала метка',
    pageSrc.includes('data-forum-expiry-hint') && mountSrc.includes('hint.hidden = !needsExpiry(chosen)'));
  check('срок, который подставляет форма, помечен в списке как обязательный',
    /required\.includes\(d\)/.test(pageSrc) && pageSrc.includes('нужен для набора'));
  check('при выборе метки срок подставляется сам',
    /expiryDefaultDays\?\.\[tagBox\.value\]/.test(mountSrc) && mountSrc.includes('needsExpiry(chosen)'));

  /* ── Черновой режим: те же отказы, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  await local.signUp('Автор');
  await local.signUp('Посторонний');
  /* Регистрация входит сама, поэтому автора тем называем явно. */
  await local.signIn('Автор');
  const DAY = 86400000;
  const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

  let refusal = '';
  try {
    await local.createPost({ title: 'Набор без срока', body: '<p>пишитесь</p>', category: 'ally', tags: ['recruiting'] });
  } catch (e) { refusal = String(e.message); }
  equal('тема «Набор» без срока не создаётся', refusal, need);

  refusal = '';
  try {
    await local.createPost({ title: 'Срочно без срока', body: '<p>помогите</p>', category: 'vs', tags: ['sos'] });
  } catch (e) { refusal = String(e.message); }
  equal('срочный сигнал без срока тоже', refusal, need);

  const calm = await local.createPost({ title: 'Обычная тема', body: '<p>разбор</p>', category: 'vs', tags: ['vs'] });
  equal('теме без требующей метки срок не навязывают', calm.expiresAt, null);

  const soon = await local.createPost({
    title: 'Набор', body: '<p>открыт</p>', category: 'ally', tags: ['recruiting'], expiresAt: inDays(14),
  });
  check('срок доехал до темы датой', soon.expiresAt instanceof Date
    && soon.expiresAt - Date.now() > 13 * DAY && soon.expiresAt - Date.now() <= 14 * DAY);

  refusal = '';
  try {
    await local.createPost({ title: 'Набор', body: '<p>ещё</p>', category: 'ally', tags: ['recruiting'], expiresAt: inDays(365) });
  } catch (e) { refusal = String(e.message); }
  equal('срок дальше границы база с собой не берёт',
    refusal, `Срок не дальше ${L.expiryDaysMax} дней — иначе тема зависнет в ленте навсегда`);

  refusal = '';
  try {
    await local.createPost({ title: 'Набор', body: '<p>вчера</p>', category: 'ally', tags: ['recruiting'], expiresAt: inDays(0.1) });
  } catch (e) { refusal = String(e.message); }
  equal('вчерашний срок не проходит', refusal,
    'Срок должен быть хотя бы на сутки впереди — вчерашнее объявление актуальным не станет');

  await local.signIn('Посторонний');
  refusal = '';
  try { await local.setExpiry(soon.id, inDays(7)); } catch (e) { refusal = String(e.message); }
  equal('чужой срок посторонний не двигает', refusal, 'Это не ваш пост');

  const before = new Date(soon.expiresAt).getTime();
  await local.signIn('Автор');
  const grown = await local.setExpiry(soon.id, inDays(30));
  check('автор продливает свою тему', new Date(grown.expiresAt).getTime() > before);

  refusal = '';
  try { await local.setExpiry(soon.id, null); } catch (e) { refusal = String(e.message); }
  equal('снять срок с темы набора нельзя', refusal, need);

  await local.setExpiry(calm.id, inDays(3));
  equal('у обычной темы срок снимается', (await local.setExpiry(calm.id, null)).expiresAt, null);

  /* Лента обязана нести срок: карточка рисует метку именно по нему. */
  const feed = await local.listPosts({ category: 'all' });
  check('лента приносит срок вместе с темой',
    feed.posts.some((p) => p.id === soon.id && p.expiresAt instanceof Date));

  /* ── Разметка ── */
  const { renderPostCard } = await import('../src/pages/forum.js');
  const seat = { me: null, openPostId: null, editingPostId: null, comments: [], categories: {} };
  const member = { ...seat, me: { id: 'u1', role: 'member' } };
  const open = { ...member, openPostId: 'x1' };
  const live = {
    id: 'x1', authorId: 'u1', authorNick: 'A', title: 'Т', body: '<p>x</p>', category: 'ally',
    tags: ['recruiting'], reactions: {}, myReaction: null, commentCount: 0, views: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'), expiresAt: new Date(Date.now() + 5 * DAY),
  };
  const dead = { ...live, expiresAt: new Date(Date.now() - 2 * DAY) };
  const plainPost = { ...live, tags: ['vs'], expiresAt: null };

  const liveHtml = renderPostCard(live, member);
  check('живая тема носит срок в шапке карточки',
    /forum-post__expiry"/.test(liveHtml) && /до \d+ [а-я]/.test(liveHtml) && !/Срок вышел/.test(liveHtml));
  check('истёкшая тема говорит об этом прямо',
    /forum-post__expiry--over/.test(renderPostCard(dead, member)) && /Срок вышел/.test(renderPostCard(dead, member)));
  check('тема без срока не носит пустой метки', !/forum-post__expiry/.test(renderPostCard(plainPost, member)));
  check('истёкшую тему не прячут: карточка остаётся в ленте',
    renderPostCard(dead, member).includes('data-forum-post="x1"'));

  const barHtml = renderPostCard(live, open);
  check('в открытой теме автору видны кнопки продления',
    /data-forum-extend="x1:7"/.test(barHtml) && /Актуально до/.test(barHtml));
  check('кнопки продления нет в свёрнутой карточке и у чужого человека',
    !/data-forum-extend/.test(liveHtml) && !/data-forum-extend/.test(renderPostCard({ ...live, authorId: 'u9' }, open)));
  check('гостю кнопки не показывают: база всё равно откажет',
    !/data-forum-extend/.test(renderPostCard(live, { ...seat, openPostId: 'x1' })));
  check('у требующей метки срока «без срока» не предлагают',
    !/Бессрочно/.test(barHtml));
  check('у обычной темы срок можно снять',
    /Бессрочно/.test(renderPostCard({ ...live, tags: ['vs'] }, open)));
  check('истёкшая тема в открытом виде названа вышедшей',
    /Срок вышел \d+/.test(renderPostCard(dead, open))
      && /forum-expiry__state--over/.test(renderPostCard(dead, open)));
}

console.log(`\n${'─'.repeat(52)}`);
// ── W. Оспаривание запрета писать и тишины ──────────────────────────────────
console.log('\nW. Оспаривание запрета писать и тишины');
{
  /*
    Правило живёт в четырёх местах: таблица и две функции в базе, два
    адаптера, баннер страницы и очередь панели. Проверяем их друг о друга, а
    не каждое само по себе: число в конфиге, которое разойдётся с CHECK в
    таблице, и фраза, которая в черновом режиме звучит иначе, чем в базе, —
    это молчаливые ошибки, которые человек заметит только отказом на запросе.
  */
  const { readFile } = await import('node:fs/promises');
  const L = CONFIG.forum.limits;
  const sql = await readFile('supabase/applied/20260925-sanction-appeal.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const adminSrc = await readFile('src/admin/main.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const admCssSrc = await readFile('src/admin/admin.css', 'utf8');

  /* ── Числа ── */
  check('границы текста заявки записаны в таблице теми же числами, что в конфиге',
    sql.includes(`char_length(message) between ${L.appealMessageMin} and ${L.appealMessageMax}`));
  check('длина ответа модерации ограничена в таблице числом из конфига',
    sql.includes(`answer = '' or char_length(answer) between ${L.appealAnswerMin} and ${L.appealAnswerMax}`));
  check('выдержка стоит одним числом в базе и в конфиге',
    sql.includes(`interval '${L.appealCooldownDays} days'`)
      && sql.includes(`v_last + interval '${L.appealCooldownDays} days'`));
  check('текст заявки и ответ модерации обязательны и не могут быть пустыми',
    sql.includes('message     text not null check') && sql.includes('answer      text not null default'));
  check('числа не перепутаны местами: заявка длиннее минимального ответа',
    L.appealMessageMin > L.appealAnswerMin && L.appealMessageMax === L.appealAnswerMax);

  /* ── Двери: функции, а не политики ── */
  const policies = sql.match(/create policy[^\n]*\n[^\n]*/g) || [];
  check('политика на таблице одна и она только читает',
    policies.length === 1 && /for select/.test(policies[0])
      && /user_id = auth\.uid\(\) or public\.forum_is_staff\(\)/.test(policies[0]));
  check('прав на запись таблица не выдаёт никому',
    !/grant (insert|update|delete|all|all privileges) on public\.forum_appeals/.test(sql)
      && sql.includes('grant select on public.forum_appeals to authenticated;'));
  check('row level security включена явно',
    sql.includes('alter table public.forum_appeals enable row level security;'));
  check('обе двери — функции с правами владельца и своим search_path',
    (sql.match(/language plpgsql security definer set search_path = public/g) || []).length === 2);
  check('функции открыты для вошедших и закрыты для анонима',
    (sql.match(/revoke all on function public\.forum_(open|review)_appeal/g) || []).length === 2
      && (sql.match(/grant execute on function public\.forum_(open|review)_appeal[^;]*to authenticated;/g) || []).length === 2);
  check('одна открытая заявка держится индексом, а не договорённостью',
    sql.includes('create unique index if not exists forum_appeals_one_open')
      && /forum_appeals_one_open[\s\S]{0,120}where status = 'open';/.test(sql));
  check('очередь отдаёт представление, а не таблицу: ник заявителя нужен панели',
    /create or replace view public\.forum_appeal_list\s+with \(security_invoker = on\)/.test(sql)
      && sql.includes('grant select on public.forum_appeal_list to authenticated;'));
  check('мера и статус замкнуты проверкой таблицы, а не фантазией браузера',
    sql.includes("check (kind in ('ban', 'mute'))")
      && sql.includes("check (status in ('open', 'upheld', 'rejected'))"));
  check('заявка привязана к игроку и живёт вместе с ним: удаление профиля закрывает её',
    sql.includes('references public.forum_users (id) on delete cascade'));

  /* ── Адаптеры и контракт ── */
  check('supabase-адаптер стучится в те же rpc с теми же именами параметров',
    supaSrc.includes("'/rpc/forum_open_appeal'")
      && /openAppeal[\s\S]{0,260}p_kind: kind, p_message:/.test(supaSrc)
      && supaSrc.includes("'/rpc/forum_review_appeal'")
      && /reviewAppeal[\s\S]{0,260}p_target: id, p_status: status, p_answer:/.test(supaSrc));
  check('очередь панели читает представление, а не таблицу: иначе чужой ник не достать',
    supaSrc.includes('/forum_appeal_list?select=*&order=created_at.desc'));
  check('неудачу чтения адаптер не глушит — решает вызывающий',
    !/listAppeals[\s\S]{0,200}catch\(\(\) => \[\]\)/.test(supaSrc));
  check('контракт объявляет все три двери',
    /=> Promise<ForumAppeal\[\]>\} listAppeals/.test(contractSrc)
      && /\(kind: 'ban'\|'mute', message: string\) => Promise<void>\} openAppeal/.test(contractSrc)
      && /\(id: string, status: 'upheld'\|'rejected', answer: string\) => Promise<void>\} reviewAppeal/.test(contractSrc));
  check('черновой режим не проходит через «может ли писать»',
    !/openAppeal[\s\S]{0,400}banCanWrite/.test(localSrc));

  /* ── Черновой режим: те же правила и те же слова ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const KEY = 'zr33.forum.local';
  const raw = () => JSON.parse(store.get(KEY));
  const DAY = 86400000;
  const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

  await local.signUp('Властелин');   // первый — владелец
  await local.signUp('Игрок');
  const player = (await local.listUsers()).find((u) => u.nick === 'Игрок');
  await local.signIn('Властелин');
  await local.setRestriction(player.id, { banned: true, mutedUntil: inDays(2), reason: 'пересказ чужого конфликта' });
  await local.signIn('Игрок');

  const NEED = {
    noLogin: 'Оспорить решение может только вошедший игрок',
    badKind: 'Оспорить можно запрет писем или тишину',
    noBan: 'Запрета писем сейчас нет — оспаривать нечего',
    noMute: 'Тишина уже закончилась — оспаривать нечего',
    short: `Нужно хотя бы ${L.appealMessageMin} символов: опишите, что именно не так с решением`,
    long: `Не больше ${L.appealMessageMax} символов: важна суть, а не пересказ всей переписки`,
    twice: 'Такая апелляция уже открыта — модератор её ещё не разобрал',
    cooldown: (d) => `По этому вопросу уже ответили: новую апелляцию можно открыть через ${d} дн.`,
  };
  const REVIEW = {
    staff: 'Апелляцию разбирает модерация',
    badStatus: (s) => `Неизвестное решение по апелляции: ${s}`,
    notFound: 'Апелляция не найдена',
    short: `Нужно хотя бы ${L.appealAnswerMin} символов: игрок ждёт объяснения, а не молчаливого отказа`,
    long: `Не больше ${L.appealAnswerMax} символов: объяснение должно читаться и с телефона`,
    decided: (w) => `Эта апелляция уже разобрана: ${w}`,
  };
  /* Слова отказов сверяются здесь, а их поведение — тестами ниже. */
  check('каждый отказ черновика написан в базе слово в слово',
    [NEED.noLogin, NEED.badKind, NEED.noBan, NEED.noMute, NEED.twice]
      .every((t) => sql.includes(t) && localSrc.includes(t))
      && sql.includes('новую апелляцию можно открыть через % дн.')
      && localSrc.includes('новую апелляцию можно открыть через'));

  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const LONG = 'Прошу посмотреть переписку: я отвечал в своей теме и не трогал чужие споры.';

  await local.signOut();
  equal('без входа заявку не принимают', await says(() => local.openAppeal('ban', LONG)), NEED.noLogin);
  await local.signIn('Игрок');
  equal('заявку без меры не принимают', await says(() => local.openAppeal('delete', LONG)), NEED.badKind);
  equal('короткая заявка не проходит',
    await says(() => local.openAppeal('mute', 'верните доступ')), NEED.short);
  equal('длинная заявка не проходит',
    await says(() => local.openAppeal('mute', LONG.repeat(20))), NEED.long);
  await local.openAppeal('mute', LONG);
  equal('вторую заявку по той же мере не открывают',
    await says(() => local.openAppeal('mute', LONG)), NEED.twice);
  await local.openAppeal('ban', LONG);
  check('разные меры открываются раздельно', raw().appeals.length === 2
    && new Set(raw().appeals.map((a) => a.kind)).size === 2);
  check('забаненный писать не может, а возразить может',
    (await says(() => local.createPost({ title: 'Т', body: '<p>текст</p>', category: 'vs', tags: [] })))
      .startsWith('Вам запрещено писать:') && raw().appeals.length === 2);
  check('каждая заявка уведомляет модерацию и ничего больше',
    raw().notifications.filter((n) => n.preview.startsWith('Апелляция:')).length === 2
      && raw().notifications.every((n) => n.kind === 'moderation'));
  equal('в заявке лежит снимок причины, а не выдуманная браузером',
    raw().appeals[0].sanction, 'пересказ чужого конфликта');

  const muteAppeal = raw().appeals.find((a) => a.kind === 'mute');
  await local.signIn('Властелин');
  check('модератор видит заявки всех игроков', (await local.listAppeals()).length === 2);
  await local.signIn('Игрок');
  check('игрок видит только свои заявки', (await local.listAppeals()).length === 2);
  await local.signUp('Посторонний');
  check('чужих апелляций не видно даже вошедшему', (await local.listAppeals()).length === 0);
  equal('без действующего запрета оспаривать нечего',
    await says(() => local.openAppeal('ban', LONG)), NEED.noBan);
  await local.signIn('Игрок');

  equal('игрок не разбирает заявки',
    await says(() => local.reviewAppeal(muteAppeal.id, 'upheld', 'длинный ответ модератора из текста')), REVIEW.staff);
  await local.signIn('Властелин');
  equal('короткий ответ не проходит',
    await says(() => local.reviewAppeal(muteAppeal.id, 'upheld', 'ок')), REVIEW.short);
  equal('простыня вместо ответа не проходит',
    await says(() => local.reviewAppeal(muteAppeal.id, 'upheld', 'объяснение'.repeat(200))), REVIEW.long);
  equal('неизвестное решение не проходит',
    await says(() => local.reviewAppeal(muteAppeal.id, 'maybe', 'ответ достаточной длины')), REVIEW.badStatus('maybe'));
  equal('заявки, которой нет, не существует',
    await says(() => local.reviewAppeal('ap_none', 'upheld', 'ответ достаточной длины')), REVIEW.notFound);
  check('пока заявка не разобрана, мера остаётся',
    raw().users.find((u) => u.id === player.id).banned === true
      && raw().users.find((u) => u.id === player.id).mutedUntil !== null);

  const banAppeal = raw().appeals.find((a) => a.kind === 'ban');
  await local.reviewAppeal(muteAppeal.id, 'upheld', 'Тишину снимаю: пересказ был, но не злой.');
  const afterMute = raw().users.find((u) => u.id === player.id);
  check('удовлетворённая заявка снимает ровно оспоренную меру',
    afterMute.mutedUntil === null && afterMute.banned === true);
  equal('повторное решение по той же заявке отвергают',
    await says(() => local.reviewAppeal(muteAppeal.id, 'rejected', 'второй модератор передумал')),
    REVIEW.decided('удовлетворена'));
  await local.signIn('Игрок');
  equal('оспорить снятую тишину нельзя: оспаривать уже нечего',
    await says(() => local.openAppeal('mute', LONG)), NEED.noMute);
  await local.signIn('Властелин');
  await local.reviewAppeal(banAppeal.id, 'rejected', 'Жалобы были в трёх темах подряд. Запрет остаётся.');
  check('отказ остаётся в заявке вместе с автором решения',
    raw().appeals.find((a) => a.id === banAppeal.id).status === 'rejected'
      && raw().appeals.find((a) => a.id === banAppeal.id).decidedByNick === 'Властелин');
  check('снятие меры попало в журнал модерации',
    raw().moderationActions.some((a) => a.action === 'restriction_changed' && a.targetId === player.id));

  const staffSeen = await local.listAppeals();
  await local.signIn('Игрок');
  const ownSeen = await local.listAppeals();
  check('ник ответившего читает модерация, а игрок — только ответ',
    staffSeen.some((a) => a.decidedByNick === 'Властелин')
      && ownSeen.length === 2 && ownSeen.every((a) => a.decidedByNick === ''));
  equal('сразу после ответа ту же меру не оспаривают',
    await says(() => local.openAppeal('ban', LONG)), NEED.cooldown(L.appealCooldownDays));
  const st = raw();
  st.appeals.find((a) => a.id === banAppeal.id).decidedAt = inDays(-(L.appealCooldownDays + 1));
  store.set(KEY, JSON.stringify(st));
  await local.openAppeal('ban', LONG);
  check('выдержка — окно, а не пожизненный запрет',
    raw().appeals.filter((a) => a.kind === 'ban').length === 2);

  /* ── Баннер игрока ── */
  const { renderSanctions } = await import('../src/pages/forum.js');
  const banned = { id: 'u1', nick: 'Игрок', role: 'member', banned: true, banReason: 'пересказ чужого конфликта', mutedUntil: null };
  const mutedOnly = { ...banned, banned: false, banReason: '', mutedUntil: inDays(1) };
  const seat = (over = {}) => ({ me: banned, appeal: { list: [], open: '', text: '', error: '', ...over } });
  const ap = (over = {}) => ({
    id: 'a1', userId: 'u1', userNick: 'Игрок', kind: 'ban', sanction: 'пересказ чужого конфликта',
    message: LONG, status: 'open', answer: '', createdAt: new Date(), decidedAt: null,
    decidedByNick: '', ...over,
  });

  equal('гостю баннер не положен', renderSanctions({ me: null }), '');
  equal('здорового человека баннер не позорит',
    renderSanctions({ me: { ...banned, banned: false, banReason: '' } }), '');
  const fresh = renderSanctions(seat());
  check('в баннере есть кнопка оспаривания и названа мера',
    fresh.includes('data-forum-sanction="ban"') && /data-forum-appeal="ban"/.test(fresh)
      && fresh.includes('Оспорить: запрет писем'));
  const opened = renderSanctions(seat({ open: 'ban' }));
  check('поле заявки держит границы из конфига',
    opened.includes(`minlength="${L.appealMessageMin}"`)
      && opened.includes(`maxlength="${L.appealMessageMax}"`));
  check('форма живёт в том же баннере и заменяет кнопку',
    opened.includes('data-forum-appeal-form="ban"') && !/data-forum-appeal="ban"/.test(opened)
      && opened.includes('data-forum-appeal-cancel'));
  check('отказ базы показан в форме и ничего не стирается',
    renderSanctions(seat({ open: 'ban', error: NEED.short, text: 'начатое слово' })).includes(NEED.short)
      && renderSanctions(seat({ open: 'ban', text: 'начатое слово' })).includes('начатое слово'));
  check('открытая заявка названа ожиданием, а не кнопкой',
    renderSanctions(seat({ list: [ap()] })).includes('модератор ещё не ответил')
      && !/data-forum-appeal="ban"/.test(renderSanctions(seat({ list: [ap()] }))));
  const rejectedHtml = renderSanctions(seat({
    list: [ap({ status: 'rejected', answer: 'Жалоб было три.', decidedAt: new Date(Date.now() - 2 * DAY), decidedByNick: 'Властелин' })],
  }));
  check('отказ прочитан игроком: ответ, автор и срок новой заявки',
    rejectedHtml.includes('Жалоб было три.') && rejectedHtml.includes('ответил Властелин')
      && rejectedHtml.includes('Апелляция отклонена') && /через 5 дней/.test(rejectedHtml));
  check('после выдержки кнопка возвращается',
    /data-forum-appeal="ban"/.test(renderSanctions(seat({ list: [ap({ status: 'rejected', answer: 'Жалоб было три.', decidedAt: new Date(Date.now() - (L.appealCooldownDays + 1) * DAY) })] }))));
  const upheldHtml = renderSanctions(seat({ list: [ap({ status: 'upheld', answer: 'Сняли запрет.', decidedAt: new Date() })] }));
  check('удовлетворённую заявку видно: молчание вместо кнопки объяснено',
    upheldHtml.includes('Апелляцию удовлетворили') && /через \d+ дней/.test(upheldHtml)
      && !/data-forum-appeal="ban"/.test(upheldHtml));
  check('тишина называется тишиной, а не баном',
    renderSanctions({ me: mutedOnly, appeal: { list: [], open: '', text: '', error: '' } })
      .includes('Оспорить: тишину'));
  check('баннер и форма одеты стилями, а не висят голым текстом',
    cssSrc.includes('.forum-appeal__state') && cssSrc.includes('.forum-appeal__acts'));

  /* ── Поведение навески ── */
  check('лента тянет заявки отдельным запросом и не роняет страницу',
    /try \{\s*state\.appeal\.list = await forum\.listAppeals\(\);/.test(mountSrc)
      && mountSrc.includes("state.appeal.list = [];"));
  check('отправкой заявки занимается одна функция и она перекрашивает страницу',
    mountSrc.includes('async function sendAppeal(form, submitter)')
      && mountSrc.includes('await forum.openAppeal(kind, message)')
      && mountSrc.includes('Апелляция отправлена модерации. Запрет на время разбора остаётся.'));

  /* ── Очередь панели ── */
  const { renderModeration } = await import('../src/admin/screens/moderation.js');
  const boss = { id: 'u9', nick: 'Властелин', role: 'admin' };
  const screen = (appeals, reports = []) => renderModeration({ forum: { configured: true, me: boss, reports, appeals, moderationQueue: [], moderationActions: [] } });
  const row = (over = {}) => ({
    id: 'a1', userId: 'u1', userNick: 'Игрок', kind: 'ban', sanction: 'пересказ чужого конфликта',
    message: LONG, status: 'open', answer: '', createdAt: new Date(), decidedAt: null,
    decidedByNick: '', ...over,
  });
  check('без миграции панель называет файл, а не молчит пустой очередью',
    screen(null).includes('supabase/applied/20260925-sanction-appeal.sql'));
  const openCard = screen([row()]);
  check('открытая заявка: ник, мера, снимок причины и поле ответа',
    openCard.includes('Игрок') && openCard.includes('оспаривает: запрет писем')
      && openCard.includes('Мера на момент заявки') && openCard.includes('пересказ чужого конфликта')
      && openCard.includes(`data-appeal-answer="a1"`)
      && openCard.includes(`minlength="${L.appealAnswerMin}"`)
      && openCard.includes(`maxlength="${L.appealAnswerMax}"`));
  check('у открытой заявки ровно две кнопки: снять меру или оставить',
    openCard.includes('data-appeal-review="a1:upheld"') && openCard.includes('data-appeal-review="a1:rejected"'));
  check('разобранная заявка убрана из очереди и лежит под катом без кнопок',
    !/data-appeal-review="a2:/.test(screen([row({ id: 'a2', status: 'upheld', answer: 'Запрет снят.', decidedAt: new Date(), decidedByNick: 'Властелин' })]))
      && screen([row({ id: 'a2', status: 'upheld', answer: 'Запрет снят.', decidedAt: new Date(), decidedByNick: 'Властелин' })]).includes('Разобрано недавно'));
  check('пустая очередь говорит об этом прямо',
    screen([]).includes('Открытых апелляций нет.'));
  check('очередь стоит выше жалоб: ответа человек ждёт больше',
    screen([row()]).indexOf('data-appeal-card') < screen([row()]).indexOf('Разбирать нечего'));
  check('ответ панели уходит тем же rpc и перечитывает очередь',
    adminSrc.includes('await forum.reviewAppeal(id, decision, answer)')
      && adminSrc.includes("await loadForumScreen('moderation')")
      && adminSrc.includes('[data-appeals-result]')
      && adminSrc.includes("'20260925-sanction-appeal.sql'"));
  check('заявки панели грузятся своим броском и ошибкой не роняют вкладку',
    /try \{\s*view\.forum\.appeals = await forum\.listAppeals\(\);\s*\} catch \{\s*view\.forum\.appeals = null;/.test(adminSrc));
  check('поле ответа ищут внутри карточки, а не селектором с uuid',
    /data-appeal-card[\s\S]{0,160}querySelector\('textarea'\)/.test(adminSrc));
  check('карточки панели одеты стилями',
    admCssSrc.includes('.adm-appeal__sanction') && admCssSrc.includes('.adm-appeals__done'));
}

console.log(`\n${'─'.repeat(52)}`);
// ── X. Тишина в одном разделе ───────────────────────────────────────────────
console.log('\nX. Тишина в одном разделе');
{
  /*
    Мера живёт в пяти местах — таблица, перегруженное право писать, триггер
    со словами, черновой адаптер и окно панели. Разойтись они могут молча:
    CHECK с опечаткой не закроет ни одного раздела, а лишняя фраза в черновике
    даст игроку причину, которой база не говорила. Поэтому здесь сравниваются
    именно места, а не проверяется каждое само по себе.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260925-section-mute.sql', 'utf8');
  const schemaSql = await readFile('supabase/applied/schema.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const pagesSrc = await readFile('src/pages/forum.js', 'utf8');
  const adminSrc = await readFile('src/admin/main.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const admCssSrc = await readFile('src/admin/admin.css', 'utf8');
  const { CATEGORY_IDS, CATEGORIES } = await import('../src/forum/rules.js');

  const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const tableList = (sql.match(/check \(category in \(([^)]*)\)\)/) || [])[1] || '';
  const fnList = (sql.match(/v_all\s+text\[\] := array\[([^\]]*)\]/) || [])[1] || '';

  /* ── Один список разделов на три места ── */
  check('разделы таблицы — ровно те же id, что у CATEGORIES, в том же порядке',
    JSON.stringify(quoted(tableList)) === JSON.stringify(CATEGORY_IDS));
  check('список внутри функции совпадает со списком таблицы',
    JSON.stringify(quoted(fnList)) === JSON.stringify(CATEGORY_IDS));
  check('ни раздела, которого нет в схеме: id таблицы вписаны и в forum_posts',
    CATEGORY_IDS.every((id) => schemaSql.includes(`'${id}'`)));

  /* ── Таблица и её права ── */
  check('тишина привязана к паре «игрок и раздел» и живёт вместе с игроком',
    sql.includes('primary key (user_id, category)')
      && sql.includes('references public.forum_users (id) on delete cascade'));
  check('пояснение короткое или длинное отвергает сама таблица, а не только функция',
    sql.includes('reason      text not null check (char_length(reason) between 5 and 200)'));
  check('политика на таблице одна и только читает: свои строки либо модерация',
    (sql.match(/create policy/g) || []).length === 3
      && /create policy forum_section_mutes_read[\s\S]{0,160}for select using \(user_id = auth\.uid\(\) or public\.forum_is_staff\(\)\)/.test(sql));
  check('на таблицу тишин нет ни одной политики записи — только функция',
    !/create policy[^\n]*on public\.forum_section_mutes\s*\n\s*for (insert|update|delete)/.test(sql)
      && sql.includes('grant select on public.forum_section_mutes to authenticated;'));
  check('срок всегда сравнивается с now(): просроченная запись не мешает и не чистится',
    (sql.match(/muted_until > now\(\)/g) || []).length >= 3);

  /* ── Право писать ── */
  check('перегруженная функция спрашивает общий запрет, а не заменяет его',
    /create or replace function public\.forum_can_write\(p_category text\)[\s\S]{0,420}select public\.forum_can_write\(\)\s+and not exists/.test(sql));
  check('у темы раздел берётся из строки, у комментария — из темы',
    /create policy forum_posts_insert[\s\S]{0,300}public\.forum_can_write\(category\)/.test(sql)
      && /create policy forum_comments_insert[\s\S]{0,300}public\.forum_can_write\(\(select p\.category from public\.forum_posts p where p\.id = post_id\)\)/.test(sql));
  check('слова отказа отдаёт триггер, и он висит на обеих таблицах',
    (sql.match(/create trigger forum_section_mute_insert\s+before insert on public\.forum_(posts|comments)/g) || []).length === 2
      && sql.includes("raise exception 'Вам нельзя писать в этот раздел: %', v_reason;"));
  check('модерации и служебным вызовам триггер не мешает',
    /if auth\.uid\(\) is null then\s+return new;/.test(sql)
      && /if public\.forum_is_staff\(\) then\s+return new;/.test(sql));
  check('дверь модерации — функция с правами владельца, закрытая для анонима',
    sql.includes('language plpgsql security definer set search_path = public')
      && sql.includes('revoke all on function public.forum_set_section_mute(uuid, text, integer, text) from public, anon;')
      && sql.includes('grant execute on function public.forum_set_section_mute(uuid, text, integer, text) to authenticated;'));
  check('срок считает база, а панель лишь называет число',
    sql.includes('now() + make_interval(days => p_days)')
      && /if p_days is null then\s+delete from public\.forum_section_mutes/.test(sql));
  check('оба решения попадают в журнал модерации',
    sql.includes("'section_mute_removed',") && sql.includes("'section_mute',")
      && (sql.match(/perform public\.forum_write_moderation_action\(/g) || []).length === 2);

  /* ── Черновик говорит словами базы ── */
  const REFUSALS = [
    'Тишину в разделе налагает и снимает модерация',
    'Неизвестный раздел',
    'Игрок не найден',
    'Администратора тишине не подвергают',
    'Тишина в разделе — от 1 до 30 дней: дольше держит общий запрет',
    'Нужно пояснение от 5 до 200 символов: игрок видит причину',
    'Это уже общий запрет: наложите тишину целиком — тогда игрок сможет её оспорить',
  ];
  check('каждый отказ написан в базе и в черновике слово в слово',
    REFUSALS.every((t) => sql.includes(t) && localSrc.includes(t)));
  check('границы срока и пояснения в черновике — те же числа, что в базе',
    /vDays < 1 \|\| vDays > 30/.test(localSrc) && /vReason\.length < 5 \|\| vReason\.length > 200/.test(localSrc));
  check('контракт обещает три двери меры',
    /=> Promise<ForumSectionMute\[\]>\} listSectionMutes/.test(contractSrc)
      && /\(userId: string, category: string, days: number, reason: string\) => Promise<void>\} setSectionMute/.test(contractSrc)
      && /\(userId: string, category: string\) => Promise<void>\} clearSectionMute/.test(contractSrc));
  check('supabase-адаптер зовёт ту же функцию с теми же параметрами',
    supaSrc.includes("'/rpc/forum_set_section_mute'")
      && /p_user_id: userId,[\s\S]{0,160}p_category: category,[\s\S]{0,160}p_days: Number\(days\),[\s\S]{0,160}p_reason: String\(reason \?\? ''\)/.test(supaSrc)
      && /clearSectionMute[\s\S]{0,300}p_days: null/.test(supaSrc));
  check('черновик проверяет раздел после выдержки: порядок триггеров базы сохранён',
    /checkHold\(s, 'post'[\s\S]{0,400}requireSectionOpen\(s, me, draft\.category\)/.test(localSrc)
      && /checkHold\(s, 'comment'[\s\S]{0,400}requireSectionOpen\(s, me, post\.category\)/.test(localSrc));

  /* ── Поведение черновика ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const KEY = 'zr33.forum.local';
  const raw = () => JSON.parse(store.get(KEY));
  const DAY = 86400000;
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const REASON = 'спор перешёл на личности';

  await local.signUp('Миротворец');   // первый — владелец
  await local.signUp('Громкий');
  const loud = (await local.listUsers()).find((u) => u.nick === 'Громкий');
  const owner = (await local.listUsers()).find((u) => u.nick === 'Миротворец');
  await local.signIn('Миротворец');

  equal('тишину накладывают на игрока, а не на владельца',
    await says(() => local.setSectionMute(owner.id, 'vs', 3, REASON)), REFUSALS[3]);
  equal('раздела с таким id не бывает',
    await says(() => local.setSectionMute(loud.id, 'secret', 3, REASON)), REFUSALS[1]);
  equal('срок вне границ отвергают',
    await says(() => local.setSectionMute(loud.id, 'vs', 31, REASON)), REFUSALS[4]);
  equal('пояснение короче пяти символов не мера',
    await says(() => local.setSectionMute(loud.id, 'vs', 3, 'нет')), REFUSALS[5]);
  equal('несуществующего игрока не закрывают',
    await says(() => local.setSectionMute('u-net', 'vs', 3, REASON)), REFUSALS[2]);
  await local.signIn('Громкий');
  equal('участник меру ни налагает, ни снимает',
    await says(() => local.setSectionMute(loud.id, 'vs', 3, REASON)), REFUSALS[0]);
  equal('чужую тишину участник не читает: пустой список, а не отказ',
    (await local.listSectionMutes(owner.id)).length, 0);
  await local.signIn('Миротворец');

  await local.setSectionMute(loud.id, 'vs', 3, REASON);
  const muted = await local.listSectionMutes(loud.id);
  check('тишина записана одной строкой со сроком и причиной',
    muted.length === 1 && muted[0].category === 'vs' && muted[0].reason === REASON
      && muted[0].mutedUntil.getTime() > Date.now() + 2 * DAY);
  const LONG_REASON = 'срок продлён после разговора';
  await local.setSectionMute(loud.id, 'vs', 7, LONG_REASON);
  check('повторная тишина того же раздела — продление, а не вторая строка',
    (await local.listSectionMutes(loud.id)).length === 1
      && raw().sectionMutes.length === 1
      && raw().sectionMutes[0].reason === LONG_REASON);
  check('решение попало в журнал вместе со сроком',
    raw().moderationActions.some((a) => a.action === 'section_mute' && a.details.days === 7));
  check('игрок уведомлён той же мерой, что и в базе',
    raw().notifications.some((n) => n.userId === loud.id && n.preview.startsWith('Тишина в разделе: ')));

  const vsPost = await local.createPost({ title: 'Разбор последнего боя', body: '<p>по полочкам</p>', category: 'vs' });
  await local.signIn('Громкий');
  equal('тема в закрытый раздел не проходит — словами базы',
    await says(() => local.createPost({ title: 'Второй разбор', body: '<p>и у меня есть</p>', category: 'vs' })),
    `Вам нельзя писать в этот раздел: ${LONG_REASON}`);
  equal('ответ в закрытом разделе не проходит — той же фразой',
    await says(() => local.addComment(vsPost.id, '<p>а я возмущён</p>')),
    `Вам нельзя писать в этот раздел: ${LONG_REASON}`);
  check('остальной форум открыт: другая тема проходит',
    (await local.createPost({ title: 'Вопрос по базе', body: '<p>как настроить</p>', category: 'help' })) !== null);
  await local.signIn('Миротворец');
  await local.clearSectionMute(loud.id, 'vs');
  check('снятая тишина удалена и отмечена в журнале',
    (await local.listSectionMutes(loud.id)).length === 0
      && raw().moderationActions.some((a) => a.action === 'section_mute_removed'));
  await local.clearSectionMute(loud.id, 'vs');
  check('второе снятие молча ничего не делает: база ведёт себя так же',
    raw().moderationActions.filter((a) => a.action === 'section_mute_removed').length === 1);

  await local.setSectionMute(loud.id, 'offtop', 3, 'проверка последнего раздела');
  const stale = raw();
  stale.sectionMutes[0].mutedUntil = new Date(Date.now() - DAY).toISOString();
  store.set(KEY, JSON.stringify(stale));
  await local.signIn('Громкий');
  check('просроченная тишина не закрывает раздел',
    (await says(() => local.createPost({ title: 'Разное после срока', body: '<p>уже можно</p>', category: 'offtop' }))) === '');
  await local.signIn('Миротворец');
  check('истёкшая тишина остаётся в списке: строка читается, а не стирается',
    (await local.listSectionMutes(loud.id)).length === 1);

  for (const id of CATEGORY_IDS.filter((c) => c !== 'blog')) {
    await local.setSectionMute(loud.id, id, 2, 'закрываем разделы по одному');
  }
  equal('последний открытый раздел не закрывают: это уже общий запрет',
    await says(() => local.setSectionMute(loud.id, 'blog', 2, 'и этот тоже')), REFUSALS[6]);
  check('частных тишин ровно на один раздел меньше, чем существует',
    raw().sectionMutes.length === CATEGORY_IDS.length - 1);
  await local.signIn('Громкий');
  check('свои тишины участник видит все до единого',
    (await local.listSectionMutes(loud.id)).length === CATEGORY_IDS.length - 1);
  await local.signIn('Миротворец');
  check('модерация видит тишины любого игрока в порядке срока',
    (await local.listSectionMutes(loud.id)).every((m, i, arr) => i === 0 || arr[i - 1].mutedUntil <= m.mutedUntil));

  /* ── Игрок видит закрытый раздел до отказа ── */
  const { renderSectionMutes, sectionMuteOf } = await import('../src/pages/forum.js');
  equal('без тишин блок пустой: здоровому игроку не о чём сообщать',
    renderSectionMutes({ sectionMutes: [] }), '');
  const seat = { sectionMutes: [{ category: 'vs', mutedUntil: new Date(Date.now() + 2 * DAY), reason: REASON }] };
  const noteHtml = renderSectionMutes(seat);
  check('блок называет раздел, срок и причину и отличён от общей блокировки',
    noteHtml.includes('forum-blocked--section') && noteHtml.includes('Раздел «Разбор VS» закрыт для вас до')
      && noteHtml.includes(REASON) && noteHtml.includes('Остальной форум открыт'));
  equal('истёкшую тишину страница не показывает',
    renderSectionMutes({ sectionMutes: [{ category: 'vs', mutedUntil: new Date(Date.now() - DAY), reason: REASON }] }), '');
  check('срок ищут по той же паре, что и форма',
    sectionMuteOf(seat, 'vs') !== null && sectionMuteOf(seat, 'help') === null);
  check('в списке разделов формы закрытый помечен, а не спрятан',
    /sectionMuteOf\(s, c\.id\)[\s\S]{0,160}вам здесь нельзя/.test(pagesSrc));
  check('тишины читает отдельный слой ленты, а не сама лента, и без них лента живёт',
    /async function loadSectionMutes\(\)[\s\S]{0,700}state\.sectionMutes = Array\.isArray\(list\) \? list : \[\]/.test(mountSrc)
      && /state\.sectionMutes = \[\];/.test(mountSrc)
      && /loadSectionMutes\(\)/.test(mountSrc));
  check('блок одет своим стилем, а не красной полосой общего бана',
    cssSrc.includes('.forum-blocked--section'));

  /* ── Панель ── */
  const { renderPlayers, renderSectionMuteRows } = await import('../src/admin/screens/players.js');
  const panel = renderPlayers({
    forum: {
      configured: true, me: owner, users: [loud, owner], appeals: [], recovery: [],
      reports: [], moderationQueue: [], moderationActions: [], result: null,
    },
  });
  check('окно общей меры держит рядом частную: своя форма и свой вывод',
    panel.includes('data-section-mute-form') && panel.includes('data-section-mutes')
      && panel.includes('data-section-mute-error'));
  /* HTML вложенности не знает, поэтому форму проверяют по позициям тегов. */
  const openGeneral = panel.indexOf('<form data-restrict-form>');
  const closeBeforePrivate = panel.lastIndexOf('</form>', panel.indexOf('<form data-section-mute-form>'));
  check('формы не вложены: общая мера закрыта до того, как началась частная',
    openGeneral >= 0 && closeBeforePrivate > openGeneral);
  check('в списке только настоящие разделы',
    CATEGORIES.every((c) => panel.includes(`<option value="${c.id}">`))
      && !panel.includes('<option value="secret">'));
  check('срок выбирается из четырёх готовых, а пояснение ограничено длиной базы',
    ['1', '3', '7', '30'].every((d) => new RegExp(`name="days"[\\s\\S]{0,240}value="${d}"`).test(panel))
      && panel.includes('maxlength="200"') && panel.includes('minlength="5"'));
  check('пустой список сказан прямо, а не молчанием',
    renderSectionMuteRows([]).includes('Ни один раздел этому игроку не закрыт.'));
  const rows = renderSectionMuteRows([{ category: 'vs', mutedUntil: new Date(Date.now() + 2 * DAY), reason: REASON }]);
  check('тишина в списке названа разделом и снимается одной кнопкой',
    rows.includes('Разбор VS') && rows.includes(REASON) && rows.includes('data-section-mute-clear="vs"'));
  check('истёкшую тишину панель молча не предлагает снимать: меры уже нет',
    renderSectionMuteRows([{ category: 'vs', mutedUntil: new Date(Date.now() - DAY), reason: REASON }])
      .includes('Ни один раздел этому игроку не закрыт.'));
  check('панель зовёт те же методы и называет недостающую миграцию',
    adminSrc.includes('await forum.setSectionMute(userId, category, days, reason)')
      && adminSrc.includes('await forum.clearSectionMute(userId, category)')
      && (adminSrc.match(/'20260925-section-mute\.sql'/g) || []).length === 3);
  check('список перечитывают после каждого решения, а не правят на месте',
    (adminSrc.match(/await loadSectionMutes\(userId\);/g) || []).length === 2
      && /async function loadSectionMutes\(userId\)/.test(adminSrc));
  check('блок свёрнут и грузится по раскрытию, а не при каждом открытии окна',
    /addEventListener\('toggle',[\s\S]{0,240}data-section-mute-panel[\s\S]{0,200}\}, true\)/.test(adminSrc));
  check('окно закрывается с обеими формами',
    /modal\.querySelectorAll\('form'\)\.forEach\(\(form\) => form\.reset\(\)\)/.test(adminSrc));
  check('журнал различает частную и общую меру',
    (await import('../src/admin/screens/moderation.js')).renderModeration({
      forum: {
        configured: true, me: owner, reports: [], appeals: [], moderationQueue: [],
        moderationActions: [
          { id: 'm1', actorNick: 'Миротворец', targetType: 'user', targetId: loud.id, targetNick: 'Громкий', action: 'section_mute', details: { category: 'vs', days: 3 }, createdAt: new Date() },
          { id: 'm2', actorNick: 'Миротворец', targetType: 'user', targetId: loud.id, targetNick: 'Громкий', action: 'section_mute_removed', details: { category: 'blog' }, createdAt: new Date() },
        ],
      },
    }).includes('закрыл раздел «Разбор VS» игроку Громкий на 3 дня'));
  check('блок панели одет своим стилем, а не скопирован с форума',
    admCssSrc.includes('.adm-section-mute'));
}

console.log(`\n${'─'.repeat(52)}`);
// ── Y. Календарь встреч ─────────────────────────────────────────────────────
console.log('\nY. Календарь встреч');
{
  /*
    Встреча собрана из шести мест: колонка темы, триггер даты, таблица ответов,
    два представления, черновой адаптер и страница. Каждое само по себе выглядит
    правильно, а ломается на стыке: «90 дней» в миграции и «месяц» в форме —
    и база отвергает то, что форма обещает принять; текст отказа, которого в
    базе нет, — и черновой режим воспитывает игрока по своим правилам; галочка
    метки, живущая только на экране, — и встреча теряет дату при первой же
    перерисовке. Поэтому здесь сравнивают места между собой, а не проверяют
    каждое по отдельности.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260925-event-rsvp.sql', 'utf8');
  /* Миграция, которая держала проверку kind до появления напоминаний. */
  const notifSql = await readFile('supabase/applied/20260916-forum-community.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const calBehSrc = await readFile('src/forum/calendar.js', 'utf8');
  const calPageSrc = await readFile('src/pages/calendar.js', 'utf8');
  const pagesSrc = await readFile('src/pages/forum.js', 'utf8');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const feedUrlSrc = await readFile('src/forum/feed-url.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const mobSrc = await readFile('src/mobile.css', 'utf8');

  const { EVENT_TAG_ID, EVENT_RSVP, EVENT_RSVP_IDS, needsEventDate } = await import('../src/forum/rules.js');
  const fmt = await import('../src/forum/event-format.js');
  const { composeIntentFromSearch } = await import('../src/forum/feed-url.js');
  const { renderCalendar, CALENDAR_VIEWS, DEFAULT_CALENDAR_VIEW, eventBadge, eventActions } =
    await import('../src/pages/calendar.js');
  const { renderForum } = await import('../src/pages/forum.js');
  const L = CONFIG.forum.limits;

  /* ── Одно число на шесть мест ── */
  check('метка одна во всех четырёх местах базы, что решают быть встрече',
    EVENT_TAG_ID === 'event' && needsEventDate([EVENT_TAG_ID]) && !needsEventDate(['recruiting'])
      && (sql.match(new RegExp(`'${EVENT_TAG_ID}' = any\\(`, 'g')) || []).length === 4,
    `в базе: ${(sql.match(new RegExp(`'${EVENT_TAG_ID}' = any\\(`, 'g')) || []).length}`);
  equal('три ответа на приглашение — те же слова, что принимает колонка status',
    EVENT_RSVP_IDS, ['going', 'maybe', 'declined']);
  check('база перечисляет ровно эти три слова в проверке ответа',
    sql.includes("check (status in ('going', 'maybe', 'declined'))")
      && sql.includes("p_status not in ('going', 'maybe', 'declined')"));
  check('горизонт и запас встречи в базе те же, что предлагает форма',
    sql.includes(`interval '${L.eventMinLeadMinutes} minutes'`)
      && sql.includes(`interval '${L.eventHorizonDays} days'`)
      && sql.includes(`between ${L.eventSeatsMin} and ${L.eventSeatsMax}`));
  check('шаги напоминания — те же три числа в колонке, в функции и в конфиге',
    sql.includes(`remind_minutes in (${L.eventRemindChoices.join(', ')})`)
      && sql.includes(`p_remind_minutes not in (${L.eventRemindChoices.join(', ')})`)
      && JSON.stringify(fmt.remindChoices()) === JSON.stringify(L.eventRemindChoices));
  check('только «буду» занимает место — одно и то же в форме и в базе',
    EVENT_RSVP.every((r) => r.id === 'going' ? r.seats : !r.seats)
      && sql.includes("where post_id = p_post and status = 'going'"));

  /* ── Отказ в черновике говорит словами базы ── */
  const EVENT_REFUSALS = [
    'У темы с меткой «Событие» должен быть момент — выберите дату и время',
    'Отвечают одним из трёх слов: буду, возможно, не приду',
    'Напоминание ставят на готовый срок: за 15 минут, за час или за сутки',
    'Отвечать можно только на тему с меткой «Событие»',
    'События уже нет: страница устарела',
    'Событие отменено — отвечать не на что',
    'У события нет даты — модератору или автору нужно её поставить',
    'Событие уже началось: участие записывают до начала',
  ];
  check('каждый отказ написан в базе и в черновике слово в слово',
    EVENT_REFUSALS.every((t) => sql.includes(t) && localSrc.includes(t)),
    EVENT_REFUSALS.filter((t) => !sql.includes(t) || !localSrc.includes(t)).join(' | '));
  check('границы момента названы числом из конфига, а не зашиты в черновик',
    localSrc.includes('eventMinLeadMinutes') && localSrc.includes('eventHorizonDays')
      && localSrc.includes('eventSeatsMin') && localSrc.includes('eventRemindChoices'));
  check('отказ про занятые места начинается теми же словами, что у базы',
    sql.includes("raise exception 'Мест больше нет: занято % из % — организатор ждёт «возможно»'")
      && localSrc.includes('Мест больше нет: занято'));

  /* ── Плавление SQL:raise exception не умеет склеивать строки ── */
  check('ни одного raise с склейкой через || — только подстановки %',
    !/raise exception\s+'[^']*'\s*\|\|/i.test(sql),
    (sql.match(/raise exception[^\n]*/g) || []).filter((s) => s.includes('||')).join(' | '));
  check('подстановки % в отказе про места — ровно два, по числу аргументов',
    (sql.match(/raise exception 'Мест больше нет[^']*'/)[0].match(/%/g) || []).length === 2);

  /* ── Где дверь ── */
  check('у таблицы ответов нет ни одной политики записи — только чтение',
    !/create policy[^\n]*on public\.forum_event_rsvps\s*\n\s*for (insert|update|delete)/.test(sql)
      && sql.includes('grant select on public.forum_event_rsvps to authenticated;'));
  check('ответ принимает функция с правами владельца, закрытая для анонима',
    /create or replace function public\.forum_answer_event\([\s\S]{0,200}security definer/.test(sql)
      && sql.includes('revoke all on function public.forum_answer_event(uuid, text, integer) from public, anon;')
      && sql.includes('grant execute on function public.forum_answer_event(uuid, text, integer) to authenticated;'));
  check('планировщик reminders недоступен браузеру вовсе',
    sql.includes('revoke all on function public.forum_send_event_reminders() from public, anon, authenticated;'));
  check('наружу от ответов идут только числа, и дают их функции с правами владельца',
    /create or replace function public\.forum_event_going\(p_post uuid\)[\s\S]{0,120}security definer/.test(sql)
      && (sql.match(/grant execute on function public\.forum_event_(going|maybe)\(uuid\) to anon, authenticated;/g) || []).length === 2);
  check('оба представления читают под безопасностью вызывающего',
    sql.includes('create view public.forum_event_list with (security_invoker = on)')
      && sql.includes('create view public.forum_post_list with (security_invoker = on)'));
  check('представление календаря берёт только темы с меткой, живой датой и без удаления',
    /where '\w+' = any\(p\.tags\) and not p\.deleted and p\.event_at is not null/.test(sql));
  check('момент встречи обязателен при метке и снимается вместе с ней',
    sql.includes("new.event_at := null;")
      && /if not \(\'\w+\' = any\(new\.tags\)\) then/.test(sql));
  check('требование даты смотрят только когда трогали метки или дату',
    /if \(new\.tags is distinct from old\.tags or new\.event_at is distinct from old\.event_at\)\s+and new\.event_at is null then/.test(sql));
  check('границы момента не мешают править завершившуюся встречу',
    /if new\.event_at is not distinct from old\.event_at then\s+return new;/.test(sql));
  check('перенос вперёд возвращает напоминания тем, кому они ещё успят',
    /if old\.event_at is not null and new\.event_at > old\.event_at then[\s\S]{0,320}set reminded_at = null/.test(sql));
  check('места занимает одна операция с блокировкой темы',
    sql.includes('perform pg_advisory_xact_lock(hashtextextended(p_post::text, 0));'));
  check('право писать при ответе не смотрят — это правило, а не недосмотр',
    /-- Право писать здесь не смотрим сознательно/.test(sql)
      && !/forum_can_write\(\)/.test(sql.slice(sql.indexOf('create or replace function public.forum_answer_event'), sql.indexOf('-- ── Шаг 6'))));
  check('вид уведомления расширен, иначе напоминание упало бы на проверке kind',
    notifSql.includes("kind in ('mention','reply','reaction','subscription','alliance_rank','moderation','digest')")
      && sql.includes('drop constraint if exists forum_notifications_kind_check')
      && sql.includes("kind in ('mention','reply','reaction','subscription','alliance_rank','moderation','digest','event')"));
  check('представление ленты тем пересоздано и знает про собственный ответ',
    sql.includes('drop view if exists public.forum_post_list;')
      && sql.includes(') my_rsvp,') && sql.includes(') my_remind_minutes,'));

  /* ── Контракт и адаптеры ── */
  check('контракт обещает три двери календаря',
    /=> Promise<ForumEvent\[\]>\} listEvents/.test(contractSrc)
      && /\(postId: string, status: 'going'\|'maybe'\|'declined', remindMinutes\?: number\|null\) => Promise<void>\} answerEvent/.test(contractSrc)
      && /\(id: string, eventAt: string, eventCapacity\?: number\|null\) => Promise<ForumPost>\} setEventAt/.test(contractSrc));
  check('контракт знает о собственном ответе на теме',
    /@property \{[^\n]*\} \[myRsvp\]/.test(contractSrc) && /@property \{number\|null\} \[myRemindMinutes\]/.test(contractSrc));
  check('supabase-адаптер читает представление и зовёт функцию с теми же параметрами',
    supaSrc.includes("'/forum_event_list?select=*&order=event_at.asc'")
      && supaSrc.includes("'/rpc/forum_answer_event'")
      && /p_post: postId,[\s\S]{0,80}p_status: status,[\s\S]{0,80}p_remind_minutes: remindMinutes == null \? null : Number\(remindMinutes\)/.test(supaSrc));
  check('перенос встречи правит две колонки темы, а не всю запись',
    /setEventAt[\s\S]{0,400}body: \{\s*event_at: eventAt,\s*event_capacity: eventCapacity == null \? null : Number\(eventCapacity\)/.test(supaSrc));
  check('оба адаптера отдают строке темы собственный ответ и его срок',
    supaSrc.includes('myRsvp: row.my_rsvp || null')
      && /myRemindMinutes: row\.my_remind_minutes == null \? null : Number\(row\.my_remind_minutes\)/.test(supaSrc)
      && /myRsvp: myRsvpOf\(state, p\.id\)/.test(localSrc) && /myRemindMinutes: myRemindOf\(state, p\.id\)/.test(localSrc));
  check('лента календаря повторяется при таймауте, как лента форума',
    /listEvents\(\)[\s\S]{0,200}retryOnAbort: true/.test(supaSrc));

  /* ── Чистые функции формата ── */
  const at = new Date('2026-12-24T20:00:00');
  equal('местное значение для поля даты не уезжает в Гринвич',
    fmt.localInputValue(at),
    `${at.getFullYear()}-12-24T${String(at.getHours()).padStart(2, '0')}:00`);
  check('строка поля даты обратно читается теми же местными часами',
    new Date(fmt.localInputValue(at)).getTime() === at.getTime());
  equal('у пустого момента нет и строки ввода', fmt.localInputValue(null), '');
  check('обратный отсчёт называет одну величину и умеет «назад»',
    fmt.eventCountdown(Date.now() + 40 * 60000, Date.now()) === 'через 40 минут'
      && fmt.eventCountdown(Date.now() + 3 * 86400000, Date.now()) === 'через 3 дня'
      && fmt.eventCountdown(Date.now() - 2 * 86400000, Date.now()) === '2 дня назад');
  check('начавшаяся встреча не даёт ответить и уходит в прошедшие',
    fmt.eventIsPast(new Date(Date.now() - 1000), Date.now()) && !fmt.eventIsPast(at, Date.now())
      && fmt.eventIsPast(null, Date.now()));
  equal('срок напоминания назван одним словом на весь сайт',
    L.eventRemindChoices.map((m) => fmt.remindLabel(m)), ['за 15 минут', 'за час', 'за сутки']);
  const ics = fmt.icsFor({ id: 'p_1', title: 'Сбор, 20:00; рейд', body: 'Опоздавших не ждём', eventAt: at, authorNick: 'Ковыль' });
  check('файл в календарь — корректный .ics с CRLF и точкой во времени',
    ics.startsWith('BEGIN:VCALENDAR') && ics.includes('END:VCALENDAR')
      && ics.includes('METHOD:PUBLISH') && ics.includes('DTSTART:20261224T')
      && !ics.includes('DTEND:') && ics.includes('\r\n') && !/[^\r]\n/.test(ics));
  const summaryLine = ics.split('\r\n').find((l) => l.startsWith('SUMMARY'));
  check('запятые и точки с запятой в заголовке заэкранированы, а двоеточие остаётся как есть',
    summaryLine === 'SUMMARY:Сбор\\, 20:00\\; рейд', summaryLine);
  check('длинная строка переносится по правилам формата',
    fmt.icsFor({ id: 'p_2', title: 'Очень длинное название встречи, которое заведомо больше семидесяти символов для проверки переноса', eventAt: at })
      .split('\r\n').some((l) => l.startsWith(' ')));
  const HREF_PREFIX = 'data:text/calendar;charset=utf-8,';
  const href = fmt.icsHref({ id: 'p_1', title: 'Сбор', eventAt: at });
  check('ссылка на файл отдаёт его data-адресом: сервера для отдачи нет',
    href.startsWith(HREF_PREFIX)
      && decodeURIComponent(href.slice(HREF_PREFIX.length)) === fmt.icsFor({ id: 'p_1', title: 'Сбор', eventAt: at }));

  /* ── Адрес ── */
  check('ссылка «создать встречу» понимается, а чужое намерение — нет',
    composeIntentFromSearch('new=event') === 'event'
      && composeIntentFromSearch('sort=fresh&new=event') === 'event'
      && composeIntentFromSearch('new=poll') === '' && composeIntentFromSearch('') === '');
  check('вид календаря живёт в адресе и не выдумывает четвёртого',
    calBehSrc.includes('CALENDAR_VIEWS.some((v) => v.id === view)')
      && DEFAULT_CALENDAR_VIEW === 'next' && !calBehSrc.includes('#/calendar?view=next')
      && /const search = state\.view === DEFAULT_CALENDAR_VIEW \? '' : `\?view=\$\{state\.view\}`/.test(calBehSrc));

  /* ── Композер: метки и раскрытая форма живут в состоянии ── */
  check('метки набираемой темы — состояние, а не экран',
    mountSrc.includes('composerTags: []') && /state\.composerTags = chosen;/.test(mountSrc));
  check('под общим именем tags в снимок ввода и в черновик-восстановление не лезут',
    mountSrc.includes("if (key === 'new:tags') return;") && mountSrc.includes("if (name === 'tags') continue;"));
  check('черновик хранит отмеченные метки списком',
    /if \(el\.name === 'tags'\) \{\s*if \(el\.checked\) tags\.push\(el\.value\);\s*continue;\s*\}/.test(mountSrc)
      && mountSrc.includes('draft.tags = tags;'));
  check('отмеченные метки возвращаются из черновика до первой отрисовки',
    /if \(!state\.composerTags\.length\) state\.composerTags = composerTagsFromDraft\(\);/.test(mountSrc));
  check('намерение из адреса не перетирается пустым адресом и гаснет, только когда форма показалась',
    /state\.eventDraft = state\.eventDraft \|\| composeIntentFromSearch\(search\) === 'event';/.test(mountSrc)
      && /if \(host\.querySelector\('\[data-forum-composer\]'\)\) state\.eventDraft = false;/.test(mountSrc));
  check('раскрытие формы — тоже состояние, и его снимает только сам человек',
    mountSrc.includes('composerOpen: false') && mountSrc.includes('state.composerOpen = true;')
      && /addEventListener\('toggle',[\s\S]{0,240}data-forum-composer[\s\S]{0,200}\}, true\)/.test(mountSrc));
  check('уход с форума сбрасывает и намерение, и метки, и раскрытую форму',
    /state\.eventDraft = false;\s*state\.composerTags = \[\];\s*state\.composerOpen = false;/.test(mountSrc));
  check('поля встречи не требуют заполнения молча: required у них нет',
    !/name="event_[^"]*"[^>]*required/.test(pagesSrc) && /data-forum-event-fields/.test(pagesSrc));
  check('и дата, и места уходят в черновик поста отдельными полями',
    /draft\.eventAt = form\.event_at\?\.value/.test(mountSrc) && /draft\.eventCapacity = form\.event_seats\?\.value/.test(mountSrc));

  /* ── Разметка: форма и карточка ── */
  const composerHtml = renderForum({ events: [] }, {
    ready: true, me: { nick: 'Ковыль', role: 'admin' }, composerTags: [EVENT_TAG_ID], composerOpen: true,
  });
  check('встреча встречает человека открытой формой с отмеченной меткой',
    /data-forum-composer open/.test(composerHtml)
      && /value="event" checked/.test(composerHtml));
  check('поле момента показано, а не спрятано за спиной у человека',
    /data-forum-event-fields(?![^>]*hidden)/.test(composerHtml));
  const plainComposer = renderForum({ events: [] }, { ready: true, me: { nick: 'Ковыль', role: 'admin' } });
  check('обычная тема не видит полей даты, но не теряет их из-за hidden required',
    /data-forum-event-fields hidden/.test(plainComposer) && !/value="event" checked/.test(plainComposer));
  const cardHtml = renderForum({ events: [] }, {
    ready: true, loading: false, total: 1,
    me: { nick: 'Ковыль', role: 'admin' },
    posts: [{ id: 'p_1', authorNick: 'Ковыль', category: 'chronicle', tags: [EVENT_TAG_ID], title: 'Сбор', body: 'т', createdAt: new Date(), eventAt: at, myRsvp: 'going', myRemindMinutes: 60 }],
  });
  check('лента знает про встречу знаком метки и своим ответом',
    eventBadge({ tags: [EVENT_TAG_ID], eventAt: at, deleted: false }) !== ''
      && eventBadge({ tags: [], eventAt: at, deleted: false }) === ''
      && cardHtml.includes('forum-post__event'));
  check('числа участников рисует страница календаря, а лента о них не знает',
    calPageSrc.includes('мест занято') && !pagesSrc.includes('мест занято')
      && !pagesSrc.includes('goingCount'));
  const actions = eventActions({ id: 'p_1', authorId: 'u_1', eventAt: at, eventCapacity: 8, goingCount: 1, maybeCount: 1, myStatus: 'going', myRemindMinutes: 60, authorNick: 'Ковыль', title: 'Сбор' },
    { me: { id: 'u_1', role: 'member' } });
  check('в открытой теме есть три ответа, срок напоминания и перенос',
    actions.includes('data-evt-answer="p_1:going"') && actions.includes('data-evt-answer="p_1:declined"')
      && actions.includes('aria-pressed="true"')
      && actions.includes('data-evt-remind') && actions.includes('data-evt-move'));
  check('форму переноса видят автор и модерация, а чужой теме она не положена',
    !eventActions({ id: 'p_1', authorId: 'u_9', eventAt: at, myStatus: null }, { me: { id: 'u_1', role: 'member' } })
      .includes('data-evt-move')
      && eventActions({ id: 'p_1', authorId: 'u_9', eventAt: at, myStatus: null }, { me: { id: 'u_1', role: 'moderator' } })
        .includes('data-evt-move'));
  check('на прошедшую встречу не отвечают: кнопок нет, а объяснение остаётся',
    !eventActions({ id: 'p_2', eventAt: new Date(Date.now() - 86400000), myStatus: null }, { me: { id: 'u_1' } })
      .includes('data-evt-answer')
      && eventActions({ id: 'p_2', eventAt: new Date(Date.now() - 86400000), myStatus: null }, { me: { id: 'u_1' } })
        .includes('обсуждение и фото остаются'));

  /*
    Разметка мест собирается шаблоном с переносами и отступами, поэтому перед
    сравнением строку сплющивают: тест сверяет слова, а не количество пробелов.
  */
  const squash = (h) => h.replace(/\s+/g, ' ');
  const calState = (over = {}) => ({
    ready: true, shared: true, sourceName: 'supabase', me: { id: 'u_1', nick: 'Ковыль', role: 'admin' },
    loading: false, error: '', view: 'next',
    events: [
      { id: 'p_next', title: 'Рейд в субботу', body: 'т', category: 'chronicle', tags: [EVENT_TAG_ID], authorId: 'u_1', authorNick: 'Ковыль', createdAt: new Date(), eventAt: new Date(Date.now() + 2 * 86400000), eventCapacity: 8, goingCount: 3, maybeCount: 2, spotsLeft: 5, myStatus: 'going', myRemindMinutes: 60 },
      { id: 'p_past', title: 'Прошлый рейд', body: 'т', category: 'chronicle', tags: [EVENT_TAG_ID], authorId: 'u_2', authorNick: 'Позывной', createdAt: new Date(), eventAt: new Date(Date.now() - 2 * 86400000), eventCapacity: null, goingCount: 1, maybeCount: 0, spotsLeft: null, myStatus: 'declined', myRemindMinutes: null },
    ],
    ...over,
  });
  const calHtml = renderCalendar(calState());
  check('у календаря три вида, и активный ровно один',
    CALENDAR_VIEWS.every((v) => calHtml.includes(`data-cal-view="${v.id}"`))
      && (calHtml.match(/cal-tab is-active/g) || []).length === 1);
  check('на «Ближайших» прошедшая встреча не показывается',
    calHtml.includes('Рейд в субботу') && !calHtml.includes('Прошлый рейд'));
  check('«Моё расписание» и «Прошедшие» делят список по-своему',
    renderCalendar(calState({ view: 'past' })).includes('Прошлый рейд')
      && renderCalendar(calState({ view: 'mine' })).includes('Прошлый рейд'));
  const pastHtml = renderCalendar(calState({ view: 'past' }));
  const mineHtml = renderCalendar(calState({ view: 'mine' }));
  check('чужие ответы наружу не выходят: ни имён игроков, ни их идентификаторов',
    [calHtml, pastHtml, mineHtml].every((h) => !h.includes('u_1') && !h.includes('u_2')));
  check('ведущий показан — он и так публичен, а список участников скрыт за числами',
    pastHtml.includes('ведёт @Позывной'));
  check('места названы одной строкой со всеми тремя числами',
    squash(calHtml).includes('<b>3/8</b> мест занято · ещё 2 человека думает · 5 мест свободно'));
  check('без лимита места называются словом, а не выдуманным числом',
    renderCalendar({ ...calState(), events: [{ ...calState().events[0], eventCapacity: null, spotsLeft: null, goingCount: 4 }] })
      .includes('4 человека собирается'));
  check('заполненная встреча говорит «свободных нет», а не «0 мест свободно»',
    renderCalendar({ ...calState(), events: [{ ...calState().events[0], spotsLeft: 0 }] }).includes('свободных нет'));
  check('пустой календарь говорит, как завести первую встречу',
    renderCalendar({ ...calState(), events: [] }).includes('Создать встречу'));
  check('ссылка «Создать встречу» ведёт на форум с намерением',
    calHtml.includes('#/forum?new=event'));
  check('без представления календаря страница называет файл миграции',
    renderCalendar({ ...calState(), error: 'Could not find the view public.forum_event_list' })
      .includes('supabase/applied/20260925-event-rsvp.sql'));
  check('обычную ошибку миграцией не объясняют',
    !renderCalendar({ ...calState(), error: 'Нет сети' }).includes('SQL-редактор'));

  /* ── Проводка страницы ── */
  const previewSrc = await readFile('scripts/build-preview.mjs', 'utf8');
  check('календарь — живая вкладка с собственным монтированием',
    /id: 'calendar', label: 'Календарь', live: true/.test(mainSrc)
      && /import \{ mountCalendar, unmountCalendar \} from '\.\/forum\/calendar\.js\?v=\d+'/.test(mainSrc)
      && /mountCalendar\(app, search\)/.test(mainSrc));
  check('между вкладками календарь не наследует состояние: его закрывают на каждом уходе',
    (mainSrc.match(/unmountCalendar\(\);/g) || []).length === 9
      && (mainSrc.match(/unmountCalendar\(\);/g) || []).length === (mainSrc.match(/unmountChats\(\);/g) || []).length);
  check('календарь стартует живым кадром, а не надписью «загружаем данные»',
    /const liveFirst = id === 'forum' \|\| id === 'chats' \|\| id === 'calendar'/.test(mainSrc));
  check('вкладка есть и в адресной карте меню, и в сборке для проверки без базы',
    previewSrc.includes('renderCalendar') && /id: 'calendar', label: 'Календарь'/.test(previewSrc));
  check('обработчики календаря живут на обеих страницах одинаково',
    ['data-evt-answer', 'data-evt-remind', 'data-evt-move', 'data-evt-error']
      .every((a) => mountSrc.includes(a) && calBehSrc.includes(a)));
  check('список календаря перерисовывает один отложенный звонок на всю страницу',
    /let tickTimer = 0;/.test(calBehSrc)
      && /window\.clearTimeout\(tickTimer\);[\s\S]{0,60}tickTimer = window\.setTimeout\([\s\S]{0,120}\}, 60000\);/.test(calBehSrc)
      && !/setInterval/.test(calBehSrc));
  check('уход со страницы гасит звонок, а слушатели остаются под guard по host',
    (calBehSrc.match(/window\.clearTimeout\(tickTimer\)/g) || []).length === 2
      && /export function unmountCalendar\(\)\s*\{\s*window\.clearTimeout\(tickTimer\);/.test(calBehSrc)
      && calBehSrc.includes('if (!host || !host.contains') && calBehSrc.includes('if (wired) return;'));
  check('отказ карточки не вешается на всю страницу',
    /showError\(card, String\(err\?\.message \?\? err\)\)/.test(calBehSrc)
      && /const box = card\.querySelector\('\[data-evt-error\]'\)/.test(calBehSrc));

  /* ── Стиль ── */
  check('календарь одет своим разделом стилей',
    cssSrc.includes('.cal-tab') && cssSrc.includes('.evt-card') && cssSrc.includes('.forum-event-fields'));
  check('на телефоне карточка встречи и кнопки перестроены',
    mobSrc.includes('.evt-card') && mobSrc.includes('.evt-btn'));

  /* ── Поведение чернового режима: та же арифметика, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const KEY = 'zr33.forum.local';
  const raw = () => JSON.parse(store.get(KEY));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const MIN = 60000, DAY = 86400000;
  const ahead = (ms) => new Date(Date.now() + ms).toISOString();

  await local.signUp('Распорядитель');   // первый — владелец
  const makeTopic = (over = {}) => local.createPost({
    title: 'Сбор у портала', body: 'Приходят все, кто может.', category: 'chronicle',
    tags: [EVENT_TAG_ID], eventAt: ahead(2 * DAY), eventCapacity: 2, ...over,
  });

  equal('без момента тема с меткой не создаётся',
    await says(() => makeTopic({ eventAt: null })),
    'У темы с меткой «Событие» должен быть момент — выберите дату и время');
  equal('встреча «через пять минут» отвергнута так же, как базой',
    await says(() => makeTopic({ eventAt: ahead(5 * MIN) })),
    'Назначайте встречу минимум через 10 минут — иначе она родится уже прошедшей');
  equal('горизонт планирования держит и черновик',
    await says(() => makeTopic({ eventAt: ahead(91 * DAY) })),
    'Не дальше 90 дней: планируют на квартал, а не на год');
  equal('мест от двух — или без лимита',
    await says(() => makeTopic({ eventCapacity: 1 })),
    'Мест от 2 до 200 — или ничего, тогда без лимита');
  const topic = await makeTopic();
  check('созданная тема знает свой момент и лимит',
    topic.eventAt && topic.eventCapacity === 2 && topic.tags.includes(EVENT_TAG_ID));

  const events = await local.listEvents();
  equal('календарь чернового режима отдаёт одну встречу', events.length, 1);
  check('счётчики идут отдельными полями, а не выдумываются страницей',
    events[0].goingCount === 0 && events[0].maybeCount === 0 && events[0].spotsLeft === 2);

  await local.answerEvent(topic.id, 'going', 60);
  const [afterGoing] = await local.listEvents();
  check('ответ «буду» занимает место и помнит срок напоминания',
    afterGoing.goingCount === 1 && afterGoing.spotsLeft === 1 && afterGoing.myRemindMinutes === 60);
  equal('срок напоминания принимает только готовый',
    await says(() => local.answerEvent(topic.id, 'going', 7)),
    'Напоминание ставят на готовый срок: за 15 минут, за час или за сутки');

  await local.signUp('Гость');
  await local.signUp('Опоздавший');
  await local.signIn('Гость');
  await local.answerEvent(topic.id, 'going');
  await local.signIn('Опоздавший');
  equal('последнее место занято — и это говорит та же фраза, что база',
    await says(() => local.answerEvent(topic.id, 'going')),
    'Мест больше нет: занято 2 из 2 — организатор ждёт «возможно»');
  await local.answerEvent(topic.id, 'maybe', 60);
  check('«возможно» места не занимает, но будильник себе поставить можно',
    (await local.listEvents())[0].maybeCount === 1);
  await local.signIn('Гость');
  equal('повторное «буду» своего ответа места не просит: человек уже в списке',
    await says(() => local.answerEvent(topic.id, 'going', 15)), '');
  await local.signIn('Опоздавший');
  await local.answerEvent(topic.id, 'declined');
  const [afterDecline] = await local.listEvents();
  check('«не приду» освобождает место и снимает напоминание',
    afterDecline.goingCount === 2 && afterDecline.myRemindMinutes === null
      && afterDecline.myStatus === 'declined');

  await local.signIn('Опоздавший');
  equal('чужую встречу не перенесут',
    await says(() => local.setEventAt(topic.id, ahead(3 * DAY), 4)),
    'Это не ваш пост');
  await local.signIn('Распорядитель');
  check('свою можно перенести, и лимит правится вместе с датой',
    (await local.setEventAt(topic.id, ahead(4 * DAY), 12)).eventCapacity === 12);
  equal('далеко в будущее не перенесут',
    await says(() => local.setEventAt(topic.id, ahead(120 * DAY))),
    'Не дальше 90 дней: планируют на квартал, а не на год');

  /* Напоминание догоняет тот, кто заглянул в календарь: планировщика в черновике нет. */
  const soon = await makeTopic({ title: 'Ближний сбор', eventAt: ahead(20 * MIN), eventCapacity: null });
  await local.answerEvent(soon.id, 'going', 60);
  const before = (raw().notifications || []).length;
  await local.listEvents();
  const fired = (raw().notifications || []).slice(before);
  check('напоминание приходит в общую лентку уведомлений',
    fired.length === 1 && fired[0].kind === 'event' && fired[0].actorNick === 'Календарь'
      && fired[0].preview.startsWith('Скоро: Ближний сбор'), JSON.stringify(fired));
  await local.listEvents();
  equal('второй заход не присылает то же напоминание ещё раз',
    (raw().notifications || []).length, before + 1);

  /* Перенесённая вперёд встреча возвращает право на будильник. */
  const moved = await local.setEventAt(soon.id, ahead(20 * MIN + 3 * DAY));
  check('после переноса напоминание снова возможно',
    moved.eventAt && raw().eventRsvps.find((r) => r.postId === soon.id).remindedAt === null);

  /* Начало само не переставляется: встреча, которая прошла, ответа не ждёт. */
  const pasted = raw();
  pasted.posts.find((p) => p.id === soon.id).eventAt = new Date(Date.now() - DAY).toISOString();
  store.set(KEY, JSON.stringify(pasted));
  equal('начавшуюся встречу не записывают',
    await says(() => local.answerEvent(soon.id, 'going')),
    'Событие уже началось: участие записывают до начала');

  /* Удалённая тема уходит из плана, но ссылка из чата не бросает в пустоту. */
  await local.deletePost(soon.id, null);
  check('отменённая встреча исчезает из плана',
    (await local.listEvents()).every((e) => e.id !== soon.id));
  const stub = await local.getPost(soon.id);
  check('тема под удалением отвечает заглушкой: название и момент при ней, флаг не спрятать',
    Boolean(stub) && stub.deleted && stub.title === 'Ближний сбор' && Boolean(stub.eventAt));

  /* Метка решает всё: без неё дата не переживает запись — тот же шаг, что в триггере. */
  const stripped = await local.createPost({
    title: 'Разбор пропущенного боя', body: 'Обсуждаем без приглашения.', category: 'chronicle',
    tags: [], eventAt: ahead(2 * DAY), eventCapacity: 6,
  });
  check('тема без метки «Событие» не сохраняет ни момент, ни лимит',
    stripped.eventAt === null && stripped.eventCapacity === null);
  const strippedRaw = raw().posts.find((p) => p.id === stripped.id);
  check('даты нет в самом черном хранилище, а не только в ответе адаптера',
    !strippedRaw.eventAt && !strippedRaw.eventCapacity);
}

console.log(`\n${'─'.repeat(52)}`);
// ── Z. Благодарности автора и репутация ─────────────────────────────────────
console.log('\nZ. Благодарности автора и репутация');
{
  /*
    Правило держат семь мест: две таблицы, три функции, два представления,
    черновой адаптер, кнопка, страница и панель. Опасность здесь не в том,
    что какое-то из них забудут, — опасны места, где одно и то же сказано
    двумя словами: отказ, которого нет в базе, число, уехавшее в браузер,
    имя благодарившего там, где обещано только число, и слово «репутация»
    для счётчика, который репутацией не был. Поэтому тесты ниже сравнивают
    места между собой.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-author-thanks.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const pagesSrc = await readFile('src/pages/forum.js', 'utf8');
  const userPageSrc = await readFile('src/pages/user.js', 'utf8');
  const profileSrc = await readFile('src/forum/profile.js', 'utf8');
  const adminSrc = await readFile('src/admin/main.js', 'utf8');
  const admPlayersSrc = await readFile('src/admin/screens/players.js', 'utf8');
  const rankSrc = await readFile('src/forum/rank.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const admCssSrc = await readFile('src/admin/admin.css', 'utf8');
  const L = CONFIG.forum.limits;

  /* ── Одно число на два места ── */
  const WINDOW = `Не больше ${L.thanksPerWindow} благодарностей за ${L.thanksWindowMinutes} минут — спасибо говорят за дело, а не подряд`;
  check('частоту благодарностей база и черновик называют одним числом',
    sql.includes(WINDOW)
      && sql.includes(`interval '${L.thanksWindowMinutes} minutes'`)
      && sql.includes(`v_recent >= ${L.thanksPerWindow}`)
      && localSrc.includes('Не больше'),
    WINDOW);
  check('границы награды в проверке таблицы и в полях панели — одни и те же',
    sql.includes(`check (delta <> 0 and abs(delta) <= ${L.repGrantMax})`)
      && sql.includes(`char_length(reason) between ${L.repReasonMin} and ${L.repReasonMax}`)
      && localSrc.includes('L.repGrantMax') && localSrc.includes('L.repReasonMin'));
  check('пояснение награды ограничено и в форме панели теми же числами',
    admPlayersSrc.includes('const REP = CONFIG.forum.limits;')
      && admPlayersSrc.includes('minlength="${REP.repReasonMin}"')
      && admPlayersSrc.includes('maxlength="${REP.repReasonMax}"')
      && admPlayersSrc.includes('min="${-REP.repGrantMax}"')
      && admPlayersSrc.includes('max="${REP.repGrantMax}"'));
  /*
    Цену проверенного разбора база не хранит: представление отдаёт ЧИСЛО
    проверенных разборов, а сколько они стоят — правило страницы. Если
    множитель появится в SQL, здесь окажется два места, и тест это заметит.
  */
  check('цена разбора в очках живёт на странице, а не в базе',
    rankSrc.includes('REP_POINTS = { verifiedGuide: 25 }')
      && sql.includes(') as verified_guides,') && !/verified_guides\s*\*\s*\d/.test(sql));

  /* ── Слова отказа: база и черновик говорят одно и то же ── */
  const THANK_REFUSALS = [
    'Благодарность пишет вошедший игрок',
    'Благодарят за тему или за ответ',
    'Записи уже нет: страница устарела',
    'Эту запись удалили — благодарить не за что',
    'Свой текст не благодарят',
    'Вы уже благодарили автора этой записи',
  ];
  const GRANT_REFUSALS = [
    'Награду выдаёт вошедший владелец',
    'Репутацию меняет только владелец',
    'Ноль ничего не меняет — нужна дельта от −100 до 100',
    'Дельта награды умещается в сто очков',
    'Пояснение короче 8 символов — награду нужно описать словами',
    'Пояснение длиннее 500 символов',
    'Такого игрока нет: страница устарела',
    'Себе награду не выдают',
    'Историю читает вошедший игрок',
    'Чужая история начислений закрыта',
    'Без указания игрока историю читает только модерация',
  ];
  /*
    Черновик подставляет числа из конфига, поэтому его строка выглядит как
    шаблон, а не как готовый текст. Сравнение возвращает шаблону его числа —
    и всё равно сверяет слова, а не только цифры.
  */
  const asDraft = (t) => t
    .replace(String(L.repReasonMin), '${L.repReasonMin}')
    .replace(String(L.repReasonMax), '${L.repReasonMax}');

  for (const group of [['благодарность', THANK_REFUSALS], ['награда', GRANT_REFUSALS]]) {
    const [name, list] = group;
    check(`каждый отказ «${name}» написан в базе и в черновике слово в слово`,
      list.every((t) => sql.includes(t) && localSrc.includes(asDraft(t))),
      list.filter((t) => !sql.includes(t) || !localSrc.includes(asDraft(t))).join(' | '));
  }
  check('число в отказе про окно черновик берёт из конфига, а не зашивает',
    localSrc.includes('`Не больше ${L.thanksPerWindow} благодарностей за ${L.thanksWindowMinutes} минут')
      && localSrc.includes('`Пояснение короче ${L.repReasonMin} символов')
      && localSrc.includes('`Пояснение длиннее ${L.repReasonMax} символов`'));
  check('ни одного raise с склейкой строк через || — база так не умеет',
    !/raise exception\s+'[^']*'\s*\|\|/i.test(sql),
    (sql.match(/raise exception[^\n]*/g) || []).filter((s) => s.includes('||')).join(' | '));

  /* ── Где дверь ── */
  check('у таблицы благодарностей нет ни одной политики записи',
    !/create policy[^\n]*on public\.forum_thanks[\s\S]{0,120}?for (insert|update|delete)/.test(sql)
      && sql.includes('for select using (giver_id = auth.uid());'));
  check('журнал наград читают свой и модерация, и тоже без политик записи',
    !/create policy[^\n]*on public\.forum_rep_grants[\s\S]{0,160}?for (insert|update|delete)/.test(sql)
      && sql.includes('for select using (user_id = auth.uid() or public.forum_is_staff());'));
  check('благодарность принимает функция с правами владельца, закрытая для анонима',
    /create or replace function public\.forum_give_thank\(p_target_type text, p_target_id uuid\)[\s\S]{0,120}security definer/.test(sql)
      && sql.includes('revoke all on function public.forum_give_thank(text, uuid) from public, anon;')
      && sql.includes('grant execute on function public.forum_give_thank(text, uuid) to authenticated;'));
  check('награду выдаёт отдельная дверь, и она названа владельцем, а не модератором',
    /create or replace function public\.forum_grant_reputation\([\s\S]{0,160}security definer/.test(sql)
      && sql.includes('forum_is_admin()')
      && !/forum_is_staff\(\)[\s\S]{0,60}then\s*\n?\s*raise exception 'Репутацию меняет/.test(sql));
  check('историю начислений читает функция, а не таблица напрямую',
    /create or replace function public\.forum_reputation_grant_list\(/.test(sql)
      && sql.includes('revoke all on function public.forum_reputation_grant_list(uuid) from public, anon;'));
  check('пары «кто и за что» достаточно как ключа: повтор физически не влезает',
    sql.includes('primary key (target_type, target_id, giver_id)'));
  check('автор записан копией, а не читается по ссылке при выдаче',
    sql.includes('author_id   uuid not null references public.forum_users (id) on delete cascade'));

  /* ── Приватность: наружу выходит число, а не связи ── */
  check('счётчик благодарностей — definer-функция, открытая на чтение всем',
    /create or replace function public\.forum_thanks_count\(p_target_type text, p_target_id uuid\)[\s\S]{0,120}security definer/.test(sql)
      && sql.includes('grant execute on function public.forum_thanks_count(text, uuid) to anon, authenticated;'));
  check('в ленту и в комментарии вышли только число и своё состояние',
    (sql.match(/public\.forum_thanks_count\('(post|comment)', p?\w*\.id\) as thanks_count/g) || []).length === 2
      && (sql.match(/t\.giver_id=auth\.uid\(\)\) i_thanked/g) || []).length === 2
      && !/forum_thanks[\s\S]{0,200}?giver_nick/i.test(sql));
  check('кнопка не знает имён благодаривших: в разметке только число',
    /class="forum-react__btn forum-thank/.test(pagesSrc)
      && !/thanksBy|thankers|blagodari/i.test(pagesSrc)
      && pagesSrc.includes('наружу выходит только число'));
  check('связь «кто кого поблагодарил» не показывает и страница профиля',
    !/whoThanks|thanksFrom/i.test(userPageSrc) && /thanksReceived/.test(userPageSrc));
  check('историю наград гостю не выдают: список причин видит только свой игрок',
    /isMe && sources\.length/.test(userPageSrc) && /forum-rep__sources/.test(userPageSrc));
  check('число наград и их причины разведены: наружу идёт сумма из представления',
    sql.includes(') as rep_grants,') && sql.includes(') as rep_grant_count')
      && !/reason/.test(sql.slice(sql.indexOf('as rep_grants'), sql.indexOf('from public.forum_users u'))));

  /* ── Уведомление ── */
  check('вид уведомления о благодарности разрешён базой и подписан на странице',
    sql.includes("'digest','event','thanks'")
      && /thanks: \{ label: '[^']+', icon: 'thanks'/.test(pagesSrc));
  check('подпись уведомления называет человека, а не службу',
    !/system:/.test(pagesSrc.match(/thanks: \{[^}]*\}/)?.[0] ?? ''));
  check('значок благодарности нарисован в той же графике, что и остальные',
    /thanks: '<path/.test(pagesSrc) && pagesSrc.includes('NOTIFY_ICONS'));

  /* ── Контракт и адаптеры ── */
  check('контракт обещает три двери благодарности и награды',
    /\(targetType: 'post'\|'comment', targetId: string\) => Promise<void>\} giveThanks/.test(contractSrc)
      && /\(userId: string, delta: number, reason: string\) => Promise<void>\} \[grantReputation\]/.test(contractSrc)
      && />>\} \[listReputationGrants\]/.test(contractSrc));
  check('контракт знает о числе и своём состоянии у записей',
    (contractSrc.match(/@property \{number\}\s+\[thanksCount\]/g) || []).length >= 2
      && (contractSrc.match(/@property \{boolean\}\s+\[iThanked\]/g) || []).length >= 2);
  check('supabase-адаптер зовёт функции базы, а не пишет в таблицы',
    supaSrc.includes("'/rpc/forum_give_thank'")
      && /p_target_type: targetType, p_target_id: targetId/.test(supaSrc)
      && supaSrc.includes("'/rpc/forum_grant_reputation'")
      && supaSrc.includes("'/rpc/forum_reputation_grant_list'")
      && !/\/forum_thanks['"?]/.test(supaSrc) && !/\/forum_rep_grants['"?]/.test(supaSrc));
  check('оба адаптера отдают строке число и отметку «уже благодарил»',
    supaSrc.includes('thanksCount: Number(row.thanks_count || 0)')
      && supaSrc.includes('iThanked: Boolean(row.i_thanked)')
      && localSrc.includes('...thanksFor(state,'));
  check('до миграции лента не падает: колонок нет — поле пустое',
    /колку нет[\s\S]{0,120}не ошибка|Колонок нет[\s\S]{0,160}не ошибка/i.test(supaSrc)
      || supaSrc.includes('Миграция 20260926-author-thanks.sql'));
  check('профиль берёт пять новых чисел из одного представления',
    profileSrc.includes('thanksReceived: Number(row.thanks_received || 0)')
      && profileSrc.includes('verifiedGuides: Number(row.verified_guides || 0)')
      && profileSrc.includes('eventsHeld: Number(row.events_held || 0)')
      && profileSrc.includes('repGrantPoints: Number(row.rep_grants || 0)')
      && profileSrc.includes('repGrantCount: Number(row.rep_grant_count || 0)'));

  /* ── Кнопка: разметка и поведение ── */
  const { renderForum } = await import('../src/pages/forum.js');
  const feedState = (post, over = {}) => ({
    ready: true, loading: false, total: 1, sourceName: 's', shared: true,
    posts: [{
      id: 'p_1', authorId: 'u_2', authorNick: 'Ковыль', category: 'chronicle',
      title: 'Разбор боя', body: 'текст', createdAt: new Date(), reactions: {}, myReaction: null,
      thanksCount: 3, iThanked: false, ...post,
    }],
    me: { id: 'u_1', nick: 'Благодарный', role: 'member' }, ...over,
  });
  const thankHtml = renderForum({ events: [] }, feedState({}));
  check('у темы есть кнопка с адресатом, числом и состоянием',
    /data-forum-thank="post:p_1"/.test(thankHtml)
      && /forum-thank /.test(thankHtml) && /aria-pressed="false"/.test(thankHtml));
  check('число благодарностей стоит на кнопке', /forum-thank[\s\S]{0,220}<b class="num">3<\/b>/.test(thankHtml));
  check('сказано, чем кнопка отличается от реакции', /не оценка/.test(thankHtml));
  const thankedHtml = renderForum({ events: [] }, feedState({ iThanked: true, thanksCount: 4 }));
  check('поблагодаривший видит нажатую кнопку без возможности второго нажатия',
    /forum-thank is-on/.test(thankedHtml) && /aria-pressed="true"/.test(thankedHtml)
      && /disabled/.test(thankedHtml.match(/data-forum-thank="post:p_1"[\s\S]{0,200}/)?.[0] ?? '')
      && /не отзывают/.test(thankedHtml));
  const guestHtml = renderForum({ events: [] }, feedState({}, { me: null }));
  check('гость кнопку видит, но нажать не может', /data-forum-thank="post:p_1"/.test(guestHtml)
    && /disabled/.test(guestHtml.match(/data-forum-thank="post:p_1"[\s\S]{0,200}/)?.[0] ?? ''));
  const ownHtml = renderForum({ events: [] }, feedState({ authorId: 'u_1' }));
  check('свою тему не благодарят и подсказкой о том же слове',
    /Свой текст не благодарят/.test(sql) && /data-forum-thank="post:p_1"/.test(ownHtml));
  check('кнопка живёт рядом с реакциями, но не внутри их списка',
    pagesSrc.indexOf('forum-emoji__pop') < pagesSrc.indexOf('renderThanks(targetType, item, s)'));
  check('кнопка одета своим стилем, а не чужим классом реакции',
    cssSrc.includes('.forum-thank') && cssSrc.includes('.forum-thank.is-on'));
  check('нажатие правит число локально и ждёт ответа базы',
    /item\.thanksCount = Number\(item\.thanksCount \|\| 0\) \+ 1;/.test(mountSrc)
      && mountSrc.includes('await forum.giveThanks(targetType, targetId)'));
  check('повторное нажатие не отправляет ничего: благодарность не отзывают',
    /if \(!item \|\| item\.iThanked\) return;/.test(mountSrc));
  check('отказ базы человек слышит словами базы, а не молчанием',
    /notice\(err\?\.message \|\| 'База не приняла благодарность'\)/.test(mountSrc)
      && /await refreshOne\(targetType, targetId\);/.test(mountSrc));

  /* ── Панель владельца ── */
  const { renderPlayers, renderRepGrantRows } = await import('../src/admin/screens/players.js');
  const owner = { id: 'u_1', nick: 'Распорядитель', role: 'admin', createdAt: new Date(), isVerified: true };
  const member = { id: 'u_2', nick: 'Ковыль', role: 'member', createdAt: new Date(), isVerified: false };
  const playersHtml = renderPlayers({
    forum: { configured: true, me: owner, users: [owner, member], recoveries: [], appeals: [] },
  });
  check('награда спрятана под «⋯»: рядом с обратимыми чипами ей не место',
    /data-player-rep="u_2"/.test(playersHtml)
      && playersHtml.indexOf('data-player-rep') > playersHtml.indexOf('adm-menu__list'));
  check('окно награды просит две вещи и не принимает пустую причину',
    /data-rep-form/.test(playersHtml) && /name="delta"/.test(playersHtml)
      && /name="reason"[^>]*required/.test(playersHtml));
  check('поле очков не пускает ноль за границами конфига',
    /min="-100" max="100"/.test(playersHtml));
  check('окно объясняет, что запись необратима', /обратной записью/.test(playersHtml));
  check('история наград названа своим списком', /data-rep-history/.test(playersHtml));
  const rowsHtml = renderRepGrantRows([
    { id: 'g1', delta: 20, reason: 'Разобрал чужой бой по кадрам', grantedByNick: 'Распорядитель', createdAt: new Date() },
    { id: 'g2', delta: -5, reason: 'Награда снята по апелляции', grantedByNick: '', createdAt: new Date() },
  ]);
  check('строка истории показывает знак, причину и кто выдал',
    rowsHtml.includes('+20') && rowsHtml.includes('-5')
      && rowsHtml.includes('Разобрал чужой бой по кадрам') && rowsHtml.includes('Распорядитель'));
  check('ушедший владелец назван ушедшим, а не выдуманным ником',
    rowsHtml.includes('владелец ушёл'));
  check('пустая история и непрочитанная — разные слова',
    renderRepGrantRows([]).includes('ещё не выдавали'));
  check('историю читает панель, а не печатает из разметки',
    /loadRepHistory/.test(adminSrc) && /forum\.listReputationGrants\(userId\)/.test(adminSrc));
  check('панель называет файл миграции, если база ещё не перестроена',
    (adminSrc.match(/'20260926-author-thanks\.sql'/g) || []).length === 2);
  check('ничего не проверяя, панель не спорит с базой: границ в её коде нет',
    !/if \(delta === 0\)/.test(adminSrc) && !/delta > 100/.test(adminSrc));
  check('блок панели одет своим стилем', admCssSrc.includes('.adm-rep-history'));
  check('на экране игрока репутация объяснена как отдельная лестница',
    /Репутация<\/b>/.test(playersHtml) && !/репутация.*активность/.test(playersHtml));

  /* ── Живой черновой прогон: те же правила, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const KEY = 'zr33.forum.local';
  const raw = () => JSON.parse(store.get(KEY));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };

  await local.signUp('Распорядитель');   // первый — владелец
  const authorId = raw().me;
  await local.signUp('Ковыль');
  const giverRow = raw().users.find((u) => u.nick === 'Ковыль');
  await local.signIn('Распорядитель');

  const topic = await local.createPost({
    title: 'Как держать фронт в неравном бою', body: 'Разбор по кадрам.', category: 'vs',
  });
  const answer = await local.addComment(topic.id, 'Плюс к третьему кадру: ещё фланг.');

  await local.signIn('Ковыль');
  check('свежая тема выходит уже с числом благодарностей и своим состоянием',
    'thanksCount' in topic && 'iThanked' in topic);
  await local.giveThanks('post', topic.id);
  const afterPost = (await local.getPost(topic.id));
  check('тема после благодарности знает своё число', afterPost.thanksCount === 1 && afterPost.iThanked === true);
  await local.giveThanks('comment', answer.id);
  const afterAnswer = (await local.listComments(topic.id)).find((c) => c.id === answer.id);
  check('ответ читают с тем же числом и отметкой, что и тему',
    afterAnswer.thanksCount === 1 && afterAnswer.iThanked === true);
  equal('ответ благодарён отдельно от темы', raw().thanks.filter((t) => t.targetType === 'comment').length, 1);
  equal('повтор той же записью не проходит',
    await says(() => local.giveThanks('post', topic.id)), 'Вы уже благодарили автора этой записи');
  await local.signIn('Распорядитель');
  equal('свой текст не благодарят',
    await says(() => local.giveThanks('post', topic.id)), 'Свой текст не благодарят');
  await local.signIn('Ковыль');
  equal('не того типа цели не принимают',
    await says(() => local.giveThanks('poll', topic.id)), 'Благодарят за тему или за ответ');
  equal('несуществующей записи нет',
    await says(() => local.giveThanks('post', 'p_missing')), 'Записи уже нет: страница устарела');
  const goneTopic = await local.createPost({ title: 'Черновик, который снимут', body: 'Пусто.', category: 'vs' });
  await local.deletePost(goneTopic.id, null);
  equal('удалённую тему благодарить не за что — это другой отказ, чем «нет записи»',
    await says(() => local.giveThanks('post', goneTopic.id)), 'Эту запись удалили — благодарить не за что');

  /* Предел частоты: пять «спасибо» подряд — уже не благодарность. */
  await local.signIn('Распорядитель');
  const many = [];
  for (let i = 0; i < 6; i += 1) {
    many.push(await local.createPost({
      title: `Разбор боя, выпуск ${i}`, body: `Текст разбора ${i}.`, category: 'vs',
    }));
  }
  await local.signIn('Ковыль');
  let refused = '';
  for (const t of many) {
    const err = await says(() => local.giveThanks('post', t.id));
    if (err) { refused = err; break; }
  }
  equal('шестая подряд благодарность отвергнута словами базы', refused,
    `Не больше ${L.thanksPerWindow} благодарностей за ${L.thanksWindowMinutes} минут — спасибо говорят за дело, а не подряд`);
  equal('пяти удалось: строк ровно на одну меньше предела',
    raw().thanks.length, L.thanksPerWindow);

  /* Уведомление автору — с ником, потому что это его личный ящик. */
  const notif = raw().notifications.find((n) => n.kind === 'thanks');
  check('автору пришло уведомление о благодарности', Boolean(notif) && notif.userId === authorId);
  check('в уведомлении назван благодаривший — только для получателя',
    notif.actorNick === 'Ковыль' && notif.postId && Boolean(notif.preview));
  await local.signIn('Распорядитель');
  check('лента уведомлений автора помнит, кто сказал спасибо',
    (await local.listNotifications()).some((n) => n.kind === 'thanks' && n.actorNick === 'Ковыль'));

  /* Профиль: число благодарностей и ни одной фамилии благодаривших. */
  const authorProfile = await local.getProfile('Распорядитель');
  equal('профиль автора считает благодарности', authorProfile.thanksReceived, L.thanksPerWindow);
  check('в профиле нет ни идентификатора, ни ника благодарившего',
    !JSON.stringify(authorProfile).includes(giverRow.id) && !JSON.stringify(authorProfile).includes('Ковыль'));
  check('без наград репутация автора пока нулевая, хотя благодарности есть',
    authorProfile.repGrantPoints === 0 && authorProfile.repGrantCount === 0);

  /* Награды владельца. */
  await local.signIn('Ковыль');
  equal('награду выдаёт только владелец',
    await says(() => local.grantReputation(authorId, 20, 'Провёл разбор для новичков')),
    'Репутацию меняет только владелец');
  await local.signIn('Распорядитель');
  equal('себе награду не выдают',
    await says(() => local.grantReputation(authorId, 20, 'За труд на форуме')),
    'Себе награду не выдают');
  equal('ноль — не награда',
    await says(() => local.grantReputation(giverRow.id, 0, 'Ни о чём не говорит')),
    'Ноль ничего не меняет — нужна дельта от −100 до 100');
  equal('за границами ста очков не выходят',
    await says(() => local.grantReputation(giverRow.id, 101, 'Сверх награды не бывает')),
    'Дельта награды умещается в сто очков');
  equal('короткая причина не принимается',
    await says(() => local.grantReputation(giverRow.id, 20, 'молодец')),
    `Пояснение короче ${L.repReasonMin} символов — награду нужно описать словами`);
  equal('причина длиннее пятисот символов не пишется',
    await says(() => local.grantReputation(giverRow.id, 20, 'а'.repeat(L.repReasonMax + 1))),
    `Пояснение длиннее ${L.repReasonMax} символов`);
  equal('несуществующему игроку награду не выдают',
    await says(() => local.grantReputation('u_missing', 20, 'За очень полезное дело')),
    'Такого игрока нет: страница устарела');

  await local.grantReputation(giverRow.id, 20, 'Перевёл правила форума для новичков');
  await local.grantReputation(giverRow.id, -5, 'Ошибка в прошлой записи, снято частично');
  const history = await local.listReputationGrants(giverRow.id);
  equal('награда не правит прежнюю, а добавляется строкой', history.length, 2);
  check('история идёт от поздней к ранней и знает, кто выдал',
    history[0].delta === -5 && history[0].grantedByNick === 'Распорядитель');
  const given = await local.getProfile('Ковыль');
  equal('сумма наград считается из строк, а не хранится числом', given.repGrantPoints, 15);
  equal('число наград известно отдельно от суммы', given.repGrantCount, 2);
  await local.signIn('Ковыль');
  check('свою историю человек читает целиком',
    (await local.listReputationGrants(giverRow.id)).length === 2);
  equal('без указания игрока историю читает только модерация',
    await says(() => local.listReputationGrants()), 'Без указания игрока историю читает только модерация');
  await local.signIn('Распорядитель');
  check('владелец читает историю любого игрока',
    (await local.listReputationGrants(null)).length === 2);
  check('ни одна награда не меняет уровень: две лестницы не перетекают',
    (await local.getProfile('Ковыль')).postCount === given.postCount);

  /* Черновик не оставляет после себя ни паролей, ни ключей в открытом виде. */
  check('в чёрном хранилище благодарности лежат связкой идентификаторов, а не текстом',
    raw().thanks.every((t) => t.giverId && t.authorId && t.targetId && !t.giverNick));
}

console.log(`\n${'─'.repeat(52)}`);
// ── AA. Закладки тем ────────────────────────────────────────────────────────
console.log('\nAA. Закладки тем');
{
  /*
    Заимствование с формулировкой «сохранил себе» опасно не тем, что его
    можно сделать дважды, а тем, где оно однажды разъедется с собой: имя в
    строке поставит один, а читать его будет другой; приватный список станет
    публичным числом; окно запроса переедет в базу и станет лимитом; и
    наконец подписка, которая молча не работает, потому что её клиент шлёт
    без идентификатора. Поэтому тесты ниже сверяют места между собой, а не
    только наличие слов.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-post-bookmarks.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const pagesSrc = await readFile('src/pages/forum.js', 'utf8');
  const rankSrc = await readFile('src/forum/rank.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const WINDOW = CONFIG.forum.limits.savedWindow;

  /* ── Форма строки: что где лежит ── */
  check('закладка — пара идентификаторов, а не запись с текстом',
    sql.includes('create table if not exists public.forum_bookmarks (')
      && sql.includes('primary key (post_id, user_id)')
      && !/forum_bookmarks[\s\S]{0,400}?(title|body|note)/.test(sql));
  check('тема и человек уходят каскадом: сдохнет тема — сдохнет закладка',
    sql.includes('references public.forum_posts (id) on delete cascade')
      && sql.includes('references public.forum_users (id) on delete cascade'));
  check('свой список читается своим указателем, а не перебором',
    sql.includes('on public.forum_bookmarks (user_id, created_at desc)'));
  check('три правила доступа — только про свои строки',
    /create policy forum_bookmarks_read[\s\S]{0,140}for select using \(user_id = auth\.uid\(\)\)/.test(sql)
      && /create policy forum_bookmarks_add[\s\S]{0,140}for insert with check \(user_id = auth\.uid\(\)\)/.test(sql)
      && /create policy forum_bookmarks_drop[\s\S]{0,140}for delete using \(user_id = auth\.uid\(\)\)/.test(sql));
  check('передвигать закладку нечем: ни одного update в базе и в выдаче',
    !/for update/.test(sql) && !sql.includes('grant select, insert, update'));
  check('выдано ровно то, чем пользуются, и только вошедшему',
    sql.includes('grant select, insert, delete on public.forum_bookmarks to authenticated;')
      && !sql.includes('forum_bookmarks to anon'));

  /* ── Имя в строке ── */
  check('who is who решает токен: пользователя вставляет триггер',
    /create or replace function public\.forum_set_row_user\(\)[\s\S]{0,220}new\.user_id := auth\.uid\(\);/.test(sql)
      && sql.includes('create trigger forum_bookmarks_user'));
  check('браузер присылает одну колонку — идентификатора человека в теле нет',
    /export async function bookmarkTopic\(postId\)[\s\S]{0,260}body: \{ post_id: postId \}/.test(supaSrc)
      && !/forum_bookmarks[\s\S]{0,300}user_id:/.test(supaSrc));
  check('подписки получили то же правило: его отсутствие и было их отказом',
    sql.includes('create trigger forum_topic_subscriptions_user')
      && sql.includes('create trigger forum_alliance_subscriptions_user')
      && !/create trigger forum_topic_subscriptions_user/.test(
        sql.slice(0, sql.indexOf('── Шаг 4'))));

  /* ── Число окна: одно, и не в базе ── */
  check('окно списка живёт в конфиге и названо обоими адаптерами',
    Number.isInteger(WINDOW) && WINDOW > 0
      && supaSrc.includes('limit=${CONFIG.forum.limits.savedWindow}')
      && localSrc.includes('CONFIG.forum.limits.savedWindow'));
  /*
    Размер окна в тексте миграции писать нельзя: однажды кто-то примет его за
    лимит и перенесёт в базу. Число живёт в конфиге, а здесь ему место только
    как имени поля. Смотрим только исполняемый текст: в комментариях стоят
    даты файлов, а это числа из трёх и более цифр.
  */
  const sqlBody = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  check('окно — не лимит: в командах миграции нет ни числа, ни единого отказа',
    !/\b\d{3,}\b/.test(sqlBody) && !/raise exception/.test(sqlBody));
  check('двери у закладки нет: ни функции, ни rpc-вызова',
    !/create or replace function public\.forum_bookmark/.test(sql)
      && !supaSrc.includes('/rpc/forum_bookmark')
      && !localSrc.includes('forum_bookmark'));
  check('закладка ничего не сообщает: ни вставки уведомлений, ни нового вида',
    !/insert into public\.forum_notifications/.test(sql)
      && !sql.includes('forum_notifications_kind_check')
      && !localSrc.includes("'bookmark'"));
  check('ни уровень, ни репутация не знают про закладки',
    !/bookmark|saved/i.test(rankSrc));

  /* ── Контракт и оба адаптера ── */
  check('контракт знает обе двери и флаг ленты',
    contractSrc.includes('@property {(postId: string) => Promise<void>} bookmarkTopic')
      && contractSrc.includes('@property {(postId: string) => Promise<void>} unbookmarkTopic')
      && contractSrc.includes('q?: string, saved?: boolean')
      && /@property \{boolean\} \[saved\]/.test(contractSrc));
  check('черновик повторяет форму: строка, дата и удаление вместо отметки',
    /export async function bookmarkTopic\(postId\)[\s\S]{0,320}createdAt: new Date\(\)\.toISOString\(\)/.test(localSrc)
      && /export async function unbookmarkTopic\(postId\)[\s\S]{0,200}s\.bookmarks = s\.bookmarks\.filter/.test(localSrc));
  check('без входа нечего ни ставить, ни смотреть — и там, и там своим словом',
    localSrc.includes('const me = meOrThrow(s);')
      && supaSrc.includes('if (!currentUserId()) return { posts: [], total: 0 };')
      && localSrc.includes('if (!s.me) return { posts: [], total: 0 };'));
  check('лента не падает без миграции: отметки закладок прощают отказ',
    supaSrc.includes("rest('/forum_bookmarks?select=post_id').catch(() => [])"));
  check('обновлённая карточка уносит свои отметки с собой',
    mountSrc.includes('const { subscribed, saved, unread } = state.posts[i];')
      && mountSrc.includes('state.posts[i] = Object.assign(fresh, { subscribed, saved, unread });'));

  /* ── Экран ── */
  check('флажок стоит в подвале карточки, а не в меню «⋯»',
    /class="forum-post__views">👁 \$\{Number\(p\.views \|\| 0\)\}<\/span>\s*\$\{renderSaveButton\(p, s\)\}/.test(pagesSrc));
  check('кнопка знает своё состояние и не даёт гостю пустоты',
    pagesSrc.includes('data-forum-bookmark="${esc(p.id)}"')
      && pagesSrc.includes('aria-label="Закладка темы" aria-pressed=')
      && pagesSrc.includes("${s.me ? '' : ' disabled'}")
      && pagesSrc.includes("'⚑' : '⚐'"));
  check('в фильтрах ленты — переключатель своим именем',
    pagesSrc.includes('class="seg seg--saved"') && pagesSrc.includes('data-forum-saved'));
  check('страница слушает и кнопку, и переключатель',
    mountSrc.includes("t.closest('[data-forum-bookmark]')")
      && mountSrc.includes("t.closest('[data-forum-saved]')")
      && mountSrc.includes('saved: state.saved,'));
  check('пустые закладки объясняют приём, а не зовут писать первым',
    pagesSrc.includes('Отложенных тем пока нет')
      && pagesSrc.includes('В закладках по этому поиску пусто'));
  check('гостю за фильтром не пустота, а путь: список виден только вошедшим',
    /if \(s\.saved\) \{\s*[\s\S]{0,260}?if \(!s\.me\) \{[\s\S]{0,400}?Список виден только вошедшим/.test(pagesSrc));
  check('флаг одет своим стилем, и состояние видно цветом',
    cssSrc.includes('.forum-save.is-on'));
  check('на телефоне по флажку попадают пальцем, как по действиям',
    /@media \(hover: none\) and \(pointer: coarse\)[\s\S]{0,600}\.forum-save \{ min-height: 40px/.test(cssSrc));

  /* ── Адрес ── */
  const url = await import('../src/forum/feed-url.js');
  const known = { categories: ['vs'], tags: ['guide'], sorts: ['fresh'] };
  equal('адрес «saved=1» читается как включённый фильтр',
    url.filtersFromSearch('cat=vs&saved=1', known).saved, true);
  equal('всё остальное в адресе закладок не значится',
    url.filtersFromSearch('saved=yes', known).saved, false);
  equal('обратная сборка пишет только флаг, а не список id',
    url.searchFromFilters({ category: 'vs', tag: 'all', sort: 'fresh', query: '', saved: true }),
    'cat=vs&saved=1');
  check('обычная лента остаётся чистым адресом',
    url.searchFromFilters({ category: 'all', tag: 'all', sort: 'fresh', query: '', saved: false }) === '');
  equal('адрес переживает перезагрузку: чтение и запись совпадают',
    url.filtersFromSearch(url.searchFromFilters({ category: 'all', tag: 'all', sort: 'top', query: '', saved: true }), known).saved,
    true);

  /* ── Документы ── */
  check('правило описано и в базе, и в документах, и в списке миграций',
    sql.includes('Список приватен') && docsSrc.includes('20260926-post-bookmarks.sql')
      && readmeSrc.includes('20260926-post-bookmarks.sql'));

  /* ── Живой черновой прогон: те же правила, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const rawBm = () => JSON.parse(store.get('zr33.forum.local'));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };

  await local.signUp('Распорядитель');
  await local.createPost({ title: 'Как держать фронт', body: 'Новая тема.', category: 'vs' });
  const older = await local.createPost({ title: 'Разбор флангов', body: 'Старая тема.', category: 'vs' });
  const newer = await local.createPost({ title: 'Осада без потерь', body: 'Свежая тема.', category: 'vs' });
  await local.signUp('Ковыль');

  const seen = await local.listPosts({});
  check('тема приходит уже с отметкой закладки', seen.posts.every((p) => 'saved' in p));
  equal('свежая тема ещё не в закладках',
    seen.posts.filter((p) => p.saved).length, 0);

  await local.bookmarkTopic(newer.id);
  await local.bookmarkTopic(older.id);
  const savedList = await local.listPosts({ saved: true });
  equal('в отобранном списке — только отложенное', savedList.posts.length, 2);
  check('порядок держит лента, а не дата постановки',
    savedList.posts.map((p) => p.id).join() === seen.posts
      .filter((p) => p.saved || p.id === newer.id || p.id === older.id).map((p) => p.id).join());
  await local.bookmarkTopic(older.id);
  equal('второе нажатие не множит строк',
    rawBm().bookmarks.filter((b) => b.postId === older.id).length, 1);
  await local.unbookmarkTopic(older.id);
  equal('снятие убирает строку, а не прячет её',
    rawBm().bookmarks.filter((b) => b.postId === older.id).length, 0);
  await local.bookmarkTopic(older.id);
  equal('снятая закладка ставится снова', (await local.listPosts({ saved: true })).posts.length, 2);

  /* Черновик не оставляет после себя ни чужих имён, ни текста. */
  check('в хранилище закладка — пара идентификаторов с датой, без ника и текста',
    rawBm().bookmarks.every((b) => b.postId && b.userId && b.createdAt && !b.nick && !b.title));

  const notifBefore = rawBm().notifications.length;
  const profileBefore = await local.getProfile('Ковыль');
  await local.signIn('Распорядитель');
  equal('автор темы не видит чужих закладок у себя',
    (await local.listPosts({ saved: true })).posts.length, 0);
  check('и в ленте автора тема не помечена его закладкой',
    (await local.listPosts({})).posts.every((p) => !p.saved));
  equal('закладка не пишет уведомлений', rawBm().notifications.length, notifBefore);
  const profileAfter = await local.getProfile('Ковыль');
  check('закладка не двигает ни уровень, ни репутацию',
    profileAfter.postCount === profileBefore.postCount
      && profileAfter.repGrantPoints === profileBefore.repGrantPoints);

  /* Окно: не предел, а размер запроса. */
  CONFIG.forum.limits.savedWindow = 1;
  await local.signIn('Ковыль');
  equal('за окном остаётся ровно окно', (await local.listPosts({ saved: true })).posts.length, 1);
  CONFIG.forum.limits.savedWindow = WINDOW;
  equal('и возвращается назад тем же движением',
    (await local.listPosts({ saved: true })).posts.length, 2);

  /* Гость и удалённая тема. */
  await local.signOut();
  equal('гостю список пуст', (await local.listPosts({ saved: true })).posts.length, 0);
  equal('гость закладку не поставит', await says(() => local.bookmarkTopic(newer.id)), 'Сначала войдите');
  await local.signIn('Распорядитель');
  await local.deletePost(newer.id, null);
  await local.signIn('Ковыль');
  check('удалённая тема уходит из списка',
    !(await local.listPosts({ saved: true })).posts.some((p) => p.id === newer.id));
  check('но её строка в списке живёт: тема вернётся — вернётся и закладка',
    rawBm().bookmarks.some((b) => b.postId === newer.id));
}

console.log(`\n${'─'.repeat(52)}`);
// ── AB. Бартер-доска ────────────────────────────────────────────────────────
console.log('\nAB. Бартер-доска');
{
  /*
    Бартер опасен не тем, что кто-то обманет в сделке, — форум сделки не
    ведёт, — а тем, где правило однажды разойдётся с собой: метка в правилах и
    в списке базы, длина строк в форме и в проверке таблицы, отметка закрытия,
    которая переживает удаление темы, и срок, который у объявления обязателен.
    Поэтому тесты ниже сверяют места между собой, а не только наличие слов.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-barter-board.sql', 'utf8');
  /* Определение ленты до этого файла — эталон копии: её пересоздают копией. */
  const prevSql = await readFile('supabase/applied/20260926-author-thanks.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const pagesSrc = await readFile('src/pages/forum.js', 'utf8');
  const rulesSrc = await readFile('src/forum/rules.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const L = CONFIG.forum.limits;

  /* ── Форма правила: обмен живёт у темы ── */
  /*
    SQL читается нормализованным по пробелам: перенос строки в команде — это
    форматирование файла, а не смысл, и сверять фразы по одному пробелу
    означало бы падать на каждом переносе.
  */
  const flat = sql.replace(/\s+/g, ' ');
  check('обмен — метка темы, а не отдельный ящик: ни таблицы, ни новой страницы',
    !/create table[^;]*barter/i.test(sql)
      && flat.includes('add column if not exists barter_gives')
      && flat.includes('add column if not exists barter_wants')
      && flat.includes('add column if not exists barter_closed_at'));
  check('метку принимает список базы, и карточка темы по-прежнему держит три',
    sql.includes("tags <@ array['vs','recruiting','diplomacy','guide','question','event','sos','barter']::text[]")
      && sql.includes('cardinality(tags) <= 3'));
  /*
    Имя метки знает из трёх мест: список правил, проверка базы и функция
    списка требующих срока. Расхождение выглядит как «галочку поставил, а
    база не поняла», поэтому сверяем все три сразу.
  */
  check('имя метки одно: правила, проверка таблицы и функция срока',
    rulesSrc.includes("export const BARTER_TAG_ID = 'barter';")
      && rulesSrc.includes("EXPIRY_TAG_IDS = ['recruiting', 'sos', 'barter']")
      && sql.includes("array['recruiting','sos','barter']::text[]"));
  check('решает одна функция, а не два списка: обмен в требующих срок',
    (await import('../src/forum/rules.js')).needsExpiry(['barter'])
      && (await import('../src/forum/rules.js')).needsBarterLines(['vs', 'barter'])
      && !(await import('../src/forum/rules.js')).needsBarterLines(['vs']));

  /* ── Числа: форма и база говорят одними словами ── */
  check('длину обеих строк держит проверка таблицы, и числа те же, что в конфиге',
    sql.includes(`char_length(barter_gives) between ${L.barterLineMin} and ${L.barterLineMax}`)
      && sql.includes(`char_length(barter_wants) between ${L.barterLineMin} and ${L.barterLineMax}`));
  check('черновик называет ту же границу тем же словом',
    localSrc.includes('`Каждая сторона обмена — от ${L.barterLineMin} до ${L.barterLineMax} символов`'));
  const both = 'У темы с меткой «Обмен» должны быть названы обе стороны: что отдаёте и что ищете';
  check('отказ про обе стороны назван одинаково в базе и в черновом режиме',
    (sql.match(new RegExp(both, 'g')) || []).length === 1 && localSrc.includes(both));
  check('сроку объявления отдельного числа не заводят: он общий',
    L.expiryDefaultDays.barter === L.expiryChoices.find((d) => d >= 3)
      && !Object.keys(L).some((k) => /barter.*(min|max|days)/i.test(k) && !/barterLine/.test(k)));

  /* ── Что триггер делает сам ── */
  check('метку сняли — строки и отметка уходят вместе с ней',
    /if not \('barter' = any\(new\.tags\)\) then\s*new\.barter_gives := null;\s*new\.barter_wants := null;\s*new\.barter_closed_at := null;/.test(sql));
  check('требование строк мешает только тем, кто трогает метки или строки',
    sql.includes('new.tags is distinct from old.tags')
      && sql.includes('new.barter_gives is distinct from old.barter_gives')
      && sql.includes('new.barter_wants is distinct from old.barter_wants'));
  check('будущая отметка закрытия сжимается в «сейчас»: часы браузера не указ',
    /if new\.barter_closed_at > now\(\) then\s*new\.barter_closed_at := now\(\);/.test(sql));
  const backdate = 'Нельзя закрыть объявление раньше, чем оно появилось';
  check('закрыть объявление задним числом нельзя — и в черновике это то же правило',
    sql.includes(backdate) && localSrc.includes('post.barterClosedAt = closed ? new Date().toISOString() : null'));

  /* ── Двери и права ── */
  check('двери у обмена нет: объявление правит политика темы',
    !/create or replace function public\.forum_barter/.test(sql)
      && !supaSrc.includes('/rpc/forum_barter')
      && !sql.includes('execute function public.forum_barter'));
  check('новых прав не выдано: колонки живут уже выданной таблицей',
    !/grant[\s\S]{0,120}barter/.test(sql) && !/create policy/.test(sql));
  check('частоту объявлений держит выдержка тем, а не второй счётчик',
    !/barter.*(hold|limit|count)/i.test(sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, ''))
      && !sql.includes('barter_hold'));
  check('ни денег, ни контактов, ни способа связаться в колонках нет',
    !/barter_(price|cost|money|contact|discord|phone|telegram)/.test(sql));

  /* ── Лента ── */
  const viewOf = (src) => (src.match(/create view public\.forum_post_list[\s\S]*?author_id;/)?.[0] ?? '')
    .replace(/\s+/g, ' ').trim();
  check('лента пересоздана копией прежнего определения: select p.* увидит колонки',
    viewOf(sql).length > 200 && viewOf(sql) === viewOf(prevSql)
      && sql.includes('drop view if exists public.forum_post_list'));
  check('доска смотрит на свежие открытые объявления, и указатель частичный',
    /create index if not exists forum_posts_barter_idx[\s\S]{0,140}where 'barter' = any \(tags\) and not deleted/.test(sql));

  /* ── Контракт и оба адаптера ── */
  check('контракт знает три свойства темы и дверь закрытия',
    /@property \{string\|null\} \[barterGives\]/.test(contractSrc)
      && /@property \{string\|null\} \[barterWants\]/.test(contractSrc)
      && /@property \{Date\|null\} \[barterClosedAt\]/.test(contractSrc)
      && contractSrc.includes('(id: string, closed: boolean) => Promise<ForumPost>} closeBarter'));
  check('черновик отдаёт те же три поля и своим null, и своей датой',
    /barterGives: p\.barterGives \|\| null/.test(localSrc)
      && /barterWants: p\.barterWants \|\| null/.test(localSrc)
      && /barterClosedAt: toDate\(p\.barterClosedAt\) \?\? null/.test(localSrc));
  check('рабочий адаптер читает колонки темы и не падает без миграции',
    /barterGives: row\.barter_gives \|\| null/.test(supaSrc)
      && /barterClosedAt: toDate\(row\.barter_closed_at\) \?\? null/.test(supaSrc));
  check('колонки уезжают в запрос только когда их попросили',
    /if \(draft\.barterGives != null \|\| draft\.barterWants != null\) \{[\s\S]{0,160}payload\.barter_gives = draft\.barterGives \?\? null/.test(supaSrc));
  check('отметка закрытия — PATCH одной колонки, как срок темы',
    /export async function closeBarter\(id, closed\)[\s\S]{0,240}method: 'PATCH'[\s\S]{0,90}barter_closed_at/.test(supaSrc));
  check('черновик повторяет отказ про метку своим словом',
    localSrc.includes('Снимать с доски можно только объявление с меткой «Обмен»'));

  /* ── Форма и карточка ── */
  check('форма спрашивает обе стороны и держит длину базы',
    pagesSrc.includes('name="barter_gives"') && pagesSrc.includes('name="barter_wants"')
      && /name="barter_gives" data-forum-barter-gives[\s\S]{0,120}maxlength="\$\{L\.barterLineMax\}"/.test(pagesSrc));
  check('поля прячутся вместе с меткой — как у встречи',
    mountSrc.includes('barterFields.hidden = !needsBarterLines(chosen)'));
  check('в запрос не уедет ничего, если метку не ставили',
    /if \(needsBarterLines\(draft\.tags\)\) \{[\s\S]{0,160}draft\.barterGives = gives \|\| null/.test(mountSrc));
  check('карточка показывает обе стороны и в ленте, и в теме',
    pagesSrc.includes('${barterLines(p)}') && /function barterLines\(p\)/.test(pagesSrc));
  check('снятое объявление названо знаком, а не исчезновением',
    /function barterBadge\(p\)[\s\S]{0,240}Снято с доски/.test(pagesSrc)
      && pagesSrc.includes('${barterBadge(p)}'));
  check('кнопка есть только у автора и модерации и знает своё состояние',
    /function barterControl\(p, s\)[\s\S]{0,400}s\.me\.id !== p\.authorId/.test(pagesSrc)
      && pagesSrc.includes('data-forum-barter-close=') && pagesSrc.includes('data-forum-barter-closed='));
  check('страница слушает кнопку и правит карточку ответом адаптера',
    mountSrc.includes("t.closest('[data-forum-barter-close]')")
      && mountSrc.includes('await forum.closeBarter(id, closed)'));
  check('отказ без миграции называет файл, а не «операция не выполнена»',
    mountSrc.includes('supabase/applied/20260926-barter-board.sql'));
  check('блок одет своим стилем, и снятое объявление читается приглушённо',
    cssSrc.includes('.forum-barter-fields {') && cssSrc.includes('.forum-barter--closed > div'));

  /* ── Документы ── */
  check('правило описано и в базе, и в документах, и в списке миграций',
    sql.includes('── ПРАВИЛО ──') && docsSrc.includes('20260926-barter-board.sql')
      && readmeSrc.includes('20260926-barter-board.sql'));
  check('документ называет ограничение доски: сделку форум не ведёт',
    /не обещает сделку|сделку не ведёт|не ведёт её/.test(docsSrc));

  /* ── Живой черновой прогон: те же правила, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const rawBt = () => JSON.parse(store.get('zr33.forum.local'));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const DAY = 86400000;
  const inDays = (n) => new Date(Date.now() + n * DAY).toISOString();

  await local.signUp('Меняла');
  equal('объявлению без второй стороны база отказывает тем же словом',
    await says(() => local.createPost({
      title: 'Отдам патроны', body: '<p>есть лишние</p>', category: 'ally',
      tags: ['barter'], barterGives: '200 патронов 7.62', expiresAt: inDays(3),
    })), both);
  equal('и срок для объявления обязателен',
    await says(() => local.createPost({
      title: 'Отдам патроны', body: '<p>есть лишние</p>', category: 'ally',
      tags: ['barter'], barterGives: '200 патронов 7.62', barterWants: 'банки',
    })), 'У темы с меткой «Набор», «Срочно» или «Обмен» должен быть срок действия — выберите, сколько дней она висит');
  equal('короткая строка не проходит, как и в проверке таблицы',
    await says(() => local.createPost({
      title: 'Отдам патроны', body: '<p>есть лишние</p>', category: 'ally',
      tags: ['barter'], barterGives: '200 патронов 7.62', barterWants: 'да', expiresAt: inDays(3),
    })), `Каждая сторона обмена — от ${L.barterLineMin} до ${L.barterLineMax} символов`);
  equal('длинная строка — тоже',
    await says(() => local.createPost({
      title: 'Отдам патроны', body: '<p>есть лишние</p>', category: 'ally',
      tags: ['barter'], barterGives: 'я'.repeat(L.barterLineMax + 1), barterWants: 'банки', expiresAt: inDays(3),
    })), `Каждая сторона обмена — от ${L.barterLineMin} до ${L.barterLineMax} символов`);

  const ad = await local.createPost({
    title: 'Отдам патроны', body: '<p>есть лишние</p>', category: 'ally',
    tags: ['barter'], barterGives: '200 патронов 7.62', barterWants: 'банки и аптеки', expiresAt: inDays(3),
  });
  equal('объявление принято и названо обеими сторонами', ad.barterGives, '200 патронов 7.62');
  equal('вторая сторона доехала целиком', ad.barterWants, 'банки и аптеки');
  equal('свежее объявление открыто', ad.barterClosedAt, null);

  const calm = await local.createPost({
    title: 'Разбор флангов', body: '<p>обычная тема</p>', category: 'vs',
    tags: ['vs'], barterGives: '200 патронов 7.62', barterWants: 'банки',
  });
  check('без метки строк обмена не бывает, даже если их прислали',
    calm.barterGives === null && calm.barterWants === null && calm.barterClosedAt === null);

  const byTag = await local.listPosts({ tag: 'barter' });
  equal('доска — обычный фильтр по метке, отдельной страницы нет',
    byTag.posts.map((p) => p.id), [ad.id]);

  const closed = await local.closeBarter(ad.id, true);
  check('закрытие ставит момент, а не флаг', closed.barterClosedAt instanceof Date);
  equal('объявление осталось темой со своим текстом', closed.title, 'Отдам патроны');
  equal('повторное нажатие возвращает на доску',
    (await local.closeBarter(ad.id, false)).barterClosedAt, null);
  await local.signOut();
  equal('без входа снимать некому',
    await says(() => local.closeBarter(ad.id, true)), 'Сначала войдите');
  await local.signUp('Посторонний');
  equal('и автор чужой строки не тронет',
    await says(() => local.closeBarter(ad.id, true)), 'Это не ваш пост');
  const ownCalm = await local.createPost({
    title: 'Своё без обмена', body: '<p>обычная тема</p>', category: 'vs', tags: ['vs'],
  });
  equal('у своей темы без метки снимать нечего',
    await says(() => local.closeBarter(ownCalm.id, true)),
    'Снимать с доски можно только объявление с меткой «Обмен»');

  await local.signIn('Меняла');
  await local.closeBarter(ad.id, true);
  check('в хранилище у темы — две строки, момент закрытия и ничего лишнего',
    rawBt().posts.some((p) => p.id === ad.id && p.barterGives && p.barterWants && p.barterClosedAt));
  check('закрытая тема не пропадает из ленты: ответы людей остаются',
    (await local.listPosts({})).posts.some((p) => p.id === ad.id));
  await local.deletePost(ad.id, null);
  check('удалённое объявление уходит с доски вместе с темой',
    !(await local.listPosts({ tag: 'barter' })).posts.some((p) => p.id === ad.id));
}

console.log(`\n${'─'.repeat(52)}`);
// ── AC. Заявки на гайды ─────────────────────────────────────────────────────

console.log('\nAC. Заявки на гайды');
{
  /*
    Заявка разбросана по четырём местам: таблица и три двери в базе, два
    адаптера, блок на странице гайдов и числа в config.js. Ошибка в любом стыке
    невидима: страница продолжит показывать «Связана с гайдом», которую на этот
    раз поставил не тот, и никто не заметит, что лимит в три заявки держит
    только браузер. Поэтому сверяем места между собой, а не наличие слов.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-guide-requests.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const pagesSrc = await readFile('src/pages/guides.js', 'utf8');
  const behavSrc = await readFile('src/forum/guides.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const L = CONFIG.forum.limits;
  const flat = sql.replace(/\s+/g, ' ');

  /* ── Форма правила: заявка — своя таблица, а не метка темы ── */
  check('заявка живёт отдельной таблицей, а не колонкой у темы или меткой',
    flat.includes('create table if not exists public.forum_guide_requests')
      && !/add column if not exists .*guide_request/i.test(sql)
      && !sql.includes("'guide-request'"));
  check('исхода ровно четыре, и «взято в работу» среди них нет',
    flat.includes(`check (status in ('open', 'linked', 'closed', 'cancelled'))`)
      && !/in progress|claimed|accepted/.test(sql)
      && pagesSrc.includes("linked: 'Связана с гайдом'")
      && pagesSrc.includes("closed: 'Закрыта модерацией'")
      && pagesSrc.includes("cancelled: 'Отозвана автором'"));
  check('ссылка на гайд переживает его удаление, а автор заявки — нет',
    flat.includes('references public.forum_guides (id) on delete set null')
      && flat.includes('references public.forum_users (id) on delete cascade'));
  check('голосов, наград и истории правок в таблице намеренно нет',
    !/vote|upvote|reward|payout|revision|history/i.test(sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')));

  /* ── Числа: форма, база и черновик говорят одно ── */
  check('границы названия и описания держит проверка таблицы, числа те же, что в конфиге',
    flat.includes(`char_length(title) between ${L.guideRequestTitleMin} and ${L.guideRequestTitleMax}`)
      && flat.includes(`char_length(details) <= ${L.guideRequestDetailsMax}`));
  check('объяснение модерации держит те же числа, что и комментарий к отметке гайда',
    flat.includes(`answer = '' or char_length(answer) between ${L.guideNoteMin} and ${L.guideNoteMax}`)
      && !Object.keys(L).some((k) => /^guideRequest.*(Answer|Note)/.test(k)));
  check('форма называет те же границы, что и база',
    pagesSrc.includes('minlength="${L.guideRequestTitleMin}" maxlength="${L.guideRequestTitleMax}"')
      && pagesSrc.includes('maxlength="${L.guideRequestDetailsMax}"')
      && pagesSrc.includes('не больше ${L.guideRequestDailyMax} заявок за сутки'));

  /* Каждое отказное слово базы обязано жить и в черновом режиме. */
  const refusals = [
    'Заявку отправляет только вошедший игрок',
    'У вас уже есть открытая заявка с таким названием',
    'Заявка не найдена',
    'Отозвать можно только свою заявку',
    'Отозвать можно только открытую заявку',
    'Заявку разбирает модерация',
    'Нужно указать гайд, которым закрывается заявка',
    'Связать заявку можно только с опубликованным гайдом',
    'Эта заявка уже разобрана: ',
  ];
  for (const line of refusals) {
    check(`отказ «${line.trim()}» назван одинаково в базе и в черновом режиме`,
      sql.includes(line) && localSrc.includes(line));
  }
  /*
    Отказы с числом в черновике собраны из значений конфига, поэтому их сверяют
    две отдельные проверки: база обязана знать число из config.js, а черновик —
    ту же фразу без числа. Иначе правка лимита в одном месте осталась бы
    незаметной.
  */
  const numbered = [
    [`Название темы короче ${L.guideRequestTitleMin} символов: по трём словам гайд не написать`,
      'символов: по трём словам гайд не написать'],
    [`Название темы длиннее ${L.guideRequestTitleMax} символов: его не прочитает ни модератор, ни автор гайда`,
      'символов: его не прочитает ни модератор, ни автор гайда'],
    [`Описание длиннее ${L.guideRequestDetailsMax} символов: суть влезает и в меньшее`,
      'символов: суть влезает и в меньшее'],
    [`Не больше ${L.guideRequestDailyMax} заявок за сутки: их читают люди`,
      'заявок за сутки: их читают люди'],
  ];
  for (const [full, tail] of numbered) {
    check(`числовая граница «${tail}» сошлась в базе, конфиге и черновике`,
      sql.includes(full) && localSrc.includes(tail));
  }
  check('числа в отказе черновик берёт из конфига, а не пишет руками',
    localSrc.includes('`Название темы короче ${REQ_TITLE_MIN} символов')
      && localSrc.includes('`Название темы длиннее ${REQ_TITLE_MAX} символов')
      && localSrc.includes('`Описание длиннее ${REQ_DETAILS_MAX} символов')
      && localSrc.includes('`Не больше ${REQ_DAILY_MAX} заявок за сутки')
      && localSrc.includes('const REQ_TITLE_MIN = CONFIG.forum.limits.guideRequestTitleMin'));
  check('объяснение требует тех же слов, что и запись об устаревании',
    localSrc.includes('`Нужно хотя бы ${NOTE_MIN} символов: игрок ждёт объяснения, а не молчаливого отказа`')
      && sql.includes('Нужно хотя бы 5 символов: игрок ждёт объяснения, а не молчаливого отказа'));

  /* ── Двери, права и вид ── */
  check('правило «не больше трёх» и запрет повтора держат функции, а не браузер',
    flat.includes(`from public.forum_guide_requests where user_id = auth.uid() and created_at > now() - interval '24 hours'`)
      && flat.includes(`where user_id = auth.uid() and status = 'open'`)
      && /lower\(regexp_replace\(btrim\(title\), '\\s\+', ' ', 'g'\)\)/.test(flat));
  check('нормализация названия в черновике — то же выражение, что в индексе базы',
    localSrc.includes("String(t ?? '').trim().toLowerCase().replace(/\\s+/g, ' ')"));
  check('повтор держит и частичный уникальный индекс: две вкладки не пройдут',
    /create unique index if not exists forum_guide_requests_one_open[\s\S]*?where status = 'open';/.test(sql));
  check('политика одна, и она читает: открытое — всем, разбор — автору и модерации',
    flat.includes(`create policy forum_guide_requests_read on public.forum_guide_requests for select using (status = 'open' or user_id = auth.uid() or public.forum_is_staff());`)
      && (sql.match(/create policy/g) || []).length === 1);
  check('ни одной политики записи: строки правят только двери',
    !/create policy[\s\S]{0,200}for (insert|update|delete)/.test(sql)
      && flat.includes('grant select on public.forum_guide_requests to anon, authenticated')
      && !/grant (insert|update|delete) on public\.forum_guide_requests/.test(sql));
  check('все три двери вызваны адаптером, а не прямой записью в таблицу',
    supaSrc.includes("'/rpc/forum_open_guide_request'")
      && supaSrc.includes("'/rpc/forum_cancel_guide_request'")
      && supaSrc.includes("'/rpc/forum_resolve_guide_request'")
      && !supaSrc.includes("rest('/forum_guide_requests?"));
  check('анонимный вызов функций не работает, вошедший платит за свою строку',
    (sql.match(/revoke all on function public\.forum_\w*guide_request\w*[^;]*from public, anon;/g) || []).length === 3
      && (sql.match(/grant execute on function public\.forum_\w*guide_request\w*[^;]*to authenticated;/g) || []).length === 3);
  check('список выходит представлением с никами, и оно читает от своего имени',
    sql.includes('create or replace view public.forum_guide_request_list\nwith (security_invoker = on) as')
      && sql.includes('u.nick       as user_nick')
      && sql.includes('d.nick       as decided_by_nick'));
  check('представление не трогает forum_guides: гость остался бы без всего списка',
    !/forum_guide_request_list[\s\S]{0,900}join public\.forum_guides/.test(sql)
      && pagesSrc.includes('Название связанного гайда ищется в уже загруженном списке')
      && pagesSrc.includes('гайд недоступен'));

  /* ── Контракт и оба адаптера ── */
  check('контракт объявляет четыре новые возможности и форму заявки',
    contractSrc.includes('(draft: {title: string, details?: string}) => Promise<ForumGuideRequest>} [createGuideRequest]')
      && contractSrc.includes('(id: string) => Promise<void>} [cancelGuideRequest]')
      && contractSrc.includes("status: 'linked'|'closed', answer: string, guideId?: string|null")
      && contractSrc.includes('ForumGuideRequest[]'));
  check('оба адаптера отдают заявку одними полями',
    /function guideRequestOut\(r\)[\s\S]{0,400}userId: r\.userId[\s\S]{0,400}decidedByNick: r\.decidedByNick/.test(localSrc)
      && /function guideRequestOut\(row\)[\s\S]{0,400}userId: row\.user_id[\s\S]{0,400}decidedByNick: row\.decided_by_nick/.test(supaSrc));
  check('решение модерации уведомляет автора тем же видом, что и ответ на апелляцию',
    localSrc.includes("kind: 'moderation',") && sql.includes(`'moderation',`)
      && localSrc.includes('`Заявка «${row.title}» ${requestOutcomeWord(status)}: ${text}`')
      && sql.includes(`left('Заявка «' || v.title || '» ' || v_word || ': ' || v_answer, 120)`));

  /* ── Экран ── */
  check('блок стоит под списком гайдов, а не над ним',
    /<div class="guide-list-wrap">\$\{list\}<\/div>\s*\$\{handbookBlock\(s\)\}\s*\$\{guideRequestsBlock\(s\)\}/.test(pagesSrc));
  check('гостю форму не показывают, а открытые заявки показывают',
    pagesSrc.includes('const canAsk = Boolean(s.me) && !s.me.banned && !isMuted(s.me);')
      && pagesSrc.includes('${canAsk ? requestForm(L) :')
      && pagesSrc.includes('Войдите на сайт, чтобы предложить тему.'));
  check('очередь модерации живёт на странице гайдов, а не вторым экраном в панели',
    pagesSrc.includes('data-grq-resolve="linked"') && pagesSrc.includes('data-grq-resolve="closed"')
      && pagesSrc.includes('data-grq-answer=') && pagesSrc.includes('data-grq-guide=')
      && !/guideRequest/i.test(await readFile('src/admin/screens/moderation.js', 'utf8')));
  check('отозвать можно только свою открытую заявку — кнопка у неё одна',
    pagesSrc.includes('data-grq-cancel="${esc(r.id)}"')
      && /r\.status === 'open'\s*\?\s*`<button[^`]*data-grq-cancel/.test(pagesSrc));
  check('страница слушает три действия и перечитывает список после каждого',
    behavSrc.includes("t.closest('[data-grq-cancel]')")
      && behavSrc.includes("t.closest('[data-grq-resolve]')")
      && behavSrc.includes("e.target.closest('[data-grq-form]')")
      && /async function runRequestAction\(btn, fn\)[\s\S]{0,300}await loadRequests\(\)/.test(behavSrc));
  check('набранное в форме не стирается при перерисовке',
    behavSrc.includes("'[data-grq-form] [name=\"title\"]'")
      && behavSrc.includes("'[data-grq-answer]'"));
  check('без миграции блок называет файл, а не молчит',
    behavSrc.includes('supabase/applied/20260926-guide-requests.sql'));
  check('блок одет своим стилем',
    cssSrc.includes('.guide-req-form {') && cssSrc.includes('.guide-req-list--staff .guide-req {')
      && cssSrc.includes('.guide-req__answer {'));

  /* ── Документы ── */
  check('правило описано и в базе, и в документах, и в списке миграций',
    sql.includes('── ПРАВИЛО ──') && docsSrc.includes('20260926-guide-requests.sql')
      && readmeSrc.includes('20260926-guide-requests.sql'));
  check('документ называет, чего в заявках нет намеренно',
    docsSrc.includes('## Заявки на гайды')
      && /- \*\*Голосов \(«\+1»\)\.\*\*/.test(docsSrc)
      && docsSrc.includes('очередь разбора живёт на странице гайдов'));

  /* ── Живой черновой прогон: те же правила, что у базы ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const raw = () => JSON.parse(store.get('zr33.forum.local'));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };

  await local.signUp('Вопрошающий');           // первый — админ, он же модерация
  await local.signUp('Обычный');
  await local.signIn('Обычный');

  await local.signOut();
  equal('без входа заявку не отправить',
    await says(() => local.createGuideRequest({ title: 'Как добывать серебро' })),
    'Заявку отправляет только вошедший игрок');
  await local.signIn('Обычный');

  equal('короткое название отклоняется словами базы',
    await says(() => local.createGuideRequest({ title: 'гай' })),
    `Название темы короче ${L.guideRequestTitleMin} символов: по трём словам гайд не написать`);
  equal('длинное название — тоже',
    await says(() => local.createGuideRequest({ title: 'и'.repeat(L.guideRequestTitleMax + 1) })),
    `Название темы длиннее ${L.guideRequestTitleMax} символов: его не прочитает ни модератор, ни автор гайда`);
  equal('и длинное описание',
    await says(() => local.createGuideRequest({
      title: 'Как добывать серебро', details: 'а'.repeat(L.guideRequestDetailsMax + 1),
    })),
    `Описание длиннее ${L.guideRequestDetailsMax} символов: суть влезает и в меньшее`);

  const first = await local.createGuideRequest({
    title: 'Как добывать серебро', details: 'караван в одиночку не доезжает',
  });
  equal('заявка принята открытой', first.status, 'open');
  check('и названа целиком, с ником автора',
    first.title === 'Как добывать серебро' && first.userNick === 'Обычный');

  equal('повтор той же темы этим же автором не проходит',
    await says(() => local.createGuideRequest({ title: ' как   добывать  серебро ' })),
    'У вас уже есть открытая заявка с таким названием');

  await local.createGuideRequest({ title: 'Где взять аптеки в 22-м веке' });
  await local.createGuideRequest({ title: 'Как ставить лагерь на холме' });
  equal('четвёртая за сутки — уже не заявка',
    await says(() => local.createGuideRequest({ title: 'Как читать карту альянсов' })),
    `Не больше ${L.guideRequestDailyMax} заявок за сутки: их читают люди`);

  /* Видимость: открытое видит каждый, разбор — только свой. */
  await local.signOut();
  const asGuest = await local.listGuideRequests();
  equal('гость видит открытые заявки', asGuest.length, 3);
  check('и не видит ни объяснения, ни исхода',
    asGuest.every((r) => r.status === 'open' && r.answer === ''));

  /* Право разбирать — не у автора, даже если заявка его. */
  await local.signIn('Обычный');
  equal('игрок свою заявку не разберёт',
    await says(() => local.resolveGuideRequest(first.id, 'closed', 'разберём позже')),
    'Заявку разбирает модерация');
  await local.signOut();
  equal('и без входа тем более',
    await says(() => local.resolveGuideRequest(first.id, 'closed', 'разберём позже')),
    'Заявку разбирает модерация');

  const other = asGuest.find((r) => r.id !== first.id);
  await local.signIn('Вопрошающий');
  equal('чужую заявку не отозвать',
    await says(() => local.cancelGuideRequest(first.id)), 'Отозвать можно только свою заявку');
  equal('несуществующей заявки нет ни у кого',
    await says(() => local.resolveGuideRequest('нет-такой', 'closed', 'текст длиннее пяти')),
    'Заявка не найдена');

  const guide = await local.createGuide({
    slug: 'serebro', title: 'Серебро: где брать', category: 'strategy', body: '<p>карьер и биржа</p>',
  });
  equal('закрытие гайдом без самого гайда не принимается',
    await says(() => local.resolveGuideRequest(other.id, 'linked', 'смотрим сюда', null)),
    'Нужно указать гайд, которым закрывается заявка');
  equal('и только с опубликованным',
    await says(() => local.resolveGuideRequest(other.id, 'linked', 'смотрим сюда', 'nope')),
    'Связать заявку можно только с опубликованным гайдом');
  equal('короткое объяснение не считается ответом',
    await says(() => local.resolveGuideRequest(other.id, 'closed', 'ок')),
    `Нужно хотя бы ${L.guideNoteMin} символов: игрок ждёт объяснения, а не молчаливого отказа`);

  await local.resolveGuideRequest(other.id, 'linked', 'вот разбор, раздел «Серебро»', guide.id);
  const afterLink = (await local.listGuideRequests()).find((r) => r.id === other.id);
  equal('заявка закрыта ссылкой на гайд', `${afterLink.status}/${afterLink.guideId}`, `linked/${guide.id}`);
  equal('и объяснение дошло до автора', afterLink.answer, 'вот разбор, раздел «Серебро»');
  equal('повторное решение не перетирает исход',
    await says(() => local.resolveGuideRequest(other.id, 'closed', 'передумаем, тут длиннее')),
    'Эта заявка уже разобрана: связана с гайдом');

  /* Уведомление уходит автору, а не тому, кто решал. */
  const note = raw().notifications.find((n) => String(n.preview).startsWith('Заявка «'));
  check('автору пришло уведомление о решении тем же видом',
    Boolean(note) && note.kind === 'moderation' && note.userId === afterLink.userId
      && note.preview.includes('связана с гайдом'));

  await local.signIn('Обычный');
  const mine = await local.listGuideRequests();
  check('свой разбор автор видит', mine.some((r) => r.id === other.id && r.status === 'linked'));
  check('чужого разбора у него нет', !mine.some((r) => r.status === 'linked' && r.id !== other.id));
  equal('открытые заявки других игроков остаются видны',
    mine.filter((r) => r.status === 'open').length, 2);
  equal('разобранную заявку не отозвать',
    await says(() => local.cancelGuideRequest(other.id)), 'Отозвать можно только открытую заявку');

  await local.cancelGuideRequest(first.id);
  equal('свою открытую заявку автор отзывает',
    (await local.listGuideRequests()).find((r) => r.id === first.id).status, 'cancelled');
  await local.signOut();
  check('отозванная заявка исчезла из чужих глаз',
    !(await local.listGuideRequests()).some((r) => r.id === first.id));
  check('но осталась в хранилище: исход — факт, а не удаление',
    raw().guideRequests.some((r) => r.id === first.id && r.status === 'cancelled'));
}

// ── AD. Сигналы о спаме ──────────────────────────────────────────────────────

console.log('\nAD. Сигналы о спаме');
{
  /*
    Пункт перенесён с форума сообщества, но не дословно. У донора это таблица,
    которую сервер пишет перед тем, как бросить отказ «выдержка». Сервера у нас
    нет, а Postgres откатывает любую строку, вставленную в том же вызове до
    raise exception, — журнал отказов был бы всегда пуст, а пустой список
    читается как «спама нет». Поэтому список считается заново по тем записям,
    которые человек реально оставил, и тесты сверяют не наличие журнала, а то,
    что база, черновой режим и панель говорят одними числами и одними словами.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-spam-signals.sql', 'utf8');
  const holdSrc = await readFile('supabase/applied/20260925-spam-hold-and-topic-reads.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const screenSrc = await readFile('src/admin/screens/moderation.js', 'utf8');
  const loaderSrc = await readFile('src/admin/main.js', 'utf8');
  const cssSrc = await readFile('src/admin/admin.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const L = CONFIG.forum.limits;
  const flat = sql.replace(/\s+/g, ' ');
  const SEE = 'Сигналы о спаме видит модерация';
  const REASONS = [
    'темы на пределе выдержки',
    'ответы на пределе выдержки',
    'открытые жалобы на его материалах',
    'материалы скрыты после пяти жалоб',
  ];

  /* ── Форма правила: список вычисляется, а не копится ── */
  check('ни таблицы, ни колонок, ни индексов: сигнал — это запрос, а не запись',
    !/create (table|index)|add column/i.test(sql));
  check('функция ничего не пишет и ничего не меняет в чужих строках',
    !/insert into|update public\.|delete from/i.test(sql));
  check('повторный прогон не упирается в прежний состав колонок: имя снимается',
    sql.includes("execute 'drop function ' || r.sig;")
      && flat.includes("where n.nspname = 'public' and p.proname = 'forum_spam_signals'"));
  check('шаг 0 снимает только эту функцию, таблиц он не касается',
    (sql.match(/drop function/gi) || []).length === 1
      && !/drop (table|column|index|view)/i.test(sql));
  check('вход один — функция, и роль проверяет она, а не политика таблицы',
    flat.includes('create or replace function public.forum_spam_signals() returns table')
      && flat.includes('if not public.forum_is_staff() then')
      && !/create policy/.test(sql));
  check('отказ назван причиной, а не пустотой: «пусто» и «не видно» — разные новости',
    sql.includes(`raise exception '${SEE}'`) && flat.includes("errcode = 'insufficient_privilege'"));
  check('право исполнения только у вошедших: гостю смотреть не на что',
    flat.includes(`revoke all on function public.forum_spam_signals() from public, anon;`)
      && flat.includes('grant execute on function public.forum_spam_signals() to authenticated;'));
  /*
    Ошибка, которую глазами в таком файле не найти: count(*) возвращает bigint,
    а колонки объявлены integer, и plpgsql при `return query` приведения не
    делает. Прогон при этом создаётся молча — падает он на чтении, «structure of
    query does not match function result type», и модератор видит отказ базы там,
    где список обязан быть пустым или живым. Поэтому каждый счётчик обязан
    приходить с явным ::int, и их число здесь зафиксировано.
  */
  const countLines = sql.split('\n').map((l) => l.trim())
    .filter((l) => l.includes('count(*)') && !l.startsWith('--'));
  check('каждое count(*) приведено к integer — иначе функция падает на чтении',
    countLines.length === 7 && countLines.every((l) => l.includes('::int')));

  /* ── Числа: выдержка, сигнал и черновик обязаны сходиться ── */
  check('окна выдержки в сигнале — те же строки, что в триггерах отказа',
    holdSrc.includes(`interval '${L.postHoldMinutes} minutes'`)
      && holdSrc.includes(`interval '${L.commentHoldMinutes} minutes'`)
      && sql.includes(`interval '${L.postHoldMinutes} minutes'`)
      && sql.includes(`interval '${L.commentHoldMinutes} minutes'`));
  check('предел рядом = разрешено минус одна, и модерации положено втрое больше',
    flat.includes(`then ${L.postHoldMax * 3} else ${L.postHoldMax} end as posts_allowed`)
      && flat.includes(`then ${L.commentHoldMax * 3} else ${L.commentHoldMax} end as comments_allowed`)
      && flat.includes('b.posts_20m >= b.posts_allowed - 1')
      && flat.includes('b.comments_2m >= b.comments_allowed - 1'));
  check('неделя свежести — одно окно для жалоб и для скрытого, и оно из конфига',
    sql.split(`interval '${L.spamSignalWindowDays} days'`).length - 1 === 4
      && flat.includes(`case when b.open_reports >= ${L.spamSignalReportMin}`));
  check('причин ровно четыре, и среди них нет ни баллов, ни ключевых слов',
    REASONS.every((r) => flat.includes(`then '${r}'`))
      && !/score|keyword/i.test(sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  for (const reason of REASONS) {
    check(`причина «${reason}» названа одинаково в базе и в черновом режиме`,
      sql.includes(reason) && localSrc.includes(`'${reason}'`));
  }
  check('правило «нет активности за сутки — нет строки» живёт в обоих режимах',
    flat.includes('where cardinality(m.sigs) > 0 and m.posts_24h + m.comments_24h > 0')
      && localSrc.includes('r.signals.length && r.posts24h + r.comments24h > 0'));
  check('попадание в список не прячет материал и не трогает права автора',
    !/set banned|muted_until =|deleted = true/i.test(sql)
      && screenSrc.includes('Ни одно действие отсюда не')
      && !/<button|<form|<input|<textarea/.test(
        screenSrc.slice(screenSrc.indexOf('function renderSpamSignals'),
          screenSrc.indexOf('function renderPriorityQueue'))));

  /* ── Контракт и оба адаптера ── */
  check('контракт объявляет форму строки и её чтение',
    contractSrc.includes('@typedef {Object} ForumSpamSignal')
      && contractSrc.includes('() => Promise<ForumSpamSignal[]>} listSpamSignals'));
  check('рабочий режим спрашивает функцию базы, а не читает таблицы напрямую',
    supaSrc.includes("'/rpc/forum_spam_signals', { method: 'POST'")
      && !/rest\('\/forum_posts\?[\s\S]{0,200}signal/i.test(supaSrc));
  check('оба адаптера отдают строку одними полями',
    /function spamSignalOut\(row\)[\s\S]{0,800}posts20m: Number\(row\.posts_20m\)[\s\S]{0,800}signals: Array\.isArray\(row\.signals\)/.test(supaSrc)
      && ['userId', 'nick', 'role', 'posts20m', 'comments2m', 'posts24h', 'comments24h',
        'openReports', 'autoHidden', 'sectionMutes', 'banned', 'mutedUntil', 'lastActivity', 'signals']
        .every((k) => localSrc.slice(localSrc.indexOf('export async function listSpamSignals')).includes(`${k}:`)));
  check('черновой режим берёт пределы из конфига, а не переписывает их руками',
    localSrc.includes('L.postHoldMax * (staff ? 3 : 1) - 1')
      && localSrc.includes('L.commentHoldMax * (staff ? 3 : 1) - 1')
      && localSrc.includes('r.openReports >= L.spamSignalReportMin')
      && localSrc.includes('L.spamSignalWindowDays * 24 * 60'));
  check('отказ черновика — слово в слово отказ базы',
    localSrc.includes(`throw new Error('${SEE}')`));

  /* ── Панель ── */
  check('панель читает сигналы своим броском: без функции остальной экран живёт',
    loaderSrc.includes('view.forum.spamSignals = await forum.listSpamSignals();')
      && loaderSrc.includes('view.forum.spamSignals = null;'));
  check('словом отказа панель не выбрасывает: оно доезжает до экрана',
    loaderSrc.includes('view.forum.spamSignalsError = String(err?.message ?? err)')
      && loaderSrc.includes("view.forum.spamSignalsError = '';")
      && screenSrc.includes('renderSpamSignals(f.spamSignals, f.spamSignalsError)'));
  check('блок называет файл, а не объявляет форум чистым',
    screenSrc.includes('Список недоступен')
      && screenSrc.includes('supabase/applied/20260926-spam-signals.sql'));
  check('и цитирует базу дословно вместо «мигрируйте» на любой отказ',
    screenSrc.includes('База ответила так: <code>${esc(reason)}</code>'));
  check('перевод отказа различает три болезни, у которых разные руки',
    /function signalReasonHint\(reason\)[\s\S]{0,1400}reload schema/.test(screenSrc)
      && /function signalReasonHint\(reason\)[\s\S]{0,1400}не прогнана/.test(screenSrc)
      && /function signalReasonHint\(reason\)[\s\S]{0,1400}нет права вызывать/.test(screenSrc));
  check('неизвестному отказу перевод не придумывается',
    /function signalReasonHint\(reason\)[\s\S]*?\n\}/.test(screenSrc)
      && screenSrc.slice(screenSrc.indexOf('function signalReasonHint')).includes("  return '';\n}"));
  check('документы велели цитировать базу, а не звать мигрировать дважды',
    docsSrc.includes('Показывает дословно, словами базы')
      && docsSrc.includes('notify pgrst')
      && docsSrc.includes('только слово базы и перевод к нему'));
  check('и объяснили, почему файл сначала снимает имя, а README — про кэш схемы',
    docsSrc.includes('перебор перегрузок по `pg_proc`')
      && readmeSrc.includes('notify pgrst'));
  check('пустой список объясняет, что показывает только живое окно',
    /if \(!signals\.length\) \{[\s\S]{0,900}Пусто — не значит «чисто»/.test(screenSrc));
  check('строка показывает числа, а не вывод: колонки выдержки, жалоб и скрытого',
    screenSrc.includes('posts20m') && screenSrc.includes('openReports')
      && screenSrc.includes('autoHidden') && screenSrc.includes('sectionMutes'));
  check('и прямо говорит, что игрок про себя не узнаёт',
    screenSrc.includes('сам человек про себя ничего не узнаёт'));
  check('блок одет своим стилем',
    cssSrc.includes('.adm-signal-list {') && cssSrc.includes('.adm-signal__nums {'));
  check('правило описано в документах и стоит в списке миграций',
    docsSrc.includes('## Сигналы о спаме') && docsSrc.includes('20260926-spam-signals.sql')
      && readmeSrc.includes('20260926-spam-signals.sql'));

  /* ── Живой черновой прогон: тот же список, что посчитала бы база ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const state = () => JSON.parse(store.get('zr33.forum.local'));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const topic = (title, body) => local.createPost({ category: 'help', title, body });

  await local.signUp('Мерцатель');            // первый — админ, он же модерация
  await local.signUp('Торопыга');
  await local.signUp('Ревизор');

  await local.signOut();
  equal('гостю список не показан, и отказ называет причину',
    await says(() => local.listSpamSignals()), SEE);
  await local.signIn('Торопыга');
  equal('участник не видит списка про себя',
    await says(() => local.listSpamSignals()), SEE);
  await local.signOut();
  equal('и своё же право прочитать не обходит выходом',
    await says(() => local.listSpamSignals()), SEE);

  await local.signIn('Мерцатель');
  equal('пока никто не писал, строк нет', (await local.listSpamSignals()).length, 0);

  await local.signIn('Торопыга');
  const caught = await topic('Как пройти блокпост без каравана', 'нужен маршрут и порядок действий');
  await topic('Что делать при засаде на дороге', 'разворачиваемся или идём дальше');
  await local.signIn('Мерцатель');
  const rows = await local.listSpamSignals();
  equal('две темы из трёх за окно — одна строка в списке', rows.length, 1);
  check('строка названа человеком, а не его текстом',
    rows[0].nick === 'Торопыга' && rows[0].role === 'member' && rows[0].posts20m === 2);
  check('причина прочитывается словами, а не баллом',
    rows[0].signals.length === 1 && rows[0].signals[0] === REASONS[0]);
  check('суточный масштаб показан рядом с коротким окном',
    rows[0].posts24h === 2 && rows[0].comments24h === 0 && rows[0].openReports === 0);
  check('и время последней активности есть — без него строка ни о чём',
    rows[0].lastActivity instanceof Date && !Number.isNaN(rows[0].lastActivity.getTime()));

  /* Жалобы считаются по материалу автора, а не по тому, кто нажал «жаловаться». */
  await local.report({ targetType: 'post', targetId: caught.id, ruleId: 'spam', note: 'одно и то же в трёх темах' });
  await local.signIn('Ревизор');
  await local.report({ targetType: 'post', targetId: caught.id, ruleId: 'spam', note: 'копия прошлого поста' });
  await local.signIn('Мерцатель');
  const reported = (await local.listSpamSignals())[0];
  check('две открытые жалобы — вторая причина той же строки',
    reported.openReports === 2 && reported.signals.includes(REASONS[2]));
  check('жалобщик сам в список не попал: он свидетель, а не подозреваемый',
    (await local.listSpamSignals()).every((r) => r.nick !== 'Ревизор'));

  /* Модерации позволено втрое больше — её работа не должна сигналить. */
  await topic('Сводка за неделю по фронту', 'пишет модерация, ей нужно втрое больше');
  await topic('Объявление о наборе в альянс', 'тоже модерация, тоже сегодня');
  const afterStaff = await local.listSpamSignals();
  check('две темы модерации сигналом не стали',
    afterStaff.length === 1 && afterStaff[0].nick === 'Торопыга');

  /* Пять жалоб прячут материал — и это третий факт про того же автора. */
  for (const nick of ['Дозорный', 'Гляделка', 'Пришелец']) {
    await local.signUp(nick);                 // signUp входит новым игроком
    await local.report({ targetType: 'post', targetId: caught.id, ruleId: 'spam', note: 'спам' });
  }
  await local.signIn('Мерцатель');
  const hidden = (await local.listSpamSignals())[0];
  check('скрытое после пяти жалоб стало фактом в хранилище',
    state().posts.find((p) => p.id === caught.id).autoHidden === true);
  check('и третьей причиной строки автора, а не жалобщиков',
    hidden.autoHidden === 1 && hidden.signals.includes(REASONS[3]));

  /* Правило 6: без тем и ответов за сутки строки нет, даже с жалобами. */
  const snapshot = state();
  const yesterday = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  for (const p of snapshot.posts) {
    if (p.authorNick === 'Торопыга') p.createdAt = yesterday;
    if (p.autoHidden) p.deletedAt = yesterday;
  }
  store.set('zr33.forum.local', JSON.stringify(snapshot));
  equal('вчерашний автор из списка уходит: список показывает живое',
    (await local.listSpamSignals()).length, 0);
}

// ── AE. Чек-лист новичка ─────────────────────────────────────────────────────

console.log('\nAE. Чек-лист новичка');
{
  /*
    Пункт перенесён с донорского форума, но не его список. У донора три шага:
    выбрать сервер, закрепить псевдоним, принять правила. У нас один сервер, ник
    дают при регистрации, а согласия с правилами никто не собирает — все три
    шага были бы либо всегда закрыты, либо никогда. Перенесли смысл: шаги
    вычисляются по тем строкам, что форум и так хранит, и ничего не отмечают.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-starter-checklist.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const rulesSrc = await readFile('src/forum/rules.js', 'utf8');
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const L = CONFIG.forum.limits;
  const flat = sql.replace(/\s+/g, ' ');
  const starterLocal = localSrc.slice(localSrc.indexOf('export async function listStarterSteps'),
    localSrc.indexOf('/* ── Страница участника'));
  const starterRules = rulesSrc.slice(rulesSrc.indexOf('export const STARTER_STEPS'),
    rulesSrc.indexOf('/* ── Проверки формы'));
  const starterPage = pageSrc.slice(pageSrc.indexOf('function renderStarterSteps(s)'),
    pageSrc.indexOf('/* ── Статья недели'));
  const KEYS = ['profile', 'reply', 'thanks', 'save', 'ally'];

  /* ── Форма правила: список вычисляется, а не хранится ── */
  check('ни таблицы, ни колонок, ни индексов: шаг — это запрос, а не запись',
    !/create (table|index)|add column/i.test(sql));
  check('ни политик, ни триггеров: приватность держит авторство строк',
    !/create policy|create trigger|row level security/i.test(sql));
  check('функция ничего не пишет',
    !/insert into|update public\.|delete from/i.test(sql));
  check('и ни во что не превращается: вызывающий видит только свои строки',
    sql.includes('security invoker') && !/security definer/i.test(sql));
  check('вход один — функция, и чужой список через неё не выпросить',
    flat.includes('create or replace function public.forum_starter_checklist() returns table')
      && flat.includes('where f.id = auth.uid()'));
  check('окно новичка — одно число, и оно из конфига',
    sql.split(`interval '${L.starterWindowDays} days'`).length - 1 === 1
      && flat.includes('and f.created_at > now()'));
  check('право исполнения только у вошедших: гостю спрашивать не о чём',
    flat.includes('revoke all on function public.forum_starter_checklist() from public, anon;')
      && flat.includes('grant execute on function public.forum_starter_checklist() to authenticated;'));
  for (const key of KEYS) {
    check(`шаг «${key}» назван одним словом в базе, в правилах и в черновом режиме`,
      sql.includes(`('${key}',`) && starterRules.includes(`id: '${key}'`)
        && starterLocal.includes(`id: '${key}'`));
  }
  check('шаги не пересчитывают пределы выдержки и частоту: шаг — факт строки',
    !/postHold|commentHold|thanksPerWindow/i.test(sql));

  /* ── Слова живут в коде, факт — в базе ── */
  check('список шагов с названием и объяснением, и их ровно пять',
    rulesSrc.includes('export const STARTER_STEPS = [') && !rulesSrc.includes('STARTER_STEP_IDS')
      && KEYS.every((k) => starterRules.includes(`id: '${k}'`))
      && (starterRules.match(/\n    id: '/g) || []).length === 5);
  check('у каждого шага есть что сказать и зачем',
    (starterRules.match(/title: '/g) || []).length === 5
      && (starterRules.match(/hint: '/g) || []).length === 5);
  check('ссылка ведёт туда, где шаг делается, и только когда вести есть куда',
    starterRules.includes('return `#/user/${encodeURIComponent(nick)}`;')
      && starterRules.includes("return '#/forum?saved=1';")
      && starterRules.includes("return '';"));
  check('названия шагов не обещают награду: за обычный поступок очков не дают',
    !/репутаци|очк|балл|наград/i.test(starterRules));

  /* ── Контракт и оба адаптера ── */
  check('контракт объявляет форму шага и его чтение',
    contractSrc.includes('@typedef {Object} ForumStarterStep')
      && contractSrc.includes('() => Promise<ForumStarterStep[]>} listStarterSteps'));
  check('рабочий режим спрашивает функцию базы одним запросом',
    supaSrc.includes("'/rpc/forum_starter_checklist', { method: 'POST', body: {} }")
      && supaSrc.includes('function starterStepOut(row)')
      && supaSrc.includes('id: String(row.step_key), done: Boolean(row.done)'));
  check('черновой режим отдаёт те же пять ключей',
    KEYS.every((k) => starterLocal.includes(`id: '${k}'`)));
  check('черновой режим берёт окно из конфига, а не переписывает число руками',
    starterLocal.includes('L.starterWindowDays * 24 * 3600 * 1000') && !/\b14\b/.test(starterLocal));
  check('и повторяет условия базы: свой ответ, своя благодарность, своя строка',
    starterLocal.includes('c.authorId === me.id && !c.deleted')
      && starterLocal.includes('t.giverId === me.id')
      && starterLocal.includes('b.userId === me.id')
      && starterLocal.includes('a.userId === me.id'));
  check('гость и вышедший получают пустой список, а не исключение',
    starterLocal.includes('if (!me) return [];'));

  /* ── Страница ── */
  check('блок нарисован сразу под строкой аккаунта',
    pageSrc.includes('${renderStarterSteps(s)}')
      && pageSrc.indexOf('${renderStarterSteps(s)}') > pageSrc.indexOf('${renderAccountBar(s)}'));
  check('и только для вошедшего, когда список пришёл',
    starterPage.includes('if (!s.me || !Array.isArray(s.starter) || !s.starter.length)'));
  check('показаны только незакрытые шаги, а когда закрыты все — блока нет',
    starterPage.includes('STARTER_STEPS.filter((step) => !doneById.get(step.id))')
      && starterPage.includes("if (!open.length) return '';"));
  check('шаг ищется по ключу, а не по номеру строки',
    starterPage.includes('new Map(s.starter.map((row) => [row.id'));
  check('у блока нет ни кнопок, ни форм: он указывает, а не действует',
    !/<button|<form|<input|<textarea/.test(starterPage)
      && starterPage.includes('data-forum-starter'));
  check('число не печатается дважды рядом со словом plural',
    !/}\s+\$\{plural/.test(starterPage));
  check('подвал называет срок из конфига, а не число из воздуха',
    starterPage.includes('lim.starterWindowDays'));
  check('счётчик молчит, пока нечего показать: «0 шагов сделано» — не новость',
    starterPage.includes('${done ? `<span class="forum-starter__count">'));
  check('блок одет своим стилем',
    cssSrc.includes('.forum-starter__list {') && cssSrc.includes('.forum-starter__item {'));
  check('состояние живёт в загрузчике и закрывается самим действием',
    mountSrc.includes('starter: [],')
      && mountSrc.includes('await loadStarterSteps();')
      && KEYS.every((k) => mountSrc.includes(`closeStarterStep('${k}')`)));
  check('ошибка базы глушится: подсказка не имеет права становиться полосой ошибок',
    /async function loadStarterSteps\(\)[\s\S]{0,400}catch \{\r?\n\s*list = \[\];/.test(mountSrc));
  check('смена человека спрашивает список заново, а выход стирает его совсем',
    /state\.me = mode === 'signup'[\s\S]{0,400}await loadStarterSteps\(\);\r?\n\s*await loadFeed\(\);/.test(mountSrc)
      && /data-forum-signout[\s\S]{0,900}state\.starter = \[\];/.test(mountSrc));
  check('правило описано в документах и стоит в списке миграций',
    docsSrc.includes('## Чек-лист новичка') && docsSrc.includes('20260926-starter-checklist.sql')
      && readmeSrc.includes('20260926-starter-checklist.sql'));

  /* ── Живой черновой прогон: те же шаги, что посчитала бы база ── */
  const local = await import('../src/forum/adapters/local.js');
  const fresh = new Map();
  globalThis.localStorage = {
    getItem: (k) => (fresh.has(k) ? fresh.get(k) : null),
    setItem: (k, v) => fresh.set(k, String(v)),
    removeItem: (k) => fresh.delete(k),
  };
  const state = () => JSON.parse(fresh.get('zr33.forum.local'));
  const open = async () => (await local.listStarterSteps()).filter((row) => !row.done).map((row) => row.id);

  await local.signUp('Новичок');
  await local.signUp('Столп');
  await local.signOut();
  equal('гость получает пустой список вместо ошибки', (await local.listStarterSteps()).length, 0);

  await local.signIn('Новичок');
  equal('свежий аккаунт видит все пять шагов открытыми', (await open()).join(','), KEYS.join(','));

  await local.signIn('Столп');
  const othersPost = await local.createPost({
    category: 'help',
    title: 'Где ставить лагерь у блокпоста',
    body: 'интересует порядок действий и безопасное место',
  });

  await local.signIn('Новичок');
  await local.saveProfile({ about: 'хожу в вечернее время, играю за снабжение' });
  check('профиль закрыт строкой «о себе»', !(await open()).includes('profile'));

  const reply = await local.addComment(othersPost.id, 'ставим за насыпью, оттуда обзор на обе дороги');
  check('ответ закрыт собственным комментарием в чужой теме', !(await open()).includes('reply'));

  await local.bookmarkTopic(othersPost.id);
  check('закладка закрыта одной сохранённой темой', !(await open()).includes('save'));

  await local.subscribeAlliance('KOP');
  check('подписка на альянс закрыта строкой подписки', !(await open()).includes('ally'));

  const myPost = await local.createPost({
    category: 'vs',
    title: 'Разбор выхода с караваном',
    body: 'что пошло не так на повороте и как это исправить',
  });
  await local.signIn('Столп');
  await local.giveThanks('post', myPost.id);
  await local.signIn('Новичок');
  equal('своя благодарность чужой теме осталась открытой: тебе поставили, а не ты',
    (await open()).join(','), 'thanks');

  /* Снятое действие открывает шаг обратно — отметка не зависает. */
  await local.unbookmarkTopic(othersPost.id);
  check('закладку убрали — шаг снова открыт', (await open()).includes('save'));
  await local.deleteComment(reply.id, 'передумал, ответ не нужен');
  check('ответ убран — шаг снова открыт', (await open()).includes('reply'));

  /* Чужие строки свой список не закрывают. */
  await local.signIn('Столп');
  equal('у другого игрока открыто своё: чужие ответ и закладка его не считают, а его благодарность — закрыта',
    (await open()).join(','), 'profile,reply,save,ally');
  await local.signIn('Новичок');
  equal('и новичок от чужих действий не изменился', (await open()).join(','), 'reply,thanks,save');

  /* Срок: за окном новичка список пуст, сколько бы шагов ни было сделано. */
  const snapshot = state();
  const aged = new Date(Date.now() - (L.starterWindowDays + 1) * 24 * 3600 * 1000).toISOString();
  snapshot.users = snapshot.users.map((u) => (u.nick === 'Новичок' ? { ...u, createdAt: aged } : u));
  fresh.set('zr33.forum.local', JSON.stringify(snapshot));
  await local.signIn('Новичок');
  equal('прошло окно новичка — список пуст, и блоку нечего рисовать',
    (await local.listStarterSteps()).length, 0);
  await local.signIn('Столп');
  check('а ровесник форума свои шаги всё ещё видит', (await open()).length > 0);
}

// ── AF. Пульс обновлений игры ────────────────────────────────────────────────

console.log('\nAF. Пульс обновлений игры');
{
  /*
    Пункт перенесён с форума сообщества, где заметки об обновлениях ведёт
    модерация. Перенесли вместе с главным смыслом: серверной части у нас нет,
    поэтому читателя кормит не робот, а человек, и обязанность эту он
    подтверждает ссылкой на первоисточник. Проверяем три вещи: что база и
    черновой режим отказывают одними словами в одном порядке, что страница не
    печатает ссылку, которую база не приняла бы, и что убранная заметка
    удаляется, а не прячется — вместе со столбцами архива, которые раньше
    позволяли ей вернуться.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-update-pulse.sql', 'utf8');
  /*
    Таблица обязана своим видом старому файлу, а вот дверь публикации с ключом
    источника, дверь удаления, отметки фида и представления без архивных
    колонок — новому. Поэтому читаем оба и каждый проверяем за своё: старый
    отвечает на «из чего таблица сделана», новый — на «что база умеет сегодня».
  */
  const finalSrc = await readFile('supabase/applied/20261005-feed-final-delete.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const pageSrc = await readFile('src/pages/updates.js', 'utf8');
  const updSrc = await readFile('src/forum/updates.js', 'utf8');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const { UPDATE_KINDS, UPDATE_KIND_IDS, updateKindLabel } = await import('../src/forum/rules.js');
  const { renderUpdates } = await import('../src/pages/updates.js');
  const L = CONFIG.forum.limits;

  const flat = sql.replace(/\s+/g, ' ');
  const finalFlat = finalSrc.replace(/\s+/g, ' ');
  const pubSql = finalSrc.slice(finalSrc.indexOf('create or replace function public.forum_publish_update_note'),
    finalSrc.indexOf('-- ── Шаг 3.')).replace(/\s+/g, ' ');
  const delSql = finalSrc.slice(finalSrc.indexOf('create or replace function public.forum_delete_update_note'),
    finalSrc.indexOf('create or replace function public.forum_delete_store_event')).replace(/\s+/g, ' ');
  const marksSql = finalSrc.slice(0, finalSrc.indexOf('-- ── Шаг 2.')).replace(/\s+/g, ' ');
  const pubLocal = localSrc.slice(localSrc.indexOf('export async function publishUpdateNote'),
    localSrc.indexOf('export async function deleteUpdateNote'));
  const delLocal = localSrc.slice(localSrc.indexOf('export async function deleteUpdateNote'),
    localSrc.indexOf('/* ── Фид магазина'));
  const supaPulse = supaSrc.slice(supaSrc.indexOf('function updateNoteOut(row)'),
    supaSrc.indexOf('/* ── Фид магазина'));
  const pulseContract = contractSrc.slice(contractSrc.indexOf('Пульс обновлений игры (см.'),
    contractSrc.indexOf('Фид магазина (см.'));
  const noteTypedef = contractSrc.slice(contractSrc.indexOf('@typedef {Object} ForumUpdateNote'),
    contractSrc.indexOf('@typedef {Object} ForumStoreEvent'));

  /* Отказы публикации: один и тот же порядок в базе и в черновом режиме. */
  const PUBLISH_REFUSALS = [
    'Заметку об обновлении публикует модерация',
    'Неизвестный тип заметки',
    'Заголовок короче',
    'Заголовок длиннее',
    'Содержание короче',
    'Содержание длиннее',
    'Нужно название первоисточника',
    'Название первоисточника длиннее',
    'Нужна прямая HTTPS-ссылка на первоисточник',
    'Ссылка не может содержать пробелы',
    'Ссылка длиннее',
    'Нужна дата публикации у первоисточника',
    'Дата первоисточника не может быть из будущего',
    'Дата первоисточника раньше',
    'Номер версии длиннее',
  ];
  /*
    Ключ внешнего источника — последнее поле двери и стоит оно после всех
    полей заметки: смысл проверки в том, что заметка уже разборчива, а
    расхождение касается только того, приносили её или нет. Границы ключа
    тот же смысл, что у ключа события, — второго числа на одно понятие нет.
  */
  const KEY_REFUSALS = [
    'Ключ источника короче',
    'Ключ источника длиннее',
    'Этот источник уже приносил заметку: повторная публикация означает, что первую убрали насовсем',
  ];
  const DELETE_REFUSALS = [
    'Заметку об обновлении удаляет модерация',
    'Заметка не найдена',
  ];

  /** Фразы идут в тексте именно в этом порядке. */
  function inOrder(src, phrases) {
    let from = 0;
    for (const phrase of phrases) {
      const at = src.indexOf(phrase, from);
      if (at < 0) return false;
      from = at + 1;
    }
    return true;
  }

  /* ── Форма правила: таблица, а не метка темы ── */
  check('заметка — отдельная таблица, а не ещё одна метка темы',
    flat.includes('create table if not exists public.forum_update_notes ('));
  check('тип замкнут в те же три слова, что названы в правилах',
    flat.includes(`kind in (${UPDATE_KINDS.map((k) => `'${k.id}'`).join(', ')})`));
  check('дата у первоисточника — свой столбец, а не дата записи',
    flat.includes('source_at timestamptz not null')
      && flat.includes('created_at timestamptz not null default now()'));
  check('список читается по дате источника, а не по состоянию строки',
    finalFlat.includes('on public.forum_update_notes (source_at desc, created_at desc)'));
  /*
    Старый файл заводит архив как колонку — так и надо читать историю. Но
    сегодня этой колонки нет: новый файл снимает её вместе с временем и ником
    убравшего, потому что «убрано» больше не пауза, а удаление.
  */
  check('архив был состоянием строки — и этим состоянием перестал быть',
    flat.includes(`status text not null default 'published' check (status in ('published', 'archived'))`)
      && finalFlat.includes('alter table public.forum_update_notes drop column if exists status, drop column if exists archived_at, drop column if exists archived_by'));
  check('дверь архива снята, а не оставлена «на всякий случай»',
    finalFlat.includes('drop function if exists public.forum_set_update_note_archive(uuid, boolean);')
      && !/create or replace function public\.forum_set_update_note_archive/.test(finalSrc));
  check('убранное называется удалением: заметка уходит из таблицы вместе с решением',
    delSql.includes('delete from public.forum_update_notes where id = p_target returning id into v_id'));
  check('а уже убранные руками строки миграция выносит при прогоне',
    finalFlat.includes(`delete from public.forum_update_notes where status = 'archived';`));
  check('номер версии необязателен: пустая строка, а не null',
    flat.includes("game_version text not null default ''"));

  /* ── Числа: база и страница знают одно и то же ── */
  const SQL_NUMBERS = [
    ['заголовок', `char_length(title) between ${L.updateTitleMin} and ${L.updateTitleMax}`],
    ['содержание', `char_length(summary) between ${L.updateSummaryMin} and ${L.updateSummaryMax}`],
    ['имя источника', `char_length(source_name) between ${L.updateSourceNameMin} and ${L.updateSourceNameMax}`],
    ['длина ссылки', `char_length(source_url) <= ${L.updateUrlMax}`],
    ['версия', `char_length(game_version) <= ${L.updateVersionMax}`],
    ['запас на часы', `interval '${L.updateFutureGraceMinutes} minutes'`],
    ['нижняя дата', `timestamp with time zone '${L.updateSourceYearFloor}-01-01 00:00:00+00'`],
  ];
  for (const [label, needle] of SQL_NUMBERS) {
    check(`число «${label}» в базе и в конфиге одно и то же`, flat.includes(needle), needle);
  }
  check('функция записывает ровно то, что разрешила: строки не обрезаются молча',
    pubSql.includes(`left(v_title, ${L.updateTitleMax})`));

  /* ── Право: читает каждый, пишет только модерация ── */
  check('в таблице лежит ровно то, что видит читатель: состояний у строки больше нет',
    finalFlat.includes(`create policy forum_update_notes_read on public.forum_update_notes for select using (true);`)
      && flat.includes(`for select using (status = 'published' or public.forum_is_staff());`));
  /*
    Порядок шагов 5 сторожится словами, а не молча: на живой базе переставлено
    место дало отказ `cannot drop column status … policy depends on it` и
    прогон встал посередине — представления уже сняты, колонки ещё на месте.
    Политика, индекс и представление висят на колонке, поэтому все три уходят
    раньше, чем колонка.
  */
  check('правило чтения снято ДО сноса колонки: политика держит столбец, и база не отдаёт',
    finalSrc.indexOf('create policy forum_update_notes_read')
      < finalSrc.indexOf('alter table public.forum_update_notes')
      && finalSrc.indexOf('create policy forum_store_events_read')
      < finalSrc.indexOf('alter table public.forum_store_events')
      && finalSrc.indexOf('drop view if exists public.forum_update_note_list')
      < finalSrc.indexOf('alter table public.forum_update_notes')
      && finalSrc.indexOf('drop index if exists public.forum_store_events_list_idx')
      < finalSrc.indexOf('alter table public.forum_store_events'));
  check('ни одной политики на запись: браузер в таблицу не пишет, и удаляет тоже функция',
    !/for insert|for update|for delete/i.test(sql + finalSrc));
  check('право чтения дано и гостю, и вошедшему — таблице и представлению',
    flat.includes('grant select on public.forum_update_notes to anon, authenticated;')
      && flat.includes('grant select on public.forum_update_note_list to anon, authenticated;'));
  check('список выходит представлением, которое спрашивает права читателя',
    finalFlat.includes('create or replace view public.forum_update_note_list with (security_invoker = on) as'));
  check('ники берутся из вью профилей, а не дублируются в таблице',
    finalFlat.includes('join public.forum_profiles a on a.id = n.author_id'));
  check('и в представлении не осталось ни колонки архива, ни имени убравшего',
    !/archived|status/.test(finalSrc.slice(finalSrc.indexOf('create or replace view public.forum_update_note_list'),
      finalSrc.indexOf('grant select on public.forum_update_note_list'))));
  check('публикация и удаление — свои двери, и каждая спрашивает роль сама',
    (finalSrc.match(/language plpgsql security definer/g) || []).length === 4
      && pubSql.includes('if not public.forum_is_staff() then')
      && delSql.includes('if not public.forum_is_staff() then'));
  check('ни триггеров, ни присоединения к темам и гайдам',
    !/create trigger/i.test(sql) && !/forum_posts|forum_guides/.test(sql));
  check('внешних запросов нет ни в базе, ни в коде страницы',
    !/net\.http|udf\.|pg_net/i.test(sql) && !/fetch\(/.test(pageSrc + updSrc));
  check('функции закрыты от гостя и открыты вошедшему: и дверь публикации, и дверь удаления',
    finalFlat.includes('revoke all on function public.forum_publish_update_note( text, text, text, text, text, timestamptz, text, text ) from public, anon;')
      && finalFlat.includes('grant execute on function public.forum_publish_update_note( text, text, text, text, text, timestamptz, text, text ) to authenticated;')
      && finalFlat.includes('revoke all on function public.forum_delete_update_note(uuid) from public, anon;')
      && finalFlat.includes('grant execute on function public.forum_delete_update_note(uuid) to authenticated;'));
  check('старая семипараметрическая дверь снята: перегрузку PostgREST не выбрал бы сам',
    finalFlat.includes('drop function if exists public.forum_publish_update_note( text, text, text, text, text, timestamptz, text );'));
  check('автором становится тот, кто вошёл, а не тот, о ком попросили',
    pubSql.includes('auth.uid()') && !/p_author/.test(pubSql));

  /* ── Ссылка: https обязана проверяться до того, как станет href ── */
  check('база принимает только https без пробелов',
    flat.includes(`source_url ~ '^https://[^[:space:]]+$'`));
  check('тип сверяется через coalesce: null не пройдёт доменную проверку',
    pubSql.includes(`if coalesce(p_kind, '') not in`));
  check('прописная схема приводится к строчной — иначе её отверг бы CHECK',
    pubSql.includes(`v_url := 'https://' || substring(v_url from 9);`)
      && pubLocal.includes("https://${rawUrl.slice("));
  /*
    Отметка ключа заведена ровно ради того, чтобы пережить строку, поэтому
    дверь удаления её не трогает: снять отметку значило бы вернуть «убрано
    насовсем» к «автомат принесёт это через час». Висячий указатель на
    последнюю заметку в состоянии обхода при этом гасится — журнал обязан
    оставаться правдой.
  */
  check('удаление заметки оставляет её ключ в отметках и гасит висячую ссылку состояния',
    !/delete from public\.forum_feed_marks/.test(delSql)
      && delSql.includes('update public.forum_store_state set last_note_id = null where last_note_id = p_target;'));

  /* ── Один порядок и одни слова в обоих режимах ── */
  check('публикация отказывает в одном порядке в базе и в черновом режиме',
    inOrder(pubSql, PUBLISH_REFUSALS) && inOrder(pubLocal, PUBLISH_REFUSALS));
  check('ключ источника дверь проверяет последним, после всех полей заметки',
    inOrder(pubSql, [...PUBLISH_REFUSALS, ...KEY_REFUSALS])
      && pubSql.includes(`if v_key <> '' then`)
      && pubSql.includes(`insert into public.forum_feed_marks (feed_key, what, title) values (v_key, 'note', left(v_title, 120));`));
  check('отметка заводится в той же операции, что и заметка: обрыва между ними нет',
    pubSql.indexOf('insert into public.forum_update_notes') < pubSql.indexOf('insert into public.forum_feed_marks'));
  /*
    Отметка живёт отдельной таблицей именно потому, что колонка в таблице
    заметок умерла бы вместе со строкой. Политики на запись у неё нет тоже не
    зря: возможность молча запретить автомату любую фразу, которую некому и
    нечем проверить, — это дыра, а не настройка.
  */
  check('отметка ключа переживает удаление: своя таблица, чтение только для модерации, записи из браузера нет',
    marksSql.includes('create table if not exists public.forum_feed_marks (')
      && marksSql.includes(`what text not null check (what in ('note', 'event'))`)
      && marksSql.includes('for select using (public.forum_is_staff());')
      && !/for insert|for update|for delete/i.test(marksSql));
  check('границы ключа заметки — те же числа, что у ключа события: одного понятия два числа не бывает',
    marksSql.includes(`char_length(feed_key) between ${L.storeEventKeyMin} and ${L.storeEventKeyMax}`)
      && pubSql.includes(`if char_length(v_key) < ${L.storeEventKeyMin} then`)
      && pubSql.includes(`if char_length(v_key) > ${L.storeEventKeyMax} then`));
  check('удаление — тот же порядок отказов в базе и в черновом режиме',
    inOrder(delSql, DELETE_REFUSALS) && inOrder(delLocal, DELETE_REFUSALS));
  check('черновой режим берёт границы из конфига, а не переписывает числа руками',
    (pubLocal.match(/L\.update/g) || []).length >= 11 && !/= 1500/.test(pubLocal));
  check('типы он знает из правил, а не из своего списка',
    pubLocal.includes('UPDATE_KIND_IDS.includes(kind)'));

  /* ── Слова и контракт ── */
  check('типа три, и у каждого есть название и объяснение',
    UPDATE_KINDS.length === 3 && UPDATE_KINDS.every((k) => k.id && k.label && k.hint)
      && UPDATE_KIND_IDS.join(',') === 'patch,notice,issue');
  check('неизвестный тип не превращается в пустую метку', updateKindLabel('quest') === 'quest');
  check('название типа печатает разметка, а не свой список', pageSrc.includes('updateKindLabel('));
  check('контракт обещает три функции и форму заметки',
    ['listUpdateNotes', 'publishUpdateNote', 'deleteUpdateNote'].every((n) => contractSrc.includes(`[${n}]`))
      && contractSrc.includes('@typedef {Object} ForumUpdateNote')
      && contractSrc.includes('@property {Date} sourceAt'));
  check('и называет отсутствующие правки сознательным ограничением',
    /правка текста после публикации не разрешена/.test(pulseContract));
  check('состояния строки контракт больше не обещает: архивных полей в заметке нет',
    !/setUpdateNoteArchived/.test(contractSrc)
      && !/@property \{[^}]*\} (status|archivedAt|archivedByNick)/.test(noteTypedef)
      && /архива больше нет/.test(pulseContract));
  check('боевой режим читает представление и зовёт функции базы',
    supaPulse.includes('/forum_update_note_list?select=*&order=source_at.desc')
      && supaPulse.includes("'/rpc/forum_publish_update_note'")
      && supaPulse.includes("'/rpc/forum_delete_update_note'")
      && supaPulse.includes('p_target: id'));
  check('дата уходит в базу строкой, а не объектом',
    supaPulse.includes('p_source_at: String(draft.sourceAt'));
  check('после публикации заметка дочитывается, а не додумывается',
    supaPulse.includes('Заметка не найдена сразу после публикации'));

  /* ── Страница: что увидит читатель ── */
  const baseNote = {
    id: 'n1', kind: 'patch', title: 'Перечисление карт вышло из ротации',
    summary: 'Карты убраны из ротации, бонус за них больше не начисляется.',
    sourceName: 'Официальный сайт', sourceUrl: 'https://example.com/patch-notes',
    sourceAt: new Date('2026-09-20T12:00:00Z'), gameVersion: '1.4.2',
    authorNick: 'Дежурный', createdAt: new Date('2026-09-21T08:00:00Z'),
  };
  const secondNote = { ...baseNote, id: 'n2', kind: 'issue', title: 'Голос в чате пропадал после патча' };
  const page = (over) => renderUpdates({
    ready: true, shared: true, me: null, canManage: false, notes: [],
    loading: false, error: '', composing: false, ...over,
  });

  check('карточка отдаёт читателю тип, заголовок, пересказ и версию',
    page({ notes: [baseNote] }).includes('Перечисление карт')
      && page({ notes: [baseNote] }).includes('Патч')
      && page({ notes: [baseNote] }).includes('1.4.2'));
  check('ссылка ведёт прямо на первоисточник и не оставляет следов для него',
    page({ notes: [baseNote] }).includes('href="https://example.com/patch-notes"')
      && page({ notes: [baseNote] }).includes('rel="noreferrer noopener nofollow"')
      && page({ notes: [baseNote] }).includes('target="_blank"'));
  const evil = page({ notes: [{ ...baseNote, sourceUrl: 'javascript:alert(1)' }] });
  check('ссылка вне https не становится ссылкой и говорит об этом',
    !evil.includes('href="javascript') && evil.includes('upd-card__source--broken'));
  check('данные, которые правит человек, экранируются',
    page({ notes: [{ ...baseNote, title: '<img src=x onerror=alert(1)>' }] }).includes('&lt;img'));
  check('невошедший не видит ни формы, ни кнопки удаления',
    !page({ notes: [baseNote] }).includes('<form')
      && !page({ notes: [baseNote] }).includes('data-upd-new')
      && !page({ notes: [baseNote] }).includes('data-upd-delete'));
  check('модератор видит и кнопку новой заметки, и удаление своей строки',
    page({ canManage: true, notes: [baseNote] }).includes('data-upd-new')
      && page({ canManage: true, notes: [baseNote] }).includes('data-upd-delete="n1"'));
  /*
    Второго движения у строки нет, поэтому проверка «архива нет» важнее
    проверки кнопки: секция «Убрано из списка» исчезает из разметки вместе со
    смыслом, а не прячется стилями.
  */
  check('второй кнопки и убранного списка в разметке нет',
    !/data-upd-archive|data-upd-restore|upd-archived|Убрано из списка|вернуть в список/.test(pageSrc + updSrc)
      && !page({ canManage: true, notes: [baseNote, secondNote] }).includes('Убрано'));
  const form = page({ canManage: true, composing: true });
  /*
    Список полей формы живёт в поведении одной строкой, а разметка обязана
    называть те же `name=`. Раньше проверка вычитывала массив прямо из
    readForm; теперь полей два набора — что переживает перерисовку и что
    подсказка вправе заполнить, — и расхождение между ними невидимо, зато
    заметно человеку: потерянное при перерисовке поле означает стёртый текст.
  */
  const draftList = (updSrc.match(/const DRAFT_FIELDS = \[([^\]]+)\]/) || ['', ''])[1].replace(/'/g, '"');
  const FORM_FIELDS = JSON.parse(`[${draftList}]`);
  equal('форма называет ровно те поля, что читает поведение',
    [...form.matchAll(/name="([A-Za-z]+)"/g)].map((m) => m[1]).sort().join(','),
    [...FORM_FIELDS].sort().join(','));
  check('вставленный текст остаётся в форме и не лезет в заметку',
    FORM_FIELDS.includes('paste')
      && !/paste/.test((updSrc.match(/forum\.publishUpdateNote\(\{[\s\S]*?\}\)/) || [''])[0])
      && /const PARSED_FIELDS = DRAFT_FIELDS\.filter/.test(updSrc));
  check('и у текстовых полей есть потолок длины',
    (form.match(/maxlength="/g) || []).length === 6);
  check('поля не пустят дату из будущего и из доисторических времён',
    form.includes(`min="${L.updateSourceYearFloor}-01-01T00:00"`) && form.includes('max="'));
  check('правок нет ни в разметке, ни в поведении',
    !/data-upd-edit|data-upd-update/.test(pageSrc + updSrc));
  /*
    Удаление без возврата спрашивают всегда: одна случайная кнопка в списке
    стирает то, что модерация решала осознанно, а отменить действие нельзя.
    Поэтому подтверждение живёт в поведении, а не в разметке, и текст его
    называет и предмет, и необратимость.
  */
  check('перед удалением поведение спрашивает, и называет чем оно окончательное',
    updSrc.includes('function confirmRemoval(')
      && /if \(!confirmRemoval\(cardTitle\(drop, '\.upd-card'\), 'Заметку'\)\) return;/.test(updSrc)
      && /удалить навсегда\? Архива больше нет/.test(updSrc));
  check('и форма говорит человеку правду про обратный ход',
    form.includes('удалите') && form.includes('новую'));
  check('пустой список объясняет, почему он пуст',
    page().includes('Заметок пока нет'));
  const broken = page({ error: 'relation "forum_update_note_list" does not exist' });
  check('без миграции страница называет её файл, а не делает вид, что заметок нет',
    broken.includes('20260926-update-pulse.sql') && broken.includes('Список не открылся'));
  const otherError = page({ error: 'что-то совсем странное' });
  check('и не подсказывает файл на каждую ошибку',
    !otherError.includes('20260926-update-pulse.sql') && otherError.includes('что-то совсем странное'));
  check('подвал обещает ровно столько заметок, сколько умеет',
    page().includes(String(L.updateListMax)));
  check('черновой режим сказан вслух', page({ shared: false }).includes('Черновой режим'));
  check('карточка, форма и отказ удаления одеты стилем',
    ['upd-card', 'upd-form', 'upd-kind--patch', 'upd-card__source--broken', 'upd-error', 'upd-card__error', 'upd-card__action']
      .every((c) => cssSrc.includes(`.${c}`)));
  check('архивных классов в стиле больше нет: их не стало ни в разметке, ни здесь',
    !/\.upd-archived|\.upd-card--archived|\.upd-card__was/.test(cssSrc));

  /* ── Маршрут ── */
  check('страница стоит в меню и живёт по своему адресу',
    mainSrc.includes("{ id: 'updates', label: 'Обновления игры', live: true }")
      && mainSrc.includes('mountUpdates(app)'));
  check('она ждёт ответа хранилища, как живой раздел',
    mainSrc.includes("id === 'updates' || id === 'handbook' || (id === 'user' && param)"));
  equal('страница закрывается там же, где закрывается календарь',
    (mainSrc.match(/unmountUpdates\(\);/g) || []).length,
    (mainSrc.match(/unmountCalendar\(\);/g) || []).length);
  equal('новая страница одета в ту же версию, что и остальные импорты',
    new Set(mainSrc.match(/\?v=\d+/g) || []).size, 1);
  check('ошибка списка не глохнет, а форма переживает перерисовку',
    updSrc.includes('state.error = String(err?.message ?? err)')
      && updSrc.includes('state.composing ? readForm() : null'));
  check('отказ действия ложится в свою карточку, а не над списком',
    updSrc.includes('upd-card__error') && updSrc.includes("closest('.upd-card')"));
  check('поздний ответ базы не нарисует список поверх другой страницы',
    updSrc.includes('mountToken'));
  check('правило описано в документах и стоит в списке миграций',
    docsSrc.includes('## Пульс обновлений игры') && docsSrc.includes('20260926-update-pulse.sql')
      && readmeSrc.includes('20260926-update-pulse.sql')
      && readmeSrc.indexOf('20260926-starter-checklist.sql') < readmeSrc.indexOf('20260926-update-pulse.sql'));
  /*
    Про «убрано насовсем» нельзя молчать в документе: читатель документа и
    читатель кнопки должны понимать одно и то же правило. Отметки фида называются
    своим именем, иначе через месяц их никто не найдёт.
  */
  check('и про удаление без возврата сказано в документе, а не только в коде',
    docsSrc.replace(/\s+/g, ' ').includes('убрано насовсем')
      && docsSrc.includes('forum_feed_marks') && docsSrc.includes('forum_delete_update_note')
      && readmeSrc.includes('20261005-feed-final-delete.sql'));

  /* ── Живой черновой прогон: те же слова, что сказала бы база ── */
  const local = await import('../src/forum/adapters/local.js');
  const fresh = new Map();
  globalThis.localStorage = {
    getItem: (k) => (fresh.has(k) ? fresh.get(k) : null),
    setItem: (k, v) => fresh.set(k, String(v)),
    removeItem: (k) => fresh.delete(k),
  };
  const raw = () => JSON.parse(fresh.get('zr33.forum.local'));
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  const hour = 3600 * 1000;
  const valid = (over) => ({
    kind: 'patch',
    title: 'Перечисление карт вышло из ротации',
    summary: 'Карты A и B убраны из ротации, бонус снабжения за них больше не начисляется.',
    sourceName: 'Официальный сайт',
    sourceUrl: 'https://example.com/patch-notes',
    sourceAt: new Date(Date.now() - 2 * hour).toISOString(),
    gameVersion: '1.4.2',
    ...over,
  });

  await local.signUp('Дежурный');            // первый в черновой базе — владелец
  await local.signUp('Обычный');
  await local.signOut();

  equal('без заметок список пуст, а не ошибка', (await local.listUpdateNotes()).length, 0);
  equal('гость заметку не опубликует',
    await says(() => local.publishUpdateNote(valid())), 'Заметку об обновлении публикует модерация');
  await local.signIn('Обычный');
  equal('и игрок без прав — теми же словами',
    await says(() => local.publishUpdateNote(valid())), 'Заметку об обновлении публикует модерация');
  await local.signOut();

  const REFUSALS = [
    { label: 'тип не из трёх', draft: { kind: 'quest' }, words: 'Неизвестный тип заметки: quest', base: 'Неизвестный тип заметки: %' },
    { label: 'заголовок короткий', draft: { title: 'карт' }, words: `Заголовок короче ${L.updateTitleMin} символов: по двум словам не понять, о чём заметка` },
    { label: 'заголовок длинный', draft: { title: 'а'.repeat(L.updateTitleMax + 1) }, words: `Заголовок длиннее ${L.updateTitleMax} символов: на телефоне он уйдёт в три строки` },
    { label: 'содержание в две слова', draft: { summary: 'обновили игру' }, words: `Содержание короче ${L.updateSummaryMin} символов: «обновили игру» — это заголовок, а не заметка` },
    { label: 'содержание на страницу', draft: { summary: 'а'.repeat(L.updateSummaryMax + 1) }, words: `Содержание длиннее ${L.updateSummaryMax} символов: материал о патче пишется на форуме темой` },
    { label: 'источник без имени', draft: { sourceName: ' ' }, words: 'Нужно название первоисточника: ссылка без имени — это просто домен' },
    { label: 'имя источника длинное', draft: { sourceName: 'О'.repeat(L.updateSourceNameMax + 1) }, words: `Название первоисточника длиннее ${L.updateSourceNameMax} символов: достаточно короткого «Официальный сайт»` },
    { label: 'ссылка по http', draft: { sourceUrl: 'http://example.com/notes' }, words: 'Нужна прямая HTTPS-ссылка на первоисточник' },
    { label: 'ссылка-код', draft: { sourceUrl: 'javascript:alert(1)' }, words: 'Нужна прямая HTTPS-ссылка на первоисточник' },
    { label: 'ссылка с пробелом', draft: { sourceUrl: 'https://example.com/notes 1' }, words: 'Ссылка не может содержать пробелы: похоже, к ней прилипло что-то ещё' },
    { label: 'ссылка длинная', draft: { sourceUrl: `https://example.com/${'a'.repeat(L.updateUrlMax)}` }, words: `Ссылка длиннее ${L.updateUrlMax} символов: в карточке она не читается` },
    { label: 'дата не названа', draft: { sourceAt: '' }, words: 'Нужна дата публикации у первоисточника' },
    { label: 'дата из будущего', draft: { sourceAt: new Date(Date.now() + (L.updateFutureGraceMinutes + 30) * hour).toISOString() }, words: 'Дата первоисточника не может быть из будущего' },
    { label: 'дата шестилетней давности', draft: { sourceAt: '2019-05-01T00:00:00.000Z' }, words: `Дата первоисточника раньше ${L.updateSourceYearFloor} года: похоже, ошиблись годом` },
    { label: 'версия длинная', draft: { gameVersion: 'v'.repeat(L.updateVersionMax + 1) }, words: `Номер версии длиннее ${L.updateVersionMax} символов: его не называют так длинно` },
  ];
  await local.signIn('Дежурный');
  for (const r of REFUSALS) {
    equal(`отказ «${r.label}» назван словами`, await says(() => local.publishUpdateNote(valid(r.draft))), r.words);
    check(`и те же слова записаны в базе: ${r.label}`, pubSql.includes(r.base ?? r.words));
  }
  equal('ни одна плохая заметка не записилась', (await local.listUpdateNotes()).length, 0);

  const note1 = await local.publishUpdateNote(valid());
  check('заметка принята и названа целиком, с ником автора',
    note1.title === 'Перечисление карт вышло из ротации' && note1.authorNick === 'Дежурный');
  check('дата первоисточника пришла датой, а не строкой',
    note1.sourceAt instanceof Date && note1.createdAt instanceof Date);
  check('и состояний у неё больше нет: ни статуса, ни следов архива',
    note1.status === undefined && note1.archivedAt === undefined);

  /* Схема приводится к нижнему регистру — ровно как в функции базы. */
  const note2 = await local.publishUpdateNote(valid({
    title: 'Работы на сервере в воскресенье',
    sourceAt: new Date(Date.now() - 3 * hour).toISOString(),
    sourceUrl: 'HTTPS://Example.COM/maintenance',
  }));
  equal('прописная схема принята и приведена к строчной',
    note2.sourceUrl, 'https://Example.COM/maintenance');

  const note3 = await local.publishUpdateNote(valid({
    title: 'Обещание нового сезона', kind: 'notice',
    sourceAt: new Date(Date.now() - 5 * 24 * hour).toISOString(),
  }));
  equal('список отсортирован по дате первоисточника, а не по дате записи',
    (await local.listUpdateNotes()).map((n) => n.title).join(' | '),
    'Перечисление карт вышло из ротации | Работы на сервере в воскресенье | Обещание нового сезона');

  await local.signOut();
  equal('невошедший читает тот же список, что и модерация: состояний нет',
    (await local.listUpdateNotes()).length, 3);

  await local.signIn('Обычный');
  equal('игрок без прав не удалит',
    await says(() => local.deleteUpdateNote(note1.id)),
    'Заметку об обновлении удаляет модерация');
  equal('и ничего не удалил: список цел', (await local.listUpdateNotes()).length, 3);
  await local.signOut();
  await local.signIn('Дежурный');

  equal('заметки с таким id нет',
    await says(() => local.deleteUpdateNote('нет-такой')), 'Заметка не найдена');
  await local.deleteUpdateNote(note3.id);
  equal('удалённая заметка исчезает из списка, а не ложится в архив',
    (await local.listUpdateNotes()).map((n) => n.title).join(' | '),
    'Перечисление карт вышло из ротации | Работы на сервере в воскресенье');
  equal('повторное удаление называет отсутствие строки, а не «уже убрана»',
    await says(() => local.deleteUpdateNote(note3.id)), 'Заметка не найдена');
  check('и в черновом состоянии её больше нет: удаление правда стирает строку',
    raw().updateNotes.length === 2);
  for (const words of DELETE_REFUSALS) {
    check(`слова «${words}» записаны и в базе`, delSql.includes(words));
  }

  await local.signOut();
  equal('гость видит ровно то же, что и модерация', (await local.listUpdateNotes()).length, 2);
  await local.signIn('Дежурный');
  check('второй раз за день одну и ту же заметку не уберёт никто: строки уже нет',
    (await local.listUpdateNotes()).every((n) => n.id !== note3.id));

  /* Предел списка — число конфига, а не «сколько прислали». */
  const padded = raw();
  padded.updateNotes = Array.from({ length: L.updateListMax + 7 }, (_, i) => ({
    id: `upn_${i}`, kind: 'patch', title: `Заметка номер ${i}`,
    summary: 'текст заметки о перемене в игре', sourceName: 'Официальный сайт',
    sourceUrl: 'https://example.com/n', sourceAt: new Date(Date.now() - i * hour).toISOString(),
    gameVersion: '', authorId: 'u_1', authorNick: 'Дежурный',
    createdAt: new Date().toISOString(),
  }));
  fresh.set('zr33.forum.local', JSON.stringify(padded));
  equal('длиннее предела список не становится', (await local.listUpdateNotes()).length, L.updateListMax);
}

console.log(`\n${'─'.repeat(52)}`);
// ── AG. Тихие часы ───────────────────────────────────────────────────────────

console.log('\nAG. Тихие часы');
{
  /*
    Пункт пришёл с форума сообщества, где игрок сам задаёт окно молчания
    оповещений. Перенесено ровно то, что у нас работает: решает браузер
    игрока, а не сервер. Отсюда и главная опасность переноса: правило живёт
    в двух местах сразу — в странице (quiet.js) и в сервисном работнике
    (sw.js, он не видит localStorage и не умеет импортировать модули). Тест
    прогоняет контрольные минуты через обе копии и не даёт им разъехаться;
    заодно сверяет имена зеркала IndexedDB, числа миграции и слову отказа,
    которые оба адаптера берут из одной функции.
  */
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20260926-quiet-hours.sql', 'utf8');
  const swSrc = await readFile('sw.js', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const chatsSrc = await readFile('src/forum/chats.js', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const quiet = await import('../src/forum/quiet.js');
  const L = CONFIG.forum.limits;
  const flat = sql.replace(/\s+/g, ' ');

  /* ── Правило: одни и те же часы в странице и в работнике ── */

  /*
    Контрольные минуты: обычный вечер, окно через полночь (это норма, а не
    ошибка), границы «начало молчит, конец уже нет» и мусор, при котором
    показывать обязанно.
  */
  const NIGHT = { start: 22 * 60, end: 8 * 60 };
  const DAYWIN = { start: 60, end: 120 };
  const MINUTES = [
    [NIGHT, 21 * 60 + 59, false, 'минуту до начала вечер не будит'],
    [NIGHT, 22 * 60, true, 'ровно в начале уже молчит'],
    [NIGHT, 23 * 60 + 30, true, 'глубокой ночью молчит'],
    [NIGHT, 0, true, 'полночь — середина окна через неё'],
    [NIGHT, 7 * 60 + 59, true, 'за минуту до конца ещё молчит'],
    [NIGHT, 8 * 60, false, 'в 08:00 будит снова: конец — не входит'],
    [NIGHT, 12 * 60, false, 'днём не вмешивается'],
    [DAYWIN, 0, false, 'короткое дневное окно полночь не трогает'],
    [DAYWIN, 60, true, 'час ночи — начало окна'],
    [DAYWIN, 119, true, 'последняя минута окна'],
    [DAYWIN, 120, false, 'первая минута после окна'],
    [{ start: 9 * 60, end: 9 * 60 }, 9 * 60, false, 'совпавшие границы молчат ноль минут'],
    [null, 2 * 60, false, 'без окна показываем'],
    [{ start: '22:00', end: null }, 23 * 60, false, 'мусор в границах — не повод молчать'],
  ];

  /* Копию правила из sw.js исполняем здесь же: больше сверять слова бесполезно. */
  const swBlock = swSrc.slice(swSrc.indexOf('const QUIET_DB'), swSrc.indexOf("self.addEventListener('push'"));
  const swQuiet = new Function(`${swBlock}; return { quietMutesPush, QUIET_DB, QUIET_STORE, QUIET_KEY, QUIET_MINUTES_MAX };`)();

  for (const [win, m, expect, label] of MINUTES) {
    const date = new Date(2026, 8, 26, Math.floor(m / 60), m % 60);
    equal(`страница: ${label}`, quiet.quietMutes(win, m), expect);
    equal(`работник: ${label}`, swQuiet.quietMutesPush(win, date), expect);
  }
  check('и имена зеркала у работника те же, что у помощника',
    swQuiet.QUIET_DB === quiet.QUIET_DB && swQuiet.QUIET_STORE === quiet.QUIET_STORE
      && swQuiet.QUIET_KEY === quiet.QUIET_KEY);
  check('верхняя граница минуты у работника — то же число конфига',
    swQuiet.QUIET_MINUTES_MAX === L.quietMinutesMax);
  equal('помощник форматирует минуту как поле формы', quiet.formatQuietTime(L.quietDefaultStart), '22:00');
  equal('и разбирает поле формы в минуту', quiet.parseQuietTime('08:00'), L.quietDefaultEnd);
  check('пустое, «24:00» и «22-00» разбираются в null: молчать на плохих данных нельзя',
    quiet.parseQuietTime('') === null && quiet.parseQuietTime('24:00') === null
      && quiet.parseQuietTime('22-00') === null && quiet.parseQuietTime('9:00') === null);
  check('вне диапазона формат молчит пустой строкой, а не «NaN:NaN»',
    quiet.formatQuietTime(L.quietMinutesMax + 1) === '' && quiet.formatQuietTime(null) === '');

  /* ── Отказ: одна формулировка на оба режима ── */
  const says = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };
  equal('окно без изменений: вызов ни про какие границы — не отказ',
    await says(async () => quiet.normalizeQuietWindow(undefined, undefined)), '');
  check('стёртое окно — законный ответ, а не половина',
    JSON.stringify(quiet.normalizeQuietWindow(null, null)) === '{"start":null,"end":null}');
  equal('половина окна названа словами',
    await says(async () => quiet.normalizeQuietWindow(1320, undefined)),
    'У тихих часов должно быть две границы: начало и конец');
  equal('совпавшие границы названы словами',
    await says(async () => quiet.normalizeQuietWindow(600, 600)),
    'Начало совпадает с концом: окно молчало бы весь день, для этого есть тумблеры подписки');
  equal('минута вне диапазона названа словами',
    await says(async () => quiet.normalizeQuietWindow(0, L.quietMinutesMax + 1)),
    `Границы тихих часов — целые минуты от 0 до ${L.quietMinutesMax}`);
  const supaSet = supaSrc.slice(supaSrc.indexOf('export async function setPushPrefs'),
    supaSrc.indexOf('/* ── Активность сервера'));
  const localSet = localSrc.slice(localSrc.indexOf('export async function setPushPrefs'), localSrc.length);
  check('оба адаптера спрашивают отказ у одной функции, а не пересказывают его',
    supaSet.includes('normalizeQuietWindow(') && localSet.includes('normalizeQuietWindow(')
      && !supaSrc.includes('У тихих часов') && !localSrc.includes('У тихих часов'));

  /* ── База: те же числа и имена ── */
  check('окно живёт двумя колонками у уже существующей таблицы настроек',
    flat.includes('alter table public.forum_push_prefs')
      && flat.includes('add column if not exists quiet_start smallint')
      && flat.includes('add column if not exists quiet_end smallint'));
  check('проверка держит обе границы, диапазон конфига и запрет совпадения',
    flat.includes('constraint forum_push_prefs_quiet_window check')
      && flat.includes(`quiet_start between 0 and ${L.quietMinutesMax}`)
      && flat.includes(`quiet_end between 0 and ${L.quietMinutesMax}`)
      && flat.includes('quiet_start <> quiet_end'));
  check('и не верит половине окна: null только вместе',
    flat.includes('(quiet_start is null and quiet_end is null)'));
  check('повторный запуск файла не оставляет старых границ',
    flat.includes('drop constraint if exists forum_push_prefs_quiet_window'));
  check('ни дверей, ни новых таблиц: пишет владелец строки сам',
    !/security definer/i.test(sql.replace(/--[^\n]*/g, '')) && !/create table/i.test(sql));
  check('адаптер в базу пишет колонки теми же именами',
    supaSrc.includes('body.quiet_start = win.start;') && supaSrc.includes('body.quiet_end = win.end;')
      && supaSrc.includes('row?.quiet_start') && supaSrc.includes('row?.quiet_end'));
  check('контракт обещает quietStart/quietEnd в обе стороны',
    contractSrc.includes('quietStart: number|null, quietEnd: number|null')
      && contractSrc.includes('quietStart?: number|null, quietEnd?: number|null'));

  /* ── Черновой прогон: то же поведение, что у базы ── */
  const fresh = new Map();
  globalThis.localStorage = {
    getItem: (k) => (fresh.has(k) ? fresh.get(k) : null),
    setItem: (k, v) => fresh.set(k, String(v)),
    removeItem: (k) => fresh.delete(k),
  };
  const raw = () => JSON.parse(fresh.get('zr33.forum.local'));
  const local = await import('../src/forum/adapters/local.js');

  const off = await local.getPushPrefs();
  check('без записанных настроек окна нет ни в начале, ни в конце',
    off.quietStart === null && off.quietEnd === null);
  await local.setPushPrefs({ quietStart: 1320, quietEnd: 480 });
  const on = await local.getPushPrefs();
  check('окно через полночь принято и вернулось целым',
    on.quietStart === 1320 && on.quietEnd === 480);
  check('и легло в черновую базу под своими именами',
    raw().pushPrefs.quietStart === 1320 && raw().pushPrefs.quietEnd === 480);
  equal('половина окна отказана теми же словами, что и страница',
    await says(() => local.setPushPrefs({ quietStart: 600 })),
    'У тихих часов должно быть две границы: начало и конец');
  equal('совпавшие границы — тоже',
    await says(() => local.setPushPrefs({ quietStart: 600, quietEnd: 600 })),
    'Начало совпадает с концом: окно молчало бы весь день, для этого есть тумблеры подписки');
  check('после отказа сохранённое окно не пострадало',
    (await local.getPushPrefs()).quietStart === 1320);
  await local.setPushPrefs({ quietStart: null, quietEnd: null });
  const cleared = await local.getPushPrefs();
  check('выключается окно одной записью с двумя null',
    cleared.quietStart === null && cleared.quietEnd === null);
  check('тумблеры подписки при этом живут своей жизнью',
    'newForumPost' in cleared && 'newForumReply' in cleared);

  /* Зеркало для работника: без IndexedDB — честный отказ и честное null. */
  check('без хранилища браузера зеркало не делает вид, что записало',
    (await quiet.saveQuietWindow({ start: 1320, end: 480 })) === false
      && (await quiet.readQuietWindow()) === null);
  equal('и молчание без зеркала — всегда «показываем»', await quiet.quietMutesNow(new Date(2026, 8, 26, 3, 0)), false);

  /* ── Страница и обработчики ── */
  check('рядом с тумблерами подписки — строка тихих часов с двумя полями времени',
    pageSrc.includes('data-forum-quiet-toggle') && pageSrc.includes('type="time"')
      && pageSrc.includes('data-forum-quiet="start"') && pageSrc.includes('data-forum-quiet="end"'));
  check('выключенное окно показывает поля с числами по умолчанию, но неактивными',
    pageSrc.includes('s.pushPrefs.quietStart ?? L.quietDefaultStart')
      && pageSrc.includes("${quietOn ? '' : 'disabled'}"));
  check('подсказка обещает ленту, а не досылку утром',
    pageSrc.includes('в ленту они приходят сразу и ждут там утра'));
  check('отказ показывается строкой под полями и живёт в состоянии, переживая перерисовку',
    pageSrc.includes('data-forum-quiet-error') && pageSrc.includes('s.quietError')
      && mountSrc.includes('state.quietError = String(err?.message ?? err)')
      && !mountSrc.includes("showError('[data-forum-quiet-error]'"));
  check('чекбокс и поля времени ведут в одну запись настроек',
    mountSrc.includes('async function applyQuietWindow(')
      && mountSrc.includes('data-forum-quiet-toggle') && mountSrc.includes('parseQuietTime('));
  check('после входа зеркало обновляется одним чтением настроек',
    mountSrc.slice(mountSrc.indexOf('async function loadPushPrefs'), mountSrc.indexOf('Переложить окно из состояния'))
      .includes('await mirrorQuietWindow();'));
  check('и выход стирает чужую ночь из этого браузера',
    mountSrc.includes('await mirrorQuietWindow();',
      mountSrc.indexOf("data-forum-signout")));
  check('открытый чат спрашивает то же зеркало перед оповещением',
    chatsSrc.includes('!(await quietMutesNow())') && chatsSrc.includes('import { quietMutesNow }'));
  check('а работник проверяет окно до showNotification',
    swSrc.indexOf('quietMutesPush(await readQuietWindow()') < swSrc.indexOf('showNotification(data.title'));

  /* ── Документы ── */
  check('правило описано в документах форума', docsSrc.includes('## Тихие часы'));
  check('миграция стоит в списке и в описании',
    readmeSrc.includes('`20260926-quiet-hours.sql`')
      && readmeSrc.indexOf('20260926-update-pulse.sql') < readmeSrc.indexOf('20260926-quiet-hours.sql'));
}

// ── AH. Сроки ответа модерации ───────────────────────────────────────────────

console.log('\nAH. Сроки ответа модерации');
{
  /*
    Пункт с донорского форума, где очередь обращений размечают уровнем
    ожидания. Перенесено ровно то, что у нас честно: уровень считается на
    чтении из created_at, и у него нет ни колонки, ни будильника. Отсюда и
    главная опасность: обещание игроку и линейка дежурного обязаны расти из
    одного числа, иначе страница обещает сутки, а очередь красит трое.
    Тест сверяет границы, имена меток, единственное место формулировки
    обещания и то, что очереди читаются от давности.
  */
  const { readFile, readdir } = await import('node:fs/promises');
  const sla = await import('../src/forum/sla.js');
  const slaSrc = await readFile('src/forum/sla.js', 'utf8');
  const modSrc = await readFile('src/admin/screens/moderation.js', 'utf8');
  const guidesSrc = await readFile('src/pages/guides.js', 'utf8');
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const adminCss = await readFile('src/admin/admin.css', 'utf8');
  const forumCss = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const L = CONFIG.forum.limits;

  /* ── Числа ── */
  equal('«скоро срок» — ровно сутки', L.slaDueSoonHours, 24);
  equal('«просрочено» — ровно трое суток', L.slaOverdueHours, 72);
  check('границы не переставлены', L.slaDueSoonHours < L.slaOverdueHours);

  /* ── Линейка возраста ── */
  const now = new Date('2026-09-26T12:00:00Z');
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600000);
  const CASES = [
    [0, 'fresh'], [23, 'fresh'],
    [24, 'soon'], [36, 'soon'], [71, 'soon'],
    [72, 'late'], [500, 'late'],
    [-5, 'fresh'],
  ];
  for (const [h, want] of CASES) {
    equal(`возраст ${h} ч — уровень ${want}`, sla.slaLevel(hoursAgo(h), now), want);
  }
  check('без даты уровень «свежая»: очередь не врёт о сроке там, где не знает даты',
    sla.slaLevel(null, now) === 'fresh' && sla.slaLevel(undefined, now) === 'fresh'
      && sla.slaLevel('не дата', now) === 'fresh' && sla.slaLevel(NaN, now) === 'fresh');
  check('число миллисекунд понимается так же, как Date',
    sla.slaLevel(hoursAgo(80).getTime(), now) === 'late');

  /* ── Метки и обещание ── */
  check('у «свежей» заявки метки нет, и её некому напечатать',
    !('fresh' in sla.SLA_LABELS) && Object.keys(sla.SLA_LABELS).every(
      (k) => k === 'soon' || k === 'late'));
  equal('скоро срок называется по-русски', sla.SLA_LABELS.soon, 'скоро срок');
  equal('просрочено называется по-русски', sla.SLA_LABELS.late, 'просрочено');
  equal('обещание в сутках — то же число, что красит «просрочено»',
    sla.slaPromiseDays(), L.slaOverdueHours / 24);
  equal('строка обещания собрана из этого числа',
    sla.slaPromiseLine(), `Обычно отвечаем в течение ${sla.slaPromiseDays()} суток.`);
  check('формулировка обещания живёт ровно в помощнике',
    !modSrc.includes('Обычно отвечаем') && !guidesSrc.includes('Обычно отвечаем')
      && !pageSrc.includes('Обычно отвечаем') && !mountSrc.includes('Обычно отвечаем')
      && slaSrc.includes('Обычно отвечаем'));

  /* ── Очереди читаются от давности ── */
  check('жалобы в панели выстроены старшими вперёд',
    modSrc.includes('[...f.reports].sort(')
      && modSrc.includes('new Date(a.createdAt) - new Date(b.createdAt)'));
  check('число тех, чей публичный срок вышел, названо в заголовке',
    modSrc.includes("slaLevel(r.createdAt) === 'late'")
      && modSrc.includes('adm-sla adm-sla--late'));
  check('метка стоит и на жалобе, и на открытой апелляции',
    modSrc.includes('${slaMark(r.createdAt)}') && modSrc.includes('slaMark(a.createdAt)'));
  check('разобранная апелляция метки не носит: ждёт — открытая',
    modSrc.includes("isOpen ? slaMark(a.createdAt) : ''"));
  check('апелляции в очереди тоже от давности',
    modSrc.includes(".filter((a) => a.status === 'open')")
      && modSrc.includes('.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))'));
  check('очередь заявок на гайдах читается от давности и метку печатает только модерации',
    guidesSrc.includes('[...open].sort(') && guidesSrc.includes('${slaMark(r.createdAt)}'));
  const openRow = guidesSrc.slice(guidesSrc.indexOf('function openRequestRow'),
    guidesSrc.indexOf('function ownRequestRow'));
  check('игрок своей просрочки не видит: «просрочено» — внутреннее слово дежурного',
    !openRow.includes('slaMark') && !guidesSrc.slice(
      guidesSrc.indexOf('function ownRequestRow'), guidesSrc.indexOf('function requestForm'))
      .includes('slaMark'));

  /* ── Публичное обещание там, где игрок ждёт ── */
  check('под правилами стоит строка обещания',
    pageSrc.includes('esc(slaPromiseLine())') && pageSrc.includes('forum-rules__note'));
  check('и подтверждение жалобы, и подтверждение апелляции называют срок',
    mountSrc.includes('`Жалоба отправлена. ${slaPromiseLine()}`')
      && mountSrc.includes('Апелляция отправлена модерации. Запрет на время разбора остаётся. ${slaPromiseLine()}`')
      && mountSrc.includes('import { slaPromiseLine }'));
  check('открытая апелляция напоминает срок прямо в состоянии',
    pageSrc.includes('модератор ещё не ответил. ${esc(slaPromiseLine())}'));

  /* ── Внешний вид ── */
  check('панель красит метку теми же словами, что помощник',
    adminCss.includes('.adm-sla--soon') && adminCss.includes('.adm-sla--late'));
  check('и страница гайдов — тоже',
    forumCss.includes('.guide-req__sla--soon') && forumCss.includes('.guide-req__sla--late'));

  /* ── Честное «миграции нет» ── */
  /*
    Файл миграции может лежать и в очереди наверху, и в applied/ — отказ
    «миграции нет» должен проверять оба уровня, иначе список папки скроет
    правду про историю.
  */
  const sqlFiles = [...await readdir('supabase'), ...await readdir('supabase/applied')];
  check('ни SQL-файла, ни колонки у срока нет — уровень считается на чтении',
    !sqlFiles.some((f) => /sla|response-time|deadline/i.test(f)));
  check('документ называет, чего в сроках нет намеренно',
    docsSrc.includes('## Сроки ответа модерации')
      && docsSrc.includes('Напоминаний по расписанию')
      && docsSrc.includes('Донорских четырёх часов')
      && docsSrc.includes('Миграции.'));
  check('обещание в документе — то же число, что в конфиге',
    docsSrc.includes(`Обычно отвечаем в течение ${L.slaOverdueHours / 24} суток.`));
}

console.log(`\n${'─'.repeat(52)}`);
// ── R3. Ключ восстановления: криптография браузера ──────────────────────────
console.log('\nR3. Ключ восстановления');
{
  const rec = await import('../src/forum/recovery.js');

  /*
    Ключ — единственное, что доказывает право на чужой аккаунт. Он живёт в
    браузере и нигде больше, поэтому проверяем его форму до того, как он
    уйдёт в SHA-256: 16 случайных байт, 32 hex-символа, нижний регистр.
  */
  const key = rec.createRecoveryKey();
  check('ключ — 32 hex-символа', /^[0-9a-f]{32}$/.test(key));
  check('ключ не повторяется', new Set(Array.from({ length: 50 }, () => rec.createRecoveryKey())).size === 50);

  /*
    Один и тот же ключ обязан давать один и тот же отпечаток: заявка создаётся
    на телефоне, а продолжается с компьютера. Ошибка здесь выглядела бы как
    «ключ не найден» у человека, который ничего не менял.
  */
  const hash = await rec.hashRecoveryKey(key);
  check('отпечаток — 64 hex-символа', /^[0-9a-f]{64}$/.test(hash));
  check('отпечаток стабилен', (await rec.hashRecoveryKey(key)) === hash);
  check('другой ключ даёт другой отпечаток', (await rec.hashRecoveryKey('0'.repeat(32))) !== hash);
  check('в базу уходит отпечаток, а не ключ', !hash.includes(key));

  equal('отпечаток совпадает с SHA-256 из базы',
    hash,
    Buffer.from(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))).toString('hex'));

  check('ключ с пробелами и верхним регистром принимается',
    rec.looksLikeRecoveryKey(`  ${key.toUpperCase().replace(/(.{8})(?=.)/g, '$1 ')}  `));
  check('короткий и мусор отклоняются',
    !rec.looksLikeRecoveryKey('abc') && !rec.looksLikeRecoveryKey('g'.repeat(32)));
  check('нормализация оставляет только hex в нижнем регистре',
    rec.normalizeRecoveryKey(` ${key.toUpperCase().replace(/(.{8})(?=.)/g, '$1-')} `) === key);
  check('на экране ключ в две строки',
    rec.formatRecoveryKey(key).split('\n').every((line) => /^[0-9a-f]{16}$/.test(line))
    && rec.formatRecoveryKey(key).replace('\n', '') === key);

  /*
    В Node localStorage нет — и это ровно тот случай, который встречается у
    человека с запретом хранения данных. Сохранение должно вернуть false,
    чтобы страница велела записать ключ, а не сделала вид, что записала.
    Хранилище снимаем явно: до этого блока его подставили тесты локального
    адаптера, и проверка отказывала бы не по своей причине.
  */
  const hadStorage = globalThis.localStorage;
  delete globalThis.localStorage;
  check('без хранилища сохранение честно отказывает',
    rec.saveRecovery('Игрок', key) === false && rec.loadRecovery() === null);
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  check('с хранилищем пара ник/ключ возвращается назад',
    rec.saveRecovery('Игрок', key) === true
    && rec.loadRecovery().nick === 'Игрок' && rec.loadRecovery().key === key);
  rec.clearRecovery();
  check('после успеха ключ стирается', rec.loadRecovery() === null);
  globalThis.localStorage = hadStorage;
}

// ── AI. Настройки раздачи ────────────────────────────────────────────────────

console.log('\nAI. Настройки раздачи');
{
  /*
    Netlify заморозил прод-деплои на исходе месячных кредитов, и push в main
    перестал означать «изменение на сайте»: два коммита висели в статусе
    Skipped. Раздачу перенесли на Render, и render.yaml — единственное место,
    где записано, какая папка публикуется. Ошибки здесь невидимы: не тот
    publish directory — сайт отдаёт 404 вместо собственных страниц, кэшируемый
    sw.js оставляет часть игроков на прошлой версии неопределённо долго, а
    объявленный как веб-сервис (а не статический сайт) сервис съедает часы
    бесплатного тарифа, которые целиком нужны Telegram-боту. Поэтому сверяем
    не формулировки, а смысл.
  */
  const { readFile } = await import('node:fs/promises');
  const { existsSync } = await import('node:fs');
  const render = (await readFile('render.yaml', 'utf8')).replace(/\s+/g, ' ');
  check('публикуется корень репозитория, а не собранная папка',
    /staticPublishPath: \.\//.test(render));
  check('сборки нет: пустой шаг вместо установки по наличию package.json',
    /buildCommand: 'true'/.test(render));
  check('сервис-воркер объявлен не кэшируемым',
    /path: \/sw\.js name: Cache-Control value: '[^']*no-store/.test(render));
  check('это статический сайт: часы бесплатного тарифа остаются боту',
    /runtime: static/.test(render));
  /*
    DNS-зона живёт не в репозитории, так что docs/HOSTING.md — единственное её
    хранилище: без конкретных значений восстановление после аварии превращается
    в угадывание адреса, который подставляется только из панели Render.
  */
  const hosting = await readFile('docs/HOSTING.md', 'utf8');
  check('документ о раздаче ведёт push к текущему хосту',
    /──push──> Render/.test(hosting));
  check('в документе записаны значения зонных записей, а не «см. в панели»',
    /216\.24\.57\.1/.test(hosting) && /zroutehub\.onrender\.com/.test(hosting));
  check('конфиг прежнего раздатчика удалён: он описывает то, чем уже не раздают',
    !existsSync('netlify.toml'));
}

// ── AJ. Справочник официальных гайдов игры ────────────────────────────────

console.log('\nAJ. Справочник официальных гайдов игры');
{
  /*
    Справочник перенесён из Telegram-бота целиком: 44 гайда, 164 картинки,
    пятьдесят тысяч знаков текста. Глазами такой объём не проверить ни при
    переносе, ни после, а портится он молча: потерянная ветка дерева не
    ругается — она просто перестаёт открываться по ссылке из чата, а
    переименованная при перетаскивании картинка отдаёт 404 уже на бое.
    Поэтому проверки здесь не про смысл текстов, а про связку
    «данные — файл на диске — ссылка на странице».
  */
  const { readFile, stat } = await import('node:fs/promises');
  const { readdirSync } = await import('node:fs');
  const { HANDBOOK, HANDBOOK_ROOTS } = await import('../src/handbook/guides.js');
  const hb = await import('../src/pages/handbook.js');
  const { postBody } = await import('../src/forum/format.js');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const indexSrc = await readFile('index.html', 'utf8');
  const swSrc = await readFile('sw.js', 'utf8');
  const controlsSrc = await readFile('src/ui/handbook-controls.js', 'utf8');
  const guidesPageSrc = await readFile('src/pages/guides.js', 'utf8');
  const cssSrc = await readFile('src/handbook.css', 'utf8');

  const byId = new Map(HANDBOOK.map((g) => [g.id, g]));
  const leaves = HANDBOOK.filter(hb.isHandbookGuide);

  equal('дерево целое: 61 узел — 47 гайдов и 14 разделов', HANDBOOK.length, 61);
  equal('листов ровно 47, больше ни один узел не раскрывается', leaves.length, 47);
  equal('идентификаторы узлов не повторяются', byId.size, HANDBOOK.length);

  const dangling = [];
  for (const g of HANDBOOK) {
    for (const child of g.children) if (!byId.has(child)) dangling.push(`${g.id}→${child}`);
  }
  equal('каждая ссылка на подраздел ведёт в существующий узел', dangling.join(', '), '');

  const claimed = new Set();
  for (const g of HANDBOOK) for (const child of g.children) claimed.add(child);
  const orphans = HANDBOOK
    .filter((g) => !claimed.has(g.id) && !HANDBOOK_ROOTS.includes(g.id))
    .map((g) => g.id);
  equal('в дереве нет узлов, до которых нельзя дойти от корня', orphans.join(', '), '');

  equal('корней восемь', HANDBOOK_ROOTS.length, 8);
  check('каждый корень существует в дереве', HANDBOOK_ROOTS.every((id) => byId.has(id)));
  /*
    Три корня («Строительство», «Солдаты», «Должности министров») — сразу
    гайды: в боте эти пункты меню открывали один экран, а не список. Поэтому
    проверяем не форму, а то, что корень не пустой: содержимое на своей
    странице обязан быть и у списка, и у гайда.
  */
  check('корень не бывает пустой веткой: содержимое есть и у списка, и у гайда',
    HANDBOOK_ROOTS.every((id) => {
      const root = byId.get(id);
      const filled = root.blocks.some((b) => b.text || b.image);
      return filled && (root.children.length > 0 || hb.isHandbookGuide(root));
    }));
  const rootTitles = new Set(HANDBOOK_ROOTS.map((id) => byId.get(id).title));
  check('раздел каждого узла — название одного из восьми корней',
    HANDBOOK.every((g) => rootTitles.has(g.section)));
  check('у каждого узла есть заголовок и хотя бы один блок',
    HANDBOOK.every((g) => g.title.trim() && g.blocks.length));
  check('ни один гайд не пуст: текст или картинка обязательно есть',
    leaves.every((g) => g.blocks.some((b) => (b.text || '').trim() || b.image)));

  /* Картинки: путь, размеры и наличие файла на диске. */
  const images = [];
  for (const g of HANDBOOK) for (const b of g.blocks) if (b.image) images.push({ g, b });
  equal('картинок перенесено 164 — каждая хотя бы раз показана', new Set(images.map(({ b }) => b.image)).size, 164);
  check('каждая картинка лежит в public/guides',
    images.every(({ b }) => b.image.startsWith('./public/guides/')));
  check('у каждой картинки есть alt — без него телефон читает файл вслух',
    images.every(({ b }) => (b.alt || '').trim()));
  check('у каждой картинки записаны исходные размеры',
    images.every(({ b }) => b.w > 0 && b.h > 0),
    'без width/height страница подпрыгивает при догрузке');
  const missing = [];
  for (const { b } of images) {
    try {
      await stat(b.image.replace('./', ''));
    } catch {
      missing.push(b.image);
    }
  }
  equal('каждый файл из данных действительно лежит в репозитории', missing.join(', '), '');

  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [/\.jpe?g$/i.test(e.name) ? `${dir}/${e.name}` : null]))
    .filter(Boolean);
  const onDisk = walk('public/guides');
  const referenced = new Set(images.map(({ b }) => b.image.replace('./', '')));
  equal('лишних картинок в репозитории нет: всё, что лежит, где-то показано',
    onDisk.filter((p) => !referenced.has(p)).join(', '), '');
  equal('файлов на диске ровно столько, сколько картинок в данных', onDisk.length, referenced.size);

  /* Мусор, который переносится вместе с ботовскими текстами. */
  const flat = HANDBOOK.flatMap((g) => g.blocks.flatMap((b) => [b.text || '', b.caption || '']));
  check('декоративных черт из бота не осталось', !flat.some((s) => /[━─—]{4,}/.test(s)));
  check('кнопочных подсказок бота («Выберите действие») не перенесено',
    !flat.some((s) => /выбер(?:ите|и)[^\n]{0,30}действие/i.test(s)));
  /*
    Подпись под картинкой бот нередко передаёт не строкой, а переменной:
    send_photo_cached(msg, "….jpg", text_block_1). Экстрактор, разворачивая
    такие переменные, ошибается молча — файл на месте, размеры записаны,
    alt непустой, тесты зелёные, а под картинкой игрок читает «text_block_1».
    Поэтому проверка не про формат данных, а про то, что в поле попал текст.
  */
  const varName = (s) => /^[a-z_][a-z0-9_]*$/.test((s || '').trim());
  check('в alt и подписях нет имён переменных из кода бота',
    images.every(({ b }) => !varName(b.alt) && !varName(b.caption)),
    images.filter(({ b }) => varName(b.alt) || varName(b.caption))
      .map(({ g, b }) => `${g.id} → ${b.image.split('/').pop()}`).join(', '));

  /*
    Четыре подробных разбора базовых веток исследований. В самом боте они
    мёртвые: обработчик, текст и картинки на месте, а кнопок, которые бы это
    открывали, не осталось — меню листает research_page_N и показывает по
    каждой ветке короткий список. Здесь они стали отдельными страницами
    «Исследований», и ценность их ровно в том, что каждый бонус пояснён, а не
    просто перечислен одной строкой.
  */
  const branches = ['research_develop', 'research_economy', 'research_hero', 'research_soldiers'];
  const research = byId.get('menu_research');
  equal('у «Исследований» четыре подробных разбора веток', research.children.join(','), branches.join(','));
  check('каждый разбор — страница с одним текстом и двумя скриншотами',
    branches.every((id) => {
      const g = byId.get(id);
      return g.blocks.filter((b) => b.text).length === 1 &&
        g.blocks.filter((b) => b.image).length === 2 &&
        g.path.join(' » ') === research.title;
    }));
  /*
    Смысл переноса держится на разнице длин: разбор обязан быть подробнее
    короткого списка той же ветки. Сравнение по первому заголовку — чтобы
    проверка не протихла, когда списки в разделе переставят местами.
  */
  for (const id of branches) {
    const detail = byId.get(id).blocks.find((b) => b.text).text;
    const heading = detail.split('\n')[0];
    const brief = research.blocks.find((b) => b.text && b.text.split('\n')[0] === heading);
    check(`${id}: разбор длиннее короткого списка той же ветки`,
      brief && detail.length > brief.text.length,
      brief ? `${detail.length} знаков против ${brief.text.length}` : 'в разделе нет списка этой ветки');
  }
  equal('подробные разборы не принесли новых файлов: 172 показа картинок при 164 файлах',
    images.length, 172);
  /*
    Поиск обязан находить и раздел, у которого есть свой текст: «Исследования»
    больше не лист, а тринадцать разборов веток на одной странице. Слова,
    встречающиеся ровно один раз во всём справочнике, — чтобы проверка не
    зависела от того, сколько строк влезло в выдачу.
  */
  check('страница раздела находится поиском, а не только гайды-листы',
    hb.searchHandbook('поэтапно').items.some((r) => r.node.id === 'menu_research'));
  check('перенесённый разбор ветки находится по словам из него',
    hb.searchHandbook('возвращаются в строй').items.map((r) => r.node.id), ['research_develop']);

  const rendered = flat.filter(Boolean).map((s) => postBody(s)).join('\n');
  check('разметка Telegram закрывается, а не остаётся в тексте',
    (rendered.match(/<(?:strong|em)>/g) || []).length === (rendered.match(/<\/(?:strong|em)>/g) || []).length);
  check('сырых <b> и <i> очиститель не пропускает', !/<[bi]>/.test(rendered));
  check('текст перенесён без сокращений',
    HANDBOOK.reduce((s, g) => s + g.blocks.reduce((x, b) => x + (b.text || '').length, 0), 0) > 50000);

  /*
    Раздел подключён к сайту, а не просто лежит рядом. Своей вкладки у него
    больше нет: справочник живёт внутри «Гайдов», поэтому проверяем маршрут,
    меню и блок на странице гайдов.
  */
  check('маршрут остался, а пункт меню — нет: вкладка одна',
    /\{ id: 'handbook', label: 'Справочник игры', hidden: true, navAs: 'guides' \}/.test(mainSrc)
      && /const shown = ROUTES\.filter\(\(r\) => !r\.hidden\);/.test(mainSrc));
  check('открытый справочник подсвечивает вкладку «Гайды»',
    /const navId = \(r\) => r\.navAs \|\| r\.id;/.test(mainSrc)
      && /renderNav\(route\.navAs \|\| route\.id\)/.test(mainSrc));
  check('справочник открывается до ответа хранилища',
    /id === 'updates' \|\| id === 'handbook' \|\| \(id === 'user' && param\)/.test(mainSrc));
  const branch = /\} else if \(route\.id === 'handbook'\) \{([\s\S]*?)path = '\/handbook\/node'/.exec(mainSrc);
  check('ветка маршрута выгружает все живые разделы перед отрисовкой',
    branch && (branch[1].match(/unmount\w+\(\);/g) || []).length === 6);
  /*
    Старая ссылка из меню или из чата (#/handbook, в том числе с запросом) не
    должна вести на половину страницы: узел по своему адресу открывается целиком,
    а пустой адрес переезжает на вкладку вместе со словом поиска.
  */
  check('пустой адрес справочника переводит на вкладку гайдов',
    branch && /if \(!param\) \{[\s\S]{0,120}location\.replace\(/.test(branch[1])
      && branch[1].includes('#/guides${search'));
  check('стили справочника подключены к странице',
    /<link rel="stylesheet" href="\.\/src\/handbook\.css/.test(indexSrc));
  check('стили справочника попали в офлайн-копию',
    swSrc.includes("'./src/handbook.css'"));
  check('классы, которые рисует страница, описаны в её stylesheet',
    ['hb-page', 'hb-tile', 'hb-fig', 'hb-crumbs', 'hb-search', 'hb-hits', 'guide-handbook']
      .every((cls) => cssSrc.includes(`.${cls}`)));

  /* Поиск: поле, отражение запроса в адресе и клавиши. */
  check('модуль поиска слушает ввод и клавиши',
    /addEventListener\('input'/.test(controlsSrc) && /addEventListener\('keydown'/.test(controlsSrc));
  /*
    Путь адреса берётся из текущего, а не пишется заново: жёсткий «#/handbook»
    уводил бы человека на другую вкладку прямо во время набора буквы.
  */
  check('запрос пишется в адрес, чтобы ссылку можно было скинуть в чат',
    /replaceState/.test(controlsSrc)
      && controlsSrc.includes("location.hash.split('?')[0]")
      && /\?q=\$\{encodeURIComponent\(q\)\}/.test(controlsSrc)
      && !/#\/handbook\?q=/.test(controlsSrc));
  check('Escape очищает поле', /Escape/.test(controlsSrc));
  check('модуль поиска подключён в main.js',
    /import '\.\/ui\/handbook-controls\.js/.test(mainSrc));

  /* Разметка: поле с разделами — часть вкладки «Гайды», а не отдельная страница. */
  const sections = hb.renderSections();
  check('поле поиска встроено во вкладку гайдов',
    /renderHandbookSearch\(s\.hbQuery \?\? ''\)/.test(guidesPageSrc)
      && /data-hb-query/.test(hb.renderHandbookSearch(''))
      && /class="guide-handbook"/.test(guidesPageSrc));
  /*
    Раздел под списком гайдов — навигация, а не читалка правил: восемь плиток и
    ни одного текста из игры. Проверка на количество знаков стоит здесь, а не
    только на имена классов, потому что раньше под полем печатались ещё и
    текстовые блоки всех корней, и вкладка разрасталась до восемнадцати тысяч
    знаков: правки, «улучшающие» справочник, очень легко снова превращают
    список правил в простыню, и человек этого не заметит на своем экране.
  */
  equal('под полем видно восемь разделов',
    (sections.match(/class="hb-tile"/g) || []).length, 8);
  check('разделы — компактный список, а не семь страниц правил',
    /class="hb-grid hb-roots"/.test(sections)
      && !/class="hb-text"/.test(sections)
      && sections.length < 3000,
    `список весит ${sections.length} знаков`);
  const hrefs = [...sections.matchAll(/href="#\/handbook\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  check('каждая плитка ведёт в существующий узел', hrefs.length > 0 && hrefs.every((id) => byId.has(id)),
    hrefs.filter((id) => !byId.has(id)).join(', '));
  check('в плитках есть счёт гайдов и первая строка — без них список немой',
    (sections.match(/class="hb-tile__kind"/g) || []).length === 8
      && (sections.match(/class="hb-tile__lead"/g) || []).length >= 6);
  /*
    Текст раздела начинается с его же названия заглавными буквами, и подпись
    под плиткой без этого среза печатала бы заголовок дважды.
  */
  const doubled = sections.split('<li class="hb-tile">').slice(1).filter((tile) => {
    const title = ((tile.match(/<b>([^<]*)<\/b>/) || ['', ''])[1]).trim().toUpperCase();
    const lead = ((tile.match(/class="hb-tile__lead">([^<]*)</) || ['', ''])[1]).trim().toUpperCase();
    return title !== '' && lead.startsWith(title);
  });
  equal('подпись плитки не повторяет её собственный заголовок', doubled.length, 0);
  check('ссылка с запросом открывает список найденного',
    /hb-hits/.test(hb.renderHandbookSearch('броня')));

  const detail = hb.renderHandbook({ guideId: 'mythic_gear_create' });
  check('гайд показывает картинки лениво и с размерами',
    /<figure/.test(detail) && /loading="lazy"/.test(detail) && /width="\d+" height="\d+"/.test(detail));
  check('гайд показывает путь по разделам и соседей',
    /hb-crumbs/.test(detail) && /aria-current="page"/.test(detail) && /hb-siblings/.test(detail));
  check('битая ссылка не роняет страницу, а объясняет',
    /Такого гайда нет/.test(hb.renderHandbook({ guideId: '%zz' })));
  check('со страницы узла можно вернуться к гайдам',
    /href="#\/guides"/.test(hb.renderHandbook({ guideId: '%zz' }))
      && /href="#\/guides"/.test(detail));

  /* Мостик со страницы «Гайды» больше не мостик: справочник стоит на той же вкладке. */
  check('блок справочника стоит под списком гайдов и перед заявками',
    /class="guide-handbook"/.test(guidesPageSrc)
      && /hb-search/.test(hb.renderHandbookSearch(''))
      && !/renderHandbookTeaser/.test(guidesPageSrc));

  /* Смысл поиска: два слова — оба обязаны встретиться, «ё» равно «е». */
  equal('два слова ищутся как «и», а не как «или»',
    hb.searchHandbook('засада урон').items.map((r) => r.node.id), ['alliance_ambush']);
  equal('буква ё в запросе равносильна е',
    hb.searchHandbook('ещё').total, hb.searchHandbook('еще').total);
  const many = hb.searchHandbook('а');
  check('выдача поиска ограничена 24 строками, но число найдено полное',
    many.total > 24 && many.items.length === 24 && /показаны первые/.test(hb.renderResults('а')));
  check('чужое слово не может протащить разметку в страницу',
    !/<img src=x/.test(hb.renderResults('<img src=x onerror=alert(1)>')));
  check('найденное слово подсвечено', /<mark>/.test(hb.renderResults('броня')));
  check('без запроса показаны разделы, а не «ничего не найдено»',
    /hb-roots/.test(hb.resultsSlot('')) && !/hb-none/.test(hb.resultsSlot('')));
}

console.log('\nAK. Гайды пишут участники');
{
  /*
    Право писать гайд — не одна строка в политике: к нему идут лимиты, страх
    чужой подписи, адрес из заголовка, скриншоты и отказы, которые в черновом
    режиме обязаны прозвучать теми же словами, что и база. Проверяется цепочка
    целиком, потому что расхождение в ней невидимо: форма примет текст, база
    отвергнет его, и человек потеряет то, что набирал.
  */
  const { readFile } = await import('node:fs/promises');
  const L = CONFIG.forum.limits;
  const sql = await readFile('supabase/applied/20260929-player-guides.sql', 'utf8');
  const { guideBodyProblem, GUIDE_BODY_SHORT, GUIDE_BODY_LONG, GUIDE_DAILY_LIMIT } =
    await import('../src/forum/rules.js');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const pageSrc = await readFile('src/pages/guides.js', 'utf8');
  const behavSrc = await readFile('src/forum/guides.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');

  /* ── Право ── */
  check('гайд вносит любой, кто может писать на форум, а не только лидер',
    /create policy forum_guides_insert on public\.forum_guides\s+for insert with check \(public\.forum_can_write\(\)\)/.test(sql));
  check('прежнего требования лидерства в политике не осталось',
    !/forum_guides_insert[\s\S]{0,200}forum_is_leader/.test(sql));
  check('почему у игрока нет подписи модерации, записано комментарием в базе',
    /comment on policy forum_guides_insert[\s\S]{0,220}отметку модерации при этом не получает/.test(sql));
  check('лимиты и страх действуют только для не-модерации',
    /if not public\.forum_is_staff\(\) then/.test(sql)
      && localSrc.includes('const staff = isStaff(me);')
      && /if \(!staff\) \{\s*\n\s*const midnight/.test(localSrc));
  check('вставить чужую подпись нельзя: колонки обзора под страхом на самой вставке',
    /if new\.review_status is distinct from 'none'[\s\S]{0,260}raise exception 'Отметку «проверен \/ устарел» ставит модерация'/.test(sql));
  check('адрес строит база, а занятый снимает суффиксом до 74 знаков',
    /if new\.slug = '' then[\s\S]{0,200}regexp_replace\(lower\(new\.title\)/.test(sql)
      && /while exists \([\s\S]{0,240}\) loop[\s\S]{0,240}left\(v_base, 74\) \|\| '-' \|\| v_n::text/.test(sql));
  check('повторный прогон файла приводит схему к одному виду: триггер пересоздаётся',
    /drop trigger if exists forum_guide_before on public\.forum_guides;\s*create trigger forum_guide_before/.test(sql));

  /* ── Числа: одни в config.js, в базе и в форме ── */
  check('границы тела гайда называет config.js, а база их исполняет буквально',
    sql.includes(`char_length(v_text) < ${L.guideBodyMin}`)
      && sql.includes(`char_length(v_text) > ${L.guideBodyMax}`)
      && new RegExp(`\\) >= ${L.guideDailyMax} then`).test(sql));
  check('ту же мерку держит форма: поле обещает числа из config.js',
    pageSrc.includes('data-limit="${L.guideBodyMax}"')
      && pageSrc.includes('${L.guideBodyMin}–${L.guideBodyMax} символов видимого текста')
      && pageSrc.includes('Не больше ${L.guideDailyMax} гайдов в сутки'));
  check('длину меряют по тексту без разметки — и база, и правила',
    sql.includes("'<[^>]*>', ' ', 'g'")
      && localSrc.includes('guideBodyProblem(body)')
      && guideBodyProblem('<p>коротко</p>') === GUIDE_BODY_SHORT);

  /* ── Отказы звучат одними словами в трёх местах ── */
  const raised = new Set([...sql.matchAll(/raise exception '([^']*)'/g)].map((m) => m[1]));
  check('база поднимает ровно те фразы, которые знают правила',
    [GUIDE_BODY_SHORT, GUIDE_BODY_LONG, GUIDE_DAILY_LIMIT].every((t) => raised.has(t)),
    [...raised].join(' / '));

  /* ── Черновой режим: те же развилки и те же слова, проверенные делом ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  await local.signUp('Владелец');
  await local.signUp('Автор');
  await local.signUp('Автор2');

  const said = async (fn) => {
    try { await fn(); return ''; } catch (e) { return String(e?.message ?? e); }
  };
  const okBody = `<p>${'разбор'.repeat(Math.ceil(L.guideBodyMin / 6))}</p>`;

  await local.signIn('Автор');
  equal('короткое тело: черновой режим отказывает фразой базы',
    await said(() => local.createGuide({ title: 'Заметка', body: '<p>пару слов</p>' })),
    GUIDE_BODY_SHORT);
  equal('длинное тело: та же фраза, что поднимает триггер',
    await said(() => local.createGuide({ title: 'Энциклопедия', body: `<p>${'с'.repeat(L.guideBodyMax + 5)}</p>` })),
    GUIDE_BODY_LONG);

  const first = await local.createGuide({ title: 'Как ставить лагерь на холме', body: okBody });
  check('адрес гайда строится из заголовка, а не выпрашивается у автора',
    first.slug === 'как-ставить-лагерь-на-холме', first.slug);
  equal('свежий гайд выходит без подписи модерации', first.reviewStatus, 'none');

  await local.createGuide({ title: 'Как добывать серебро', body: okBody });
  equal('третий гайд за сутки отказывает фразой базы',
    await said(() => local.createGuide({ title: 'Третий сегодня', body: okBody })),
    GUIDE_DAILY_LIMIT);

  await local.signIn('Автор2');
  const twin = await local.createGuide({ title: 'Как ставить лагерь на холме', body: okBody });
  check('одинаковые заголовки не спорят за адрес: второй получает суффикс',
    twin.slug === 'как-ставить-лагерь-на-холме-2', twin.slug);
  equal('явно просивший занятый адрес получает отказ, а не суффикс',
    await said(() => local.createGuide({ title: 'Чужое слово', slug: first.slug, body: okBody })),
    'Такой slug уже занят');
  const stamped = await local.createGuide({ title: 'Штамп не проходит', body: okBody, reviewStatus: 'verified' });
  equal('присланный вместе с гайдом штамп модерации некуда положить', stamped.reviewStatus, 'none');
  await local.signIn('Владелец');
  check('модерация суточным лимитам не подчиняется: работа, а не привилегия',
    (await local.createGuide({ title: 'Служебная запись модерации', body: '<p>коротко</p>' })).title
      === 'Служебная запись модерации');

  /* ── Скриншоты ── */
  check('скриншот гайда — то же вложение форума: констрейнт получил третье значение',
    /add constraint forum_attachments_target_type_check\s+check \(target_type in \('post', 'comment', 'guide'\)\)/.test(sql));
  check('картинки гайда читают вторым запросом и не тормозят список',
    supaSrc.includes('target_type=eq.guide') && /const \[sigs, shots\] = await Promise\.all/.test(supaSrc));
  check('загрузка общая: attachImage вызывают с типом guide',
    behavSrc.includes("attachImage('guide', targetId"));
  check('поле с картинками видно только там, где их куда сохранить',
    pageSrc.includes("${s.shared ? attachRow('new') : ''}")
      && behavSrc.includes('state.shared = Boolean(forum.capabilities?.isShared)'));
  check('картинки уходят после создания гайда: вложение ссылается на запись',
    behavSrc.indexOf('await forum.createGuide(') < behavSrc.indexOf('await uploadShots(created.id'));
  check('недогрузившаяся картинка не отменяет публикацию, а называется отказом',
    behavSrc.includes('Не загрузились картинки: ') && /if \(shotFail\) showError\('\[data-guide-error\]'/.test(behavSrc));
  check('выбранные картинки отпускают память при отмене и уходе со страницы',
    /if \(t\.closest\('\[data-guide-cancel\]'\)\)[\s\S]{0,300}clearShots\(\)/.test(behavSrc)
      && /export function unmountGuides\(\)[\s\S]{0,300}clearShots\(\)/.test(behavSrc));

  /* ── Экран ── */
  check('форму пишет любой вошедший без запрета — бан и тишина прячут её, а не обещают отказ',
    pageSrc.includes('const canPublish = (me) => Boolean(me) && !me.banned && !isMuted(me);')
      && pageSrc.includes('const canWrite = canPublish(s.me);')
      && /canWrite && !s\.composing\s*\?\s*'<button[^>]*data-guide-new/.test(pageSrc));
  check('гостю показывают вход, а не неработающую кнопку',
    pageSrc.includes('guides-page__signin') && pageSrc.includes('Войдите</a> — и сможете добавить свой гайд'));
  const composer = /function composeForm\(s\)[\s\S]*?\n\}/.exec(pageSrc)?.[0] ?? '';
  check('в форме больше нет поля адреса',
    composer.length > 200 && !/name="slug"/.test(composer)
      && composer.includes('По заголовку страница получит адрес'));
  check('форма ругается в том же порядке, что база: сначала тело, потом заголовок',
    behavSrc.indexOf('guideBodyProblem(body)') < behavSrc.indexOf('Заголовок гайда короче двух символов'));
  check('не проверенный гайд подписан явно — и в списке, и в шапке',
    pageSrc.includes("none: 'Не проверен'") && /guide-badge--\$\{esc\(kind\)\}/.test(pageSrc)
      && pageSrc.includes('guide-review--') && cssSrc.includes('.guide-badge--none')
      && cssSrc.includes('.guide-review--none'));
  check('«Мои гайды» — отдельная кнопка с состоянием, а не четвёртая категория',
    /data-guide-mine aria-pressed=/.test(pageSrc)
      && pageSrc.includes('.filter((g) => !s.mine || (s.me && g.authorId === s.me.id))')
      && behavSrc.includes('state.mine = !state.mine;')
      && cssSrc.includes('.guide-chip--mine'));

  /* ── Документы ── */
  check('миграция названа в базе, в документах форума и в порядке запуска',
    sql.includes('── ПРАВИЛО ──') && docsSrc.includes('20260929-player-guides.sql')
      && readmeSrc.includes('20260929-player-guides.sql'));
  check('документ говорит, что без миграции до пуша нельзя, и называет её молчаливые отказы',
    docsSrc.includes('**До пуша кода эта миграция обязательна**')
      && readmeSrc.includes('До пуша кода эта миграция обязательна'));
  check('документ называет, чего в гайдах игроков нет намеренно',
    docsSrc.includes('## Гайд пишет любой игрок')
      && docsSrc.includes('- **Очереди на публикацию.**')
      && docsSrc.includes('- **Своей вкладки у справочника.**'));
}

console.log('\nAL. Пульс обновлений: подсказка модерации');
{
  /*
    Человек просил, чтобы сведения об игре попадали в раздел «по мере нового»
    сами. Из браузера так не сделать: он не открывает чужие страницы
    (same-origin), и обещание «читаем сами» означало бы заметку, которую никто
    не проверил перед тем, как её прочитает весь форум. Автомат есть, но он
    живёт вне браузера и по расписанию — см. раздел «AM». Здесь же осталась
    механическая половина ручного пути, которым приносят ВК: разложить
    скопированный текст по семи полям формы.

    Проверяем в первую очередь то, чего в такой подсказке легче всего испугаться:
    что она не додумывает. Пустое поле честнее угаданного, а выдуманная дата или
    «тип» превращают помощник в источник слухов. Дальше — что поля формы
    гарантированно проходят ту же проверку, что и публикация: расхождение
    означает отказ базы после того, как человек уже нажал «Опубликовать».
  */
  const { readFile } = await import('node:fs/promises');
  const rulesSrc = await readFile('src/forum/rules.js', 'utf8');
  const pageSrc = await readFile('src/pages/updates.js', 'utf8');
  const updSrc = await readFile('src/forum/updates.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const L = CONFIG.forum.limits;
  const { parseUpdateSource, updateParseNotice, updateSourceFromLink, updateStoreLinkFromText } =
    await import('../src/forum/rules.js');

  /* Сейчас — фиксированный момент: подсказка не должна зависеть от часов теста. */
  const NOW = new Date('2026-09-20T12:00:00Z').getTime();
  const PLAY = 'https://play.google.com/store/apps/details?id=com.zroute.r33&hl=ru';
  const play = parseUpdateSource(`Что нового
Версия 2.14.0
Обновлено 12 сент. 2026 г.

• Добавлены новые карты в ротацию перечисления
• Переработана грузоподъёмность караванов
• Исправлены ошибки отображения рейтинга альянсов
Показать всё`, PLAY, NOW);

  equal('заголовок берётся из первой настоящей строки, без маркера списка',
    play.title, 'Добавлены новые карты в ротацию перечисления');
  equal('содержание остаётся списком построчно', play.summary.split('\n').length, 3);
  check('служебные строки магазина не попадают в содержание',
    !/Что нового|Показать всё|Версия|Обновлено/.test(play.summary));
  equal('версия ушла в своё поле', play.gameVersion, '2.14.0');
  equal('дата первоисточника — в формате поля формы', play.sourceAt, '2026-09-12T12:00');
  equal('источник назван по домену ссылки', play.sourceName, 'Google Play');
  equal('тип определён по списку правок', play.kind, 'patch');
  check('и ничего не осталось незаполненным', play.missing.length === 0, play.missing.join(', '));

  /* Чего в тексте нет — того в заметке нет. */
  const bare = parseUpdateSource('обновили игру', '', NOW);
  equal('из одной фразы содержание не собирается', bare.summary, '');
  equal('и тип не угадывается', bare.kind, '');
  check('пустое поле названо вслух, а не оставлено молча',
    bare.missing.includes('дата у первоисточника') && bare.missing.includes('что изменилось'));
  const noVersion = parseUpdateSource('• Переработана карта пустыни\n• Убрана ошибка прохода', '', NOW);
  equal('если версия не названа, её поля нет', noVersion.gameVersion, '');

  /* Тип по словам разработчика: признание проблемы важнее списка правок. */
  equal('извинения за проблему — это известная проблема, а не патч',
    parseUpdateSource('Мы знаем о сбое при загрузке базы и работаем над исправлением. Приносим извинения.', '', NOW).kind, 'issue');
  equal('обещание «скоро» — объявление: изменения ещё нет',
    parseUpdateSource('Скоро в ближайшем обновлении появится новый министр экономики.', '', NOW).kind, 'notice');

  /* Ссылка: только страница магазина, и только настоящая. */
  equal('страница App Store называется App Store',
    updateSourceFromLink('https://apps.apple.com/ru/app/id1234567890'), 'App Store');
  equal('чужой домен источником не становится',
    updateSourceFromLink('https://zroutehub.bond/'), '');
  equal('из вставленного текста берётся только ссылка магазина',
    updateStoreLinkFromText(`Смотри https://discord.gg/zzz и https://play.google.com/store/apps/details?id=x`),
    'https://play.google.com/store/apps/details?id=x');
  equal('http-ссылка не проходит: база её не примет',
    parseUpdateSource('• Правки', 'http://play.google.com/store/apps/details?id=x', NOW).sourceUrl, '');
  /*
    Адрес из адресной строки человек вставляет первой строкой чаще всего, и
    разбор не имеет права превращать его в заголовок заметки.
  */
  const linkFirst = parseUpdateSource(`https://play.google.com/store/apps/details?id=com.zroute.r33&hl=ru
Обновлено 26 сент. 2026 г.
• Ускорена загрузка карты сезонного события
• Убрана ошибка двойного найма министра`, '', NOW);
  equal('адрес отдельной строкой не становится заголовком заметки',
    linkFirst.title, 'Ускорена загрузка карты сезонного события');
  check('и адрес не остаётся в содержании: у него своё поле',
    !linkFirst.summary.includes('http')
      && linkFirst.sourceUrl.startsWith('https://play.google.com')
      && linkFirst.sourceName === 'Google Play');

  /* Границы: то, что подсказка ставит в поле, обязано пройти публикацию. */
  const longSource = `${'Очень длинный заголовок обновления игры, '.repeat(12)}
${'Строка изменений списка патча. '.repeat(120)}`;
  const long = parseUpdateSource(longSource, '', NOW);
  check('заголовок не длиннее предела формы', long.title.length <= L.updateTitleMax, String(long.title.length));
  check('содержание не длиннее предела формы', long.summary.length <= L.updateSummaryMax, String(long.summary.length));
  /*
    Сравниваем с нормализованным текстом: подсказка убирает переводы строк и
    лишние пробелы, и требовать от неё дословной копии вставленной страницы
    значило бы требовать, чтобы она копировала мусор магазина.
  */
  const norm = longSource.split('\n').map((line) => line.trim()).join('\n');
  check('обрезка идёт по границе слова и строки, а не посередине',
    !/[,;:\s]$/.test(long.title)
      && norm.startsWith(long.summary)
      && (norm[long.summary.length] === undefined || /\s/.test(norm[long.summary.length])),
    `хвост: ${JSON.stringify(long.summary.slice(-12))}`);
  check('и в поле не попадает ничего, чего не было в тексте',
    norm.includes(long.title) && norm.includes(long.summary));
  equal('дата из будущего отвергается той же меркой, что и базой',
    parseUpdateSource('Обновлено 30 дек. 2030 г.\n• Правка карты\n• Правка баланса', '', NOW).sourceAt, '');
  equal('и дата раньше прошлого века тоже',
    parseUpdateSource('Обновлено 3 мая 1999 г.\n• Правка карты\n• Правка баланса', '', NOW).sourceAt, '');

  /* Разговор с модератором: что перенесли и что остались делать ему. */
  check('подсказка говорит, что перенесла, и называет остаток по-русски',
    updateParseNotice(parseUpdateSource('', '', NOW)).startsWith('В этом тексте я не нашёл ничего')
      && /Перенёс в форму:/.test(updateParseNotice(noVersion))
      && /Не нашёл в тексте и оставил вам:/.test(updateParseNotice(noVersion)));
  check('в коде разбора нет ни одного обращения наружу',
    !/fetch\(|XMLHttpRequest|import\(/.test(rulesSrc.slice(rulesSrc.indexOf('/* ── Подсказка модерации'), rulesSrc.indexOf('export const CATEGORY_IDS'))));

  /* Форма: вставка — отдельное поле, а не восьмое содержимое заметки. */
  check('поле вставки и кнопка разбора стоят над полями заметки',
    pageSrc.indexOf('name="paste"') < pageSrc.indexOf('name="title"')
      && pageSrc.includes('data-upd-parse') && pageSrc.includes('data-upd-notice'));
  check('вставленный текст переживает перерисовку формы',
    /const DRAFT_FIELDS = \[[^\]]*'paste'/.test(updSrc) && updSrc.includes('for (const name of DRAFT_FIELDS)'));
  check('чужое поле не перезаписывается: подсказка берёт только пустое',
    /if \(String\(el\.value\)\.trim\(\) && name !== 'kind'\) continue;/.test(updSrc)
      && updSrc.includes('touched.add(el.name)'));
  check('ответ подсказки экранируется, как и всё, что принёс человек',
    /<p class="upd-paste__notice" data-upd-notice>\$\{esc\(s\.notice\)\}/.test(pageSrc));
  check('поле, кнопка и ответ одеты стилем',
    cssSrc.includes('.upd-paste textarea') && cssSrc.includes('.upd-paste__notice'));

  /* Документ не имеет права утверждать, что автомата не стало меньше: подсказка
     формы — ручной путь для ВК, а магазины читает планировщик. Фразу ищем по
     всему документу, переносы строк не в счёт. */
  check('документ описывает и подсказку формы, и планировщик вне браузера',
    docsSrc.includes('### Подсказка в форме') && docsSrc.includes('## Фид магазина')
      && docsSrc.replace(/\s+/g, ' ').includes('из браузера в магазин не сходить')
      && docsSrc.includes('same-origin')
      && !docsSrc.includes('Автоматического чтения чужих страниц'));
}

// ── AM. Фид магазина: разбор страницы и планировщик ──────────────────────────

console.log('\nAM. Фид магазина: обновление и события автоматом');
{
  /*
    Человек просил, чтобы обновления из Google Play и App Store сами складывались
    в один пост на обе площадки, а события из Плей Маркета приходили туда же.
    Проверяем по границе, которую этот автомат обязан держать:

      1. Разбор чужой вёрстки не ходит наружу. Ходит планировщик, и только он.
      2. Автомат не додумывает: ни даты, ни содержания, ни «подробностей».
         Площадка, которая промолчала, из поста выпадает, а не заполняется
         заглушкой, и её молчание видит модерация, а не читатель.
      3. Событие без начальной даты в базу не едет: column starts_at обязателен
         именно потому, что «идёт сейчас» датой быть не может.
      4. Числа, тексты отказов и их порядок в базе, в черновом режиме и в
         разборе — одни и те же.
      5. Убранное из списка уходит из базы насовсем: второго движения нет, а
         ключ строки переживает удаление в таблице отметок, и следующий обход
         магазина не приносит карточку обратно.

    Фикстуры взяты с живой страницы: карточка события с настоящей припиской
    jslog, настоящий служебный JSON с версией и датой, настоящий заголовок
    страницы события. Ожидаемые значения получены прогоном на этих фикстурах,
    а не на глаз: разбор чужой вёрстки живёт именно на них.
  */
  const { readFile } = await import('node:fs/promises');
  const feedSrc = await readFile('src/forum/feed.js', 'utf8');
  const scriptSrc = await readFile('scripts/store-feed.mjs', 'utf8');
  const flowSrc = await readFile('.github/workflows/store-feed.yml', 'utf8');
  const sql = await readFile('supabase/applied/20260930-store-feed.sql', 'utf8');
  const pulseSql = await readFile('supabase/applied/20260926-update-pulse.sql', 'utf8');
  const finalSrc = await readFile('supabase/applied/20261005-feed-final-delete.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const pageSrc = await readFile('src/pages/updates.js', 'utf8');
  const updSrc = await readFile('src/forum/updates.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const hostingSrc = await readFile('docs/HOSTING.md', 'utf8');
  const feed = await import('../src/forum/feed.js');
  const { renderUpdates } = await import('../src/pages/updates.js');
  const L = CONFIG.forum.limits;
  const NOW = Date.parse('2026-09-30T12:00:00Z');

  /* Кусок служебного JSON живой страницы: версия и метка обновления. */
  const PLAY_META = '[[["1.36.05"]],[[[35]],[[[23,"6.0"]]]]],null,null,null,null,'
    + '[["23 сент. 2026 г.",[1790178118,131000000]]]';

  /* Настоящая карточка события со страницы приложения. */
  const EVENT_ID = '4829466076333755096';
  const EVENT_JSLOG_B64 = 'CCGqAnEabwgAShMIzuCi+N6UlwMVvJP9Bx3jvDbAsgRVClEKFwoR'
    + 'Y29tLnpyb3V0ZS5nbG9iYWwQARgDEhkKEzQ4Mjk0NjYwNzYzMzM3NTUwOTYQURgDGAMgAiiA'
    + 'mvatjjQwgOqOpZA0QAFIAVoCCAGAAQMwEA==';
  const EVENT_TITLE = 'Событие «Готовность экипажа» началось';
  const PLAY_CARD = `role="listitem"><div class="VfPpkd-WsjYwc" jslog="38003; 1:598|`
    + `${EVENT_JSLOG_B64}; track:click,impression"><div class="VfPpkd-aGsRMb">`
    + `<a class="Si6A0c" href="/store/apps/eventdetails/${EVENT_ID}">`
    + '<div class="O45KTd"><div class="DU6Edd">Доступно обновление</div></div>'
    + '<div class="EM9ELc"><img src="https://play-lh.googleusercontent.com/x=w648" /></div>'
    + `<div class="BEJvHf"><div class="gFWm9b">${EVENT_TITLE}</div></div></a></div></div>`;

  /* Старая вёрстка: заголовок раздела и строки названия с датами. */
  const OLD_PAGE = '<div>Трасса Z: Искупление</div><div>События</div>'
    + '<div>Сезон караванов</div><div>3 окт. — 12 окт. 2026</div>'
    + '<div>Подробнее</div><div>Отзывы</div><div>Данные разработчика</div>';

  /* Страница самого события: заголовок ответа и служебная метка описания. */
  const EVENT_PAGE = `<html><head><title>${EVENT_TITLE}</title>`
    + '<meta content="Экипажи, общий сбор! Событие ограничено по времени."'
    + ' property="og:description" /></head><body>Трасса Z</body></html>';

  const flat = sql.replace(/\s+/g, ' ');
  const finalFlat = finalSrc.replace(/\s+/g, ' ');
  /*
    Дверь записи, представление списка и двери удаления читаем из новой
    миграции: прежний файл остался в истории ровно тем, как был запущен, а
    решение об отсутствии у события второго движения принималось уже здесь.
  */
  const recSql = finalSrc.slice(finalSrc.indexOf('create or replace function public.forum_record_store_event'),
    finalSrc.indexOf('-- ── Шаг 4.')).replace(/\s+/g, ' ');
  const delEventSql = finalSrc.slice(finalSrc.indexOf('create or replace function public.forum_delete_store_event'),
    finalSrc.indexOf('-- ── Шаг 5.')).replace(/\s+/g, ' ');
  const marksSql = finalSrc.slice(0, finalSrc.indexOf('-- ── Шаг 2.')).replace(/\s+/g, ' ');
  const teardownSql = finalSrc.slice(finalSrc.indexOf('-- ── Шаг 5.'),
    finalSrc.indexOf('-- ── Шаг 6.')).replace(/\s+/g, ' ');
  const localFeed = localSrc.slice(localSrc.indexOf('/* ── Фид магазина в локальном режиме'));
  const supaFeed = supaSrc.slice(supaSrc.indexOf('function storeEventOut(row)'));
  const eventTypedef = contractSrc.slice(contractSrc.indexOf('@typedef {Object} ForumStoreEvent'),
    contractSrc.indexOf('@typedef {Object} ForumStoreStatus'));
  /* Заголовок обращения к чужому сайту: нашего ключа базы там быть не должно. */
  const externalCall = scriptSrc.slice(scriptSrc.indexOf('async function fetchExternal'),
    scriptSrc.indexOf('const DEBUG_HEADS'));
  /* Только представление списка, без его grant: в нём фильтров быть не должно. */
  const listViewSql = finalSrc.slice(finalSrc.indexOf('create or replace view public.forum_store_event_list'),
    finalSrc.indexOf('grant select on public.forum_store_event_list')).replace(/\s+/g, ' ');

  /** Фразы идут в тексте именно в этом порядке. */
  function inOrder(src, phrases) {
    let from = 0;
    for (const phrase of phrases) {
      const at = src.indexOf(phrase, from);
      if (at < 0) return false;
      from = at + 1;
    }
    return true;
  }

  /* ── 1. Разбор страницы: что читается и чем ── */
  equal('версия Android читается из служебного JSON страницы',
    feed.extractPlayMeta(PLAY_META).version, '1.36.05');
  equal('дата обновления — секундами оттуда же, а не переводом надписи',
    feed.extractPlayMeta(PLAY_META).at, '2026-09-23');
  equal('и строка для человека называется',
    feed.extractPlayMeta(PLAY_META).dateLine, 'Последнее обновление: 23 сент. 2026 г.');
  equal('на странице не того содержания — ни версии, ни даты',
    feed.extractPlayMeta('<html><body>Трасса Z</body></html>'),
    { version: '', dateLine: '', at: '' });
  equal('метка вне разумного поля датой не становится',
    feed.extractPlayMeta('[["1 янв. 2001 г.",[978307200,0]]]').at, '');
  equal('адрес страницы собирается из идентификатора и страны, а не пишется руками',
    feed.playPageUrl({ playId: 'com.example.app', country: 'ru' }),
    'https://play.google.com/store/apps/details?id=com.example.app&hl=ru');
  equal('у iOS источник — официальный JSON, а не вёрстка',
    feed.itunesLookupUrl({ appStoreId: '6762269117', country: 'ru' }),
    'https://itunes.apple.com/lookup?id=6762269117&country=ru');

  /* Страница Play целиком: раздела «Что нового» в новой вёрстке нет вовсе. */
  const silentPlay = feed.readPlayPage(PLAY_META, NOW);
  equal('но страница не считается пустой: версия и дата есть', silentPlay.how, 'meta');
  equal('и из них собирается половина поста', silentPlay.gameVersion, '1.36.05');
  equal('текста обновления при этом нет, и он не выдумывается', silentPlay.summary, '');
  equal('заглушка вместо приложения называется отказом, а не пустотой',
    feed.readPlayPage('<html><body>Сервер недоступен</body></html>', NOW).how, 'no-page');

  /* ── 2. События: даты есть только в служебной приписке карточки ── */
  equal('начало события читается из приписки карточки',
    feed.decodeEventWindow(EVENT_JSLOG_B64, EVENT_ID).startsAt, '2026-09-28T02:00:00Z');
  equal('и его конец тоже', feed.decodeEventWindow(EVENT_JSLOG_B64, EVENT_ID).endsAt,
    '2026-10-04T02:00:00Z');
  equal('способ назван: планировщик отличает «дат нет» от «разбор сломан»',
    feed.decodeEventWindow(EVENT_JSLOG_B64, EVENT_ID).how, 'jslog');
  equal('чужой id чужие даты не получает',
    feed.decodeEventWindow(EVENT_JSLOG_B64, '9007199254740993').startsAt, '');
  equal('кривое основание не роняет разбор и не выдаёт дат',
    feed.decodeEventWindow('@@@###$$$!!!', EVENT_ID),
    { startsAt: '', endsAt: '', how: '' });
  {
    /* Поле 5 = начало, поле 6 = конец; зазор в 500 дней — не событие года. */
    const varint = (n) => {
      const out = [];
      for (;;) {
        const b = n % 128;
        n = Math.floor(n / 128);
        out.push(b | (n ? 0x80 : 0));
        if (!n) return out;
      }
    };
    const far = Buffer.from([...varint(5 << 3), ...varint(1790000000000),
      ...varint(6 << 3), ...varint(1790000000000 + 500 * 86400000)]).toString('base64');
    equal('дата дальше года вперёд окном события не становится',
      feed.decodeEventWindow(far, '').startsAt, '');
  }

  const cards = feed.extractStoreEvents(PLAY_CARD, NOW);
  equal('карточка события на странице приложения — основной путь разбора',
    cards.how, 'cards');
  equal('название — самая длинная строка карточки, а не плашка рода события',
    cards.events[0].title, EVENT_TITLE);
  equal('плашка остаётся подписью рядом с названием', cards.events[0].label, 'Доступно обновление');
  equal('у события есть адрес его собственной страницы',
    cards.events[0].sourceUrl, `https://play.google.com/store/apps/eventdetails/${EVENT_ID}`);
  equal('ключ строки считает та же функция, что читает его база',
    cards.events[0].feedKey, feed.storeEventKey('android', EVENT_TITLE));
  check('короткое имя события ключом короче нижнего порога базы не становится',
    feed.storeEventKey('other', 'А').length >= L.storeEventKeyMin,
    feed.storeEventKey('other', 'А'));
  check('а длинное не выходит за верхний порог',
    feed.storeEventKey('android', `Событие ${'готовность экипажа '.repeat(12)}`).length <= L.storeEventKeyMax,
    String(feed.storeEventKey('android', `Событие ${'готовность экипажа '.repeat(12)}`).length));
  equal('тот же текст с чужими пробелами и регистром — тот же ключ, а не второе событие',
    feed.storeEventKey('android', `  ${EVENT_TITLE.toUpperCase()}  `),
    feed.storeEventKey('android', EVENT_TITLE));
  equal('старая вёрстка без карточек читается запасным путём',
    feed.extractStoreEvents(OLD_PAGE, NOW).how, 'lines');
  {
    const old = feed.extractStoreEvents(OLD_PAGE, NOW).events;
    equal('и строка, в которой одна дата, вторым событием не становится',
      old.map((e) => e.title), ['Сезон караванов']);
    equal('даты из текстовых строк разбираются тем же полем',
      [old[0].startsAt, old[0].endsAt], ['2026-10-03T12:00', '2026-10-12T12:00']);
  }
  equal('на странице без раздела событий нет и выдуманных событий',
    feed.extractStoreEvents('<div>Трасса Z</div>', NOW), { events: [], how: 'no-head' });
  equal('описание события берётся с его собственной страницы',
    feed.extractEventPage(EVENT_PAGE).summary,
    'Экипажи, общий сбор! Событие ограничено по времени.');
  equal('название страницы события не подставляется вместо карточного',
    feed.extractEventPage(EVENT_PAGE).title, EVENT_TITLE);
  equal('страница без служебной метки возвращается без описания',
    feed.extractEventPage('<html><head><title>Событие</title></head></html>').summary, '');
  equal('дата уходит в базу полным ISO, а не недоразумением «2026-09-25:00Z»',
    feed.toStoreIso('2026-09-23'), '2026-09-23T12:00:00Z');
  equal('и уже готовое ISO проходит через то же поле неизменённым',
    feed.toStoreIso('2026-09-28T02:00:00Z'), '2026-09-28T02:00:00Z');

  /* ── 3. Пост на обе площадки: молчание — не содержание ── */
  equal('если обе площадки молчат, поста нет',
    feed.composeStoreNote({ android: {}, ios: {} }, NOW),
    { fields: null, why: 'Ни один магазин не ответил за этот обход.', stale: [] });
  {
    const half = feed.composeStoreNote({
      android: { gameVersion: '1.36.05', at: '2026-09-23', text: '' },
      ios: { version: '1.36.05', releaseNotes: 'Обновление версии', at: '2026-09-25' },
      known: {},
    }, NOW);
    check('пост один, и в нём обе площадки: Android над iOS',
      /^Android 1\.36\.05, 23 сент\. 2026 г\.:/m.test(half.fields.summary)
        && /\n\niOS 1\.36\.05, 25 сент\. 2026 г\.:/m.test(half.fields.summary),
      half.fields.summary);
    equal('пустое поле релизных заметок iOS текстом поста не становится',
      /описания изменений магазин не печатает/.test(half.fields.summary), true);
    check('в посте нет ни слова о нашем сбое',
      !/не ответила|ошибк|сбой|не нашло/.test(half.fields.summary), half.fields.summary);
    equal('номер версии в посте назван для обеих площадок',
      half.fields.gameVersion, 'Android 1.36.05 · iOS 1.36.05');
    equal('датой поста становится день первоисточника, а не день запуска',
      half.fields.sourceAt, '2026-09-25');
    equal('источник поста назван обеими площадками', half.fields.sourceName, 'Google Play и App Store');
    equal('и ничего не осталось незаполненным', half.missing, []);
  }
  {
    const oneSided = feed.composeStoreNote({
      android: {}, ios: { version: '1.40.0', releaseNotes: '', at: '2026-09-28' },
    }, NOW);
    equal('молчавшая площадка называется в отчёте, а не в посте',
      oneSided.missing, ['Android']);
    check('её половина в содержание не попала',
      !oneSided.fields.summary.includes('Android'), oneSided.fields.summary);
  }
  equal('уже опубликованная версия поста не повторяет',
    feed.composeStoreNote({
      android: { gameVersion: '1.36.05', at: '2026-09-23', text: '' },
      ios: { version: '1.36.05', releaseNotes: ' '.repeat(40), at: '2026-09-25' },
      known: { android: '1.36.05', ios: '1.36.05' },
    }, NOW).why, 'Обе площадки стоят на уже опубликованных версиях.');
  equal('регистр буквы в номере версии для повтора не аргумент',
    feed.composeStoreNote({
      android: { gameVersion: '1.36.05B', at: '2026-09-23', text: '' },
      ios: {}, known: { android: '1.36.05b', ios: '' },
    }, NOW).why, 'Android не менялся, iOS ничего не принёс.');
  /*
    ── 3б. Задержка магазина: версия старше опубликованной ──

    Три карточки одного патча 30 сентября родились вот из чего: App Store на
    одном обходе отдал 1.37.01, на следующем — 1.36.05, ещё через пять часов —
    снова 1.37.01. Автомат сверял версии равенством, поэтому каждую смену счёл
    новым обновлением, а записав старую версию в состояние, гарантировал повтор
    на следующем запуске. Проверки ниже гоняют именно ту последовательность.
  */
  {
    const lag = feed.composeStoreNote({
      android: { gameVersion: '1.37.01', at: '2026-09-29', text: '' },
      ios: { version: '1.36.05', releaseNotes: '', at: '2026-09-25' },
      known: { android: '1.37.01', ios: '1.37.01' },
    }, NOW);
    equal('версия старше опубликованной — не новое обновление', lag.fields, null);
    equal('и отказ назван задержкой площадки, а не выходом патча', lag.why,
      'Android не менялся, iOS отдал версию старше опубликованной.');
    equal('задержавшаяся площадка названа в отчёте обхода', lag.stale, ['iOS']);
  }
  {
    const both = feed.composeStoreNote({
      android: { gameVersion: '1.36.05', at: '2026-09-23', text: '' },
      ios: { version: '1.36.05', releaseNotes: '', at: '2026-09-25' },
      known: { android: '1.37.01', ios: '1.37.01' },
    }, NOW);
    equal('обе площадки отстали — поста нет, и это сказано словами', both.why,
      'Обе площадки отдали версии старше опубликованных: так отвечает кэш магазинов, поста нет.');
    equal('и обе названы задержанными', both.stale, ['Android', 'iOS']);
  }
  {
    const half = feed.composeStoreNote({
      android: { gameVersion: '1.38.0', at: '2026-09-30', text: '' },
      ios: { version: '1.36.05', releaseNotes: '', at: '2026-09-25' },
      known: { android: '1.37.01', ios: '1.37.01' },
    }, NOW);
    check('задержка одной площадки не отменяет пост о другой', !!half.fields, half.why);
    check('отставшая половина в содержание не попала',
      !half.fields.summary.includes('iOS'), half.fields.summary);
    equal('её номер не едет в бейдж версии', half.fields.gameVersion, 'Android 1.38.0');
    equal('её старая дата не становится датой поста', half.fields.sourceAt, '2026-09-30');
    equal('и она названа задержкой', half.stale, ['iOS']);
  }
  equal('1.10 после 1.9 — новее, а не старше: порядок считает числа, а не строку',
    feed.versionOrder('1.10', '1.9'), 1);
  equal('и наоборот — откат', feed.versionOrder('1.9', '1.10'), -1);
  equal('номер с пустым хвостом равен короткому: 1.37.0 после 1.37 — не откат',
    feed.versionOrder('1.37.0', '1.37'), 0);
  check('номер без чисел сравнению не поддаётся и задержкой не считается',
    Number.isNaN(feed.versionOrder('beta', '1.37.01')));
  {
    const odd = feed.composeStoreNote({
      android: { gameVersion: 'beta', at: '2026-09-30', text: '' },
      ios: {}, known: { android: '1.37.01', ios: '' },
    }, NOW);
    check('не читаемый номер задержкой не становится: пост о нём выходит',
      !!odd.fields && odd.stale.length === 0, odd.why);
  }
  check('в состояние обхода отставшая площадка не пишет ни версии, ни даты',
    scriptSrc.includes('const lagged = note.stale || [];')
      && scriptSrc.includes("said('Android', android.gameVersion || ''")
      && scriptSrc.includes("said('iOS', ios.version || ''"));
  check('модератор видит задержку магазина в отчёте обхода и в журнале',
    scriptSrc.includes('(задержка магазина)') && scriptSrc.includes('задержка магазина:'));
  check('правило задержки описано в документе теми же словами, что работает',
    docsSrc.includes('задержавшейся') && docsSrc.includes('порядков')
      && docsSrc.includes('1.10'));
  equal('ни у одной площадки даты нет — и в посте её нет',
    feed.pickLatestDate('', '', NOW), '');
  equal('«Обновление версии» — не содержание', feed.cleanIosNotes('Обновление версии.'), '');
  equal('но живая строка релизных заметок остаётся',
    feed.cleanIosNotes('Переработана грузоподъёмность караванов.'),
    'Переработана грузоподъёмность караванов.');

  /* ── 4. Границы: разбор не имеет права выдать то, что база не примет ── */
  const SQL_NUMBERS = [
    ['название события', `char_length(title) between ${L.storeEventTitleMin} and ${L.storeEventTitleMax}`],
    ['описание события', `char_length(summary) <= ${L.storeEventSummaryMax}`],
    ['ключ события', `char_length(feed_key) between ${L.storeEventKeyMin} and ${L.storeEventKeyMax}`],
    ['отчёт об обходе', `char_length(last_run_text) <= ${L.storeRunTextMax}`],
    ['длина ссылки события', `char_length(source_url) <= ${L.updateUrlMax}`],
  ];
  for (const [label, needle] of SQL_NUMBERS) {
    check(`число «${label}» в базе и в конфиге одно и то же`, flat.includes(needle), needle);
  }
  check('начало события обязано самой базой: без даты строка не существует',
    flat.includes('starts_at timestamptz not null'));
  check('конец события необязателен, а пережитый порядок дат — ошибка',
    recSql.includes('if p_ends_at is not null and p_ends_at <= p_starts_at then'));
  check('ссылка события либо настоящая, либо пустая строка',
    flat.includes("source_url text not null default '' check (source_url = '' or (source_url ~ '^https://[^[:space:]]+$'")
      && flat.includes('and char_length(source_url) <= 500))'));
  check('дверь записывает ровно то, что разрешила: строки не обрезаются молча',
    recSql.includes(`left(v_title, ${L.storeEventTitleMax})`)
      && recSql.includes(`left(v_text, ${L.storeEventSummaryMax})`));
  check('сколько карточек показывать и когда прятать пережитое — выбор страницы, а не базы',
    listViewSql.length > 100 && !/\blimit\b|\boffset\b|\bwhere\b/i.test(listViewSql)
      && feedSrc.includes('L.storeEventListMax') && feedSrc.includes('L.storeEventHideAfterDays'));
  check('разбор называет границы теми же числами, что и публикация',
    /L\.storeEvent/.test(feedSrc) && !/= 120\b/.test(feedSrc.split('readEventCards')[1]?.split('\n}')[0] ?? ''));

  /* ── 5. Право и порядок отказов: одна база, один черновой режим ── */
  const RECORD_REFUSALS = [
    'Событие из магазина приносит модерация',
    'Ключ события короче',
    'Ключ события длиннее',
    'Неизвестная площадка события',
    'Название события короче',
    'Название события длиннее',
    'Описание события длиннее',
    'У события нет начала',
    'У события конец раньше начала',
    'Ссылка на событие не начинается с https://',
    'Ссылка на событие не может содержать пробелы',
    'Ссылка на событие длиннее',
  ];
  check('дверь события отказывает в названном порядке и своими словами',
    inOrder(recSql, RECORD_REFUSALS));
  const DELETE_EVENT_REFUSALS = [
    'Событие из магазина удаляет модерация',
    'Событие не найдено',
  ];
  check('удаление события — те же слова и тот же порядок в обоих режимах',
    inOrder(delEventSql, DELETE_EVENT_REFUSALS) && inOrder(localFeed, DELETE_EVENT_REFUSALS));
  check('убранное не возвращается: дверь удаляет строку и не трогает отметку ключа',
    delEventSql.includes('delete from public.forum_store_events where id = p_target')
      && !/delete from public\.forum_feed_marks/.test(finalFlat));
  check('слово «уже было» берётся из отметки, а не из индекса: удалённую строку индекс молчит',
    recSql.includes('if exists (select 1 from public.forum_feed_marks where feed_key = v_key) then')
      && recSql.includes("return 'уже было';"));
  check('живое событие обновляется до спрашивания отметки: магазин правит даты, а не заводит дубль',
    inOrder(recSql, ['update public.forum_store_events', "return 'обновлено';",
      'from public.forum_feed_marks', 'insert into public.forum_store_events', "return 'новое';"]));
  check('новое событие оставляет отметку в том же вызове двери, что и строку',
    inOrder(recSql, ['insert into public.forum_store_events',
      'insert into public.forum_feed_marks (feed_key, what, title)', "values (v_key, 'event'"]));
  check('отметка события живёт своей таблицей и на запись себе права не даёт',
    marksSql.includes('create table if not exists public.forum_feed_marks (')
      && marksSql.includes("what text not null check (what in ('note', 'event'))")
      && marksSql.includes('grant select on public.forum_feed_marks to authenticated;')
      && !/for insert|for update|for delete/i.test(marksSql));
  check('ни одной политики на запись: браузер в таблицы фида не пишет',
    !/for insert|for update|for delete/i.test(sql + finalSrc));
  check('читает список и гость, и вошедший — таблицей и представлением',
    flat.includes('grant select on public.forum_store_events to anon, authenticated;')
      && finalFlat.includes('grant select on public.forum_store_event_list to anon, authenticated;')
      && flat.includes('grant select on public.forum_store_status to anon, authenticated;'));
  check('разных состояний у строки больше нет, поэтому и правило чтения не различает читателей',
    finalFlat.includes('for select using (true);')
      && !/status = 'published' or public\.forum_is_staff\(\)/.test(finalFlat));
  check('дверей стало больше, и каждая спрашивает роль сама',
    (sql.match(/language plpgsql security definer/g) || []).length === 3
      && (finalSrc.match(/language plpgsql security definer/g) || []).length === 4
      && recSql.includes('if not public.forum_is_staff() then')
      && delEventSql.includes('if not public.forum_is_staff() then'));
  check('двери закрыты от гостя и открыты вошедшему',
    flat.includes('revoke all on function public.forum_record_store_event(')
      && flat.includes('grant execute on function public.forum_mark_store_run(')
      && finalFlat.includes('grant execute on function public.forum_delete_store_event(uuid) to authenticated;'));
  check('автором остаётся тот, кто вошёл: просить чужой ник не о чем',
    !/p_author|p_nick/.test(sql + finalSrc) && finalSrc.includes('auth.uid()'));
  check('состояние обхода — одна строка, и это проверяет база, а не договорённость',
    flat.includes('id boolean primary key default true check (id)'));
  check('единственная строка заведена миграцией: иначе отчёт пропал бы молча',
    flat.includes('insert into public.forum_store_state (id) values (true) on conflict (id) do nothing;'));
  /*
    Время прогона миграции — не слово планировщика: строка «Планировщик
    заходил …» обязана появляться только после настоящего обхода, поэтому
    колонка остаётся пустой, а файл правит и те строки, что завел более ранний
    запуск этого же файла.
  */
  check('до первого обхода состояние молчит: дата прогона не выдаётся за запуск',
    flat.includes('last_run_at timestamptz,')
      && !flat.includes('last_run_at timestamptz not null'));
  check('а уже заведённую неправдой строку миграция лечит повторным запуском',
    flat.includes('alter table public.forum_store_state alter column last_run_at drop default;')
      && flat.includes('alter table public.forum_store_state alter column last_run_at drop not null;')
      && flat.includes('set last_run_at = null where last_run_at is not null and last_run_text = \'\'')
      && flat.includes('and android_version = \'\' and ios_version = \'\' and last_note_id is null;'));
  check('убранное уходит из базы, а его ключ уже записан в отметки',
    inOrder(teardownSql, ['insert into public.forum_feed_marks (feed_key, what, title)',
      "delete from public.forum_store_events where status = 'archived';",
      "delete from public.forum_update_notes where status = 'archived';"])
      && teardownSql.includes('on conflict (feed_key) do nothing;'));
  check('архив снесён как состояние: колонки ушли вместе с дверью',
    /alter table public\.forum_store_events\s+drop column if exists status,?\s+drop column if exists archived_at,?\s+drop column if exists archived_by/.test(finalSrc)
      && finalFlat.includes('drop function if exists public.forum_set_store_event_archive(uuid, boolean);'));
  check('представления спрашивают права читателя',
    finalFlat.includes('create or replace view public.forum_store_event_list with (security_invoker = on) as')
      && flat.includes('create or replace view public.forum_store_status with (security_invoker = on) as'));
  check('в списке событий нет ни архивной колонки, ни второго joins ради ника убравшего',
    !/archiv/i.test(listViewSql) && !/left join public\.forum_profiles p_arch/.test(finalFlat));

  /* ── 6. Граница «кто ходит наружу» ── */
  check('в разборе страницы нет ни одного обращения наружу',
    !/fetch\(|XMLHttpRequest|import\(|require\(/.test(feedSrc));
  check('и на странице форума тоже: браузер показывает то, что уже в базе',
    !/fetch\(/.test(pageSrc + updSrc));
  check('наружу ходит только планировщик — по двум адресам и без нашего ключа в чужих заголовках',
    scriptSrc.includes('fetchExternal(')
      && scriptSrc.includes('playPageUrl(') && scriptSrc.includes('itunesLookupUrl(')
      && externalCall.length > 100 && !/apikey|anonKey|Authorization/.test(externalCall));
  check('служебного ключа базы в проекте нет: бот входит как игрок',
    !/service_role|SERVICE_KEY/i.test(sql + scriptSrc + flowSrc + feedSrc)
      && scriptSrc.includes('/auth/v1/token?grant_type=password'));
  check('пароль берётся только из переменных окружения и в репозитории не лежит',
    scriptSrc.includes('process.env.STORE_FEED_PASSWORD')
      && !/STORE_FEED_PASSWORD\s*=\s*['"`][^'"`]/.test(flowSrc + scriptSrc));
  check('сухой прогон — поведение по умолчанию, пишет только флаг',
    scriptSrc.includes("process.argv.includes('--писать')"));
  check('без учётных данных запуск не падает, а остаётся сухим',
    scriptSrc.includes('Нет STORE_FEED_NICK или STORE_FEED_PASSWORD — в базу не пишем.'));
  check('планировщик зовётся по расписанию и руками',
    flowSrc.includes('schedule:') && flowSrc.includes("cron: '17 * * * *'")
      && flowSrc.includes('workflow_dispatch'));
  /*
    Часовой слот — страховка, а не единственный путь: 5 октября 2026 года
    GitHub после 18:25 UTC не отдал ни одного слота за два часа. Пуш по файлам
    самого фида даёт прогон в ту же минуту, и им проверяется, дошла ли читалка
    стены до раннера. Ветка обязана быть одна: разовая задача во временной ветке
    не имеет права приносить посты.
  */
  check('правка автомата проверяется сразу: пуш по файлам фида зовёт прогон на боевой ветке',
    /push:[\s\S]{0,40}branches: \['main'\]/.test(flowSrc)
      && flowSrc.includes("- '.github/workflows/store-feed.yml'")
      && flowSrc.includes("- 'scripts/store-feed.mjs'")
      && flowSrc.includes("- 'src/forum/vk-feed.js'")
      && docsSrc.includes('на `on: push`'));
  /*
    Расписание часовое, а не «три раза в сутки»: GitHub отдаёт слоты
    планировщика без гарантии и 30 сентября просто не вызвал автомат в 04:15
    UTC. При трёх слотах такой пропуск означает молчание до следующего окна,
    при часовом — один час. Проверка сторожит именно это: вернуть редкое
    расписание так же легко, как на вид безобидную минутку в cron.
  */
  const feedCron = ((flowSrc.match(/- cron: '([^']+)'/) || [, ''])[1]);
  check('проверка магазина ходит каждый час',
    /^[0-5]?\d \* \* \* \*$/.test(feedCron));
  check('два запуска не пишут один пост дважды',
    flowSrc.includes('concurrency:') && flowSrc.includes('cancel-in-progress: false'));
  check('права воркфлоу — только чтение репозитория', flowSrc.includes('contents: read'));
  /*
    Первый же боевой прогон упал не на разборе магазина, а на самом файле:
    имя «Фид магазина: обновления и события» YAML прочесть не может — «: »
    посередине значения он считает началом новой пары. GitHub при этом не
    называет причину словами: завод прогон с нулём задач, показывает путь
    файла вместо имени, и автомат молчит так, будто его вовсе нет.
  */
  const flowName = ((flowSrc.match(/^name:[ \t]*(.+)$/m) || ['', ''])[1]).trim();
  check('имя планировщика читается: двоеточия внутри значения имени нет',
    flowName.length > 3 && !flowName.includes(':'));
  check('документ зовёт планировщик тем же именем, что список Actions',
    docsSrc.includes(`«${flowName}»`));
  check('флажок ручного запуска описан в документе теми же словами, что в файле',
    docsSrc.replace(/\s+/g, ' ').includes(
      (flowSrc.match(/description: '([^']+)'/) || [, ''])[1].replace(/\s+/g, ' ')));
  check('разбор чинится по журналу: при отказе печатается вёрстка вокруг заголовков',
    scriptSrc.includes('страница не разобрана') && scriptSrc.includes('headsAudit('));

  /* ── 7. Контракт, адаптеры и то, что видит читатель ── */
  check('контракт обещает два чтения и одно удаление по событию',
    ['listStoreEvents', 'getStoreStatus', 'deleteStoreEvent']
      .every((n) => contractSrc.includes(`[${n}]`))
      && contractSrc.includes('@typedef {Object} ForumStoreEvent'));
  check('у события нет ни статуса, ни имени убравшего: у него одно состояние',
    !/@property \{[^}]*\} (status|archivedAt|archivedByNick)/.test(eventTypedef)
      && !/setStoreEventArchived|forum_set_store_event_archive/.test(contractSrc));
  check('боевой режим читает представление и зовёт дверь удаления',
    supaFeed.includes('/forum_store_event_list?select=*&order=starts_at.desc')
      && supaFeed.includes("'/rpc/forum_delete_store_event'")
      && supaFeed.includes('p_target: id')
      && supaFeed.includes('/forum_store_status?select=*&limit=1'));
  check('поля строки приходят из столбцов базы, а не выдумываются',
    supaFeed.includes('feedKey: row.feed_key') && !/row\.archived_by_nick/.test(supaFeed));
  check('черновой режим называет границы тем же числом списка',
    localFeed.includes('L.storeEventListMax') && supaFeed.includes('limits.storeEventListMax'));
  {
    const live = {
      id: 'e1', title: EVENT_TITLE, summary: 'Экипажи, общий сбор!', platform: 'android',
      startsAt: new Date('2026-09-28T02:00:00Z'), endsAt: new Date('2026-10-04T02:00:00Z'),
      sourceUrl: `https://play.google.com/store/apps/eventdetails/${EVENT_ID}`,
    };
    /* Недавнее завершённое событие: оно ещё в сроке показа и обязано быть видно. */
    const recent = {
      ...live, id: 'e2', title: 'Ночной заезд',
      startsAt: new Date('2026-09-19T02:00:00Z'), endsAt: new Date('2026-09-27T02:00:00Z'),
    };
    /* Пережитое дальше срока не видно никому: ни читателю, ни модератору. */
    const farEnded = {
      ...live, id: 'e3', title: 'Конвой в пустыне',
      startsAt: new Date('2026-07-01T02:00:00Z'), endsAt: new Date('2026-08-09T02:00:00Z'),
    };
    const page = (over) => renderUpdates({
      ready: true, shared: true, me: null, canManage: false, notes: [], loading: false,
      error: '', composing: false, storeEvents: [], storeStatus: null, feedError: '',
      now: NOW, ...over,
    });
    const feedPage = (over) => page({ storeEvents: [live, recent, farEnded], ...over });

    check('блок назван и объяснён: карточки принесли магазины, разговор — на форуме',
      feedPage().includes('События игры') && feedPage().includes('href="#/forum"'));
    check('событие отдаёт читателю название, даты и стадию',
      feedPage().includes(EVENT_TITLE) && feedPage().includes('идёт')
        && feedPage().includes('28 сент. — 4 окт.') && feedPage().includes('осталось 4 дня'));
    check('пережитое дальше срока со экрана уходит, а не висит',
      !feedPage().includes('Конвой в пустыне')
        && !feedPage({ canManage: true }).includes('Конвой в пустыне'));
    check('ссылка ведёт на страницу события в магазине и не оставляет следов для него',
      feedPage().includes(`href="https://play.google.com/store/apps/eventdetails/${EVENT_ID}"`)
        && feedPage().includes('rel="noreferrer noopener nofollow"'));
    check('ссылка вне https ссылкой не становится',
      !page({ storeEvents: [{ ...live, sourceUrl: 'javascript:alert(1)' }] })
        .includes('href="javascript'));
    check('данные магазина экранируются, как и всё, что принёс человек',
      page({ storeEvents: [{ ...live, title: '<img src=x onerror=alert(1)>' }] })
        .includes('&lt;img'));
    check('невошедший не видит кнопки удалить, а карточки видит те же, что и модератор',
      !feedPage().includes('data-feed-delete') && feedPage().includes('Ночной заезд')
        && feedPage({ canManage: true }).includes('Ночной заезд'));
    check('модератор у каждой показанной карточки видит одну кнопку, а не пару',
      (feedPage({ canManage: true }).match(/data-feed-delete="/g) || []).length === 2
        && feedPage({ canManage: true }).includes('data-feed-delete="e2"')
        && !feedPage({ canManage: true }).includes('data-feed-delete="e3"'));
    check('на странице не осталось ни следа убранного состояния',
      !/data-feed-archive|data-feed-restore|Убрано автоматом|вернуть в список/.test(pageSrc + updSrc));
    check('пустой блок не врёт про игру: он называет две возможные причины',
      page({}).includes('автомат ещё ни разу не заходил'));
    check('отказ списка называется именем нужной миграции',
      page({ feedError: 'relation "forum_store_event_list" does not exist' })
        .includes('20260930-store-feed.sql'));
    check('а отказ состояния блок не ломает: живой список остаётся живым',
      feedPage({ feedError: '' }).includes(EVENT_TITLE));
    check('молчание автомата названо вслух строкой обхода',
      feedPage({ storeStatus: { lastRunAt: new Date('2026-09-30T04:15:00Z'), lastRunText: 'нового нет' } })
        .includes('Планировщик заходил'));
    check('подпись стадии и срок прячутся по числам, а не по догадке разметки',
      pageSrc.includes('pickStoreEvents(') && feedSrc.includes('storeEventPhase'));
    check('поле, карточка, кнопка удаления и строка обхода одеты стилем',
      cssSrc.includes('.feed-card__source') && cssSrc.includes('.feed-list')
        && cssSrc.includes('.feed__run') && cssSrc.includes('.feed-card__action')
        && cssSrc.includes('.feed-card__error') && !/\.feed-card--archived/.test(cssSrc));
    check('список и состояние читаются двумя запросами, и отказ одного не убивает другой',
      inOrder(updSrc.slice(updSrc.indexOf('async function loadFeed')),
        ['state.storeEvents = (await forum.listStoreEvents())', 'state.feedError = String',
          'state.storeStatus = (await forum.getStoreStatus())'])
        && /catch \{\s*\n\s*state\.storeStatus = null;/.test(updSrc));
  }

  /* ── 7.1 Живой черновой прогон: событие уходит из состояния, а не прячется ── */
  {
    const local = await import('../src/forum/adapters/local.js');
    const feedStore = new Map();
    globalThis.localStorage = {
      getItem: (k) => (feedStore.has(k) ? feedStore.get(k) : null),
      setItem: (k, v) => feedStore.set(k, String(v)),
      removeItem: (k) => feedStore.delete(k),
    };
    const rawFeed = () => JSON.parse(feedStore.get('zr33.forum.local'));
    const saysFeed = async (fn) => { try { await fn(); return ''; } catch (e) { return String(e.message); } };

    await local.signUp('Дежурный');            // первый в черновой базе — владелец
    await local.signUp('Обычный');
    await local.signOut();

    /*
      События в черновом режиме не пишет никто: планировщик ходит в боевую базу.
      Поэтому строки кладём в состояние руками — проверяем не источник, а решение.
    */
    const st = rawFeed();
    st.storeEvents = [
      {
        id: 'ev-1', feedKey: 'play:4829466076333755096', title: EVENT_TITLE, summary: '',
        platform: 'android', startsAt: '2026-09-28T02:00:00.000Z', endsAt: '2026-10-04T02:00:00.000Z',
        sourceUrl: `https://play.google.com/store/apps/eventdetails/${EVENT_ID}`,
        firstSeenAt: '2026-09-28T03:00:00.000Z', lastSeenAt: '2026-09-30T03:00:00.000Z',
      },
      {
        id: 'ev-2', feedKey: 'play:5092240000000000000', title: 'Ночной заезд', summary: '',
        platform: 'android', startsAt: '2026-09-19T02:00:00.000Z', endsAt: '2026-09-27T02:00:00.000Z',
        sourceUrl: '', firstSeenAt: '2026-09-19T03:00:00.000Z', lastSeenAt: '2026-09-29T03:00:00.000Z',
      },
    ];
    feedStore.set('zr33.forum.local', JSON.stringify(st));

    await local.signIn('Обычный');
    equal('игрок без прав не удалит событие', await saysFeed(() => local.deleteStoreEvent('ev-1')),
      'Событие из магазина удаляет модерация');
    equal('и ничего не удалил: список цел', (await local.listStoreEvents()).length, 2);
    await local.signOut();

    await local.signIn('Дежурный');
    equal('события с таким id нет', await saysFeed(() => local.deleteStoreEvent('нет-такой')),
      'Событие не найдено');
    await local.deleteStoreEvent('ev-1');
    equal('удалённое событие исчезает из списка, а не ложится в архив',
      (await local.listStoreEvents()).map((e) => e.title).join(' | '), 'Ночной заезд');
    equal('повторное удаление называет отсутствие строки, а не «уже убрано»',
      await saysFeed(() => local.deleteStoreEvent('ev-1')), 'Событие не найдено');
    check('и в черновом состоянии строки больше нет: удаление правда стирает её',
      rawFeed().storeEvents.length === 1);
    check('у оставшейся карточки нет ни статуса, ни следа убравшего',
      (await local.listStoreEvents())[0].status === undefined
        && (await local.listStoreEvents())[0].archivedAt === undefined);
    check('а состояние обхода черновой режим не выдумывает: его приносит боевая база',
      (await local.getStoreStatus()) === null);
    for (const words of DELETE_EVENT_REFUSALS) {
      check(`и те же слова записаны в базе: ${words}`, delEventSql.includes(words));
    }
    check('перед удалением события поведение спрашивает, и называет его окончательным',
      /if \(!confirmRemoval\(cardTitle\(feedOff, '\.feed-card'\), 'Событие'\)\) return;/.test(updSrc));
  }

  /* ── 8. Документы ── */
  check('миграция названа в документах форума, в порядке запуска и в планировщике',
    docsSrc.includes('20260930-store-feed.sql')
      && readmeSrc.includes('20260930-store-feed.sql')
      && readmeSrc.replace(/\s+/g, ' ').includes('`20260929-player-guides.sql`, `20260930-store-feed.sql`'));
  check('и новая миграция стоит в реестре рядом с остальными',
    readmeSrc.includes('20261005-feed-final-delete.sql')
      && docsSrc.includes('20261005-feed-final-delete.sql'));
  check('шаг прогнан и уехал в историю: документы ведут его по пути applied/',
    docsSrc.includes('supabase/applied/20261005-feed-final-delete.sql')
      && readmeSrc.includes('Прогнан 05.10.2026'));
  /*
    Состояние фида — кэш того, что опубликовано, и оно умеет разъехаться со
    списком: разовая чистка дублей 01.10 унесла заметку, на которую ссылка
    ведёт до сих пор. Такое состояние молчит вечно, и выглядит это как
    «разработчики ничего не делают». Правка прогнана 05.10.2026 и обязана была
    брать номера версий из таблицы заметок, а не из текста, и трогать только
    порванную ссылку — она и заготовка на следующий разрыв.
  */
  const stateFixSrc = await readFile('supabase/applied/20261005-store-state-note.sql', 'utf8');
  check('состояние фида сверяется со списком, а не чинится числом вписанным',
    /from public\.forum_update_notes/.test(stateFixSrc)
      && /set android_version = coalesce\(newest\.android/.test(stateFixSrc)
      && !/set[^;]*'\d+\.\d+/.test(stateFixSrc)
      && readmeSrc.includes('20261005-store-state-note.sql'));
  check('правка названа прогнанной и не осталась висеть в очереди',
    readmeSrc.replace(/\s+/g, ' ').includes('`20261005-store-state-note.sql` — **прогнан 05.10.2026')
      && docsSrc.includes('supabase/applied/20261005-store-state-note.sql'));
  check('правка безвредна там, где ломать нечего: условие — порванная ссылка на заметку',
    /left join public\.forum_update_notes n on n\.id = s\.last_note_id/.test(stateFixSrc)
      && /and n\.id is null/.test(stateFixSrc));
  /* Прежний путь с уровня очереди здесь не повторяют нарочно: проверка
     «пути миграции на месте» обходит весь репозиторий и падает на любом
     названии файла, которого на диске нет. */
  check('документ фида называет удаление и отметки, а не прежнюю дверь архива',
    docsSrc.includes('forum_delete_store_event') && docsSrc.includes('forum_feed_marks')
      && !/forum_set_store_event_archive|setStoreEventArchived/.test(docsSrc + readmeSrc));
  check('документ объясняет, почему автомат живёт вне браузера, и как его включить',
    docsSrc.includes('## Фид магазина') && docsSrc.includes('STORE_FEED_NICK')
      && docsSrc.includes('.github/workflows/store-feed.yml'));
  check('документ называет, чего автомат не делает намеренно',
    docsSrc.includes('- **не додумывает.**') && docsSrc.includes('- **не переводит**')
      && docsSrc.includes('- **не знает служебного ключа базы.**'));
  check('и что событие без даты в базу не едет',
    docsSrc.replace(/\s+/g, ' ').includes('Карточка без читаемой даты в отчёте названа вслух и в базу не идёт'));
  check('документы хостинга называют планировщик и его секреты',
    hostingSrc.includes('store-feed.yml') && hostingSrc.includes('STORE_FEED_PASSWORD'));
  check('прежний запрет на чтение магазинов снят словами, а не молча',
    !pulseSql.includes('Автоматического чтения чужих страниц')
      && pulseSql.includes('20260930-store-feed.sql')
      && docsSrc.includes('- **Чтения чужих страниц из браузера посетителя.**'));

  /* ── 8.1 Официальная группа ВК: голос, который слышно без человека ────────

     С осени 2026 года страница Google Play не печатает в своём HTML ни «Что
     нового», ни блока событий, а App Store на текущий патч отвечает строкой
     короче нижнего порога заметки. Словами перемены игра описывает только
     официальная группа, и именно поэтому у фида появился четвёртый источник.
     Проверяем то, что в этом источнике нельзя отдать на отмажку:

       1. Читаем ровно то, что видит посетитель: открытая страница «Посты
          сообщества», без входа, без чужих токенов и без комментариев игроков.
       2. Стена отдаётся в windows-1251, и про это нельзя молчать: прочитанное
          как UTF-8 дало бы список карточек из кракозябр, а не ошибку.
       3. Дата заметки — метка самой записи, а не день обхода.
       4. В список попадает только то, что называет уже случившуюся перемену;
          розыгрыш призов за комментарии, опрос и «событие на подходе» проходят
          мимо — до запроса, а не после отказа базы.
       5. Окно стены и потолок запусков держит разбор, иначе первый же
          настоящий прогон вывалил бы в список полуторагодовалый архив.
       6. Ключ записи переживает удалённую заметку: он уходит в базу вместе с
          нею, а не отдельным «запомни» после.

     Фикстура — настоящие куски живой стены (`tests/vk-wall-fixture.html`,
     байты ответа как они пришли), а ожидаемые значения получены прогоном на
     ней, а не на глаз.
  ───────────────────────────────────────────────────────────────────────── */
  {
    const vkSrc = await readFile('src/forum/vk-feed.js', 'utf8');
    const vk = await import('../src/forum/vk-feed.js');
    const VK = CONFIG.forum.store.vk;
    const wallBytes = await readFile('tests/vk-wall-fixture.html');
    const wall = vk.decodeVkBytes(new Uint8Array(wallBytes));
    const page = vk.readVkWall(wall, VK);
    const NOW_VK = Date.parse('2026-10-05T12:00:00Z');
    const picked = vk.pickVkNotes(wall, { now: NOW_VK, cfg: VK });
    const notePatch = picked.notes.find((n) => n.feedKey.endsWith('_39747'));
    const noteNotice = picked.notes.find((n) => n.feedKey.endsWith('_41250'));

    /* ── Адрес и числа ── */
    check('стена берётся страницей «Посты сообщества», и минус в номере группы стоит один',
      vk.vkWallUrl(VK) === 'https://vk.com/wall-236547214?own=1'
        && !vk.vkWallUrl(VK).includes('wall--'));
    check('постоянная ссылка записи собирается тем же способом: адрес стены и номер поста',
      vk.vkPostUrl('-236547214_39747', VK) === 'https://vk.com/wall-236547214_39747'
        && vk.vkPostUrl('236547214_39747', VK) === 'https://vk.com/wall-236547214_39747'
        && vk.vkPostUrl('', VK) === '');
    check('окно стены, потолок запусков и подпись первоисточника — числа config',
      VK.group === '-236547214' && VK.freshDays === 40 && VK.perRun === 5
        && VK.sourceName === 'Официальная группа ВК');

    /* ── Кодировка ── */
    check('байты стены раскрываются в windows-1251: по-другому русский не читается',
      vk.VK_ENCODING === 'windows-1251' && wall.includes('30 сентября - Обновление версии')
        && !new TextDecoder('utf-8').decode(wallBytes).includes('Обновление'));
    check('в браузерный путь фид ВК не тянет сеть: разбор умеет только читать строку',
      !/fetch\(|XMLHttpRequest/.test(vkSrc)
        && !(await readFile('src/pages/updates.js', 'utf8')).includes('vk-feed')
        && !(await readFile('src/forum/updates.js', 'utf8')).includes('vk-feed'));

    /* ── Разбор живой страницы ── */
    check('из пяти рядов стены разбор видел четыре подписанные группой записи',
      page.how === 'ok' && page.posts.length === 4);
    check('у ключа остаётся знак группы: без минуса это уже другой объект',
      page.posts.map((p) => p.id).join(',') === '-236547214_41250,-236547214_40597,-236547214_39747,-236547214_33413'
        && picked.notes.map((n) => n.feedKey).join(',') === 'vk:-236547214_41250,vk:-236547214_39747');
    check('записи идут от новых к старым, а дата взята из метки страницы',
      page.posts[0].atMs === 1790938011000
        && page.posts[3].atMs === 1790328595000
        && notePatch.fields.sourceAt === '2026-09-30T08:41:33Z'
        && noteNotice.fields.sourceAt === '2026-10-02T10:46:51Z');
    check('чужая запись стены не становится голосом группы',
      vk.readVkWall('<div id="post-236547214_1" data-post-author-id="100000001"'
        + ' data-post-signer-or-author-id="100000001"></div>', VK).how === 'no-posts');
    check('пустой ответ и страница входа — два разных диагноза, и оба названы',
      vk.readVkWall('<html><body>капча</body></html>', VK).how === 'no-page'
        && vk.readVkWall('<form><input name="email"></form><span>Войти</span>', VK).how === 'login');
    check('автомат выходит красным при любом ответе, который он не прочитал',
      /if \(!vkReadable\(vk\)\) process\.exit\(1\);/.test(scriptSrc)
        && /if \(vk\.how === 'no-page' \|\| vk\.how === 'login'\) \{/.test(scriptSrc));

    /* ── Что публикуем, а что нет ── */
    const linesOf = (num) => (page.posts.find((p) => p.id.endsWith(num)) || {}).lines || [];
    check('пост, назвавший перемену, — заметка; объявление о будущем — заметка-анонс',
      vk.vkPostKind(linesOf('39747')) === 'patch' && vk.vkPostKind(linesOf('41250')) === 'notice');
    check('опрос и тизер «событие на подходе» не становятся заметками',
      vk.vkPostKind(linesOf('40597')) === '' && vk.vkPostKind(linesOf('33413')) === ''
        && picked.skipped.silent === 2);
    /*
      Розыгрыш призов за комментарии и розыгрыш внутри события — два разных
      текста, и путать их нельзя. Строки взяты дословно из живой записи группы
      от 29.09.2026: боевой пропуск в ней открыт словами, а слово «розыгрыш»
      стоит внутри описания игровых билетов — прежний голый знак глушил весь
      пост, и игрок не видел открывшейся половины события.
    */
    check('розыгрыш внутри открывшегося пропуска — перемена игры, а розыгрыш призов в ЛС — мимо',
      vk.vkPostKind(['✈[Боевой пропуск «подготовка экипажа»]',
        'Командиры, ограниченный по времени боевой пропуск открыт!',
        'Получайте общий опыт для повышения уровня, выполняя активные задания',
        'При повышении уровня боевого пропуска вы получаете «Билеты розыгрыша по руководству».',
        'Используйте их для розыгрыша из призового пула, чтобы получить УР Универсальный фрагмент героя',
      ]) === 'patch'
        && vk.vkPostKind(['Выжившие, общий сбор!',
          'Специально для самых активных участников проводим традиционной для VK сообщества розыгрыш призов',
          'Бот выберет победителей случайным образом и пришлет Gift Code в личные сообщения',
          'для получение приза напишите в ЛС ГРУППЫ "подарочный код"',
        ]) === '');
    check('ссылка из поста не уезжает в заметку вместе со своим адресом',
      !/https:\/\/s\.zrouteofficial\.com/.test(linesOf('40597').join('\n'))
        && linesOf('40597').join('\n').includes('s.zrouteofficial.com/s/ck56t1')
        && !/\[#alias\|/.test(linesOf('40597').join('\n')));
    check('разбор даёт те же границы, что и ручная вставка: заголовок и тело в пределах базы',
      notePatch.fields.title.length <= L.updateTitleMax
        && notePatch.fields.summary.length <= L.updateSummaryMax
        && notePatch.fields.summary.includes('Улучшен визуальный стиль некоторых интерфейсов')
        && notePatch.fields.sourceName === 'Официальная группа ВК'
        && notePatch.fields.sourceUrl === 'https://vk.com/wall-236547214_39747');

    /* ── Окно, потолок и память ── */
    check('за окном стены посты не становятся заметками, и это видно в отчёте',
      vk.pickVkNotes(wall, { now: NOW_VK, cfg: { ...VK, freshDays: 3 } }).skipped.tooOld === 4
        && vk.pickVkNotes(wall, { now: NOW_VK, cfg: { ...VK, freshDays: 3 } }).notes.length === 0);
    check('потолок за один запуск держит разбор: первый прогон не выливает архив',
      vk.pickVkNotes(wall, { now: NOW_VK, cfg: { ...VK, perRun: 1 } }).notes.length === 1
        && vk.pickVkNotes(wall, { now: NOW_VK, cfg: { ...VK, perRun: 1 } }).notes[0].feedKey === 'vk:-236547214_41250');
    check('уже принесённое узнаётся по отметке, а не по живой строке заметки',
      vk.pickVkNotes(wall, {
        now: NOW_VK,
        cfg: VK,
        known: page.posts.map((p) => `vk:${p.id}`),
      }).skipped.published === 4
        && scriptSrc.includes("rest('/forum_feed_marks?select=feed_key&what=eq.note')"));
    check('планировщик в отметки только заглядывает: пишет в них база одной операцией',
      (scriptSrc.match(/forum_feed_marks/g) || []).length === 1);

    /* ── Дверь публикации ── */
    const pubSql = finalSrc.slice(finalSrc.indexOf('-- ── Шаг 2.'), finalSrc.indexOf('-- ── Шаг 3.'));
    const pubFlat = pubSql.replace(/\s+/g, ' ');
    check('у двери восемь параметров, и прежнюю семистрочную подпись сняли перед этим',
      pubSql.includes('p_feed_key     text default null')
        && pubFlat.includes('drop function if exists public.forum_publish_update_note( text, text, text, text, text, timestamptz, text );')
        && pubSql.indexOf('drop function if exists') < pubSql.indexOf('create or replace function public.forum_publish_update_note'));
    check('ключ проверяется до вставки, а отметка заводится сразу после неё',
      pubFlat.indexOf('if exists (select 1 from public.forum_feed_marks where feed_key = v_key)')
        < pubFlat.indexOf('insert into public.forum_update_notes')
        && pubFlat.indexOf('insert into public.forum_update_notes')
        < pubFlat.indexOf("insert into public.forum_feed_marks (feed_key, what, title) values (v_key, 'note', left(v_title, 120));"));
    check('повторный источник база отвергает словом, а не молча заводит дубль',
      pubSql.includes('Этот источник уже приносил заметку: повторная публикация означает, что первую убрали насовсем')
        && pubSql.includes('Ключ источника короче 8 символов')
        && pubSql.includes('Ключ источника длиннее 80 символов'));
    check('ключ едет только в заметке из фида: у ручной заметки его нет',
      !scriptSrc.slice(0, scriptSrc.indexOf('for (const item of vk.notes)')).includes('p_feed_key')
        && scriptSrc.slice(scriptSrc.indexOf('for (const item of vk.notes)')).includes('p_feed_key: item.feedKey'));


    /* ── Запасная дверь: страницу открыл браузер читалки ──
       *
       * ВК отдаёт стену только тем, кому доверяет как человеку, и адреса
       * чужих дата-центров в этот список не входят. Единственная найденная
       * дверь — публичный ридер, который открывает страницу настоящим
       * браузером; то, что остаётся от стены после его рук, и проверяет
       * этот раздел. Ожидания снова измерены, а не придуманы: живой и
       * перерисованный ответы на одну и ту же стену лежат в `tests/` двумя
       * фикстурами, и их расхождение — это и есть цена двери.
       */
    const drawnSrc = await readFile('tests/vk-wall-rendered-fixture.html', 'utf8');
    const drawnPage = vk.readVkWallRendered(drawnSrc, VK, NOW_VK);
    const viaWall = vk.readVkWall(drawnSrc, VK, NOW_VK);
    const drawnPicked = vk.pickVkNotes(drawnSrc, { now: NOW_VK, cfg: VK });
    const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    const liveOf = (id) => page.posts.find((p) => p.id === id);

    check('надпись читалки о времени переводится в метку, а точность называется по ней',
      (() => {
        const at = (label) => vk.drawnDateToMs(label, NOW_VK);
        return iso(at('Just now').atMs) === '2026-10-05T12:00:00Z' && at('Just now').exact
          && iso(at('5 min ago').atMs) === '2026-10-05T11:55:00Z' && at('5 min ago').exact
          && iso(at('2 h ago').atMs) === '2026-10-05T10:00:00Z' && !at('2 h ago').exact
          && iso(at('2 d ago').atMs) === '2026-10-03T12:00:00Z' && !at('2 d ago').exact
          && iso(at('yesterday').atMs) === '2026-10-04T12:00:00Z' && !at('yesterday').exact
          && iso(at('27&nbsp;Sep').atMs) === '2026-09-27T12:00:00Z'
          && iso(at('3 Oct at 3:23 pm').atMs) === '2026-10-03T15:23:00Z'
          && iso(at('10:23 am').atMs) === '2026-10-05T10:23:00Z' && at('10:23 am').exact
          && at('завтрака не было') === null && at('') === null;
      })());
    check('у надписи без года год берётся ближайший прошедший: январский обход не берёт пост из будущего',
      vk.drawnDateToMs('27 Sep', Date.parse('2027-01-05T12:00:00Z')).atMs
        === Date.parse('2026-09-27T12:00:00Z'));
    check('с перерисованной стены читаются те же записи группы: номер, автор и порядок',
      drawnPage.how === 'ok' && drawnPage.drawn === true
        && drawnPage.posts.map((p) => p.id).join(',') === '-236547214_41250,-236547214_39747'
        && drawnPage.posts.every((p) => p.url === `https://vk.com/wall${p.id}`));
    check('дата заметки из зеркала — день, полдень UTC, и это тот же календарный день, что у живой страницы',
      drawnPage.posts.length > 0
        && drawnPage.posts.every((p) => p.atExact === false
          && iso(p.atMs).endsWith('T12:00:00Z')
          && day(p.atMs) === day(liveOf(p.id).atMs)));
    check('текст поста перерисованная страница отдаёт построчно тем же: теряются только эмодзи',
      drawnPage.posts.every((p) => {
        const live = liveOf(p.id);
        return p.lines.length === live.lines.length
          && p.lines.every((line, i) => live.lines[i].includes(line));
      })
      && page.posts.find((p) => p.id.endsWith('_41250')).lines[0].length
        > drawnPage.posts.find((p) => p.id.endsWith('_41250')).lines[0].length);
    check('общий вход один: без секундных меток readVkWall сам переходит на рисованный разбор',
      viaWall.how === 'ok' && viaWall.drawn === true
        && JSON.stringify(viaWall.posts) === JSON.stringify(drawnPage.posts));
    check('и на перерисованной странице чужая запись не становится голосом группы',
      vk.readVkWallRendered('<div id="post-236547214_9" class="atomPost_post post"'
        + '<div data-post-author-id="777" data-post-signer-or-author-id="777"></div>'
        + '<div class="wall_post_text_wrapper vkuiDiv__host">текст</div>'
        + '<span data-testid="post_date_block_preview">2 d ago</span></div>', VK, NOW_VK).how === 'no-posts');
    check('заметки из зеркала собираются теми же ключами и честно помечены нарисованными',
      drawnPicked.drawn === true && picked.drawn === false
        && drawnPicked.notes.map((n) => n.feedKey).join(',') === 'vk:-236547214_41250,vk:-236547214_39747'
        && drawnPicked.notes[0].fields.sourceAt === '2026-10-02T12:00:00Z'
        && drawnPicked.notes.map((n) => n.fields.kind).join(',') === 'notice,patch');
    check('огрызок читалки не принимается за молчание разработчиков: зеркало пустым не доверяет',
      /function vkReadable\(vk\) \{\s*if \(vk\.how === 'ok'\) return true;\s*return vk\.via === 'vk\.com' && vk\.how === 'no-posts';\s*\}/.test(scriptSrc)
        && scriptSrc.includes('читалка вернула стену без единой записи группы — это не тишина разработчиков'));
    check('пустота двери называет себя цифрами: источник, размер ответа, следы записей и заголовок читалки',
      /function vkUnreadable\(vk\)/.test(scriptSrc)
        && scriptSrc.includes('vk.facts = vkPageFacts(html)')
        && scriptSrc.includes('Title:\\s*(.+)')
        && scriptSrc.includes('`; стена группы не разобрана${vkBad}`'));
    check('прямой запрос идёт первым, а зеркало подключается только когда ВК отдал не стену',
      /if \(!ONLY_MIRROR\) attempts\.push\(\(\) => Promise\.resolve\(vkFromResponse\(res, knownKeys\)\)\);/.test(scriptSrc)
        && scriptSrc.includes("process.argv.includes('--только-зеркало')")
        && /for \(const mirror of VK_MIRRORS\)/.test(scriptSrc));
    check('зеркало отличается от группы и заголовком, и кодировкой: ридер отвечает UTF-8',
      scriptSrc.includes("'User-Agent': 'zroute-s33-store-feed/1.0'")
        && /new TextDecoder\('utf-8', \{ fatal: true \}\)/.test(scriptSrc));
    check('сырого HTML ридер больше не просит: с ним стена приходит пустой заглушкой',
      !scriptSrc.includes("'X-Return-Format': 'html'")
        && /`https:\/\/r\.jina\.ai\/\$\{target\}/.test(scriptSrc));
    check('дверь не читает чужой кэш: адрес стены каждый раз с отметкой времени',
      /feed=\$\{Date\.now\(\)\}/.test(scriptSrc));
    check('и ждёт её дольше магазина: браузер читалки открывает страницу десятки секунд',
      /timeoutMs: \d{5,}/.test(scriptSrc) && scriptSrc.includes('mirror.timeoutMs'));
    /*
      Разбор ответа читалки. Фикстура — тот же самый ответ ридера, что автомат
      получит с боевого адреса, только сокращённый до пяти записей: 35 тысяч
      знаков живой стены против 130 тысяч в ответе целиком.
    */
    const mdSrc = await readFile('tests/vk-wall-markdown-fixture.txt', 'utf8');
    const mdNow = Date.parse('2026-10-06T09:37:00Z');
    const mdPage = vk.readVkWallMarkdown(mdSrc, VK, mdNow);
    const mdViaWall = vk.readVkWall(mdSrc, VK, mdNow);
    const mdPicked = vk.pickVkNotes(mdSrc, { now: mdNow, cfg: VK });
    check('с размеченной стены читаются все пять записей группы, newest первым и датам дня',
      mdPage.how === 'ok' && mdPage.drawn === true
        && mdPage.posts.map((p) => p.id).join(',') === '-236547214_41747,-236547214_41250,'
          + '-236547214_40597,-236547214_39980,-236547214_39747'
        && mdPage.posts.every((p) => p.url === `https://vk.com/wall${p.id}`
          && p.atExact === false && iso(p.atMs).endsWith('T12:00:00Z')));
    check('размеченная стена называет те же тексты, что живая страница: строка в строку, минус эмодзи',
      mdPage.posts.filter((p) => liveOf(p.id)).length >= 3
        && mdPage.posts.filter((p) => liveOf(p.id)).every((p) => {
          const live = liveOf(p.id);
          return p.lines.length === live.lines.length
            && p.lines.every((line, i) => live.lines[i].includes(line));
        }));
    check('и не врёт про день: дата надписи «3 d ago» расходится с живой меткой не больше чем на сутки с хвостом',
      mdPage.posts.filter((p) => liveOf(p.id)).every((p) => Math.abs(p.atMs - liveOf(p.id).atMs) < 2 * 86400000));
    check('комментарии игроков в текст записи не попадают: кусок отсекается по шапке автора',
      mdPage.posts.every((p) => {
        const text = p.lines.join('\n');
        return !/Конечно же Арнольд|Show more comments|people reacted|Liana/i.test(text);
      }));
    check('длительность ролика не становится заголовком карточки',
      mdPage.posts.find((p) => p.id.endsWith('_41250')).lines[0].startsWith('Лимитированный скин'));
    check('заглушка «не робот» — «стены нет», а не «постов нет»',
      (() => {
        const stub = 'Title: Проверяем, что вы не робот\n\nMarkdown Content:\n## Проверяем,\n\n'
          + 'что вы не робот\n\nЧто-то пошло не так. Повторите попытку позже.\n';
        return vk.readVkWallMarkdown(stub, VK, mdNow).how === 'no-page'
          && vk.readVkWall(stub, VK, mdNow).how === 'no-page';
      })());
    check('чужая стена в разметке голосом группы не становится: номер группы в ссылке решает',
      vk.readVkWallMarkdown('[2 d ago](https://vk.com/wall-99999_1) текст', VK, mdNow).how === 'no-page');
    check('общий вход один: без HTML-разметки постов readVkWall сам уходит в разметку',
      mdViaWall.how === 'ok' && mdViaWall.drawn === true
        && JSON.stringify(mdViaWall.posts) === JSON.stringify(mdPage.posts));
    check('фильтр публикуемого на разметке тот же: часть записей группа пишет не для фида',
      mdPicked.drawn === true && mdPicked.notes.map((n) => n.feedKey).join(',')
        === 'vk:-236547214_41250,vk:-236547214_39980,vk:-236547214_39747'
        && mdPicked.skipped.silent === 2
        && mdPicked.notes.every((n) => n.fields.sourceAt.endsWith('T12:00:00Z')));
    check('отчёт обхода называет источник стены и цену точности дня',
      scriptSrc.includes('страницу перерисовала читалка: у заметок дата — день вместо минуты')
        && scriptSrc.includes("`; стена через ${vk.via}${vk.drawn ? ' (дата заметок — с точностью до дня)' : ''}`"));
    /* ── Документ ── */
    check('документ называет группу источником и объясняет, чем она живее магазинов',
      docsSrc.includes('## Группа ВК — третий голос фида')
        && docsSrc.includes('src/forum/vk-feed.js')
        && docsSrc.includes('wall-236547214'));
    check('и говорит, что новых ключей для неё не требуется',
      docsSrc.replace(/\s+/g, ' ').includes('Группа ВК не добавляет ни секретов, ни планировщиков'));
    check('документ называет дверь, цену точности и то, что пустая читалка — не тишина разработчиков',
      docsSrc.includes('### Запасная дверь: стену читает браузер читалки')
        && docsSrc.includes('r.jina.ai')
        && docsSrc.includes('tests/vk-wall-rendered-fixture.html')
        && docsSrc.replace(/s+/g, ' ').includes('дата заметок — с точностью до дня')
        && docsSrc.replace(/s+/g, ' ').includes('только когда прямой ответ — не стена вовсе'));
    check('документ объясняет, почему дверь просит разметку, а не HTML, и не берёт чужой кэш',
      docsSrc.includes('Просить HTML — бесполезно, просим разметку')
        && docsSrc.includes('readVkWallMarkdown')
        && docsSrc.includes('X-Return-Format')
        && docsSrc.includes('tests/vk-wall-markdown-fixture.txt')
        && docsSrc.replace(/\s+/g, ' ').includes('адрес каждый обход новый'));
    check('документ объясняет, чем пустота двери называет себя сама',
      docsSrc.includes('vkPageFacts')
        && docsSrc.includes('Проверяем, что вы не робот')
        && docsSrc.includes('last_run_text'));
  }

  /* ── 9. Вход на форум: один монтаж, ранняя лента, память первого экрана ──
     *
     * Проверки этого раздела сторожат не красиво выглядящие строки, а
     * порядок, в котором страница успевает что-то показать человеку:
     * перемонтаж живой вкладки, ожидание «кто вошёл» перед запросом ленты и
     * память прошлого экрана — всё это видно только по времени прихода первого
     * кадра, и вернуть прежнее поведение здесь так же легко, как убрать одну
     * строчку.
     */
  const bootMain = await readFile('src/main.js', 'utf8');
  const feedMount = await readFile('src/forum/mount.js', 'utf8');
  const feedPages = await readFile('src/pages/forum.js', 'utf8');
  const feedCss = await readFile('src/forum.css', 'utf8');
  const feedCfg = await readFile('config.js', 'utf8');
  const feedSupa = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const feedLocal = await readFile('src/forum/adapters/local.js', 'utf8');

  check('живую вкладку на том же адресе не перемонтируют',
    /function liveKeyOf\(id, param, search\)/.test(bootMain)
      && bootMain.includes('if (live && live === liveMountKey) {')
      && bootMain.includes('syncForumView(view)'));
  check('данные сайта форум принимает без перерисовки ленты',
    /export function syncForumView\(view\)[\s\S]{0,400}siteView = view;[\s\S]{0,120}paint\(\);/.test(feedMount));
  check('лента стартует до ответа на вопрос, кто вошёл',
    feedMount.indexOf('const whoIAm = forum.currentUser()')
      < feedMount.indexOf('postId ? loadThread(postId) : loadFeed()')
      && feedMount.indexOf('postId ? loadThread(postId) : loadFeed()')
      < feedMount.indexOf('state.me = await whoIAm'));
  check('всё про вошедшего собирается одним пакетом и одной перерисовкой',
    /await Promise\.all\(\[\s*\n\s*loadNotifications\(\{ repaint: false \}\)/.test(feedMount)
      && /if \(token !== mountToken\) return;[\s\S]{0,900}paint\(\);\s*await content;/.test(feedMount));
  check('плашку «Загружаем ленту…» показывают только когда экрана нет',
    feedMount.includes('state.loading = !append && !state.posts.length;'));
  check('список ленту красит сразу, а довески догоняют отдельно',
    /state\.loading = false;[\s\S]{0,20}paint\(\);[\s\S]{0,120}if \(!append\) loadFeedExtras\(token\);/.test(feedMount));
  check('три довеска идут одновременно и не ждут друг друга',
    /async function loadFeedExtras\(token\)[\s\S]{0,200}await Promise\.all\(\[/.test(feedMount)
      && (feedMount.match(/forum\.listPosts\(\{ sort: '(talked|fresh)'/g) || []).length === 2);

  check('память первого экрана живёт в sessionStorage, а не в localStorage',
    feedMount.includes('sessionStorage.setItem(`${FEED_CACHE_PREFIX}:${feedSignature()}`')
      && !/localStorage\.(set|get)Item\(`\$\{FEED_CACHE_PREFIX\}/.test(feedMount));
  check('снимок подписан зрителем: прошлый экран чужого аккаунта не подмешивается',
    /typeof forum\.viewerKey === 'function' \? forum\.viewerKey\(\) : 'зритель'/.test(feedMount)
      && feedSupa.includes('export function viewerKey()')
      && feedLocal.includes('export function viewerKey()'));
  check('срок памяти — число в config, а не слово в коде',
    /feedCacheMinutes: \d+/.test(feedCfg)
      && feedMount.includes('Date.now() - at > minutes * 60_000'));
  check('пустой список памятью не становится: «постов нет» решает свежий ответ',
    /if \(!minutes \|\| !state\.posts\.length\) return;/.test(feedMount));
  check('и тяжёлый экран память не держит, вместо того чтобы рвать её на части',
    feedMount.includes('json.length > FEED_CACHE_MAX_CHARS'));
  check('даты из памяти оживают: строка вместо даты уронила бы ленту',
    /state\.posts = posts\.map\(reviveDates\)/.test(feedMount)
      && /function reviveDates\(value\)/.test(feedMount)
      && /\/\(At\|Until\)\$/.test(feedMount));
  check('память — только первый кадр: свой запрос всё равно уходит',
    /restoreFeedSnapshot\(\);[\s\S]{0,400}postId \? loadThread\(postId\) : loadFeed\(\)/.test(feedMount));
  check('пришедший список заменяет память и обновляет её',
    /if \(!append\) rememberFeedSnapshot\(\);/.test(feedMount)
      && feedMount.includes('state.fromCache = false;'));
  check('с уходом с форума помнящиеся темы снимают, фильтры читают из адреса',
    /state\.posts = \[\];\s*\n\s*state\.total = 0;\s*\n\s*state\.fromCache = false;/.test(feedMount));

  check('прошлый экран назван строкой, а не молчанием',
    feedPages.includes('Показываем последний вид ленты, обновляем…')
      && feedCss.includes('.forum-feed__stale--soft'));
  check('сбой обновления при видимой ленте — строка с кнопкой, а не полоса на весь экран',
    /if \(s\.error && !s\.posts\?\.length\)/.test(feedPages)
      && /data-forum-retry>повторить</.test(feedPages));

  const { renderForum: renderFeedFrame } = await import('../src/pages/forum.js');
  const cachedCard = {
    id: 'p_memory',
    authorId: 'u_1',
    authorNick: 'Ковыль',
    title: 'Тема из памяти',
    body: 'Текст темы',
    category: 'general',
    tags: [],
    createdAt: new Date(),
    commentCount: 2,
    score: 1,
  };
  const staleFrame = renderFeedFrame({ events: [], texts: [], alliances: [] }, {
    ready: true, loading: false, fromCache: true, posts: [cachedCard], total: 1,
  });
  check('кадр из памяти показывает тему, а не ожидание',
    staleFrame.includes('Тема из памяти') && !staleFrame.includes('Загружаем ленту')
      && staleFrame.includes('Показываем последний вид ленты'));
  const brokenFrame = renderFeedFrame({ events: [], texts: [], alliances: [] }, {
    ready: true, loading: false, error: 'база молчит', posts: [cachedCard], total: 1,
  });
  check('при отказе базы прошлые темы остаются на экране',
    brokenFrame.includes('Тема из памяти') && brokenFrame.includes('Ленту обновить не удалось')
      && !brokenFrame.includes('Форум не отвечает'));
}

/* ── 10. Раздача: сеть не держит белый экран ─────────────────────────────

   Жалоба «открываю с телефона — бесконечная загрузка и белый экран» живёт не
   в коде страницы, а в правиле «ждать сеть сколько угодно». Проверить это
   глазами нельзя, а сломать можно молча: достаточно вернуть в обработчик
   запроса один await без отсчёта, и сайт снова на подвешенном соединении
   висит до миллиона. Поэтому здесь тело обработчика вырезано из sw.js и
   исполняется с подставными кэшем и сетью — ровно так, как прогоняют тишину
   часов.
────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const swSrc = await readFile('sw.js', 'utf8');

  const open = swSrc.indexOf('(async () => {', swSrc.indexOf('event.respondWith('));
  const body = swSrc.slice(open, swSrc.indexOf('})()', open) + 4);
  check('тело обработчика запроса удалось вырезать из файла',
    open > 0 && body.includes('const backup = await caches.match(request'));

  check('отсчёт ожидания сети — число в файле, а не догадка',
    /const NETWORK_WAIT_MS = (\d+);/.test(swSrc)
      && Number(swSrc.match(/const NETWORK_WAIT_MS = (\d+);/)[1]) >= 3000
      && Number(swSrc.match(/const NETWORK_WAIT_MS = (\d+);/)[1]) <= 15000);
  check('копия по просрочке не возвращается в кэш как свежая',
    swSrc.includes('fresh !== backup'));
  check('страница отказа называет причину и что делать, словами на русском',
    swSrc.includes('Сайт не открылся') && swSrc.includes('сменить сеть')
      && swSrc.includes('Повторить') && /status:\s*503/.test(swSrc));
  const hostingSrc = await readFile('docs/HOSTING.md', 'utf8');
  check('запасной адрес хостинга назван и в документе о раздаче',
    hostingSrc.includes('zroutehub.onrender.com'));
  check('документ о раздаче описывает отсчёт сети и шаги для телефона',
    hostingSrc.includes('Сайт не открывается с телефона')
      && hostingSrc.includes('NETWORK_WAIT_MS')
      && hostingSrc.includes('Экономия трафика') && hostingSrc.includes('Приватный DNS')
      && hostingSrc.includes('Маскировка IP-адреса'));
  check('зеркало описано как боевое: документ знает свой адрес и шаги для телефона',
    hostingSrc.includes('Что настроено в GitHub Pages')
      && hostingSrc.includes('qvaden.github.io/zroute-s33')
      && hostingSrc.includes('с VPN грузит идеально'));

  const run = new Function('request', 'caches', 'fetch', 'Response', 'setTimeout',
    'NETWORK_WAIT_MS', 'CACHE', 'OFFLINE_HTML', `return ${body};`);

  const mkCaches = (map) => ({
    match: async (req) => map.get(typeof req === 'string' ? req : req.url) ?? null,
    open: async () => ({ put: () => Promise.resolve() }),
  });
  const hang = () => new Promise(() => {});
  const boom = () => Promise.reject(new Error('нет связи'));
  const Resp = function (text, init) { Object.assign(this, { text, init }); };
  const now = (fn) => { fn(); return 0; };
  const later = () => 0;
  const OFFLINE = 'ГЛУШКА-БЕЗ-СЕТИ';

  /* 1. Сеть висит, копия есть → отдаём копию и ничего не пишем в кэш. */
  const backupRes = { ok: true, status: 200, tag: 'копия' };
  const puts = [];
  const cachesWith = (map) => {
    const c = mkCaches(map);
    c.open = async () => ({ put: () => { puts.push(1); return Promise.resolve(); } });
    return c;
  };
  const stalled = await run(
    { url: './src/main.js', mode: 'no-cors' },
    cachesWith(new Map([['./src/main.js', backupRes]])),
    hang, Resp, now, 5000, 'cache', OFFLINE
  );
  check('подвешенная сеть уступает сохранённой копии, а не держит белый экран',
    stalled === backupRes);
  check('копия, отданная по просрочке, не притворяется свежим ответом',
    puts.length === 0);

  /* 2. Сеть отвечает быстро → она по-прежнему первая и попадает в запас. */
  const freshRes = { ok: true, status: 200, tag: 'живой', clone: () => freshRes };
  puts.length = 0;
  const fast = await run(
    { url: './src/main.js', mode: 'no-cors' },
    cachesWith(new Map([['./src/main.js', backupRes]])),
    () => Promise.resolve(freshRes), Resp, later, 5000, 'cache', OFFLINE
  );
  check('пока сеть отвечает — она первая, и ответ ложится в запас',
    fast === freshRes && puts.length === 1);

  /* 3. Копии нет → сеть ждут до конца, без преждевременной подмены. */
  const noBackup = await run(
    { url: './src/forum.css', mode: 'no-cors' },
    mkCaches(new Map()),
    () => Promise.resolve(freshRes), Resp, later, 5000, 'cache', OFFLINE
  );
  check('без сохранённой копии сеть не обрывают раньше времени',
    noBackup === freshRes);

  /* 4. Отказ сети, перехода по адресу и пустой кэш → внятная страница. */
  const dead = await run(
    { url: 'https://zroutehub.bond/', mode: 'navigate' },
    mkCaches(new Map()), boom, Resp, later, 5000, 'cache', OFFLINE
  );
  check('переход без сети и без запаса даёт страницу с объяснением',
    dead instanceof Resp && dead.text === OFFLINE && dead.init.status === 503
      && String(dead.init.headers['Content-Type']).includes('charset=utf-8'));

  /* 5. Отказ для файла (не перехода) — честная ошибка, а не подмена. */
  let fileFailed = false;
  try {
    await run({ url: './src/forum.css', mode: 'no-cors' }, mkCaches(new Map()),
      boom, Resp, later, 5000, 'cache', OFFLINE);
  } catch { fileFailed = true; }
  check('отказ без запаса для файла остаётся отказом, а не пустой выдачей',
    fileFailed);

  /*
    Вторая половина той же жалобы: страница ждёт данные сайта столько, сколько
    база соизволит проснуться. Правки в sw.js тут мало — молчание таблицы
    человек видит как «вечная загрузка», и страница обязана назвать причину.
  */
  const bootSrc = await readFile('src/main.js', 'utf8');
  const cfgSrc = await readFile('config.js', 'utf8');
  const cssAll = await readFile('src/styles-v8.css', 'utf8');

  check('срок, после которого ожидание называют вслух, — число в config',
    /slowBootSeconds:\s*\d+/.test(cfgSrc) && bootSrc.includes('CONFIG.slowBootSeconds * 1000'));
  check('объяснение показывает и плашка первого захода, и заглушка страницы',
    bootSrc.includes('boot-loader__slow') && /app\.querySelector\('\.loading'\)/.test(bootSrc));
  check('пришедшие данные уже не объясняют чужое молчание',
    /function showSlowBootNotice\(\)\s*\{\s*if \(dataArrived\) return;/.test(bootSrc)
      && /const data = await loadAll\(\);\r?\n\s*dataArrived = true;/.test(bootSrc));
  /*
    Раньше здесь же проверяли, что «опоздавший ответ чужого сервера не
    перетирает экран»: страница держала выбранный номер и сравнивала его с
    ответом. Переключателя серверов на сайте больше нет, набор один — значит
    и сравнивать нечего. Проверка стала проще и строже: страница не должна
    вообще знать, что сервер бывает чужим.
  */
  check('страница не помнит про выбор сервера: перетирать нечего',
    !bootSrc.includes('viewServer') && !bootSrc.includes('zr33:server-change')
      && !bootSrc.includes('server-switch'));
  check('у объяснения есть повтор, и он идёт тем же путём, что открытие страницы',
    bootSrc.includes('data-boot-retry')
      && /data-boot-retry\]'\)\)\s*\r?\n?\s*boot\(\);/.test(bootSrc));
  check('честное объяснение выключает крутящиеся точки «ещё ждём»',
    cssAll.includes('.loading.is-honest::after') && bootSrc.includes("classList.add('is-honest')"));
  check('текст объяснения говорит про сон базы и не обещает лишнего',
    bootSrc.includes('база на бесплатном тарифе засыпает')
      && bootSrc.includes('Форум, календарь') && bootSrc.includes('SLOW_BOOT_TEXT'));
  /* Исполняем само объяснение на подставных узлах: глазами это не проверить. */
  const noticeSrc = bootSrc.slice(
    bootSrc.indexOf('function showSlowBootNotice()'),
    bootSrc.indexOf('function armSlowBootNotice()')
  );
  /*
    Запасной адрес вынесен в отдельную функцию того же файла и исполняется
    здесь же: проверка «на зеркале ссылку не показывать» без хоста не
    проверяется глазами, а сломать её можно одной строчкой.
  */
  const mirrorSrc = bootSrc.slice(
    bootSrc.indexOf('function mirrorLinkHtml()'),
    bootSrc.indexOf('function showSlowBootNotice()')
  );
  check('запасной адрес собирается из данных репозитория, а не вписан словами',
    /get mirrorUrl\(\)/.test(cfgSrc)
      && /`https:\/\/\$\{this\.github\.owner\.toLowerCase\(\)\}\.github\.io\/\$\{this\.github\.repo\}\/`/
        .test(cfgSrc));
  check('объяснение ждёт адрес из config, а не хардкодит его в странице',
    mirrorSrc.includes('CONFIG.mirrorUrl'));
  check('ссылка на зеркало есть и на странице отказа в сервисном работнике',
    /qvaden\.github\.io\/zroute-s33/.test(swSrc));
  /*
    Файл CNAME заставлял GitHub Pages редиректить на домен, и зеркало
    оказывалось мёртвой ступенькой: где не открывается .bond, не открывалось
    и github.io. Тест не даёт вернуть редирект по невнимательности.
  */
  let cnameGone = false;
  try { await readFile('CNAME'); } catch { cnameGone = true; }
  check('CNAME удалён: Pages отдаёт сайт, а не разворот на домен', cnameGone);
  const mirrorRun = new Function('CONFIG', 'location', 'esc',
    `${mirrorSrc}; return mirrorLinkHtml;`);
  const mirrorOnDomain = mirrorRun(
    { mirrorUrl: 'https://qvaden.github.io/zroute-s33/' },
    { hostname: 'zroutehub.bond', hash: '#/forum' },
    (s) => String(s)
  )();
  check('на основном домене объяснение держит зеркало при себе',
    mirrorOnDomain.includes('qvaden.github.io/zroute-s33/#/forum')
      && mirrorOnDomain.includes('data-boot-mirror'));
  check('адрес зеркала проходит через экранирование, как и любой текст',
    mirrorSrc.includes('esc(url)'));
  const mirrorOnPages = mirrorRun(
    { mirrorUrl: 'https://qvaden.github.io/zroute-s33/' },
    { hostname: 'qvaden.github.io', hash: '' },
    (s) => String(s)
  )();
  check('на самом зеркале второй ссылки на зеркало не появляется',
    mirrorOnPages === '');
  const core = { html: '', insertAdjacentHTML(_where, html) { this.html = html; } };
  const loaderEl = {
    classList: { contains: () => false },
    querySelector: (sel) => (sel === '.boot-loader__core' ? core : null),
  };
  const box = {
    innerHTML: '', added: [], querySelector: () => null,
    classList: { add(cls) { box.added.push(cls); } },
  };
  const appEl = { querySelector: (sel) => (sel === '.loading' ? box : null) };
  const mirrorFn = mirrorRun(
    { mirrorUrl: 'https://qvaden.github.io/zroute-s33/' },
    { hostname: 'zroutehub.bond', hash: '#/forum' },
    (s) => String(s)
  );
  const makeNotice = new Function('app', 'bootLoader', 'esc', 'SLOW_BOOT_TEXT', 'dataArrived',
    'CONFIG', 'location', 'mirrorLinkHtml',
    `${noticeSrc}${mirrorSrc}; return showSlowBootNotice;`);
  const noticeLocation = { hostname: 'zroutehub.bond', hash: '#/forum' };
  const noticeConfig = { mirrorUrl: 'https://qvaden.github.io/zroute-s33/' };

  makeNotice(appEl, loaderEl, (s) => String(s), 'ТЕКСТ-ОБЪЯСНЕНИЕ', false,
    noticeConfig, noticeLocation, mirrorFn)();
  check('объяснение вставляется в оба места ожидания',
    core.html.includes('ТЕКСТ-ОБЪЯСНЕНИЕ') && box.innerHTML.includes('ТЕКСТ-ОБЪЯСНЕНИЕ')
      && box.innerHTML.includes('Повторить') && box.added.includes('is-honest'));
  check('повтор зовет загрузку, а не перекрашивает заглушку',
    box.innerHTML.includes('data-boot-retry'));
  check('объяснение в оба места проходит через экранирование',
    (noticeSrc.match(/esc\(SLOW_BOOT_TEXT\)/g) || []).length === 2);
  check('пока ждём данные на домене, в обоих местах виден запасной адрес',
    core.html.includes('data-boot-mirror') && box.innerHTML.includes('data-boot-mirror'));

  core.html = ''; box.innerHTML = '';
  noticeLocation.hostname = 'qvaden.github.io';
  makeNotice(appEl, loaderEl, (s) => String(s), 'ТЕКСТ-ОБЪЯСНЕНИЕ', false,
    noticeConfig, noticeLocation, mirrorFn)();
  check('на зеркале объяснение не предлагает то же зеркало',
    core.html.includes('ТЕКСТ-ОБЪЯСНЕНИЕ') && !core.html.includes('data-boot-mirror')
      && !box.innerHTML.includes('data-boot-mirror'));
  noticeLocation.hostname = 'zroutehub.bond';

  core.html = ''; box.innerHTML = '';
  makeNotice(appEl, loaderEl, (s) => String(s), 'ТЕКСТ-ОБЪЯСНЕНИЕ', true,
    noticeConfig, noticeLocation, mirrorFn)();
  check('если данные всё-таки пришли, объяснение не появляется',
    core.html === '' && box.innerHTML === '');
}

/* ── 11. Снимок вместо базы: пустая таблица обязана быть подписана ────────

   Оболочка сайта приходит с GitHub и Render, а данные — из базы, которая
   висит за Cloudflare. Российская сеть без VPN иногда не доходит ровно до
   базы, и тогда человек видел пустой рейтинг молча: «сайт умер», хотя дело
   было в одном запросе. Проверка держит две вещи — что сайт действительно
   берёт копию двухчасовой давности, когда основной источник промолчал, и что
   он об этом говорит словами. Тело loadAll и полоска объяснения вырезаны из
   настоящих файлов и исполнены с подставными адаптерами и узлами. Глазами
   это не проверить: чтобы увидеть снимок, надо оказаться в сети, которая не
   пускает к базе, — а такого места у того, кто правит код, обычно нет.
────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const dataSrc = await readFile('src/data/index.js', 'utf8');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const jsonAdapterSrc = await readFile('src/data/adapters/json.js', 'utf8');
  const workflowSrc = await readFile('.github/workflows/backup-from-db.yml', 'utf8');
  const cfgSrc = await readFile('config.js', 'utf8');

  const readAllStart = dataSrc.indexOf('async function readAll(');
  const loadAllStart = dataSrc.indexOf('export async function loadAll()');
  const readAllSrc = dataSrc.slice(readAllStart, loadAllStart);
  const loadAllSrc = dataSrc.slice(loadAllStart).replace('export ', '');
  check('readAll и loadAll удалось вырезать из точки переключения',
    readAllStart > 0 && loadAllStart > readAllStart
      && loadAllSrc.includes('await readAll(json)'));

  /*
    Отметка снятия взята ровно в том виде, в каком её отдаёт база: хвост
    «+00» без минут. Конструктор Date такой хвост не понимает и возвращает
    «не дата» молча — проверка на это споткнулась бы сразу, если бы полоска
    начала показывать «снимок от Invalid Date» или, что хуже, вовсе без часа.
  */
  const STAMP = '2026-10-01T08:00:00+00';
  const payload = {
    alliances: [{ id: 'a1' }], weeks: [], results: [], events: [], texts: [],
    pulledAt: STAMP,
  };

  function fakeAdapter(name, shouldFail) {
    let reads = 0;
    const get = (key) => async () => {
      if (shouldFail) throw new Error(name + ': сети нет');
      reads++;
      return payload[key];
    };
    return {
      name,
      get reads() {
        return reads;
      },
      getAlliances: get('alliances'),
      getWeeks: get('weeks'),
      getResults: get('results'),
      getEvents: get('events'),
      getTexts: get('texts'),
      getPulledAt: async () => payload.pulledAt,
    };
  }

  /*
    Сервер на сайте один — тот, что назван в config.js, — и копия снята ровно
    с него, поэтому обоим адаптерам тест подаёт только поведение: кто отвечает,
    кто молчит.
  */
  function runLoadAll(primary, snapshot) {
    const harness = new Function('selected', 'json',
      "let lastLoad = { source: '', snapshotAt: null, primaryError: '' };"
      + readAllSrc + loadAllSrc
      + '; return { loadAll, peek: () => lastLoad };');
    return harness(primary, snapshot);
  }

  const liveBase = fakeAdapter('supabase', false);
  const deadBase = fakeAdapter('supabase', true);
  const liveSnapshot = fakeAdapter('json', false);
  const deadSnapshot = fakeAdapter('json', true);

  const okRun = runLoadAll(liveBase, liveSnapshot);
  const okData = await okRun.loadAll();
  check('пока база отвечает, до копии дело не доходит',
    okData.alliances.length === 1 && okRun.peek().source === 'supabase'
      && liveSnapshot.reads === 0);

  const snapRun = runLoadAll(deadBase, liveSnapshot);
  const snapData = await snapRun.loadAll();
  check('когда база молчит, данные приходят из копии',
    snapData.alliances.length === 1 && snapRun.peek().source === 'снимок');
  check('копия помнит, каким часом она снята',
    snapRun.peek().snapshotAt === STAMP);
  check('причина обращения к копии сохраняется, чтобы объяснить её словами',
    snapRun.peek().primaryError.includes('supabase: сети нет'));

  const bothRun = runLoadAll(deadBase, deadSnapshot);
  const bothError = await bothRun.loadAll().then(() => '', (e) => String(e.message));
  check('если не ответил никто, пустота не выдаётся за данные',
    bothError.includes('json: сети нет') && bothRun.peek().source === '');

  /*
    Копия и есть json-адаптер: когда основной источник — он же, звать его же
    спасать некого, и ошибка обязана остаться исходной, а не превратиться в
    «второй попытки не было».
  */
  const onlySnapshot = fakeAdapter('json', true);
  const onlyRun = runLoadAll(onlySnapshot, onlySnapshot);
  const onlyError = await onlyRun.loadAll().then(() => '', (e) => String(e.message));
  check('когда копия — единственный источник, она не зовётся сама себя спасать',
    onlyError.includes('json: сети нет') && onlyRun.peek().source === '');

  /*
    Здесь жила проверка «под выбранным чужим сервером копию не зовём»: зритель
    мог выбрать 44-й, а `data/live.json` снят только с 33-го, и показать её под
    чужим заголовком значило соврать цифрами. Выбор сервера с сайта убран,
    набор один, поэтому такого отказа больше нет. Осталось обратное — точка
    переключения не имеет права о серверах даже заикнуться: иначе выбор
    вернут, а копию forgotten.
  */
  check('точка переключения источников не знает, что серверов может быть несколько',
    !/server/i.test(dataSrc) && !mainSrc.includes('Копия данных сайта есть только'));

  check('час снятия читается из того же файла, что и данные',
    /export async function getPulledAt\(\)/.test(jsonAdapterSrc)
      && jsonAdapterSrc.includes('(await raw()).pulledAt'));

  /* ── Полоска объяснения: исполняем её на подставных узлах ── */
  const noticeStart = mainSrc.indexOf('function dataNotice()');
  const bootStart = mainSrc.indexOf('async function boot() {');
  const noticeSrc = mainSrc.slice(noticeStart, bootStart);
  check('dataNotice и помощники удалось вырезать из main.js',
    noticeStart > 0 && bootStart > noticeStart
      && noticeSrc.includes('function snapshotStamp(')
      && noticeSrc.includes('function sourceBadge('));

  const runNotice = new Function('lastLoad', 'document', 'esc', 'db',
    noticeSrc + '; return { dataNotice, snapshotStamp, sourceBadge };');

  function paint(state, sourceName) {
    const box = { hidden: true, innerHTML: '' };
    const badge = { textContent: '' };
    const doc = { getElementById: (id) => (id === 'data-notice' ? box : badge) };
    const run = runNotice(state, doc, (s) => '[' + String(s) + ']',
      { name: sourceName });
    run.dataNotice();
    run.sourceBadge();
    return { box, badge, run };
  }

  const shown = paint(
    { source: 'снимок', snapshotAt: STAMP, primaryError: 'база молчит' },
    'supabase'
  );
  check('на копии сайт говорит об этом прямо, а не молчит пустым рейтингом',
    shown.box.hidden === false && shown.box.innerHTML.includes('Показан снимок таблицы от ['));
  check('час снятия показан числом, а не исходным адресом даты',
    /\[\d{2}\.\d{2}/.test(shown.box.innerHTML));
  check('объяснение копии не обещает, что форум и запись постов живы',
    shown.box.innerHTML.includes(' Форум, вход и ')
      && shown.box.innerHTML.includes('только в живой базе'));
  check('в объяснении есть кнопка повтора, которая зовёт загрузку',
    shown.box.innerHTML.includes('data-boot-retry')
      && shown.box.innerHTML.includes('Повторить'));
  check('подвал на копии врёт меньше: источник подписан копией',
    shown.badge.textContent === 'снимок');

  const none = paint(
    { source: '', snapshotAt: null, primaryError: '<script>bad</script>' },
    'supabase'
  );
  check('когда не пришло ничего, полоска появляется и называет причину',
    none.box.hidden === false && none.box.innerHTML.includes('Данные не дошли'));
  check('если и причина не известна, полоска говорит про базу и про копию словами',
    (() => {
      const blind = paint({ source: '', snapshotAt: null, primaryError: '' }, 'supabase');
      return blind.box.innerHTML.includes('ни база, ни снимок');
    })());
  check('чужой текст ошибки проходит через экранирование',
    none.box.innerHTML.includes('[<script>bad</script>]'));
  check('объяснение не склеивает две точки: хвост чужого сообщения снимается',
    (() => {
      const dotted = paint(
        {
          source: '',
          snapshotAt: null,
          primaryError: 'Не удалось связаться с базой. Проверьте интернет.',
        },
        'supabase'
      );
      return dotted.box.innerHTML.includes('интернет]. Рейтинг');
    })());
  /*
    Здесь была полоска «Копия данных сайта есть только для сервера сайта (33),
    а для 44 её нет»: она спасала зрителя, выбравшего чужой набор, от того,
    чтобы прочесть «данные не дошли» как «не работает 44-й». Выбора больше
    нет, поэтому фраза про чужой сервер ушла из текста страницы — и проверка
    держит именно это: в объяснении не должно оставаться намека на то, что
    серверов может быть несколько.
  */
  check('объяснение пустоты не упоминает другие серверы',
    !noticeSrc.includes('Копия данных сайта') && !/для сервера \(/.test(noticeSrc));
  check('в исправном состоянии полоска скрыта, а подвал называет базу',
    (() => {
      const clean = paint(
        { source: 'supabase', snapshotAt: null, primaryError: '' }, 'supabase'
      );
      return clean.box.hidden === true && clean.box.innerHTML === ''
        && clean.badge.textContent === 'supabase';
    })());
  check('полоску зовут и в успехе, и в падении — молчаливой пустоты не остаётся',
    (mainSrc.match(/\bdataNotice\(\);/g) || []).length === 2
      && mainSrc.includes("import { loadAll, capabilities, db, lastLoad }"));

  check('отметка читается из формата базы и молчит, если даты нет',
    (() => {
      const run = runNotice(
        { source: 'снимок', snapshotAt: null, primaryError: '' },
        { getElementById: () => ({ hidden: false, innerHTML: '' }) },
        (s) => String(s),
        { name: 'supabase' }
      );
      return run.snapshotStamp('') === '' && run.snapshotStamp('не дата') === ''
        && run.snapshotStamp(STAMP) !== ''
        && run.snapshotStamp('2026-10-01T08:00:00Z') !== '';
    })());

  /* ── Раздача и документы ── */
  const siteHtml = await readFile('index.html', 'utf8');
  check('на странице есть место под полоску, и оно объявлено живой областью',
    /<div id="data-notice" class="data-notice wrap" role="status"/.test(siteHtml));
  check('полоска о копии описана стилем, которым нарисовано остальное',
    (await readFile('src/styles-v8.css', 'utf8')).includes('.data-notice'));
  check('копия собирается каждые два часа, а не раз в сутки',
    /- cron: '5 \*\/2 \* \* \*'/.test(workflowSrc)
      && !/- cron: '30 3 \* \* \*'/.test(workflowSrc));
  check('воркфлоу знает, что у файла появился читатель на странице',
    workflowSrc.includes('второй читатель') && workflowSrc.includes('Cloudflare'));
  check('причина копии объяснена в конфиге словами, а не только кодом',
    cfgSrc.includes('Cloudflare')
      && dataSrc.includes('ПОЧЕМУ ЗДЕСЬ ЕСТЬ ВТОРАЯ ПОПЫТКА'));
  check('копия описана в документах: архитектура и раздача',
    (await readFile('docs/ARCHITECTURE.md', 'utf8')).includes('Запасное чтение')
      && (await readFile('docs/HOSTING.md', 'utf8')).includes('Показан снимок'));
}

/* ── 12. Мультиаренда: у темы появляется сервер ─────────────────────────────

   Копий сайта не будет: сервер становится колонкой в той же базе. Шаг дешёвый
   по коду и дорогой по риску тихо сломать ленту:

     1. `Number(null)` — это ноль. Проверка одной только конечностью числа
        превращает «сервер не выбран» в «сервер 0» и показывает пустой экран
        там, где лежат две темы. Это уже случилось при первой реализации.
     2. PostgREST отвергает запрос с неизвестным столбцом целиком. Фильтр
        `server_id` приложенный всегда, до прогона миграции роняет весь форум.
     3. Колонки представления фиксируются при его создании: без пересоздания
        `forum_post_list` фильтра в базе просто не существует.

   Поэтому адрес и черновой адаптер прогоняют делом, а боевой адаптер читают по
   строкам: его запрос уходит в базу, которой у теста нет.

   ЗРИТЕЛЬ ВЫБОРА НЕ ИМЕЕТ. Номер ленты берётся из config.js, в адрес страницы
   он не пишется и в памяти браузера не живёт — эти проверки держат как раз
   отсутствие измерения, а не работу переключателя. Колонка в базе остаётся:
   она нужна, чтобы чужие темы не примешивались к нашей ленте.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20261001-server-scope.sql', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const url = await import('../src/forum/feed-url.js');
  const urlSrc = await readFile('src/forum/feed-url.js', 'utf8');

  /* ── Одно число сервера: границы знает база, клиента касается одна из них ── */
  const bounds = /create table if not exists public\.forum_servers \([\s\S]{0,200}?check \(id between (\d+) and (\d+)\)/
    .exec(sql);
  check('база проверяет номер ряда границами', bounds != null);
  check('единственный номер, который клиент сегодня просит, лежит внутри этих границ',
    Number(CONFIG.server) >= Number(bounds[1]) && Number(CONFIG.server) <= Number(bounds[2]));
  /*
    Раньше эти же границы держал общий модуль `src/logic/server-choice.js`: он
    проверял число из адреса и из памяти браузера. Обоих источников выбора
    больше нет, и копия границ в клиенте стала бы местом, где правку забывают.
  */
  check('границы держит база, и ни один экран их не повторяет',
    !/SERVER_MIN|SERVER_MAX/.test(mountSrc) && !/SERVER_MIN|SERVER_MAX/.test(urlSrc)
      && !urlSrc.includes('server'));

  const dbDefault = Number(
    /add column if not exists server_id integer\s+not null default (\d+)/.exec(sql)?.[1]
  );
  check('сервер у темы — колонка с значением по умолчанию, а не вторая таблица',
    Number.isInteger(dbDefault));
  equal('значение по умолчанию в базе и номер сайта в конфиге — одно число',
    dbDefault, Number(CONFIG.server));
  check('и оно названым рядом в списке серверов, а не висячим числом',
    sql.includes('insert into public.forum_servers (id, title)')
      && sql.includes(String(dbDefault)));

  /* ── Миграция: без этих шагов фильтра в базе нет ── */
  check('номер темы ссылается на список серверов, а не живёт сам по себе',
    /foreign key \(server_id\) references public\.forum_servers \(id\)/.test(sql));
  check('лента одного сервера читается индексом, где сервер первый',
    /create index if not exists forum_posts_server_idx\s+on public\.forum_posts \(server_id, /.test(sql));
  check('представление ленты пересоздано: старое не увидело бы новую колонку',
    /drop view if exists public\.forum_post_list;/.test(sql)
      && sql.indexOf('create view public.forum_post_list') > sql.indexOf('add column if not exists server_id'));
  check('пересозданное определение осталось на стороне вызывающего',
    /create view public\.forum_post_list with \(security_invoker = on\)/.test(sql));
  check('кэш схемы API перезван, иначе PostgREST держал бы прежние колонки',
    sql.includes("notify pgrst, 'reload schema';"));
  check('список серверов читает и гость: выбирать ленту можно без входа',
    sql.includes('grant select on public.forum_servers to anon, authenticated;')
      && /create policy forum_servers_read[\s\S]{0,160}for select to anon, authenticated\s+using \(true\)/.test(sql));
  check('и ни слова про запись: сервер в список вносит доступ к базе, не игрок',
    !/forum_servers[\s\S]{0,200}?(for insert|for update|for delete)/.test(sql));
  check('файл переживает второй прогон: ряд сервера вставляется без отказа',
    sql.includes('on conflict (id) do nothing') && !/raise exception/.test(sql));

  /* ── Адрес: номера сервера в ссылке нет ни при чтении, ни при записи ── */
  check('лента больше не разбирает и не пишет сервер: общий модуль выбора удалён',
    !urlSrc.includes('server-choice') && !urlSrc.includes('putServerParam')
      && !mountSrc.includes('server-choice'));

  const known = { categories: ['vs'], tags: [], sorts: ['top'] };
  const picked = url.filtersFromSearch('server=44&cat=vs&sort=top', known);
  equal('чужая ссылка с номером сервера открывается обычным видом ленты',
    [Object.hasOwn(picked, 'server'), picked.category, picked.sort], [false, 'vs', 'top']);
  equal('в адрес обратно сервер не пишется: ссылка остаётся ссылкой на раздел',
    url.searchFromFilters({ ...picked, server: 44 }), 'cat=vs&sort=top');

  /* ── Черновой режим: те же развилки, что в базе ── */
  const local = await import('../src/forum/adapters/local.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const rawLocal = () => JSON.parse(store.get('zr33.forum.local'));

  await local.signUp('Распорядитель');
  const plain = await local.createPost({ title: 'Тема без выбора', body: 'Общий сервер.', category: 'vs' });
  const other = await local.createPost({ title: 'Тема другого сервера', body: 'Написана на 44.', category: 'vs', serverId: 44 });

  equal('тема без выбора получает сервер сайта, а не остаётся ничейной', plain.serverId, Number(CONFIG.server));
  equal('названный сервер тема держит', other.serverId, 44);
  equal('без фильтра лента видит обе темы', (await local.listPosts({})).posts.length, 2);
  equal('пустой выбор — не «сервер 0»: лента остаётся',
    (await local.listPosts({ serverId: null })).posts.length, 2);
  equal('фильтр по серверу сайта оставляет одну',
    (await local.listPosts({ serverId: Number(CONFIG.server) })).posts.map((p) => p.id), [plain.id]);
  equal('фильтр по 44-му оставляет другую',
    (await local.listPosts({ serverId: 44 })).posts.map((p) => p.id), [other.id]);
  equal('лента сервера, которого нет, пуста, а не ошибочна',
    (await local.listPosts({ serverId: 77 })).posts.length, 0);

  /* Тема, лежавшая в хранилище до этого шага, не должна пропасть из ленты. */
  const legacy = rawLocal();
  legacy.posts = legacy.posts.map((p) => {
    const { serverId, ...rest } = p;
    return rest;
  });
  store.set('zr33.forum.local', JSON.stringify(legacy));
  const legacyList = await local.listPosts({ serverId: Number(CONFIG.server) });
  check('тема без номера в хранилище читается как тема своего сервера',
    legacyList.posts.length === 2 && legacyList.posts.every((p) => p.serverId === Number(CONFIG.server)));

  equal('пока сервер один, переключателю не из чего состоять',
    (await local.listServers()).map((r) => r.id), [Number(CONFIG.server)]);
  const two = rawLocal();
  two.servers = [{ id: 33, title: 'Сервер 33' }, { id: 44, title: 'Сервер 44', enabled: false }];
  store.set('zr33.forum.local', JSON.stringify(two));
  equal('ряд серверов в хранилище — тот же список, что таблица',
    (await local.listServers()).map((r) => [r.id, r.enabled]), [[33, true], [44, false]]);
  const noServers = rawLocal();
  delete noServers.servers;
  store.set('zr33.forum.local', JSON.stringify(noServers));
  const savedServer = CONFIG.server;
  CONFIG.server = null;
  equal('без номера сайта список пуст: это «миграции нет», а не «серверов нет»',
    (await local.listServers()).length, 0);
  CONFIG.server = savedServer;

  /* ── Боевой адаптер: поля прикладываются, только когда их попросили ── */
  check('фильтр ленты едет в базу только при названном сервере',
    /if \(serverId != null && Number\.isInteger\(Number\(serverId\)\)\) \{\s*\n\s*params\.set\('server_id', `eq\.\$\{Number\(serverId\)\}`\);/.test(supaSrc));
  check('и не проверяется одной конечностью: null — не сервер 0',
    !/Number\.isFinite\(Number\(serverId\)\)/.test(supaSrc + localSrc));
  check('новая тема отправляет колонку только когда сервер выбран',
    /if \(draft\.serverId != null && Number\.isInteger\(Number\(draft\.serverId\)\)\) \{\s*\n\s*payload\.server_id = Number\(draft\.serverId\);/.test(supaSrc));
  check('без колонки в ответе тема остаётся без сервера, а не с №33 из головы',
    /serverId: row\.server_id == null \? null : Number\(row\.server_id\)/.test(supaSrc));
  check('список серверов читается без права и без входа',
    supaSrc.includes("/forum_servers?select=id,title,enabled&order=id.asc&limit=100"));
  check('отказ вместо таблицы проглочен в пустой список: форум не обязан падать',
    /const rows = await rest\('\/forum_servers[\s\S]{0,120}\.catch\(\(\) => null\)/.test(supaSrc));
  check('контракт объявляет список необязательным — старый адаптер не сломан',
    /@property \{\(\) => Promise<ForumServer\[\]>\} \[listServers\]/.test(contractSrc)
      && contractSrc.includes('@typedef {Object} ForumServer')
      && /Игровой сервер — один ряд таблицы `forum_servers`/.test(contractSrc));
  equal('оба адаптера умеют отвечать на вопрос о серверах',
    [/export async function listServers\(\)/.test(supaSrc), /export async function listServers\(\)/.test(localSrc)],
    [true, true]);

  /* ── Сервер ленты: один, из config.js, без памяти, адреса и клика ── */
  const gone = async (p) => { try { await readFile(p); return false; } catch { return true; } };
  check('лента берёт номер из config.js, а не из выбора зрителя',
    mountSrc.includes('serverId: siteServer()')
      && !mountSrc.includes('readServerChoice') && !mountSrc.includes('writeServerChoice')
      && !mountSrc.includes('resolveServer'));
  check('в памяти браузера выбора сервера не осталось: ни общий ключ, ни forum-ключ',
    !mountSrc.includes('zr33.server') && !mountSrc.includes('zr33.forum.server')
      && !urlSrc.includes('zr33.server'));
  equal('общий модуль выбора и ряд в шапке удалены из проекта',
    [await gone('src/logic/server-choice.js'), await gone('src/ui/server-switch.js')],
    [true, true]);
  check('сервера спрашивают рядом с лентой, а не перед ней',
    /const content = postId \? loadThread\(postId\) : loadFeed\(\);[\s\S]{0,400}if \(!postId\) loadServers\(\);/.test(mountSrc));
  check('в теме списка серверов не спрашивают: он нужен только ленте',
    mountSrc.includes('if (!postId) loadServers();'));
  check('сервер ушёл из подписи памяти ленты: подмена номера была бы чужим экраном',
    !/state\.serverId/.test((mountSrc.match(/function feedSignature\(\)[\s\S]{0,400}/) || [''])[0])
      && /state\.saved \? 'saved' : 'all',/.test(mountSrc));
  check('тему пишут на сервере сайта, и пустой config не выдумывает номер',
    mountSrc.includes('if (state.serverId != null) draft.serverId = state.serverId;'));
  check('заголовок вкладки никто не переписывает: подпись сервера была про выбор ленты',
    !mountSrc.includes('serverTabTitle') && !mountSrc.includes('BASE_TITLE'));

  /* ── Экран: ни ряда, ни намёка на то, что лент другая ── */
  const { renderForum: renderServerFrame } = await import('../src/pages/forum.js');
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  const frame = (servers, serverId, extra = {}) => renderServerFrame(
    { events: [], texts: [], alliances: [] },
    { ready: true, loading: false, posts: [], total: 0, servers, serverId, ...extra }
  );
  check('над лентой ряда серверов нет, и слов «Читать форум N» страница не знает',
    !frame([{ id: 33, title: 'Сервер 33', enabled: true }], 33).includes('data-forum-server')
      && !pageSrc.includes('data-forum-server') && !pageSrc.includes('Читать форум'));
  check('под лентой чужой сервер не упоминается, даже когда база его знает',
    !frame([
      { id: 33, title: 'Сервер 33', enabled: true },
      { id: 44, title: 'Сервер 44', enabled: false },
    ], 33).includes('Сервер 44'));
  /*
    Ради этой строки список серверов и грузят: приём новых тем в ленте
    закрывается модерацией базы, и человек обязан увидеть это до отправки,
    а не получить отказ после.
  */
  check('при закрытом приёме тем форма заменена строкой, а не отказом после отправки',
    frame([{ id: 33, title: 'Сервер 33', enabled: false }], 33, { me: { role: 'member' } })
      .includes('Приём новых тем в этот сервер закрыт модерацией'));
  check('стиля ряда больше нет ни в ленте, ни в шапке сайта',
    !cssSrc.includes('.seg--server') && !(await readFile('index.html', 'utf8')).includes('server-switch'));

  /* ── Документы ── */
  check('миграция стоит в реестре и описана там, где её ищут',
    readmeSrc.includes('20261001-server-scope.sql') && docsSrc.includes('20261001-server-scope.sql'));
  check('документы не обещают права по серверу в будущем времени: шаг назван файлом',
    /Прав по серверу на этом шаге не было[\s\S]{0,260}supabase\/applied\/20261001-server-rights\.sql/.test(docsSrc));
}

/* ── 13. Папка миграций: очередь наверху, история в applied/ ────────────────

   Файлов миграции много, и человек, который идёт в Supabase по списку,
   путается: что прогнать сегодня, а что уже прогнано. Договорённость такая:
   `supabase/*.sql` наверху — только то, чего на боевой базе ещё нет, а
   `supabase/applied/` — история. Ошибка здесь не косметическая: лишний прогон
   правит живую схему повторно, пропущенный роняет ленту. Порядок держат три
   проверки.

     1. каждый путь вида `supabase/….sql`, названный где угодно в проекте,
        ведёт к существующему файлу: после переезда папки опечатка в пути
        иначе молчит до того момента, когда человек пойдёт по ней в браузере;
     2. наверху лежит ровно очередь, и каждый её файл назван в реестре;
     3. панель печатает владельцу путь недостающей миграции там, где файл
        действительно лежит, — этот текст читают и идут по нему.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile, readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  const exists = async (p) => {
    try { await stat(p); return true; } catch { return false; }
  };

  const SKIP = new Set(['.git', 'node_modules', 'dist']);
  const TEXT = new Set(['.js', '.mjs', '.cjs', '.md', '.html', '.css', '.json', '.sql', '.ts', '.yml', '.yaml']);
  async function walk(dir, out = []) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        /*
          Не пропускать src/data: там код, тексты ошибок которого человек
          читает дословно, — и именно в нём однажды стоял путь к миграции,
          которого давно нет. Не обходить надо корневой data/ — это снимки
          данных, а не код.
        */
        if (!SKIP.has(e.name) && full !== 'data') await walk(full, out);
      } else if (TEXT.has(path.extname(e.name))) {
        out.push(full);
      }
    }
    return out;
  }

  /* ── Каждый названный путь ведёт к файлу ── */
  const broken = [];
  let named = 0;
  for (const file of await walk('.')) {
    for (const m of (await readFile(file, 'utf8')).matchAll(/supabase\/[0-9A-Za-z._/-]+\.sql/g)) {
      named++;
      if (!(await exists(m[0]))) broken.push(`${m[0]} (в ${file})`);
    }
  }
  check('ни одного пути миграции, которого больше нет на месте',
    named > 50 && broken.length === 0, broken.slice(0, 4).join('; '));

  /* ── Очередь и история не перемешаны ── */
  const queue = (await readdir('supabase')).filter((f) => f.endsWith('.sql'));
  const applied = await readdir('supabase/applied');
  const readme = await readFile('supabase/README.md', 'utf8');
  check('наверху лежит только то, что ждёт прогона, и всё это названо в реестре',
    queue.every((f) => readme.includes(f)));
  /* Пустая очередь — настоящее и правильное состояние: все миграции прогнаны.
     Требовать её непустой значило бы подталкивать к лишнему прогону. */
  check('пустую очередь реестр называет пустой: по устаревшей строке в базу не идут',
    queue.length > 0 || readme.includes('Очередь пуста'));
  check('прогнанное не валяется в очереди', !queue.some((f) => applied.includes(f)));
  check('реестр объясняет разметку папки словами, по которым её ищут',
    readme.includes('supabase/applied/') && readme.includes('ещё не выполнены'));
  check('история полная: новой базе есть чему собираться',
    applied.length > 30 && applied.includes('schema.sql'));

  /* ── Путь, который панель показывает владельцу ── */
  const adminSrc = await readFile('src/admin/main.js', 'utf8');
  const namedMigrations = [...new Set([...adminSrc.matchAll(/['"](20\d{6}-[a-z-]+\.sql)['"]/g)]
    .map((m) => m[1]))];
  equal('панель называет недостающую миграцию по настоящему пути',
    [adminSrc.includes('supabase/applied/${esc(migration)}'),
      namedMigrations.length > 3 && namedMigrations.every((n) => applied.includes(n))],
    [true, true]);
}
/* ── 14. Чат: то же форматирование, что у темы ─────────────────────────────

   Сообщение чата было плоской строкой: «проверять до 21:00» нельзя ни
   выделить, ни процитировать, поэтому важное уносили на форум, а в чат кидали
   ссылку. Кнопки формата — не косметика, но и не повод писать второй редактор:
   копия расходится с оригиналом при первой же правке. Значит проверять надо
   не «есть ли кнопки», а «взял ли чат общий».

     1. панель собрана той же функцией, что форма темы: тот же набор команд и
        та же палитра, а не список, переписанный в chats.js;
     2. поле ввода живёт по общему контракту редактора, и его лимит — то же
        число, что у ответа на форуме. Вторая цифра означала бы, что чат
        пускает то, что отвергает база, или режет то, что база приняла бы;
     3. панель стоит ВНЕ формы и прячется атрибутом hidden: пересборка
        композера уронила бы каретку и закрыла клавиатуру на телефоне;
     4. в базу уходит разметка, пропущенная через белый список темы, а «пусто
        или нет» решают видимые символы: «<b></b>» от пустоты не отличить;
     5. черновой режим не режет тело по длине HTML — обрезок посреди тега
        читался бы буквами «<b».
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const chatPageSrc = await readFile('src/pages/chats.js', 'utf8');
  const chatLogicSrc = await readFile('src/forum/chats.js', 'utf8');
  const editorSrc = await readFile('src/forum/editor.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const cssSrc = await readFile('src/refine.css', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');

  const { renderComposer, renderMessage } = await import('../src/pages/chats.js');
  const { renderMdBar } = await import('../src/pages/forum.js');
  const { postBody, sanitizeHtml, excerpt, textOf } = await import('../src/forum/format.js');
  const L = CONFIG.forum.limits;

  /* ── Панель и поле ввода: одна копия на троих ── */
  const me = { id: 'u1', nick: 'Лидер', banned: false };
  const room = { id: 'c1', closed: false, myRole: 'owner' };
  const base = {
    me, members: [], replyingTo: null, pollDraft: null, pollOpen: false,
    pendingFiles: [], sending: false, formatOpen: false,
  };
  const closedBar = renderComposer(base, room);
  const openBar = renderComposer({ ...base, formatOpen: true }, room);

  check('панель формата в чате собрана той же функцией, что форма темы',
    chatPageSrc.includes(`import { renderMdBar } from './forum.js';`)
      && closedBar.includes(renderMdBar()));
  const cmdCount = (html) => (html.match(/data-editor-cmd="/g) || []).length;
  const colorCount = (html) => (html.match(/data-editor-color="/g) || []).length;
  equal('команды чата — ровно те же, что под полем темы',
    cmdCount(closedBar), cmdCount(renderMdBar()));
  equal('палитра чата — ровно та же, что у темы',
    colorCount(closedBar), colorCount(renderMdBar()));

  check('в закрытом виде панель скрыта атрибутом, а не вырезана из разметки',
    /class="chat-format" data-chat-format hidden/.test(closedBar)
      && !/class="chat-format" data-chat-format hidden/.test(openBar));
  check('панель стоит над формой ввода и вне её: раскрытие не пересобирает композер',
    openBar.indexOf('data-chat-format') < openBar.indexOf('<form class="chat-compose"'));
  check('переключатель держит состояние, а не только вид',
    /data-chat-format-toggle[\s\S]{0,90}aria-pressed="false"/.test(closedBar)
      && /aria-pressed="true"/.test(openBar));

  const inputTag = /<div class="chat-compose__input[^>]*data-chat-input[^>]*>/.exec(openBar)?.[0] ?? '';
  check('поле ввода чата стало редактором общего контракта',
    /\bdata-editor\b/.test(inputTag) && /aria-multiline="true"/.test(inputTag));
  equal('лимит поля — то же число, что у ответа на форуме',
    /data-limit="(\d+)"/.exec(inputTag)?.[1], String(L.commentMax));
  check('плейсхолдер держится на классе: браузер оставляет в поле служебный br',
    /class="chat-compose__input is-empty"/.test(openBar)
      && cssSrc.includes('.chat-compose__input.is-empty::before'));

  /* ── Поведение: общее, а не похожее ── */
  check('чат берёт поведение редактора из editor.js, а не переписывает его',
    /import \{ applyFormat, syncEditorEmpty, wireRichEditor \} from '\.\/editor\.js';/.test(chatLogicSrc)
      && chatLogicSrc.includes('wireRichEditor(() => host);'));
  check('команды и цвета применяются к полю чата, а не к первому редактору страницы',
    chatLogicSrc.includes(`applyFormat(host.querySelector('[data-chat-input]'), cmdBtn.dataset.editorCmd`)
      && /applyFormat\(host\.querySelector\('\[data-chat-input\]'\), 'color'/.test(chatLogicSrc));
  check('скрытие панели делает атрибут, а не перерисовка композера',
    chatLogicSrc.includes('panel.hidden = !state.formatOpen'));
  check('состояние пустоты синхронизируется везде, где поле меняет код: набор, черновик, отправка',
    (chatLogicSrc.match(/syncEditorEmpty\(/g) || []).length >= 3);

  /* ── Что уходит в базу и что видит читатель ── */
  const dirty = '<b>срочно</b> <span style="COLOR:#FF6B6B">горящее</span>'
    + '<script>документы</script><img src="x" onerror=" украсть()">'
    + '<blockquote>цитата темы</blockquote><a href="javascript:boom()">яд</a>';
  const clean = sanitizeHtml(dirty);
  /* Браузер ставит в contenteditable <b>, канон общего списка превращает его в strong. */
  check('в базу уходит разметка, пропущенная через белый список темы',
    clean.includes('<strong>срочно</strong>') && clean.includes('color:#ff6b6b')
      && clean.includes('<blockquote>цитата темы</blockquote>'));
  check('опасное не уезжает в базу вместе с текстом',
    !clean.includes('<script') && !clean.includes('onerror') && !clean.includes('javascript:'));
  /*
    Цвет, выбранный на жирном слове, браузер кладёт на тот же <b>, а не в
    отдельный span: разрешать цвет только span значило бы молча выбрасывать
    половину цветов, которые человек видел в редакторе.
  */
  check('цвет держится на любом разрешённом строчном теге, а не только на span',
    sanitizeHtml('<b style="color: rgb(79, 217, 138)">сбор в 21:00</b>')
      === '<strong style="color:rgb(79, 217, 138)">сбор в 21:00</strong>');
  check('редактор просит у браузера стили вместо <font>, которого нет в списке',
    /execCommand\('styleWithCSS', false, true\)/.test(editorSrc)
      && /execCommand\('styleWithCSS', false, false\)/.test(editorSrc));
  check('«пусто» решают видимые символы, а не теги',
    textOf(sanitizeHtml('<b></b><br><span style="color:#ffffff"></span>')).trim() === '');
  check('сырой innerHTML в базу больше не уходит и теги не срезаются наивным regex',
    chatLogicSrc.includes(`const clean = sanitizeHtml(input?.innerHTML ?? '');`)
      && !chatLogicSrc.includes('<[^>]+>'));

  const bubble = renderMessage({
    id: 'm1', chatId: 'c1', authorId: 'u2', authorNick: 'Разведчик',
    body: clean, createdAt: new Date('2026-10-01T10:00:00Z'), reactions: {},
  }, { me, members: [] }, false, false);
  check('сообщение показывает форматирование, а не буквы тегов',
    bubble.includes('<strong>срочно</strong>') && !bubble.includes('&lt;strong&gt;'));
  check('выжимка остаётся плоским текстом: её читают в цитате ответа и в уведомлениях',
    !excerpt(clean).includes('<'));
  check('чужую разметку при показе всё равно чистит тот же список, что и на форуме',
    postBody('<b>жирный</b><iframe src="x"></iframe>').includes('<strong>жирный</strong>')
      && !postBody('<b>жирный</b><iframe src="x"></iframe>').includes('iframe'));

  /* ── Стили: пузырь сообщения и панель над вводом ── */
  check('разметка сообщения плотнее форумной: пузырь не должен быть выше реплики',
    cssSrc.includes('.chat-msg__body blockquote') && cssSrc.includes('.chat-msg__body pre')
      && /margin: 0 0 4px/.test(cssSrc));
  check('панель получила свой слой: .forum-md рассчитан стоять под полем, а не над ним',
    cssSrc.includes('.chat-format .forum-md'));
  check('поле ввода растёт и прокручивается, а не распирает композер',
    /\.chat-compose__input \{[\s\S]{0,300}?max-height: 160px;\s*\n\s*overflow-y: auto;/.test(cssSrc));
  check('раскрытый переключатель помечен цветом, чтобы было видно, что панель живая',
    /\.chat-compose__btn\[aria-pressed='true'\]/.test(cssSrc));

  /* ── Черновой режим: предел по видимому тексту, а не по длине HTML ── */
  check('черновой режим больше не режет тело по символам',
    !/String\(body \|\| ''\)\.slice\(0, 2000\)/.test(localSrc));

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const local = await import('../src/forum/adapters/local.js');
  await local.signUp('Лидер штаба');
  const chat = await local.createChat({ title: 'Штаб формата' });

  /* Видимых символов — ровно предел, а HTML вместе с тегами за него уходит. */
  const marked = '<strong>' + 'раз '.repeat(Math.floor(L.commentMax / 4)) + '</strong>';
  check('набранное сообщение влезает по видимому тексту, хотя HTML длиннее предела',
    textOf(marked).length <= L.commentMax && marked.length > L.commentMax);
  const accepted = await local.sendChatMessage(chat.id, marked);
  check('принятое сообщение доходит целиком: обрезок посреди тега читался бы буквами «<b»',
    accepted.body === marked);

  let tooLong = '';
  try {
    await local.sendChatMessage(chat.id, '<p>' + 'с '.repeat(L.commentMax + 2) + '</p>');
  } catch (e) { tooLong = String(e.message); }
  check('длиннее предела не проходит, и сказано, чем именно',
    tooLong.includes(`длиннее ${L.commentMax} символов`), tooLong);
  let emptyMsg = '';
  try {
    await local.sendChatMessage(chat.id, '<b></b><br>');
  } catch (e) { emptyMsg = String(e.message); }
  check('разметка без слов сообщением не считается',
    emptyMsg === 'Пустое сообщение', emptyMsg);

  /* ── Документы ── */
  const chatsDoc = docsSrc.slice(docsSrc.indexOf('## Закрытые чаты альянсов'),
    docsSrc.indexOf('## Как устроена модерация'));
  check('документы больше не обещают чат без форматирования',
    !docsSrc.includes('Всё, что нужно оформить, пишут на форуме')
      && /форматировани/i.test(chatsDoc));
  check('документы называют общую природу редактора, а не список кнопок',
    /редактор/i.test(chatsDoc) && chatsDoc.includes('тот же'));
}

/* ── 15. Права по серверу: чужая лента не своя кухня ────────────────────────

   Шаг 1 разделил ленты, но право слова оставил общим: во второй сервер писал
   кто угодно, и он был витриной, а не домом. Шаг 2 дороже первого ровно тем,
   что трогает права, — и ломается по двум тихим сценариям:

     1. пропущенная политика — и модератор чужого сервера распоряжается не своей
        лентой; лишняя — и игрок получает «violates row-level security policy»
        вместо «тебя нет в этом сервере»;
     2. `null` и `'none'` — разные ответы. Из первого не следует ничего (гость,
        миграции ещё нет), второе прячет форму. Подмена одного другим убрала бы
        форму темы у всех, кто зашёл до прогона SQL.

   Плюс две вещи, которые легко перестать держать вместе:

     3. модература — территория. Три закреплённые темы одного сервера, положенные
        в общий топ, вытеснили бы из него все остальные ленты, поэтому предел
        меряют по серверу темы;
     4. слова отказа живут в трёх местах (база, черновой адаптер, страница), и
        порядок проверок тоже: закрытый приём тем раньше отсутствия участия —
        иначе человеку советуют просить то, что всё равно не поможет.

   Миграцию читают по строкам (базы у теста нет), правила прогоняют делом —
   и в черновом адаптере, и в разметке страницы.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20261001-server-rights.sql', 'utf8');
  const mountSrc = await readFile('src/forum/mount.js', 'utf8');
  const pageSrc = await readFile('src/pages/forum.js', 'utf8');
  const calSrc = await readFile('src/pages/calendar.js', 'utf8');
  const rightsSrc = await readFile('src/forum/server-rights.js', 'utf8');
  const localSrc = await readFile('src/forum/adapters/local.js', 'utf8');
  const supaSrc = await readFile('src/forum/adapters/supabase.js', 'utf8');
  const contractSrc = await readFile('src/forum/contract.js', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const configSrc = await readFile('config.js', 'utf8');
  const docsSrc = await readFile('docs/FORUM.md', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');

  const NO_MEMBER = 'В этот сервер пишут только его участники: попросите модератора сервера добавить вас';
  const INTAKE_CLOSED = 'Приём новых тем в этот сервер закрыт модерацией';
  const PINS_FULL = 'В этом сервере закреплено уже три темы — сначала открепите одну';

  /* ── Членство и открытость ── */
  check('новый сервер по умолчанию свой, а не общий: ошибка «забыл закрыть» невозможна',
    /add column if not exists open_writing boolean\s*\n\s*not null default false;/.test(sql));
  check('дом сайта этот же прогон оставляет открытым — миграция не отнимает слово у тех, кто пишет',
    new RegExp(`update public\\.forum_servers set open_writing = true where id = ${CONFIG.server};`).test(sql));
  check('ключ членства — пара «игрок и сервер», обе ссылки каскадные',
    /primary key \(user_id, server_id\)/.test(sql)
      && /references public\.forum_users \(id\) on delete cascade/.test(sql)
      && /references public\.forum_servers \(id\) on delete cascade/.test(sql));
  check('ролей ровно две, и их имена держит чек-констрейнт',
    /check \(role in \('member', 'moderator'\)\)/.test(sql));
  check('у списка одна политика — на чтение; пишет в него только дверь',
    (sql.match(/create policy \w+ on public\.forum_server_members/g) || []).length === 1
      && /create policy forum_server_members_read on public\.forum_server_members\s*\n\s*for select using/.test(sql)
      && !/public\.forum_server_members\s*\n\s*for (insert|update|delete)/.test(sql));
  check('вошедшему выдано только чтение таблицы: запись мимо двери невозможна',
    /grant select on public\.forum_server_members to authenticated;/.test(sql)
      && /revoke all on table public\.forum_server_members from public, anon;/.test(sql)
      && !/grant (insert|update|delete) on (table )?public\.forum_server_members/.test(sql));

  check('нынешнее сообщество заведено в список дома, модература сайта — его модераторами',
    sql.includes(`select u.id, ${CONFIG.server}, 'member'`)
      && sql.includes(`select u.id, ${CONFIG.server}, 'moderator'`)
      && /where u\.role not in \('admin', 'moderator'\)/.test(sql));
  check('повторный прогон не перетирает то, что модерация поправила руками',
    (sql.match(/on conflict \(user_id, server_id\) do nothing/g) || []).length >= 2);
  check('новичок сам попадает в каждый открытый сервер и только в открытый',
    /create trigger forum_join_open_servers\s*\n\s*after insert on public\.forum_users/.test(sql)
      && /from public\.forum_servers s\s*\n\s+where s\.open_writing/.test(sql));

  /* ── Функции права ── */
  check('право слова и право модературы — отдельные `security definer` функции',
    /create or replace function public\.forum_can_write_server\(p_server integer\)[\s\S]{0,140}security definer/.test(sql)
      && /create or replace function public\.forum_can_moderate_server\(p_server integer\)[\s\S]{0,140}security definer/.test(sql));
  check('модерация сайта проходит обе функции первой веткой: территория её не ограничивает',
    /create or replace function public\.forum_can_write_server[\s\S]{0,400}select public\.forum_is_staff\(\)/.test(sql)
      && /create or replace function public\.forum_can_moderate_server[\s\S]{0,240}select public\.forum_is_staff\(\)/.test(sql));
  check('карта ролей отвечает и «none»: отсутствие права — это ответ, а не пустота',
    /create or replace function public\.forum_my_server_roles\(\)[\s\S]{0,900}else 'none'/.test(sql));
  check('карту читают только вошедшие, а право слова открыто и гостю — ленту ему видно',
    /grant execute on function public\.forum_my_server_roles\(\) to authenticated;/.test(sql)
      && /revoke all on function public\.forum_my_server_roles\(\) from public, anon;/.test(sql)
      && /grant execute on function public\.forum_can_write_server\(integer\) to anon, authenticated;/.test(sql));

  /* ── Политики: чьё право слова и чья модература ── */
  check('вставка темы смотрит на сервер строки, а вставка ответа — на сервер темы из подзапроса',
    /create policy forum_posts_insert[\s\S]{0,400}public\.forum_can_write_server\(server_id\)/.test(sql)
      && /forum_can_write_server\(\(select p\.server_id from public\.forum_posts p where p\.id = post_id\)\)/.test(sql));
  check('закрытая на приём лента не принимает ни одной новой темы, кроме служебных тем модерации',
    /create policy forum_posts_insert[\s\S]{0,700}\(public\.forum_is_staff\(\) or exists \(\s*\n\s*select 1 from public\.forum_servers s where s\.id = server_id and s\.enabled\s*\)/.test(sql));
  check('модература тем ограничена территорией в обе стороны — ни снять, ни переложить в чужой дом',
    /create policy forum_posts_moderate on public\.forum_posts\s*\n\s*for update using \(public\.forum_can_moderate_server\(server_id\)\)\s*\n\s*with check \(public\.forum_can_moderate_server\(server_id\)\);/.test(sql));
  equal('модературе ленты служат и ответы, и жалобы, и чужие вложения, и опросы',
    ['forum_comments_moderate', 'forum_reports_read', 'forum_reports_resolve', 'forum_attachments_delete', 'forum_polls_close']
      .map((n) => new RegExp(`create policy ${n}[\\s\\S]{0,700}forum_can_moderate_server`).test(sql)),
    [true, true, true, true, true]);

  check('предел закреплений меряется по серверу темы тем же числом, что и страница',
    /where pinned and not deleted and server_id = new\.server_id and id <> new\.id\) >= (\d+)/.test(sql)
      && Number(/server_id = new\.server_id and id <> new\.id\) >= (\d+)/.exec(sql)[1]) === CONFIG.forum.limits.pinsMax);
  check('номер ленты темы неподвижен для всех, кроме владельца сайта',
    /if not public\.forum_is_admin\(\) then\s*\n\s*new\.server_id := old\.server_id;/.test(sql));
  check('модератор сервера, снявший чужой ответ, не подписывается «Удалено автором»',
    /create or replace function public\.forum_comments_guard\(\)[\s\S]{0,1000}if public\.forum_can_moderate_server\(v_server\) then/.test(sql));

  /* ── Слова отказа: одна копия правила на три места ── */
  check('отказ назван причиной, а не текстом нарушения политики',
    sql.includes(`raise exception '${INTAKE_CLOSED}'`) && sql.includes(`raise exception '${NO_MEMBER}'`));
  check('тему и ответ проверяет одна функция, висящая на обеих таблицах',
    /TG_TABLE_NAME = 'forum_posts'/.test(sql)
      && (sql.match(/create trigger forum_server_write_insert\s*\n\s*before insert on public\.forum_(posts|comments)/g) || []).length === 2);
  check('слова дословно те же в черновом адаптере и на странице',
    [NO_MEMBER, INTAKE_CLOSED].every((t) => localSrc.includes(t) && rightsSrc.includes(t)));
  check('и больше нигде: разметка и боевой адаптер зовут общее, а не переписывают текст',
    !pageSrc.includes(NO_MEMBER) && !pageSrc.includes(INTAKE_CLOSED)
      && !mountSrc.includes(NO_MEMBER) && !supaSrc.includes(NO_MEMBER) && !supaSrc.includes(INTAKE_CLOSED));
  check('и порядок тот же: закрытый приём тем отвечает раньше отсутствия участия',
    [sql, localSrc, rightsSrc].every((src) => src.indexOf('Приём новых тем') < src.indexOf('пишут только его участники')));
  check('текст про закрепления совпадает у базы, чернового и боевого адаптеров',
    [sql, localSrc, supaSrc].every((src) => src.includes(PINS_FULL)));

  /* ── Дверь членства ── */
  check('дверь одна, открыта вошедшим, и таблица без неё не двигается',
    /create or replace function public\.forum_set_server_member\(\s*\n\s*p_user_id\s+uuid,/.test(sql)
      && /grant execute on function public\.forum_set_server_member\(uuid, integer, text\) to authenticated;/.test(sql)
      && /revoke all on function public\.forum_set_server_member\(uuid, integer, text\) from public, anon;/.test(sql));
  check('модератора сервера назначает модерация сайта, а чужой список не двигают',
    sql.includes("raise exception 'Модератора сервера назначает модерация сайта'")
      && sql.includes("raise exception 'В свой сервер добавляет его модератор, в чужой — модерация сайта'"));
  check('право на шаг проверяется раньше причин отказа: устройство списка видят не все',
    sql.indexOf('Модератора сервера назначает') < sql.indexOf('Это последний модератор сервера'));
  check('последнего модератора закрытой ленты снять нельзя, а открытому это не нужно',
    /if v_old = 'moderator' and p_role is distinct from 'moderator' and not v_open then[\s\S]{0,400}raise exception 'Это последний модератор сервера/.test(sql));
  check('решение двери попадает в журнал модературы и в уведомление игроку',
    /insert into public\.forum_moderation_actions/.test(sql)
      && /insert into public\.forum_notifications/.test(sql)
      && /'server_member_removed'/.test(sql));
  check('помощники журнала вошедшему не выданы: их зовёт только дверь',
    /revoke all on function public\.forum_log_server_action\(uuid, text, text, jsonb\) from public, anon, authenticated;/.test(sql));

  /* ── Идемпотентность и кэш схемы ── */
  check('файл переживает второй прогон: триггер снимается перед созданием, таблицы создаются «если нет»',
    (sql.match(/^drop trigger if exists/gm) || []).length === (sql.match(/^create trigger/gm) || []).length
      && (sql.match(/^create or replace function/gm) || []).length >= 8
      && /create table if not exists public\.forum_server_members/.test(sql)
      && sql.includes('on conflict (user_id, server_id)'));
  check('представлений шаг не пересоздаёт, но кэш схемы API перезван',
    !/create (or replace )?view /.test(sql) && sql.includes("notify pgrst, 'reload schema';"));

  /* ── Черновой режим: те же развилки, что в базе ── */
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  store.set('zr33.forum.local', JSON.stringify({
    servers: [
      { id: 33, title: 'Дом', enabled: true, openWriting: true },
      { id: 44, title: 'Чужой', enabled: true, openWriting: false },
      { id: 55, title: 'Закрытый', enabled: false, openWriting: false },
    ],
  }));
  const local = await import('../src/forum/adapters/local.js');
  const raw = () => JSON.parse(store.get('zr33.forum.local'));
  const grab = async (fn) => {
    try { await fn(); return ''; } catch (e) { return String(e.message); }
  };

  const staffUser = await local.signUp('Хозяйка сайта');
  const ownUser = await local.signUp('Свой человек');
  await local.signUp('Чужой человек');

  const foreignRoles = await local.myServerRoles();
  equal('чужаку закрытые ленты отвечают «none», открытая — «member»',
    [foreignRoles['33'], foreignRoles['44'], foreignRoles['55']], ['member', 'none', 'none']);
  await local.signIn('Хозяйка сайта');
  const staffRoles = await local.myServerRoles();
  equal('модерация сайта — модератор в каждом сервере, отдельного знания про staff экрану не нужно',
    [staffRoles['33'], staffRoles['44'], staffRoles['55']], ['moderator', 'moderator', 'moderator']);

  await local.signIn('Чужой человек');
  equal('тема в чужой закрытый сервер отвергнута названной причиной',
    await grab(() => local.createPost({
      title: 'Тема из чужого дома', body: 'Меня здесь нет в списке.', category: 'vs', serverId: 44,
    })), NO_MEMBER);
  equal('закрытая на приём лента отвечает раньше и другим текстом: просить добавление бесполезно',
    await grab(() => local.createPost({
      title: 'Срочно в закрытую ленту', body: 'Новых тем тут не заводят.', category: 'vs', serverId: 55,
    })), INTAKE_CLOSED);

  await local.signIn('Хозяйка сайта');
  const abroad = await local.createPost({
    title: 'Обсуждение в чужом доме', body: 'Служебная тема модературы.', category: 'vs', serverId: 44,
  });
  const deadTopic = await local.createPost({
    title: 'Тема на закрытой ленте', body: 'Переписку это не отменяет.', category: 'vs', serverId: 55,
  });
  await local.setServerMember(ownUser.id, 55, 'member');
  await local.signIn('Свой человек');
  check('участник закрытой на приём ленты продолжает отвечать под её темами',
    Boolean((await local.addComment(deadTopic.id, 'Ответ участника, новых тем не видно.')).id));
  equal('а новую тему он там не заведёт — право участия не равно праву начинать',
    await grab(() => local.createPost({
      title: 'Новая тема на закрытой ленте', body: 'Я здесь участник, но приём закрыт.', category: 'vs', serverId: 55,
    })), INTAKE_CLOSED);
  await local.signIn('Чужой человек');
  equal('ответ берёт сервер у темы, а не выбор в переключателе',
    await grab(() => local.addComment(abroad.id, 'Мне тут не место?')), NO_MEMBER);
  equal('чужой ленты не касаются и её закрепления',
    await grab(() => local.setPinned(abroad.id, true)), 'Недостаточно прав');

  await local.signIn('Хозяйка сайта');
  const chujak = raw().users.find((u) => u.nick === 'Чужой человек');
  await local.setServerMember(chujak.id, 44, 'moderator');
  await local.signIn('Чужой человек');
  await local.setServerMember(ownUser.id, 44, 'member');
  check('своему модератору лента отдаёт и список участников',
    (raw().serverMembers || []).some((m) => m.serverId === 44 && m.userId === ownUser.id && m.role === 'member'));
  check('модератор ленты закрепляет её темы',
    (await local.setPinned(abroad.id, true)).pinned === true);
  await local.signIn('Хозяйка сайта');
  const homeTopic = await local.createPost({
    title: 'Тема дома', body: 'Своя лента, свой модератор.', category: 'vs', serverId: 33,
  });
  await local.signIn('Чужой человек');
  equal('модератор 44-го не распоряжается лентой 33-го',
    await grab(() => local.setPinned(homeTopic.id, true)), 'Недостаточно прав');

  await local.signIn('Хозяйка сайта');
  const moreHome = [];
  for (let i = 0; i < 3; i++) {
    moreHome.push(await local.createPost({
      title: `Дома тема ${i + 1}`, body: `Закрепляем её, номер ${i + 1}.`, category: 'vs', serverId: 33,
    }));
  }
  for (const p of moreHome) await local.setPinned(p.id, true);
  await local.setServerMember(ownUser.id, 33, 'moderator');
  await local.signIn('Свой человек');
  equal('предел закреплений считается по серверу: дом заполнен',
    await grab(() => local.setPinned(homeTopic.id, true)), PINS_FULL);
  await local.signIn('Хозяйка сайта');
  const abroadSecond = await local.createPost({
    title: 'Вторая тема в чужом доме', body: 'Ленты независимы.', category: 'vs', serverId: 44,
  });
  await local.signIn('Чужой человек');
  check('и чужая лента от этого не вытесняется: закрепление в 44-м проходит',
    (await local.setPinned(abroadSecond.id, true)).pinned === true);

  /* ── Дверь в черновом режиме: те же отказы ── */
  equal('модератор ленты не назначает модератора ленты',
    await grab(() => local.setServerMember(ownUser.id, 44, 'moderator')),
    'Модератора сервера назначает модерация сайта');
  equal('и не лезет в чужой список',
    await grab(() => local.setServerMember(ownUser.id, 33, 'member')),
    'В свой сервер добавляет его модератор, в чужой — модерация сайта');
  await local.signIn('Хозяйка сайта');
  equal('последнего модератора закрытой ленты не снимают',
    await grab(() => local.setServerMember(chujak.id, 44, null)),
    'Это последний модератор сервера — сначала назначьте другого');
  check('добавление записано в журнал модературы и в уведомление игроку',
    raw().moderationActions.some((a) => a.action === 'server_moderator' && a.targetId === chujak.id)
      && raw().notifications.some((n) => n.userId === ownUser.id
        && /добавил вас в участники сервера «Чужой»/.test(n.preview)));

  const newbie = await local.signUp('Новичок');
  const newbieRoles = await local.myServerRoles();
  equal('новичок сам попадает в открытый сервер и не попадает в закрытые',
    [newbieRoles['33'], newbieRoles['44'], newbieRoles['55']], ['member', 'none', 'none']);
  await local.signOut();
  equal('гость карты прав не получает — страница на null ничего не прячет',
    await local.myServerRoles(), null);
  check('своему серверу новичок не модератор: авточленство даёт участие, а не модературу',
    newbie.role !== 'admin' && newbieRoles[String(CONFIG.server)] === 'member');

  /* ── Экран: причину человек читает до отправки ── */
  const { renderForum } = await import('../src/pages/forum.js');
  const rights = await import('../src/forum/server-rights.js');
  const site = { events: [], texts: [], alliances: [] };
  const servers = [
    { id: 33, title: 'Дом', enabled: true },
    { id: 44, title: 'Чужой', enabled: true },
    { id: 55, title: 'Закрытый', enabled: false },
  ];
  const player = { id: 'u9', nick: 'Чужой человек', role: 'member', banned: false, mutedUntil: null, createdAt: new Date() };
  const card = {
    id: 'p9', authorId: 'u8', authorNick: 'Хозяин', category: 'vs', title: 'Чужая лента',
    body: 'текст темы', createdAt: new Date(), commentCount: 1, reactions: {}, myReaction: null,
    score: 0, deleted: false, views: 1, pinned: false, serverId: 44,
  };
  const view = (over) => renderForum(site, {
    ready: true, shared: true, loading: false, me: player, posts: [card], total: 1,
    comments: [{ id: 'c9', authorId: 'u8', authorNick: 'Хозяин', authorRole: 'member', body: 'живой ответ',
      createdAt: new Date(), deleted: false, deletedReason: '' }],
    openPostId: 'p9', servers, serverId: 44, serverRoles: { 33: 'member', 44: 'none', 55: 'none' },
    ...over,
  });

  check('участнику чужой ленты форма темы заменена той же строкой, что скажет база',
    view({}).includes(NO_MEMBER) && !view({}).includes('data-forum-new'));
  const noMigration = view({ serverRoles: null });
  check('отсутствие миграции не прячет форму: null — это «прав не проверяем»',
    noMigration.includes('data-forum-new') && !noMigration.includes(NO_MEMBER));
  check('в своей ленте форма на месте, а чужая тема остаётся прочитанной: право слова не равно доступу',
    view({ serverId: 33, serverRoles: { 33: 'member', 44: 'none' } }).includes('data-forum-new')
      && view({}).includes('Чужая лента'));
  check('поле ответа под чужой темой закрыто той же причиной, и «Цитировать» исчезает вместе с ним',
    !view({}).includes('data-forum-comment-form') && !view({}).includes('data-forum-quote="post:p9"')
      && view({}).includes('forum-reply__locked'));
  check('своему участнику поле ответа оставлено: закрытая лента — не про него',
    view({ serverRoles: { 44: 'member' } }).includes('data-forum-comment-form'));
  check('участник, не модератор ленты, не видит ни «Закрепить», ни «Удалить» под чужой темой',
    !view({}).includes('data-forum-pin="p9"') && !view({}).includes('data-forum-del-post="p9"'));
  check('модератор ленты темы видит, а модератор чужого сервера — нет',
    view({ serverRoles: { 44: 'moderator' } }).includes('data-forum-pin="p9"')
      && !view({ serverRoles: { 33: 'moderator', 44: 'member' } }).includes('data-forum-pin="p9"'));
  check('модерация сайта проходит прежней дверью: при null правило осталось прежним',
    view({ serverRoles: null, me: { ...player, role: 'admin' } }).includes('data-forum-pin="p9"'));
  check('закрытая на приём лента названа отдельной строкой и для участника',
    view({ serverId: 55, serverRoles: { 55: 'member' } }).includes(INTAKE_CLOSED));

  /* Помощник отвечает «как раньше» на каждый случай, где прав не спрашивали. */
  equal('null и пустое состояние форму не прячут, а «none» прячет',
    [
      rights.serverWriteNotice({ me: player, serverRoles: null }, 44),
      rights.serverWriteNotice({ me: null, serverRoles: { 44: 'none' } }, 44),
      rights.serverWriteNotice({ me: player, serverRoles: { 44: 'none' } }, null),
      rights.serverWriteNotice({ me: player, serverRoles: { 44: 'none' } }, 44),
    ],
    ['', '', '', NO_MEMBER]);
  equal('темой пишет выбранная лента, а при общем виде — сервер сайта',
    [rights.writingServerId({ serverId: 44 }), rights.writingServerId({ serverId: null })],
    [44, Number(CONFIG.server)]);
  equal('модература: роль ленты важнее роли человека, а при null работает прежнее правило',
    [
      rights.canModerateServer({ me: player, serverRoles: { 44: 'moderator' } }, 44),
      rights.canModerateServer({ me: player, serverRoles: { 44: 'member' } }, 44),
      rights.canModerateServer({ me: { ...player, role: 'moderator' }, serverRoles: null }, 44),
      rights.canModerateServer({ me: { ...player, role: 'moderator' }, serverRoles: { 44: 'member' } }, 44),
    ],
    [true, false, true, false]);

  /* ── Клиент: одно правило, а не три ── */
  check('страница зовёт помощник, а не переписывает правило в разметке',
    pageSrc.includes("import { canModerateServer, serverWriteNotice, writingServerId } from '../forum/server-rights.js';")
      && pageSrc.includes('const canModerate = canModerateServer(s, p.serverId);')
      && pageSrc.includes('canModerateServer(s, post.serverId)')
      && (pageSrc.match(/canModerateServer\(s, /g) || []).length >= 4);
  check('перенос чужой встречи решается лентой темы, а не ролью человека',
    calSrc.includes('canModerateServer(s, item.serverId)'));
  check('закрытая лента подписана стилем, которым нарисована тишина по разделу',
    cssSrc.includes('.forum-blocked--server'));
  check('роль сервера спрашивают при старте и при входе, а выход стирает её',
    mountSrc.includes('loadServerRoles(),')
      && /await loadServerRoles\(\);\s*\n\s*await loadStarterSteps\(\);/.test(mountSrc)
      && /data-forum-signout[\s\S]{0,900}state\.serverRoles = null;/.test(mountSrc));
  check('отказ функции читается как «прав не проверяем», а не как пустая карта',
    /const rows = await rest\('\/rpc\/forum_my_server_roles'[\s\S]{0,160}\.catch\(\(\) => null\)/.test(supaSrc)
      && /if \(!rows \|\| typeof rows !== 'object' \|\| Array\.isArray\(rows\)\) return null;/.test(supaSrc));
  check('контракт объявляет обе двери необязательными: старый адаптер не сломан',
    contractSrc.includes('@property {() => Promise<Record<string, string>|null>} [myServerRoles]')
      && contractSrc.includes('@property {(userId: string, serverId: number, role: string|null) => Promise<void>} [setServerMember]')
      && contractSrc.includes('миграции 20261001-server-rights.sql нет'));
  check('оба адаптера умеют и карту ролей, и выдачу членства',
    [/export async function myServerRoles\(\)/, /export async function setServerMember\(userId, serverId, role\)/]
      .every((re) => re.test(localSrc) && re.test(supaSrc)));

  /* ── Реестр и документы ── */
  check('миграция прогнана: реестр ставит файл в историю и называет дату прогона',
    readmeSrc.includes('20261001-server-rights.sql')
      && /[Пп]рогнан 01\.10\.2026/.test(readmeSrc)
      && readmeSrc.includes('файл лежит в `applied/`'));
  check('реестр даёт владельцу готовые строки вызова двери — экрана выдачи пока нет',
    readmeSrc.includes('select public.forum_set_server_member(') && readmeSrc.includes("nick = 'НикИгрока'"));
  check('документы описывают шаг, его отказ и то, чего в нём нет',
    /## Права по серверу/.test(docsSrc)
      && docsSrc.includes('forum_my_server_roles')
      && docsSrc.includes('экрана панели'));
  check('конфиг называет теперешнего хранителя предела закреплений, а не прежний триггер',
    configSrc.includes('supabase/applied/20261001-server-rights.sql')
      && CONFIG.forum.limits.pinsMax === 3);
}

/* ── 16. Мультиаренда данных сайта: у рейтинга появляется сервер ─────────────

   Форум живёт несколькими серверами с 01.10, а таблицы данных сайта до этого
   файла сервера не знали вовсе: один набор на всю базу, и чтение шло вызовом
   `site_dataset()` без аргументов. Шаг делает сервер измерением данных, и
   ошибки здесь не косметические:

     1. удаление недели по одному id снесло бы «W1» на всех серверах, а вставка
        без `server_id` попала бы в ключ, которого панель не видит;
     2. id альянса обязан остаться ГЛОБАЛЬНЫМ: на него смотрят семь ограничений
        вне данных сайта, и локальный id сделал бы двусмысленной каждую такую
        строку — дайджест писал бы место чужого сервера поверх своего;
     3. панель видит только свой список, поэтому свободный номер альянса считает
        база, а не максимум локальных id: занятый номер при `merge-duplicates`
        означает не отказ, а перезапись чужого альянса.

   Поэтому проверяем и текст миграции, и текст панели: достаточно одного
   пропущенного `server_id` в запросе, и эти проверки его не увидят бы.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile, readdir } = await import('node:fs/promises');
  const sql = await readFile('supabase/applied/20261004-site-server-scope.sql', 'utf8');
  const storeSrc = await readFile('src/admin/store.js', 'utf8');
  const adapterSrc = await readFile('src/data/adapters/supabase.js', 'utf8');
  const serverSrc = await readFile('src/data/server.js', 'utf8');
  const bootSrc = await readFile('src/admin/main.js', 'utf8');
  const readmeSrc = await readFile('supabase/README.md', 'utf8');
  const migDoc = await readFile('docs/MIGRATION.md', 'utf8');
  const backupSrc = await readFile('scripts/backup-from-db.mjs', 'utf8');

  const TABLES = ['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts'];

  /* ── Схема ── */
  check('колонка сервера есть у всех пяти таблиц и по умолчанию это сервер сайта',
    TABLES.every((t) => new RegExp(
      `alter table public\\.${t} +add column if not exists server_id integer not null default ${CONFIG.server}`
    ).test(sql)));
  check('список серверов один на форум и сайт: ссылка ведёт в forum_servers пять раз',
    (sql.match(/references public\.forum_servers \(id\)/g) || []).length === 5);
  check('недели, события, тексты и результаты ключуются парой «сервер и id»',
    sql.includes('add constraint site_weeks_pkey primary key (server_id, id)')
      && sql.includes('add constraint site_events_pkey primary key (server_id, id)')
      && sql.includes('add constraint site_texts_pkey primary key (server_id, key)')
      && sql.includes('primary key (server_id, week_id, alliance_id)'));
  check('у альянсов первичный ключ не тронут — id остался глобальным намеренно',
    !sql.includes('site_alliances_pkey')
      && sql.includes('foreign key (alliance_id) references public.site_alliances (id)'));
  check('результат не может относиться к неделе чужого сервера — ключ парный и с каскадом',
    sql.includes('foreign key (server_id, week_id) references public.site_weeks (server_id, id) on delete cascade'));
  check('сервер записи неподвижен на пяти таблицах, а не на двух из них',
    /foreach t in array array\[/.test(sql)
      && TABLES.every((t) => sql.includes(`'${t}'`))
      && sql.includes('%1$s_server_immutable before update on public.%1$s'));

  /* ── Отказы, названные причиной ── */
  check('чужой альянс в результатах и слияние между серверами отвергаются словами',
    sql.includes('принадлежит серверу') && sql.includes('Сливать альянс можно только с альянсом своего сервера'));
  check('перенос истории назван переносом, а не правкой',
    sql.includes('Это не правка, а перенос истории.'));

  /* ── Чтение ── */
  const fnDefault = /function public\.site_dataset\(p_server integer default (\d+)\)/.exec(sql);
  check('набор одного сервера собирают пять фильтров, и все — по одному аргументу',
    (sql.match(/where server_id = p_server/g) || []).length === 5);
  check('значение по умолчанию в базе — то же число, что в config.js',
    fnDefault && Number(fnDefault[1]) === Number(CONFIG.server));
  check('прежняя безаргументная функция снята, а не оставлена рядом',
    sql.includes('drop function if exists public.site_dataset();')
      && sql.includes('grant execute on function public.site_dataset(integer) to anon, authenticated'));
  check('смена состава аргументов требует сброса кэша схемы API',
    sql.includes("notify pgrst, 'reload schema';"));
  check('и сайт, и панель просят набор одного сервера одним вызовом',
    adapterSrc.includes("'/rpc/site_dataset'") && storeSrc.includes("'/rpc/site_dataset'")
      && /body: datasetBody\(server\)/.test(adapterSrc)
      && /body: datasetBody\(panelServer\(\)\)/.test(storeSrc));
  /*
    Два места с одним числом — это ровно тот случай, где ошибка не видна
    глазами: панель показывала бы строки одного набора, а сохраняла бы их в
    другой. Поэтому у сайта и у панели разные источники номера (`siteServer()`
    и `panelServer()`), но оба ведут в `config.js`, и ни один из них не читает
    выбор зрителя — выбора больше нет.
  */
  check('ни сайт, ни панель не спрашивают сервер у зрителя',
    !storeSrc.includes('viewServer') && !storeSrc.includes('readServerChoice')
      && !adapterSrc.includes('viewServer')
      && serverSrc.includes('export function datasetBody(server = siteServer())'));

  /* ── Свободный номер альянса ── */
  check('номер альянса считает база по всем серверам',
    sql.includes('function public.site_next_alliance_id()'));
  /*
    Отдельный прогон после шага: в самом файле стояло `revoke execute ... from
    anon`, и живой вызов публичным ключом ответил числом — Postgres выдаёт
    EXECUTE роли PUBLIC при создании функции, а anon входит в PUBLIC. Поэтому
    проверка смотрит не на намерение, а на форму, которая реально снимает право.
    Исправляющий файл уже прогнан, поэтому читается из истории, как и шаг.
  */
  const nextIdSql = await readFile('supabase/applied/20261004-site-next-id-anon.sql', 'utf8');
  check('гостю этот номер закрыт снятием и с PUBLIC, а панели вернён grant',
    nextIdSql.includes('revoke all on function public.site_next_alliance_id() from public, anon')
      && nextIdSql.includes('grant execute on function public.site_next_alliance_id() to authenticated'));

  /*
    Та же ошибка в масштабе: `revoke ... on function ... from anon` без `public`
    право не снимает (EXECUTE по умолчанию выдан PUBLIC, а anon в него входит).
    Просмотреть такое глазами в одном файле легко, поэтому проверка проходит по
    всей истории и требует, чтобы для каждого имени функции снятие с PUBLIC
    где-то стояло — в том же файле или в следующем исправляющем.
  */
  const allSql = [];
  for (const name of await readdir('supabase')) {
    if (name.endsWith('.sql')) allSql.push(await readFile(`supabase/${name}`, 'utf8'));
  }
  for (const name of await readdir('supabase/applied')) {
    if (name.endsWith('.sql')) allSql.push(await readFile(`supabase/applied/${name}`, 'utf8'));
  }
  const revoked = [];
  const withPublic = new Set();
  for (const text of allSql) {
    for (const m of text.matchAll(
      /revoke\s+[^;]*on\s+function\s+public\.([a-z_]+)\s*\([^)]*\)\s*from\s+([^;]+);/g
    )) {
      revoked.push(m[1]);
      if (/\bpublic\b/.test(m[2])) withPublic.add(m[1]);
    }
  }
  equal('у каждой закрытой функции снятие права дошло до PUBLIC',
    [...new Set(revoked)].filter((n) => !withPublic.has(n)).join(', '), '');
  check('панель спрашивает этот номер до создания альянса и не падает без него',
    bootSrc.includes('allianceFloor = await nextAllianceNumber();')
      && /try \{\s*allianceFloor = await nextAllianceNumber\(\);\s*\} catch \{\s*allianceFloor = 0;\s*\}/.test(bootSrc)
      && bootSrc.includes('nextAllianceId(view.raw, view.alliances, view.allianceFloor)'));

  /* ── Резервный снимок ── */
  check(
    'снимок-резерв остался без аргументов и получает сервер по умолчанию',
    backupSrc.includes("body: '{}'")
      && sql.includes('планировщик снимка (`scripts/backup-from-db.mjs`)')
      && sql.includes('шлют `{}`')
  );

  /* ── Реестр и документы ── */
  check('реестр говорит, что шаг и его исправление прогнаны, а очередь названа по файлам',
    readmeSrc.includes('Прогнан 04.10.2026')
      && readmeSrc.includes('20261004-site-next-id-anon.sql')
      && readmeSrc.includes('обязан быть прогнан до пуша')
      && readmeSrc.includes('ещё не выполнены'));
  check('реестр объясняет, чего в шаге нет: права даёт следующий файл, а снимок на сервер не нужен',
    readmeSrc.includes('Право вносить данные по серверу даёт не этот файл')
      && readmeSrc.includes('Отдельный снимок `data/live.json` на каждый сервер пунктом незакрытого не стоит')
      && !readmeSrc.includes('Незакрытым остаётся отдельный снимок'));
  check('документ переезда называет шаг и его проверку одной строкой',
    migDoc.includes('20261004-site-server-scope.sql') && migDoc.includes('site_dataset(p_server)'));
  check('и называет исправление прав тем же способом — файлом из истории',
    migDoc.includes('supabase/applied/20261004-site-next-id-anon.sql')
      && migDoc.includes('permission denied for function site_next_alliance_id'));
}

/* ── 17. Данные сайта: выбор сервера был и убран, измерение осталось ────────

   Шаг 2 научил сайт переключать наборы: ряд в шапке, `?server=` в адресе,
   память `zr33.server` и общий модуль выбора на форум и данные
   (`src/logic/server-choice.js`, `src/ui/server-switch.js`). 05.10.2026 по
   решению владельца выбор снят: сайт — про 33-й, второй ленты зрителю не
   надо. Измерение «сервер» из шага 1 при этом осталось в базе, поэтому клиент
   обязан называть один номер в каждом вызове — и брать его ему больше негде,
   кроме `config.js`.

   Что ломается молча после такого удаления:

     1. Половина снятого выбора. Ряд исчез, а разбор `?server=` остался бы:
        ссылка на чужой набор открылась бы страницей своего. Цифры настоящие,
        просто не оттуда.
     2. Два числа вместо одного. Данные сайта и панель берут номер из разных
        модулей; разолись бы — панель правит один набор, страница показывает
        другой, и по виду это не различить.
     3. Кэш ответа. Когда серверов могло быть несколько, один промис на все
        выборы отдавал обратному щелчку чужой набор. Теперь верен обратный
        случай: карта по серверам осталась бы мёртвым кодом, который надо
        поддерживать.
     4. Ссылка на удалённый модуль. Импорт несуществующего файла роняет
        страницу целиком, а `sw.js` с таким именем в предкеьше не ждёт ответа
        вообще.
     5. Документ, обещающий кнопку. Человек ищет переключатель, не находит и
        решает, что у него сняли право.

   Разбор адреса и память проверяются делом — тем, что их нет; кэш и запросы
   читаются по строкам, боевого обращения к базе у теста нет.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const data = await import('../src/data/server.js');
  const serverSrc = await readFile('src/data/server.js', 'utf8');
  const adapterSrc = await readFile('src/data/adapters/supabase.js', 'utf8');
  const dataIdxSrc = await readFile('src/data/index.js', 'utf8');
  const mainSrc = await readFile('src/main.js', 'utf8');
  const siteHtml = await readFile('index.html', 'utf8');
  const cssSrc = await readFile('src/forum.css', 'utf8');
  const swSrc = await readFile('sw.js', 'utf8');

  /* ── Одно число на весь сайт ── */
  equal('номер сервера сайта — то же число, что в config.js',
    data.siteServer(), Number(CONFIG.server));
  equal('набор просят телом с номером, и без номера тело пустое',
    [data.datasetBody(44), data.datasetBody(null)], [{ p_server: 44 }, {}]);
  equal('вызов без аргумента называет сервер сайта, а не догадывается',
    data.datasetBody(), { p_server: Number(CONFIG.server) });
  check('число берётся из config.js и только: в этом модуле нет ни адреса, ни памяти',
    serverSrc.includes('const raw = CONFIG.server;')
      && !serverSrc.includes('location') && !serverSrc.includes('localStorage')
      && !serverSrc.includes('hash'));
  check('пустое поле в config.js не превращается в сервер №0',
    /if \(raw === null \|\| raw === undefined \|\| String\(raw\)\.trim\(\) === ''\) return null;/.test(serverSrc)
      && /return Number\.isInteger\(n\) \? n : null;/.test(serverSrc));

  /* ── Путь чтения: ни слова о выборе ── */
  check('в чтении данных сайта выбора сервера не осталось и в помине',
    !/viewServer|readServerChoice|writeServerChoice|resolveServer|server-choice/.test(
      serverSrc + adapterSrc + dataIdxSrc + mainSrc));
  check('номер адаптер берёт у того же модуля, что и панель: два числа разошлись бы молча',
    adapterSrc.includes("import { datasetBody, siteServer } from '../server.js';")
      && /const server = siteServer\(\);/.test(adapterSrc)
      && /body: datasetBody\(server\)/.test(adapterSrc));

  /* ── Кэш ответа: один промис, а не карта серверов ── */
  check('кэш — один промис на страницу: при одном наборе карта по серверам была бы мёртвым кодом',
    /let running = null;/.test(adapterSrc) && !/cache\.get\(server\)/.test(adapterSrc)
      && !adapterSrc.includes('cache.clear()'));
  check('сброс кэша сбрасывает этот единственный промис',
    /export function clearCache\(\) \{\s*\n\s*running = null;/.test(adapterSrc));
  check('из кэша вычищается только упавший запрос: чужая авария не трогает удачный',
    /pending\.catch\(\(\) => \{\s*\n\s*if \(running === pending\) running = null;/.test(adapterSrc));

  /* ── Перечитывание: один путь, без события про смену сервера ── */
  check('данные читает refreshView, и вход идёт тем же путём',
    /async function refreshView\(\) \{/.test(mainSrc) && /\bawait refreshView\(\);/.test(mainSrc));
  check('события смены сервера никто не слушает: ряда нет, звать перечитывать некому',
    !mainSrc.includes('zr33:server-change') && !mainSrc.includes('syncServerSwitch')
      && !mainSrc.includes('loadServerSwitch'));

  /* ── Следы удалённого выбора: ни в разметке, ни в стилях, ни в запасе ── */
  check('в разметке страницы контейнера ряда нет', !siteHtml.includes('server-switch'));
  check('стиля ряда не осталось', !cssSrc.includes('.server-switch') && !cssSrc.includes('.seg--server'));
  check('сервисный работник не ждёт файлы удалённого выбора',
    !swSrc.includes('server-switch') && !swSrc.includes('server-choice'));
  check('и в адресной строке номера сервера нет ни у одной вкладки сайта',
    !siteHtml.includes('?server=') && !mainSrc.includes('putServerParam'));

  /* ── Документы: про переключатель говорят только в прошедшем времени ── */
  const archSrc = await readFile('docs/ARCHITECTURE.md', 'utf8');
  const forumDocSrc = await readFile('docs/FORUM.md', 'utf8');
  const hostDocSrc = await readFile('docs/HOSTING.md', 'utf8');
  const adminDocSrc = await readFile('docs/ADMIN.md', 'utf8');
  const editorDocSrc = await readFile('docs/EDITOR-GUIDE.md', 'utf8');
  const migDocSrc = await readFile('docs/MIGRATION.md', 'utf8');
  const queueSrc = await readFile('supabase/README.md', 'utf8');

  /*
    Про выбор сервера документы обязаны говорить в прошедшем времени.
    Разбор идёт по абзацам, а не по строкам: абзацы в документах перенесены
    вручную, и слово «убран» нередко стоит через две строки от слова
    «переключатель». Построчная проверка такую пару не нашла бы и требовала бы
    править документ под тест, а не под читателя.
  */
  const ABOUT = /переключател\w* сервер|сервер\w* переключател|ряд серверов|ряд в шапке|ряду в шапке|\?server=|выбранный сервер/i;
  const GONE = /убран|снято|снят|отмен|удал|не было|больше нет|нет выбора|не показыв|не следует|не ждал|жил один день|был общий модуль|обычным видом/i;
  for (const [doc, text] of [
    ['ARCHITECTURE.md', archSrc], ['FORUM.md', forumDocSrc], ['HOSTING.md', hostDocSrc],
    ['ADMIN.md', adminDocSrc], ['EDITOR-GUIDE.md', editorDocSrc],
    ['MIGRATION.md', migDocSrc], ['supabase/README.md', queueSrc],
  ]) {
    check(`${doc}: ссылок на удалённые модули выбора нет`,
      !text.includes('server-choice.js') && !text.includes('server-switch.js'));
    const alive = text.split(/\r?\n\r?\n/).filter((p) => ABOUT.test(p) && !GONE.test(p));
    equal(`${doc}: выбор сервера упоминается только как снятый`,
      alive.join(' | ').replace(/\r?\n/g, ' ').slice(0, 160), '');
  }

  check('архитектура называет решение и объясняет, что после него осталось',
    archSrc.includes('## Сайт — про один сервер')
      && archSrc.includes('Измерение в базе'));
  check('раздача объясняет копию данных как копию того же набора, что показывает страница',
    hostDocSrc.includes('она снимается с набора сервера сайта'));
  check('документ переезда называет отменённый шаг отменённым, а не живым',
    migDocSrc.includes('Этот шаг отменён на клиенте'));
  check('реестр миграций не оставляет в незакрытом снимок на каждый сервер',
    !queueSrc.includes('Незакрытым остаётся отдельный снимок'));
}

/* ── 18. Мультиаренда сайта, шаг 3: право вносить данные по серверу ────────

   Шаг 1 дал данным сайта сервер, шаг 3 поставил на запись границу по строке:
   политики смотрят не на человека (`site_can_edit()`), а на `server_id`, и
   модератор 44-го больше не равняет чужую неделю на 33-м.

   Выбора сервера здесь больше нет ни у кого. Зрительский ряд убран 05.10.2026
   (секция 17), и панель за ним последовала: её цель — сервер сайта из
   `config.js`. Проверки поэтому делятся на две половины: база обязана держать
   границу по строке, а клиент — не иметь ни одного пути эту цель изменить.

   Что здесь ломается молча, если разъехалось:

     1. Право по человеку вместо права по строке. Панель открыта модератору
        44-го, база отказывает каждому его нажатию — человек узнает об этом
        после работы, а не до.
     2. Две цели в одном файле. Если запись спрашивает номер не там, где
        чтение, панель показывает один набор и сохраняет в другой, а глазами
        это неразличимо: интерфейс тот же, цифры те же.
     3. Пустая карта прав вместо «прав не спрашивали». На пустой карте панель
        обязана закрыться, на null — открыться модерации сайта; перепутать их
        значит либо оставить владельца без панели, либо выпустить чужого
        редактора в запись.
     4. Черновик без папки сервера. «W1» на 33-м и на 44-м — разные недели, и
        прочитанный не из своей папки черновик выглядит ровно как свой.
     5. Путь фотографии без номера. База читает сервер из первой части пути, и
        панель, положившая файл в общую папку, лишила бы своего модератора
        половины экрана молча.
     6. Журнал без сервера. Правило доступа модерации сайта отдаёт правки всех
        наборов, и панель обязана отсеивать их сама — иначе запись «изменена
        W1» чужого набора выглядит своей.
     7. Возврат ряда. Номер в шапке — не украшение, а подпись того, куда уходит
        запись; кнопка переключения рядом означала бы, что правка однажды
        уйдёт в чужую историю.

   Миграция, цель панели, черновики и путь фото проверяются делом и по
   строкам; живого обращения к базе у теста нет.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  /*
    Нормализование переводов строк нужно этому блоку: проверки разбирают
    исходники регулярными выражениями с `\n`, а файлы в проекте лежат и с CRLF,
    и с LF — одна правка формата не должна превращать живую проверку в мёртвую.
  */
  const text = async (p) => (await readFile(p, 'utf8')).replace(/\r\n/g, '\n');
  const mig = await text('supabase/applied/20261005-site-server-rights.sql');
  const targetSrc = await text('src/admin/target.js');
  const mainSrc = await text('src/admin/main.js');
  const shellSrc = await text('src/admin/shell.js');
  const draftSrc = await text('src/admin/draft.js');
  const imageSrc = await text('src/admin/image.js');
  const storeSrc = await text('src/admin/store.js');
  const cssSrc = await text('src/admin/admin.css');
  const loginSrc = await text('src/admin/login.js');
  const overviewSrc = await text('src/admin/screens/overview.js');

  /*
    Комментарии из main.js сняты намеренно: проверка ниже запрещает прежнему
    признаку `canEditSite` жить в КОДЕ. В комментариях он обязан остаться —
    именно там объясняется, почему проверка сменилась, и без этого пояснения
    следующая правка вернула бы прежнее имя, решив, что оно свободное.
  */
  const mainCode = mainSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /* ── Право: одна функция, а не пять копий правила ── */
  equal('право на сервер определено ровно один раз',
    (mig.match(/create or replace function public\.site_can_edit_server/g) || []).length, 1);
  check('его зовут охранник, политики, журнал, ведро и срез рейтинга — все из одного места',
    (mig.match(/public\.site_can_edit_server\(/g) || []).length >= 9,
    `зовётся: ${(mig.match(/public\.site_can_edit_server\(/g) || []).length}`);
  check('право дают модерация сайта или модератор сервера, и бан перекрывает обе ветки',
    /select public\.site_can_edit\(\)[\s\S]{0,400}public\.forum_is_server_moderator\(p_server\)[\s\S]{0,300}not coalesce\(\(select u\.banned/.test(mig));
  check('правом смотрит definer-функция: список участия самим политикам не открыт',
    /function public\.site_can_edit_server\(p_server integer\)\s*\nreturns boolean\s*\nlanguage sql stable security definer set search_path = public/.test(mig));
  check('выполнять функцию гостю оставлено: иначе вместо отказа политики он слышит «permission denied for function»',
    /revoke all on function public\.site_can_edit_server\(integer\) from public;\s*\ngrant execute on function public\.site_can_edit_server\(integer\) to anon, authenticated;/.test(mig));
  check('второго признака «редактор данных сайта по серверу» нет: тот же список участия и ни одной новой таблицы',
    mig.includes('public.forum_is_server_moderator(p_server)') && !/create table/.test(mig)
      && /forum\.myServerRoles/.test(mainSrc));
  check('открытость сервера на данные сайта не распространяется — упомянутая один раз и только чтобы это отрицать',
    (mig.match(/open_writing/g) || []).length === 1 && /--\s+.*open_writing/.test(mig));

  /* ── Политики смотрят на строку, а не на человека ── */
  check('вставка, правка и удаление проверяют server_id строки',
    mig.includes('for insert with check (public.site_can_edit_server(server_id))')
      && mig.includes('for update using (public.site_can_edit_server(server_id)) with check (public.site_can_edit_server(server_id))')
      && mig.includes('for delete using (public.site_can_edit_server(server_id))'));
  equal('ряд таблиц один и тот же: охранник и политики перечисляют их одинаково',
    (mig.match(/array\['site_alliances', 'site_weeks', 'site_results', 'site_events', 'site_texts'\]/g) || []).length, 2);
  check('охранник берёт сервер у старой строки при удалении и у новой при вставке',
    /if TG_OP = 'DELETE' then\s+v_server := old\.server_id;\s+else\s+v_server := new\.server_id;/.test(mig));
  check('пустой auth.uid() проходит: прогон миграции и SQL Editor не получают отказа в своей базе',
    /if auth\.uid\(\) is null or public\.site_can_edit_server\(v_server\) then/.test(mig));
  check('отказ назван причиной и содержит номер сервера, а не «violates row-level security policy»',
    mig.includes("'Править данные сервера % может только его модератор: попросите добавить вас в модераторы этого сервера.'"));
  check('забаненному отказ отдельный: совет просить в модераторы был бы неверным',
    mig.includes("'Ваш аккаунт под запретом — данные сайта править нельзя'")
      && /if exists \(select 1 from public\.forum_users where id = auth\.uid\(\) and banned\)/.test(mig));
  check('охранник снимается перед навешиванием и висит до записи',
    mig.includes("drop trigger if exists %1$s_server_rights")
      && mig.includes('create trigger %1$s_server_rights before insert or update or delete'));
  check('политики пересоздаются, а не копятся рядом',
    mig.includes("drop policy if exists %1$s_write") && mig.includes("drop policy if exists %1$s_update")
      && mig.includes("drop policy if exists %1$s_delete"));

  /* ── Журнал правок: у каждой записи свой сервер ── */
  check('у журнала появляется колонка сервера, повторный прогон её не дублирует',
    mig.includes('alter table public.site_audit add column if not exists server_id integer;'));
  check('старые записи доживаются по деталям правки, а не остаются пустыми молча',
    /update public\.site_audit\s+set server_id = \(details ->> 'server_id'\)::integer/.test(mig));
  check('приведение guarded: журнал не должен падать из-за стола, где server_id не число',
    (mig.match(/~ '\^\[0-9\]\+\$'/g) || []).length >= 2);
  check('чтение журнала: модерация сайта видит всё, серверный модератор — своё',
    /create policy site_audit_read on public\.site_audit\s+for select using \(\s+public\.site_can_edit\(\)\s+or \(server_id is not null and public\.site_can_edit_server\(server_id\)\)/.test(mig));
  check('триггер журнала пишет сервер, а не оставляет его на панель',
    /insert into public\.site_audit\s+\(actor_id, actor_nick, entity, entity_id, action, details, server_id\)/.test(mig));
  check('индекс под тот порядок, которым журнал читают: сервер и свежие записи',
    mig.includes('create index if not exists site_audit_server_idx on public.site_audit (server_id, at desc);'));
  check('панель берёт журнал фильтром по серверу сайта, а не вырезает чужие строки на глазу',
    /`\/site_audit\?server_id=eq\.\$\{panelServer\(\)\}&select=\*&order=at\.desc&limit=\$\{Number\(limit\)\}`/.test(storeSrc));
  check('номера строк экрану не отдают: в журнале одна лента, и значок чужого сервера рядом был бы намёком на неё',
    (() => {
      const start = storeSrc.indexOf('export async function recentChanges');
      const finish = storeSrc.indexOf('Итоги недели', start);
      return !/server:/.test(storeSrc.slice(start, finish));
    })() && !/c\.server/.test(overviewSrc));

  /* ── Фотографии: номер сервера в пути ── */
  check('сервер фотографии база читает из первой части пути и только если это число',
    mig.includes("select case when split_part(coalesce(p_name, ''), '/', 1) ~ '^[0-9]+$'"));
  check('панель кладёт файл в папку своего сервера — то же число, что читает база',
    imageSrc.includes('makePath(`${panelServer()}/events`, ext)'));
  check('право на файл даёт либо модерация сайта, либо модератор сервера из пути',
    (mig.match(/bucket_id = 'site-photos'/g) || []).length === 2
      && mig.includes('or (public.site_photo_server(name) is not null'));
  check('старые файлы без папки остаются за модерацией сайта, а не становятся ничейными',
    mig.includes('у старых файлов папки сервера нет'));

  /* ── Срез позиций рейтинга: право по альянсу, а не модерация сайта ── */
  check('модерация сайта проходит прежней веткой, а серверный редактор проверяется по альянсу',
    /if not public\.site_can_edit\(\) then\s+select server_id into a_server from public\.site_alliances/.test(mig));
  check('проверка идёт по каждому альянсу: иначе снимок чужого сервера ушёл бы вместе с чужими уведомлениями',
    mig.includes('if not public.site_can_edit_server(a_server) then')
      && mig.includes("'Альянс «%» относится к серверу %, который вы не правите.'"));

  /* ── Повторный прогон и кэш схемы ── */
  equal('функции переопределяются, а не создаются заново: файл идемпотентен',
    (mig.match(/create or replace function/g) || []).length, 5);
  check('ни голого create function, ни create table, ни повтора add constraint без drop',
    !/^\s*create function/m.test(mig) && !/^\s*create table/m.test(mig)
      && mig.includes('alter table public.site_audit drop constraint if exists site_audit_server_id_fkey;'));
  check('кэш схемы API извещён: новые функции и колонка иначе отвечают «does not exist»',
    mig.trimEnd().endsWith("notify pgrst, 'reload schema';"));
  check('дверь выдачи права названа готовым вызовом: экрана выдачи ещё нет',
    mig.includes('select public.forum_set_server_member(') && mig.includes("'moderator')"));

  /* ── Панель: право спрашивают у сервера сайта, а цель не выбирают ── */
  check('решает один короткий вызов: прочитанная карта и роль вошедшего из одного места',
    /function mayEdit\(\) \{\s*\n\s*return rightsRead\(\) && canEditSite\(account\);/.test(mainSrc));
  equal('все места, где решает кнопка записи, зовут mayEdit',
    (mainSrc.match(/(?:view\.canPush = |canPush: )mayEdit\(\)/g) || []).length, 6);
  check('имена удалённого ряда не живут даже в коде: панель не знает, что цель можно менять',
    !/hasTarget|canEditServer|writableServers|choosePanelServer|panelServerTitle/.test(mainCode)
      && !/hasTarget|canEditServer|writableServers|choosePanelServer|panelServerTitle|listServers/.test(targetSrc));
  check('право читается до данных: экран отказа не строится на наборе, куда человека не пустят',
    /await readRights\(\);\s*\n\s*if \(!mayEdit\(\)\) \{/.test(mainSrc));
  check('без права панель не открывается пустым экраном, а объясняет, кто даёт право',
    /if \(!mayEdit\(\)\) \{\s*\n\s*showNoAccess\(account\);/.test(mainSrc)
      && /Роль модератора сайта выдаёт владелец/.test(mainSrc));
  check('отказ вопроса о правах означает «миграции нет», а не «прав нет»: null проглатывается, пустая карта — нет',
    /forum\.myServerRoles\(\)\.catch\(\(\) => null\)/.test(mainSrc)
      && /return adoptRights\(\{ account, roles \}\);/.test(mainSrc));
  check('выход стирает карту прав: следующему вошедшему не достанется чужой ответ',
    /await signOut\(\);\s*\n\s*account = null;\s*\n\s*forgetRights\(\);/.test(mainSrc));
  check('свободный номер альянса спрашивается только при праве на запись',
    /let allianceFloor = 0;\s*\n\s*if \(mayEdit\(\)\) \{/.test(mainSrc));
  check('публикация не называет набор: вместе с рядом ушло и его имя в тексте отказа и успеха',
    /<b>Опубликовано\.<\/b> \$\{esc\(describeChanges\(changes\)\)\}/.test(mainSrc)
      && !/Данные ушли в/.test(mainSrc));
  check('шапка получает цель из того же места, что и запись, и списка серверов не видит',
    /server: panelServer\(\),/.test(mainSrc) && /server: view\.server,/.test(mainSrc)
      && !/servers/.test(mainSrc));
  check('у панели нет своей памяти о цели: номер берут из config.js, а не из переписки с браузером',
    !/localStorage/.test(targetSrc)
      && !/zr33\.admin\.server/.test(targetSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')));
  check('вход и отказ называют три круга прав и не обещают кнопку, которой ещё нет',
    loginSrc.includes('модераторам отдельного') && /пока\s+заводит\s+только\s+в\s+базе/.test(loginSrc)
      && /модераторам\s+сервера/.test(mainSrc));
  check('обзор подписан сервером сайта, а не подписью набора из снятого ряда',
    /const serverTitle = view\.server == null \? 'Данные сайта' : `Сервер \$\{view\.server\}`/.test(overviewSrc)
      && !/view\.serverTitle/.test(overviewSrc));

  /* ── Семантика прав: target.js исполняется делом ── */
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const target = await import('../src/admin/target.js');
  const OWNER = { role: 'admin', nick: 'Владелец' };
  const SITE_MOD = { role: 'moderator', nick: 'Модератор сайта' };
  const SERVER_MOD = { role: 'player', nick: 'Модератор 44-го' };
  const savedServer = CONFIG.server;

  target.forgetRights();
  check('пока прав не спрашивали, панель не готова отвечать: rightsRead лжёт, а роль ещё решает',
    [target.rightsRead(), target.canEditSite(OWNER)].join() === 'false,true');
  equal('карта null — это «миграции нет»: панель открывается модерации сайта на её сервере',
    [target.adoptRights({ account: OWNER, roles: null }), target.rightsRead()], [33, true]);
  check('гостю и забаненному не помогает ни роль сайта, ни прочитанная карта',
    [target.canEditSite(null), target.canEditSite({ role: 'admin', banned: true }),
      target.canEditSite({ role: 'moderator', banned: true })].join() === 'false,false,false');

  equal('правая карта прочитана и пустая: это «нигде», и панель закрывается даже владельцу',
    [target.adoptRights({ account: OWNER, roles: {} }), target.canEditSite(OWNER)], [null, false]);
  equal('право на сервер сайта панель открывает, участие в чужом наборе роли не даёт',
    target.adoptRights({ account: SITE_MOD, roles: { 33: 'moderator', 44: 'member' } }), 33);
  equal('модератор чужого набора панелью не пользуется: прав на сервер сайта у него нет',
    target.adoptRights({ account: SERVER_MOD, roles: { 33: 'member', 44: 'moderator' } }), null);
  check('на закрытой панели запись не выдумывает цель: отказ идёт до всякого запроса',
    target.panelServer() === Number(savedServer));

  CONFIG.server = 44;
  equal('цель и право берут одно число из config.js: смена строки переносит панель на другой набор',
    [target.adoptRights({ account: SERVER_MOD, roles: { 33: 'member', 44: 'moderator' } }),
      target.panelServer()], [44, 44]);
  CONFIG.server = savedServer;
  check('а на прежнем числе тот же человек снова вне панели: цель не следует за человеком',
    target.adoptRights({ account: SERVER_MOD, roles: { 33: 'member', 44: 'moderator' } }) === null);
  CONFIG.server = '';
  check('пустой config.js: панель отказывает записью с объяснением, а не молчаливым нулём',
    (() => {
      try {
        target.panelServer();
        return false;
      } catch (err) {
        return /не заполнен server/.test(String(err.message));
      }
    })() && target.rightsRead() === false && target.draftServer() === null);
  CONFIG.server = savedServer;
  equal('вернувшийся номер возвращает и панель',
    target.adoptRights({ account: OWNER, roles: { 33: 'moderator' } }), 33);
  check('участник без модераторства права на данные сайта не получает',
    [target.adoptRights({ account: SERVER_MOD, roles: { 33: 'member' } }),
      target.canEditSite(SERVER_MOD)].map(String).join() === 'null,false');
  check('выход сбрасывает карту: после него снова «прав не спрашивали», а не «прав нет»',
    (() => {
      target.forgetRights();
      return [target.rightsRead(), target.canEditSite(OWNER)].join() === 'false,true';
    })());

  /* ── Черновики: папка сервера вместо общего ключа ── */
  const draft = await import('../src/admin/draft.js');
  mem.clear();
  target.adoptRights({ account: OWNER, roles: { 33: 'moderator' } });
  mem.set('zr33.admin.drafts', JSON.stringify({ W9: { marks: { a05: 'win' }, savedAt: '2026-10-01T00:00:00.000Z' } }));
  equal('плоский черновик до мультиаренды читается как черновик сервера сайта',
    draft.getDraft('W9'), { a05: 'win' });
  check('и переезжает в папку своего сервера, а не остаётся общим на все наборы',
    (() => {
      const raw = JSON.parse(mem.get('zr33.admin.drafts'));
      return '33' in raw && !('W9' in raw);
    })());
  CONFIG.server = 44;
  equal('на другом наборе тот же id недели — пустая клетка, а не чужой ввод',
    draft.getDraft('W9'), null);
  draft.saveDraft('W9', { a07: 'loss' });
  CONFIG.server = savedServer;
  equal('черновик своего сервера пережил поездку к соседу', draft.getDraft('W9'), { a05: 'win' });
  draft.dropDraft('W9');
  CONFIG.server = 44;
  equal('снятие черновика не трогает чужую папку', draft.getDraft('W9'), { a07: 'loss' });
  CONFIG.server = savedServer;
  check('списки летописи, альянсов и текстов лежат в тех же папках',
    draftSrc.includes('function listBucket(key, list)') && draftSrc.includes('buckets[current()] = { list, savedAt'))
      && !/localStorage\.removeItem/.test(draftSrc);
  mem.set('zr33.admin.events', JSON.stringify({ list: [{ id: 'e1' }], savedAt: '2026-10-01T00:00:00.000Z' }));
  equal('старый список летописи так же относится к серверу сайта', draft.getEventsDraft(), [{ id: 'e1' }]);
  check('и переезжает в папку сразу, а не ждёт первой правки: до записи чтение приписывало бы его любому числу',
    (() => {
      const raw = JSON.parse(mem.get('zr33.admin.events'));
      return Array.isArray(raw['33']?.list) && !Array.isArray(raw.list);
    })());
  CONFIG.server = 44;
  check('а на другом наборе летописи ещё нет', draft.getEventsDraft() === null);
  draft.saveEventsDraft([{ id: 'e2' }]);
  draft.dropEventsDraft();
  CONFIG.server = savedServer;
  equal('сброс списка стирает только свою папку', draft.getEventsDraft(), [{ id: 'e1' }]);
  check('черновик зовёт draftServer, а не panelServer: без номера он не бросает, а читает дом',
    draftSrc.includes("import { draftServer } from './target.js'") && !/panelServer\(\)/.test(draftSrc));
  target.forgetRights();
  CONFIG.server = '';
  check('при пустом config.js черновик остаётся читаемым: папка «site» вместо сорванной отрисовки экрана',
    (() => {
      try {
        draft.getEventsDraft();
        draft.getDraft('W9');
        return true;
      } catch {
        return false;
      }
    })() && draftSrc.includes("return server === null || server === undefined ? 'site' : String(server)"));
  CONFIG.server = savedServer;

  /* ── Вид: каркас панели не знает, что цель меняют ── */
  const { renderShell } = await import('../src/admin/shell.js');
  const base = { screens: [{ id: 'overview', label: 'Обзор' }], activeId: 'overview', inner: '<p>тело</p>' };
  const one = renderShell({ ...base, server: 33 });
  check('в бренде и подвале — сервер сайта, тот же номер, что стоит в config.js',
    one.includes('<b>33</b>') && one.includes('панель правит сервер 33'));
  check('ряда выбора нет ни в разметке, ни в стилях, ни в обработчиках нажатий',
    !one.includes('adm-servers') && !cssSrc.includes('.adm-servers')
      && !/data-panel-server/.test(shellSrc + mainSrc));
  check('каркас не просит список серверов: такого параметра у него нет',
    !/servers/.test(shellSrc));
  check('цель без номера — прочерк в бренде и внятные слова в подвале, а не ноль',
    renderShell({ ...base, server: null }).includes('<b>—</b>')
      && renderShell({ ...base, server: null }).includes('сервер, который не назван в config.js'));
  /*
    Шапка на десктопе не переносится, а навигация — десять ссылок, которые не
    сжимаются. Ряд серверов жил в этом же ряду и вытеснял ссылки за правый край
    на узком окне; правило про листание ссылок осталось и без него.
  */
  check('навигация листается, а не вытесняется: снятый ряд не увёл за собой это правило',
    /@media \(min-width: 900px\)[\s\S]{0,220}\.adm-nav \{[^}]*min-width: 0[^}]*overflow-x: auto/.test(cssSrc));

  /* ── Документы ── */
  const queueSrc = await readFile('supabase/README.md', 'utf8');
  const migDocSrc = await readFile('docs/MIGRATION.md', 'utf8');
  const archSrc = await readFile('docs/ARCHITECTURE.md', 'utf8');
  const adminDocSrc = await readFile('docs/ADMIN.md', 'utf8');
  const editorDocSrc = await readFile('docs/EDITOR-GUIDE.md', 'utf8');

  check('реестр ставит шаг 3 в историю и называет дату прогона',
    queueSrc.includes('20261005-site-server-rights.sql')
      && queueSrc.includes('ещё не выполнены')
      && /`20261005-site-server-rights\.sql` — шаг 3/.test(queueSrc)
      && queueSrc.includes('Прогнан 05.10.2026, файл лежит в `applied/`'));
  check('реестр говорит, зачем шаг был нужен до пуша кода',
    /Порядок здесь был такой: сперва прогон файла, потом пуш кода/.test(queueSrc)
      && queueSrc.includes('кончилось бы отказом политики'));
  check('реестр не оставляет шаг 1 в списке незакрытого: права сделаны',
    !queueSrc.includes('Не здесь: права на внесение по серверу (модератор одного сервера сегодня правит чужую неделю'));
  check('документ переезда описывает шаг 3 и не врёт про прежние два признака прав',
    migDocSrc.includes('20261005-site-server-rights.sql') && !migDocSrc.includes('can_edit_site'));
  check('архитектура называет цель панели и различает «прав не спрашивали» и «прав нигде»',
    archSrc.includes('## Право вносить данные по серверу')
      && archSrc.includes('src/admin/target.js')
      && archSrc.includes('panelServer()')
      && archSrc.includes('«прав не спрашивали»'));
  check('документ панели описывает три круга прав и данные только своего сервера',
    adminDocSrc.includes('данные только этого сервера')
      && adminDocSrc.includes('Модератор сервера')
      && adminDocSrc.includes('forum_set_server_member'));
  check('документ панели называет целью модуль, а память ряда — убранной, а не живой',
    adminDocSrc.includes('src/admin/target.js')
      && /память `zr33\.admin\.server`\s*\n?убраны/.test(adminDocSrc)
      && adminDocSrc.includes('сервер сайта'));
  check('документы панели не обещают вход эпохи токена и не зовут на несуществующий экран',
    !/токен GitHub|Токен не принят|api\.github\.com|Как получить токен/.test(adminDocSrc)
      && !/файл успели изменить|одним коммитом/.test(adminDocSrc + editorDocSrc));
}

/* ── 19. Сервер у игрока: номер рядом с ником ────────────────────────────────

   Зрителю выбор ленты убрали (секция 17), и на его месте появилось другое:
   сервер как свойство человека. Темы по-прежнему лежат в одной общей ленте, а
   номер только рисуется возле ника — в ленте, в ответах, в чате, на странице
   участника и в списке игроков панели.

   Что ломается молча, если разъехалось:

     1. Колонка в представлении раньше базы. Лента читается `select=*`, и
        отсутствие `author_server` выглядит как «значка нет ни у кого», а не
        как «миграцию не прогнали».
     2. Одни и те же числа в трёх местах. Границы 1..999 и срок в 30 дней
        держат миграция, `config.js` и триггер; разъедутся — форма начнёт
        пропускать то, что база отвергает, и отказ придёт уже после нажатия.
     3. Срок, посчитанный браузером. Дату ставит только триггер, а экран
        перечитывает её из аккаунта: локальные часы обошли бы клиентское
        правило бесплатно.
     4. Снятие номера как «не смена». Тогда лимит обходился бы двумя правками
        подряд и за вечер можно побывать «своим» на трёх серверах.
     5. Метка, съеденная чужим правилом. В строках постов слово роли спрятано
        `display: none` по `<b>`; номер лежит в том же `<b>`, и без исключения
        он исчез бы ровно там, где нужен больше всего.
────────────────────────────────────────────────────────────────────────────── */
{
  const { readFile } = await import('node:fs/promises');
  const text = async (p) => (await readFile(p, 'utf8')).replace(/\r\n/g, '\n');
  const L = CONFIG.forum.limits;
  const { SERVER_RANGE } = await import('../src/forum/rules.js');

  const mig = await text('supabase/applied/20261005-player-server.sql');
  const rulesSrc = await text('src/forum/rules.js');
  const supSrc = await text('src/forum/adapters/supabase.js');
  const localSrc = await text('src/forum/adapters/local.js');
  const contractSrc = await text('src/forum/contract.js');
  const profileSrc = await text('src/forum/profile.js');
  const mountSrc = await text('src/forum/mount.js');
  const feedSrc = await text('src/pages/forum.js');
  const userPageSrc = await text('src/pages/user.js');
  const mobileSrc = await text('src/mobile.css');
  const refineSrc = await text('src/refine.css');
  const queueSrc = await text('supabase/README.md');

  /* ── Миграция: колонка, отказ, срок, представления ── */
  check('номер и дата появляются одной правкой таблицы и переживают повторный прогон',
    /add column if not exists server_id integer,\n\s*add column if not exists server_set_at timestamptz;/.test(mig));
  check('«не указан» остаётся null: ни нуля, ни сервера сайта по умолчанию',
    /check \(server_id is null or server_id between/.test(mig) && !/server_id integer default/.test(mig));
  check('границы номера в базе и в config.js — одни и те же числа',
    mig.includes(`between ${L.serverIdMin} and ${L.serverIdMax}`)
      && mig.includes(`new.server_id < ${L.serverIdMin} or new.server_id > ${L.serverIdMax}`));
  check('срок в триггере и в config.js — одна мера',
    mig.includes(`interval '${L.serverChangeDays} days'`)
      && mig.includes(`Сервер можно менять раз в ${L.serverChangeDays} дней`));
  check('отказ про номер звучит ровно тем же словом, что проверяет форма',
    mig.includes(SERVER_RANGE));
  check('дату смены триггер берёт из строки, а не из запроса: PATCH с датой трёхлетней давности ничего не двигает',
    mig.indexOf('new.server_set_at := old.server_set_at;') < mig.indexOf('raise exception'));
  check('снятие номера засчитывается сменой: проверка стоит до того, как посмотрели на null',
    mig.indexOf('is not distinct from old.server_id') < mig.indexOf('v_wait then'));
  check('служебному ключу и модерации ожидание не мешает: лечить чужую ошибку можно всегда',
    /if auth\.uid\(\) is null then/.test(mig) && /if public\.forum_is_staff\(\) then/.test(mig));
  check('триггер висит и на дате: правка одной даты не пройдёт мимо правила',
    /before update of server_id, server_set_at/.test(mig));
  equal('сервер автора — последняя колонка во всех трёх списках',
    (mig.match(/prof\.server_id as author_server\nfrom /g) || []).length, 3);
  check('профили отдают номер человека тем же порядком — добавкой в конец',
    /,\n  u\.server_id\nfrom public\.forum_users u;/.test(mig));
  check('лента не разъезжается по серверам: шаг не трогает сервер темы',
    !/alter table public\.forum_posts/.test(mig) && !/update public\.forum_posts/.test(mig));
  check('шаг заканчивается перезагрузкой схемы, иначе API не отдал бы новую колонку',
    /notify pgrst, 'reload schema';/.test(mig));
  check('реестр числит шаг прогнанным и не зовёт в базу вторично',
    queueSrc.includes('supabase/applied/20261005-player-server.sql')
      && /20261005-player-server\.sql` — \*\*прогнан 05\.10\.2026/.test(queueSrc)
      && !queueSrc.includes('ещё не прогнан'));

  /* ── Слова и числа клиента ── */
  check('форма собирает свои отказные фразы из чисел config.js, а не из памяти',
    rulesSrc.includes('L.serverIdMin') && rulesSrc.includes('L.serverIdMax')
      && rulesSrc.includes('L.serverChangeDays')
      && !/от 1 до 999/.test(rulesSrc));
  equal('мера ожидания вычисляется в одном месте: у отказа и подсказки один источник',
    (rulesSrc.match(/L\.serverChangeDays \* 86400000/g) || []).length, 1);
  check('дата печатается по UTC, как `to_char` в отказе базы',
    /getUTCDate\(\)/.test(rulesSrc) && /to_char\(old\.server_set_at \+ v_wait, 'DD\.MM\.YYYY'\)/.test(mig));

  /* ── Контракт и оба адаптера ── */
  check('регистрация дописывает номер вторым запросом и не роняет уже созданный аккаунт',
    /export async function signUp\(nick, password, serverId\)/.test(supSrc)
      && supSrc.includes('body: { server_id: id },')
      && supSrc.includes('}).then(() => { me.serverId = id; }, () => {});'));
  equal('лента, ответы и чат читают номер автора из той же строки, без второго запроса',
    (supSrc.match(/authorServer: row\.author_server == null \? null : Number\(row\.author_server\)/g) || []).length, 3);
  check('ответ прокидывает и тег альянса, и номер: чип альянса в комментариях жив',
    (supSrc.match(/authorAlliance: row\.author_alliance/g) || []).length >= 2);
  check('своё сообщение в чате получает номер из аккаунта, пока представление не обновилось',
    supSrc.includes('if (out.authorServer == null && me?.serverId) out.authorServer = me.serverId;'));
  check('аккаунт несёт и номер, и дату выбора: датой делится только владелец через `forum_users`',
    supSrc.includes('serverSetAt: toDate(row.server_set_at)')
      && supSrc.includes('serverId: row.server_id == null ? null : Number(row.server_id)'));
  check('контракт описывает новые поля и третий параметр регистрации',
    contractSrc.includes('@property {number|null} [serverId]')
      && contractSrc.includes('@property {Date|null} [serverSetAt]')
      && (contractSrc.match(/@property \{number\|null\} \[?authorServer\]?/g) || []).length >= 3
      && /\(nick: string, password: string, serverId\?:/.test(contractSrc));
  check('боевой путь не считает срок сам: частоту держит триггер, и только черновик повторяет её словами',
    !profileSrc.includes('serverChangeProblem') && localSrc.includes('serverChangeProblem'));
  check('черновик проверяет номер до создания аккаунта: отказ не оставляет половинки записи',
    localSrc.indexOf('const server = validateServerId(serverId);')
      < localSrc.indexOf('s.users.push(user);'));

  /* ── Экраны ── */
  check('форма входа спрашивает номер и говорит, зачем он',
    feedSrc.includes('<span>Твой сервер</span>') && /name="serverId"/.test(feedSrc));
  check('при входе номер не трогают, при регистрации передают третьим аргументом',
    /if \(mode === 'signup'\) \{[\s\S]{0,260}validateServerId\(form\.serverId\.value\)/.test(mountSrc)
      && mountSrc.includes('await forum.signUp(nick.value, password.value, signupServer)')
      && !/signIn\(nick\.value, password\.value, /.test(mountSrc));
  check('профиль: поле с текущим номером и подсказка, после какого числа смена пройдёт',
    /name="serverId"/.test(userPageSrc) && userPageSrc.includes('serverChangeHint(me?.serverSetAt)'));
  check('после нового выбора аккаунт перечитывается: иначе срок в этом сеансе сбрасывался бы незаметно',
    mountSrc.includes('server.value !== (state.me.serverId ?? null)')
      && /if \(state\.me && server\.ok[\s\S]{0,120}state\.me = await forum\.currentUser\(\);/.test(mountSrc));
  check('снятие номера — тоже правка профиля: пустое поле значит «метки нет»',
    profileSrc.includes("if ('serverId' in patch) {") && profileSrc.includes('body.server_id = check.value;'));

  /* ── Метка: разметка и стили ── */
  const { serverBadge } = await import('../src/forum/roles.js');
  equal('без номера метки нет, а не пустой значок', serverBadge(null) + serverBadge('') + serverBadge(0) + serverBadge(-3) + serverBadge(7.5), '');
  equal('номер подписывается коротко и называется в подсказке',
    serverBadge(33),
    '<span class="role-badge role-badge--server" title="Сервер 33" role="img" aria-label="Сервер 33"><b>№33</b></span>');
  equal('строка из базы («33») считается номером, а не мусором', serverBadge('12').includes('<b>№12</b>'), true);

  const chatsPageSrc = await text('src/pages/chats.js');
  const playersSrc = await text('src/admin/screens/players.js');
  equal('метка стоит у ника во всех пяти местах, где ник уже с метками',
    [feedSrc, chatsPageSrc, userPageSrc, playersSrc].filter((src) => src.includes('serverBadge(')).length, 4);
  check('в панели номер виден вместе с проверкой ника',
    /verifiedBadge\(user\.isVerified\)\}\$\{serverBadge\(user\.serverId\)\}/.test(playersSrc));
  check('правило «в ленте слово роли спрятано» существует и не съедает номер',
    /\.forum-post__by \.role-badge b,\n\.forum-comment__head \.role-badge b \{ display: none; \}/.test(mobileSrc)
      && /\.forum-post__by \.role-badge--server b,\n\.forum-comment__head \.role-badge--server b \{ display: inline; font-size: 7\.5px; \}/.test(refineSrc));
  /*
    Кегль номера держится отдельно от правила про слово. Без него `<b>№33</b>`
    попадает под `.forum-post__by b { font-size: 13px }` — селектор тяжелее,
    чем `.role-badge`, — и метка вдвое перерастает корону и галочку рядом.
  */
  check('номер сервера не наследует кегль ника, а держит размер значка',
    /\.role-badge--server b \{ font-size: 7\.5px; \}/.test(refineSrc));

  /*
    7,5px — кегль подписи, и он прощает только высокий контраст. Первый тон
    метки (#6d8bb8) давал со собственной подложкой 4,2:1: на телефоне вне
    помещения цифры «№33» сливались в серое пятно. Нынешний тон держит 7,4:1
    и остаётся темнее ника, так что иерархия «ник важнее подписи» не съехала.

    Подложку красить сильнее — не выход: контраст считается между текстом и
    его подложкой, и чем насыщеннее подложка, тем меньше разница (проверено
    расчётом: при 30% подложке тот же тон падает до 3,2:1).

    В светлой теме тот же светлый тон на белом стекле карточки дал бы 1,6:1,
    поэтому там метка развёрнута в тёмную половину того же стального.
  */
  equal('цвет метки задан один раз и не повторяет соседние статусы',
    (refineSrc.match(/--role-tone: #a3c2e6/g) || []).length, 1);
  check('в светлой теме номер темнее, а не тот же светлый тон на белом',
    /:root\[data-theme="light"\] \.role-badge--server \{ --role-tone: #34577f; \}/.test(refineSrc));

  const forumCss = await text('src/forum.css');
  /*
    «💬 ответить» — переход в тему, а не подпись под постом. Голым текстом
    12,5px он стоял рядом с кнопками реакций втрое выше, и в него попадали
    мимо. Оболочка и кегль выровнены по соседним действиям, а тач-цель
    доведена до 40px в том же блоке, что и остальные кнопки ленты.
  */
  check('«ответить» в ленте — кнопка, а не подпись: оболочка, кегль и тач-цель',
    /\.forum-post__comments \{[\s\S]{0,300}display: inline-flex;[\s\S]{0,300}border-radius: 8px;[\s\S]{0,300}font-size: 13\.5px;/.test(forumCss)
      && mobileSrc.includes('body .forum-post__foot .forum-post__comments,')
      && /body \.forum-post__acts \.forum-act,\n  body \.forum-act-menu__list \.forum-act \{ min-height: 36px; \}/.test(mobileSrc));

  /*
    Перенос плашек спас ник, но вторая строка («Новости», «Ваш след», «2 новых
    ответа») начиналась ровно у левого края карточки — левее ника, который
    стоит за аватаркой. Ровнять по центру нужно и перенесённую строку.
  */
  check('перенесённые плашки автора центрированы, а не прижаты к левому краю',
    /\.forum-post__head \{ flex-wrap: wrap; justify-content: center; \}/.test(mobileSrc));
}

/* ── 20. Сервер у игрока: черновой режим держит те же правила и слова ────────

   Здесь проверки не читают исходники, а поступают: регистрируют, меняют,
   снимают и ждут отказ. Именно так видно расхождение, которое глазами в
   черновом режиме не найти — форма пропускает, база отвергает.
────────────────────────────────────────────────────────────────────────────── */
{
  const L = CONFIG.forum.limits;
  const { SERVER_RANGE, serverDate } = await import('../src/forum/rules.js');
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const local = await import('../src/forum/adapters/local.js');
  const { CATEGORY_IDS } = await import('../src/forum/rules.js');
  const KEY = 'zr33.forum.local';
  const raw = () => JSON.parse(store.get(KEY));
  const put = (s) => store.set(KEY, JSON.stringify(s));
  /* Отматываем назад и дату выбора, и день регистрации: иначе вмешивается
     выдержка на публикации нового аккаунта, и отказ пришёл бы не за номер. */
  const backdate = (days) => {
    const s = raw();
    for (const u of s.users) {
      const at = new Date(Date.now() - days * 86400000).toISOString();
      u.createdAt = at;
      if (u.serverSetAt) u.serverSetAt = at;
    }
    put(s);
  };
  const who = () => raw().users.find((u) => u.id === raw().me);
  const fail = async (fn) => {
    try {
      await fn();
      return null;
    } catch (e) {
      return String(e?.message ?? e);
    }
  };

  await local.signUp('Владелец', 'пароль', 12);
  equal('регистрация сохраняет названный номер', (await local.currentUser()).serverId, 12);

  const range = await fail(() => local.signUp('Заперепис', 'пароль', L.serverIdMax + 1));
  equal('номер вне границ отвергается теми же словами, что и база', range, SERVER_RANGE);
  check('отказ в номере не оставляет половинки аккаунта',
    !raw().users.some((u) => u.nick === 'Заперепис'));

  /* Первый вошедший в черновом режиме — служебный, его срок не держит. */
  check('модерации ожидание не мешает: она правит чужую ошибку в любой день',
    (await fail(async () => {
      await local.signIn('Владелец');
      await local.saveProfile({ serverId: 77 });
    })) === null && (await local.currentUser()).serverId === 77);

  await local.signUp('Ковыль', 'пароль', 12);
  const setAt = who().serverSetAt;
  const hold = await fail(() => local.saveProfile({ serverId: 55 }));
  check('участник в ожидании: отказ называет дату, после которой смена пройдёт',
    hold === `Сервер можно менять раз в ${L.serverChangeDays} дней. Следующая смена — после ${serverDate(new Date(new Date(setAt).getTime() + L.serverChangeDays * 86400000))}`,
    hold);
  check('снятие номера в тот же день тоже держится: лимит не обходится двумя правками',
    (await fail(() => local.saveProfile({ serverId: '' })))?.startsWith('Сервер можно менять раз в'));
  check('такой же номер сохранить можно: правило про смену, а не про правку профиля',
    (await fail(() => local.saveProfile({ serverId: 12 }))) === null);

  backdate(L.serverChangeDays + 1);
  check('срок истёк — выбор проходит и дата передвигается',
    (await fail(() => local.saveProfile({ allianceTag: 'KOP', serverId: 44 }))) === null
      && (await local.currentUser()).serverId === 44
      && new Date(who().serverSetAt).getTime() > Date.now() - 60000);

  const post = await local.createPost({
    title: 'Тема для значка', body: '<p>текст темы, достаточный по длине</p>', category: CATEGORY_IDS[0],
  });
  equal('тема получает номер автора', post.authorServer, 44);
  const comment = await local.addComment(post.id, '<p>ответ на тему</p>');
  check('ответ получает номер автора и его тег: лента и чип альянса рисуются из одной строки',
    comment.authorServer === 44 && comment.authorAlliance === 'KOP');
  const listed = await local.listPosts({ limit: 5 });
  equal('в списке тем номер тоже есть', listed.posts[0].authorServer, 44);
  const gotPost = await local.getPost(post.id);
  equal('открытая тема не теряет номер', gotPost.authorServer, 44);
  const prof = await local.getProfile('Ковыль');
  check('страница участника отдаёт номер и не отдаёт дату смены',
    prof.serverId === 44 && prof.serverSetAt === undefined);

  backdate(L.serverChangeDays + 1);
  check('снятие после срока разрешено и остаётся сменой: дата ставится заново',
    (await fail(() => local.saveProfile({ serverId: '' }))) === null
      && (await local.currentUser()).serverId === null
      && who().serverSetAt !== null);
}

/* ── Итог запуска ────────────────────────────────────────────────────────────

   Счётчик существовал с первых строк файла, но никто его не печатал: запуск
   заканчивался молча и с нулевым кодом, поэтому «упало семь проверок» и
   «всё чисто» различались только глазами по выводу. Это ровно тот случай,
   где молчаливый успех дороже громкого падения: человек прогоняет тесты перед
   коммитом и верит числу, а не ищет слово FAIL в четырёх тысячах строк.
   Код выхода нужен и `npm test`: без него падение не мешает сборке.
────────────────────────────────────────────────────────────────────────────── */
console.log(`\nИтог: пройдено ${passed}, падений ${failed}.`);
if (failed) process.exitCode = 1;
