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
import { renderQuarter } from './pages/quarter-final.js';
import { renderTimeline } from './pages/timeline.js';
import { renderGuide } from './pages/guide.js';
import { renderAlliance } from './pages/alliance.js';
import { computeAchievements } from './logic/achievements.js';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';

const ROUTES = [
  { id: 'home', label: 'Итоги недели', render: renderHome },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'ladder', label: 'Рейтинг', render: renderLadder },
  { id: 'timeline', label: 'Хронология', render: renderTimeline },
  { id: 'guide', label: 'Малым алам', render: renderGuide },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const bootLoader = document.getElementById('boot-loader');
const isFirstVisit = !document.documentElement.classList.contains('s33-loader-seen');
const bootStartedAt = performance.now();

function finishBootLoader() {
  if (!bootLoader || !isFirstVisit) return;
  const wait = Math.max(0, 420 - (performance.now() - bootStartedAt));
  window.setTimeout(() => {
    bootLoader.classList.add('is-hidden');
    document.documentElement.classList.add('s33-loader-seen');
    try { localStorage.setItem('s33-loader-seen', '1'); } catch (_) {}
    window.setTimeout(() => bootLoader.remove(), 340);
  }, wait);
}

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
let scrollRevealObserver = null;
let parallaxFrame = 0;
let parallaxReady = false;

function setupParallax() {
  const hasHero = Boolean(app.querySelector('.hero'));
  if (!hasHero || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (parallaxReady) return;
  parallaxReady = true;

  const updateParallax = () => {
    parallaxFrame = 0;
    const y = Math.min(window.scrollY || 0, 140);
    document.documentElement.style.setProperty('--s33-parallax-y', `${y}px`);
  };
  const requestParallax = () => {
    if (!parallaxFrame) parallaxFrame = requestAnimationFrame(updateParallax);
  };
  window.addEventListener('scroll', requestParallax, { passive: true });
  window.addEventListener('resize', requestParallax, { passive: true });

  const canTrackPointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  if (canTrackPointer) {
    window.addEventListener('pointermove', (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      document.documentElement.style.setProperty('--s33-parallax-x', `${(x * 8).toFixed(2)}px`);
      document.documentElement.style.setProperty('--s33-parallax-pointer-y', `${(y * 5).toFixed(2)}px`);
    }, { passive: true });
  }
  requestParallax();
}

function setupMobileScrollReveal() {
  if (scrollRevealObserver) scrollRevealObserver.disconnect();
  const isTouch = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  if (!isTouch || !('IntersectionObserver' in window)) return;

  const revealables = app.querySelectorAll(
    '.hero, .panel, .quart-hero, .quart-board, .achievements-panel, .tl__item, .lad__row, .card, .leader, .podium-card, .quart-card, .achievement'
  );
  scrollRevealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-scroll-visible');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  revealables.forEach((element, index) => {
    element.classList.add('scroll-reveal');
    element.style.setProperty('--scroll-delay', `${Math.min(index * 38, 220)}ms`);
    scrollRevealObserver.observe(element);
  });
}

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

  setupMobileScrollReveal();
  setupParallax();
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
      achievements: computeAchievements(data.alliances, data.weeks, data.results),
      problems,
    };

    document.getElementById('source-badge').textContent = db.name;
    render();
    finishBootLoader();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<section class="panel error">
      <h2>Не удалось загрузить данные</h2>
      <p>${String(err.message ?? err)}</p>
      <p class="muted">Источник: <b>${CONFIG.dataSource}</b>. Проверьте настройки в config.js.</p>
    </section>`;
    finishBootLoader();
  }
}

window.addEventListener('hashchange', render);
boot();

// Пригодится при отладке из консоли браузера.
Object.assign(window, { __app: () => view, __caps: capabilities });
