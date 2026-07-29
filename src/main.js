import { CONFIG } from '../config.js';
import { loadAll, capabilities, db } from './data/index.js';
import { validateDataset } from './data/contract.js';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
} from './logic/standings.js';
import { renderHome } from './pages/home.js';
import { renderLadder } from './pages/ladder.js';
import { renderTimeline } from './pages/timeline.js';
import { renderGuide } from './pages/guide.js';
import { renderAlliance } from './pages/alliance.js';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';

const ROUTES = [
  { id: 'home', label: 'Итоги недели', render: renderHome },
  { id: 'ladder', label: 'Рейтинг', render: renderLadder },
  { id: 'timeline', label: 'Хронология', render: renderTimeline },
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

function render() {
  if (!view) return;
  const { id, param } = parseHash();

  if (id === 'alliance' && param) {
    // Карточка альянса не своя вкладка, поэтому в меню подсвечиваем рейтинг,
    // откуда сюда и приходят.
    renderNav('ladder');
    app.innerHTML = renderAlliance(view, param);
  } else {
    const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
    renderNav(route.id);
    app.innerHTML = route.render(view);
    // Страницы рисуются строками разом, а фильтры живут в отдельных скриптах.
    // Без этого вызова состояние кнопок разойдётся с тем, что видно на экране.
    for (const fn of [window.__ladderApply, window.__timelineApply]) {
      if (typeof fn === 'function') fn();
    }
  }

  window.scrollTo(0, 0);
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

    view = {
      ...data,
      weeks,
      allWeeks: data.weeks,
      standings,
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
