/**
 * Собирает весь сайт в один самодостаточный HTML-файл.
 *
 * Две роли, обе полезные:
 *   1. Превью — можно кинуть файл кому угодно, он откроется без сервера.
 *   2. Тот самый аварийный выход из плана: если источник данных однажды
 *      отвалится, этот скрипт превращает сайт в статику, и история
 *      остаётся доступной навсегда.
 *
 * Запуск:  node scripts/build-preview.mjs [стартовая-страница] [файл]
 * Пример:  node scripts/build-preview.mjs ladder dist/preview-ladder.html
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CONFIG } from '../config.js';
import { loadAll } from '../src/data/index.js';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
} from '../src/logic/standings.js';
import { renderHome } from '../src/pages/home.js';
import { renderLadder } from '../src/pages/ladder.js';
import { renderTimeline } from '../src/pages/timeline.js';
import { renderGuide } from '../src/pages/guide.js';
import { renderAlliance } from '../src/pages/alliance.js';
import { renderQuarter } from '../src/pages/quarter-final.js';
import { renderBot } from '../src/pages/bot.js';
import { renderForum } from '../src/pages/forum.js';
import { renderChats } from '../src/pages/chats.js';
import { computeQuarterWindow, computeWindowForm } from '../src/logic/standings.js';

const data = await loadAll();
// Только недели, за которые есть результаты — см. weeksUpToLastData.
const weeks = weeksUpToLastData(data.weeks, data.results);
const standings = computeStandings(
  data.alliances, weeks, data.results, CONFIG.scoring, CONFIG.formLength
);
const view = {
  ...data,
  weeks,
  allWeeks: data.weeks,
  standings,
  summary: computeWeekSummary(data.alliances, weeks, data.results),
  movers: computeMovers(standings),
  placeHistory: computePlaceHistory(data.alliances, weeks, data.results, CONFIG.scoring),
};

const quarter = computeQuarterWindow(data.weeks, data.results, 4);
const quarterStandings = computeStandings(
  data.alliances, quarter.weeks, data.results, CONFIG.scoring, 4
).map((row) => ({
  ...row,
  form: computeWindowForm(row.alliance.id, quarter.weeks, data.results),
}));

/*
  ПОРЯДОК И СОСТАВ РАЗДЕЛОВ ЗДЕСЬ ОБЯЗАН СОВПАДАТЬ С САЙТОМ.

  Превью — это не только «показать кому-то файлом», но и аварийный выход
  из плана: если источник данных однажды отвалится, этот скрипт превращает
  сайт в статику, и накопленная история остаётся доступной.

  Значит собранный файл должен быть ТЕМ ЖЕ сайтом. Пока здесь было четыре
  раздела из семи, аварийный выход давал сайт без Кварта, без бота и без
  форума — то есть не спасал, а подменял. Обнаружилось бы это в тот день,
  когда выход понадобится, то есть в худший.

  Форум в превью показывается без ленты: постов в файле нет и быть не может,
  они лежат в базе. Зато видна сводка сервера и правила — то, что и так
  часть страницы.
*/
const NAV = [
  { id: 'forum', label: 'Форум', html: renderForum(view, { ready: false, loading: false }) },
  { id: 'chats', label: 'Чаты', html: renderChats({ ready: false, loading: false, error: '', me: null, chats: [] }) },
  { id: 'home', label: 'Итоги недели', html: renderHome(view) },
  { id: 'quarter', label: 'Кварт', html: renderQuarter({ standings: quarterStandings, quarter }) },
  { id: 'ladder', label: 'Рейтинг', html: renderLadder(view) },
  { id: 'timeline', label: 'Хронология', html: renderTimeline(view) },
  { id: 'guide', label: 'Малым алам', html: renderGuide(view) },
  { id: 'bot', label: 'Бот в ТГ', html: renderBot() },
];

/*
  Карточки всех альянсов кладём в тот же файл. В превью нет роутера,
  поэтому единственный способ дать их потыкать — отрисовать заранее.
  32 страницы добавляют вес, но превью становится по-настоящему живым.
*/
const ALLY = data.alliances.map((a) => ({
  id: `alliance-${a.id}`,
  html: renderAlliance(view, a.id),
}));

const PAGES = [...NAV, ...ALLY];

const startId = process.argv[2] && PAGES.some((p) => p.id === process.argv[2]) ? process.argv[2] : 'forum';
const outFile = process.argv[3] || 'dist/preview.html';
const isStart = (p) => p.id === startId;
// У карточки альянса своей вкладки нет — в меню подсвечиваем рейтинг,
// откуда на неё и приходят.
const startNavId = startId.startsWith('alliance-') ? 'ladder' : startId;

