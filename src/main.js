import { CONFIG } from '../config.js?v=83';
import { loadAll, capabilities, db, lastLoad } from './data/index.js?v=83';
import { siteServer, viewServer } from './data/server.js?v=83';
import { validateDataset } from './data/contract.js?v=83';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
  computeQuarterWindow,
  computeWindowForm,
} from './logic/standings.js?v=83';
import { renderHome } from './pages/home.js?v=83';
import { renderLadder } from './pages/ladder.js?v=83';
import { renderQuarter } from './pages/quarter-final.js?v=83';
import { renderTimeline } from './pages/timeline.js?v=83';
import { renderGuide } from './pages/guide.js?v=83';
import { renderBot } from './pages/bot.js?v=83';
import { renderHandbook } from './pages/handbook.js?v=83';
import { renderAbout } from './pages/about.js?v=83';
import { renderAlliance } from './pages/alliance.js?v=83';
import { computeAchievements } from './logic/achievements.js?v=83';
import { esc } from './ui/helpers.js?v=83';
import { presidentBoardFromTexts } from './logic/president-board.js?v=83';
import { startQuarterTimer } from './ui/quarter-timer.js?v=83';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js?v=83';
import './ui/timeline-controls.js?v=83';
// Поиск по справочнику: поле перерисовывает только список результатов.
import './ui/handbook-controls.js?v=83';
import { mountForum, mountUser, syncForumView, unmountForum } from './forum/mount.js?v=83';
import { mountChats, unmountChats, unreadChatsTotal } from './forum/chats.js?v=83';
import { mountTournaments, unmountTournaments } from './forum/tournaments.js?v=83';
import { mountGuides, unmountGuides } from './forum/guides.js?v=83';
import { mountCalendar, unmountCalendar } from './forum/calendar.js?v=83';
import { mountUpdates, unmountUpdates } from './forum/updates.js?v=83';
/*
  Ряд серверов в шапке сам вешает обработчик клика, но после каждой перерисовки
  страницы его надо перекрасить: какая вкладка открыта, знает только main.js.
*/
import { loadServerSwitch, syncServerSwitch } from './ui/server-switch.js?v=83';

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
  /*
    Форум — первый и главный: сайт из «таблицы итогов» стал местом, где
    сервер разговаривает. Таблицы никуда не делись, они ниже, но входная
    дверь — обсуждение. Чаты — второй пункт: закрытые комнаты альянсов.
  */
  { id: 'forum', label: 'Форум', live: true, primary: true },
  { id: 'chats', label: 'Чаты', live: true, primary: true },
  { id: 'tournaments', label: 'Турниры', live: true, primary: true },
  { id: 'guides', label: 'Гайды', live: true, primary: true },
  { id: 'calendar', label: 'Календарь', live: true, primary: true },
  /*
    Пульс обновлений — живой, но не «общение»: здесь не спорят, здесь читают
    то, что изменилось в игре за последние недели. Поэтому он в группе
    «Сервер», рядом с хроникой, а не в меню рядом с форумом.
  */
  { id: 'updates', label: 'Обновления игры', live: true },
  /*
    Справочник — текст самой игры, перенесённый из Telegram-бота один в один.
    Своей вкладки у него больше нет: он живёт внутри «Гайдов», под списком
    авторских разборов. `hidden: true` убирает его из меню, но маршрут и
    адреса узлов (#/handbook/<узел>) остаются — по ним ведут ссылки, уже
    лежащие в чатах и закладках.
  */
  { id: 'handbook', label: 'Справочник игры', hidden: true, navAs: 'guides' },
  { id: 'home', label: 'Итоги недели', render: renderHome },
  { id: 'quarter', label: 'Кварт', render: renderQuarter },
  { id: 'ladder', label: 'Рейтинг', render: renderLadder },
  { id: 'timeline', label: 'Хронология', render: renderTimeline },
  { id: 'guide', label: 'Малым алам', render: renderGuide },
  { id: 'bot', label: 'Бот в ТГ', render: renderBot },
  { id: 'about', label: 'О проекте', render: renderAbout },
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

