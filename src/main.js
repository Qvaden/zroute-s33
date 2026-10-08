import { CONFIG } from '../config.js';
import { loadAll, capabilities, lastLoad } from './data/index.js';
import { validateDataset } from './data/contract.js';
import {
  computeStandings,
  computeWeekSummary,
  computeMovers,
  computePlaceHistory,
  weeksUpToLastData,
  computeQuarterWindow,
  computeWindowForm,
} from './logic/standings.js';
import { renderHome } from './pages/home.js';
import { renderLadder } from './pages/ladder.js';
import { renderQuarter } from './pages/quarter-final.js';
import { renderTimeline } from './pages/timeline.js';
import { renderGuide } from './pages/guide.js';
import { renderBot } from './pages/bot.js';
import { renderAbout } from './pages/about.js';
import { renderAlliance } from './pages/alliance.js';
import { computeAchievements } from './logic/achievements.js';
import { esc } from './ui/helpers.js';
import { presidentBoardFromTexts } from './logic/president-board.js';
import { startQuarterTimer } from './ui/quarter-timer.js';
// Побочные импорты: вешают делегированные обработчики фильтров на страницах.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';
import { mountForum, mountUser, syncForumView, unmountForum } from './forum/mount.js';
import { mountChats, unmountChats, unreadChatsTotal } from './forum/chats.js';
import { mountTournaments, unmountTournaments } from './forum/tournaments.js';
import { mountCalendar, unmountCalendar } from './forum/calendar.js';
import { mountUpdates, unmountUpdates } from './forum/updates.js';
import { mountAccounts, unmountAccounts } from './forum/accounts.js';
import { forumReady } from './forum/index.js';

/*
  ДЕРЕВО СПРАВОЧНИКА ПРИХОДИТ НА МАРШРУТЕ, А НЕ НА ВХОДЕ.

  «Гайды» и страница узла справочника тянут за собой 167 КБ самих правил,
  разбор ленты гайдов, поле поиска и обработчики — пять модулей, 62 КБ по сети
  и пять запросов. Хостинг отвечает по HTTP/1.1 шестью соединениями сразу,
  и лишний запрос в стартовом графе — это очередь, а не мелочь: главная
  вкладка форума ждёт своих модулей дольше ровно на то время, что ушло бы на
  чужой раздел.

  Поэтому под дерево отведён один гейт: render() на маршрутах guides и
  handbook показывает «загружаем», догружает модули одним Promise.all и
  перерисовывает себя, когда те приходят. render() от этого не стал
  асинхронным — его зовут из входа, из прихода данных и из смены адреса,
  и в каждом из этих мест порядок теперь проверяется здесь, на входе.

  Снятые ветки (forum/, chats, календарь) вызывают unmountGuides() все до
  одной, включая те, что ещё не загружались: уход с несуществующей страницы
  ничего не должен ломать, поэтому обёртка ниже терпит пустой модуль.
*/
const guidesTree = { mods: null, loading: null };

function loadGuidesTree() {
  if (!guidesTree.loading) {
    guidesTree.loading = Promise.all([
      import('./forum/guides.js'),
      import('./pages/handbook.js'),
      // Поиск по справочнику: поле перерисовывает только список результатов.
      import('./ui/handbook-controls.js'),
    ]).then(([live, book]) => {
      guidesTree.mods = {
        mountGuides: live.mountGuides,
        unmountGuides: live.unmountGuides,
        renderHandbook: book.renderHandbook,
      };
      return guidesTree.mods;
    }, (err) => {
      guidesTree.loading = null;
      throw err;
    });
  }
  return guidesTree.loading;
}

const needsGuidesTree = new Set(['guides', 'handbook']);

