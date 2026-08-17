import { CONFIG } from '../config.js';
import { loadAll, capabilities, db } from './data/index.js';
import { validateDataset } from './data/contract.js';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
  computeQuarterWindow,
  computeWindowForm,
} from './logic/standings.js?v=2';
import { renderHome } from './pages/home.js';
import { renderLadder } from './pages/ladder.js?v=2';
import { renderQuarter } from './pages/quarter.js?v=4';
import { renderTimeline } from './pages/timeline.js';
import { renderGuide } from './pages/guide.js';
import { renderAlliance } from './pages/alliance.js';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';

const ROUTES = [
  { id: 'home', label: 'Итоги недели', render: renderHome },
  { id: 'timeline', label: 'Хронология', render: renderTimeline },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'ladder', label: 'Рейтинг', render: renderLadder },
  { id: 'guide', label: 'Малым алам', render: renderGuide },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');

/** @type {any} */
let view = null;

/**
 * Адрес вида #/ladder или #/alliance/a05.
 * Второй сегмент — параметр страницы.
 */
function parseHash() {
  const [id, param] = location.hash.replace(/^#\/?/, '').split('/');
  return { id: id || 'home', param: param || null };
}

function renderNav(activeId) {
  nav.innerHTML = ROUTES.map(
    (r) => `<a href="#/${r.id}" class="nav__link ${r.id === activeId ? 'is-active' : ''}">${r.label}</a>`
  ).join('');
}

/*
  Счётчик посещений (GoatCounter, подключён в index.html) сам считает только
  самый первый показ страницы — при загрузке своего скрипта. Дальше разделы
  переключаются через #-адрес без перезагрузки, и об этих переходах он
  ничего не знает, если не сказать явно.

  Первый вызов render() — это как раз тот самый первый показ, который
  GoatCounter уже посчитал сам; считать его второй раз не нужно. Досчитываем
  только переходы после него, то есть каждый следующий render().
*/
let countedFirstView = false;
function trackPageview(path) {
  if (!countedFirstView) {
    countedFirstView = true;
    return;
  }
  // Не бросаем ошибку, если скрипт ещё не подгрузился или его блокирует
  // расширение в браузере — без счётчика сайт обязан работать как ни в чём
  // не бывало.
  window.goatcounter?.count?.({ path });
}

function render() {
  if (!view) return;
  const { id, param } = parseHash();

  let path;
  if (id === 'alliance' && param) {
    // Карточка альянса не своя вкладка, поэтому в меню подсвечиваем рейтинг,
    // откуда сюда и приходят.
    renderNav('ladder');
    app.innerHTML = renderAlliance(view, param);
    path = `/alliance/${param}`;
  } else {
    const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
    renderNav(route.id);
    app.innerHTML = route.id === 'quarter'
      ? route.render({ standings: view.quarterStandings, quarter: view.quarter })
      : route.render(view);
    // Страницы рисуются строками разом, а фильтры живут в отдельных скриптах.
    // Без этого вызова состояние кнопок разойдётся с тем, что видно на экране.
    for (const fn of [window.__ladderApply, window.__timelineApply]) {
      if (typeof fn === 'function') fn();
    }
    path = `/${route.id}`;
  }

  window.scrollTo(0, 0);
  trackPageview(path);
}

async function boot() {
  app.innerHTML = '<div class="loading">Загружаем данные…</div>';

  try {
    const data = await loadAll();

    // В разработке сразу ругаемся на кривые данные, а не показываем пустые клетки.
    const problems = validateDataset(data);
    if (problems.length) console.warn('Проблемы в данных:\n' + problems.join('\n'));

    /*
      Недели в таблице заведены заранее, на несколько недель вперёд.
      Считать и показывать нужно только те, за которые есть результаты,
      иначе «итогами недели» окажется неделя из будущего.
    */
    const weeks = weeksUpToLastData(data.weeks, data.results);

    const standings = computeStandings(
      data.alliances, weeks, data.results, CONFIG.scoring, CONFIG.formLength
    );
    const quarter = computeQuarterWindow(data.weeks, data.results, 4);
    const quarterStandings = computeStandings(
      data.alliances,
      quarter.weeks,
      data.results,
      CONFIG.scoring,
      4
    ).map((row) => ({
      ...row,
      form: computeWindowForm(row.alliance.id, quarter.weeks, data.results),
    }));

    view = {
      ...data,
      weeks,
      allWeeks: data.weeks,
      standings,
      quarterStandings,
      quarter,
      summary: computeWeekSummary(data.alliances, weeks, data.results),
      movers: computeMovers(standings),
      placeHistory: computePlaceHistory(data.alliances, weeks, data.results, CONFIG.scoring),
      problems,
    };

    document.getElementById('source-badge').textContent = db.name;
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<section class="panel error">
      <h2>Не удалось загрузить данные</h2>
      <p>${String(err.message ?? err)}</p>
      <p class="muted">Источник: <b>${CONFIG.dataSource}</b>. Проверьте настройки в config.js.</p>
    </section>`;
  }
}

window.addEventListener('hashchange', render);
boot();

// Пригодится при отладке из консоли браузера.
Object.assign(window, { __app: () => view, __caps: capabilities });
