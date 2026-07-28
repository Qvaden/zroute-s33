import { CONFIG } from '../config.js';
import { loadAll, capabilities, db } from './data/index.js';
import { validateDataset } from './data/contract.js';
import { computeStandings, computeWeekSummary, computeMovers } from './logic/standings.js';
import { renderHome } from './pages/home.js';
import { renderLadder } from './pages/ladder.js';
import { renderTimeline } from './pages/timeline.js';
import { renderGuide } from './pages/guide.js';

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

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '') || 'home';
  return ROUTES.find((r) => r.id === id) ?? ROUTES[0];
}

function renderNav() {
  const active = currentRoute().id;
  nav.innerHTML = ROUTES.map(
    (r) => `<a href="#/${r.id}" class="nav__link ${r.id === active ? 'is-active' : ''}">${r.label}</a>`
  ).join('');
}

function render() {
  if (!view) return;
  renderNav();
  app.innerHTML = currentRoute().render(view);
  window.scrollTo(0, 0);
}

async function boot() {
  app.innerHTML = '<div class="loading">Загружаем данные…</div>';

  try {
    const data = await loadAll();

    // В разработке сразу ругаемся на кривые данные, а не показываем пустые клетки.
    const problems = validateDataset(data);
    if (problems.length) {
      console.warn('Проблемы в данных:\n' + problems.join('\n'));
    }

    const standings = computeStandings(
      data.alliances,
      data.weeks,
      data.results,
      CONFIG.scoring,
      CONFIG.formLength
    );

    view = {
      ...data,
      standings,
      summary: computeWeekSummary(data.alliances, data.weeks, data.results),
      movers: computeMovers(standings),
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
