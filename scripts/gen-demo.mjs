/**
 * Генератор демо-данных для json-адаптера.
 *
 * Данные выдуманные — нужны, чтобы видеть, как сайт выглядит и считает,
 * до того как появится реальная таблица. Детерминированный: один и тот же
 * запуск даёт один и тот же файл, поэтому дифф в гите остаётся читаемым.
 *
 * Запуск:  node scripts/gen-demo.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';

/** Простой seeded-PRNG, чтобы результат не менялся от запуска к запуску. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const rand = rng(3333);

const ALLIANCES = [
  ['STG', 'Сталкеры'],        ['VLK', 'Волки'],          ['RUS', 'Русичи'],
  ['BTN', 'Бастион'],         ['PHX', 'Феникс'],         ['KRK', 'Крепость'],
  ['ORD', 'Орда'],            ['LGN', 'Легион'],         ['TRN', 'Титаны'],
  ['SHD', 'Тень'],            ['GRZ', 'Гроза'],          ['SVR', 'Север'],
  ['ATL', 'Атлант'],          ['KBR', 'Кобра'],          ['VYU', 'Вьюга'],
  ['MDV', 'Медведи'],         ['SKL', 'Сокол'],          ['PTN', 'Патриот'],
  ['ZRD', 'Заря'],            ['KMT', 'Комета'],         ['VTR', 'Ветер'],
  ['GRN', 'Гранит'],          ['ISK', 'Искра'],          ['NBS', 'Небеса'],
  ['DRK', 'Дракон'],          ['SPT', 'Спартак'],        ['VLN', 'Волна'],
  ['MRK', 'Меркурий'],        ['OSN', 'Основа'],         ['RFT', 'Рифт'],
  ['CHR', 'Черта'],           ['ANK', 'Анклав'],
];

/**
 * 32 различимых цвета: равномерно раскладываем оттенки по кругу и слегка
 * качаем насыщенность и светлоту. Готовая палитра из 12 цветов повторялась бы
 * трижды, а цвет альянса здесь работает как цвет команды — он должен быть
 * узнаваемым и на графике, и в таблице.
 */
const PALETTE = Array.from({ length: 32 }, (_, i) => {
  const hue = Math.round((i * 360) / 32 + (i % 2) * 11) % 360;
  const sat = 62 + (i % 3) * 9;
  const light = 56 + (i % 4) * 4;
  return hslToHex(hue, sat, light);
});

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (n) => Math.round(255 * f(n)).toString(16).padStart(2, '0');
  return `#${to(0)}${to(8)}${to(4)}`;
}

/**
 * Каждому альянсу — скрытая «сила». Чем сильнее, тем чаще побеждает.
 * Так в таблице появляется правдоподобное расслоение, а не белый шум.
 */
const strength = ALLIANCES.map((_, i) => 0.78 - (i / ALLIANCES.length) * 0.56);

const alliances = ALLIANCES.map(([tag, name], i) => ({
  id: `a${String(i + 1).padStart(2, '0')}`,
  tag,
  name,
  color: PALETTE[i % PALETTE.length],
  active: i < 30, // пара распавшихся — чтобы проверить отображение неактивных
}));

const WEEK_COUNT = 12;
const FIRST_MONDAY = Date.UTC(2026, 3, 6); // 6 апреля 2026
const DAY = 86400000;

const weeks = Array.from({ length: WEEK_COUNT }, (_, i) => {
  const start = FIRST_MONDAY + i * 7 * DAY;
  return {
    id: `W${16 + i}`,
    number: 16 + i,
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(start + 6 * DAY).toISOString().slice(0, 10),
  };
});

const results = [];
for (const week of weeks) {
  alliances.forEach((alliance, i) => {
    // Неактивные перестают играть во второй половине сезона.
    if (!alliance.active && week.number > 21) return;
    // Иногда альянс просто не выходит на VS.
    if (rand() < 0.07) return;
    results.push({
      weekId: week.id,
      allianceId: alliance.id,
      outcome: rand() < strength[i] ? 'П' : 'Х',
    });
  });
}

const events = [
  { id: 'e1', date: '2026-04-18', type: 'server_capture', serverNumber: 47,
    title: 'Захвачен сервер 47',
    body: 'Первый выход за пределы своего сервера. Столица взята на третьи сутки штурма.' },
  { id: 'e2', date: '2026-05-02', type: 'war',
    title: 'Война за Красную зону',
    body: 'Две недели непрерывных боёв между верхними альянсами. Формально победителя нет.' },
  { id: 'e3', date: '2026-05-23', type: 'server_capture', serverNumber: 61,
    title: 'Захвачен сервер 61',
    body: 'Самый быстрый захват в истории сервера — чуть меньше суток.' },
  { id: 'e4', date: '2026-06-07', type: 'merge',
    title: 'Слияние: Комета вошла в Легион',
    body: 'После трёх проигранных VS подряд состав Кометы перешёл в Легион.' },
  { id: 'e5', date: '2026-06-28', type: 'server_capture', serverNumber: 12,
    title: 'Захвачен сервер 12',
    body: 'Тяжёлая кампания против объединённой обороны. Заняла девять дней.' },
  { id: 'e6', date: '2026-07-19', type: 'server_capture', serverNumber: 88,
    title: 'Захвачен сервер 88',
    body: 'Четвёртый сервер под контролем. Сопротивление было символическим.' },
];

const texts = [
  {
    key: 'small-alliances',
    title: 'Малым альянсам',
    body: [
      'Раздел пока заполнен черновиком. Здесь будет разбор того, как выглядит',
      'образцовое руководство альянсом и что конкретно даёт переход в крупный альянс.',
      '',
      '## Что делает руководство работающим',
      '',
      '- Понятные роли: кто набирает, кто ведёт VS, кто следит за активностью.',
      '- Расписание: время сбора на VS известно заранее и не меняется каждую неделю.',
      '- Разговор с неактивными до исключения, а не вместо него.',
      '',
      '## Что даёт большой альянс',
      '',
      'Ускорение строек, доступ к событиям, защита от фарма более сильными,',
      'и главное — регулярные победы в VS, которые тянут за собой награды.',
    ].join('\n'),
  },
  {
    key: 'about',
    title: 'О сайте',
    body: 'Неофициальный сайт 33 сервера Z Route: Redemption. Данные вносятся вручную после каждого VS.',
  },
];

const out = { alliances, weeks, results, events, texts };

await mkdir('data', { recursive: true });
await writeFile('data/demo.json', JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(
  `Готово: ${alliances.length} альянсов, ${weeks.length} недель, ` +
    `${results.length} результатов, ${events.length} событий.`
);
