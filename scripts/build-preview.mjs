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
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
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
import { renderAbout } from '../src/pages/about.js';
import { renderForum } from '../src/pages/forum.js';
import { renderChats } from '../src/pages/chats.js';
import { renderTournaments } from '../src/pages/tournaments.js';
import { renderGuides } from '../src/pages/guides.js';
import { renderCalendar } from '../src/pages/calendar.js';
import { renderUpdates } from '../src/pages/updates.js';
import { renderAccounts } from '../src/pages/accounts.js';
import { renderHandbook } from '../src/pages/handbook.js';
import { allianceInkCss } from '../src/ui/ink.js';
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

  ГРУППЫ И ПОДПИСИ ЗДЕСЬ — ТЕ ЖЕ, ЧТО В src/main.js. Превью обязано
  показывать тот же оглавление, что и сайт: два списка с разными заголовками
  групп расходятся незаметно и расходятся именно в тот день, когда файл
  становится единственным способом посмотреть сайт.
*/
const NAV = [
  { id: 'forum', label: 'Форум', group: 'Общение', tag: 'обсуждения сервера', html: renderForum(view, { ready: false, loading: false }) },
  { id: 'chats', label: 'Чаты', group: 'Общение', tag: 'личное и альянсы', html: renderChats({ ready: false, loading: false, error: '', me: null, chats: [] }) },
  { id: 'tournaments', label: 'Турниры', group: 'Общение', tag: 'матчапы и счёт', html: renderTournaments({ me: null, alliances: view.alliances, tournaments: [] }) },
  { id: 'guides', label: 'Гайды', group: 'Справка', tag: 'разборы и справочник', html: renderGuides({ me: null, guides: [], category: 'all' }) },
  { id: 'calendar', label: 'Календарь', group: 'Общение', tag: 'сборы и ответы', html: renderCalendar({ ready: false, shared: false, sourceName: 'без базы', me: null, events: [], loading: false, error: '', view: 'next' }) },
  { id: 'updates', label: 'Обновления игры', group: 'Сервер', tag: 'что изменилось в игре', html: renderUpdates({ ready: false, shared: false, sourceName: 'без базы', me: null, canManage: false, notes: [], loading: false, error: '', composing: false }) },
  // Витрина продаж — те же темы, что и форум: в статичном файле их быть не
  // может, поэтому страница собирается без объявлений, но с правилами доски.
  { id: 'accounts', label: 'Продажа аккаунтов', group: 'Общение', tag: 'объявления и цены', html: renderAccounts({ ready: false, sort: 'fresh', showSold: false, posts: [], total: 0, loading: false, more: false, error: '' }) },
  { id: 'home', label: 'Итоги недели', group: 'Сервер', tag: 'неделя: +1 и −1', html: renderHome(view) },
  { id: 'quarter', label: 'Кварт', group: 'Сервер', tag: 'итоги периода', html: renderQuarter({ standings: quarterStandings, quarter }) },
  { id: 'ladder', label: 'Рейтинг', group: 'Сервер', tag: 'места и форма', html: renderLadder(view) },
  { id: 'timeline', label: 'Хронология', group: 'Сервер', tag: 'летопись захватов', html: renderTimeline(view) },
  { id: 'guide', label: 'Малым алам', group: 'Справка', tag: 'малым альянсам', html: renderGuide(view) },
  { id: 'bot', label: 'Бот в ТГ', group: 'Справка', tag: 'тексты игры в чате', html: renderBot() },
  { id: 'about', label: 'О проекте', group: 'Справка', tag: 'как это устроено', html: renderAbout() },
  // На сайте у справочника своей вкладки нет: он живёт внутри «Гайдов».
  // Страницу всё равно рисуем — по ней приходят из чатов и закладок.
  { id: 'handbook', label: 'Справочник игры', group: 'Справка', navAs: 'guides', hidden: true, html: renderHandbook({}) },
];

/* Заголовки групп в том порядке, в каком они стоят в меню на сайте. */
const NAV_TITLES = ['Общение', 'Сервер', 'Справка'];

