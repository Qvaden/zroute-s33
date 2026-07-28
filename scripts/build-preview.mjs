/**
 * Собирает весь сайт в один самодостаточный HTML-файл.
 *
 * Две роли, обе полезные:
 *   1. Превью — можно кинуть файл кому угодно, он откроется без сервера.
 *   2. Тот самый аварийный выход из плана: если источник данных однажды
 *      отвалится, этот скрипт превращает сайт в статику, и история
 *      остаётся доступной навсегда.
 *
 * Запуск:  node scripts/build-preview.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { CONFIG } from '../config.js';
import { loadAll } from '../src/data/index.js';
import { computeStandings, computeWeekSummary, computeMovers } from '../src/logic/standings.js';
import { renderHome } from '../src/pages/home.js';
import { renderLadder } from '../src/pages/ladder.js';
import { renderTimeline } from '../src/pages/timeline.js';
import { renderGuide } from '../src/pages/guide.js';

const data = await loadAll();
const standings = computeStandings(
  data.alliances, data.weeks, data.results, CONFIG.scoring, CONFIG.formLength
);
const view = {
  ...data,
  standings,
  summary: computeWeekSummary(data.alliances, data.weeks, data.results),
  movers: computeMovers(standings),
};

const PAGES = [
  { id: 'home', label: 'Итоги недели', html: renderHome(view) },
  { id: 'ladder', label: 'Рейтинг', html: renderLadder(view) },
  { id: 'timeline', label: 'Хронология', html: renderTimeline(view) },
  { id: 'guide', label: 'Малым алам', html: renderGuide(view) },
];

const css = await readFile('src/styles.css', 'utf8');

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Сервер 33 · Z Route: Redemption</title>
<meta name="theme-color" content="#12151a">
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
      ${PAGES.map((p, i) => `<a href="#" class="nav__link${i === 0 ? ' is-active' : ''}" data-go="${p.id}">${p.label}</a>`).join('\n      ')}
    </nav>
  </div>
</header>

<main class="wrap" id="app">
  ${PAGES.map((p, i) => `<div class="page${i === 0 ? ' is-active' : ''}" id="page-${p.id}">${p.html}</div>`).join('\n  ')}
</main>

<footer class="site-foot wrap">
  <p>Неофициальный сайт сообщества 33 сервера. Данные вносятся вручную после каждого VS.
  Демонстрационная сборка на выдуманных данных.</p>
</footer>

<script>
document.addEventListener('click', function (e) {
  var link = e.target.closest('[data-go]');
  if (!link) return;
  e.preventDefault();
  var id = link.getAttribute('data-go');
  document.querySelectorAll('.page').forEach(function (p) {
    p.classList.toggle('is-active', p.id === 'page-' + id);
  });
  document.querySelectorAll('.nav__link').forEach(function (a) {
    a.classList.toggle('is-active', a.getAttribute('data-go') === id);
  });
  window.scrollTo(0, 0);
});
</script>
</body>
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile('dist/preview.html', html, 'utf8');
console.log(`Готово: dist/preview.html (${(html.length / 1024).toFixed(0)} КБ), страниц: ${PAGES.length}`);
