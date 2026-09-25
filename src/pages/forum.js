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
import { esc, plural, pluralWord, sparkline } from '../ui/helpers.js';
import { serverEvents, verdictText, pillText, EVENT_TYPE } from '../logic/event-types.js';
import { RULES, SANCTIONS, CATEGORIES, SORTS, REACTIONS, TOPIC_TAGS, categoryLabel, needsExpiry } from '../forum/rules.js';
import { postBody, excerpt, editorHtml, textOf, timeAgo, fullTime, avatarHtml } from '../forum/format.js';
import { roleBadge, roleLabel, verifiedBadge } from '../forum/roles.js';
import { formatRecoveryKey, formatHoldLeft } from '../forum/recovery.js';
import { leaderBadge } from './chats.js';
import { CONFIG } from '../../config.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Ключ еженедельной темы в текстах сайта (вкладка «Тексты» в панели).
 * Держится здесь одним словом — в admin/edit.js этот же ключ предлагается
 * в форме. Расхождение между двумя списками ловит тест.
 */
export const FORUM_THEME_KEY = 'forum-theme';

/**
 * Ключ: какой номер Кварта человек уже видел на этом устройстве.
 * Используется баннером «Новый Кварт начался» и его обработчиком в mount.js —
 * одна строка на оба файла, чтобы не разойтись.
 */
export const QUARTER_SEEN_KEY = 's33-quarter-seen';

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
    tag: 'all',
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
    /** Push-настройки форума: приходит ли уведомление о новом посте и об ответе. */
    pushPrefs: null,
    /** Активность сервера: посты и сообщения по дням за неделю; null — нет данных. */
    activity: null,
    /** Уведомления: открыта ли панель и что в ней. */
    notifyOpen: false,
    notifyList: [],
    notifyUnread: 0,
    /*
      Оспаривание запрета писать и тишины: list — свои заявки человека,
      open — какую меру оспаривают сейчас ('' — форма закрыта), text —
      написанное, error — отказ базы.
    */
    appeal: { list: [], open: '', text: '', error: '' },
    allianceSubscriptions: new Set(),
    ...state,
  };

  /*
    ДВЕ КОЛОНКИ НА ШИРОКОМ ЭКРАНЕ, ОДНА НА ТЕЛЕФОНЕ.

    Раньше всё шло одной лентой сверху вниз: сводка, тема недели, горячее,
    топ игроков, правила — и только потом сама лента. На мониторе до первого
    поста приходилось прокручивать полтора экрана. Теперь контекст (сводка,
    горячее, топ, правила) стоит боковой колонкой справа, а лента начинается
    сразу. На телефоне колонки складываются в прежнем порядке — там боковой
    колонке места нет, а порядок «сначала контекст» проверен.
  */
  return `
    <div class="forum-layout">
      <aside class="forum-side" aria-label="Сводка и правила">
        ${renderChronicleBand(view?.events ?? [])}
        ${renderWeekTheme(view)}
        ${renderQuarterBanner(view)}
        ${renderArticleOfWeek(s)}
        ${renderServerActivity(view, s)}
        ${renderQuarterCountdown(view)}
        ${renderHotTopics(s)}
        ${renderLeaderboard(s)}
        ${renderAllianceSubscriptions(view, s)}
        ${renderRules()}
      </aside>
      <div class="forum-main">
        ${renderWelcome(s)}
        ${renderAccountBar(s)}
        ${renderNotifications(s)}
        ${renderComposer(s)}
        ${renderFeedControls(s)}
        ${renderFeed(s)}
      </div>
    </div>`;
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

  // Четыре свежих: в боковой колонке больше уже требует прокрутки, а полоса
  // должна читаться целиком.
  const recent = all.slice(0, 4);

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
          <i aria-hidden="true"></i>СЕЙЧАС
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

  /*
    Точное число тем база не отдаёт: лента знает лишь «есть ли ещё страница».
    Пока не долистали до конца, честнее сказать «больше N», чем назвать
    число, которое на следующей странице окажется неправдой.
  */
  const shown = s.posts.length;
  const more = Number(s.total) > shown;
  return `
    <section class="panel forum-welcome" data-forum-welcome>
      <span class="forum-welcome__mark" aria-hidden="true">👋</span>
      <div class="forum-welcome__body">
        <b>Добро пожаловать на форум сервера 33</b>
        <p class="muted">
          Здесь уже ${more ? 'больше ' : ''}${esc(plural(shown, 'тема', 'темы', 'тем'))}. Заходите обсудить
          игру, альянсы и всё, что происходит на сервере.
        </p>
      </div>
      <button type="button" class="forum-btn forum-btn--ghost" data-forum-welcome-auth>
        Войти и начать тему
      </button>
    </section>`;
}

/**
 * ЕЖЕНЕДЕЛЬНАЯ ТЕМА — «рубрика недели».
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

/* ── Статья недели ───────────────────────────────────────────────────────── */

/**
 * «Статья недели» — пост с наибольшей активностью за последние 7 дней.
 *
 * Считается из уже загруженной ленты:heat = согласия + ответы. Взятое и
 * удалённое не участвует. Нет ни одного поста с реакцией — блок не показываем,
 * иначе в пустом форуме висела бы карточка-заглушка.
 */
function renderArticleOfWeek(s) {
  if (!s.ready || s.loading) return '';
  const weekAgo = Date.now() - 7 * 86400000;
  const week = (s.posts || []).filter((p) =>
    !p.deleted
    && !p.pinned
    && p.createdAt instanceof Date
    && p.createdAt.getTime() >= weekAgo,
  );
  if (!week.length) return '';
  const heat = (p) => Number(p.score || 0) + Number(p.commentCount || 0) + Number((p.reactions?.like) || 0);
  const best = week.reduce((a, b) => (heat(b) > heat(a) ? b : a), week[0]);
  if (heat(best) <= 0) return '';
  return `
    <section class="panel post-weekly" aria-label="Статья недели">
      <span class="eyebrow">✨ Статья недели</span>
      <h2 class="forum-post__title"><a href="#/forum/${esc(best.id)}">${esc(best.title)}</a></h2>
      <div class="forum-post__by muted">
        ${nickLink(best.authorNick)}
        <time>${esc(timeAgo(best.createdAt))}</time>
      </div>
      <p class="forum-post__excerpt">${esc(excerpt(best.body, 160))}</p>
      <a class="forum-btn forum-btn--ghost forum-btn--sm" href="#/forum/${esc(best.id)}">Читать</a>
    </section>`;
}