/* ── Тема (светлая / тёмная) ──────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('s33-theme', theme); } catch (_) {}
}
function initTheme() {
  try {
    const saved = localStorage.getItem('s33-theme');
    if (saved) applyTheme(saved);
  } catch (_) {}
}
initTheme();

/* ── Таймер Кварта ───────────────────────────────────────────────────── */
/* Живёт в ui/quarter-timer.js: он нужен и странице Кварта (роут quarter),
   и боковой колонке форума, поэтому вынесен в общий модуль. */

function finishBootLoader() {
  if (!bootLoader || !isFirstVisit) return;
  const wait = Math.max(0, 180 - (performance.now() - bootStartedAt));
  window.setTimeout(() => {
    bootLoader.classList.add('is-hidden');
    document.documentElement.classList.add('s33-loader-seen');
    try { localStorage.setItem('s33-loader-seen', '1'); } catch (_) {}
    window.setTimeout(() => bootLoader.remove(), 340);
  }, wait);
}

/*
  ЕСЛИ ДАННЫЕ НЕ ИДУТ — НАДО НАЗВАТЬ ПРИЧИНУ, А НЕ КРУТИТЬ ТОЧКИ.

  Молчание базы на бесплатном тарифе (проекты засыпают без запросов и
  просыпаются десятью секундами будки) человек читает ровно так, как ему
  сказано в жалобе: «бесконечная загрузка и белый экран». Сайт в этот момент
  жив — форум, календарь, справочник и обновления не обращаются к таблице
  результатов, — но со стороны это выглядит как смерть страницы.

  Поэтому через CONFIG.slowBootSeconds ожидания waiting UI говорит правду и
  предлагает повтор. Объяснение появляется в двух местах, потому что их видно
  в разных случаях: плашка первого захода поверх всей страницы и заглушка
  «Загружаем данные…» внутри страницы, когда плашки уже не было.

  Там же появляется запасной адрес. Ждать данных бессмысленно, когда режет не
  база, а путь до хостинга: у `.bond` в мобильном интернете бывают устаревший
  DNS и оборванный TLS, и в этот момент сайт жив ровно на зеркале.
*/
let slowBootTimer = 0;
let dataArrived = false;

const SLOW_BOOT_TEXT = 'Данные не идут: база на бесплатном тарифе засыпает без '
  + 'запросов, и первый заход будит её десять секунд и больше. Форум, календарь, '
  + 'справочник и обновления работают — они эти данные не ждут.';

/**
 * Ссылка на запасной адрес: пустая строка, если человек уже на зеркале
 * (предлагать ему тот же путь — значит предлагать то, что не открылось).
 */
function mirrorLinkHtml() {
  const here = String(location.hostname || '');
  if (here.endsWith('.github.io')) return '';
  const url = CONFIG.mirrorUrl + (location.hash || '');
  return `<p class="boot-loader__mirror" data-boot-mirror>`
    + `<a href="${esc(url)}" rel="noopener">Запасной адрес сайта</a></p>`;
}

function showSlowBootNotice() {
  if (dataArrived) return;
  const mirror = mirrorLinkHtml();

  if (bootLoader && !bootLoader.classList.contains('is-hidden')
    && !bootLoader.querySelector('[data-boot-slow]')) {
    bootLoader.querySelector('.boot-loader__core')?.insertAdjacentHTML('beforeend',
      `<p class="boot-loader__slow" data-boot-slow>${esc(SLOW_BOOT_TEXT)}</p>${mirror}`);
  }

  const box = app.querySelector('.loading');
  if (box && !box.querySelector('[data-boot-slow]')) {
    box.classList.add('is-honest');
    box.innerHTML = `<span data-boot-slow>${esc(SLOW_BOOT_TEXT)}</span>
      ${mirror}
      <button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button>`;
  }
}

function armSlowBootNotice() {
  dataArrived = false;
  window.clearTimeout(slowBootTimer);
  slowBootTimer = window.setTimeout(showSlowBootNotice, CONFIG.slowBootSeconds * 1000);
}

document.addEventListener('click', (e) => {
  // Повтор — тот же путь, что при открытии страницы: он заново вооружает ожидание.
  if (e.target.closest?.('[data-boot-retry]')) boot();
});