/*
  Стили берём те же, что грузит index.html, а не зашитое имя файла.

  Здесь стоял src/styles.css — файл, от которого сайт ушёл в версии v6.
  Превью собиралось из чужого оформления, и «аварийный выход» давал сайт,
  похожий на настоящий, но другой. Читаем список из самой страницы: тогда
  переименование файла стилей не оставит превью позади.
*/
const indexHtml = await readFile('index.html', 'utf8');
const cssFiles = [...indexHtml.matchAll(/href="\.\/(src\/[^"?]+\.css)/g)].map((m) => m[1]);
const css = (await Promise.all(cssFiles.map((f) => readFile(f, 'utf8')))).join('\n');

/*
  Скрипты фильтров написаны без import и export именно ради этих строк:
  их можно вставить дословно, не дублируя логику. Собираем все *-controls.js
  автоматически, чтобы новый фильтр не пришлось вспоминать и дописывать сюда.
*/
const { readdir } = await import('node:fs/promises');
const controlFiles = (await readdir('src/ui')).filter((f) => f.endsWith('-controls.js')).sort();
const controlsJs = (
  await Promise.all(controlFiles.map((f) => readFile(`src/ui/${f}`, 'utf8')))
).join('\n');

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Сервер 33 · Z Route: Redemption</title>
<meta name="theme-color" content="#0a0b0d">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css}
.page { display: none; }
.page.is-active { display: block; }
</style>
</head>
<body>
<header class="site-head">
  <div class="site-head__inner">
    <!--
      Кнопка меню и боковая панель — как на настоящем сайте. Раньше превью
      собиралось со вкладками в строке, то есть показывало прошлую версию
      навигации: аварийный выход давал сайт, похожий на настоящий, но другой.
    -->
    <button type="button" id="side-toggle" class="burger"
            aria-controls="side" aria-expanded="false" aria-label="Открыть меню разделов">
      <span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>
    </button>
    <a class="brand brand--head" href="#" data-go="forum">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
    </a>
  </div>
</header>

<aside id="side" class="side" aria-label="Разделы сайта">
  <a class="brand brand--side" href="#" data-go="forum">
    <span class="brand__num">33</span>
    <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
  </a>
  <nav class="nav" id="nav">
    ${NAV.map((p) => `<a href="#" class="nav__link${p.id === startNavId ? ' is-active' : ''}" data-go="${p.id}">${p.label}</a>`).join('\n    ')}
  </nav>
  <div class="side__foot"><span class="side__note">Собранная копия сайта</span></div>
</aside>
<div class="side-veil" id="side-veil" hidden></div>

<main class="wrap" id="app">
  ${PAGES.map((p) => `<div class="page${isStart(p) ? ' is-active' : ''}" id="page-${p.id}">${p.html}</div>`).join('\n  ')}
</main>

<footer class="site-foot wrap">
  <p>Неофициальный сайт сообщества 33 сервера. Данные вносятся вручную после каждого VS.
  Источник данных: <b>${CONFIG.dataSource}</b>${CONFIG.dataSource === 'json' ? ' (выдуманные данные)' : ''}.</p>
</footer>

<script>
// Боковое меню: то же поведение, что в src/main.js.
(function () {
  var toggle = document.getElementById('side-toggle');
  var veil = document.getElementById('side-veil');
  var side = document.getElementById('side');
  function setOpen(open) {
    document.documentElement.classList.toggle('is-side-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (veil) veil.hidden = !open;
  }
  if (toggle) toggle.addEventListener('click', function () {
    setOpen(!document.documentElement.classList.contains('is-side-open'));
  });
  if (veil) veil.addEventListener('click', function () { setOpen(false); });
  if (side) side.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
})();
</script>

<script>
// Мини-роутер превью. В настоящем сайте это делает адресная строка.
document.addEventListener('click', function (e) {
  var link = e.target.closest('[data-go], a[href^="#/"]');
  if (!link) return;
  e.preventDefault();

  var id = link.getAttribute('data-go');
  if (!id) {
    // Ссылки вида #/ladder внутри страниц — например «← Рейтинг».
    var parts = link.getAttribute('href').replace(/^#\\/?/, '').split('/');
    id = parts[1] ? parts[0] + '-' + parts[1] : parts[0];
  }

  var target = document.getElementById('page-' + id);
  if (!target) return;

  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.toggle('is-active', p === target);
  });

  // У карточки альянса своей вкладки нет — подсвечиваем рейтинг.
  var navId = id.indexOf('alliance-') === 0 ? 'ladder' : id;
  document.querySelectorAll('.nav__link').forEach(function (a) {
    a.classList.toggle('is-active', a.getAttribute('data-go') === navId);
  });

  window.scrollTo(0, 0);
});
</script>
<script>
${controlsJs}
</script>
</body>
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile(outFile, html, 'utf8');
console.log(
  `Готово: ${outFile} (${(html.length / 1024).toFixed(0)} КБ), ` +
    `страниц: ${PAGES.length}, стартовая: ${startId}`
);