/* ── Активность сервера ───────────────────────────────────────────────────── */

const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Мини-дашборд «что происходит на сервере»: посты и сообщения за сегодня,
 * активные альянсы, события за неделю, мини-график за 7 дней.
 *
 * Числа за день берутся из опционального источника forum.getServerActivity(),
 * а статистика сайта — из view (уже загруженного).
 */
function renderServerActivity(view, s) {
  const alliances = Array.isArray(view?.alliances) ? view.alliances : [];
  const events = Array.isArray(view?.events) ? view.events : [];
  const act = Array.isArray(s?.activity) ? s.activity : [];
  const today = act.length ? act[act.length - 1] : null;

  if (!alliances.length && !events.length && !act.length) return '';

  const weekAgo = Date.now() - 7 * 86400000;
  const active = alliances.filter((a) => a?.active).length;
  const thisWeek = events.filter((e) => e?.date instanceof Date && e.date.getTime() >= weekAgo).length;

  /*
    График за 7 дней: суммарная активность (посты + комментарии + сообщения).
    Три точки и менее sparkline не рисует, поэтому для пустой/короткой недели
    просто опускаем блок.
  */
  const totalByDay = act.map((d) => d.forumPosts + d.forumComments + d.chatMessages);
  const sparkColor = 'var(--accent)';
  const chart = totalByDay.some((n) => n > 0) ? sparkline(totalByDay, sparkColor, 180, 28) : '';

  return `
    <section class="panel server-stats" aria-label="Активность сервера">
      <span class="eyebrow">Активность сервера</span>
      <div class="server-stats__grid">
        ${today ? `
        <div class="server-stat">
          <b class="num">${today.forumPosts}</b>
          <span>${esc(plural(today.forumPosts, 'пост', 'поста', 'постов'))} сегодня</span>
        </div>
        <div class="server-stat">
          <b class="num">${today.chatMessages}</b>
          <span>${esc(plural(today.chatMessages, 'сообщение', 'сообщения', 'сообщений'))} в чатах</span>
        </div>` : ''}
        ${alliances.length ? `
        <div class="server-stat"><b class="num">${active}</b><span>${esc(plural(active, 'активный альянс', 'активных альянса', 'активных альянсов'))}</span></div>` : ''}
        ${events.length ? `
        <div class="server-stat"><b class="num">${thisWeek}</b><span>${esc(plural(thisWeek, 'событие', 'события', 'событий'))} за неделю</span></div>
        <div class="server-stat"><b class="num">${events.length}</b><span>${esc(plural(events.length, 'запись', 'записи', 'записей'))} в летописи</span></div>` : ''}
      </div>
      ${chart ? `
      <div class="server-stats__chart">
        ${chart}
        <div class="server-stats__labels">
          ${act.map((d) => `<span>${DAY_SHORT[d.day.getDay()]}</span>`).join('')}
        </div>
      </div>` : ''}
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

/* ── Кварт: таймер до конца периода ───────────────────────────────────────── */

/**
 * Сколько осталось до конца Кварта — в боковой колонке форума.
 *
 * Дата конца берётся из тех же данных, что и страница Кварта: последняя
 * неделя окна. Пока период начат и есть конец — показываем счётчик
 * короткой строкой, с ссылкой на страницу Кварта. Число живёт само:
 * интервалом управляет ui/quarter-timer.js по атрибуту data-quarter-end.
 */
function renderQuarterCountdown(view) {
  const endDate = view?.quarter?.endDate instanceof Date ? view.quarter.endDate : null;
  if (!endDate || Number.isNaN(endDate.getTime())) return '';
  const left = Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000));
  return `
    <section class="panel quart-next" aria-label="До конца Кварта">
      <span class="eyebrow">Кварт</span>
      <div class="quart-timer" data-quarter-end="${endDate.getTime()}">
        <span>До конца Кварта</span>
        <b class="num quart-countdown-num">${left}</b>
      </div>
      <a class="quart-next__more" href="#/quarter">Кто лидирует? <b>→</b></a>
    </section>`;
}

/**
 * Баннер «Новый Кварт начался».
 *
 * Рисуется, только если номер Кварта вырос с прошлого захода: запоминаем
 * последний увиденный номер в localStorage. Скрытие — той же кнопкой,
 * обработчик в mount.js сохраняет номер и перерисовывает страницу.
 */
function renderQuarterBanner(view) {
  const number = Number(view?.quarter?.number ?? 0);
  if (number < 1) return '';
  let seen = 0;
  try {
    seen = Number(localStorage.getItem(QUARTER_SEEN_KEY) ?? 0);
  } catch { /* localStorage может быть недоступен — тогда баннер не показываем. */ }
  if (number <= seen) return '';
  return `
    <section class="panel quart-banner" data-quart-banner="${number}" role="status">
      <span class="eyebrow">🎉 Новый Кварт</span>
      <b class="quart-banner__title">Кварт ${number} начался</b>
      <p class="muted">Новые четыре недели — и новый шанс для каждого альянса подняться.</p>
      <div class="quart-banner__acts">
        <a class="forum-btn forum-btn--sm" href="#/quarter">Открыть Кварт</a>
        <button type="button" class="forum-btn forum-btn--ghost forum-btn--sm"
                data-quart-banner-dismiss>Понятно</button>
      </div>
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
              ${avatarHtml(l.nick, l.avatar)}
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

/* ── Уведомления ──────────────────────────────────────────────────────────── */

/*
  Вид уведомления: подпись, значок и цвет. Подпись читается как продолжение
  ника («@Ник — ответил на вашу запись»), а значок и цвет работают там, где
  подпись не читают: в списке из десяти строк и на телефоне.

  «Рейтинг», «Модерация» и «Дайджест недели» пишет база, а не человек. Автора
  у них нет, поэтому идут своим заголовком и без «@» — в базе на этом месте
  лежат служебные слова, и показать их как ник было бы неправдой.
*/
const NOTIFY_KINDS = {
  reply: { label: 'ответил на вашу запись', icon: 'reply', tone: 'var(--link)' },
  mention: { label: 'упомянул вас', icon: 'mention', tone: 'var(--gold)' },
  reaction: { label: 'оценил вашу запись', icon: 'reaction', tone: 'var(--win)' },
  subscription: { label: 'написал в подписанной теме', icon: 'subscription', tone: 'var(--link)' },
  alliance_rank: { system: 'Рейтинг', label: 'место альянса изменилось', icon: 'rank', tone: 'var(--gold)', href: '#/ladder' },
  moderation: { system: 'Модерация', label: 'новый сигнал', icon: 'flag', tone: 'var(--loss)', href: '#/forum' },
  digest: { system: 'Дайджест недели', icon: 'digest', tone: 'var(--accent)', href: '#/home' },
};

/* Значки в той же графике, что колокольчик: 24×24, штрих currentColor. */
const NOTIFY_ICONS = {
  reply: '<path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/>',
  mention: '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  reaction: '<path d="M7 21V10"/><path d="M7 10l4.5-7a2.2 2.2 0 0 1 3.2 2.7L13.2 9H19a2 2 0 0 1 2 2.4l-1.5 7.8A2 2 0 0 1 17.5 21z"/>',
  subscription: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  rank: '<path d="M4 20v-9"/><path d="M10 20V4"/><path d="M16 20v-6"/><path d="M2 20h20"/>',
  flag: '<path d="M5 21V4"/><path d="M5 5h11l-1.7 3.5L16 12H5z"/>',
  digest: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 16h5"/>',
};

function notifyGlyph(kind) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NOTIFY_ICONS[kind] || ''}</svg>`;
}

/**
 * Заголовок группы уведомлений: «Сегодня», «Вчера», дальше — та же
 * короткая дата, что в ленте (см. timeAgo), чтобы не плодить форматы.
 */
function notifyDayTitle(date, now = new Date()) {
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(date)) / 86400000);
  if (diff <= 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return timeAgo(date, now);
}

/**
 * Одна строка списка. Ведёт на пост, а если поста нет (служебные виды) —
 * на ту страницу, где событие и видно: ссылку на пустой адрес давать
 * нельзя, она привела бы в никуда.
 */
function notifyRow(n, isNew) {
  const kind = NOTIFY_KINDS[n.kind] || NOTIFY_KINDS.reply;
  /*
    preview приходит из базы куском исходного текста, а текст участник
    форматирует в редакторе — то есть с разметкой. Без excerpt панель
    показывала бы «Сосал?<p><br></p>» вместо «Сосал?».
  */
  const preview = excerpt(n.preview, 140);
  const href = n.postId ? `#/forum/${encodeURIComponent(n.postId)}` : kind.href || '#/forum';
  /*
    Метку «буква ника» рисуем только там, где ник действительно есть. Иначе
    удалённый аккаунт получал бы квадрат с вопросительным знаком — а это
    выглядит как живой участник, которого просто не удалось показать.
  */
  const person = !kind.system && n.actorNick;
  const who = kind.system
    ? `<b class="forum-notify__title">${esc(kind.system)}</b>`
    : person
      ? `<b class="forum-notify__title">@${esc(n.actorNick)}</b><span class="forum-notify__what">${esc(kind.label)}</span>`
      : `<b class="forum-notify__title forum-notify__title--gone">аккаунт удалён</b><span class="forum-notify__what">${esc(kind.label)}</span>`;

  return `
    <li class="forum-notify__item${isNew ? ' is-new' : ''}" style="--tone:${kind.tone}">
      <a class="forum-notify__link" href="${esc(href)}">
        <span class="forum-notify__mark">
          ${
            person
              /* Значок вида — надставкой на аватарке: метка уже занята ником.
                 Служебному виду меткой служит сам значок, второй такой же
                 поверх него превращал строку в повторяющийся рисунок. */
              ? `${avatarHtml(n.actorNick, '', { size: 'sm' })}
                 <span class="forum-notify__glyph">${notifyGlyph(kind.icon)}</span>`
              : `<span class="forum-notify__system">${notifyGlyph(kind.icon)}</span>`
          }
        </span>
        <span class="forum-notify__body">
          <span class="forum-notify__line">${who}</span>
          ${preview ? `<span class="forum-notify__preview">${esc(preview)}</span>` : ''}
          <span class="forum-notify__meta">
            <time title="${esc(fullTime(n.createdAt))}">${esc(timeAgo(n.createdAt))}</time>
            <span class="forum-notify__go">Открыть</span>
          </span>
        </span>
        ${isNew ? '<span class="forum-notify__dot" aria-hidden="true"></span>' : ''}
      </a>
    </li>`;
}