/** @type {any} */
let view = null;

/*
  Сервер, ЧЬИ ДАННЫЕ ЛЕЖАТ В `view`. Отдельное число, а не поле внутри view:
  страницы читают набор целиком, и одно число отвечает на вопрос «свежее ли то,
  что мы собираемся нарисовать». См. проверку в render().
*/
let viewServerLoaded = null;

/**
 * Адрес вида #/ladder или #/alliance/a05.
 * Второй сегмент — параметр страницы.
 *
 * Хвост после «?» — фильтры живой страницы (#/forum?cat=vs&sort=top); его
 * разбирает сама страница, здесь он только не должен попасть в id:
 * «forum?cat=vs» среди вкладок не числится, и без этого разделения пункт меню
 * подсвечивался бы наугад, а параметром страницы считался бы «vs».
 */
function parseHash() {
  const [path, search] = location.hash.replace(/^#\/?/, '').split('?');
  const [id, param] = path.split('/');
  return { id: id || 'forum', param: param || null, search: search || '' };
}

function renderNav(activeId) {
  /* Какую вкладку подсветить, когда страница открыта: у раздела без своего
     пункта меню (`hidden`) это чужая вкладка — `navAs`. */
  const navId = (r) => r.navAs || r.id;

  /*
    aria-current сообщает экранному диктору, где человек находится. Подсветка
    цветом об этом говорит только тем, кто видит: без атрибута незрячий
    слышит семь одинаковых ссылок и не знает, какая открыта.
  */
  const link = (r) => `<a href="#/${r.id}" class="nav__link ${navId(r) === activeId ? 'is-active' : ''}${
      r.primary ? ' nav__link--primary' : ''
    }"${navId(r) === activeId ? ' aria-current="page"' : ''}>${r.label}${
      r.id === 'chats' ? '<span class="nav__badge" data-nav-chats-badge hidden></span>' : ''
    }</a>`;
  /*
    `hidden` — раздел без своего пункта меню: страница существует и открывается
    по адресу, но в оглавлении её нет. Справочник живёт внутри «Гайдов», и две
    соседние ссылки на один и тот же вопрос («как это работает») читались бы
    как спор двух разделов за место в списке.
  */
  const shown = ROUTES.filter((r) => !r.hidden);
  const primary = shown.filter((r) => r.primary);
  const rest = shown.filter((r) => !r.primary);
  /*
    Две группы с подписью между ними: «Общение» и «Сервер». Меню читается
    как оглавление, а не как семь равнозначных ссылок, — сразу видно, что
    на сайте главное.
  */
  nav.innerHTML =
    `<span class="nav__group">Общение</span>${primary.map(link).join('')}` +
    `<span class="nav__group">Сервер</span>${rest.map(link).join('')}`;
  refreshChatsBadge();
}

/*
  Счётчик непрочитанных у пункта «Чаты». Считается при каждой смене раздела
  и раз в минуту — этого хватает: внутри чата свои обновления.
*/
let badgeTimer = 0;
async function refreshChatsBadge() {
  const n = await unreadChatsTotal();
  const el = nav.querySelector('[data-nav-chats-badge]');
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
  window.clearTimeout(badgeTimer);
  badgeTimer = window.setTimeout(refreshChatsBadge, 60000);
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

/* ── Переключатель темы ─────────────────────────────────────────────── */
document.getElementById('theme-toggle')?.addEventListener('click', () => {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
});

function renderPresidentBoard(texts = []) {
  if (!presidentBoard) return;
  const board = presidentBoardFromTexts(texts);
  presidentBoard.hidden = !board.enabled;
  presidentBoard.innerHTML = board.enabled ? `
    <div class="president-board__head">
      <span class="president-board__signal" aria-hidden="true"></span>
      <span class="president-board__label">${esc(board.label)}</span>
      <span class="president-board__live">СВЕЖИЕ</span>
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

/*
  АДРЕС ЖИВОЙ ВКЛАДКИ, КОТОРАЯ УЖЕ СМОНТИРОВАНА.

  Живые вкладки (форум, чаты, календарь, обновления, гайды, страница
  участника) монтируются один раз и живут сами: ждут ответа базы, перекрашиваются
  от нажатий. Обычный render() после прихода данных сайта перемонтировал их
  заново — а это значит сбросить незавершённые запросы базы, показать «Загружаем
  ленту…» там, где лента уже была на экране, и потом нарисовать её вторично.
  На телефоне, где база просыпается десять секунд, это и были те самые рывки.

  Поэтому повторный вход на тот же адрес не монтирует страницу заново, а только
  отдаёт ей свежие данные сайта — там, где они вообще нужны.
*/
let liveMountKey = '';

/**
 * Ключ живой вкладки для её адреса: пустая строка — страница статичная,
 * её перерисовка ничего не сбрасывает и спорить с монтированием не может.
 */
function liveKeyOf(id, param, search) {
  if (id === 'forum') return `forum:${param || ''}:${search}`;
  if (id === 'user' && param) return `user:${param}`;
  if (id === 'calendar') return `calendar:${search}`;
  if (id === 'guides') return `guides:${param || ''}:${search}`;
  if (id === 'updates') return 'updates';
  if (id === 'chats') return `chats:${location.hash.replace(/^#\/?chats\/?/, '')}`;
  return '';
}

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
  const { id, param, search } = parseHash();
  renderPresidentBoard(view.texts);

  /*
    Повторный вход на адрес живая вкладка пропускает: она уже на экране и
    сама себя рисует. Форума это касается в первую очередь — ему от данных
    сайта нужна только плашка хроники, её отдаём отдельным установщиком, и
    лента продолжает грузиться тем же запросом, который уже ушёл в базу.

    Статичные страницы под этим условием перерисовываются как раньше: им
    нечего терять, они и есть строка из данных.
  */
  const live = liveKeyOf(id, param, search);
  if (live && live === liveMountKey) {
    if (id === 'forum') syncForumView(view);
    return;
  }

  /*
    ОДИН ВЫБОР СЕРВЕРА ПРОВЕРЯЕТСЯ И НА ССЫЛКАХ, А НЕ ТОЛЬКО НА РЯДЕ В ШАПКЕ.

    Ряд зовёт refreshView сам, но память браузера пишет и переключатель над
    лентой форума. Игрок перещёлкивает её на 44-й и жмёт «Рейтинг» — экран
    собран из данных 33-го под заголовком, называющим 44-й. Это ровно то
    вранье, ради которого весь шаг и делался, поэтому набор перечитывается.

    Живые вкладки не ждём: они читают свою таблицу, а данным сайта они должны
    только плашкой хроники, та перерисуется по приходе ответа.
  */
  if (viewServerLoaded !== viewServer()) {
    if (!live) app.innerHTML = '<div class="loading">Загружаем данные…</div>';
    refreshView();
    if (!live) return;
  }
  liveMountKey = live;

  let path;
  if (id === 'alliance' && param) {
    // Карточка альянса не своя вкладка, поэтому в меню подсвечиваем рейтинг,
    // откуда сюда и приходят.
    unmountForum();
    unmountChats();
    unmountCalendar();
    unmountUpdates();
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
    unmountForum();
    unmountChats();
    unmountTournaments();
    unmountGuides();
    unmountCalendar();
    unmountUpdates();
    renderNav('forum');
    app.innerHTML = '';
    mountUser(app, decodeURIComponent(param));
    path = '/user';
  } else {
    const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
    renderNav(route.navAs || route.id);

    if (route.id === 'chats') {
      unmountForum();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
      app.innerHTML = '';
      // Второй сегмент — id чата; ссылка-приглашение: #/chats/join/<код>.
      const rest = location.hash.replace(/^#\/?chats\/?/, '');
      mountChats(app, rest ? decodeURIComponent(rest) : null);
      path = rest ? '/chats/room' : '/chats';
    } else if (route.id === 'tournaments') {
      unmountForum();
      unmountChats();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
      app.innerHTML = '';
      mountTournaments(app, view.alliances);
      path = '/tournaments';
    } else if (route.id === 'guides') {
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountCalendar();
      unmountUpdates();
      app.innerHTML = '';
      /*
        Второй сегмент — slug гайда: #/guides/na-sklad. Берём его из разобранного
        адреса, а не из хвоста строки: адрес страницы несёт и фильтры
        (#/guides?q=засада), и в хвосте они превратились бы в часть имени,
        которого в базе нет.
      */
      mountGuides(app, param ? decodeURIComponent(param) : null);
      path = param ? '/guides/slug' : '/guides';
    } else if (route.id === 'calendar') {
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountUpdates();
      app.innerHTML = '';
      /*
        Хвост адреса хранит вид календаря (#/calendar?view=mine): ссылка на
        «Моё расписание» должна открываться именно на нём, иначе человек
        приходит за своими ответами, а попадает в общий список.
      */
      mountCalendar(app, search);
      path = '/calendar';
    } else if (route.id === 'updates') {
      /*
        У списка обновлений нет хвоста в адресе: одна страница, один порядок,
        и ссылка из чата обязана открывать ровно то, что видит тот, кто в неё
        перешёл, — а не то же самое, но с открытой формой.
      */
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      app.innerHTML = '';
      mountUpdates(app);
      path = '/updates';
    } else if (route.id === 'handbook') {
      /*
        Справочник больше не отдельная вкладка: он живёт внутри «Гайдов»
        (см. handbookBlock в pages/guides.js). Отдельные адреса у узлов остались
        — по ним ведут ссылки, уже разосланные в чаты, и страница узелка
        по-прежнему рисуется целиком, со своими хлебными крошками.

        Пустой адрес (#/handbook, в том числе с запросом #/handbook?q=засада)
        переводим на вкладку: там и поле поиска, и список разделов. Молчать
        или показывать половину страницы значило бы наказывать за старую
        ссылку из меню. Запрос сохраняется: «вот это место в правиле» пересылают
        ссылкой, и она обязана открываться уже с результатами.
      */
      if (!param) {
        location.replace(`${location.pathname}${location.search}#/guides${search ? `?${search}` : ''}`);
        return;
      }
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
      app.innerHTML = renderHandbook({ guideId: param });
      path = '/handbook/node';
    } else if (route.live) {
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
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
      mountForum(app, view, param, search);
      path = param ? `/forum/${param}` : '/forum';
    } else {
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
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
      // Запуск таймера Кварта, если открыта страница Кварта.
      if (route.id === 'quarter') startQuarterTimer();
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
  const keepScroll = (id === 'forum' && param) || id === 'chats';
  if (!keepScroll) window.scrollTo(0, 0);

  trackPageview(path);
  /*
    Ряд серверов перекрашивается в самый конец: ему нужно знать и открытую
    страницу (на форуме своего ряда хватает), и выбранный сервер, а оба этих
    факта становятся достоверны только когда экран собран.
  */
  syncServerSwitch();
}

/**
 * ПУСТОЙ НАБОР, С КОТОРЫМ САЙТ ЖИВЁТ ДО ПРИХОДА ДАННЫХ (ИЛИ ВМЕСТО НИХ).
 *
 * Единая форма для двух мест: пустой кадр, с которым рисуются живые вкладки
 * до загрузки, и пустой кадр после падения загрузки. У них один и тот же
 * набор полей — иначе «живём с пустотой» и «всё упало» разъехались бы и
 * повели себя по-разному.
 */
function emptyView(loadError = '') {
  return {
    alliances: [], weeks: [], allWeeks: [], results: [], events: [], texts: [],
    standings: [], quarterStandings: [],
    // Форма — как у computeQuarterWindow: пустой кадр не должен отличаться
    // полями от настоящего, иначе страница Кварта упадёт до прихода данных.
    quarter: { weeks: [], playedWeeks: 0, number: 0, startNumber: 0, endNumber: 0, endDate: null },
    summary: null, movers: { up: [], down: [] },
    placeHistory: new Map(), achievements: new Map(),
    problems: [],
    loadError,
  };
}

/**
 * ПОЛОСКА «ОТКУДА ДАННЫЕ НА ЭКРАНЕ».
 *
 * Прошлое поведение на пустом рейтинге было молчаливым: сайт вставлял пустой
 * кадр и человек оставался один на один с таблицей без цифр. Для читателя это
 * не «источник недоступен», а «сайт умер», и он закрывает вкладку.
 *
 * Теперь источник говорит сам: снимок — так и написано, каким часом снят и что
 * именно он замораживает (форум, вход и запись постов живут только в базе).
 * Кнопка «Повторить» дёргает тот же обработчик, что и в объяснении долгого
 * ожидания: [data-boot-retry] уже слушается на странице.
 */
function dataNotice() {
  const box = document.getElementById('data-notice');
  if (!box) return;

  if (lastLoad.source === 'снимок') {
    const at = snapshotStamp(lastLoad.snapshotAt);
    box.hidden = false;
    box.innerHTML =
      '<b>Показан снимок таблицы' + (at ? ' от ' + esc(at) : '') + '</b>. '
      + 'База сейчас не отвечает, а это автоматическая копия данных, снятая в '
      + 'это время: рейтинг, кварты и летопись верны на неё. Форум, вход и '
      + 'новые посты живут только в живой базе — они появятся, как только она '
      + 'ответит. '
      + '<button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button>';
    return;
  }

  if (lastLoad.source === '') {
    /*
      Хвостовая точка убирается, а не оставляется: сообщения адаптера приходят
      уже с точкой, и без этой чистки страница выдавала «Проверьте интернет..».
      Два знака подряд читаются как опечатка, а опечатка в тексте про аварию
      выглядит так, будто ей не верят.

      Отдельная фраза — про выбранный сервер. Копия `data/live.json` снята с
      одного набора, и под чужим сервером сайт обязан сказать, что спасения
      копией нет, а не просто «не дошли»: человек, выбравший 44-й, прочитал бы
      молчание как «44-й не работает», хотя не работает только путь к базе.
    */
    const reason = (lastLoad.primaryError || 'ни база, ни снимок рядом с сайтом не ответили')
      .replace(/[.\s]+$/, '');
    const own = siteServer();
    const foreign = lastLoad.server != null && lastLoad.server !== own;
    box.hidden = false;
    box.innerHTML =
      '<b>Данные не дошли</b>: '
      + esc(reason)
      + '.'
      + (foreign
        ? ` Копия данных сайта есть только для сервера сайта`
          + (own == null ? '' : ` (${own})`)
          + `, а для ${lastLoad.server} её нет.`
        : '')
      + ' Рейтинг и летопись пусты, справочник и правила работают. '
      + '<button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button>';
    return;
  }

  box.hidden = true;
  box.innerHTML = '';
}

/**
 * Отметка снимка для человека: «30.09, 09:56» вместо полного ISO-адреса.
 * Пустая строка, если в файле даты нет или она не читается — показывать
 * «снимок от null» честнее не делает.
 *
 * Формат даты приходится подправлять. Отметку в снимок пишет база, а она
 * отдаёт часовой пояс коротким хвостом: «2026-09-30T09:56:20+00». Конструктор
 * Date такой хвост не понимает и молча возвращает «не дата», поэтому без
 * замены на «+00:00» полоска всегда показывала бы снимок без часа — а именно
 * час в ней и есть главная часть правды.
 */
function snapshotStamp(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Надпись в подвале про источник данных: база, снимок или никого. */
function sourceBadge() {
  const badge = document.getElementById('source-badge');
  if (!badge) return;
  badge.textContent = lastLoad.source === 'снимок' ? 'снимок'
    : lastLoad.source === '' ? 'недоступен'
      : db.name;
}

async function boot() {
  /*
    ФОРУМ НЕ ЖДЁТ ДАННЫХ САЙТА — ОН ИХ И НЕ ИСПОЛЬЗУЕТ.

    Главная вкладка — форум, а данные сайта едут из той же базы отдельным
    запросом, который может опоздать или упасть: Supabase усыпляет проекты
    на тарифе free, и первый заход будит базу по десять секунд и больше.
    Раньше render() вызывался только после loadAll(), и лента форума даже
    не начинала грузиться, пока ждали данные. Человеку это виделось как
    «форум не грузится с первого раза».

    Поэтому живые вкладки (форум и страница участника) рисуем сразу, ещё
    пустым контуром: им от данных сайта нужна только плашка хроники в шапке,
    и она допишется, когда данные приедут. А сами данные грузятся фоном.

    Справочник попадает в этот же список по другой причине: ему не нужны ни
    база, ни данные сайта — всё дерево лежит рядом с ним в репозитории. Ждать
    пробуждения базы, чтобы открыть правило про засаду, значит платить десятью
    секундами за чужую сонливость.
  */
  const { id, param } = parseHash();
  const liveFirst = id === 'forum' || id === 'chats' || id === 'calendar'
    || id === 'updates' || id === 'handbook' || (id === 'user' && param);

  app.innerHTML = liveFirst ? '' : '<div class="loading">Загружаем данные…</div>';
  if (liveFirst) {
    view = emptyView();
    /*
      Пустой контур живой вкладки — честный ответ «данных пока нет», а не
      набор чужого сервера, поэтому проверка в render() не должна считать его
      устаревшим и звать вторую загрузку подряд с первой.
    */
    viewServerLoaded = viewServer();
    render();
  }

  /*
    Ряд сервера в шапке стартует рядом с лентой, а не после данных сайта:
    ему нужен только список серверов, и ждать ради него рейтинг значило бы
    показывать шапку без выбора там, где выбор уже был бы уместен.
  */
  loadServerSwitch();
  await refreshView();
}

/**
 * ДАННЫЕ САЙТА ЗАНОВО: один и тот же путь при входе на страницу и после
 * щелчка по ряду серверов.
 *
 * Разведено в две функции не для красоты: переключателю нужно перечитать
 * рейтинг, не перемонтируя форум и не теряя незавершённые запросы ленты, а
 * входу нужно ещё и решить, рисовать ли пустой контур. Всё, что относится к
 * ответу базы, — общее, и вторая копия этого куска однажды разошлась бы с
 * первой: молчание при смене сервера выглядело бы как «сайт не обновился».
 */
async function refreshView() {
  armSlowBootNotice();

  /*
    Сервер, ради которого ждём ответ, запоминаем до запроса: ряд в шапке
    позволяет несколько щелчков подряд, и если поздний выбор прилетел, пока ранний
    запрос ещё в пути, старый ответ не должен перетирать экран.
  */
  const requested = viewServer();

  try {
    const data = await loadAll();
    if (requested !== viewServer()) return;
    viewServerLoaded = requested;
    dataArrived = true;

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

    sourceBadge();
    dataNotice();
    render();
    finishBootLoader();
  } catch (err) {
    console.error(err);
    // Тот же порядок, что в удачной ветке: опоздавшая авария не должна
    // затушить экран, который поздний запрос уже наполняет.
    if (requested !== viewServer()) return;
    // Пустой набор тоже относится к названному серверу: иначе render()
    // звал бы перечитывание на каждой перерисовке страницы.
    viewServerLoaded = requested;
    // Ответ получен, пусть и с ошибкой: объяснять молчание больше нечего.
    dataArrived = true;

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
    view = emptyView(String(err.message ?? err));

    const badge = document.getElementById('source-badge');
    if (badge) badge.textContent = 'недоступен';
    dataNotice();

    render();
    finishBootLoader();
  }
}

window.addEventListener('hashchange', render);

/*
  ЩЕЛЧОК ПО РЯДУ СЕРВЕРОВ.

  Модуль ряда сделал своё: записал выбор в память браузера и в адрес и перекрасил
  кнопки. Перечитать рейтинг он сам не может — данные сайта живут здесь, — и
  поэтому зовёт через событие, а не импортирует refreshView: круговая зависимость
  main.js ↔ server-switch.js оборвала бы загрузку страницы целиком.

  Форум при этом не перемонтируется: refreshView только меняет view и зовёт
  render(), а render() для живой вкладки отдан ленте, которая сама перечитает
  ленту по своему ряду.
*/
window.addEventListener('zr33:server-change', () => { refreshView(); });

boot();

// Пригодится при отладке из консоли браузера.
Object.assign(window, { __app: () => view, __caps: capabilities });
