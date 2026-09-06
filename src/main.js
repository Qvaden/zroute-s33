import { CONFIG } from '../config.js?v=13';
import { loadAll, capabilities, db } from './data/index.js?v=13';
import { validateDataset } from './data/contract.js?v=13';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
  computeQuarterWindow,
  computeWindowForm,
} from './logic/standings.js?v=13';
import { renderHome } from './pages/home.js?v=13';
import { renderLadder } from './pages/ladder.js?v=13';
import { renderQuarter } from './pages/quarter-final.js?v=13';
import { renderTimeline } from './pages/timeline.js?v=13';
import { renderGuide } from './pages/guide.js?v=13';
import { renderBot } from './pages/bot.js?v=13';
import { renderAlliance } from './pages/alliance.js?v=13';
import { computeAchievements } from './logic/achievements.js?v=13';
import { esc } from './ui/helpers.js?v=13';
import { presidentBoardFromTexts } from './logic/president-board.js?v=13';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';
import { mountForum, mountUser, unmountForum } from './forum/mount.js?v=13';

/*
  РАЗДЕЛЫ.

  Порядок здесь — это порядок в боковом меню, и он же расставляет приоритеты.
  Форум стоит первым и открывается по умолчанию: сайт начинался как таблица
  результатов, а стал местом, куда заходят разговаривать. Хроника сервера
  теперь встречает человека на форуме короткой сводкой, а «Хронология»
  осталась отдельной вкладкой со всем архивом — это разные вопросы:
  «что сейчас» и «что было за всю историю».

  Итоги VS никуда не убраны и остаются полноценной вкладкой: ради них сайт
  и появился.

  `live: true` помечает разделы, которые не просто рисуются строкой, а живут
  во времени: ждут ответа базы, принимают ввод. Такому разделу мало вернуть
  разметку — ему нужен свой запуск и остановка при уходе.
*/
const ROUTES = [
  { id: 'forum', label: 'Форум', live: true },
  { id: 'home', label: 'Итоги недели', render: renderHome },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'ladder', label: 'Рейтинг', render: renderLadder },
  { id: 'timeline', label: 'Хронология', render: renderTimeline },
  { id: 'guide', label: 'Малым алам', render: renderGuide },
  { id: 'bot', label: 'Бот в ТГ', render: renderBot },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const presidentBoard = document.getElementById('president-board');
const bootLoader = document.getElementById('boot-loader');
const side = document.getElementById('side');
const sideToggle = document.getElementById('side-toggle');
const sideVeil = document.getElementById('side-veil');
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
  return { id: id || 'forum', param: param || null };
}

function renderNav(activeId) {
  /*
    aria-current сообщает экранному диктору, где человек находится. Подсветка
    цветом об этом говорит только тем, кто видит: без атрибута незрячий
    слышит семь одинаковых ссылок и не знает, какая открыта.
  */
  nav.innerHTML = ROUTES.map(
    (r) => `<a href="#/${r.id}" class="nav__link ${r.id === activeId ? 'is-active' : ''}"${
      r.id === activeId ? ' aria-current="page"' : ''
    }>${r.label}</a>`
  ).join('');
}

/* ── Боковое меню ─────────────────────────────────────────────────────────── */

/*
  На узком экране панель выдвигается поверх страницы. Состояние держится
  классом на <html>, а не на самой панели: затемнение, сдвиг содержимого
  и запрет прокрутки под меню — это про всю страницу, а не про меню.
*/
function setSideOpen(open) {
  document.documentElement.classList.toggle('is-side-open', open);
  sideToggle?.setAttribute('aria-expanded', String(open));
  if (sideVeil) sideVeil.hidden = !open;

  /*
    Фокус переносим внутрь панели и обратно на кнопку. Без этого человек,
    открывший меню с клавиатуры, остаётся фокусом на кнопке, а следующий Tab
    уводит его в содержимое страницы — то есть меню открылось, но добраться
    до вкладок нельзя.
  */
  if (open) side?.querySelector('.nav__link')?.focus({ preventScroll: true });
  else if (document.activeElement && side?.contains(document.activeElement)) {
    sideToggle?.focus({ preventScroll: true });
  }
}

function isSideOpen() {
  return document.documentElement.classList.contains('is-side-open');
}

sideToggle?.addEventListener('click', () => setSideOpen(!isSideOpen()));
sideVeil?.addEventListener('click', () => setSideOpen(false));

/*
  Переход по разделу закрывает меню. Без этого на телефоне человек нажимает
  вкладку и остаётся смотреть на меню, а не на страницу, за которой пришёл.
*/
side?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setSideOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isSideOpen()) setSideOpen(false);
});

/*
  Экран стал широким — панель видна всегда, и «открытое» состояние теряет
  смысл. Если его не снять, останется висеть затемнение поверх страницы:
  поворот телефона превращался в неработающий сайт.
*/
window.matchMedia('(min-width: 1040px)').addEventListener('change', (e) => {
  if (e.matches) setSideOpen(false);
});

