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
import { allianceInkCss } from './ui/ink.js';
import { skWithCaption } from './ui/skeleton.js';
import { presidentBoardFromTexts } from './logic/president-board.js';
import { startQuarterTimer } from './ui/quarter-timer.js';
// Побочные импорты: вешают делегированные обработчики на страницы.
import './ui/ladder-controls.js';
import './ui/timeline-controls.js';
import './ui/race-controls.js';
import { mountForum, mountUser, syncForumView, unmountForum } from './forum/mount.js';
import { mountChats, unmountChats, unreadChatsTotal } from './forum/chats.js';
import { mountTournaments, unmountTournaments } from './forum/tournaments.js';
import { mountCalendar, unmountCalendar } from './forum/calendar.js';
import { mountUpdates, unmountUpdates } from './forum/updates.js';
import { mountAccounts, unmountAccounts } from './forum/accounts.js';
import { forumReady } from './forum/index.js';
import { mountHomeCommunity } from './pages/home-community.js';

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
    id: 'forum', label: 'Форум', group: 'Общение', tag: 'обсуждения сервера', live: true, primary: true,
    title: 'Форум сервера 33 · Z Route: Redemption',
    desc: 'Обсуждения 33 сервера: новости, разбор VS, летопись захватов, альянсы, вопросы по игре и свободные темы.',
  },
  {
    id: 'chats', label: 'Чаты', group: 'Общение', tag: 'личное и альянсы', live: true, primary: true,
    title: 'Чаты альянсов · Сервер 33',
    desc: 'Комнаты альянсов на самом сайте: договорённости перед боем и разбор итогов — без внешних мессенджеров.',
  },
  {
    id: 'tournaments', label: 'Турниры', group: 'Общение', tag: 'матчапы и счёт', live: true, primary: true,
    title: 'Турниры альянсов · Сервер 33',
    desc: 'VS-матчапы двух альянсов со счётом по победам. Раунды засчитываются прямо на странице, победитель определяется сам.',
  },
  {
    id: 'guides', label: 'Гайды', group: 'Справка', tag: 'разборы и справочник', live: true, primary: true,
    title: 'Гайды · Сервер 33',
    desc: 'Разборы от участников сервера 33 и официальный справочник игры: тактика, исследования, роли в альянсе.',
  },
  {
    id: 'calendar', label: 'Календарь', group: 'Общение', tag: 'сборы и ответы', live: true, primary: true,
    title: 'Календарь сборов · Сервер 33',
    desc: 'Когда сервер собирается на бои: ближайшие события, ответы «иду / не иду» и моё расписание одной строкой.',
  },
  /*
    Пульс обновлений — живой, но не «общение»: здесь не спорят, здесь читают
    то, что изменилось в игре за последние недели. Поэтому он в группе
    «Сервер», рядом с хроникой, а не в меню рядом с форумом.
  */
  {
    id: 'updates', label: 'Обновления игры', group: 'Сервер', tag: 'что изменилось в игре', live: true,
    title: 'Обновления игры · Z Route: Redemption',
    desc: 'Что изменилось в игре: сообщения магазина и стены сообщества, собранные автоматом, и заметки участников.',
  },
  /*
    Доска продаж — витрина объявлений об аккаунтах. В основной строке меню её
    нет по той же причине, что и пульс обновлений: ряд и так держит пять
    живых вкладок, а шестая на телефоне съедает его целиком. Внутри доски
    ничего не продаётся: объявление — обычная тема, и договоренность рождается
    в её ответах, а не на этой странице.
  */
  {
    id: 'accounts', label: 'Продажа аккаунтов', group: 'Общение', tag: 'объявления и цены', live: true,
    title: 'Продажа аккаунтов · Сервер 33',
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
    id: 'home', label: 'Итоги недели', group: 'Сервер', tag: 'неделя: +1 и −1', render: renderHome,
    title: 'Итоги недели · Сервер 33',
    desc: 'Как прошла неделя VS на 33 сервере: победа +1, поражение −1, лидеры и движение мест.',
  },
  {
    id: 'quarter', label: 'Кварт', group: 'Сервер', tag: 'итоги периода', render: renderQuarter,
    title: 'Итоги Кварта · Сервер 33',
    desc: 'Расстановка сил по итогам Кварта: пьедестал, очки и трофеи 33 сервера.',
  },
  {
    id: 'ladder', label: 'Рейтинг', group: 'Сервер', tag: 'места и форма', render: renderLadder,
    title: 'Рейтинг альянсов · Сервер 33',
    desc: 'Таблица 33 сервера: альянсы по победам в VS, форма последних боёв и изменение мест.',
  },
  {
    id: 'timeline', label: 'Хронология', group: 'Сервер', tag: 'летопись захватов', render: renderTimeline,
    title: 'Хроника сервера 33',
    desc: 'Летопись 33 сервера: захваты Столицы, защиты, войны и решения модерации — свежие сверху.',
  },
  {
    id: 'guide', label: 'Малым алам', group: 'Справка', tag: 'малым альянсам', render: renderGuide,
    title: 'Малым альянсам · Сервер 33',
    desc: 'Разбор для небольших альянсов: принципы, обязанности руководства и типичные ошибки.',
  },
  {
    id: 'bot', label: 'Бот в ТГ', group: 'Справка', tag: 'тексты игры в чате', render: renderBot,
    title: 'Бот в Telegram · Z Route',
    desc: 'Telegram-бот со справочником по игре: те же разделы и тексты, что на сайте, только прямо в чате.',
   },
  {
    id: 'promocodes', label: 'Промокоды', group: 'Справка', tag: 'актуальные промокоды', render: renderPromocodes,
    title: 'Промокоды · Сервер 33',
    desc: 'Актуальные промокоды для сервера 33 Z Route: Redemption. Проверяем работоспособность и обновляем список регулярно.',
  },
  {
    id: 'about', label: 'О проекте', group: 'Справка', tag: 'как это устроено', render: renderAbout,
    title: 'О проекте · Сервер 33',
    desc: 'Неофициальный сайт сообщества 33 сервера: что здесь есть, как устроены регистрация и приватность чатов.',
  },
];

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const presidentBoard = document.getElementById('president-board');
const bootLoader = document.getElementById('boot-loader');
const side = document.getElementById('side');
const sideClose = document.querySelector('[data-side-close]');
const sideGrab = document.querySelector('.side__grab');
const sideVeil = document.getElementById('side-veil');
const tabbar = document.getElementById('tabbar');
const tabbarMore = document.getElementById('tabbar-more');
const headWhere = document.getElementById('head-where');
const routeAnnouncer = document.getElementById('route-announcer');
const isFirstVisit = !document.documentElement.classList.contains('s33-loader-seen');
const bootStartedAt = performance.now();

