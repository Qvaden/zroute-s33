/**
 * ФОРУМ — ГЛАВНАЯ ВКЛАДКА.
 *
 * Две части на одной странице, и порядок не случаен.
 *
 * СВЕРХУ — хроника сервера в новом виде. Старая вкладка «Хронология» никуда
 * не делась: там архив с фильтрами по годам, стеной трофеев и статистикой,
 * и он нужен как есть. Здесь другая задача — одной полосой сказать, что
 * происходит прямо сейчас, чтобы человек, зашедший впервые, понял контекст
 * до того, как начнёт читать чужие посты.
 *
 * НИЖЕ — сам форум: правила, лента, посты.
 *
 * Почему правила выше ленты, а не спрятаны ссылкой: правило, которое надо
 * искать, не работает. Оно должно попасться на глаза раньше, чем кнопка
 * «написать», иначе первым нарушением станет незнание.
 *
 * Функции здесь чистые: получают состояние, возвращают строку. Живое
 * поведение — в src/forum/mount.js. Разделение то же, что у остальных
 * страниц, и по той же причине: чистую разметку можно проверить без браузера.
 */
import { esc, plural } from '../ui/helpers.js';
import { serverEvents, verdictText, pillText, EVENT_TYPE } from '../logic/event-types.js';
import { RULES, SANCTIONS, CATEGORIES, REACTIONS, categoryLabel } from '../forum/rules.js';
import { postBody, excerpt, editorHtml, timeAgo, fullTime, nickColor, nickInitial } from '../forum/format.js';
import { roleBadge, roleLabel } from '../forum/roles.js';
import { CONFIG } from '../../config.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Ключ еженедельной темы в текстах сайта (вкладка «Тексты» в панели).
 * Держится здесь одним словом — в admin/edit.js этот же ключ предлагается
 * в форме. Расхождение между двумя списками ловит тест.
 */
export const FORUM_THEME_KEY = 'forum-theme';

/**
 * @typedef {Object} ForumViewState
 * @property {boolean} ready        Настроен ли источник форума.
 * @property {boolean} shared       Видят ли записи другие люди.
 * @property {string}  sourceName
 * @property {import('../forum/contract.js').ForumUser|null} me
 * @property {import('../forum/contract.js').ForumPost[]} posts
 * @property {number}  total
 * @property {string}  category
 * @property {string}  sort
 * @property {boolean} loading
 * @property {string}  error
 * @property {string|null} openPostId
 * @property {import('../forum/contract.js').ForumComment[]} comments
 */

/**
 * @param {any} view Данные сайта: нужны события для хроники.
 * @param {Partial<ForumViewState>} [state]
 */
export function renderForum(view, state = {}) {
  const s = {
    ready: false,
    shared: false,
    sourceName: '',
    me: null,
    posts: [],
    total: 0,
    category: 'all',
    sort: 'fresh',
    loading: true,
    error: '',
    openPostId: null,
    comments: [],
    query: '',
    editingPostId: null,
    hot: [],
    lead: [],
    leadPeriod: 'week',
    ...state,
  };

  return `
    ${renderChronicleBand(view?.events ?? [])}
    ${renderWelcome(s)}
    ${renderWeekTheme(view)}
    ${renderHotTopics(s)}
    ${renderLeaderboard(s)}
    ${renderRules()}
    ${renderAccountBar(s)}
    ${renderComposer(s)}
    ${renderFeedControls(s)}
    ${renderFeed(s)}`;
}

/* ── Хроника сервера: новая подача ────────────────────────────────────────── */

/**
 * Полоса «что происходит».
 *
 * Отличие от вкладки «Хронология» осознанное. Там летопись: всё, что было,
 * с фильтрами и стеной трофеев. Здесь — короткая сводка последнего и лента
 * из нескольких свежих записей, которую видно целиком без прокрутки.
 * Одно и то же событие в двух местах не противоречие: это разные вопросы —
 * «что было за всю историю» и «что сейчас».
 */
function renderChronicleBand(events) {
  const server = serverEvents(events);
  // Полоса живёт всей летописью: последняя запись — это последняя запись
  // вообще, а не только последний захват или защита. Статистика ниже
  // по-прежнему считается по серверным исходам.
  const all = (events ?? [])
    .filter((e) => e.date instanceof Date && !Number.isNaN(e.date.getTime()))
    .sort((a, b) => b.date - a.date);

  if (!all.length) {
    return `
      <section class="hero forum-chron forum-chron--empty">
        <span class="eyebrow">Сводка сервера</span>
        <h1 class="forum-chron__title">Сервер 33 · сообщество</h1>
        <p class="muted">
          Хроника появится здесь, как только внесут первую запись.
          Форум ниже работает независимо от неё.
        </p>
      </section>`;
  }

  const last = all[0];
  const meta = EVENT_TYPE[last.type] ?? EVENT_TYPE.other;
  const kind = meta.kind ?? null;

  const captures = server.filter((e) => e.type === 'server_capture').length;
  const defended = server.filter((e) => e.type === 'server_defended').length;

  // Пять свежих: больше на телефоне уже требует прокрутки, а полоса должна
  // читаться целиком.
  const recent = all.slice(0, 5);

  // Заголовок — самая последняя запись. У исходов вердикт уже сформулирован
  // («Захватили Столицу сервера 36»), у остальных типов это название записи.
  const title = meta.verdict
    ? verdictText(last.type, last.serverNumber)
    : (last.title || pillText(last.type, last.serverNumber));

  return `
    <section class="hero forum-chron${kind ? ` forum-chron--${esc(kind)}` : ''}">
      <div class="forum-chron__head">
        <span class="eyebrow">Сводка сервера</span>
        <span class="forum-chron__live">
          <i aria-hidden="true"></i>LIVE
        </span>
      </div>

      <h1 class="forum-chron__title">${esc(title)}</h1>
      <p class="forum-chron__date">
        ${last.date.getUTCDate()} ${esc(MONTH_SHORT[last.date.getUTCMonth()])}, ${last.date.getUTCFullYear()}
        ${last.durationDays ? `<span class="hero__sep">·</span> ${esc(plural(last.durationDays, 'день', 'дня', 'дней'))}` : ''}
      </p>

      <div class="forum-chron__stats">
        <div class="forum-chron__stat">
          <b class="num">${captures}</b><span>${esc(plural(captures, 'Столица взята', 'Столицы взято', 'Столиц взято').replace(/^\d+\s/, ''))}</span>
        </div>
        <div class="forum-chron__stat">
          <b class="num">${defended}</b><span>${defended === 1 ? 'защита своей' : 'защит своей'}</span>
        </div>
        <div class="forum-chron__stat">
          <b class="num">${all.length}</b><span>${esc(plural(all.length, 'запись в летописи', 'записи в летописи', 'записей в летописи').replace(/^\d+\s/, ''))}</span>
        </div>
      </div>

      <ul class="forum-chron__feed">
        ${recent
          .map((e) => {
            const m = EVENT_TYPE[e.type] ?? EVENT_TYPE.other;
            const k = m.kind ?? null;
            const what = m.verdict
              ? pillText(e.type, e.serverNumber)
              : (e.title || pillText(e.type, e.serverNumber));
            return `<li class="forum-chron__item${k ? ` forum-chron__item--${esc(k)}` : ''}">
              <span class="forum-chron__when num">${e.date.getUTCDate()} ${esc(MONTH_SHORT[e.date.getUTCMonth()])}</span>
              <span class="forum-chron__what">${esc(what)}</span>
            </li>`;
          })
          .join('')}
      </ul>

      <a class="forum-chron__more" href="#/timeline">Вся летопись сервера <b>→</b></a>
    </section>`;
}

