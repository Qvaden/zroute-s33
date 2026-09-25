/**
 * ГАЙДЫ (wiki) — список стратегий и советы сообщества.
 *
 * Чистый рендер от состояния. Поведение — в src/forum/guides.js.
 */
import { esc } from '../ui/helpers.js';
import { postBody } from '../forum/format.js';
import { renderMdBar } from './forum.js';
import { CONFIG } from '../../config.js';

const CATEGORIES = [
  { id: 'strategy', label: 'Стратегия' },
  { id: 'alliance', label: 'Альянсам' },
  { id: 'newbie', label: 'Новичкам' },
  { id: 'vs', label: 'VS и бои' },
];

const catLabel = (id) => (CATEGORIES.find((c) => c.id === id) || {}).label || 'Гайд';

/*
  Отметка «проверен / устарел» ставится живым модератором, поэтому надпись
  обязана говорить, кто и когда её поставил: без даты «проверено» неотличимо
  от вежливого молчания, а игрок решает по отметке, стоит ли верить совету.
*/
const REVIEW_LABEL = { verified: 'Проверен модерацией', outdated: 'Устарел' };

function ruDate(value) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('ru-RU') : '';
}

const isStaff = (me) => Boolean(me && (me.role === 'admin' || me.role === 'moderator'));

/** Короткий знак состояния у строки списка. Без отметки — ничего. */
function reviewBadge(g) {
  const label = REVIEW_LABEL[g.reviewStatus];
  if (!label) return '';
  return `<span class="guide-badge guide-badge--${esc(g.reviewStatus)}">${esc(label)}</span>`;
}

/** Сколько открытых сигналов видит модератор над своим списком. */
function signalBadge(g, staff) {
  const n = staff && Array.isArray(g.signals) ? g.signals.length : 0;
  if (!n) return '';
  return `<span class="guide-badge guide-badge--signal">${n === 1 ? 'сигнал об устаревании' : `сигналов: ${n}`}</span>`;
}

/**
 * Поиск по гайдам: слово из запроса ищется в заголовке, тексте и авторе.
 * Порядок без учёта регистра; пустой запрос пропускает всё.
 */
function matchQuery(query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return () => true;
  return (g) =>
    String(g.title ?? '').toLowerCase().includes(q)
    || String(g.body ?? '').toLowerCase().includes(q)
    || String(g.authorNick ?? '').toLowerCase().includes(q);
}

export function renderGuides(s) {
  if (s.selected) return renderDetail(s, s.selected);
  return renderList(s);
}

function renderList(s) {
  const all = Array.isArray(s.guides) ? s.guides : [];
  const guides = (s.category === 'all' ? all : all.filter((g) => g.category === s.category))
    .filter(matchQuery(s.query ?? ''));
  const cats = [{ id: 'all', label: 'Все' }, ...CATEGORIES];
  const canWrite = s.me && (s.me.isLeader || s.me.role === 'admin' || s.me.role === 'moderator');
  const staff = isStaff(s.me);

  const chips = cats
    .map((c) => `<button type="button" class="guide-chip${s.category === c.id ? ' is-on' : ''}"
             data-guide-cat="${esc(c.id)}">${esc(c.label)}</button>`)
    .join('');

  const list = guides.length
    ? `<ul class="guide-list">${guides
        .map((g) => `
          <li class="guide-card">
            <a href="#/guides/${esc(g.slug)}">
              <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
              <b class="guide-card__title">${esc(g.title)}</b>
              <span class="guide-card__by muted">Автор: ${esc(g.authorNick || '—')}</span>
              ${reviewBadge(g) || signalBadge(g, staff)
                ? `<span class="guide-card__marks">${reviewBadge(g)}${signalBadge(g, staff)}</span>`
                : ''}
            </a>
          </li>`)
        .join('')}</ul>`
    : `<p class="muted">${s.query ? 'По запросу ничего не найдено.' : 'Гайдов пока нет. Лидер альянса может добавить первый.'}</p>`;

  return `
    <section class="panel guides-page">
      <header class="panel__head">
        <span class="eyebrow">Знания сообщества</span>
        <h1>Гайды</h1>
        <p class="muted">Стратегии, советы для новичков и разбор боёв — пишут участники.</p>
      </header>
      <div class="guide-cats" role="tablist">${chips}</div>
      <label class="guide-search">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
        </svg>
        <input type="search" placeholder="Поиск по гайдам…" autocomplete="off" spellcheck="false"
               data-guide-search value="${esc(s.query ?? '')}">
      </label>
      ${canWrite && !s.composing
        ? '<button type="button" class="forum-btn forum-btn--primary" data-guide-new>Написать гайд</button>'
        : ''}
      ${canWrite && s.composing ? composeForm(s) : ''}
      <div class="guide-list-wrap">${list}</div>
    </section>`;
}

function composeForm(s) {
  const opts = CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('');
  const bodyMax = CONFIG.forum.limits.bodyMax;
  return `
    <form class="guide-composer" data-guide-form>
      <label class="forum-field">
        <span>Заголовок</span>
        <input name="title" maxlength="120" required placeholder="О чём гайд" autocomplete="off">
      </label>
      <label class="forum-field">
        <span>Slug (адрес)</span>
        <input name="slug" maxlength="80" required placeholder="na-rusi-dopuskaetsya"
               pattern="[a-z0-9а-яё\\-]+" autocomplete="off">
        <small class="muted">Латиница/кириллица, цифры, дефис. По нему откроется страница.</small>
      </label>
      <label class="forum-field">
        <span>Категория</span>
        <select name="category">${opts}</select>
      </label>
      <label class="forum-field">
        <span>Текст гайда</span>
        <div class="forum-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true"
             name="body" data-editor data-limit="${bodyMax}"
             data-placeholder="Опишите стратегию шаг за шагом. Жирный, списки, цитаты и цвет — как в посте форума."></div>
      </label>
      ${renderMdBar()}
      <div class="forum-composer__actions">
        <button type="submit" class="forum-btn forum-btn--primary">Опубликовать</button>
        <button type="button" class="forum-btn forum-btn--ghost" data-guide-cancel>Отмена</button>
      </div>
      <p class="forum-error" data-guide-error hidden></p>
    </form>`;
}