/* ── Тема (светлая / тёмная) ──────────────────────────────────────────── */
/*
  Светлой считается ровно строка «light», всё остальное — тёмная. Правило
  то же, что в инлайн-скрипте `<head>`, и оно не недосмотр: на имени,
  которого нет в лестницах токенов, не срабатывает ни одна тема, и страница
  остаётся без красок вовсе, тогда как бриф §2 п.6 велит в этом случае
  включать тёмную.
*/
function applyTheme(theme) {
  const safe = theme === 'light' ? 'light' : 'dark';
  const html = document.documentElement;
  html.setAttribute('data-theme', safe);
  /*
    Полоса состояния телефона — тот же фон, что у страницы. Число берётся из
    `--bg` уже выбранной темы, а не дописывается вторым литералом: правка
    ступени в `styles-v8.css` тогда не оставит здесь цвет из прошлой палитры.
  */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(html).getPropertyValue('--bg').trim());
  /*
    Имя называет действие, а не текущее состояние: человек с программой экрана
    слушает кнопку ДО нажатия и обязан понять, что будет, а не где он сейчас.
    Значок при этом остаётся знаком темы — §6 допускает и такую формулировку.
  */
  const label = safe === 'light' ? 'Переключить на тёмную тему' : 'Переключить на светлую тему';
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', label);
  }
  try { localStorage.setItem('s33-theme', safe); } catch (_) {}
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
  в разных случаях: плашка первого захода поверх всей страницы и плашка внизу
  экрана, когда человек уже видит контур грузившейся страницы.

  Про вторую плашку отдельно. Раньше объяснение вписывалось внутрь самого
  контура и стирало его: страница теряла резерв в полтора экрана, подвал
  взлетал вверх, а через три секунды, когда база всё-таки отвечала, —
  падал обратно. То есть лечение от «бесконечной загрузки» само делало
  страницу дёргающейся. Теперь плашка прибита к низу окна (position: fixed),
  контур под ней стоит нетронутым и высота документа не меняется ни на
  пиксель.

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

  /*
    Плашка прибита к низу окна и не вставляется в контур: появление
    объяснения не должно менять высоту документа. Повтор нажимается с телефона
    пальцем, поэтому цель — не строчка текста, а отдельная кнопка рядом.
  */
  if (document.querySelector('[data-boot-notice]')) return;
  document.body.insertAdjacentHTML('beforeend',
    `<div class="boot-notice" data-boot-notice role="status">`
    + `<p class="boot-notice__text" data-boot-slow>${esc(SLOW_BOOT_TEXT)}</p>`
    + `<div class="boot-notice__acts">`
    + `<button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button>`
    + `${mirror}</div></div>`);
}