/* ── Приветственный баннер ─────────────────────────────────────────────────── */

/**
 * Приветствие новичка.
 *
 * Показывается только гостю, который ещё не вошёл, и только когда на форуме
 * есть что читать. Пустая лента и баннер «первым напиши» уже объясняют всё,
 * что нужно; второй баннер поверх был бы шумом.
 */
function renderWelcome(s) {
  if (!s.ready || !s.posts.length || s.me) return '';

  const total = s.total ?? s.posts.length;
  return `
    <section class="panel forum-welcome" data-forum-welcome>
      <span class="forum-welcome__mark" aria-hidden="true">👋</span>
      <div class="forum-welcome__body">
        <b>Добро пожаловать на форум сервера 33</b>
        <p class="muted">
          Здесь уже ${esc(plural(total, 'тема', 'темы', 'тем'))}. Заходите обсудить
          игру, альянсы и всё, что происходит на сервере.
        </p>
      </div>
      <button type="button" class="forum-btn forum-btn--ghost" data-forum-welcome-auth>
        Войти и начать тему
      </button>
    </section>`;
}

/**
 * ЕЖЕНЕДЕЛЬНАЯ ТЕМА — «рубрики-римпления».
 *
 * Админ заводит её как обычный текст с ключом forum-theme на вкладке «Тексты»
 * (заголовок — название рубрики, текст — как писать в неё). Форум берёт блок
 * из общих данных сайта, поэтому тема одинакова и на форуме, и в гайде, и не
 * требует отдельного запроса к базе. Ключа нет — баннера нет.
 */
function renderWeekTheme(view) {
  const texts = Array.isArray(view?.texts) ? view.texts : [];
  const theme = texts.find((t) => t?.key === FORUM_THEME_KEY);
  if (!theme) return '';

  const title = String(theme.title ?? '').trim() || 'Тема недели';
  const body = String(theme.body ?? '').trim().replace(/\s+/g, ' ');

  return `
    <section class="panel forum-theme" data-forum-theme aria-label="Тема недели">
      <header class="forum-theme__head">
        <span class="forum-theme__mark" aria-hidden="true">🖋</span>
        <span class="eyebrow">Тема недели — пишите в неё</span>
      </header>
      <h2 class="forum-theme__title">${esc(title)}</h2>
      ${
        body
          ? `<p class="forum-theme__body">${esc(body.length > 240 ? `${body.slice(0, 237)}…` : body)}</p>`
          : ''
      }
    </section>`;
}

/**
 * «Самое обсуждаемое» — горячие темы под сводкой сервера.
 *
 * Считаются здесь, а не в базе: лента уже держит число ответов и «согласий»
 * на каждый пост, и «горячее» — это то, что уже обсуждали по-настоящему.
 * Удалённые посты и пустые обсуждения не попадают — иначе сюда пролезал бы
 * удалённый или заброшенный мусор.
 */
function renderHotTopics(s) {
  if (!s.hot.length) return '';
  return `
    <section class="forum-hot" data-forum-hot aria-label="Самое обсуждаемое">
      <header class="forum-hot__head">
        <span class="forum-hot__fire" aria-hidden="true">🔥</span>
        <b>Самое обсуждаемое</b>
      </header>
      <ul class="forum-hot__list">
        ${s.hot
          .map(
            (p) => `<li class="forum-hot__item">
              <a href="#/forum/${esc(p.id)}">
                <span class="forum-hot__title">${esc(p.title)}</span>
                <span class="forum-hot__meta muted">
                  💬 ${p.commentCount ? esc(plural(p.commentCount, 'ответ', 'ответа', 'ответов')) : 'в обсуждении'}
                  ${p.score ? `· ${p.score > 0 ? '+' : ''}${p.score}` : ''}
                </span>
              </a>
            </li>`
          )
          .join('')}
      </ul>
    </section>`;
}

/* ── Лидерборд ────────────────────────────────────────────────────────────── */

/**
 * «Топ игроков» — активность за неделю или всё время.
 *
 * Считается в leaderboard.js из широкой выборки постов: список ранжированный
 * и готовый к показу. Здесь только верстка: ранги, ники с аватарками и три
 * числа — посты, ответы, рейтинг.
 */
function renderLeaderboard(s) {
  const all = Array.isArray(s.lead) ? s.lead : (s.lead?.all ?? []);
  if (!Array.isArray(all) || !all.length) return '';

  const rows = s.leadPeriod === 'week' ? (s.lead?.week ?? []) : all;

  return `
    <section class="panel forum-lead" data-forum-lead aria-label="Топ игроков">
      <header class="forum-lead__head">
        <span class="forum-lead__icon" aria-hidden="true">🏆</span>
        <b>Топ игроков</b>
        ${renderLeadTabs(s)}
      </header>
      ${rows.length ? `
      <ol class="forum-lead__list">
        ${rows
          .map(
            (l) => `<li class="forum-lead__row">
              <span class="forum-lead__rank${l.rank <= 3 ? ' forum-lead__rank--top' : ''}">${l.rank}</span>
              ${avatar(l.nick, l.avatar)}
              <span class="forum-lead__who">
                <b>${nickLink(l.nick)}</b>
                <small>${esc(plural(l.posts, 'пост', 'поста', 'постов'))} ·
                  ${esc(plural(l.comments, 'ответ', 'ответа', 'ответов'))}${
                    l.views ? ` · ${esc(plural(l.views, 'просмотр', 'просмотра', 'просмотров'))}` : ''
                  }</small>
              </span>
              <span class="forum-lead__score" title="Рейтинг">
                <b class="num">${l.score > 0 ? '+' : ''}${l.score}</b>
              </span>
            </li>`
          )
          .join('')}
      </ol>
      ` : `
      <p class="muted forum-lead__empty">За эту неделю ещё никто ничего не написал — станьте первым.</p>
      `}
    </section>`;
}

