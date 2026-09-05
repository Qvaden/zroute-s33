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
import { postBody, excerpt, timeAgo, fullTime, nickColor, nickInitial } from '../forum/format.js';
import { roleBadge, roleLabel } from '../forum/roles.js';
import { CONFIG } from '../../config.js';

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

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
    ...state,
  };

  return `
    ${renderChronicleBand(view?.events ?? [])}
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
  const list = serverEvents(events);

  if (!list.length) {
    return `
      <section class="hero forum-chron forum-chron--empty">
        <span class="eyebrow">Сводка сервера</span>
        <h1 class="forum-chron__title">Сервер 33 · сообщество</h1>
        <p class="muted">
          Хроника захватов и защит появится здесь, как только внесут первую запись.
          Форум ниже работает независимо от неё.
        </p>
      </section>`;
  }

  const last = list[0];
  const meta = EVENT_TYPE[last.type];

  const captures = list.filter((e) => e.type === 'server_capture').length;
  const defended = list.filter((e) => e.type === 'server_defended').length;

  // Пять свежих: больше на телефоне уже требует прокрутки, а полоса должна
  // читаться целиком.
  const recent = list.slice(0, 5);

  return `
    <section class="hero forum-chron forum-chron--${esc(meta.kind)}">
      <div class="forum-chron__head">
        <span class="eyebrow">Сводка сервера</span>
        <span class="forum-chron__live">
          <i aria-hidden="true"></i>LIVE
        </span>
      </div>

      <h1 class="forum-chron__title">${esc(verdictText(last.type, last.serverNumber))}</h1>
      <p class="forum-chron__date">
        ${esc(MONTH_SHORT[last.date.getUTCMonth()])} ${last.date.getUTCDate()}, ${last.date.getUTCFullYear()}
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
          <b class="num">${list.length}</b><span>${esc(plural(list.length, 'запись в летописи', 'записи в летописи', 'записей в летописи').replace(/^\d+\s/, ''))}</span>
        </div>
      </div>

      <ul class="forum-chron__feed">
        ${recent
          .map((e) => {
            const m = EVENT_TYPE[e.type];
            return `<li class="forum-chron__item forum-chron__item--${esc(m.kind)}">
              <span class="forum-chron__when num">${e.date.getUTCDate()} ${esc(MONTH_SHORT[e.date.getUTCMonth()])}</span>
              <span class="forum-chron__what">${esc(pillText(e.type, e.serverNumber))}</span>
            </li>`;
          })
          .join('')}
      </ul>

      <a class="forum-chron__more" href="#/timeline">Вся летопись сервера <b>→</b></a>
    </section>`;
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
          <textarea name="body" rows="7" required maxlength="${L.bodyMax}"
                    placeholder="Пустая строка разделяет абзацы. Ссылки вставляются как есть."></textarea>
        </label>

        ${renderAttachRow('new')}

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
      <small class="forum-attach__hint">До четырёх картинок. Сжимаются автоматически.</small>
    </div>
    <p class="forum-error" data-attach-error="${esc(scope)}" hidden></p>`;
}

/* ── Управление лентой ────────────────────────────────────────────────────── */

function renderFeedControls(s) {
  if (!s.ready) return '';

  const SORTS = [
    { id: 'fresh', label: 'Свежее' },
    { id: 'top', label: 'Лучшее' },
    { id: 'talked', label: 'Обсуждаемое' },
  ];

  return `
    <div class="ctl ctl--forum">
      <div class="seg" role="group" aria-label="Раздел форума">
        <button type="button" class="seg__btn ${s.category === 'all' ? 'is-on' : ''}"
                data-forum-cat="all">Все</button>
        ${CATEGORIES.map(
          (c) => `<button type="button" class="seg__btn ${s.category === c.id ? 'is-on' : ''}"
                          data-forum-cat="${esc(c.id)}" title="${esc(c.hint)}">${esc(c.label)}</button>`
        ).join('')}
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
 * Больше четырёх не бывает: предел держит база (см. supabase/profiles.sql).
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
function renderPostCard(p, s) {
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

  return `
    <article class="panel forum-post ${p.pinned ? 'forum-post--pinned' : ''}" data-forum-post="${esc(p.id)}">
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
      </header>

      <h2 class="forum-post__title">
        <a href="#/forum/${esc(p.id)}">${esc(p.title)}</a>
      </h2>

      <div class="forum-post__body">
        ${isOpen ? postBody(p.body) : `<p>${esc(excerpt(p.body))}</p>`}
      </div>

      ${renderShots(p)}

      ${
        !isOpen && p.body.length > 220
          ? `<a class="forum-post__expand" href="#/forum/${esc(p.id)}">Читать целиком</a>`
          : ''
      }

      <footer class="forum-post__foot">
        ${renderReactions('post', p, s)}
        <a class="forum-post__comments" href="#/forum/${esc(p.id)}">
          💬 ${p.commentCount ? esc(plural(p.commentCount, 'ответ', 'ответа', 'ответов')) : 'ответить'}
        </a>
        <span class="forum-post__acts">
          ${
            isMine || canModerate
              ? `<button type="button" class="forum-act" data-forum-del-post="${esc(p.id)}"
                         title="${isMine && !canModerate ? 'Удалить свой пост' : 'Удалить с указанием причины'}">Удалить</button>`
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
              <textarea name="body" rows="3" required maxlength="${L.commentMax}"
                        placeholder="Ответить по делу и по правилам"></textarea>
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