const mountGuides = (...args) => guidesTree.mods.mountGuides(...args);
const unmountGuides = () => guidesTree.mods?.unmountGuides();
const renderHandbook = (...args) => guidesTree.mods.renderHandbook(...args);

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

    `title` и `desc` у каждого раздела свои: маршрут меняется без
    перезагрузки документа, и без этих строк браузер, история и поисковик
    видели бы одну и ту же вкладку на всех четырнадцати страницах.
  */
  {
    id: 'forum', label: 'Форум', live: true, primary: true,
    title: 'Форум сервера 33 · Z Route: Redemption',
    desc: 'Обсуждения 33 сервера: новости, разбор VS, летопись захватов, альянсы, вопросы по игре и свободные темы.',
  },
  {
    id: 'chats', label: 'Чаты', live: true, primary: true,
    title: 'Чаты альянсов · Сервер 33',
    desc: 'Комнаты альянсов на самом сайте: договорённости перед боем и разбор итогов — без внешних мессенджеров.',
  },
  {
    id: 'tournaments', label: 'Турниры', live: true, primary: true,
    title: 'Турниры альянсов · Сервер 33',
    desc: 'VS-матчапы двух альянсов со счётом по победам. Раунды засчитываются прямо на странице, победитель определяется сам.',
  },
  {
    id: 'guides', label: 'Гайды', live: true, primary: true,
    title: 'Гайды · Сервер 33',
    desc: 'Разборы от участников сервера 33 и официальный справочник игры: тактика, исследования, роли в альянсе.',
  },
  {
    id: 'calendar', label: 'Календарь', live: true, primary: true,
    title: 'Календарь сборов · Сервер 33',
    desc: 'Когда сервер собирается на бои: ближайшие события, ответы «иду / не иду» и моё расписание одной строкой.',
  },
  /*
    Пульс обновлений — живой, но не «общение»: здесь не спорят, здесь читают
    то, что изменилось в игре за последние недели. Поэтому он в группе
    «Сервер», рядом с хроникой, а не в меню рядом с форумом.
  */
  {
    id: 'updates', label: 'Обновления игры', live: true,
    title: 'Обновления игры · Z Route: Redemption',
    desc: 'Что изменилось в игре: сообщения магазина и стены сообщества, собранные автоматом, и заметки участников.',
  },
  /*
    Доска аккаунтов — витрина тем с меткой «Аккаунты». В основной строке меню
    её нет по той же причине, что и пульс обновлений: ряд и так держит пять
    живых вкладок, а шестая на телефоне съедает его целиком. Внутри доски
    ничего не продаётся: объявление — обычная тема, и договоренность рождается
    в её ответах, а не на этой странице.
  */
  {
    id: 'accounts', label: 'Аккаунты', live: true,
    title: 'Доска аккаунтов · Сервер 33',
    desc: 'Кто отдаёт аккаунт и почём: объявления с описанием, ценой, скриншотами и отметкой «продано».',
  },
  /*
    Справочник — текст самой игры, перенесённый из Telegram-бота один в один.
    Своей вкладки у него больше нет: он живёт внутри «Гайдов», под списком
    авторских разборов. `hidden: true` убирает его из меню, но маршрут и
    адреса узлов (#/handbook/<узел>) остаются — по ним ведут ссылки, уже
    лежащие в чатах и закладках.
  */
  {
    id: 'handbook', label: 'Справочник игры', hidden: true, navAs: 'guides',
    title: 'Справочник игры · Сервер 33',
    desc: 'Официальные гайды Z Route: Redemption — текст игры с картинками, поиск по разделам и узлам.',
  },
  {
    id: 'home', label: 'Итоги недели', render: renderHome,
    title: 'Итоги недели · Сервер 33',
    desc: 'Как прошла неделя VS на 33 сервере: победа +1, поражение −1, лидеры и движение мест.',
  },
  {
    id: 'quarter', label: 'Кварт', render: renderQuarter,
    title: 'Итоги Кварта · Сервер 33',
    desc: 'Расстановка сил по итогам Кварта: пьедестал, очки и трофеи 33 сервера.',
  },
  {
    id: 'ladder', label: 'Рейтинг', render: renderLadder,
    title: 'Рейтинг альянсов · Сервер 33',
    desc: 'Таблица 33 сервера: альянсы по победам в VS, форма последних боёв и изменение мест.',
  },
  {
    id: 'timeline', label: 'Хронология', render: renderTimeline,
    title: 'Хроника сервера 33',
    desc: 'Летопись 33 сервера: захваты Столицы, защиты, войны и решения модерации — свежие сверху.',
  },
  {
    id: 'guide', label: 'Малым алам', render: renderGuide,
    title: 'Малым альянсам · Сервер 33',
    desc: 'Разбор для небольших альянсов: принципы, обязанности руководства и типичные ошибки.',
  },
  {
    id: 'bot', label: 'Бот в ТГ', render: renderBot,
    title: 'Бот в Telegram · Z Route',
    desc: 'Telegram-бот со справочником по игре: те же разделы и тексты, что на сайте, только прямо в чате.',
  },
  {
    id: 'about', label: 'О проекте', render: renderAbout,
    title: 'О проекте · Сервер 33',
    desc: 'Неофициальный сайт сообщества 33 сервера: что здесь есть, как устроены регистрация и приватность чатов.',
  },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const presidentBoard = document.getElementById('president-board');