function renderLeadTabs(s) {
  return `<div class="seg seg--lead" role="tablist">
    ${[
      ['week', 'Неделя'],
      ['all', 'Всё время'],
    ]
      .map(
        ([period, label]) => `<button type="button"
            class="seg__btn${s.leadPeriod === period ? ' is-on' : ''}"
            role="tab" aria-selected="${s.leadPeriod === period}"
            data-forum-lead-period="${period}">${label}</button>`
      )
      .join('')}
  </div>`;
}

/* ── Правила ──────────────────────────────────────────────────────────────── */

/**
 * Правила сложены в <details>: развёрнутый список из восьми пунктов оттеснил
 * бы ленту за пределы экрана, а свёрнутая строка всё равно попадается на глаза
 * раньше, чем кнопка «написать». Внутри — открыто и целиком, без «читать далее».
 */
function renderRules() {
  return `
    <details class="panel forum-rules" data-forum-rules>
      <summary class="forum-rules__summary">
        <span class="forum-rules__mark" aria-hidden="true">§</span>
        <span class="forum-rules__label">
          <b>Правила форума</b>
          <small>${RULES.length} пунктов · нарушение = удаление поста</small>
        </span>
        <span class="forum-rules__chev" aria-hidden="true">▾</span>
      </summary>

      <ol class="forum-rules__list">
        ${RULES.map(
          (r) => `<li class="forum-rules__item" id="rule-${esc(r.id)}">
            <b>${esc(r.title)}</b>
            <p>${esc(r.body)}</p>
          </li>`
        ).join('')}
      </ol>

      <div class="forum-rules__sanctions">
        <span class="eyebrow">Что бывает за нарушение</span>
        <ul>
          ${SANCTIONS.map((t) => `<li>${esc(t)}</li>`).join('')}
        </ul>
      </div>

      <p class="forum-rules__note muted">
        Смысл написанного оценивает человек, а не программа: списка запрещённых
        слов здесь нет. У каждой записи есть кнопка «Пожаловаться» — по жалобе
        разбирается администратор и удаляет пост с указанием пункта.
      </p>
    </details>`;
}

/* ── Аккаунт ──────────────────────────────────────────────────────────────── */

/**
 * Полоса аккаунта.
 *
 * Когда источник не настроен — говорим об этом прямо, вместо того чтобы
 * показать форму, которая ничего не сделает. Неработающая кнопка «Войти»
 * читается как поломка сайта, а честная строка — как состояние проекта.
 */
function renderAccountBar(s) {
  /*
    Ошибка настройки идёт впереди всего: если адаптер отказался работать —
    например, в config.js попал служебный ключ, — человек должен прочитать
    именно это, а не «форум не подключён». Второе неверно и уводит от причины.
  */
  if (s.error && !s.ready) {
    return `
      <section class="panel error">
        <span class="eyebrow">Форум не запустился</span>
        <p>${esc(s.error)}</p>
        <p class="muted">Что исправить — описано в <code>docs/FORUM.md</code>.</p>
      </section>`;
  }

  if (!s.ready) {
    return `
      <section class="panel forum-notice forum-notice--off">
        <span class="eyebrow">Форум ещё не подключён</span>
        <p>
          Записи некуда сохранять: в <code>config.js</code> не заполнен раздел
          <code>forum.supabase</code>. Пока он пуст, регистрация и посты
          недоступны — читать хронику выше это не мешает.
        </p>
        <p class="muted">Порядок подключения описан в <code>docs/FORUM.md</code>.</p>
      </section>`;
    }

  if (!s.shared) {
    return `
      <section class="panel forum-notice forum-notice--local">
        <div class="forum-notice__row">
          <span class="eyebrow">Черновой режим</span>
          <span class="forum-notice__tag">${esc(s.sourceName)}</span>
        </div>
        <p>
          Всё написанное сохраняется только в этом браузере и до других людей
          не доходит. Так можно спокойно посмотреть, как форум устроен,
          не заводя аккаунтов.
        </p>
        ${renderWhoAmI(s)}
      </section>`;
  }

  return `<section class="panel forum-account">${renderWhoAmI(s)}</section>`;
}

function renderWhoAmI(s) {
  if (s.me) {
    const muted = s.me.mutedUntil && s.me.mutedUntil > new Date();
    return `
      <div class="forum-me">
        ${avatar(s.me.nick, s.me.avatarUrl)}
        <span class="forum-me__body">
          <b>${nickLink(s.me.nick)}</b>
          <small>${roleBadge(s.me) || esc(roleLabel(s.me))}</small>
        </span>
        <a class="forum-btn forum-btn--ghost" href="#/user/${encodeURIComponent(s.me.nick)}">Профиль</a>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-signout>Выйти</button>
      </div>
      ${
        s.me.banned
          ? `<p class="forum-blocked">Вам запрещено писать. Причина: ${esc(s.me.banReason || 'нарушение правил')}</p>`
          : ''
      }
      ${
        muted
          ? `<p class="forum-blocked">Писать можно снова с ${esc(fullTime(s.me.mutedUntil))}</p>`
          : ''
      }`;
  }

  const L = CONFIG.forum.limits;
  return `
    <form class="forum-auth" data-forum-auth>
      <div class="forum-auth__head">
        <span class="eyebrow">Вход и регистрация</span>
        <small class="muted">Ник и пароль. Почта не нужна.</small>
      </div>
      <div class="forum-auth__fields">
        <label class="forum-field">
          <span>Ник</span>
          <input type="text" name="nick" autocomplete="username" required
                 minlength="${L.nickMin}" maxlength="${L.nickMax}"
                 placeholder="как в игре">
        </label>
        <label class="forum-field">
          <span>Пароль</span>
          <input type="password" name="password" autocomplete="current-password" required
                 minlength="${L.passwordMin}" placeholder="от ${L.passwordMin} символов">
        </label>
      </div>
      <div class="forum-auth__actions">
        <button type="submit" class="forum-btn" data-forum-mode="signin">Войти</button>
        <button type="submit" class="forum-btn forum-btn--ghost" data-forum-mode="signup">Зарегистрироваться</button>
      </div>
      <p class="forum-auth__note muted">
        Пароль восстановить письмом нельзя — почты у форума нет.
        Если забудете, сброс делает администратор.
      </p>
      <p class="forum-error" data-forum-auth-error hidden></p>
    </form>`;
}