/**
 * Панель уведомлений. Сворачивает и разворачивает колокольчик рядом
 * с профилем: панель не модальное окно (его легче не заметить за экраном
 * на телефоне), а лист под учётной строкой.
 *
 * Отметка «прочитано» ставится сама при открытии, поэтому «новые» здесь —
 * не состояние базы, а то, что человек ещё не видел: набор id панель
 * получает от состояния сессии (notifyFresh) и теряет при закрытии.
 */
function renderNotifications(s) {
  if (!s.me || !s.notifyOpen) return '';

  const list = s.notifyList;
  const fresh = s.notifyFresh || new Set();
  const freshCount = list.filter((n) => fresh.has(n.id)).length;

  const head = `
    <div class="forum-notify__head">
      <span class="eyebrow">Уведомления</span>
      <span class="forum-notify__count${freshCount ? ' is-new' : ''}">${
        freshCount
          ? esc(plural(freshCount, 'новое уведомление', 'новых уведомления', 'новых уведомлений'))
          : 'Прочитаны все'
      }</span>
      <button type="button" class="forum-btn forum-btn--ghost forum-btn--sm"
              data-forum-notify-open aria-expanded="true">Свернуть</button>
    </div>`;

  if (!list.length) {
    return `
      <section class="panel forum-notify" data-forum-notify-panel>
        ${head}
        <div class="forum-notify__empty">
          <span class="forum-notify__empty-icon">${notifyGlyph('subscription')}</span>
          <p>Пока пусто: сюда приходят ответы, упоминания и оценки ваших записей.</p>
        </div>
      </section>`;
  }

  const groups = [];
  for (const n of list) {
    const title = notifyDayTitle(n.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(n);
    else groups.push({ title, items: [n] });
  }

  return `
    <section class="panel forum-notify" data-forum-notify-panel>
      ${head}
      <div class="forum-notify__scroll">
        ${groups.map((g) => `
          <div class="forum-notify__group">
            <span class="forum-notify__day">${esc(g.title)}</span>
            <ul class="forum-notify__list">
              ${g.items.map((n) => notifyRow(n, fresh.has(n.id))).join('')}
            </ul>
          </div>`).join('')}
      </div>
    </section>`;
}

/**
 * Меры, которые не дают писать, и право с ними не согласиться.
 *
 * Раньше это были две строки-баннера: человек узнавал о запрете и оставался
 * с ним один на один. Дверь к модерации обязана быть здесь, а не ссылкой в
 * правилах: тот, кому не дали писать, не напишет и о том, что ему не дали
 * писать.
 *
 * Слово «оспорить» ничего не обещает и ничего не отменяет: тишина идёт своим
 * чередом, бан на время разбора остаётся. Ответ обязателен — это держит база
 * (supabase/20260925-sanction-appeal.sql), а не этот файл.
 */
export function renderSanctions(s) {
  const me = s.me;
  if (!me) return '';

  const muted = me.mutedUntil && new Date(me.mutedUntil) > new Date();
  const rows = [];
  if (me.banned) {
    rows.push(sanctionRow(s, 'ban', `Вам запрещено писать. Причина: ${esc(me.banReason || 'нарушение правил')}`));
  }
  if (muted) {
    rows.push(sanctionRow(s, 'mute', `Писать можно снова с ${esc(fullTime(me.mutedUntil))}`));
  }
  return rows.join('');
}

/** Как мера называется в кнопке: «оспорить» повисает на пустом месте без того, что оспаривают. */
const SANCTION_LABEL = { ban: 'запрет писем', mute: 'тишину' };

function sanctionRow(s, kind, notice) {
  const a = s.appeal ?? {};
  const appeal = latestAppeal(a.list, kind);
  const opening = a.open === kind;
  // Открытая заявка перекрыта ответом, а ответ перекрыт выдержкой: кнопка
  // возвращается ровно тогда, когда база снова примет заявку.
  const canOpen = !appeal || (appeal.status !== 'open' && appealCooldownLeft(appeal) <= 0);

  return `
    <div class="forum-blocked" data-forum-sanction="${kind}">
      <p class="forum-blocked__line">${notice}</p>
      ${sanctionState(appeal)}
      ${canOpen && !opening
        ? `<button type="button" class="forum-btn forum-btn--ghost forum-appeal__open"
                 data-forum-appeal="${kind}">Оспорить: ${esc(SANCTION_LABEL[kind])}</button>`
        : ''}
      ${opening ? sanctionForm(kind, a.error, a.text) : ''}
    </div>`;
}

/**
 * Что игрок видит про свою заявку.
 *
 * Строку для удовлетворённой заявки оставляем, хотя мера с ней обычно
 * исчезает: бан могут выдать снова, и тогда человек увидит не молча
 * пропавшую кнопку, а ответ на вопрос «почему опять нельзя».
 */
function sanctionState(appeal) {
  if (!appeal) return '';

  if (appeal.status === 'open') {
    return `<p class="forum-appeal__state">Вы оспорили решение ${esc(shortDate(appeal.createdAt))} — модератор ещё не ответил.</p>`;
  }

  const left = appealCooldownLeft(appeal);
  const wait = left > 0
    ? `<small class="muted">По этому вопросу уже ответили: новую апелляцию можно открыть через ${plural(left, 'день', 'дня', 'дней')}.</small>`
    : '';

  if (appeal.status === 'upheld') {
    return `<p class="forum-appeal__state">Апелляцию удовлетворили${appeal.decidedByNick ? ` — ${esc(appeal.decidedByNick)}` : ''} ${esc(shortDate(appeal.decidedAt))}.</p>${wait}`;
  }

  return `
    <p class="forum-appeal__state forum-appeal__state--rejected">
      Апелляция отклонена${appeal.decidedByNick ? `, ответил ${esc(appeal.decidedByNick)}` : ''}:
      «${esc(appeal.answer)}»
    </p>
    ${wait}`;
}

function sanctionForm(kind, error, text = '') {
  const L = CONFIG.forum.limits;
  return `
    <form class="forum-appeal" data-forum-appeal-form="${kind}">
      <label class="forum-field">
        <span>Что не так с решением</span>
        <textarea name="message" rows="3" required
                  minlength="${L.appealMessageMin}" maxlength="${L.appealMessageMax}"
                  placeholder="что произошло и чего вы ждёте от модерации">${esc(text)}</textarea>
        <small class="muted">От ${L.appealMessageMin} до ${L.appealMessageMax} символов. Заявку читают только модерация и вы.</small>
      </label>
      <div class="forum-appeal__acts">
        <button type="submit" class="forum-btn" data-forum-appeal-send>Отправить модерации</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-appeal-cancel>Отмена</button>
      </div>
      ${error ? `<p class="forum-error">${esc(error)}</p>` : ''}
    </form>`;
}

/** Последняя заявка этого человека по этой мере — их может быть несколько за жизнь аккаунта. */
function latestAppeal(list, kind) {
  return (Array.isArray(list) ? list : [])
    .filter((a) => a && a.kind === kind)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null;
}

/** Сколько дней осталось до права открыть новую заявку по той же мере. */
function appealCooldownLeft(appeal) {
  // Выдержка считается по любому решению, а не только по отказу: так же
  // считает и база (status <> 'open'), иначе страница разрешала бы то, что
  // потом отвергнет запрос.
  if (!appeal || appeal.status === 'open' || !appeal.decidedAt) return 0;
  const days = CONFIG.forum.limits.appealCooldownDays;
  const left = new Date(appeal.decidedAt).getTime() + days * 86400000 - Date.now();
  return left > 0 ? Math.ceil(left / 86400000) : 0;
}

/**
 * Тишина этого игрока в разделе; null — раздел открыт.
 *
 * Страница берёт те же строки, по которым отказывает база
 * (supabase/20260925-section-mute.sql), и по той же причине: форма, которая
 * молчит о закрытом разделе, разрешает то, что через минуту отвергнет запрос.
 */
export function sectionMuteOf(s, category) {
  const now = Date.now();
  return (Array.isArray(s.sectionMutes) ? s.sectionMutes : [])
    .find((m) => m && m.category === category && new Date(m.mutedUntil) > now) ?? null;
}

/**
 * «Здесь нельзя» вместо «нигде нельзя».
 *
 * Меры выше отнимают слово на всём форуме, эта закрывает один раздел, и
 * поэтому она не рядом с баннером бана, а списком: человеку важно, что
 * остальное открыто, иначе тишина в разделе читается как полная блокировка.
 */
export function renderSectionMutes(s) {
  const now = Date.now();
  const live = (Array.isArray(s.sectionMutes) ? s.sectionMutes : [])
    .filter((m) => m && new Date(m.mutedUntil) > now)
    .sort((a, b) => new Date(a.mutedUntil) - new Date(b.mutedUntil));
  if (!live.length) return '';

  return `
    <div class="forum-blocked forum-blocked--section" data-forum-section-mutes>
      ${live.map((m) => `
        <p class="forum-blocked__line">Раздел «${esc(categoryLabel(m.category))}» закрыт для вас до ${esc(shortDate(m.mutedUntil))}: ${esc(m.reason)}</p>`).join('')}
      <p class="forum-blocked__line muted">Остальной форум открыт; снимает модерация.</p>
    </div>`;
}

function renderWhoAmI(s) {
  if (s.me) {
    return `
      <div class="forum-me">
        ${avatarHtml(s.me.nick, s.me.avatarUrl)}
        <span class="forum-me__body">
          <b>${nickLink(s.me.nick)}</b>
          <small>${roleBadge(s.me) || esc(roleLabel(s.me))}${s.me.isLeader ? leaderBadge() : ''}</small>
        </span>
        <a class="forum-btn forum-btn--ghost forum-chats-link" href="#/chats">Чаты</a>
        <button type="button" class="forum-btn forum-btn--ghost forum-bell"
                data-forum-notify-open aria-label="Уведомления"
                ${s.notifyOpen ? 'aria-expanded="true"' : 'aria-expanded="false"'}>
<svg class="forum-bell__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          <span class="forum-bell__label">Уведомления</span>
          ${
            s.notifyUnread > 0
              ? `<span class="forum-bell__badge" data-forum-notify-badge>${s.notifyUnread}</span>`
              : ''
          }
        </button>
        <a class="forum-btn forum-btn--ghost" href="#/user/${encodeURIComponent(s.me.nick)}">Профиль</a>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-signout>Выйти</button>
      </div>
      ${renderSanctions(s)}
      ${renderSectionMutes(s)}
${renderPushPrefs(s)}`;
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
        Забыли пароль? Восстановите доступ сами — ниже. Письма «забыли пароль»
        нет, потому что нет почты, но и просить кого-то менять пароль больше
        не нужно.
      </p>
      <p class="forum-error" data-forum-auth-error hidden></p>
    </form>
    ${renderRecovery(s)}`;
}

/**
 * САМОВОССТАНОВЛЕНИЕ ДОСТУПА.
 *
 * Три шага на одном экране, и все они — про одно: пароль придумывает человек,
 * а не тот, кто его впускает.
 *
 *   1. Ник. Браузер придумывает ключ и показывает его только здесь.
 *   2. Ожидание. Через 12 часов заявка откроется сама. Владелец видит её в
 *      панели ровно это время и может отклонить — его слово по-прежнему
 *      решает исход, просто теперь оно нужно, чтобы НЕ пустить.
 *   3. Новый пароль. Вводится дважды и уходит прямо в базу.
 *
 * Шаг 2 может растянуться на часы, поэтому состояние живёт в state.recovery, а
 * ключ — в localStorage: страница за это время успеет перерисоваться не раз.
 *
 * Ключ показывается один раз и открыто. Это не оплошность, а единственный
 * способ не зависеть от одного устройства: человек мог зайти с телефона, а
 * продолжить с компьютера, и записанный ключ — то, что приносит его обратно.
 */
function renderRecovery(s) {
  const r = s.recovery;
  if (!r || !r.available) return '';

  if (!r.open) {
    return `
      <p class="forum-recovery__entry">
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="open">
          Забыли пароль?
        </button>
      </p>`;
  }

  const L = CONFIG.forum.limits;
  const error = r.error ? `<p class="forum-error">${esc(r.error)}</p>` : '';

  if (r.phase === 'done') {
    return `
      <div class="forum-recovery">
        <p class="forum-recovery__ok"><b>Готово.</b> Входите с тем паролем, который
        только что придумали — прежний больше не работает.</p>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="close">Свернуть</button>
      </div>`;
  }

  const steps = `
    <ol class="forum-recovery__steps">
      <li${r.phase === 'begin' ? ' class="is-now"' : ' class="is-done"'}>Заявка</li>
      <li${r.phase === 'begin' ? '' : r.phase === 'wait' ? ' class="is-now"' : ' class="is-done"'}>Ожидание ${L.recoveryHoldHours} ч</li>
      <li${r.phase === 'set' ? ' class="is-now"' : ''}>Ваш новый пароль</li>
    </ol>`;

  if (r.phase === 'begin') {
    return `
      <div class="forum-recovery">
        ${steps}
        <p class="muted">Назовите ник — браузер придумает ключ. Им вы докажете,
        что аккаунт ваш, когда придёте ставить пароль.</p>
        <form data-forum-recovery-begin>
          <label class="forum-field">
            <span>Ник</span>
            <input type="text" name="nick" value="${esc(r.nick)}" required
                   autocomplete="username" spellcheck="false"
                   minlength="${L.nickMin}" maxlength="${L.nickMax}"
                   placeholder="как в игре">
          </label>
          <div class="forum-recovery__actions">
            <button type="submit" class="forum-btn" data-forum-recovery-submit>Создать заявку</button>
            <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="close">Отмена</button>
          </div>
        </form>
        ${error}
      </div>`;
  }

  const HOLD = L.recoveryHoldHours;
  const left = formatHoldLeft(r.readyAt);

  const STATUS = {
    approved: ['Владелец впустил досрочно', 'Придумайте новый пароль. Старый перестанет работать сразу.'],
    rejected: ['Владелец отклонил заявку', 'Если это ошибка — поговорите с ним в игре и создайте заявку заново.'],
    expired: ['Срок заявки вышел', 'Заявка живёт неделю. Создайте новую.'],
    none: ['Заявка не найдена', 'Проверьте ник: ключ привязан к тому нику, который вы указали.'],
  };
  let [statusLine, statusHint] = STATUS[r.status] || STATUS.none;

  /*
    pending — единственный статус, у которого два лица, и различает их срок:
    «ждать» и «уже можно» написаны в таблице одинаково. Поэтому canSet читается
    из ответа базы, а local time сюда не лезет: страница не вправе решать за
    базу, кому ставить пароль.
  */
  if (r.status === 'pending') {
    if (r.canSet) {
      statusLine = 'Время вышло — ставьте пароль';
      statusHint = `С момента заявки прошло ${HOLD} ч, и возражений не было. Вход ваш: придумайте пароль, его не узнает никто, даже владелец.`;
    } else {
      statusLine = left ? `Откроется сама через ${left}` : 'Заявка ждёт свой срок';
      statusHint = `Через ${HOLD} ч после создания она откроется сама, без чьего-либо подтверждения. За это время владелец может её отклонить — тогда не откроется никогда.`;
    }
  }

  return `
    <div class="forum-recovery">
      ${steps}
      <p class="forum-recovery__nick">Заявка для <b>${esc(r.nick)}</b> — <span class="forum-recovery__status" data-forum-recovery-status>${esc(statusLine)}</span></p>
      <p class="muted">${esc(statusHint)}</p>

      <p class="forum-recovery__keylabel">Ваш ключ. Сохраните его: с другого устройства
      продолжение ищется именно по нему.</p>
      <div class="forum-recovery__keyrow">
        <code class="forum-recovery__key" data-forum-recovery-key>${esc(formatRecoveryKey(r.key))}</code>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="copy">Скопировать</button>
      </div>

      ${
        r.phase === 'set'
          ? `
      <form data-forum-recovery-finish>
        <label class="forum-field">
          <span>Новый пароль</span>
          <input type="password" name="password" required autocomplete="new-password"
                 minlength="${L.passwordMin}" placeholder="от ${L.passwordMin} символов">
        </label>
        <label class="forum-field">
          <span>Повторите</span>
          <input type="password" name="password2" required autocomplete="new-password"
                 minlength="${L.passwordMin}">
        </label>
        <div class="forum-recovery__actions">
          <button type="submit" class="forum-btn" data-forum-recovery-submit>Поставить пароль</button>
          <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="close">Позже</button>
        </div>
      </form>`
          : `
      <div class="forum-recovery__actions">
        <button type="button" class="forum-btn" data-forum-recovery="check">Проверить</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="again">Начать заново</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-forum-recovery="close">Свернуть</button>
      </div>`
      }
      ${error}
    </div>`;
}

/**
 * Push-настройки форума под учётной строкой.
 *
 * Два тумблера: уведомлять ли о новых постах и об ответах на ваши записи.
 * Состояние хранится в базе (forum_push_prefs) и подгружается адаптером.
 * Показываются, только когда человек вошёл и настройки уже прочитались —
 * иначе пустые тумблеры путали бы, какое значение действительно сохранено.
 */
function renderPushPrefs(s) {
  if (!s.me || !s.pushPrefs) return '';
  const toggle = (key, label) => `
    <label class="forum-push__row">
      <input type="checkbox" data-forum-push-pref="${key}"
             ${s.pushPrefs[key] ? 'checked' : ''}>
      <span>${esc(label)}</span>
    </label>`;
  return `
    <div class="forum-push">
      <span class="forum-push__head">
        <b>Push-уведомления</b>
        <small class="muted">Когда форум закрыт</small>
      </span>
      <div class="forum-push__grid">
        ${toggle('newForumPost', 'Новые посты')}
        ${toggle('newForumReply', 'Ответы на мои посты')}
      </div>
      <p class="forum-push__hint muted">Включите и разрешите уведомления — в чатах есть отдельная кнопка включения</p>
    </div>`;
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

export function renderMdBar() {
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

/** Дата коротко: «12 окт». Тот же формат, что у дат в хронике сверху. */
function shortDate(when) {
  const d = new Date(when);
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

/** Варианты срока из config'а — те же числа держит триггер базы. */
function expiryChoices() {
  return (CONFIG.forum.limits.expiryChoices || []).map(Number).filter((d) => d > 0);
}

/**
 * ПОЛЕ СРОКА В ФОРМЕ.
 *
 * Срок можно назначить любой теме, а не только набору: «разбор актуален до
 * патча» стареет по тем же часам. Пустое значение — «бессрочно», и база
 * прощает его всем меткам, кроме «Набор» и «Срочно»: там откажет триггер, а
 * форма заранее подставит срок при выборе метки (см. mount.js) — иначе
 * человек узнавал бы о требовании уже после того, как написал текст.
 *
 * Списком вариантов правим мы, а решают часы базы: предложение, которое она
 * отвергла бы («+200 дней»), в поле висеть не должно.
 */
function renderExpiryField() {
  const days = expiryChoices();
  const defaults = CONFIG.forum.limits.expiryDefaultDays || {};
  if (!days.length) return '';
  const now = Date.now();
  /*
    Метка «нужен» стоит у тех вариантов, которые база примет при метке «Набор»
    или «Срочно»: автоподстановка подставляет ровно такой вариант, и человеку
    видно, что выбор честный, а не случайный.
  */
  const required = [...new Set(Object.values(defaults).map(Number))]
    .filter((d) => days.includes(d));
  return `
    <label class="forum-field">
      <span>Актуально до</span>
      <select name="expires_in" data-forum-expiry>
        <option value="">Бессрочно</option>
        ${days
          .map(
            (d) => `<option value="${d}">${d} ${pluralWord(d, 'день', 'дня', 'дней')} — до ${esc(shortDate(now + d * 86400000))}${required.includes(d) ? ' (нужен для набора и срочных тем)' : ''}</option>`
          )
          .join('')}
      </select>
      <small class="muted" data-forum-expiry-hint>Теме с меткой «Набор» или «Срочно» срок нужен обязательно:
        он подставится сам, но его можно выбрать другой.</small>
    </label>`;
}

/**
 * Значок срока в шапке карточки.
 *
 * Истёкшую тему не прячем: под ней обсуждение, и вместе с объявлением
 * пропали бы ответы людей (рассуждение — в шапке
 * supabase/20260925-announcement-expiry.sql). Тема остаётся на месте и честно
 * говорит, что призыв уже не действует.
 */
function expiryBadge(p) {
  if (!p.expiresAt) return '';
  const at = new Date(p.expiresAt);
  return at.getTime() <= Date.now()
    ? '<span class="forum-post__expiry forum-post__expiry--over" title="Объявление устарело — срок действия вышел">Срок вышел</span>'
    : `<span class="forum-post__expiry" title="Тема считается актуальной до ${esc(shortDate(at))}">до ${esc(shortDate(at))}</span>`;
}

/**
 * Продление срока: кнопки автора и модерации.
 *
 * Отсчёт идёт от сегодняшнего дня, а не от прежней даты: продление темы,
 * проспавшей месяц, дало бы пару дней вместо месяца. То же правило записано
 * в триггере базы, и её отказ страница показывает как есть.
 */
function expiryControl(p, s) {
  const days = expiryChoices();
  if (!s.me || !days.length) return '';
  if (s.me.id !== p.authorId && s.me.role !== 'admin' && s.me.role !== 'moderator') return '';

  const dead = Boolean(p.expiresAt) && new Date(p.expiresAt).getTime() <= Date.now();
  const state = !p.expiresAt
    ? needsExpiry(p.tags)
      ? 'Срок действия обязателен для этой метки'
      : 'Срок действия не назначен'
    : dead
      ? `Срок вышел ${esc(shortDate(p.expiresAt))}`
      : `Актуально до ${esc(shortDate(p.expiresAt))}`;

  return `
    <div class="forum-expiry">
      <span class="forum-expiry__state${dead || !p.expiresAt ? ' forum-expiry__state--over' : ''}">${state}</span>
      <span class="forum-expiry__btns">
        ${days
          .map(
            (d) => `<button type="button" class="forum-act" data-forum-extend="${esc(p.id)}:${d}"
                       title="Отсчёт от сегодняшнего дня">+${d} ${pluralWord(d, 'день', 'дня', 'дней')}</button>`
          )
          .join('')}
        ${p.expiresAt && !needsExpiry(p.tags) ? `<button type="button" class="forum-act" data-forum-extend="${esc(p.id)}:0">Бессрочно</button>` : ''}
      </span>
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
            ${CATEGORIES.map((c) => {
              // Закрытый раздел не прячем: игрок видит его список и пометку
              // рядом, а не гадает, почему пропала привычная строка.
              const mute = sectionMuteOf(s, c.id);
              return `<option value="${esc(c.id)}">${esc(c.label)} — ${esc(c.hint)}${mute ? ' · вам здесь нельзя' : ''}</option>`;
            }).join('')}
          </select>
        </label>

        <fieldset class="forum-topic-tags">
          <legend>Теги темы <small>до трёх</small></legend>
          ${TOPIC_TAGS.map((tag) => `<label><input type="checkbox" name="tags" value="${esc(tag.id)}"><span>${esc(tag.label)}</span></label>`).join('')}
        </fieldset>

        ${renderExpiryField()}

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
          ${
            /*
              Те же числа, что держат триггеры базы: отказ приходит текстом
              ошибки, и игроку спокойнее, когда срок назван заранее.
            */
            L.postHoldMax
              ? ` Не больше ${L.postHoldMax} ${
                  pluralWord(L.postHoldMax, 'темы', 'тем', 'тем')
                } за ${L.postHoldMinutes} ${
                  pluralWord(L.postHoldMinutes, 'минуту', 'минуты', 'минут')
                } и ${L.commentHoldMax} ${
                  pluralWord(L.commentHoldMax, 'ответ', 'ответа', 'ответов')
                } за ${L.commentHoldMinutes} ${
                  pluralWord(L.commentHoldMinutes, 'минуту', 'минуты', 'минут')
                }. Повтор того же текста база не пропустит.`
              : ''
          }
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
      <div class="forum-tag-filter" aria-label="Теги">
        <button type="button" class="forum-tag${s.tag === 'all' ? ' is-on' : ''}" data-forum-tag="all">Все теги</button>
        ${TOPIC_TAGS.map((tag) => `<button type="button" class="forum-tag${s.tag === tag.id ? ' is-on' : ''}" data-forum-tag="${esc(tag.id)}">#${esc(tag.label)}</button>`).join('')}
      </div>
    </div>`;
}

/**
 * Аватарка участника — единая avatarHtml из format.js (когда-то здесь была
 * своя копия, и три страницы разъехались в деталях).
 *
 * Ник — ссылка на профиль. Так устроены все форумы, и человек это пробует
 * первым делом: нажать на имя, чтобы узнать, кто пишет.
 */

/** Ссылка на страницу участника. */
function nickLink(nick) {
  return `<a class="forum-nick" href="#/user/${encodeURIComponent(nick)}">${esc(nick)}</a>`;
}

function allianceCard(tag, alliances = []) {
  const alliance = alliances.find((item) => item.tag?.toUpperCase() === String(tag).toUpperCase());
  if (!alliance) return `<span class="forum-post__ally">${esc(tag)}</span>`;
  return `<a class="forum-alliance-card" href="#/alliance/${esc(encodeURIComponent(alliance.id))}" title="Открыть карточку альянса">
    <i style="--ally-color:${esc(alliance.color || '#8a93a2')}"></i><b>${esc(alliance.tag)}</b><small>${esc(alliance.name)}</small>
  </a>`;
}

function renderAllianceSubscriptions(view, s) {
  const alliances = (view?.alliances || []).filter((item) => item.active).slice(0, 12);
  if (!alliances.length) return '';
  const subscribed = s.allianceSubscriptions instanceof Set ? s.allianceSubscriptions : new Set(s.allianceSubscriptions || []);
  return `<section class="panel forum-alliance-subs" aria-label="Подписки на альянсы">
    <header><b>Рейтинг альянсов</b><small>Сообщим, когда изменится место</small></header>
    <div>${alliances.map((a) => `<button type="button" class="forum-alliance-sub${subscribed.has(a.id) ? ' is-on' : ''}"
      data-forum-alliance-subscribe="${esc(a.id)}" data-forum-alliance-subscribed="${subscribed.has(a.id) ? '1' : ''}">
      <i style="--ally-color:${esc(a.color || '#8a93a2')}"></i>${esc(a.tag)} <span>${subscribed.has(a.id) ? 'Подписан' : 'Подписаться'}</span></button>`).join('')}</div>
  </section>`;
}

/**
 * Прикреплённые картинки.
 *
 * Одна — во всю ширину, несколько — по две в ряд. Скриншот интерфейса игры
 * при трёх в ряд на телефоне становится нечитаемым, и открывать его придётся
 * всё равно.
 *
 * Больше двенадцати не бывает: предел держит база (см. supabase/profiles.sql)
 * и тот же предел стоит в config.js (CONFIG.forum.limits.attachmentsMax).
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

  if (!s.posts.some((p) => !p.deleted)) {
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
 * Удалённый пост исчезает с форума целиком: причины не нужны читателям,
 * она живёт в базе для модерации.
 */
export function renderPostCard(p, s) {
  if (p.deleted) return '';

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
  /*
    Сколько чужих ответов появилось после последнего входа сюда. Решает
    лента, а не карточка: адаптер присылает поле только вошедшему, поэтому
    гость видит обычную карточку без всякой проверки здесь.
  */
  const unread = Number(p.unread || 0);

  return `
    <article class="panel forum-post ${p.pinned ? 'forum-post--pinned' : ''}${inTrail ? ' forum-post--trail' : ''}${unread > 0 ? ' forum-post--unread' : ''}" data-forum-post="${esc(p.id)}">
      <header class="forum-post__head">
        ${avatarHtml(p.authorNick, p.authorAvatar)}
        <div class="forum-post__by">
          <b>${nickLink(p.authorNick)}${
            p.authorIsBlogger
              ? `<a class="role-badge role-badge--blogger" href="#/user/${esc(encodeURIComponent(p.authorNick))}"
                   title="Ведёт блог — загляните" role="img" aria-label="Блогер">✍️<b>блогер</b></a>`
              : ''
          }${
            roleBadge({ role: p.authorRole }, { short: true })
          }${
            verifiedBadge(p.authorIsVerified)
          }${
            p.authorAlliance ? ` ${allianceCard(p.authorAlliance, s.alliances)}` : ''
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
        ${
          unread > 0
            ? `<span class="forum-post__new" title="Новых ответов с вашего последнего входа">${
                `${unread} ${pluralWord(unread, 'новый ответ', 'новых ответа', 'новых ответов')}`
              }</span>`
            : ''
        }
        ${expiryBadge(p)}
      </header>

      ${
        editing
          ? renderEditForm(p)
          : `
      <h2 class="forum-post__title">
        ${isOpen ? esc(p.title) : `<a href="#/forum/${esc(p.id)}">${esc(p.title)}</a>`}
      </h2>

      ${p.tags?.length ? `<div class="forum-post__tags">${p.tags.map((tag) => `<button type="button" class="forum-tag" data-forum-tag="${esc(tag)}">#${esc(TOPIC_TAGS.find((item) => item.id === tag)?.label || tag)}</button>`).join('')}</div>` : ''}

      <div class="forum-post__body">
        ${isOpen ? postBody(p.body) : `<p>${esc(excerpt(p.body))}</p>`}
      </div>

      ${renderShots(p)}

      ${p.poll ? renderPoll(p.poll, s) : ''}

      ${isOpen ? expiryControl(p, s) : ''}

      ${
        // По видимому тексту, а не по HTML: жирный абзац в три слова —
        // это не «длинный пост», хотя разметки в нём больше 220 символов.
        !isOpen && textOf(p.body).length > 220
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
            /*
              Редкие действия собраны в меню «⋯»: у автора-модератора их
              набиралось пять в одну строку, и на телефоне кнопки уезжали
              за край карточки. Кнопки остаются в разметке — просто сложены.
            */
            (canModerate || canReply || (s.me && !isMine))
              ? `<details class="forum-act-menu">
                <summary class="forum-act" title="Ещё действия" aria-label="Ещё действия с постом">⋯</summary>
                <div class="forum-act-menu__list">
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
                    canReply
                      ? `<button type="button" class="forum-act" data-forum-quote="post:${esc(p.id)}"
                                 title="Вставить текст поста в ответ">Цитировать</button>`
                      : ''
                  }
                  ${
                    s.me
                      ? `<button type="button" class="forum-act" data-forum-subscribe="${esc(p.id)}"
                                 data-forum-subscribed="${p.subscribed ? '1' : ''}"
                                 title="Получать уведомления о новых комментариях">${p.subscribed ? 'Отписаться' : 'Подписаться'}</button>`
                      : ''
                  }
                  ${
                    s.me && !isMine
                      ? `<button type="button" class="forum-act" data-forum-report="post:${esc(p.id)}">Пожаловаться</button>`
                      : ''
                  }
                  ${
                    isMine || canModerate
                      ? `<button type="button" class="forum-act forum-act--danger" data-forum-del-post="${esc(p.id)}"
                                 title="${isMine && !canModerate ? 'Удалить свой пост' : 'Удалить с указанием причины'}">Удалить</button>`
                      : ''
                  }
                </div>
              </details>`
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
      ${
        canVote
          ? ''
          : `<p class="forum-poll__hint muted">${
              poll.closed
                ? 'Опрос закрыт'
                : s.me?.banned
                  ? 'Голосование закрыто для вашего аккаунта'
                  : 'Войдите, чтобы проголосовать'
            }</p>`
      }
    </div>`;
}

/* ── Комментарии ──────────────────────────────────────────────────────────── */

function renderComments(post, s) {
  const canModerate = s.me && (s.me.role === 'admin' || s.me.role === 'moderator');
  const L = CONFIG.forum.limits;

  const visible = s.comments.filter((c) => !c.deleted);
  const items = visible.length
    ? visible
        .map((c) => {
          const isMine = s.me && s.me.id === c.authorId;
          const canQuote = Boolean(s.me && !s.me.banned);
          return `<li class="forum-comment" data-forum-comment="${esc(c.id)}">
            ${avatarHtml(c.authorNick, c.authorAvatar, { size: 'sm' })}
            <div class="forum-comment__body">
              <div class="forum-comment__head">
                <b>${nickLink(c.authorNick)}${
                  c.authorIsBlogger
                    ? `<a class="role-badge role-badge--blogger" href="#/user/${esc(encodeURIComponent(c.authorNick))}"
                         title="Ведёт блог" role="img" aria-label="Блогер">✍️<b>блогер</b></a>`
                    : ''
                }${
                  roleBadge({ role: c.authorRole }, { short: true })
                }${
                  verifiedBadge(c.authorIsVerified)
                }${
                  c.authorAlliance ? ` ${allianceCard(c.authorAlliance, s.alliances)}` : ''
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
            Это ваша запись. После удаления она исчезнет с форума.
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