const bootLoader = document.getElementById('boot-loader');
const side = document.getElementById('side');
const sideToggle = document.getElementById('side-toggle');
const sideVeil = document.getElementById('side-veil');
const routeAnnouncer = document.getElementById('route-announcer');
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

/* ── Переход к содержимому ──────────────────────────────────────────── */

/*
  Ссылка «К содержимому» стоит первым фокусом на странице: до неё человеку
  с клавиатуры пришлось бы обойти шапку, марку и четырнадцать вкладок меню.

  Клик забираем себе и не пускаем адрес в ход. Hash у сайта и есть маршрут,
  и `#app` parseHash() прочитал бы как раздел «app», которого нет: ссылка
  выбрасывала бы человека на «Форум» вместо переноса фокуса.
*/
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  // Живой раздел ещё без заголовка: фокус уходит на само содержимое.
  if (!focusAppHeading()) app.focus({ preventScroll: true });
});

/*
  Заголовок страницы принимает фокус только с tabindex="-1": блок сам по себе
  фокуса не держит. preventScroll — не украшение: прокрутку к заголовку браузер
  сделал бы под липкую шапку, и верхняя строка экрана осталась бы пустой.

  Ответ — «удаётся ли найти заголовок»: по нему announceRoute решает, нужен
  ли странице отдельный голос.
*/
function focusAppHeading() {
  const h1 = app.querySelector('h1');
  if (!h1) return false;
  h1.setAttribute('tabindex', '-1');
  h1.focus({ preventScroll: true });
  return true;
}

/*
  ОБЪЯВЛЕНИЕ НОВОГО РАЗДЕЛА.

  Статичная страница (рейтинг, хронология, квартал) уже нарисована: фокус
  уходит на её заголовок, и заголовок же и звучит. Второй голос поверх него —
  эхо, которого читатель не просил.

  Живой раздел рисует себя после ответа хранилища и по ходу перекрашивает всю
  свою разметку; фокус, поставленный в момент перехода, эта перекраска
  выбрасывает обратно на <body>. Поэтому здесь строка анонса: элемент стоит
  вне содержимого, и перекраска его не касается.

  Название берётся из вкладки меню — она единственная называет раздел словом,
  коротко и так же, как человек его видит. У карточки альянса своей вкладки
  нет, там остаётся заголовок страницы, если он уже нарисован.
*/
function announceRoute(id) {
  if (!routeAnnouncer) return;
  const label = ROUTES.find((r) => r.id === id)?.label
    ?? app.querySelector('h1')?.textContent?.trim() ?? '';
  if (!label) return;
  routeAnnouncer.textContent = `Открыт раздел: ${label}`;
}

/*
  Адрес, который читатель уже услышал. Ведётся не по одному разделу, а по
  разделу с тем, что в нём открыто: перекрасок у страницы много (данные пришли,
  сработал фильтр), а объявлять перемену следует ровно при смене экрана.
  Тема → другая тема на том же форуме — это новый экран, а смена фильтра — нет.
*/
let lastAnnouncedRoute = null;

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
  if (id === 'accounts') return `accounts:${search}`;
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

/**
 * ЗАГОЛОВОК ВКЛАДКИ И ОПИСАНИЕ СТРАНИЦЫ.
 *
 * Раздел открывается без перезагрузки документа, поэтому без этой функции
 * и вкладка браузера, и закладка, и история, и сниппет в поисковике остаются
 * одной и той же строкой «Сервер 33 · Z Route» на всех четырнадцати страницах:
 * человек, пришедший по ссылке на рейтинг, читает во вкладке «Форум».
 *
 * Адрес при этом не меняется: правятся только текст вкладки и meta
 * description того же документа.
 */
function setPageMeta(id, param) {
  const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
  let title = route.title ?? route.label;
  let desc = route.desc ?? '';

  if (id === 'alliance' && param) {
    const a = (view.alliances || []).find((x) => x.id === param);
    if (a) {
      title = `${a.name} — альянс сервера 33`;
      desc = `Страница альянса ${a.tag}: состав, результаты и победы в VS на 33 сервере.`;
    }
  } else if (id === 'user' && param) {
    const nick = decodeURIComponent(param);
    title = `${nick} — участник сервера 33`;
    desc = `Профиль ${nick}: достижения, репутация и история сообщений на сервере 33.`;
  }

  document.title = title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta && desc) meta.setAttribute('content', desc);
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