/* ── Написать пост ────────────────────────────────────────────────────────── */

/**
 * Панель форматирования для полей текста.
 *
 * Кнопки работают через document.execCommand — их тройка «тег + значение
 * команды» это единственный источник правды. Добавить стиль — значит добавить
 * строку в один из массивов ниже; разбирать ничего не нужно.
 *
 * Текст хранится как HTML, который собрал редактор, и при показе проходит
 * через белый список тегов в sanitize.js. Поэтому жирный, цвет и прочее
 * превращаются в вид сразу, не дожидаясь отправки формы.
 */
const MD_COMMANDS = [
  { cmd: 'bold', label: 'Ж', title: 'Жирный' },
  { cmd: 'italic', label: 'К', title: 'Курсив' },
  { cmd: 'underline', label: 'Ч', title: 'Подчёркнутый' },
  { cmd: 'strikeThrough', label: 'З', title: 'Зачёркнутый' },
  { cmd: 'code', label: '&lt;/&gt;', title: 'Инлайн-код: выделенный текст как код' },
  { cmd: 'subscript', label: 'X<span class="forum-md__mark">2</span>', title: 'Нижний индекс' },
  { cmd: 'superscript', label: 'X<span class="forum-md__mark">²</span>', title: 'Верхний индекс' },
];

const MD_BLOCKS = [
  { cmd: 'formatBlock', value: 'h3', label: 'Заголовок', title: 'Заголовок абзаца' },
  { cmd: 'formatBlock', value: 'blockquote', label: '❝ Цитата', title: 'Цитировать абзац' },
  { cmd: 'formatBlock', value: 'pre', label: 'Код-блок', title: 'Отдельный блок с кодом' },
  { cmd: 'insertUnorderedList', label: '• Список', title: 'Маркированный список' },
  { cmd: 'insertOrderedList', label: '1. Список', title: 'Нумерованный список' },
];

/*
 * Цвета текста. Ровно столько, сколько читается на тёмном фоне сайта: всё,
 * что темнее этого набора, на почти чёрном фоне не видно человеческим глазом.
 */
const MD_COLORS = [
  '#ff6b6b', '#ff9a4a', '#ffc93c', '#4fd98a', '#5ce0dd',
  '#6fa8ff', '#b78cff', '#9aa4b2', '#ffffff',
];

function renderMdBar() {
  const line = (list) =>
    list
      .map(
        (c) => `<button type="button" class="forum-md__btn"
                 data-editor-cmd="${esc(c.cmd)}"${c.value ? ` data-editor-value="${esc(c.value)}"` : ''}
                 title="${esc(c.title)}" aria-label="${esc(c.title)}">${c.label}</button>`
      )
      .join('');

  const palette = MD_COLORS.map(
    (h) => `<button type="button" class="forum-md__color" data-editor-color="${esc(h)}"
             title="Цвет текста" aria-label="Цвет текста ${esc(h)}" style="--swatch:${esc(h)}"></button>`
  ).join('');

  return `
    <div class="forum-md" role="toolbar" aria-label="Форматирование текста">
      <div class="forum-md__row">${line(MD_COMMANDS)}</div>
      <div class="forum-md__row">${line(MD_BLOCKS)}</div>
      <div class="forum-md__row forum-md__row--palette">
        <span class="forum-md__capt">Цвет текста</span>
        ${palette}
        <button type="button" class="forum-md__color forum-md__color--none"
                data-editor-color="inherit" title="Вернуть цвет по умолчанию"
                aria-label="Вернуть цвет по умолчанию"></button>
      </div>
    </div>`;
}

function renderComposer(s) {
  if (!s.ready || !s.me) return '';
  if (s.me.banned) return '';

  const L = CONFIG.forum.limits;
  return `
    <details class="panel forum-composer" data-forum-composer>
      <summary class="forum-composer__summary">
        <span class="forum-composer__plus" aria-hidden="true">+</span>
        <b>Написать пост</b>
      </summary>

      <form data-forum-new>
        <label class="forum-field">
          <span>Раздел</span>
          <select name="category" required>
            ${CATEGORIES.map(
              (c) => `<option value="${esc(c.id)}">${esc(c.label)} — ${esc(c.hint)}</option>`
            ).join('')}
          </select>
        </label>

        <label class="forum-field">
          <span>Заголовок</span>
          <input type="text" name="title" required
                 minlength="${L.titleMin}" maxlength="${L.titleMax}"
                 placeholder="о чём речь, одной строкой">
        </label>

        <label class="forum-field">
          <span>Текст</span>
          <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
               name="body" data-editor data-limit="${L.bodyMax}"
               data-placeholder="Писать можно сразу как надо: выделили — стало жирным или цветным, прямо в поле."></div>
        </label>

        ${renderMdBar()}

        ${renderAttachRow('new')}

        <div class="forum-poll-creator" data-forum-poll-creator>
          <button type="button" class="forum-btn forum-btn--ghost" data-forum-poll-toggle>
            Добавить опрос
          </button>
          <div class="forum-poll-form" data-forum-poll-form hidden>
            <label class="forum-field">
              <span>Вопрос</span>
              <input type="text" name="poll_question" maxlength="200"
                     placeholder="Что хотите спросить?">
            </label>
            <div class="forum-poll-options" data-forum-poll-options>
              <label class="forum-field">
                <span>Вариант 1</span>
                <input type="text" name="poll_option_0" maxlength="120" placeholder="Вариант ответа">
              </label>
              <label class="forum-field">
                <span>Вариант 2</span>
                <input type="text" name="poll_option_1" maxlength="120" placeholder="Вариант ответа">
              </label>
            </div>
            <button type="button" class="forum-btn forum-btn--ghost" data-forum-poll-add>+ Ещё вариант</button>
            <label class="forum-field forum-field--inline">
              <input type="checkbox" name="poll_multiple">
              <span>Несколько вариантов</span>
            </label>
            <button type="button" class="forum-btn forum-btn--ghost" data-forum-poll-remove>Убрать опрос</button>
          </div>
        </div>

        <p class="forum-composer__rules muted">
          Публикуя пост, вы соглашаетесь с правилами выше. Нарушение —
          удаление с указанием пункта, повторное — запрет писать.
        </p>

        <div class="forum-composer__actions">
          <button type="submit" class="forum-btn">Опубликовать</button>
          <button type="reset" class="forum-btn forum-btn--ghost">Очистить</button>
        </div>
        <p class="forum-error" data-forum-new-error hidden></p>
      </form>
    </details>`;
}