/*
  НИЖНИЙ РЯД: ЧЕТЫРЕ РАЗДЕЛА И «ЕЩЁ» — Те же, что в index.html, и связаны
  с меню общей проверкой в тестах: ряд, собранный из другого списка, показал
  бы в превью навигацию, которой на сайте нет.
*/
const TABBAR = [
  { id: 'forum', label: 'Форум' },
  { id: 'home', label: 'Итоги' },
  { id: 'ladder', label: 'Рейтинг' },
  { id: 'chats', label: 'Чаты' },
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
  Краски альянсов. На живом сайте их дописывает main.js в тот же блок, а
  сборка статическая: здесь значение то, но взятое из данных прямо сейчас.

  Без этих строк копия сайта показывала бы график бледнее оригинала — «аварийный
  выход», который врёт про читаемость, хуже отсутствия выхода.
*/
const inksCss = allianceInkCss(view.alliances);

/*
  Скрипты фильтров написаны без import и export именно ради этих строк:
  их можно вставить дословно, не дублируя логику. Собираем все *-controls.js
  автоматически, чтобы новый фильтр не пришлось вспоминать и дописывать сюда.

  ПОЧЕМУ ПРОВЕРКА НА import ЗДЕСЬ, А НЕ В СОГЛАШЕНИИ НА СЛОВАХ.
  Драйверы вставлялись в один обычный `<script>`, а обычный скрипт со строкой
  `import` внутри не разбирается целиком: браузер выдаёт SyntaxError ДО первой
  выполненной строки. Один файл с import глушил поэтому всю копию — и делал
  это молча: сборка печатала «Готово» и размер, потому что для неё самой всё
  было в порядке. Так и вышло: с 13.09 (timeline-controls.js) и 27.09
  (handbook-controls.js) в копии не работал ни один фильтр, включая те, что
  жили там месяцами.

  Два следствия, и оба дороже самой проверки.

  1. Каждый драйвер получает свой `<script>`. Сломанный файл ломает только
     себя — копия деградирует на один раздел, а не на весь интерактив.
  2. Файл со статическим import в копию не вставляется вовсе: он остаётся там,
     где его загружают как модуль (src/main.js), а здесь о нём говорит
     сборочный лог. Молчание стоило пяти недель веры в неработающую копию,
     поэтому оно не повторяется без подписи.
*/
const { readdir } = await import('node:fs/promises');
const controlFiles = (await readdir('src/ui')).filter((f) => f.endsWith('-controls.js')).sort();
/*
  Знак статического import/export — слово в начале строки. Динамический
  `import('./x.js')` так не выглядит: он стоит в выражении, а не в начале
  строки, и в обычном скрипте разрешён — копию не ломает.
*/
const STATIC_MODULE = /^[ \t]*(?:import|export)\b/m;
const driverBlocks = [];
const skipped = [];
for (const f of controlFiles) {
  const src = await readFile(`src/ui/${f}`, 'utf8');
  if (STATIC_MODULE.test(src)) skipped.push(f);
  else driverBlocks.push(`<script data-driver="src/ui/${f}">\n${src}\n</script>\n`);
}

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Сервер 33 · Z Route: Redemption</title>
<meta name="theme-color" content="#0a0b0d">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;700;800&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<style>
${css}
${inksCss}
.page { display: none; }
.page.is-active { display: block; }
</style>
</head>
<body>
<header class="site-head">
  <div class="site-head__inner">
    <!--
      Тот же набор, что в index.html: марка, «где я» и переключатель темы.
      Кнопки «Меню» здесь больше нет, как нет её на сайте: вход в разделы
      на телефоне один — нижний ряд, и превью, показывающее прошлую модель
      навигации, был бы не аварийным выходом, а обманом.
    -->
    <a class="brand brand--head" href="#" data-go="forum">
      <span class="brand__num">33</span>
      <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
    </a>
    <p class="head__where" id="head-where" aria-hidden="true"></p>
  </div>
</header>

<aside id="side" class="side" aria-label="Разделы сайта">
  <div class="side__bar">
    <span class="side__grab" aria-hidden="true"></span>
    <p class="side__title">Все разделы</p>
    <button type="button" class="side__close" data-side-close>Закрыть</button>
  </div>
  <a class="brand brand--side" href="#" data-go="forum">
    <span class="brand__num">33</span>
    <span class="brand__text"><b>Сервер 33</b><small>Z Route: Redemption</small></span>
  </a>
  <nav class="nav" id="nav">
    ${NAV_TITLES.map((title) => `<span class="nav__group">${title}</span>${
      NAV.filter((p) => !p.hidden && p.group === title)
        .map((p) => `<a href="#" class="nav__link${p.id === startNavId ? ' is-active' : ''}" data-go="${p.id}">${p.label}</a>`).join('')
    }`).join('\n    ')}
  </nav>
  <div class="side__foot"><span class="side__note">Собранная копия сайта</span></div>
</aside>
<div class="side-veil" id="side-veil" hidden></div>

<!--
  Нижняя полоса разделов — те же четыре частых раздела и «Ещё», что на
  сайте. В файле нет роутера, поэтому active-клетку подставляет тот же
  мини-роутер, что переключает страницы.
-->
<nav id="tabbar" class="tabbar" aria-label="Разделы сервера">
${TABBAR.map((t) => `  <a class="tabbar__link${t.id === startNavId ? ' is-active' : ''}" href="#" data-go="${t.id}"><span>${t.label}</span></a>`).join('\n')}
  <button type="button" class="tabbar__more" id="tabbar-more" aria-controls="side" aria-expanded="false"><span>Ещё</span></button>
</nav>

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
  var more = document.getElementById('tabbar-more');
  var close = document.querySelector('[data-side-close]');
  var grab = document.querySelector('.side__grab');
  var veil = document.getElementById('side-veil');
  var side = document.getElementById('side');
  var where = document.getElementById('head-where');
  /* Раздел → зачем он: те же подписи, что в меню, чтобы «где я» и список
     не говорили о одной странице по-разному. */
  var TAGS = ${JSON.stringify(Object.fromEntries(NAV.map((p) => [p.navAs || p.id, [p.label, p.tag || '']])))};
  function setWhere(id) {
    if (!where) return;
    var t = TAGS[id];
    where.textContent = '';
    if (!t) return;
    var b = document.createElement('b'); b.textContent = t[0];
    var s = document.createElement('span'); s.textContent = t[1];
    where.append(b, s);
  }
  function setOpen(open) {
    document.documentElement.classList.toggle('is-side-open', open);
    if (more) more.setAttribute('aria-expanded', String(open));
    if (veil) veil.hidden = !open;
    /*
      Фокус за панелью и обратно на того, кто её открыл — как на живом сайте.
      Чтение offsetHeight обязательно: без него браузер ещё не пересчитал
      видимость, а скрытому элементу фокус не даётся.
    */
    if (open) {
      if (side) void side.offsetHeight;
      var first = side && side.querySelector('.nav__link');
      if (first) first.focus({ preventScroll: true });
    } else if (document.activeElement && side && side.contains(document.activeElement)) {
      if (more && more.offsetParent !== null) more.focus({ preventScroll: true });
    }
  }
  if (more) more.addEventListener('click', function () {
    setOpen(!document.documentElement.classList.contains('is-side-open'));
  });
  if (close) close.addEventListener('click', function () { setOpen(false); });
  if (veil) veil.addEventListener('click', function () { setOpen(false); });
  if (side) side.addEventListener('click', function (e) {
    if (e.target.closest('a')) setOpen(false);
  });
  /*
    Потянуть за полосу вниз — закрыть, как закрываются шторки в телефоне.
    Отпускание слушает документ: палец уходит за пределы ручки, и событие
    прилетает уже на вкладку списка.
  */
  var startY = null;
  if (grab) grab.addEventListener('pointerdown', function (e) {
    startY = e.clientY;
    if (grab.setPointerCapture) grab.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointerup', function (e) {
    if (startY === null) return;
    var moved = e.clientY - startY;
    startY = null;
    if (moved > 56) setOpen(false);
  });
  document.addEventListener('pointercancel', function () { startY = null; });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
  window.__setWhere = setWhere;
  setWhere(${JSON.stringify(startNavId)});
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
  // Нижняя полоса подсвечивает тот же раздел, что и меню: два ответа на
  // вопрос «где я» обязаны совпадать и здесь, как на настоящем сайте.
  document.querySelectorAll('#tabbar .tabbar__link').forEach(function (a) {
    if (a.getAttribute('data-go') === navId) a.classList.add('is-active');
    else a.classList.remove('is-active');
    if (a.getAttribute('data-go') === navId) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (window.__setWhere) window.__setWhere(navId);

  window.scrollTo(0, 0);
});
</script>
${skipped.length
    ? `<!--\n  Не вставлено в копию: статический import в ${skipped.join(', ')}.\n  Эти драйверы загружаются модулями в живом сайте; здесь их поведение недоступно.\n-->\n`
    : ''}${driverBlocks.join('')}</body>
</html>
`;

await mkdir('dist', { recursive: true });
await writeFile(outFile, html, 'utf8');

/*
  КАРТИНКИ РЯДОМ С КОПИЕЙ.

  Собранная копия показывает герой и карточки альянсов, а файлы лежат в
  public/. Без копирования превью ссылалось на ./public/hero/oblika-1120.avif,
  которого рядом с dist/preview.html не было: картинка на месте была, а
  путь вёл в пустоту, и копия показывала битый кадр вместо своего.

  Копируются только картинки — ровно те, что нужны странице. Остальное
  (справочник, гайды, загруженные игроками файлы) в копии не нужно: там
  свои адреса, и их содержимое меняется каждый день.
*/
{
  const images = ['public/hero'];
  for (const dir of images) {
    const to = join('dist', dir);
    await mkdir(to, { recursive: true });
    await cp(dir, to, { recursive: true, force: true });
  }
}

console.log(
  `Готово: ${outFile} (${(html.length / 1024).toFixed(0)} КБ), ` +
    `страниц: ${PAGES.length}, стартовая: ${startId}`
);
/*
  Драйверы, которых в копии нет, называются здесь, а не молчат: «Готово» и
  размер — ровно то, что скрывало поломку пять недель.
*/
if (skipped.length) {
  console.log(`ВНИМАНИЕ: без поведения остались ${skipped.length} драйвера(ов): ${skipped.join(', ')} — в них статический import.`);
}