function renderPresidentBoard(texts = []) {
  if (!presidentBoard) return;
  const board = presidentBoardFromTexts(texts);
  presidentBoard.hidden = !board.enabled;
  presidentBoard.innerHTML = board.enabled ? `
    <div class="president-board__head">
      <span class="president-board__signal" aria-hidden="true"></span>
      <span class="president-board__label">${esc(board.label)}</span>
      <span class="president-board__live">LIVE</span>
    </div>
    <div class="president-board__identity">
      <strong class="president-board__name">${esc(board.name)}</strong>
      <span class="president-board__alliance">${esc(board.alliance)}</span>
    </div>
    ${board.note ? `<small class="president-board__note">${esc(board.note)}</small>` : ''}
  ` : '';
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
    '.hero, .panel, .quart-hero, .quart-board, .achievements-panel, .tl__item, .lad__row, .card, .leader, .podium-card, .quart-card, .achievement, .bot-feature, .bot-launch, .bot-promise, .bot-final, .role-card'
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
  renderPresidentBoard(view.texts);

  let path;
  if (id === 'alliance' && param) {
    // Карточка альянса не своя вкладка, поэтому в меню подсвечиваем рейтинг,
    // откуда сюда и приходят.
    unmountForum();
    renderNav('ladder');
    app.innerHTML = renderAlliance(view, param);
    path = `/alliance/${param}`;
  } else if (id === 'user' && param) {
    /*
      Страница участника: #/user/Ковыль. Своей вкладки у неё нет — приходят
      сюда из ленты, нажав на ник, — поэтому в меню подсвечен форум.

      Ник в адресе закодирован, а русские буквы браузер кодирует сам:
      без decodeURIComponent пришло бы «%D0%9A%D0%BE...» вместо имени.
    */
    renderNav('forum');
    app.innerHTML = '';
    mountUser(app, decodeURIComponent(param));
    path = '/user';
  } else {
    const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
    renderNav(route.id);

    if (route.live) {
      /*
        Живому разделу нельзя просто подставить строку: он сам решает, что
        показать, потому что ждёт ответа хранилища. Второй сегмент адреса —
        открытая тема (#/forum/p_abc), поэтому ссылку на пост можно кинуть
        в чат, и она откроется сразу на нём.

        mountForum не ждём: он рисует «загружаем» сам и дорисовывает по мере
        ответов. Ожидание здесь задержало бы прокрутку вверх и подсчёт
        посещения на время запроса к базе.
      */
      app.innerHTML = '';
      mountForum(app, view, param);
      path = param ? `/forum/${param}` : '/forum';
    } else {
      unmountForum();
      app.innerHTML = route.id === 'quarter'
        ? route.render({ standings: view.quarterStandings, quarter: view.quarter })
        : route.id === 'bot'
          ? route.render()
          : route.render(view);
      // Страницы рисуются строками разом, а фильтры живут в отдельных скриптах.
      // Без этого вызова состояние кнопок разойдётся с тем, что видно на экране.
      for (const fn of [window.__ladderApply, window.__timelineApply]) {
        if (typeof fn === 'function') fn();
      }
      path = `/${route.id}`;
    }
  }

  setupMobileScrollReveal();
  setupParallax();

  /*
    Прокрутку наверх делаем для обычных страниц, но НЕ для форума с открытой
    темой: ссылку на пост кидают в чат, и человек, перешедший по ней, должен
    попасть на пост, а не в начало страницы. Форум сам возвращает прокрутку
    после перерисовки, и внешний scrollTo здесь спорил бы с ним.
  */
  const keepScroll = id === 'forum' && param;
  if (!keepScroll) window.scrollTo(0, 0);

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

    /*
      ДАННЫЕ ОТВАЛИЛИСЬ, А ФОРУМ ОБЯЗАН РАБОТАТЬ.

      Раньше здесь всё заканчивалось страницей с ошибкой: без data/live.json
      показывать было нечего. Теперь главная вкладка — форум, и он с этим
      файлом не связан вовсе: посты лежат в другом месте.

      Поэтому вместо мёртвой страницы отдаём пустой набор данных. Рейтинг
      и хронология честно окажутся пустыми и объяснят почему, а форум
      откроется как обычно. Ронять разговор сообщества из-за недоступной
      таблицы результатов — плохая сделка.
    */
    view = {
      alliances: [], weeks: [], allWeeks: [], results: [], events: [], texts: [],
      standings: [], quarterStandings: [],
      quarter: { weeks: [], from: null, to: null },
      summary: null, movers: { up: [], down: [] }, placeHistory: [], achievements: [],
      problems: [],
      loadError: String(err.message ?? err),
    };

    const badge = document.getElementById('source-badge');
    if (badge) badge.textContent = 'недоступен';

    render();
    finishBootLoader();
  }
}

window.addEventListener('hashchange', render);
boot();

// Пригодится при отладке из консоли браузера.
Object.assign(window, { __app: () => view, __caps: capabilities });