/**
 * Строка прикрепления картинок.
 *
 * ПОЧЕМУ КАРТИНКИ ГРУЗЯТСЯ ПОСЛЕ ПУБЛИКАЦИИ, А НЕ ДО.
 *
 * Вложение ссылается на запись, значит запись должна существовать. Можно было
 * бы загрузить файлы заранее и привязать потом, но тогда брошенная форма
 * оставляла бы в хранилище файлы, на которые никто не ссылается, — и найти
 * их позже было бы нечем.
 *
 * Поэтому здесь выбранные файлы только показываются превью, а уходят они
 * следом за постом. Человеку это видно: кнопка говорит «Опубликовать»,
 * и картинки появляются вместе с текстом.
 *
 * @param {'new'|string} scope 'new' для нового поста, id поста для комментария.
 */
function renderAttachRow(scope) {
  return `
    <div class="forum-attach" data-forum-attach="${esc(scope)}">
      <label class="forum-attach__btn">
        <span aria-hidden="true">🖼</span>
        <span>Прикрепить картинку</span>
        <input type="file" accept="image/*" multiple hidden data-attach-input="${esc(scope)}">
      </label>
      <div class="forum-attach__list" data-attach-list="${esc(scope)}"></div>
      <small class="forum-attach__hint">До ${CONFIG.forum.limits.attachmentsMax} картинок. Сжимаются автоматически.</small>
    </div>
    <p class="forum-error" data-attach-error="${esc(scope)}" hidden></p>`;
}

/**
 * Форма правки своего поста: встаёт на место заголовка и текста карточки.
 *
 * Те же поля, что у нового поста, — человек правит то же самое. Ссылка на
 * саму запись, а не на форму: превью прикреплённых картинок живёт по области
 * `edit:${id}` и после перерисовки не теряется.
 */
function renderEditForm(p) {
  const L = CONFIG.forum.limits;
  return `
    <form class="forum-edit" data-forum-edit-form="${esc(p.id)}">
      <label class="forum-field">
        <span>Раздел</span>
        <select name="category" required>
          ${CATEGORIES.map(
            (c) => `<option value="${esc(c.id)}" ${c.id === p.category ? 'selected' : ''}>${esc(c.label)} — ${esc(c.hint)}</option>`
          ).join('')}
        </select>
      </label>

      <label class="forum-field">
        <span>Заголовок</span>
        <input type="text" name="title" required
               minlength="${L.titleMin}" maxlength="${L.titleMax}"
               value="${esc(p.title)}">
      </label>

<label class="forum-field">
        <span>Текст</span>
        <div class="forum-editor" contenteditable="true" role="textbox" aria-multiline="true"
             name="body" data-editor data-limit="${L.bodyMax}"
             data-placeholder="Править можно прямо здесь — стили применяются сразу">${editorHtml(p.body)}</div>
      </label>

      ${renderMdBar()}

      ${renderAttachRow(`edit:${p.id}`)}

      <div class="forum-edit__actions">
        <button type="submit" class="forum-btn">Сохранить</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-edit-cancel>Отмена</button>
      </div>
      <p class="forum-error" data-forum-edit-error hidden></p>
    </form>`;
}

/* ── Управление лентой ────────────────────────────────────────────────────── */

