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
} from '../src/logic/standings.js';
import { renderHome } from '../src/pages/home.js';
import { renderLadder } from '../src/pages/ladder.js';
import { renderTimeline } from '../src/pages/timeline.js';
import { renderGuide } from '../src/pages/guide.js';
import { renderAlliance } from '../src/pages/alliance.js';

const data = await loadAll();
const standings = computeStandings(
  data.alliances, data.weeks, data.results, CONFIG.scoring, CONFIG.formLength
);
const view = {
  ...data,
  standings,
  summary: computeWeekSummary(data.alliances, data.weeks, data.results),
  movers: computeMovers(standings),
  placeHistory: computePlaceHistory(data.alliances, data.weeks, data.results, CONFIG.scoring),
};

const NAV = [
  { id: 'home', label: 'Итоги недели', html: renderHome(view) },
  { id: 'ladder', label: 'Рейтинг', html: renderLadder(view) },
  { id: 'timeline', label: 'Хронология', html: renderTimeline(view) },
  { id: 'guide', label: 'Малым алам', html: renderGuide(view) },
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

const startId = process.argv[2] && PAGES.some((p) => p.id === process.argv[2]) ? process.argv[2] : 'home';
const outFile = process.argv[3] || 'dist/preview.html';
const isStart = (p) => p.id === startId;
// У карточки альянса своей вкладки нет — в меню подсвечиваем рейтинг,
// откуда на неё и приходят.
const startNavId = startId.startsWith('alliance-') ? 'ladder' : startId;

const css = await readFile('src/styles.css', 'utf8');
// Скрипт рейтинга написан без import/export именно ради этой строки:
// его можно вставить дословно, не дублируя логику поиска и сортировки.
const ladderJs = await readFile('src/ui/ladder-controls.js', 'utf8');

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
    <a class="brand" href="#" data-go="home">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
    </a>
    <nav class="nav" id="nav">
      ${NAV.map((p) => `<a href="#" class="nav__link${p.id === startNavId ? ' is-active' : ''}" data-go="${p.id}">${p.label}</a>`).join('\n      ')}
    </nav>
  </div>
</header>

<main class="wrap" id="app">
  ${PAGES.map((p) => `<div class="page${isStart(p) ? ' is-active' : ''}" id="page-${p.id}">${p.html}</div>`).join('\n  ')}
</main>

<footer class="site-foot wrap">
  <p>Неофициальный сайт сообщества 33 сервера. Данные вносятся вручную после каждого VS.
  Демонстрационная сборка на выдуманных данных.</p>
</footer>

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
${ladderJs}
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