/**
 * Старый адрес объявления о продаже аккаунта.
 *
 * Редактор объявления жил в композере форума, и в чаты кинули ссылки вида
 * `#/forum?new=accounts`. Теперь объявление пишется только на вкладке
 * магазина, и на форуме такой формы больше нет: если оставить ссылку как есть,
 * человек придёт на ленту с закрытым композером и решит, что страница сломалась.
 * Поэтому адрес переписываем до того, как его прочитает маршрутизатор, —
 * replaceState не дерёт человека назад и не добавляет в историю лишний шаг.
 */
function redirectLegacyAccountHash() {
  const [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (path.split('/')[0] !== 'forum') return;
  if (new URLSearchParams(search).get('new') !== 'accounts') return;
  history.replaceState(null, '', '#/accounts?new=accounts');
}

function render() {
  if (!view) return;
  redirectLegacyAccountHash();
  const { id, param, search } = parseHash();

  /*
    ГЕЙТ ДЕРЕВА СПРАВОЧНИКА: на «Гайдах» и на странице узла модули могут ещё
    не прийти. Первым делом отдаём строку ожидания и догружаем их, а потом
    этим же render() — уже с содержимым.

    Ошибка здесь не прощается молча: оборванная связь на одном файле
    выглядит как «раздел сломался», поэтому повтор идёт по той же кнопке,
    что слушается на странице (data-boot-retry).
  */
  if (needsGuidesTree.has(id) && !guidesTree.mods) {
    /*
      Живую вкладку закрываем до строки ожидания. Иначе человек идёт с форума
      на «Гайды», DOM ленты уже заменён надписью, а форум всё ещё смонтирован:
      у него остаются часы, опрос ленты и слушатели на документе. Каждый
      отдельный слушатель под guard по узлу, но вместе они ещё несколько
      сотен миллисекунд работают над экраном, которого нет.
    */
    unmountForum();
    unmountChats();
    unmountTournaments();
    unmountCalendar();
    unmountUpdates();
    unmountAccounts();
    unmountGuides();
    liveMountKey = null;
    app.innerHTML = '<div class="loading">Загружаем справочник…</div>';
    loadGuidesTree()
      .then(render)
      .catch((err) => {
        console.error(err);
        guidesTree.mods = null;
        app.innerHTML = '<div class="loading is-honest">Справочник не догрузился: '
          + 'связь оборвалась на середине.'
          + '<button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button></div>';
      });
    return;
  }

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

  liveMountKey = live;

  let path;
  if (id === 'alliance' && param) {
    /*
      Карточка альянса не своя вкладка, поэтому в меню подсвечиваем рейтинг,
      откуда сюда и приходят.

      Живые разделы закрываем все семь, как и на других уходах: сюда приходят
      и с «Турниров», и со страницы гайда, а у обоих на документе висят свои
      слушатели. Без этого под карточкой продолжает жить раздел, которого на
      экране уже нет: он опрашивает базу и держит свои таймеры.
    */
    unmountForum();
    unmountChats();
    unmountTournaments();
    unmountGuides();
    unmountCalendar();
    unmountUpdates();
    unmountAccounts();
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
    unmountAccounts();
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
      unmountAccounts();
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
      unmountAccounts();
      app.innerHTML = '';
      mountTournaments(app, view.alliances);
      path = '/tournaments';
    } else if (route.id === 'guides') {
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountCalendar();
      unmountUpdates();
      unmountAccounts();
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
      unmountAccounts();
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
      unmountAccounts();
      app.innerHTML = '';
      mountUpdates(app);
      path = '/updates';
    } else if (route.id === 'accounts') {
      /*
        Доска аккаунтов читает ту же ленту, что и форум, только фильтром по
        метке «Аккаунты», поэтому у неё своя живая страница, а не ещё один
        режим форума: два монтирования на один экран с общим состоянием
        композера спорили бы друг с другом.

        Хвост адреса хранит порядок и флаг снятых объявлений (#/accounts?sort=
        talked&sold=1): ссылка из чата обязана открыть ровно тот вид доски,
        который человек в неё скопировал.
      */
      unmountForum();
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
      app.innerHTML = '';
      mountAccounts(app, search);
      path = '/accounts';
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
      unmountAccounts();
      app.innerHTML = renderHandbook({ guideId: param });
      path = '/handbook/node';
    } else if (route.live) {
      unmountChats();
      unmountTournaments();
      unmountGuides();
      unmountCalendar();
      unmountUpdates();
      unmountAccounts();
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
      unmountAccounts();
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

  /*
    СМЕНИЛСЯ РАЗДЕЛ — ЧИТАТЕЛЬ УЗНАЁТ ОБ ОДНОМ ИЗ ДВУМЯ СПОСОБОВ.

    Без этого человек остаётся смотреть туда, где нажал: адрес сменился, экран
    перекрасился, а фокус по-прежнему на вкладке меню, из которой он ушёл.
    Программа экрана в этот момент читает старую страницу и молчит про новую,
    а человек не понимает, что вообще что-то открылось.

    Сначала пробуем заголовок: он точный и свой любому разделу. Не вышло —
    говорит отдельная строка-анонсер (почему он нужен живым разделам, объяснено
    в announceRoute выше; обоим голосам подряд читатель мешался бы как эхо,
    поэтому выбор один, а не оба).

    Три пропуска здесь намеренные:
    — первый проход (сайт только открыли): фокус и так в начале документа, а
      раздел человек читает с самого его начала;
    — живой раздел (ключ `live` выше) и форум с открытой темой вместе с чатами
      (keepScroll) получают только голос. Замер на 127.0.0.1 показал, что
      первый кадр у гайдов, календаря и форума появляется сразу, фокус встаёт
      на заголовок — и его же выбрасывает следующая перекраска, когда приходят
      данные. Ставить фокус там, где его гарантированно отберут, значит
      оставить читателя без обоих сигналов; у форума с темой своя прокрутка к
      посту, и заголовок наверху уехал бы от него;
    — перекраски того же экрана (пришли данные, сработал фильтр) сюда не
      доходят вовсе: адрес не менялся, и перескакивать фокусом с кнопки,
      которую человек держит нажатым, нельзя.

    Экраном считается связка «раздел + открытое в нём»: тема → другая тема на
    том же форуме — новый экран, и читатель его слышит; смена раздела темы или
    порядка остаётся тем же экраном.
  */
  const screen = `${id}/${param || ''}`;
  if (lastAnnouncedRoute !== null && screen !== lastAnnouncedRoute) {
    const byHeading = !keepScroll && !live && focusAppHeading();
    if (!byHeading) announceRoute(id);
  }
  lastAnnouncedRoute = screen;

  setPageMeta(id, param);
  trackPageview(path);
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
    */
    const reason = (lastLoad.primaryError || 'ни база, ни снимок рядом с сайтом не ответили')
      .replace(/[.\s]+$/, '');
    box.hidden = false;
    box.innerHTML =
      '<b>Данные не дошли</b>: '
      + esc(reason)
      + '.'
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

/**
 * Надпись в подвале про источник данных: база, снимок или никого.
 *
 * Имя бэкенда («supabase») читателю ничего не говорит, а важно ровно другое:
 * живые перед ним цифры или копия, снятая пару часов назад. Поэтому здесь
 * состояние, а не технология.
 */
function sourceBadge() {
  const badge = document.getElementById('source-badge');
  if (!badge) return;
  badge.textContent = lastLoad.source === 'снимок' ? 'снимок'
    : lastLoad.source === '' ? 'недоступен'
      : 'живая база';
}

async function boot() {
  /*
    Адаптер форума наполнен до первого render(): в бою этот await не ждёт
    ничего, потому что боевой файл лежит рядом с точкой переключения, а в
    черновом режиме он приносит отдельный модуль. Без него первая же строка
    ленты обратилась бы к пустому объекту.
  */
  await forumReady();

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

    Доска аккаунтов — та же лента, фильтрованная по метке, поэтому она ждёт
    ответ базы, а не данные сайта: плашка хроники ей не рисуется вовсе.
  */
  const { id, param } = parseHash();
  const liveFirst = id === 'forum' || id === 'chats' || id === 'calendar'
    || id === 'updates' || id === 'accounts' || id === 'handbook' || (id === 'user' && param);

  app.innerHTML = liveFirst ? '' : '<div class="loading">Загружаем данные…</div>';
  if (liveFirst) {
    view = emptyView();
    render();
  }

  await refreshView();
}

/**
 * ДАННЫЕ САЙТА ЗАНОВО: один путь при входе на страницу и при повторе после
 * аварии.
 */
async function refreshView() {
  armSlowBootNotice();

  try {
    const data = await loadAll();
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

boot();

// Пригодится при отладке из консоли браузера.
Object.assign(window, { __app: () => view, __caps: capabilities });