function renderFeedControls(s) {
  if (!s.ready) return '';

  const SORTS = [
    { id: 'fresh', label: 'Свежее' },
    { id: 'top', label: 'Лучшее' },
    { id: 'talked', label: 'Обсуждаемое' },
  ];

  // Текущий раздел для подписи выпадающего списка на телефоне.
  const currentCat = [{ id: 'all', label: 'Все' }, ...CATEGORIES]
    .find((c) => c.id === s.category) ?? { id: 'all', label: 'Все' };

  return `
    <div class="ctl ctl--forum">
      <label class="search forum-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
        </svg>
        <input type="search" name="query" placeholder="Найти запись…"
               value="${esc(s.query ?? '')}" data-forum-search
               autocomplete="off" spellcheck="false">
      </label>
      <div class="seg seg--cat" role="group" aria-label="Раздел форума">
        <button type="button" class="seg__btn ${s.category === 'all' ? 'is-on' : ''}"
                data-forum-cat="all">Все</button>
        ${CATEGORIES.map(
          (c) => `<button type="button" class="seg__btn ${s.category === c.id ? 'is-on' : ''}"
                          data-forum-cat="${esc(c.id)}" title="${esc(c.hint)}">${esc(c.label)}</button>`
        ).join('')}
      </div>
      <div class="pick">
        <span class="pick__cap">Раздел</span>
        <button type="button" class="pick__btn" data-pick-open
                aria-haspopup="listbox" aria-expanded="false" aria-label="Выбрать раздел">
          <span class="pick__val">${esc(currentCat.label)}</span>
          <span class="pick__carat" aria-hidden="true"></span>
        </button>
        <div class="pick__menu" role="listbox" aria-label="Раздел форума">
          ${[{ id: 'all', label: 'Все' }, ...CATEGORIES].map(
            (c) => `<button type="button" class="pick__opt" role="option" data-forum-cat="${esc(c.id)}"
                    ${s.category === c.id ? 'aria-selected="true"' : ''}>${esc(c.label)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="seg seg--sort" role="group" aria-label="Порядок">
        ${SORTS.map(
          (o) => `<button type="button" class="seg__btn ${s.sort === o.id ? 'is-on' : ''}"
                          data-forum-sort="${esc(o.id)}">${esc(o.label)}</button>`
        ).join('')}
      </div>
    </div>`;
}

/**
 * Метка участника: аватарка или буква в цветном квадрате.
 *
 * Буква не заглушка «пока не загрузил», а полноценный вариант: цвет считается
 * из ника и всегда один, поэтому знакомого человека видно в ленте по цвету
 * даже без фотографии.
 *
 * Ник — ссылка на профиль. Так устроены все форумы, и человек это пробует
 * первым делом: нажать на имя, чтобы узнать, кто пишет.
 */
function avatar(nick, url, size = '') {
  const cls = `forum-ava${size ? ` forum-ava--${size}` : ''}`;
  if (url) {
    return `<img class="${cls} forum-ava--img" src="${esc(url)}"
                 alt="${esc(nick)}" loading="lazy" width="36" height="36">`;
  }
  return `<span class="${cls}" style="--ava:${esc(nickColor(nick))}">${esc(nickInitial(nick))}</span>`;
}

/** Ссылка на страницу участника. */
function nickLink(nick) {
  return `<a class="forum-nick" href="#/user/${encodeURIComponent(nick)}">${esc(nick)}</a>`;
}

/**
 * Прикреплённые картинки.
 *
 * Одна — во всю ширину, несколько — по две в ряд. Скриншот интерфейса игры
 * при трёх в ряд на телефоне становится нечитаемым, и открывать его придётся
 * всё равно.
 *
 * Больше ${CONFIG.forum.limits.attachmentsMax} не бывает: предел держит база
 * (см. supabase/profiles.sql) и тот же предел стоит в config.js.
 */
function renderShots(item) {
  const shots = Array.isArray(item.attachments) ? item.attachments.filter((a) => a?.url) : [];
  if (!shots.length) return '';

  const multi = shots.length > 1;
  return `
    <div class="forum-shots ${multi ? 'forum-shots--multi' : ''}">
      ${shots
        .map(
          (a, i) => `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
            <img src="${esc(a.url)}" alt="Скриншот ${i + 1}" loading="lazy">
          </a>`
        )
        .join('')}
    </div>`;
}

/* ── Лента ────────────────────────────────────────────────────────────────── */

function renderFeed(s) {
  if (!s.ready) return '';

  if (s.error) {
    return `<section class="panel error forum-feed__error">
      <h2>Форум не отвечает</h2>
      <p>${esc(s.error)}</p>
      <button type="button" class="forum-btn" data-forum-retry>Попробовать снова</button>
    </section>`;
  }

  if (s.loading) {
    return '<div class="loading" data-forum-loading>Загружаем ленту…</div>';
  }

  if (!s.posts.length) {
    if (s.query) {
      return `<section class="panel forum-empty">
        <span class="eyebrow">Поиск по форуму</span>
        <h2>Ничего не нашлось</h2>
        <p class="muted">Ни в названиях, ни в тексте записей по «${esc(s.query)}»
          ничего не нашлось. Попробуйте короче или без опечаток.</p>
      </section>`;
    }
    return `<section class="panel forum-empty">
      <span class="eyebrow">${s.category === 'all' ? 'Пока пусто' : 'В этом разделе пусто'}</span>
      <h2>Ни одного поста</h2>
      <p class="muted">
        ${
          s.me
            ? 'Первый пост может быть вашим — кнопка «Написать пост» выше.'
            : 'Чтобы написать первый пост, войдите или зарегистрируйтесь.'
        }
      </p>
    </section>`;
  }

  return `
    <div class="forum-feed" data-forum-feed>
      ${s.posts.map((p) => renderPostCard(p, s)).join('')}
    </div>
    ${
      s.posts.length < s.total
        ? '<button type="button" class="forum-btn forum-btn--wide" data-forum-more>Показать ещё</button>'
        : ''
    }`;
}

/**
 * Карточка поста в ленте.
 *
 * Удалённый пост остаётся на месте заглушкой с причиной. Молча исчезнувший
 * пост читается как поломка сайта и порождает второй такой же, а причина —
 * единственное, чем правило вообще чему-то учит.
 */
export function renderPostCard(p, s) {
  if (p.deleted) {
    return `<article class="panel forum-post forum-post--deleted" data-forum-post="${esc(p.id)}">
      <div class="forum-post__gone">
        <span class="forum-post__gone-mark" aria-hidden="true">✕</span>
        <div>
          <b>Пост удалён</b>
          <p class="muted">${esc(p.deletedReason || 'Нарушение правил форума')}</p>
        </div>
      </div>
    </article>`;
  }

  const isOpen = s.openPostId === p.id;
  const canModerate = s.me && (s.me.role === 'admin' || s.me.role === 'moderator');
  const isMine = s.me && s.me.id === p.authorId;
  const editing = s.editingPostId === p.id;
  const canReply = Boolean(isOpen && s.me && !s.me.banned);
  // «Мой след» — темы, где участник оставил след: свой пост, реакция или голос
  // в опросе. Считается из данных, которые карточка уже несёт: сверяться
  // с ответами на каждый пост — N+1 запросов на ленту и лишняя нагрузка.
  const inTrail = Boolean(s.me) && (Boolean(isMine) || Boolean(p.myReaction) || Boolean(
    Array.isArray(p.poll?.options) && p.poll.options.some((o) => o.mine)
  ));

  return `
    <article class="panel forum-post ${p.pinned ? 'forum-post--pinned' : ''}${inTrail ? ' forum-post--trail' : ''}" data-forum-post="${esc(p.id)}">
      <header class="forum-post__head">
        ${avatar(p.authorNick, p.authorAvatar)}
        <div class="forum-post__by">
          <b>${nickLink(p.authorNick)}${
            roleBadge({ role: p.authorRole }, { short: true })
          }${
            p.authorAlliance ? ` <span class="forum-post__ally">${esc(p.authorAlliance)}</span>` : ''
          }</b>
          <time datetime="${esc(p.createdAt.toISOString())}" title="${esc(fullTime(p.createdAt))}">
            ${esc(timeAgo(p.createdAt))}${p.editedAt ? ' · изменён' : ''}
          </time>
        </div>
        <span class="forum-post__cat">${esc(categoryLabel(p.category))}</span>
        ${p.pinned ? '<span class="forum-post__pin" title="Закреплён">📌</span>' : ''}
        ${
          inTrail
            ? '<span class="forum-post__trail" title="Вы участвовали: ваш пост, реакция или голос в опросе">Ваш след</span>'
            : ''
        }
      </header>

      ${
        editing
          ? renderEditForm(p)
          : `
      <h2 class="forum-post__title">
        ${isOpen ? esc(p.title) : `<a href="#/forum/${esc(p.id)}">${esc(p.title)}</a>`}
      </h2>

      <div class="forum-post__body">
        ${isOpen ? postBody(p.body) : `<p>${esc(excerpt(p.body))}</p>`}
      </div>

      ${renderShots(p)}

      ${p.poll ? renderPoll(p.poll, s) : ''}

      ${
        !isOpen && p.body.length > 220
          ? `<a class="forum-post__expand" href="#/forum/${esc(p.id)}">Читать целиком</a>`
          : ''
      }`
      }

      <footer class="forum-post__foot">
        ${renderReactions('post', p, s)}
        <a class="forum-post__comments" href="#/forum/${esc(p.id)}">
          💬 ${p.commentCount ? esc(plural(p.commentCount, 'ответ', 'ответа', 'ответов')) : 'ответить'}
        </a>
        <span class="forum-post__views">👁 ${Number(p.views || 0)}</span>
        <span class="forum-post__acts">
          ${
            isMine
              ? `<button type="button" class="forum-act" data-forum-edit="${esc(p.id)}">Редактировать</button>`
              : ''
          }
          ${
            canModerate
              ? `<button type="button" class="forum-act" data-forum-pin="${esc(p.id)}"
                         aria-pressed="${p.pinned ? 'true' : 'false'}"
                         title="${p.pinned ? 'Открепить — убрать из топа ленты' : 'Закрепить — держать сверху ленты'}">${
                   p.pinned ? 'Открепить' : 'Закрепить'
                 }</button>`
              : ''
          }
          ${
            isMine || canModerate
              ? `<button type="button" class="forum-act" data-forum-del-post="${esc(p.id)}"
                         title="${isMine && !canModerate ? 'Удалить свой пост' : 'Удалить с указанием причины'}">Удалить</button>`
              : ''
          }
          ${
            canReply
              ? `<button type="button" class="forum-act" data-forum-quote="post:${esc(p.id)}"
                         title="Вставить текст поста в ответ">Цитировать</button>`
              : ''
          }
          ${
            s.me && !isMine
              ? `<button type="button" class="forum-act" data-forum-report="post:${esc(p.id)}">Пожаловаться</button>`
              : ''
          }
        </span>
      </footer>

      ${isOpen ? renderComments(p, s) : ''}
    </article>`;
}

/**
 * Реакции.
 *
 * Согласие и несогласие стоят отдельно и крупно: это ответ на пост. Смайлики
 * собраны за одной кнопкой, потому что их семь, и вывалить все в строку
 * на телефоне значит занять ими экран целиком.
 */
function renderReactions(targetType, item, s) {
  const [likeMeta, dislikeMeta] = REACTIONS;
  const extras = REACTIONS.slice(2);
  const counts = item.reactions ?? {};
  const mine = item.myReaction;
  const can = Boolean(s.me);

  const key = `${targetType}:${item.id}`;

  const chosenExtra = extras.find((r) => r.id === mine);
  const extraTotal = extras.reduce((sum, r) => sum + Number(counts[r.id] ?? 0), 0);

  return `
    <div class="forum-react" ${can ? '' : 'data-forum-react-locked'}>
      <button type="button"
              class="forum-react__btn ${mine === 'like' ? 'is-on' : ''}"
              data-forum-react="${esc(key)}:like"
              ${can ? '' : 'disabled title="Войдите, чтобы отреагировать"'}>
        <span aria-hidden="true">${likeMeta.glyph}</span>
        <b class="num">${Number(counts.like ?? 0)}</b>
      </button>

      <button type="button"
              class="forum-react__btn forum-react__btn--down ${mine === 'dislike' ? 'is-on' : ''}"
              data-forum-react="${esc(key)}:dislike"
              ${can ? '' : 'disabled title="Войдите, чтобы отреагировать"'}>
        <span aria-hidden="true">${dislikeMeta.glyph}</span>
        <b class="num">${Number(counts.dislike ?? 0)}</b>
      </button>

      <div class="forum-emoji">
        <button type="button" class="forum-react__btn forum-react__btn--more ${chosenExtra ? 'is-on' : ''}"
                data-forum-emoji-open="${esc(key)}"
                ${can ? '' : 'disabled title="Войдите, чтобы отреагировать"'}>
          <span aria-hidden="true">${chosenExtra ? chosenExtra.glyph : '🙂'}</span>
          ${extraTotal ? `<b class="num">${extraTotal}</b>` : '<b class="forum-react__plus">+</b>'}
        </button>

        <div class="forum-emoji__pop" data-forum-emoji-pop="${esc(key)}" hidden>
          ${extras
            .map(
              (r) => `<button type="button" class="forum-emoji__item ${mine === r.id ? 'is-on' : ''}"
                              data-forum-react="${esc(key)}:${esc(r.id)}" title="${esc(r.label)}">
                <span aria-hidden="true">${r.glyph}</span>
                ${counts[r.id] ? `<b class="num">${Number(counts[r.id])}</b>` : ''}
              </button>`
            )
            .join('')}
        </div>
      </div>
    </div>`;
}

/* ── Опросы ───────────────────────────────────────────────────────────────── */

/**
 * Голосование в посте. Результаты видны сразу — так задумано: тайное
 * голосование на форуме сообщества создаёт больше проблем, чем решает.
 *
 * Если человек уже голосовал, его вариант подсвечен. Если опрос закрыт,
 * кнопки блокируются. Если несколько вариантов — чекбоксы, иначе радио.
 */
function renderPoll(poll, s) {
  const canVote = s.me && !poll.closed && !s.me.banned;
  const type = poll.multiple ? 'checkbox' : 'radio';
  const name = `poll-${poll.id}`;

  return `
    <div class="forum-poll" data-forum-poll="${esc(poll.id)}">
      <div class="forum-poll__head">
        <span class="forum-poll__question">${esc(poll.question)}</span>
        <span class="forum-poll__total">${poll.total} ${plural(poll.total, 'голос', 'голоса', 'голосов')}</span>
      </div>
      <div class="forum-poll__options">
        ${poll.options.map((o) => {
          const pct = poll.total > 0 ? Math.round((o.votes / poll.total) * 100) : 0;
          return `
          <label class="forum-poll__opt ${o.mine ? 'is-on' : ''}">
            <span class="forum-poll__mark">
              <input type="${type}" name="${esc(name)}" value="${esc(o.id)}"
                     data-forum-poll-opt="${esc(poll.id)}:${esc(o.id)}"
                     ${o.mine ? 'checked' : ''}
                     ${canVote ? '' : 'disabled'}>
              <span class="forum-poll__check"></span>
            </span>
            <span class="forum-poll__text">${esc(o.text)}</span>
            <span class="forum-poll__bar" style="--pct:${pct}%"></span>
            <span class="forum-poll__num">${o.votes} (${pct}%)</span>
          </label>`;
        }).join('')}
      </div>
      ${canVote ? '' : `<p class="forum-poll__hint muted">${poll.closed ? 'Опрос закрыт' : 'Войдите, чтобы проголосовать'}</p>`}
    </div>`;
}

/* ── Комментарии ──────────────────────────────────────────────────────────── */

function renderComments(post, s) {
  const canModerate = s.me && (s.me.role === 'admin' || s.me.role === 'moderator');
  const L = CONFIG.forum.limits;

  const items = s.comments.length
    ? s.comments
        .map((c) => {
          if (c.deleted) {
            return `<li class="forum-comment forum-comment--deleted">
              <p class="muted">Комментарий удалён · ${esc(c.deletedReason || 'нарушение правил')}</p>
            </li>`;
          }
          const isMine = s.me && s.me.id === c.authorId;
          const canQuote = Boolean(s.me && !s.me.banned);
          return `<li class="forum-comment" data-forum-comment="${esc(c.id)}">
            ${avatar(c.authorNick, c.authorAvatar, 'sm')}
            <div class="forum-comment__body">
              <div class="forum-comment__head">
                <b>${nickLink(c.authorNick)}${
                  roleBadge({ role: c.authorRole }, { short: true })
                }</b>
                <time title="${esc(fullTime(c.createdAt))}">${esc(timeAgo(c.createdAt))}</time>
              </div>
              ${postBody(c.body)}
              ${renderShots(c)}
              <div class="forum-comment__foot">
                ${renderReactions('comment', c, s)}
                ${
                  canQuote
                    ? `<button type="button" class="forum-act" data-forum-quote="comment:${esc(c.id)}"
                               title="Вставить текст комментария в ответ">Цитировать</button>`
                    : ''
                }
                ${
                  isMine || canModerate
                    ? `<button type="button" class="forum-act" data-forum-del-comment="${esc(c.id)}">Удалить</button>`
                    : ''
                }
                ${
                  s.me && !isMine
                    ? `<button type="button" class="forum-act" data-forum-report="comment:${esc(c.id)}">Пожаловаться</button>`
                    : ''
                }
              </div>
            </div>
          </li>`;
        })
        .join('')
    : '<li class="forum-comment forum-comment--none muted">Ответов пока нет.</li>';

  return `
    <section class="forum-thread">
      <h3 class="forum-thread__title">
        ${post.commentCount ? esc(plural(post.commentCount, 'ответ', 'ответа', 'ответов')) : 'Ответы'}
      </h3>

      <ul class="forum-thread__list">${items}</ul>

      ${
        s.me && !s.me.banned
          ? `<form class="forum-reply" data-forum-comment-form="${esc(post.id)}">
              <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
                   name="body" data-editor data-limit="${L.commentMax}"
                   data-placeholder="Ответить по делу и по правилам"></div>
              ${renderMdBar()}
              ${renderAttachRow(post.id)}
              <div class="forum-reply__actions">
                <button type="submit" class="forum-btn">Ответить</button>
              </div>
              <p class="forum-error" data-forum-comment-error hidden></p>
            </form>`
          : `<p class="muted forum-reply__locked">${
              s.me ? 'Вам запрещено писать.' : 'Войдите, чтобы ответить.'
            }</p>`
      }
    </section>`;
}

/**
 * Окно жалобы. Отрисовано один раз и спрятано: пункт правил надо выбрать,
 * а список пунктов один и тот же для любой записи.
 */
export function renderReportDialog() {
  return `
    <div class="forum-modal" data-forum-report-modal hidden>
      <div class="forum-modal__box" role="dialog" aria-modal="true" aria-label="Жалоба на запись">
        <h3>На какой пункт жалоба</h3>
        <form data-forum-report-form>
          <div class="forum-modal__rules">
            ${RULES.map(
              (r, i) => `<label class="forum-modal__rule">
                <input type="radio" name="ruleId" value="${esc(r.id)}" ${i === 0 ? 'required' : ''}>
                <span><b>${i + 1}. ${esc(r.title)}</b><small>${esc(r.body)}</small></span>
              </label>`
            ).join('')}
          </div>
          <label class="forum-field">
            <span>Пояснение (необязательно)</span>
            <input type="text" name="note" maxlength="200" placeholder="что именно не так">
          </label>
          <div class="forum-modal__actions">
            <button type="submit" class="forum-btn">Отправить</button>
            <button type="button" class="forum-btn forum-btn--ghost" data-forum-report-cancel>Отмена</button>
          </div>
          <p class="forum-error" data-forum-report-error hidden></p>
        </form>
      </div>
    </div>`;
}

/**
 * Окно удаления с причиной. Модератор обязан назвать пункт: «удалено»
 * без причины ничему не учит и выглядит произволом.
 */
export function renderDeleteDialog() {
  return `
    <div class="forum-modal" data-forum-delete-modal hidden>
      <div class="forum-modal__box" role="dialog" aria-modal="true" aria-label="Удаление записи">
        <h3>Удалить запись</h3>
        <form data-forum-delete-form>
          <p class="muted" data-forum-delete-own hidden>
            Это ваша запись. Она останется на месте с пометкой «удалено автором».
          </p>
          <div class="forum-modal__rules" data-forum-delete-rules>
            ${RULES.map(
              (r, i) => `<label class="forum-modal__rule">
                <input type="radio" name="ruleId" value="${esc(r.id)}">
                <span><b>${i + 1}. ${esc(r.title)}</b></span>
              </label>`
            ).join('')}
          </div>
          <label class="forum-field" data-forum-delete-note>
            <span>Пояснение автору (необязательно)</span>
            <input type="text" name="note" maxlength="200">
          </label>
          <div class="forum-modal__actions">
            <button type="submit" class="forum-btn forum-btn--danger">Удалить</button>
            <button type="button" class="forum-btn forum-btn--ghost" data-forum-delete-cancel>Отмена</button>
          </div>
          <p class="forum-error" data-forum-delete-error hidden></p>
        </form>
      </div>
    </div>`;
}