function renderDetail(s, g) {
  return `
    <section class="panel guide-detail">
      <a class="back" href="#/guides">← Все гайды</a>
      <span class="guide-card__cat">${esc(catLabel(g.category))}</span>
      <h1>${esc(g.title)}</h1>
      <p class="muted">Автор: ${esc(g.authorNick || '—')} · обновлён ${esc(new Date(g.updatedAt).toLocaleDateString('ru-RU'))}</p>
      ${reviewNotice(g)}
      <div class="guide-content">${postBody(g.body)}</div>
      ${reviewPanel(s, g)}
      ${s.me && (s.me.id === g.authorId || s.me.role === 'admin' || s.me.role === 'moderator')
        ? `<div class="guide-detail__acts"><button type="button" class="forum-btn forum-btn--ghost" data-guide-delete="${esc(g.id)}">Удалить гайд</button></div>`
        : ''}
    </section>`;
}

/*
  Вердикт стоит ПЕРЕД текстом гайда: читать совет, уже зная что он устарел,
  — другое чтение, чем узнать об этом в самом конце, когда решение принято.
*/
function reviewNotice(g) {
  const label = REVIEW_LABEL[g.reviewStatus];
  if (!label) return '';
  const date = ruDate(g.reviewedAt);
  const why = g.reviewStatus === 'outdated'
    ? 'Часть советов ниже могла перестать работать — сверяйтесь с текущей версией игры.'
    : 'Модератор перечитал гайд и не нашёл того, что требует правки.';
  return `
    <div class="guide-review guide-review--${esc(g.reviewStatus)}">
      <p class="guide-review__title">${esc(label)}${date ? ` · ${esc(date)}` : ''}</p>
      ${g.reviewNote ? `<p class="guide-review__note">${esc(g.reviewNote)}</p>` : ''}
      <p class="guide-review__why">${esc(why)}</p>
    </div>`;
}

/**
 * Панель решений: модерация ставит отметку, игрок подаёт сигнал.
 * Разделение не косметика — права на отметку нет у автора, даже у лидера.
 */
function reviewPanel(s, g) {
  const staff = isStaff(s.me);
  const signals = Array.isArray(g.signals) ? g.signals : [];
  const mine = signals.find((x) => s.me && x.userId === s.me.id);
  const max = CONFIG.forum.limits.guideNoteMax;
  const min = CONFIG.forum.limits.guideNoteMin;

  const queue = staff && signals.length
    ? `<ul class="guide-review__queue">${signals
        .map((x) => `<li><b>${esc(ruDate(x.createdAt))}</b> — ${esc(x.note)}</li>`)
        .join('')}</ul>`
    : '';

  const own = !staff && mine
    ? `<p class="guide-review__own">Вы сообщили ${esc(ruDate(mine.createdAt))}: ${esc(mine.note)}
         <button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-open>Уточнить сигнал</button></p>`
    : '';

  const readerForm = s.me && !staff
    ? (s.staleOpen
      ? `<div class="guide-review__stale">
           <label class="forum-field">
             <span>Что именно перестало работать</span>
             <textarea data-guide-stale-note maxlength="${max}" rows="2"
                       placeholder="После обновления сменились цены, раздел работает не так, как описано…">${esc(mine?.note ?? '')}</textarea>
             <small class="muted">${min}–${max} символов. Сигнал увидит модерация; повтор уточняет прошлый.</small>
           </label>
           <div class="guide-review__acts">
             <button type="button" class="forum-btn forum-btn--primary" data-guide-stale-send>Отправить</button>
             <button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-cancel>Отмена</button>
           </div>
         </div>`
      : (mine
        ? ''  // своя строка уже несёт кнопку «Уточнить сигнал»: дублировать её незачем
        : '<button type="button" class="forum-btn forum-btn--ghost" data-guide-stale-open>Сообщить, что гайд устарел</button>'))
    : '';

  const staffForm = staff
    ? `<div class="guide-review__staff">
         <label class="forum-field">
           <span>Комментарий модерации</span>
           <input data-guide-review-note maxlength="${max}" value="${esc(g.reviewNote ?? '')}" autocomplete="off"
                  placeholder="Что проверили или что именно устарело">
         </label>
         <div class="guide-review__acts">
           <button type="button" class="forum-btn forum-btn--ghost" data-guide-review="verified">Проверен</button>
           <button type="button" class="forum-btn forum-btn--ghost" data-guide-review="outdated">Устарел</button>
           ${g.reviewStatus && g.reviewStatus !== 'none'
             ? '<button type="button" class="forum-btn forum-btn--ghost" data-guide-review="none">Снять отметку</button>'
             : ''}
         </div>
       </div>`
    : '';

  if (!staff && !s.me) return '';
  if (!staff && !readerForm && !own) return '';

  return `
    <section class="guide-review-box">
      <p class="guide-review__rule">Отметку ставит модератор по своему чтению гайда — не просмотры, не реакции и не давность публикации.</p>
      ${queue}${own}${readerForm}${staffForm}
      <p class="forum-error" data-guide-error hidden></p>
    </section>`;
}