/** Объяснение молчания нужно ровно пока молчат: пришедшие данные его снимают. */
function hideSlowBootNotice() {
  document.querySelector('[data-boot-notice]')?.remove();
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

/*
  Подписи групп в меню — порядок, а не состав: состав берётся из поля
  `group` у самой записи ROUTES. Раздел без группы в список не попадёт,
  и за этим следит тест (секция «Оглавление»), а не код страницы: молча
  потерянная вкладка — худший из возможных исходов для человека, который
  ищет её и не находит.
*/
const NAV_TITLES = ['Общение', 'Сервер', 'Справка'];

/*
  ИКОНКИ РАЗДЕЛОВ — ОДИН НАБОР, ТОНКАЯ ОБВОДКА.

  Все иконки нарисованы одним почерком: 24×24, обводка 1.6 px, скруглённые
  концы, без заливки. Смешивать стили нельзя: ряд из пятнадцати иконок, взятых
  из разных наборов, читается как «штучная сборка», а не как продукт.

  Иконка декоративна: название раздела стоит рядом текстом, поэтому значок
  скрыт от программы экрана (`aria-hidden`) — иначе она читала бы каждую
  подпись дважды.
*/
const NAV_ICONS = {
  forum: '<path d="M20 4H4v11h3v4l5-4h8z"/><path d="M8 9h8M8 12h4"/>',
  chats: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/>',
  tournaments: '<path d="M4 20h16M7 20v-6M12 20V5M17 20v-9"/>',
  guides: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v14H6.5A2.5 2.5 0 0 0 4 19.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H19v4H6.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  updates: '<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>',
  accounts: '<path d="M3 7h18v12H3z"/><path d="M3 11h18M8 15h4"/>',
  handbook: '<path d="M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z"/><path d="M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7Z"/>',
  home: '<path d="M4 19V9l8-5 8 5v10"/><path d="M9 19v-6h6v6"/>',
  quarter: '<path d="M12 3v18M5 8h14M6.5 8l-2.5 6h5ZM17.5 8l-2.5 6h5Z"/>',
  ladder: '<path d="M4 20h16M7 20v-6M12 20V5M17 20v-9"/>',
  timeline: '<path d="M5 4v16"/><path d="M5 8h9M5 13h13M5 18h6"/>',
  guide: '<path d="M12 3 4 7v5c0 4.4 3.4 8.5 8 9 4.6-.5 8-4.6 8-9V7Z"/><path d="M9 12l2 2 4-4"/>',
   bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M8.5 14h.01M15.5 14h.01M9 17h6"/>',
  promocodes: '<path d="M12 2a3 3 0 0 1 3 3v14a3 3 0 1 1-6 0V5a3 3 0 0 1 3-3zm-2 5a1 1 0 1 1 2 0 1 1 0 0 1-2 0zm4 0a1 1 0 1 1 2 0 1 1 0 0 1-2 0z"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};

function navIcon(id) {
  const path = NAV_ICONS[id];
  if (!path) return '';
  return `<svg class="nav__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
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
    }"${navId(r) === activeId ? ' aria-current="page"' : ''}>${navIcon(r.id)}<span>${r.label}</span>${
      r.id === 'chats' ? '<span class="nav__badge" data-nav-chats-badge hidden></span>' : ''
    }</a>`;
  /*
    `hidden` — раздел без своего пункта меню: страница существует и открывается
    по адресу, но в оглавлении её нет. Справочник живёт внутри «Гайдов», и две
    соседние ссылки на один и тот же вопрос («как это работает») читались бы
    как спор двух разделов за место в списке.
  */
  const shown = ROUTES.filter((r) => !r.hidden);
  /*
    ТРИ ГРУППЫ: «Общение», «Сервер», «Справка». Четырнадцать вкладок без
    подписей читаются как список, а не как оглавление: человек обязан
    сначала понять, что здесь разговоры, здесь цифры, а здесь помощь, и
    только потом искать своё. Две прежние группы вместили не всё — «Гайды», «Малым алам», «Бот»
    и «О проекте» стояли под подписью «Сервер», которой они не про что.

    Внутри группы порядок тот же, что в ROUTES: частое выше редкого.
  */
  nav.innerHTML = NAV_TITLES.map(
    (title) => `<span class="nav__group">${title}</span>${shown.filter((r) => r.group === title).map(link).join('')}`
  ).join('');
  paintHeadWhere(activeId);
  syncTabbar(activeId);
  syncHeadNav(activeId);
  refreshChatsBadge();
}

/*
  ВЕРХНЯЯ НАВИГАЦИЯ ШАПКИ: тот же раздел, что и в колонке, но коротким путём.

  Пункты статичны (в разметке), поэтому активный подсвечивает модуль — тем же
  идентификатором, что и меню: страница справочника принадлежит вкладке
  «Гайдов», и подсветка должна встать на «Гайды», а не на саму страницу.
*/
function syncHeadNav(activeId) {
  const nav = document.querySelector('.head__nav');
  if (!nav) return;
  nav.querySelectorAll('a[href]').forEach((link) => {
    const id = link.getAttribute('href').replace(/^#\/?/, '');
    const route = ROUTES.find((r) => r.id === id);
    const on = route ? (route.navAs || route.id) === activeId : false;
    link.classList.toggle('is-active', on);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

/*
  СТРОКА «ГДЕ Я» В ШАПКЕ.

  Слово «Форум» в шапке — это ответ на вопрос, который человек задаёт глазами
  каждые несколько секунд, не отрываясь от чтения. Оглавление слева его тоже
  отвечает, но взгляд там не бывает: активная вкладка уезжает за край, когда
  список длинный, и на широком экране её перекрывает таблица.

  Подпись раздела берётся из того же `tag`, что и меню, — две разные формулировки
  одного и того же раздела («здесь обсуждают» и «обсуждения сервера») человек
  читал бы как два разных места.

  Строка aria-hidden: называет раздел заголовок содержимого, и два голоса
  подряд программа экрана слушает как эхо (тот же разбор — у #route-announcer).
*/
function paintHeadWhere(activeId) {
  if (!headWhere) return;
  const route = ROUTES.find((r) => (r.navAs || r.id) === activeId);
  headWhere.textContent = '';
  if (!route) return;
  const name = document.createElement('b');
  name.textContent = route.label;
  const note = document.createElement('span');
  note.textContent = route.tag || '';
  headWhere.append(name, note);
}

/*
  ПОЛОСА РАЗДЕЛОВ: ТОТ ЖЕ РАЗДЕЛ, ЧТО И В ОГЛАВЛЕНИИ.

  Полоса лежит в разметке страницы статично и сама по себе умеет только
  переходить по адресу, поэтому её активная клетка не наследует подсветку
  меню — её надо поставить. Иначе человек нажал «Рейтинг», страница
  поменялась, а в полосе по-прежнему подсвечен «Форум»: две подписи одного
  вопроса («где я») отвечают по-разному.

  Клетка опознаётся по своему адресу, а не по названию раздела: меню
  подсвечивает вкладку по `navAs` (страница справочника принадлежит вкладке
  «Гайдов»), и тот же активный раздел полоса обязана показать тем же
  идентификатором. Раздела без своей клетки в полосе это не касается: там
  просто нечего подсвечивать.
*/
function syncTabbar(activeId) {
  if (!tabbar) return;
  tabbar.querySelectorAll('a[href]').forEach((cell) => {
    const on = cell.getAttribute('href').replace(/^#\/?/, '') === activeId;
    cell.classList.toggle('is-active', on);
    if (on) cell.setAttribute('aria-current', 'page');
    else cell.removeAttribute('aria-current');
  });
}

/*
  Счётчик непрочитанных у пункта «Чаты». Считается при каждой смене раздела
  и раз в минуту — этого хватает: внутри чата свои обновления.

  Значок ищется по всему документу, а не внутри меню: «Чаты» теперь на двух
  входах — в боковой панели и в полосе разделов, и один номер на двух
  подписях означал бы, что один из них врёт.
*/
let badgeTimer = 0;
async function refreshChatsBadge() {
  const n = await unreadChatsTotal();
  const els = document.querySelectorAll('[data-nav-chats-badge]');
  if (!els.length) return;
  els.forEach((el) => {
    el.hidden = !n;
    el.textContent = n > 99 ? '99+' : String(n);
  });
  window.clearTimeout(badgeTimer);
  badgeTimer = window.setTimeout(refreshChatsBadge, 60000);
}

/* ── Боковое меню ─────────────────────────────────────────────────────────── */

/*
  На узком экране список разделов поднимается шторкой снизу. Состояние
  держится классом на <html>, а не на самой панели: затемнение, запрет
  прокрутки под меню и поднятый край содержимого — это про всю страницу,
  а не про меню.
*/
function setSideOpen(open) {
  document.documentElement.classList.toggle('is-side-open', open);
  /*
    «Раскрыто» сообщают все кнопки, которые управляют этим списком. Их сейчас
    одна: клетка «Ещё» в нижнем ряду. Кнопка «Меню» в шапке вела в тот же
    список и была убрана — два входа в одно состояние человек читает как два
    разных меню и обязан проверить оба. Запрос по атрибуту, а не по конкретной
    кнопке, оставлен нарочно: если у списка появится ещё один вход (например,
    жест), атрибут сами собой подхватит его, и состояние не начнёт врать.
  */
  document.querySelectorAll('[aria-controls="side"]').forEach((btn) => {
    btn.setAttribute('aria-expanded', String(open));
  });
  if (sideVeil) sideVeil.hidden = !open;

  /*
    Фокус переносим внутрь панели и обратно на кнопку. Без этого человек,
    открывший меню с клавиатуры, остаётся фокусом на кнопке, а следующий Tab
    уводит его в содержимое страницы — то есть меню открылось, но добраться
    до вкладок нельзя.

    СПЛОШЬ РАСКЛАДКУ ПЕРЕД ФОКУСОМ — НЕ КОСМЕТИКА. Класс на <html> только что
    снял с панели `visibility: hidden`, но браузер ещё ничего не пересчитал:
    на живом промере первый Tab после нажатия «Ещё» уходил не в список, а в
    подвал, потому что focus() отказал элементу, который по несчитанному
    стилю всё ещё скрыт. Чтение offsetHeight заставляет браузер досчитать
    стили до попытки фокуса.

    Обратно фокус отдаётся тому, кто меню открыл: после «Ещё» возврат в шапку
    унёс бы фокус за десять сантиметров вверх, и следующий Tab начал бы не
    оттуда, где человек остановился. Если же открывающая кнопка исчезла
    (полоса гаснет на широком экране), список закрывает его же кнопка
    «Закрыть» — возврата не требуется, фокус и так внутри.
  */
  if (open) {
    void side?.offsetHeight;
    side?.querySelector('.nav__link')?.focus({ preventScroll: true });
  } else if (document.activeElement && side?.contains(document.activeElement)) {
    if (sideOpener?.offsetParent !== null) sideOpener.focus({ preventScroll: true });
  }
}

function isSideOpen() {
  return document.documentElement.classList.contains('is-side-open');
}

/* Кто открыл меню — ему его и закрывать обратно с точки зрения фокуса. */
let sideOpener = null;

/*
  «Ещё» в полосе разделов — единственный вход в полный список.
  Два отдельных списка разделов на одном телефоне означало бы, что у человека
  есть два оглавления, которые могут разойтись, и он обязан проверить оба,
  чтобы найти нужный раздел. Здесь же полоса держит четыре часто нужных
  раздела, а всё остальное — за одной дверью.
*/
tabbarMore?.addEventListener('click', () => {
  sideOpener = tabbarMore;
  setSideOpen(!isSideOpen());
});

sideClose?.addEventListener('click', () => setSideOpen(false));
sideVeil?.addEventListener('click', () => setSideOpen(false));

/*
  Переход по разделу закрывает меню. Без этого на телефоне человек нажимает
  вкладку и остаётся смотреть на меню, а не на страницу, за которой пришёл.
*/
side?.addEventListener('click', (e) => {
  if (e.target.closest('a')) setSideOpen(false);
});

/*
  СЪЕЗД ШТОРКИ ПАЛЬЦЕМ.

  Раз список открывается движением вверх, закрывать его нажатием кнопки —
  значит заставлять руку менять захват: большой палец лежит на краю, и
  потянуть его обратно вниз дешевле, чем целиться в «Закрыть». Кнопка при
  этом остаётся: без неё список недоступен с клавиатуры и с программой
  экрана, а жест — только удобство для мыши и пальца.

  Порог в 56 px — это высота строки списка: съезд меньше строки человек
  делает случайно, когда прокручивает сам список, и закрывать его за такое
  нельзя. Тащим именно за ручку сверху, а не за любую точку: прокрутка
  длинного списка жестом не считается.

  ОТПУСКАНИЕ СЛУШАЕТ ДОКУМЕНТ, А НЕ РУЧКА. Ставить захват на ручку
  (setPointerCapture) мало: на живом промере палец ушёл вниз за её пределы,
  pointerup ушёл на вкладку списка, и обработчик на ручке его не увидел —
  шторка осталась открытой. Живой палец на телефоне захват удержал бы, но
  полагаться на то, что не проверяемо без экрана, нельзя: событие ловится
  там, где оно реально приходит.
*/
let dragStartY = null;
sideGrab?.addEventListener('pointerdown', (e) => {
  dragStartY = e.clientY;
  sideGrab.setPointerCapture?.(e.pointerId);
});
document.addEventListener('pointerup', (e) => {
  if (dragStartY === null) return;
  const moved = e.clientY - dragStartY;
  dragStartY = null;
  if (moved > 56) setSideOpen(false);
});
document.addEventListener('pointercancel', () => {
  dragStartY = null;
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

/*
  ПЛОТНАЯ ШАПКА В ПРОКРУТКЕ.

  Пока страница не сдвинута, шапка стоит над началом hero и её полупрозрачный
  фон не за что смешивать. Как только под шапку заезжает таблица, тот же фон
  начинает превращать цифры в кашу, поэтому сдвиг больше 8 px добавляет класс
  и стиль делает шапку сплошной.

  8 px, а не 0: лёгкий пружинящий сдвиг на телефоне не должен каждый раз
  включать и выключать оформление. Считаем в кадре анимации и только когда
  состояние реально сменилось — слушатель висит на всех прокрутках страницы.
*/
const siteHead = document.querySelector('.site-head');
let headScrolled = false;
let headFrame = 0;

function syncHeadState() {
  headFrame = 0;
  const scrolled = (window.scrollY || window.pageYOffset || 0) > 8;
  if (scrolled === headScrolled) return;
  headScrolled = scrolled;
  siteHead.classList.toggle('is-scrolled', scrolled);
}

function requestHeadSync() {
  if (!headFrame) headFrame = requestAnimationFrame(syncHeadState);
}

if (siteHead) {
  window.addEventListener('scroll', requestHeadSync, { passive: true });
  syncHeadState();
}

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
  jumpToContent();
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
  ПРЫЖОК К СОДЕРЖИМОМУ, КОТОРЫЙ ПЕРЕКРАСКА НЕ ОТБИРАЕТ.

  Живой раздел (гайды, форум, календарь) рисует первый кадр, а потом
  перекрашивается целиком, когда приходят данные. Заголовок, на который сел
  читатель, при этой перекраске удаляется из документа, и фокус падает на
  <body>: следующий Tab начинается снова с шапки, а человек, ждавший содержимое,
  остаётся ни с чем. Поэтому за прыжком смотрим короткое время.

  Гвард возвращает фокус ТОЛЬКО когда его совсем нет (activeElement — body или
  документ): перешёл ли человек сам или нет, видно по тому, что фокус стоит на
  узле. Срок — 2,5 с, дальше наблюдатель снимается сам: перекраски, начавшиеся
  позже, это уже не последствия нажатия.

  Наблюдатель висит на детях самого #app: перерисовка раздела — это замена
  содержимого контейнера, а не узла внутри вложенного блока.
*/
let jumpWatch = null;

function jumpToContent() {
  // Живой раздел ещё без заголовка: фокус уходит на само содержимое.
  if (!focusAppHeading()) app.focus({ preventScroll: true });

  if (jumpWatch) { jumpWatch.ob.disconnect(); clearTimeout(jumpWatch.timer); }
  const ob = new MutationObserver(() => {
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) return;
    if (!focusAppHeading()) app.focus({ preventScroll: true });
  });
  ob.observe(app, { childList: true });
  jumpWatch = { ob, timer: setTimeout(() => { ob.disconnect(); }, 2500) };
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

/*
  Последняя строка плашки. Нужна ровно для одного: не перерисовывать рамку,
  пока слова не изменились. Вызов идёт на каждой смене раздела, а с каждой
  перерисовкой заново запускались бегущая строка и пульс — глаз дёргался без
  повода, пока человек просто ходил по вкладкам.

  ПОДПИСЬ ВЛАДЕЛЬЦА БОЛЬШЕ НЕ РИСУЕТСЯ СТРОКОЙ. `note` остаётся в формате
  данных — панели есть чем заполнять поле, — но на странице это подсказка при
  наведении, а не второй ярус шапки. Разметка плашки стала короче ровно на
  него: метка + имя + альянс.
*/
let presidentBoardLine = null;

function renderPresidentBoard(texts = []) {
  if (!presidentBoard) return;
  const board = presidentBoardFromTexts(texts);
  const line = board.enabled ? `
    <div class="president-board__head">
      <span class="president-board__signal" aria-hidden="true"></span>
      <span class="president-board__label">${esc(board.label)}</span>
    </div>
    <div class="president-board__identity">
      <strong class="president-board__name">${esc(board.name)}</strong>
      <span class="president-board__alliance">${esc(board.alliance)}</span>
    </div>
  ` : '';
  /*
    Подпись ставится до стража: меняются только её слова, а рамку трогать
    незачем. `title` — свойство-текст, разметка через него не собирается.
  */
  presidentBoard.title = board.enabled && board.note ? board.note : '';
  if (line === presidentBoardLine) return;
  presidentBoardLine = line;
  presidentBoard.hidden = !board.enabled;
  presidentBoard.innerHTML = line;
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
 *
 * Тем же путём идёт старый фильтр `#/forum?tag=accounts`: чипа такой метки на
 * форуме больше не рисуется, и оставленный адрес показывал бы ленту, отобранную
 * по примете, которой человек не видит.
 *
 * Поэтому адрес переписываем до того, как его прочитает маршрутизатор, —
 * replaceState не дерёт человека назад и не добавляет в историю лишний шаг.
 */
function redirectLegacyAccountHash() {
  const [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (path.split('/')[0] !== 'forum') return;
  const params = new URLSearchParams(search);
  if (params.get('new') === 'accounts') {
    history.replaceState(null, '', '#/accounts?new=accounts');
  } else if (params.get('tag') === 'accounts') {
    history.replaceState(null, '', '#/accounts');
  }
}

/*
  КНОПКА «ГРАФИК СЕЗОНА» НА ГЛАВНОЙ.

  Ведёт не в начало «Рейтинга», а к графику под таблицей: человек пришёл за
  сравнением своих альянсов и тащиться через весь список мест не должен.

  ДИРЕКТИВА ОДНОРАЗОВАЯ. render() вызывается не только при смене адреса —
  страница перекрашивается, когда приходят данные, когда сработал фильтр и когда
  сменился сервер, а адрес всё это время остаётся прежним, с `?race=1` в
  хвосте. Без флага каждая такая перерисовка утаскивала бы прокрутку обратно к
  графику, и дочитать таблицу, которую человек сам открыл, было бы нельзя.
  Флаг возвращается на любом заходе без параметра, поэтому следующий клик по
  кнопке снова приводит.

  Панели может ещё не быть: на холодном входе рейтинг рисуется позже ответа
  базы, и график появляется вместе с ним. Флаг в этот момент не тратим — прыжок
  случится на той перерисовке, где цель действительно есть. Если же страница так
  и останется без графика (неделей меньше двух), человек получит обычный вход на
  «Рейтинг»: молча тянуть прокрутку вслепую хуже, чем не доехать до раздела.
*/
let raceJumpArmed = true;

function takeRaceJump(id, search) {
  if (id !== 'ladder' || new URLSearchParams(search).get('race') !== '1') {
    raceJumpArmed = true;
    return null;
  }
  if (!raceJumpArmed) return null;
  const panel = document.querySelector('[data-race-panel]');
  if (!panel) return null;
  raceJumpArmed = false;
  return panel;
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
    app.innerHTML = `<div class="loading">${skWithCaption('Загружаем справочник…', 'row', 6)}</div>`;
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
    document.body.dataset.route = 'user';
    app.innerHTML = '';
    mountUser(app, decodeURIComponent(param));
    path = '/user';
  } else {
    const route = ROUTES.find((r) => r.id === id) ?? ROUTES[0];
    document.body.dataset.route = route.id;
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
      if (route.id === 'quarter') {
        app.innerHTML = route.render({
          standings: view.quarterStandings,
          quarter: view.quarter,
          loadError: view.loadError,
        });
      } else if (route.id === 'bot') {
        app.innerHTML = route.render();
      } else if (route.id === 'promocodes') {
        fetch('./src/pages/promocodes/index.html')
          .then(response => response.text())
          .then(html => {
            app.innerHTML = html;
          })
          .catch(error => {
            console.error('Ошибка загрузки страницы промокодов:', error);
            app.innerHTML = '<p class="muted">Ошибка загрузки страницы промокодов. Попробуйте позже.</p>';
          });
      } else {
        app.innerHTML = route.render(view);
      }
      // Страницы рисуются строками разом, а фильтры живут в отдельных скриптах.
      // Без этого вызова состояние кнопок разойдётся с тем, что видно на экране.
      for (const fn of [window.__ladderApply, window.__timelineApply, window.__raceApply]) {
        if (typeof fn === 'function') fn();
      }
      // Запуск таймера Кварта, если открыта страница Кварта.
      if (route.id === 'quarter') startQuarterTimer();
      /*
        Ряд сообщества на главной догружается отдельно от страницы. Ждать его
        ответа, чтобы напечатать неделю, нельзя: темы живут в другой базе, и их
        опоздание задержало бы первый экран. Сам вызов ничего не блокирует:
        слот нарисован заранее и занимает ровно ту высоту, которую займут темы.
      */
      if (route.id === 'home') mountHomeCommunity(app);
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
  const racePanel = takeRaceJump(id, search);
  if (!keepScroll && !racePanel) window.scrollTo(0, 0);
  if (racePanel) {
    /*
      Отступ берём у самой шапки, а не из числа: она липкая (`position: sticky`)
      и меняет рост при прокрутке, а заголовок панели после прыжка обязан быть
      виден целиком, а не обрезан её краем.

      Цель считаем по раскладке (`offsetTop`), а не по нарисованному
      `getBoundingClientRect`. На телефоне панели въезжают снизу с
      `translate3d(0, 24px, 0)` (src/styles-v8.css:3054), и анимация стартует
      как раз тогда, через них проходит прокрутка: пока летим, сосед сверху
      поднимается на свои 24 px, и нарисованный верх панели графика оказывается
      выше того, по которому считали. Замер по картинке ставил край карточки на
      18 px под шапку; `offsetTop` трансформации не видит и называет то место,
      где карточка останется, когда animation закончится.
    */
    const head = document.querySelector('.site-head');
    let layoutTop = 0;
    for (let el = racePanel; el; el = el.offsetParent) layoutTop += el.offsetTop;
    const y = layoutTop - (head ? head.offsetHeight : 0);
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    const title = racePanel.querySelector('[data-race-title]');
    if (title) title.focus({ preventScroll: true });
  }

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
    /*
      Прыжок к графику говорит сам: фокус встаёт на его заголовок, и читатель
      слышит «Как менялись очки». Второй голос поверх него был бы эхом, поэтому
      обычные два способа здесь уступают одному.
    */
    const byHeading = !keepScroll && !live && !racePanel && focusAppHeading();
    if (!byHeading && !racePanel) announceRoute(id);
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
    dataMeta: { source: '', stamp: '' },
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
 * Источник говорит сам: снимок — так и написано, каким часом снят и что именно
 * он замораживает (форум, вход и запись постов живут только в базе). Кнопка
 * «Повторить» дёргает тот же обработчик, что и в объяснении долгого ожидания:
 * [data-boot-retry] уже слушается на странице.
 *
 * ПОЛОСКА ГОВОРИТ ТОЛЬКО БЕДУ. Рамка стоит над содержимым на снимке и в
 * аварии; на живой базе и в ожидании её не видно. Прежняя договорённость была
 * обратной — «не исчезает никогда», — и стоила она permanent 68 px мёртвого
 * места, потому что исправное состояние не сообщает читателю ничего.
 *
 * Цена смены правила честна и названа: высоты полоски в документе больше нет,
 * поэтому на копии и в аварии экран при ответе сдвинется на её рост. Это
 * ровно тот дефект (+0.06 CLS на каждой загрузке), от которого полоску
 * лечили, — но теперь он случается только там, где сайтов и правда не в
 * порядке, а не на каждом открытии. Замер — tools/walk.mjs, числа после
 * правки лежат в docs/ARCHITECTURE.md.
 *
 * Три части строки: жирное имя состояния, короткая подробность и слово
 * «подробности», раскрывающее длинный текст. Длинный текст в самой строке
 * быть не может: он переносился бы на две-четыре строки на телефоне, и резерв
 * либо резал бы его, либо гулял бы по высоте.
 */
function dataNotice() {
  const box = document.getElementById('data-notice');
  if (!box) return;

  const line = (label, detail) => `<summary class="data-notice__line"><b>${label}</b>`
    + `<span>${detail}</span><em class="data-notice__hint">подробности</em></summary>`;
  const retry = '<button type="button" class="forum-btn forum-btn--ghost" data-boot-retry>Повторить</button>';
  /*
    Внешняя причина аварии приходит из адаптера и по длине не ограничена:
    в строку помещается только её начало, целая остаётся под «подробностями».
  */
  const cut = (text) => (text.length > 64 ? `${text.slice(0, 64).trimEnd()}…` : text);

  let state;
  let html;

  if (lastLoad.source === 'снимок') {
    const at = snapshotStamp(lastLoad.snapshotAt);
    state = 'snapshot';
    html = line('Показан снимок таблицы',
      `${at ? `от ${esc(at)} — ` : ''}живая база не ответила`)
      + `<div class="data-notice__body"><p>Это автоматическая копия данных, снятая в это время: рейтинг, `
      + 'кварты и летопись верны на неё. Форум, вход и новые посты живут только '
      + 'в живой базе — они появятся, как только она ответит.</p>'
      + retry + '</div>';
  } else if (lastLoad.source === '') {
    /*
      Хвостовая точка убирается, а не оставляется: сообщения адаптера приходят
      уже с точкой, и без этой чистки страница выдавала «Проверьте интернет..».
      Два знака подряд читаются как опечатка, а опечатка в тексте про аварию
      выглядит так, будто ей не верят.
    */
    const reason = (lastLoad.primaryError || 'ни база, ни снимок рядом с сайтом не ответили')
      .replace(/[.\s]+$/, '');
    state = 'none';
    html = line('Данные не дошли', cut(esc(reason)))
      + `<div class="data-notice__body"><p>`
      + `Данные не дошли: ${esc(reason)}. Рейтинг и летопись пусты, справочник `
      + 'и правила работают. Кнопка ниже повторяет тот же запрос, с которого '
      + 'сайт стартует при открытии.</p>'
      + retry + '</div>';
  } else {
    state = 'live';
    html = line('Живая база', 'копия таблицы не понадобилась')
      + `<div class="data-notice__body"><p>Рейтинг, кварты и летопись прочитаны из базы прямо сейчас. `
      + 'Форум, вход и запись постов работают.</p>'
      + retry + '</div>';
  }

  /*
    Страж перерисовки: повтор после аварии даёт тот же текст, а полоска —
    живая область (aria-live), и второй раз подряд читатель услышал бы то же
    слово как новое. Совпало — DOM не трогаем.

    ПОКАЗ ИСКЛЮЧИТЕЛЬНО БЕДЫ: `live` и стартовое `wait` прячут рамку,
    `snapshot` и `none` показывают. Порядок присваиваний не случайный —
    полоска снимается с скрытия до того, как внутри меняются слова. Живая
    область объявляет то, что появилось в видимом узле; если сделать наоборот,
    читатель с программой экрана не услышал бы ни «снимок», ни «данные не
    дошли» — то есть остался бы без единственного сигнала, для которого рамка
    и существует.
  */
  if (lastNoticePainted === state + html) return;
  lastNoticePainted = state + html;
  box.hidden = state === 'live';
  box.dataset.state = state;
  box.innerHTML = html;
}

/* Подпись последнего нарисованного состояния полоски — см. страж в dataNotice. */
let lastNoticePainted = '';

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

/**
 * КРАСКИ АЛЬЯНСОВ, ДОВЕДЁННЫЕ ДО КОНТРАСТА.
 *
 * Цвет альянса вносит человек, и на светлой бумаге бледная краска исчезает:
 * замер худшей из 28 красок живого графика давал 1,13:1 при норме 3:1. ui/ink.js считает для
 * каждого цвета по два значения — для бумаги и для ночи, — а сюда приходит
 * готовый CSS-блок для `<style id="alliance-inks">` из головы страницы.
 *
 * ПРАВДУ ГОВОРИТ БЛОК, А НЕ КРАСКА В РАЗМЕТКЕ. Страницы рисуют линии ссылкой
 * `var(--aink-…)`, поэтому переключатель темы перекрашивает график сам:
 * `applyTheme` меняет атрибут и больше ничего, и per-theme значения — единство,
 * которое не даёт нарисованному для бумаги графику остаться бумажным ночью.
 *
 * Пишется один раз на приход данных, а не на каждую отрисовку: данные едут
 * из слоя данных, а render() вызывается и сменой вкладки, и сотней других
 * поводов — пересобирать правила стилей ради них незачем.
 */
function allianceInks(alliances) {
  const node = document.getElementById('alliance-inks');
  if (!node) return;
  const css = allianceInkCss(alliances);
  /*
    Присваивание тексту `<style>` заставляет браузер пересобрать правила и
    перекрасить документ. Тот же набор альянсов приходит и когда человек жмёт
    «Повторить» на полоске про недоступную таблицу: без проверки страница
    перекрашивалась бы заново при каждом нажатии.
  */
  if (node.textContent === css) return;
  node.textContent = css;
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

  /*
    Контур подгоняется под форму будущих данных, а не ставится одна рамка на
    все вкладки. Главная начинается не с карточки списка, а с героя на полэкрана
    и панели источника в его правой колонке, а под ним четыре разных по росту
    блока сводки: семь карточек по 190 px резервировали бы другую высоту, и в
    момент прихода цифр страница всё равно разъезжалась бы.

    Перемер 17.10 (tools/walk.mjs по всем пятнадцати маршрутам) показал, что
    «семь карточек для остальных» ошибается в ту же сторону, только громче:
    живой экран «Турниров» — одна компактная плашка на 197 px на мониторе и
    220 на телефоне, а резерв в 1410 раздувал документ до 1939 px. С приходом
    данных документ сжимался на метр, подвал въезжал в кадр, и телефон платил
    за это 0,30 CLS — вдвое больше нормы. Поэтому форма берётся по маршруту.
    Про «Гайды»: у них контур рисует модуль (row, 6), и первый кадр обязан
    совпадать с ним, иначе страница дёргается дважды — сначала с семи карточек
    на шесть строк, потом со строк на живой список. Справочник в этой таблице
    не нужен: он liveFirst, оболочка отдаёт экран пустым, и дорисовывать рамку
    под чужой контур смысла нет.
  */
  const shape = id === 'home' ? ['ops', 5]
    : id === 'guides' ? ['row', 6]
      : id === 'tournaments' ? ['card', 1]
        : ['card', 7];
  app.innerHTML = liveFirst ? ''
    : `<div class="loading">${skWithCaption('Загружаем данные…', shape[0], shape[1])}</div>`;
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
    hideSlowBootNotice();

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
      /*
        Откуда на экране цифры. Страница не лезет в слой данных сама: ей
        кладут готовое — источник и час, если показан снимок. Без этого любая
        вкладка могла бы либо молчать про свежесть, либо выдумывать её.
      */
      dataMeta: { source: lastLoad.source, stamp: snapshotStamp(lastLoad.snapshotAt) },
      // Данные пришли: объяснять аварию странице больше нечего. Поле остаётся
      // на месте, потому что пустой кадр после падения несёт в нём текст
      // ошибки — у двух кадров должен быть один и тот же набор полей.
      loadError: '',
      problems,
    };

    allianceInks(view.alliances);
    sourceBadge();
    dataNotice();
    render();
    finishBootLoader();
  } catch (err) {
    console.error(err);
    // Ответ получен, пусть и с ошибкой: объяснять молчание больше нечего.
    dataArrived = true;
    hideSlowBootNotice();

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

    // Альянсов нет, поэтому краски чистятся. Пропустить — значит оставить
    // блок от прежших данных: после удачной загрузки, за которой «Повторить»
    // уже не сумел, на экране висели бы переменные про таблицу, которой нет.
    allianceInks(view.alliances);

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
